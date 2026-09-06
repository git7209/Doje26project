const crypto = require("node:crypto");
const { TerminalError } = require("./terminal-errors.cjs");

function validateDimensions(cols, rows) {
  if (!Number.isSafeInteger(cols) || cols < 20 || cols > 500 ||
      !Number.isSafeInteger(rows) || rows < 5 || rows > 200) {
    throw new TerminalError("INVALID_TERMINAL_SIZE", "터미널 화면 크기가 올바르지 않습니다.");
  }
  return { cols, rows };
}

class TerminalSessionManager {
  constructor(options) {
    this.createTransport = options.createTransport;
    this.sendEvent = options.sendEvent;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.maxSessions = options.maxSessions || 12;
    this.maxSessionsPerOwner = options.maxSessionsPerOwner || 6;
    this.sessions = new Map();
  }

  ownedSession(ownerId, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
      throw new TerminalError("TERMINAL_SESSION_NOT_FOUND", "터미널 세션을 찾을 수 없습니다.");
    }
    return session;
  }

  emit(session, type, payload = {}) {
    this.sendEvent(session.ownerId, `terminal:${type}`, { sessionId: session.id, ...payload });
  }

  async open(ownerId, input) {
    if (this.sessions.size >= this.maxSessions) {
      throw new TerminalError("TERMINAL_SESSION_LIMIT", "열 수 있는 터미널 세션 수를 초과했습니다.");
    }
    const ownerCount = [...this.sessions.values()].filter((item) => item.ownerId === ownerId).length;
    if (ownerCount >= this.maxSessionsPerOwner) {
      throw new TerminalError("TERMINAL_SESSION_LIMIT", "한 창에서는 터미널을 최대 6개까지 열 수 있습니다.");
    }

    const { cols, rows } = validateDimensions(input?.cols, input?.rows);
    const id = this.randomUUID();
    const transport = await this.createTransport(input);
    const session = {
      id,
      ownerId,
      containerId: input.containerId,
      transport,
      state: "opening",
      cols,
      rows,
      pendingOutput: "",
      flushTimer: null,
      finalized: false,
    };
    this.sessions.set(id, session);
    this.emit(session, "state", { state: "opening" });

    transport.onData((data) => this.queueOutput(session, data));
    transport.onExit((event) => this.finalize(session, "shell_exit", event));
    transport.onError((error) => this.fail(session, error));

    try {
      const details = await transport.open({ ...input, cols, rows });
      session.state = "active";
      this.emit(session, "state", { state: "active", runtime: details.runtime });
      return {
        sessionId: id,
        containerId: session.containerId,
        shell: details.shell,
        runtime: details.runtime,
        state: session.state,
      };
    } catch (error) {
      this.sessions.delete(id);
      transport.close();
      throw error;
    }
  }

  queueOutput(session, data) {
    if (session.finalized || typeof data !== "string" || !data) return;
    session.pendingOutput += data;
    if (Buffer.byteLength(session.pendingOutput, "utf8") >= 16 * 1024) {
      this.flushOutput(session);
      return;
    }
    session.flushTimer ||= setTimeout(() => this.flushOutput(session), 16);
  }

  flushOutput(session) {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = null;
    if (!session.pendingOutput) return;
    const data = session.pendingOutput;
    session.pendingOutput = "";
    this.emit(session, "data", { data });
  }

  write(ownerId, input) {
    const session = this.ownedSession(ownerId, input?.sessionId);
    if (session.state !== "active") return;
    if (typeof input.data !== "string" || !input.data || Buffer.byteLength(input.data, "utf8") > 64 * 1024) {
      throw new TerminalError("INVALID_TERMINAL_INPUT", "터미널 입력이 올바르지 않습니다.");
    }
    session.transport.write(input.data);
  }

  resize(ownerId, input) {
    const session = this.ownedSession(ownerId, input?.sessionId);
    const dimensions = validateDimensions(input?.cols, input?.rows);
    if (dimensions.cols === session.cols && dimensions.rows === session.rows) return;
    Object.assign(session, dimensions);
    session.transport.resize(dimensions.cols, dimensions.rows);
  }

  close(ownerId, sessionId, reason = "user") {
    const session = this.ownedSession(ownerId, sessionId);
    this.finalize(session, reason, { exitCode: null, signal: null });
  }

  fail(session, error) {
    if (session.finalized) return;
    this.emit(session, "state", {
      state: "failed",
      reason: "transport_error",
      message: error?.message || "터미널 연결이 끊겼습니다.",
    });
    this.finalize(session, "transport_error", { exitCode: null, signal: null });
  }

  finalize(session, reason, exit = {}) {
    if (session.finalized) return;
    session.finalized = true;
    session.state = "closing";
    this.flushOutput(session);
    try { session.transport.close(); } catch {}
    this.sessions.delete(session.id);
    session.state = "closed";
    this.emit(session, "exit", {
      state: "closed",
      reason,
      exitCode: exit.exitCode ?? null,
      signal: exit.signal ?? null,
    });
  }

  closeOwner(ownerId, reason = "renderer_gone") {
    for (const session of [...this.sessions.values()]) {
      if (session.ownerId === ownerId) this.finalize(session, reason);
    }
  }

  closeAll(reason = "app_exit") {
    for (const session of [...this.sessions.values()]) this.finalize(session, reason);
  }
}

module.exports = { TerminalSessionManager, validateDimensions };

