const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DockerEngine,
  DockerEngineError,
  imageLabel,
  imageVersion,
  parsePorts,
  uptimeFromCreated,
} = require("../docker-engine");
const { getDockerDashboard } = require("../server");

test("이미지 이름과 버전을 레지스트리 주소에서 분리한다", () => {
  assert.equal(imageLabel("registry.example.com/team/web:1.2.3"), "web");
  assert.equal(imageVersion("registry.example.com:5000/team/web:1.2.3"), "1.2.3");
  assert.equal(imageVersion("alpine"), "latest");
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
  let call;
  engine.request = async (method, path, body) => {
    call = { method, path, body };
    return { Id: "container-id", Warnings: [] };
  };
  const result = await engine.createContainer({
    name: "web-01",
    image: "nginx:latest",
    ports: "8080:80",
    cpuLimit: 2,
    memoryMb: 512,
  });
  assert.equal(call.method, "POST");
  assert.equal(call.path, "/v1.55/containers/create?name=web-01");
  assert.equal(call.body.HostConfig.NanoCpus, 2_000_000_000);
  assert.equal(call.body.HostConfig.Memory, 512 * 1024 * 1024);
  assert.deepEqual(call.body.HostConfig.PortBindings["80/tcp"], [
    { HostIp: "127.0.0.1", HostPort: "8080" },
  ]);
  assert.equal(result.status, "stopped");
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
