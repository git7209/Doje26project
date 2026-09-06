const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const distro = process.argv[2] || "Ubuntu";
const executable = path.resolve(
  process.argv[3] || path.join(__dirname, "..", "release", "win-unpacked", "Container Check.exe"),
);
const containerName = `container-check-package-smoke-${process.pid}`;

async function docker(args) {
  return execFileAsync("wsl.exe", ["-d", distro, "--", "docker", ...args], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
}

async function runApplication() {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      env: {
        ...process.env,
        CONTAINER_CHECK_SMOKE_TEST: "1",
        CONTAINER_CHECK_SMOKE_CONTAINER: containerName,
      },
      stdio: "inherit",
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("패키지 앱 테스트 제한 시간(45초)을 초과했습니다."));
    }, 45000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`패키지 앱이 종료 코드 ${code}(으)로 종료되었습니다.`));
    });
  });
}

async function main() {
  if (!fs.existsSync(executable)) throw new Error(`패키지 앱을 찾을 수 없습니다: ${executable}`);
  try {
    await docker(["run", "--rm", "-d", "--name", containerName, "alpine:3.22", "sleep", "60"]);
    await runApplication();
    console.log(`Packaged terminal smoke test passed (WSL · ${distro}).`);
  } finally {
    await docker(["rm", "-f", containerName]).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
