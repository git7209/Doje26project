const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DockerEngine,
  DockerEngineError,
  imageLabel,
  imageVersion,
  isShellOnlyImage,
  parsePorts,
  resourceUsage,
  uptimeFromCreated,
} = require("../docker-engine");
const { getDockerDashboard, hashPassword, normalizeEmail, sessionTokenHash, validateContainerId, validateContainerInput, validateDisplayName, validatePassword, validateVolumeName, verifyPassword } = require("../server");

test("Docker 가상 네트워크 목록을 컨테이너 정보와 함께 변환한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  engine.request = async () => [{ Id: "a".repeat(64), Name: "app-net", Driver: "bridge", Scope: "local", Internal: true, Created: "2026-09-01T00:00:00Z", IPAM: { Config: [{ Subnet: "172.20.0.0/16", Gateway: "172.20.0.1" }] }, Containers: { x: { Name: "/web", IPv4Address: "172.20.0.2/16", MacAddress: "02:42:ac:14:00:02" } } }];
  assert.deepEqual(await engine.listNetworks(), [{
    id: "a".repeat(64), name: "app-net", driver: "bridge", scope: "local", internal: true,
    subnet: "172.20.0.0/16", gateway: "172.20.0.1", createdAt: "2026-09-01T00:00:00Z",
    containers: [{ id: "web", name: "web", ipv4: "172.20.0.2/16", mac: "02:42:ac:14:00:02" }],
  }]);
});

test("Docker 가상 네트워크 작업을 올바른 API로 전달한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  const calls = [];
  engine.request = async (method, path, body) => { calls.push({ method, path, body }); return method === "POST" && path.endsWith("/networks/create") ? { Id: "b".repeat(64), Warning: "" } : null; };
  await engine.createNetwork({ name: "app-net", internal: true });
  await engine.connectNetwork("b".repeat(64), "container-01");
  await engine.disconnectNetwork("b".repeat(64), "container-01");
  await engine.removeNetwork("b".repeat(64));
  assert.deepEqual(calls, [
    { method: "POST", path: "/v1.55/networks/create", body: { Name: "app-net", Driver: "bridge", Internal: true, CheckDuplicate: true } },
    { method: "POST", path: `/v1.55/networks/${"b".repeat(64)}/connect`, body: { Container: "container-01" } },
    { method: "POST", path: `/v1.55/networks/${"b".repeat(64)}/disconnect`, body: { Container: "container-01", Force: false } },
    { method: "DELETE", path: `/v1.55/networks/${"b".repeat(64)}`, body: undefined },
  ]);
});

test("볼륨 목록에 사용량과 연결된 컨테이너를 결합한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  engine.request = async (method, path) => {
    if (path.endsWith("/volumes")) return { Volumes: [{ Name: "app-data", Driver: "local", Mountpoint: "/data/volumes/app-data" }] };
    if (path.includes("/containers/json")) return [{ Id: "abc", Names: ["/web"], Mounts: [{ Type: "volume", Name: "app-data" }] }];
    if (path.endsWith("/system/df")) return { Volumes: [{ Name: "app-data", UsageData: { Size: 4096, RefCount: 1 } }] };
    return null;
  };
  assert.deepEqual(await engine.listVolumes(), [{
    name: "app-data", driver: "local", scope: "local", mountpoint: "/data/volumes/app-data",
    createdAt: null, sizeBytes: 4096, refCount: 1, containers: ["web"],
  }]);
});

test("볼륨 생성과 삭제를 Docker API로 전달한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  const calls = [];
  engine.request = async (method, path, body) => {
    calls.push({ method, path, body });
    return method === "POST" ? { Name: "app-data", Driver: "local" } : null;
  };
  await engine.createVolume({ name: "app-data", driver: "local" });
  await engine.removeVolume("app-data");
  assert.deepEqual(calls, [
    { method: "POST", path: "/v1.55/volumes/create", body: { Name: "app-data", Driver: "local" } },
    { method: "DELETE", path: "/v1.55/volumes/app-data?force=false", body: undefined },
  ]);
});

