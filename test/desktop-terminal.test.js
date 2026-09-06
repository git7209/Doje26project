const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  DockerRuntimeDetector,
  decodeCommandOutput,
  orderedDistros,
} = require("../desktop/runtime/detect-docker-runtime.cjs");
const {
  createWslDockerSocket,
  validateDistro,
} = require("../desktop/runtime/wsl-docker-socket.cjs");
const {
  createPtyCommand,
  PtyTransport,
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

test("PTY가 자연 종료되면 이미 끝난 ConPTY 프로세스를 다시 종료하지 않는다", async () => {
  let exitListener;
  const child = {
    pid: 42,
    killCalls: 0,
    onData() {},
    onExit(listener) { exitListener = listener; },
    kill() { this.killCalls += 1; },
  };
  const transport = new PtyTransport({
    runtime: { kind: "native", executable: "docker.exe", prefixArgs: [], label: "Docker Desktop" },
    pty: { spawn: () => child },
  });

  await transport.open({ containerId: "abc123", shell: "sh", cols: 80, rows: 24 });
  exitListener({ exitCode: 0, signal: null });
  transport.close();

  assert.equal(child.killCalls, 0);
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

test("Windows 앱은 기본적으로 WSL Docker를 네이티브 엔진보다 먼저 선택한다", async () => {
  const calls = [];
  const detector = new DockerRuntimeDetector({
    platform: "win32",
    run: async (executable, args) => {
      calls.push([executable, args]);
      if (executable === "docker.exe") return "28.0.0";
      if (args[0] === "--list") return "Ubuntu";
      return "27.0.0";
    },
  });

  const runtime = await detector.detect();
  assert.equal(runtime.kind, "wsl");
  assert.equal(runtime.distro, "Ubuntu");
  assert.equal(calls.some(([executable]) => executable === "docker.exe"), false);
});

test("WSL Docker 소켓은 셸 없이 고정 인자로 프록시를 열고 데스크톱 토큰을 제거한다", async () => {
  const child = new EventEmitter();
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    killed: false,
    kill() { this.killed = true; },
  });
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});
  child.stderr.on("error", () => {});
  let invocation;
  const previousToken = process.env.CONTAINER_CHECK_DESKTOP_TOKEN;
  process.env.CONTAINER_CHECK_DESKTOP_TOKEN = "do-not-forward";
  try {
    const socket = createWslDockerSocket({
      distro: "Ubuntu",
      spawnProcess: (executable, args, options) => {
        invocation = { executable, args, options };
        return child;
      },
    });
    assert.equal(invocation.executable, "wsl.exe");
    assert.deepEqual(invocation.args, ["-d", "Ubuntu", "--", "docker", "system", "dial-stdio"]);
    assert.equal(invocation.options.env.CONTAINER_CHECK_DESKTOP_TOKEN, undefined);
    socket.on("error", () => {});
    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.destroy();
    await closed;
  } finally {
    if (previousToken === undefined) delete process.env.CONTAINER_CHECK_DESKTOP_TOKEN;
    else process.env.CONTAINER_CHECK_DESKTOP_TOKEN = previousToken;
  }
  assert.equal(child.killed, true);
  assert.throws(() => validateDistro("bad\nname"));
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
