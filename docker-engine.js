const http = require("node:http");

class DockerEngineError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "DockerEngineError";
    this.status = status;
    this.details = details;
  }
}

function socketPathFromEnvironment() {
  if (process.env.DOCKER_SOCKET) return process.env.DOCKER_SOCKET;
  if (process.platform === "win32") return "//./pipe/docker_engine";
  return "/var/run/docker.sock";
}

function parsePorts(value) {
  const exposed = {};
  const bindings = {};
  if (!value) return { exposed, bindings };
  for (const item of value.split(",")) {
    const match = item.trim().match(/^(?:(\d{1,5}):)?(\d{1,5})(?:\/(tcp|udp))?$/i);
    if (!match)
      throw new DockerEngineError(400, `올바르지 않은 포트 형식입니다: ${item.trim()}`);
    const hostPort = Number(match[1] || match[2]);
    const containerPort = Number(match[2]);
    if (hostPort > 65535 || containerPort > 65535)
      throw new DockerEngineError(400, "포트 번호는 65535 이하여야 합니다.");
    const key = `${containerPort}/${(match[3] || "tcp").toLowerCase()}`;
    exposed[key] = {};
    bindings[key] = [{ HostIp: "127.0.0.1", HostPort: String(hostPort) }];
  }
  return { exposed, bindings };
}

function imageLabel(reference) {
  const last = reference.split("@")[0].split("/").pop() || reference;
  const separator = last.lastIndexOf(":");
  return separator > -1 ? last.slice(0, separator) : last;
}

function imageVersion(reference) {
  if (reference.includes("@")) return reference.split("@")[1].slice(0, 19);
  const last = reference.split("/").pop() || reference;
  const separator = last.lastIndexOf(":");
  return separator > -1 ? last.slice(separator + 1) : "latest";
}

function uptimeFromCreated(createdSeconds, now = Date.now()) {
  if (!createdSeconds) return "-";
  const seconds = Math.max(0, Math.floor(now / 1000) - createdSeconds);
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간`;
  return `${Math.floor(seconds / 86400)}일`;
}

function resourceUsage(stats) {
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage || 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage || 0) -
    (stats.precpu_stats?.system_cpu_usage || 0);
  const cpuCount =
    stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  const cpuPercent =
    cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
  const memory = stats.memory_stats || {};
  const cache = memory.stats?.inactive_file ?? memory.stats?.cache ?? 0;
  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memoryMb: Number((Math.max(0, (memory.usage || 0) - cache) / 1024 / 1024).toFixed(1)),
  };
}

class DockerEngine {
  constructor(options = {}) {
    this.socketPath = options.socketPath || socketPathFromEnvironment();
    this.timeoutMs = options.timeoutMs || 5000;
    this.apiVersion = options.apiVersion || null;
    this.versionPromise = null;
  }

  async apiRequest(method, pathname, body) {
    if (!this.apiVersion) {
      this.versionPromise ||= this.request("GET", "/version").then((version) => {
        if (!/^\d+\.\d+$/.test(version?.ApiVersion || ""))
          throw new DockerEngineError(503, "Docker Engine API 버전을 확인할 수 없습니다.");
        this.apiVersion = version.ApiVersion;
        return this.apiVersion;
      });
      await this.versionPromise;
    }
    return this.request(method, `/v${this.apiVersion}${pathname}`, body);
  }

  request(method, pathname, body) {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          path: pathname,
          method,
          headers: payload
            ? { "Content-Type": "application/json", "Content-Length": payload.length }
            : {},
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let data = null;
            if (text) {
              try { data = JSON.parse(text); } catch { data = text; }
            }
            if (res.statusCode >= 400) {
              reject(new DockerEngineError(
                res.statusCode,
                data?.message || `Docker Engine 요청 실패 (${res.statusCode})`,
                data,
              ));
              return;
            }
            resolve(data);
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("Docker Engine 응답 시간 초과")));
      req.on("error", (error) => reject(new DockerEngineError(
        503,
        "Docker Engine에 연결할 수 없습니다. 실행 상태와 DOCKER_SOCKET을 확인하세요.",
        error.message,
      )));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async ping() {
    return (await this.request("GET", "/_ping")) === "OK";
  }

  async listImages() {
    const rows = (await this.apiRequest("GET", "/images/json")) || [];
    return rows.flatMap((row) => {
      const references = (row.RepoTags || []).filter((tag) => tag !== "<none>:<none>");
      return references.map((reference) => ({
        reference,
        label: imageLabel(reference),
        version: imageVersion(reference),
        os: row.Os || "Linux",
        arch: row.Architecture || "현재 Engine",
        sizeMb: Math.round((row.Size || 0) / 1024 / 1024),
        updatedAt: new Date((row.Created || 0) * 1000).toISOString(),
      }));
    });
  }

  async listContainers() {
    const rows = (await this.apiRequest("GET", "/containers/json?all=true")) || [];
    return Promise.all(rows.map(async (row) => {
      const networks = Object.values(row.NetworkSettings?.Networks || {});
      let usage = { cpuPercent: 0, memoryMb: 0 };
      if (row.State === "running") {
        try {
          usage = await this.containerStats(row.Id);
        } catch (error) {
          if (!(error instanceof DockerEngineError)) throw error;
        }
      }
      return {
        id: row.Id,
        name: (row.Names?.[0] || row.Id.slice(0, 12)).replace(/^\//, ""),
        status: row.State === "exited" || row.State === "created" ? "stopped" : row.State,
        image: row.Image,
        ports: (row.Ports || [])
          .map((port) => `${port.PublicPort || ""}:${port.PrivatePort}/${port.Type}`)
          .join(","),
        ...usage,
        ipAddress: networks.find((network) => network.IPAddress)?.IPAddress || "-",
        uptime: row.State === "running" ? uptimeFromCreated(row.Created) : "-",
        updatedAt: new Date((row.Created || 0) * 1000).toISOString(),
      };
    }));
  }

  async containerStats(id) {
    const stats = await this.apiRequest(
      "GET",
      `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`,
    );
    return resourceUsage(stats || {});
  }

  async containerAction(id, action) {
    if (!new Set(["start", "stop", "restart"]).has(action))
      throw new DockerEngineError(400, "지원하지 않는 컨테이너 작업입니다.");
    await this.apiRequest(
      "POST",
      `/containers/${encodeURIComponent(id)}/${action}?t=3`,
    );
    return { id, action };
  }

  async removeContainer(id) {
    await this.apiRequest("DELETE", `/containers/${encodeURIComponent(id)}?v=true`);
    return { id, action: "delete" };
  }

  async createContainer(input) {
    const { exposed, bindings } = parsePorts(input.ports);
    const hostConfig = { PortBindings: bindings };
    if (input.memoryMb > 0) hostConfig.Memory = input.memoryMb * 1024 * 1024;
    if (input.cpuLimit > 0) hostConfig.NanoCpus = input.cpuLimit * 1_000_000_000;
    const created = await this.apiRequest(
      "POST",
      `/containers/create?name=${encodeURIComponent(input.name)}`,
      { Image: input.image, ExposedPorts: exposed, HostConfig: hostConfig },
    );
    return {
      id: created.Id,
      name: input.name,
      status: "stopped",
      image: input.image,
      ports: input.ports,
      cpuLimit: input.cpuLimit,
      memoryLimitMb: input.memoryMb,
      warnings: created.Warnings || [],
    };
  }
}

module.exports = {
  DockerEngine,
  DockerEngineError,
  imageLabel,
  imageVersion,
  parsePorts,
  resourceUsage,
  uptimeFromCreated,
};
