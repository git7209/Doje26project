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

function isShellOnlyImage(config = {}) {
  if (Array.isArray(config.Entrypoint) && config.Entrypoint.length) return false;
  if (!Array.isArray(config.Cmd) || config.Cmd.length !== 1) return false;
  const command = config.Cmd[0].split("/").pop();
  return new Set(["sh", "ash", "bash", "zsh"]).has(command);
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

  async listNetworks() {
    const rows = (await this.apiRequest("GET", "/networks")) || [];
    return rows.map((row) => ({
      id: row.Id,
      name: row.Name,
      driver: row.Driver || "-",
      scope: row.Scope || "local",
      internal: Boolean(row.Internal),
      subnet: row.IPAM?.Config?.map((item) => item.Subnet).filter(Boolean).join(", ") || "-",
      gateway: row.IPAM?.Config?.map((item) => item.Gateway).filter(Boolean).join(", ") || "-",
      createdAt: row.Created || null,
      containers: Object.values(row.Containers || {}).map((container) => ({
        id: container.Name ? container.Name.replace(/^\//, "") : container.EndpointID,
        name: container.Name ? container.Name.replace(/^\//, "") : container.EndpointID,
        ipv4: container.IPv4Address || "-",
        mac: container.MacAddress || "-",
      })),
    }));
  }

  async createNetwork(input) {
    const result = await this.apiRequest("POST", "/networks/create", {
      Name: input.name,
      Driver: input.driver || "bridge",
      Internal: Boolean(input.internal),
      CheckDuplicate: true,
    });
    return { id: result.Id, name: input.name, warning: result.Warning || "" };
  }

  async inspectNetwork(id) {
    const row = await this.apiRequest("GET", `/networks/${encodeURIComponent(id)}`);
    return {
      id: row.Id,
      name: row.Name,
      driver: row.Driver || "-",
      scope: row.Scope || "local",
      internal: Boolean(row.Internal),
      createdAt: row.Created || null,
      subnet: row.IPAM?.Config?.map((item) => item.Subnet).filter(Boolean).join(", ") || "-",
      gateway: row.IPAM?.Config?.map((item) => item.Gateway).filter(Boolean).join(", ") || "-",
      containers: Object.values(row.Containers || {}).map((container) => ({
        id: container.Name ? container.Name.replace(/^\//, "") : container.EndpointID,
        name: container.Name ? container.Name.replace(/^\//, "") : container.EndpointID,
        ipv4: container.IPv4Address || "-",
        mac: container.MacAddress || "-",
      })),
    };
  }

  async removeNetwork(id) {
    await this.apiRequest("DELETE", `/networks/${encodeURIComponent(id)}`);
    return { id, action: "delete" };
  }

  async connectNetwork(networkId, containerId) {
    await this.apiRequest("POST", `/networks/${encodeURIComponent(networkId)}/connect`, { Container: containerId });
    return { networkId, containerId, action: "connect" };
  }

  async disconnectNetwork(networkId, containerId) {
    await this.apiRequest("POST", `/networks/${encodeURIComponent(networkId)}/disconnect`, { Container: containerId, Force: false });
    return { networkId, containerId, action: "disconnect" };
  }

  async listVolumes() {
    const [data, containers, diskUsage] = await Promise.all([
      this.apiRequest("GET", "/volumes").then((value) => value || {}),
      this.apiRequest("GET", "/containers/json?all=true").then((value) => value || []),
      this.apiRequest("GET", "/system/df").catch(() => ({ Volumes: [] })),
    ]);
    const usageByName = new Map(
      (diskUsage.Volumes || []).map((volume) => [volume.Name, volume.UsageData || {}]),
    );
    const containersByVolume = new Map();
    for (const container of containers) {
      const containerName = (container.Names?.[0] || container.Id?.slice(0, 12) || "-")
        .replace(/^\//, "");
      for (const mount of container.Mounts || []) {
        if (mount.Type !== "volume" || !mount.Name) continue;
        const names = containersByVolume.get(mount.Name) || [];
        if (!names.includes(containerName)) names.push(containerName);
        containersByVolume.set(mount.Name, names);
      }
    }
    return (data.Volumes || []).map((row) => ({
      name: row.Name,
      driver: row.Driver || "local",
      scope: row.Scope || "local",
      mountpoint: row.Mountpoint || "-",
      createdAt: row.CreatedAt || null,
      sizeBytes: Math.max(0, Number(usageByName.get(row.Name)?.Size) || 0),
      refCount: Math.max(0, Number(usageByName.get(row.Name)?.RefCount) || 0),
      containers: containersByVolume.get(row.Name) || [],
    }));
  }

  async createVolume(input) {
    const volume = await this.apiRequest("POST", "/volumes/create", {
      Name: input.name,
      Driver: input.driver || "local",
    });
    return { name: volume.Name, driver: volume.Driver || "local" };
  }

  async removeVolume(name) {
    await this.apiRequest("DELETE", `/volumes/${encodeURIComponent(name)}?force=false`);
    return { name, action: "delete" };
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
    const image = await this.apiRequest(
      "GET",
      `/images/${encodeURIComponent(input.image)}/json`,
    );
    const { exposed, bindings } = parsePorts(input.ports);
    const hostConfig = { PortBindings: bindings };
    if (input.memoryMb > 0) hostConfig.Memory = input.memoryMb * 1024 * 1024;
    if (input.cpuLimit > 0) hostConfig.NanoCpus = input.cpuLimit * 1_000_000_000;
    if (input.volumeMounts?.length) {
      hostConfig.Mounts = input.volumeMounts.map((mount) => ({
        Type: "volume",
        Source: mount.volume,
        Target: mount.target,
        ReadOnly: Boolean(mount.readOnly),
      }));
    }
    const terminalOptions = isShellOnlyImage(image?.Config)
      ? { OpenStdin: true, Tty: true }
      : {};
    const created = await this.apiRequest(
      "POST",
      `/containers/create?name=${encodeURIComponent(input.name)}`,
      {
        Image: input.image,
        ExposedPorts: exposed,
        HostConfig: hostConfig,
        ...terminalOptions,
      },
    );
    await this.containerAction(created.Id, "start");
    return {
      id: created.Id,
      name: input.name,
      status: "running",
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
  isShellOnlyImage,
  parsePorts,
  resourceUsage,
  uptimeFromCreated,
};
