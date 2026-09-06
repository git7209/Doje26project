const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  DockerRuntimeDetector,
  decodeCommandOutput,
  orderedDistros,
} = require("../desktop/runtime/detect-docker-runtime.cjs");
const {
  createPtyCommand,
  safeEnvironment,
} = require("../desktop/terminal/pty-transport.cjs");
const {
  TerminalSessionManager,
  validateDimensions,
} = require("../desktop/terminal/terminal-session-manager.cjs");

class FakeTransport extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.resizes = [];
    this.closed = false;
  }
  onData(listener) { this.on("data", listener); }
  onExit(listener) { this.on("exit", listener); }
  onError(listener) { this.on("error", listener); }
  async open() { return { shell: "auto", runtime: "test" }; }
  write(data) { this.writes.push(data); }
  resize(cols, rows) { this.resizes.push([cols, rows]); }
  close() { this.closed = true; }
}

test("Docker와 WSL용 PTY 명령을 셸 문자열 결합 없이 생성한다", () => {
  const native = createPtyCommand(
    { kind: "native", executable: "docker.exe", prefixArgs: [] },
    { containerId: "abc123", shell: "bash" },
  );
  assert.equal(native.executable, "docker.exe");
  assert.deepEqual(native.args, ["exec", "-it", "abc123", "/bin/bash", "-l"]);

  const wsl = createPtyCommand(
    { kind: "wsl", executable: "wsl.exe", prefixArgs: ["-d", "Ubuntu", "--"] },
    { containerId: "abc123", shell: "auto" },
  );
  assert.deepEqual(wsl.args.slice(0, 7), ["-d", "Ubuntu", "--", "docker", "exec", "-it", "abc123"]);
  assert.equal(wsl.args[7], "/bin/sh");
});

test("PTY 자식 프로세스 환경에서 데스크톱 인증 토큰을 제거한다", () => {
  assert.deepEqual(
    safeEnvironment({ PATH: "bin", CONTAINER_CHECK_DESKTOP_TOKEN: "secret", NUMBER: 1 }),
    { PATH: "bin" },
  );
});

test("WSL UTF-16 출력과 배포판 우선순위를 정규화한다", () => {
  assert.equal(decodeCommandOutput(Buffer.from("Ubuntu\r\n", "utf16le")), "Ubuntu");
  assert.deepEqual(orderedDistros(["Ubuntu", "Debian", "Ubuntu"], "Debian"), ["Debian", "Ubuntu"]);
});

test("native Docker가 없으면 Docker가 실행 중인 WSL 배포판을 선택한다", async () => {
  const calls = [];
  const detector = new DockerRuntimeDetector({
    platform: "win32",
    preferredDistro: "Debian",
    run: async (executable, args) => {
      calls.push([executable, args]);
      if (executable === "docker.exe") throw new Error("not found");
      if (args[0] === "--list") return "Ubuntu\nDebian";
      if (args[1] === "Debian") return "27.0.0";
      throw new Error("not running");
    },
  });
  const runtime = await detector.detect();
  assert.equal(runtime.kind, "wsl");
  assert.equal(runtime.distro, "Debian");
  assert.deepEqual(calls.at(-1)[1].slice(0, 3), ["-d", "Debian", "--"]);
});

test("터미널 크기 범위를 검증한다", () => {
  assert.deepEqual(validateDimensions(120, 32), { cols: 120, rows: 32 });
  assert.throws(() => validateDimensions(5, 32), /크기/);
  assert.throws(() => validateDimensions(120, 1000), /크기/);
});

test("세션 관리자가 입출력, resize, 소유권과 종료를 관리한다", async () => {
  const transport = new FakeTransport();
  const events = [];
  const manager = new TerminalSessionManager({
    createTransport: async () => transport,
    sendEvent: (ownerId, channel, payload) => events.push({ ownerId, channel, payload }),
    randomUUID: () => "session-1",
  });

  const opened = await manager.open(10, {
    containerId: "abc123",
    cols: 100,
    rows: 30,
    shell: "auto",
  });
  assert.equal(opened.sessionId, "session-1");
  manager.write(10, { sessionId: "session-1", data: "echo hi\r" });
  manager.resize(10, { sessionId: "session-1", cols: 120, rows: 40 });
  assert.deepEqual(transport.writes, ["echo hi\r"]);
  assert.deepEqual(transport.resizes, [[120, 40]]);
  assert.throws(() => manager.write(99, { sessionId: "session-1", data: "x" }), /찾을 수 없습니다/);

  transport.emit("data", "hello");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(events.find((event) => event.channel === "terminal:data").payload.data, "hello");

  manager.close(10, "session-1");
  assert.equal(transport.closed, true);
  assert.equal(manager.sessions.size, 0);
  assert.equal(events.at(-1).payload.reason, "user");
});

