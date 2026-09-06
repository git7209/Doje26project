const { spawn } = require("node:child_process");
const { Duplex } = require("node:stream");

function validateDistro(value) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) {
    throw new TypeError("올바른 WSL 배포판 이름이 필요합니다.");
  }
  return value.trim();
}

function createWslDockerSocket(options = {}) {
  const distro = validateDistro(options.distro);
  const spawnProcess = options.spawnProcess || spawn;
  const child = spawnProcess(
    "wsl.exe",
    ["-d", distro, "--", "docker", "system", "dial-stdio"],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.fromEntries(Object.entries(process.env)
        .filter(([key, value]) => key !== "CONTAINER_CHECK_DESKTOP_TOKEN" && typeof value === "string")),
    },
  );
  const socket = Duplex.from({ readable: child.stdout, writable: child.stdin });
  let stderr = "";
  let timeout;

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 8192) stderr += chunk;
  });
  child.once("error", (error) => socket.destroy(error));
  child.once("exit", (code) => {
    if (code && !socket.destroyed) {
      socket.destroy(new Error(stderr.trim() || `WSL Docker 연결이 종료되었습니다. (${code})`));
    }
  });

  socket.setNoDelay = () => socket;
  socket.setKeepAlive = () => socket;
  socket.setTimeout = (milliseconds, listener) => {
    clearTimeout(timeout);
    if (typeof listener === "function") socket.once("timeout", listener);
    if (milliseconds > 0) {
      timeout = setTimeout(() => socket.emit("timeout"), milliseconds);
      timeout.unref?.();
    }
    return socket;
  };
  socket.once("close", () => {
    clearTimeout(timeout);
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    if (child.exitCode === null && !child.killed) child.kill();
  });

  return socket;
}

function createWslDockerConnectionFactory(options = {}) {
  const distro = validateDistro(options.distro);
  return () => createWslDockerSocket({ ...options, distro });
}

module.exports = {
  createWslDockerConnectionFactory,
  createWslDockerSocket,
  validateDistro,
};
