const nativeTerminal = typeof window !== "undefined" ? window.containerCheck?.terminal : null;
const listeners = new Map();
const backlog = new Map();
const MAX_BACKLOG_CHARS = 256 * 1024;

function dispatch(type, payload) {
  if (!payload?.sessionId) return;
  const listener = listeners.get(payload.sessionId)?.[type];
  if (listener) {
    listener(payload);
    return;
  }
  const queued = backlog.get(payload.sessionId) || [];
  queued.push({ type, payload });
  let size = queued.reduce((total, item) => total + (item.payload.data?.length || 64), 0);
  while (size > MAX_BACKLOG_CHARS && queued.length > 1) {
    const removed = queued.shift();
    size -= removed.payload.data?.length || 64;
  }
  backlog.set(payload.sessionId, queued);
}

if (nativeTerminal) {
  nativeTerminal.onData((payload) => dispatch("data", payload));
  nativeTerminal.onState((payload) => dispatch("state", payload));
  nativeTerminal.onExit((payload) => dispatch("exit", payload));
}

export const terminalBridge = {
  available: Boolean(nativeTerminal),

  async open(input) {
    const response = await nativeTerminal.open(input);
    if (!response?.ok) throw new Error(response?.error?.message || "터미널을 열지 못했습니다.");
    return response.session;
  },

  write(sessionId, data) {
    nativeTerminal?.write({ sessionId, data });
  },

  resize(sessionId, cols, rows) {
    nativeTerminal?.resize({ sessionId, cols, rows });
  },

  close(sessionId) {
    nativeTerminal?.close({ sessionId });
    backlog.delete(sessionId);
    listeners.delete(sessionId);
  },

  subscribe(sessionId, handlers) {
    listeners.set(sessionId, handlers);
    const queued = backlog.get(sessionId) || [];
    backlog.delete(sessionId);
    for (const item of queued) handlers[item.type]?.(item.payload);
    return () => {
      if (listeners.get(sessionId) === handlers) listeners.delete(sessionId);
    };
  },
};

