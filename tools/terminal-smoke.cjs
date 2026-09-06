const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { PtyTransport } = require("../desktop/terminal/pty-transport.cjs");

const execFileAsync = promisify(execFile);
const distro = process.argv[2] || "Ubuntu";
const name = `container-check-terminal-smoke-${process.pid}`;
const runtime = {
  kind: "wsl",
  executable: "wsl.exe",
  prefixArgs: ["-d", distro, "--"],
  distro,
  label: `WSL · ${distro}`,
};

async function docker(args) {
  return execFileAsync("wsl.exe", ["-d", distro, "--", "docker", ...args], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
}

async function main() {
  let transport;
  try {
    const created = await docker(["run", "--rm", "-d", "--name", name, "alpine:3.22", "sleep", "30"]);
    const containerId = created.stdout.trim();
    if (!containerId) throw new Error("테스트 컨테이너를 만들지 못했습니다.");

    transport = new PtyTransport({ runtime, cwd: process.cwd() });
    let output = "";
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("터미널 출력 대기 시간이 초과됐습니다.")), 12000);
      transport.onData((data) => { output += data; });
      transport.onError(reject);
      transport.onExit(() => {
        clearTimeout(timer);
        if (output.includes("CONTAINER_CHECK_TERMINAL_OK")) resolve();
        else reject(new Error(`예상한 터미널 출력이 없습니다: ${JSON.stringify(output)}`));
      });
    });

    await transport.open({ containerId, cols: 100, rows: 30, shell: "auto" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    transport.write("printf 'CONTAINER_CHECK_TERMINAL_OK\\n'; exit\r");
    await completed;
    console.log(`Interactive terminal smoke test passed (${runtime.label}).`);
  } finally {
    transport?.close();
    await docker(["rm", "-f", name]).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

