const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
require("dotenv").config();
const { Pool } = require("pg");
const PORT = Number(process.env.PORT || 8080),
  root = __dirname,
  uploadDir = path.join(root, "uploads", "images"),
  pool = new Pool();
const savedImages = [
  {
    reference: "ubuntu:24.04",
    label: "Ubuntu",
    version: "24.04 LTS",
    os: "Linux",
    arch: "amd64",
    sizeMb: 125,
    updatedAt: "2026-08-25T00:00:00Z",
  },
  {
    reference: "debian:12",
    label: "Debian",
    version: "12 Bookworm",
    os: "Linux",
    arch: "amd64",
    sizeMb: 98,
    updatedAt: "2026-08-24T00:00:00Z",
  },
  {
    reference: "alpine:3.22",
    label: "Alpine",
    version: "3.22",
    os: "Linux",
    arch: "amd64",
    sizeMb: 8,
    updatedAt: "2026-08-23T00:00:00Z",
  },
];
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function sendError(res, status, code, message, fields) {
  sendJson(res, status, {
    ok: false,
    error: { code, message, ...(fields ? { fields } : {}) },
  });
}
class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    Object.assign(this, { status, code, fields });
  }
}
function readJsonBody(req, max = 16384) {
  return new Promise((resolve, reject) => {
    let body = "",
      size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > max) {
        req.destroy();
        reject(
          new ApiError(
            413,
            "PAYLOAD_TOO_LARGE",
            "요청 본문은 16KB 이하여야 합니다.",
          ),
        );
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(
          new ApiError(400, "INVALID_JSON", "올바른 JSON 요청이 아닙니다."),
        );
      }
    });
    req.on("error", reject);
  });
}
function validateContainerInput(input) {
  const fields = {},
    name = typeof input?.name === "string" ? input.name.trim() : "",
    image = typeof input?.image === "string" ? input.image.trim() : "",
    ports = typeof input?.ports === "string" ? input.ports.trim() : "",
    cpuLimit = input?.cpuLimit ?? 0,
    memoryMb = input?.memoryMb ?? 0;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,9}[a-z0-9])?$/.test(name))
    fields.name = "이름 형식을 확인하세요.";
  if (!image || image.length > 255)
    fields.image = "올바른 이미지를 선택하세요.";
  if (ports.length > 255) fields.ports = "포트 정보는 255자 이하여야 합니다.";
  if (!Number.isSafeInteger(cpuLimit) || cpuLimit < 0)
    fields.cpuLimit = "CPU 제한은 0 이상의 정수여야 합니다.";
  if (!Number.isSafeInteger(memoryMb) || memoryMb < 0 || memoryMb > 2147483647)
    fields.memoryMb = "메모리 제한 값을 확인하세요.";
  if (Object.keys(fields).length)
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "입력값을 확인하세요.",
      fields,
    );
  return { name, image, ports, cpuLimit, memoryMb };
}
async function createContainer(input, database = pool) {
  const v = validateContainerInput(input);
  try {
    const result = await database.query(
      `INSERT INTO containers (name,status,image,ports,cpu_limit,memory_limit_mb,cpu_percent,memory_mb) VALUES ($1,'stopped',$2,$3,$4,$5,0,0) RETURNING id,name,status,image,ports,cpu_limit AS "cpuLimit",memory_limit_mb AS "memoryLimitMb",created_at AS "createdAt"`,
      [v.name, v.image, v.ports, v.cpuLimit, v.memoryMb],
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505")
      throw new ApiError(
        409,
        "CONTAINER_NAME_CONFLICT",
        "이미 사용 중인 컨테이너 이름입니다.",
        { name: "이미 사용 중인 이름입니다." },
      );
    throw error;
  }
}
async function getDashboard(database = pool) {
  const result = await database.query(
      `SELECT id,name,status,image,ports,cpu_percent AS "cpuPercent",memory_mb AS "memoryMb",updated_at AS "updatedAt" FROM containers ORDER BY id`,
    ),
    containers = result.rows;
  return {
    ok: true,
    containers,
    summary: {
      total: containers.length,
      running: containers.filter((x) => x.status === "running").length,
      stopped: containers.filter((x) => x.status === "stopped").length,
      paused: containers.filter((x) => x.status === "paused").length,
      errors: containers.filter((x) => x.status === "error").length,
    },
  };
}
function safeFileName(value) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(value || "");
  } catch {}
  const base = path.basename(decoded).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!base || !/\.(tar|tar\.gz|tgz|tar\.xz|zip|qcow2)$/i.test(base))
    throw new ApiError(
      400,
      "INVALID_IMAGE_TYPE",
      "지원하지 않는 이미지 형식입니다.",
    );
  return base;
}
function validMagic(buffer) {
  return (
    (buffer[0] === 0x1f && buffer[1] === 0x8b) ||
    (buffer[0] === 0xfd && buffer[1] === 0x37 && buffer[2] === 0x7a) ||
    (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
    buffer.subarray(0, 4).toString("hex") === "514649fb" ||
    buffer.subarray(257, 262).toString() === "ustar"
  );
}
function uploadImage(req) {
  return new Promise((resolve, reject) => {
    let filename;
    try {
      filename = safeFileName(req.headers["x-file-name"]);
    } catch (e) {
      reject(e);
      return;
    }
    fs.mkdirSync(uploadDir, { recursive: true });
    const temp = path.join(uploadDir, `.upload-${crypto.randomUUID()}`),
      hash = crypto.createHash("sha256"),
      out = fs.createWriteStream(temp, { flags: "wx" });
    let size = 0,
      head = Buffer.alloc(0),
      done = false;
    const fail = (error) => {
      if (done) return;
      done = true;
      out.destroy();
      fs.rm(temp, { force: true }, () => reject(error));
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 512 * 1024 * 1024) {
        fail(
          new ApiError(
            413,
            "IMAGE_TOO_LARGE",
            "이미지 파일은 512MB 이하여야 합니다.",
          ),
        );
        req.destroy();
        return;
      }
      if (head.length < 512)
        head = Buffer.concat([head, chunk]).subarray(0, 512);
      hash.update(chunk);
      if (!done && !out.write(chunk))
        (req.pause(), out.once("drain", () => req.resume()));
    });
    req.on("end", () => {
      if (done) return;
      if (!size || !validMagic(head)) {
        fail(
          new ApiError(
            400,
            "INVALID_IMAGE_CONTENT",
            "파일 헤더 검사에 실패했습니다. 올바른 이미지인지 확인하세요.",
          ),
        );
        return;
      }
      out.end(() => {
        const digest = hash.digest("hex"),
          stored = `${digest.slice(0, 16)}-${filename}`,
          target = path.join(uploadDir, stored);
        fs.rename(temp, target, (error) => {
          if (error) {
            fail(error);
            return;
          }
          done = true;
          resolve({
            reference: `custom:${stored}`,
            name: filename,
            sizeBytes: size,
            sha256: digest,
            verified: true,
          });
        });
      });
    });
    req.on("error", fail);
    out.on("error", fail);
  });
}
function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname,
    filePath = path.resolve(root, `.${requested}`);
  if (
    pathname.startsWith("/uploads/") ||
    !filePath.startsWith(root) ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
  };
  res.writeHead(200, {
    "Content-Type": `${types[path.extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
  });
  fs.createReadStream(filePath).pipe(res);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/health") {
      await pool.query("SELECT 1");
      sendJson(res, 200, { ok: true, database: "postgresql" });
      return;
    }
    if (url.pathname === "/api/images" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        images: savedImages,
        refreshed: url.searchParams.get("refresh") === "1",
        autoRefreshMinutes: 60,
      });
      return;
    }
    if (url.pathname === "/api/images/upload" && req.method === "POST") {
      if (req.headers["content-type"] !== "application/octet-stream")
        throw new ApiError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "이미지는 application/octet-stream 형식이어야 합니다.",
        );
      sendJson(res, 201, { ok: true, image: await uploadImage(req) });
      return;
    }
    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      sendJson(res, 200, await getDashboard());
      return;
    }
    if (url.pathname === "/api/containers" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Content-Type은 application/json이어야 합니다.",
        );
      sendJson(res, 201, {
        ok: true,
        container: await createContainer(await readJsonBody(req)),
      });
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    if (error instanceof ApiError)
      sendError(res, error.status, error.code, error.message, error.fields);
    else {
      console.error(error);
      sendError(res, 503, "SERVER_ERROR", "요청을 처리하지 못했습니다.");
    }
  }
});
if (require.main === module)
  server.listen(PORT, () =>
    console.log(`LXC dashboard: http://localhost:${PORT}`),
  );
module.exports = {
  ApiError,
  createContainer,
  getDashboard,
  readJsonBody,
  server,
  validateContainerInput,
  validMagic,
  safeFileName,
};