test("컨테이너 볼륨 마운트를 검증하고 Docker Mounts로 변환한다", async () => {
  const input = validateContainerInput({
    name: "web-01", image: "nginx:latest", ports: "", cpuLimit: 0, memoryMb: 0,
    volumeMounts: [{ volume: "app-data", target: "/var/lib/app", readOnly: true }],
  });
  const engine = new DockerEngine({ apiVersion: "1.55" });
  let createBody;
  engine.request = async (method, path, value) => {
    if (path.includes("/containers/create")) createBody = value;
    return { Id: "id", Warnings: [] };
  };
  await engine.createContainer(input);
  assert.deepEqual(createBody.HostConfig.Mounts, [{ Type: "volume", Source: "app-data", Target: "/var/lib/app", ReadOnly: true }]);
  assert.throws(() => validateContainerInput({ ...input, volumeMounts: [{ volume: "bad/name", target: "../data" }] }));
});

test("볼륨 이름을 안전하게 검증한다", () => {
  assert.equal(validateVolumeName("app-data_01"), "app-data_01");
  assert.throws(() => validateVolumeName("../data"));
});

test("이미지 이름과 버전을 레지스트리 주소에서 분리한다", () => {
  assert.equal(imageLabel("registry.example.com/team/web:1.2.3"), "web");
  assert.equal(imageVersion("registry.example.com:5000/team/web:1.2.3"), "1.2.3");
  assert.equal(imageVersion("alpine"), "latest");
});

test("기본 명령이 셸 하나인 이미지를 구분한다", () => {
  assert.equal(isShellOnlyImage({ Cmd: ["/bin/bash"] }), true);
  assert.equal(isShellOnlyImage({ Cmd: ["sh"] }), true);
  assert.equal(isShellOnlyImage({ Cmd: ["nginx", "-g", "daemon off;"] }), false);
  assert.equal(isShellOnlyImage({ Entrypoint: ["/entrypoint.sh"], Cmd: ["sh"] }), false);
});

test("셸 전용 이미지는 표준 입력과 TTY를 유지해 즉시 종료되지 않게 한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  let createBody;
  engine.request = async (method, path, body) => {
    if (path.includes("/images/")) return { Config: { Cmd: ["/bin/bash"] } };
    if (path.includes("/containers/create")) {
      createBody = body;
      return { Id: "shell-container", Warnings: [] };
    }
    return null;
  };
  await engine.createContainer({
    name: "ubuntu-shell", image: "ubuntu:24.04", ports: "", cpuLimit: 0, memoryMb: 0,
  });
  assert.equal(createBody.OpenStdin, true);
  assert.equal(createBody.Tty, true);
});

test("포트 문자열을 Docker 포트 바인딩으로 변환한다", () => {
  assert.deepEqual(parsePorts("8080:80,5353:53/udp"), {
    exposed: { "80/tcp": {}, "53/udp": {} },
    bindings: {
      "80/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }],
      "53/udp": [{ HostIp: "127.0.0.1", HostPort: "5353" }],
    },
  });
  assert.throws(() => parsePorts("bad"), DockerEngineError);
  assert.throws(() => parsePorts("70000:80"), DockerEngineError);
});

test("Docker 이미지 응답을 화면 데이터로 변환한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  engine.request = async () => [{
    RepoTags: ["ubuntu:24.04", "<none>:<none>"],
    Size: 125 * 1024 * 1024,
    Created: 1_700_000_000,
  }];
  assert.deepEqual(await engine.listImages(), [{
    reference: "ubuntu:24.04",
    label: "ubuntu",
    version: "24.04",
    os: "Linux",
    arch: "현재 Engine",
    sizeMb: 125,
    updatedAt: "2023-11-14T22:13:20.000Z",
  }]);
});

test("생성 입력의 자원 제한을 Docker 요청으로 전달한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  const calls = [];
  engine.request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes("/images/")) {
      return { Config: { Cmd: ["nginx", "-g", "daemon off;"] } };
    }
    return { Id: "container-id", Warnings: [] };
  };
  const result = await engine.createContainer({
    name: "web-01",
    image: "nginx:latest",
    ports: "8080:80",
    cpuLimit: 2,
    memoryMb: 512,
  });
  assert.deepEqual(calls.map(({ method, path }) => ({ method, path })), [
    { method: "GET", path: "/v1.55/images/nginx%3Alatest/json" },
    { method: "POST", path: "/v1.55/containers/create?name=web-01" },
    { method: "POST", path: "/v1.55/containers/container-id/start?t=3" },
  ]);
  assert.equal(calls[1].body.HostConfig.NanoCpus, 2_000_000_000);
  assert.equal(calls[1].body.HostConfig.Memory, 512 * 1024 * 1024);
  assert.deepEqual(calls[1].body.HostConfig.PortBindings["80/tcp"], [
    { HostIp: "127.0.0.1", HostPort: "8080" },
  ]);
  assert.equal(calls[1].body.OpenStdin, undefined);
  assert.equal(calls[1].body.Tty, undefined);
  assert.equal(result.status, "running");
});

