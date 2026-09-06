const pty = require("node-pty");
const { TerminalError } = require("./terminal-errors.cjs");

const SHELLS = new Set(["auto", "bash", "ash", "sh"]);
const AUTO_SHELL = "if command -v bash >/dev/null 2>&1; then exec bash -l; " +
  "elif command -v ash >/dev/null 2>&1; then exec ash -l; else exec sh; fi";

function validateContainerId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) {
    throw new TerminalError("INVALID_CONTAINER_ID", "올바른 컨테이너를 선택해 주세요.");
  }
  return value;
}

function validateShell(value) {
  const shell = value || "auto";
  if (!SHELLS.has(shell)) {
    throw new TerminalError("UNSUPPORTED_SHELL", "지원하지 않는 셸입니다.");
  }
  return shell;
}

function shellArgs(shell) {
  if (shell === "auto") return ["/bin/sh", "-lc", AUTO_SHELL];
  return [`/bin/${shell}`, "-l"];
}

function createPtyCommand(runtime, options) {
  const containerId = validateContainerId(options.containerId);
  const shell = validateShell(options.shell);
  return {
    executable: runtime.executable,
    args: [
      ...(runtime.prefixArgs || []),
      ...(runtime.kind === "wsl" ? ["docker"] : []),
      "exec",
      "-it",
      containerId,
      ...shellArgs(shell),
    ],
    shell,
  };
}

function safeEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => key !== "CONTAINER_CHECK_DESKTOP_TOKEN" && typeof value === "string"));
}

class PtyTransport {
  constructor(options) {
    this.runtime = options.runtime;
    this.cwd = options.cwd || process.cwd();
    this.pty = options.pty || pty;
    this.process = null;
    this.listeners = { data: new Set(), exit: new Set(), error: new Set() };
  }

  onData(listener) { this.listeners.data.add(listener); return () => this.listeners.data.delete(listener); }
  onExit(listener) { this.listeners.exit.add(listener); return () => this.listeners.exit.delete(listener); }
  onError(listener) { this.listeners.error.add(listener); return () => this.listeners.error.delete(listener); }

  emit(type, value) {
    for (const listener of this.listeners[type]) listener(value);
  }

  async open(options) {
    const command = createPtyCommand(this.runtime, options);
    try {
      this.process = this.pty.spawn(command.executable, command.args, {
        name: "xterm-256color",
        cols: options.cols,
        rows: options.rows,
        cwd: this.cwd,
        env: { ...safeEnvironment(), TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
    } catch (error) {
      throw new TerminalError("TERMINAL_START_FAILED", "터미널 프로세스를 시작하지 못했습니다.", error.message);
    }
    const child = this.process;
    child.onData((data) => this.emit("data", data));
    child.onExit((event) => {
      if (this.process === child) this.process = null;
      this.emit("exit", event);
    });
    return { shell: command.shell, runtime: this.runtime.label, pid: child.pid };
  }

  write(data) {
    if (!this.process) throw new TerminalError("TERMINAL_CLOSED", "터미널 세션이 종료되었습니다.");
    this.process.write(data);
  }

  resize(cols, rows) {
    if (!this.process) return;
    this.process.resize(cols, rows);
  }

  close() {
    if (!this.process) return;
    const child = this.process;
    this.process = null;
    try { child.kill(); } catch {}
  }
}

module.exports = {
  AUTO_SHELL,
  PtyTransport,
  createPtyCommand,
  safeEnvironment,
  shellArgs,
  validateContainerId,
  validateShell,
};
