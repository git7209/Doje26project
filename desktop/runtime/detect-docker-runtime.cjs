const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { TerminalError } = require("../terminal/terminal-errors.cjs");

const execFileAsync = promisify(execFile);

function decodeCommandOutput(value) {
  if (typeof value === "string") return value.replace(/^\uFEFF/, "").trim();
  if (!Buffer.isBuffer(value)) return "";
  const sample = value.subarray(0, Math.min(value.length, 80));
  const nullBytes = [...sample].filter((byte) => byte === 0).length;
  const encoding = nullBytes > sample.length / 4 ? "utf16le" : "utf8";
  return value.toString(encoding).replace(/^\uFEFF/, "").replace(/\0/g, "").trim();
}

async function runFile(executable, args, options = {}) {
  const result = await execFileAsync(executable, args, {
    encoding: "buffer",
    timeout: options.timeout || 4500,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return decodeCommandOutput(result.stdout);
}

async function probeDocker(run, executable, prefixArgs = []) {
  const output = await run(executable, [
    ...prefixArgs,
    "docker",
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  return Boolean(decodeCommandOutput(output));
}

function orderedDistros(distros, preferred) {
  const unique = [...new Set(distros.map((item) => item.trim()).filter(Boolean))];
  if (!preferred || !unique.includes(preferred)) return unique;
  return [preferred, ...unique.filter((item) => item !== preferred)];
}

class DockerRuntimeDetector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.run = options.run || runFile;
    this.preferredDistro = options.preferredDistro || process.env.CONTAINER_CHECK_WSL_DISTRO || "";
    this.cached = null;
  }

  clearCache() {
    this.cached = null;
  }

  detect() {
    this.cached ||= this.detectUncached().catch((error) => {
      this.cached = null;
      throw error;
    });
    return this.cached;
  }

  async detectUncached() {
    const nativeExecutable = this.platform === "win32" ? "docker.exe" : "docker";
    try {
      const prefix = [];
      const output = await this.run(nativeExecutable, ["version", "--format", "{{.Server.Version}}"]);
      if (decodeCommandOutput(output)) {
        return { kind: "native", executable: nativeExecutable, prefixArgs: [], label: "Docker Engine" };
      }
    } catch {}

    if (this.platform !== "win32") {
      throw new TerminalError("DOCKER_NOT_FOUND", "Docker Engine에 연결할 수 없습니다.");
    }

    let distros;
    try {
      const output = await this.run("wsl.exe", ["--list", "--quiet"]);
      distros = orderedDistros(decodeCommandOutput(output).split(/\r?\n/), this.preferredDistro);
    } catch {
      throw new TerminalError("WSL_NOT_INSTALLED", "WSL을 찾을 수 없습니다.");
    }

    for (const distro of distros) {
      try {
        const prefixArgs = ["-d", distro, "--"];
        if (await probeDocker(this.run, "wsl.exe", prefixArgs)) {
          return {
            kind: "wsl",
            executable: "wsl.exe",
            prefixArgs,
            distro,
            label: `WSL · ${distro}`,
          };
        }
      } catch {}
    }

    throw new TerminalError(
      "DOCKER_NOT_FOUND",
      distros.length
        ? "WSL 배포판에서 실행 중인 Docker Engine을 찾지 못했습니다."
        : "설치된 WSL 배포판을 찾지 못했습니다.",
    );
  }
}

module.exports = {
  DockerRuntimeDetector,
  decodeCommandOutput,
  orderedDistros,
  probeDocker,
  runFile,
};