test("대시보드 요약은 Docker 상태를 기준으로 계산한다", async () => {
  const result = await getDockerDashboard({
    listContainers: async () => [
      { status: "running" },
      { status: "stopped" },
      { status: "paused" },
      { status: "dead" },
    ],
  });
  assert.deepEqual(result.summary, {
    total: 4,
    running: 1,
    stopped: 1,
    paused: 1,
    errors: 1,
  });
});

test("실행 시간을 읽기 쉬운 단위로 표시한다", () => {
  const now = 2_000_000 * 1000;
  assert.equal(uptimeFromCreated(1_999_970, now), "30초");
  assert.equal(uptimeFromCreated(1_992_800, now), "2시간");
});

test("Docker 통계에서 CPU와 캐시 제외 메모리를 계산한다", () => {
  assert.deepEqual(resourceUsage({
    cpu_stats: {
      cpu_usage: { total_usage: 300, percpu_usage: [1, 2] },
      system_cpu_usage: 2000,
      online_cpus: 2,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 100 },
      system_cpu_usage: 1000,
    },
    memory_stats: {
      usage: 100 * 1024 * 1024,
      stats: { inactive_file: 20 * 1024 * 1024 },
    },
  }), { cpuPercent: 40, memoryMb: 80 });
});

test("허용된 컨테이너 동작만 Engine API로 전송한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  const calls = [];
  engine.request = async (method, path) => calls.push({ method, path });
  await engine.containerAction("web-01", "start");
  await engine.containerAction("web-01", "restart");
  await engine.removeContainer("web-01");
  assert.deepEqual(calls, [
    { method: "POST", path: "/v1.55/containers/web-01/start?t=3" },
    { method: "POST", path: "/v1.55/containers/web-01/restart?t=3" },
    { method: "DELETE", path: "/v1.55/containers/web-01?v=true" },
  ]);
  await assert.rejects(() => engine.containerAction("web-01", "exec"), DockerEngineError);
});

test("터미널 명령을 Docker Exec API로 실행한다", async () => {
  const engine = new DockerEngine({ apiVersion: "1.55" });
  const calls = [];
  engine.request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith("/exec")) return { Id: "exec-01" };
    return "hello\r\n";
  };
  assert.deepEqual(await engine.execCommand("web-01", "printf hello"), { output: "hello\r\n" });
  assert.deepEqual(calls, [
    { method: "POST", path: "/v1.55/containers/web-01/exec", body: { AttachStdout: true, AttachStderr: true, Cmd: ["sh", "-lc", "printf hello"], Tty: true } },
    { method: "POST", path: "/v1.55/exec/exec-01/start", body: { Detach: false, Tty: true } },
  ]);
});

test("컨테이너 ID와 이름 형식을 검증한다", () => {
  assert.equal(validateContainerId("web-01"), "web-01");
  assert.throws(() => validateContainerId("../docker.sock"));
  assert.throws(() => validateContainerId("bad/name"));
});

test("회원가입 입력값을 검증하고 이메일을 정규화한다", () => {
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(validateDisplayName("사용자"), "사용자");
  assert.equal(validatePassword("password123"), "password123");
  assert.throws(() => normalizeEmail("invalid"));
  assert.throws(() => validateDisplayName("a"));
  assert.throws(() => validatePassword("short"));
});

test("비밀번호는 salt가 적용된 scrypt 해시로 검증한다", async () => {
  const first = await hashPassword("password123");
  const second = await hashPassword("password123");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword("password123", first.salt, first.hash), true);
  assert.equal(await verifyPassword("wrong-password", first.salt, first.hash), false);
  assert.equal(sessionTokenHash("token").length, 64);
});
