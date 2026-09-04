const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
require("dotenv").config();
const { Pool } = require("pg");
const { DockerEngine, DockerEngineError } = require("./docker-engine");
const PORT = Number(process.env.PORT || 8081),
  HOST = process.env.HOST || "127.0.0.1",
  root = __dirname,
  staticRoot = path.join(root, "frontend", "dist"),
  uploadDir = path.join(root, "uploads", "images"),
  pool = new Pool(),
  docker = new DockerEngine();
const SESSION_COOKIE = "lxc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
let authSchemaPromise;
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
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
function ensureAuthSchema(database = pool) {
  if (!authSchemaPromise) {
    authSchemaPromise = database.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
      CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);
    `).catch((error) => {
      authSchemaPromise = null;
      throw error;
    });
  }
  return authSchemaPromise;
}
function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError(400, "VALIDATION_FAILED", "올바른 이메일 주소를 입력하세요.", { email: "이메일 형식을 확인하세요." });
  return email;
}
function validateDisplayName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 2 || name.length > 40)
    throw new ApiError(400, "VALIDATION_FAILED", "이름은 2자 이상 40자 이하로 입력하세요.", { name: "이름은 2~40자여야 합니다." });
  return name;
}
function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128 || Buffer.byteLength(value) > 256)
    throw new ApiError(400, "VALIDATION_FAILED", "비밀번호는 8자 이상 128자 이하로 입력하세요.", { password: "비밀번호는 8~128자여야 합니다." });
  return value;
}
function scryptPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptPassword(password, salt);
  return { salt, hash: hash.toString("hex") };
}
async function verifyPassword(password, salt, expectedHex) {
  const actual = await scryptPassword(password, salt);
  const expected = Buffer.from(expectedHex || "", "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}
function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function sessionCookie(token, maxAge = SESSION_MAX_AGE_SECONDS) {
  const secure = process.env.AUTH_COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
async function createSession(userId, database = pool) {
  const token = crypto.randomBytes(32).toString("base64url");
  await database.query("DELETE FROM user_sessions WHERE expires_at<=NOW()");
  await database.query(
    "INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW() + INTERVAL '7 days')",
    [sessionTokenHash(token), userId],
  );
  return token;
}
async function authenticatedUser(req, database = pool) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await database.query(
    `SELECT u.id,u.display_name AS "name",u.email
       FROM user_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW()`,
    [sessionTokenHash(token)],
  );
  return result.rows[0] || null;
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
            "?붿껌 蹂몃Ц? 16KB ?댄븯?ъ빞 ?⑸땲??",
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
          new ApiError(400, "INVALID_JSON", "?щ컮瑜?JSON ?붿껌???꾨떃?덈떎."),
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
    memoryMb = input?.memoryMb ?? 0,
    volumeMounts = Array.isArray(input?.volumeMounts) ? input.volumeMounts : [];
  if (!/^[a-z0-9](?:[a-z0-9-]{0,9}[a-z0-9])?$/.test(name))
    fields.name = "?대쫫 ?뺤떇???뺤씤?섏꽭??";
  if (!image || image.length > 255)
    fields.image = "?щ컮瑜??대?吏瑜??좏깮?섏꽭??";
  if (ports.length > 255) fields.ports = "?ы듃 ?뺣낫??255???댄븯?ъ빞 ?⑸땲??";
  if (!Number.isSafeInteger(cpuLimit) || cpuLimit < 0)
    fields.cpuLimit = "CPU ?쒗븳? 0 ?댁긽???뺤닔?ъ빞 ?⑸땲??";
  if (!Number.isSafeInteger(memoryMb) || memoryMb < 0 || memoryMb > 2147483647)
    fields.memoryMb = "硫붾え由??쒗븳 媛믪쓣 ?뺤씤?섏꽭??";
  if (volumeMounts.length > 8)
    fields.volumeMounts = "蹂쇰ⅷ? 理쒕? 8媛쒓퉴吏 ?곌껐?????덉뒿?덈떎.";
  const normalizedMounts = volumeMounts.map((mount) => ({
    volume: typeof mount?.volume === "string" ? mount.volume.trim() : "",
    target: typeof mount?.target === "string" ? mount.target.trim() : "",
    readOnly: Boolean(mount?.readOnly),
  }));
  if (normalizedMounts.some((mount) =>
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(mount.volume) ||
    !/^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^:\0]+$/.test(mount.target)
  )) fields.volumeMounts = "蹂쇰ⅷ ?대쫫怨??덈? 留덉슫??寃쎈줈瑜??뺤씤?섏꽭??";
  if (Object.keys(fields).length)
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "?낅젰媛믪쓣 ?뺤씤?섏꽭??",
      fields,
    );
  return { name, image, ports, cpuLimit, memoryMb, volumeMounts: normalizedMounts };
}
function validateVolumeName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name))
    throw new ApiError(
      400,
      "INVALID_VOLUME_NAME",
      "蹂쇰ⅷ ?대쫫? ?곷Ц, ?レ옄, ?? 諛묒쨪, ?섏씠?덈쭔 ?ъ슜?????덉뒿?덈떎.",
      { name: "?щ컮瑜?蹂쇰ⅷ ?대쫫???낅젰?섏꽭??" },
    );
  return name;
}
function validateNetworkName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name))
    throw new ApiError(
      400,
      "INVALID_NETWORK_NAME",
      "?ㅽ듃?뚰겕 ?대쫫? ?곷Ц, ?レ옄, ?? 諛묒쨪, ?섏씠?덈쭔 ?ъ슜?????덉뒿?덈떎.",
      { name: "1~63?먯쓽 ?щ컮瑜??ㅽ듃?뚰겕 ?대쫫???낅젰?섏꽭??" },
    );
  return name;
}
function validateNetworkId(value) {
  if (!/^[a-fA-F0-9]{12,64}$/.test(value || ""))
    throw new ApiError(400, "INVALID_NETWORK_ID", "?щ컮瑜댁? ?딆? ?ㅽ듃?뚰겕 ID?낅땲??");
  return value;
}
function validateContainerId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value || ""))
    throw new ApiError(400, "INVALID_CONTAINER_ID", "?щ컮瑜댁? ?딆? 而⑦뀒?대꼫 ID?낅땲??");
  return value;
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
        "?대? ?ъ슜 以묒씤 而⑦뀒?대꼫 ?대쫫?낅땲??",
        { name: "?대? ?ъ슜 以묒씤 ?대쫫?낅땲??" },
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
async function getDockerDashboard(engine = docker) {
  const containers = await engine.listContainers();
  return {
    ok: true,
    runtime: "docker",
    containers,
    summary: {
      total: containers.length,
      running: containers.filter((x) => x.status === "running").length,
      stopped: containers.filter((x) => x.status === "stopped").length,
      paused: containers.filter((x) => x.status === "paused").length,
      errors: containers.filter((x) => x.status === "error" || x.status === "dead").length,
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
      "吏?먰븯吏 ?딅뒗 ?대?吏 ?뺤떇?낅땲??",
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
            "?대?吏 ?뚯씪? 512MB ?댄븯?ъ빞 ?⑸땲??",
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
            "?뚯씪 ?ㅻ뜑 寃?ъ뿉 ?ㅽ뙣?덉뒿?덈떎. ?щ컮瑜??대?吏?몄? ?뺤씤?섏꽭??",
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
  if (!fs.existsSync(staticRoot)) {
    sendError(res, 503, "FRONTEND_NOT_BUILT", "React ?붾㈃??癒쇱? 鍮뚮뱶?섏꽭?? npm run build");
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname,
    filePath = path.resolve(staticRoot, `.${requested}`);
  if (
    pathname.startsWith("/uploads/") ||
    !filePath.startsWith(staticRoot) ||
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
    ".svg": "image/svg+xml",
  };
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": `${types[path.extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
    "Content-Length": content.length,
  });
  res.end(content);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/auth/signup" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type은 application/json이어야 합니다.");
      await ensureAuthSchema();
      const body = await readJsonBody(req);
      const name = validateDisplayName(body?.name);
      const email = normalizeEmail(body?.email);
      const password = validatePassword(body?.password);
      const passwordData = await hashPassword(password);
      let user;
      try {
        const result = await pool.query(
          `INSERT INTO users (display_name,email,password_hash,password_salt)
           VALUES ($1,$2,$3,$4) RETURNING id,display_name AS "name",email`,
          [name, email, passwordData.hash, passwordData.salt],
        );
        user = result.rows[0];
      } catch (error) {
        if (error.code === "23505")
          throw new ApiError(409, "EMAIL_ALREADY_EXISTS", "이미 가입된 이메일입니다.");
        throw error;
      }
      const token = await createSession(user.id);
      sendJson(res, 201, { ok: true, user }, { "Set-Cookie": sessionCookie(token) });
      return;
    }
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type은 application/json이어야 합니다.");
      await ensureAuthSchema();
      const body = await readJsonBody(req);
      const email = normalizeEmail(body?.email);
      const password = validatePassword(body?.password);
      const result = await pool.query(
        `SELECT id,display_name AS "name",email,password_hash,password_salt
           FROM users WHERE LOWER(email)=$1`,
        [email],
      );
      const account = result.rows[0];
      if (!account) {
        await scryptPassword(password, "00000000000000000000000000000000");
        throw new ApiError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.");
      }
      if (!(await verifyPassword(password, account.password_salt, account.password_hash)))
        throw new ApiError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.");
      const token = await createSession(account.id);
      const user = { id: account.id, name: account.name, email: account.email };
      sendJson(res, 200, { ok: true, user }, { "Set-Cookie": sessionCookie(token) });
      return;
    }
    if (url.pathname === "/api/auth/session" && req.method === "GET") {
      await ensureAuthSchema();
      const user = await authenticatedUser(req);
      sendJson(res, 200, { ok: true, user });
      return;
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      await ensureAuthSchema();
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) await pool.query("DELETE FROM user_sessions WHERE token_hash=$1", [sessionTokenHash(token)]);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
      return;
    }
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health") {
      await ensureAuthSchema();
      const user = await authenticatedUser(req);
      if (!user) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      req.user = user;
    }
    if (url.pathname === "/api/health") {
      await docker.ping();
      sendJson(res, 200, { ok: true, runtime: "docker" });
      return;
    }
    if (url.pathname === "/api/images" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        images: await docker.listImages(),
        refreshed: url.searchParams.get("refresh") === "1",
        autoRefreshMinutes: 5,
      });
      return;
    }
    if (url.pathname === "/api/images/upload" && req.method === "POST") {
      if (req.headers["content-type"] !== "application/octet-stream")
        throw new ApiError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "?대?吏??application/octet-stream ?뺤떇?댁뼱???⑸땲??",
        );
      sendJson(res, 201, { ok: true, image: await uploadImage(req) });
      return;
    }
    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      sendJson(res, 200, await getDockerDashboard());
      return;
    }
    if (url.pathname === "/api/networks" && req.method === "GET") {
      sendJson(res, 200, { ok: true, networks: await docker.listNetworks() });
      return;
    }
    if (url.pathname === "/api/networks" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type? application/json?댁뼱???⑸땲??");
      const body = await readJsonBody(req);
      const name = validateNetworkName(body?.name);
      const driver = typeof body?.driver === "string" ? body.driver.trim() : "bridge";
      if (!["bridge", "overlay", "macvlan"].includes(driver))
        throw new ApiError(400, "UNSUPPORTED_NETWORK_DRIVER", "吏?먰븯???ㅽ듃?뚰겕 ?쒕씪?대쾭??bridge, overlay, macvlan?낅땲??");
      sendJson(res, 201, { ok: true, network: await docker.createNetwork({ name, driver, internal: Boolean(body?.internal) }) });
      return;
    }
    const networkMatch = url.pathname.match(/^\/api\/networks\/([^/]+)$/);
    if (networkMatch && req.method === "GET") {
      sendJson(res, 200, { ok: true, network: await docker.inspectNetwork(validateNetworkId(decodeURIComponent(networkMatch[1]))) });
      return;
    }
    if (networkMatch && req.method === "DELETE") {
      const id = validateNetworkId(decodeURIComponent(networkMatch[1]));
      const network = await docker.inspectNetwork(id);
      if (["bridge", "host", "none"].includes(network.name))
        throw new ApiError(409, "DEFAULT_NETWORK", "Docker 湲곕낯 ?ㅽ듃?뚰겕????젣?????놁뒿?덈떎.");
      if (network.containers.length)
        throw new ApiError(409, "NETWORK_IN_USE", "而⑦뀒?대꼫媛 ?곌껐???ㅽ듃?뚰겕????젣?????놁뒿?덈떎.");
      sendJson(res, 200, { ok: true, result: await docker.removeNetwork(id) });
      return;
    }
    const networkActionMatch = url.pathname.match(/^\/api\/networks\/([^/]+)\/(connect|disconnect)$/);
    if (networkActionMatch && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type? application/json?댁뼱???⑸땲??");
      const networkId = validateNetworkId(decodeURIComponent(networkActionMatch[1]));
      const body = await readJsonBody(req);
      const containerId = validateContainerId(typeof body?.containerId === "string" ? body.containerId.trim() : "");
      const action = networkActionMatch[2] === "connect" ? "connectNetwork" : "disconnectNetwork";
      sendJson(res, 200, { ok: true, result: await docker[action](networkId, containerId) });
      return;
    }
    if (url.pathname === "/api/volumes" && req.method === "GET") {
      sendJson(res, 200, { ok: true, volumes: await docker.listVolumes() });
      return;
    }
    if (url.pathname === "/api/volumes" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type? application/json?댁뼱???⑸땲??");
      const body = await readJsonBody(req);
      const input = { name: validateVolumeName(body?.name), driver: "local" };
      sendJson(res, 201, { ok: true, volume: await docker.createVolume(input) });
      return;
    }
    const volumeDeleteMatch = url.pathname.match(/^\/api\/volumes\/([^/]+)$/);
    if (volumeDeleteMatch && req.method === "DELETE") {
      const name = validateVolumeName(decodeURIComponent(volumeDeleteMatch[1]));
      sendJson(res, 200, { ok: true, result: await docker.removeVolume(name) });
      return;
    }
    if (url.pathname === "/api/containers" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Content-Type? application/json?댁뼱???⑸땲??",
        );
      const input = validateContainerInput(await readJsonBody(req));
      sendJson(res, 201, { ok: true, container: await docker.createContainer(input) });
      return;
    }
    const actionMatch = url.pathname.match(
      /^\/api\/containers\/([^/]+)\/(start|stop|restart)$/,
    );
    if (actionMatch && req.method === "POST") {
      const id = validateContainerId(decodeURIComponent(actionMatch[1]));
      sendJson(res, 200, {
        ok: true,
        result: await docker.containerAction(id, actionMatch[2]),
      });
      return;
    }
    const terminalMatch = url.pathname.match(/^\/api\/containers\/([^/]+)\/exec$/);
    if (terminalMatch && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type은 application/json이어야 합니다.");
      const id = validateContainerId(decodeURIComponent(terminalMatch[1]));
      const body = await readJsonBody(req);
      const command = typeof body?.command === "string" ? body.command.trim() : "";
      if (!command || command.length > 1000)
        throw new ApiError(400, "VALIDATION_FAILED", "명령어는 1자 이상 1000자 이하로 입력하세요.");
      sendJson(res, 200, { ok: true, ...(await docker.execCommand(id, command)) });
      return;
    }
    const deleteMatch = url.pathname.match(/^\/api\/containers\/([^/]+)$/);
    if (deleteMatch && req.method === "DELETE") {
      const id = validateContainerId(decodeURIComponent(deleteMatch[1]));
      sendJson(res, 200, {
        ok: true,
        result: await docker.removeContainer(id),
      });
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    if (error instanceof ApiError)
      sendError(res, error.status, error.code, error.message, error.fields);
    else if (error instanceof DockerEngineError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 503;
      sendError(res, status, "DOCKER_ENGINE_ERROR", error.message);
    }
    else if (["28P01", "3D000", "ECONNREFUSED"].includes(error.code))
      sendError(res, 503, "DATABASE_UNAVAILABLE", "계정 데이터베이스에 연결할 수 없습니다. PostgreSQL 설정을 확인하세요.");
    else {
      console.error(error);
      sendError(res, 503, "SERVER_ERROR", "?붿껌??泥섎━?섏? 紐삵뻽?듬땲??");
    }
  }
});
if (require.main === module)
  server.listen(PORT, HOST, () =>
    console.log(`LXC dashboard: http://${HOST}:${PORT}`),
  );
module.exports = {
  ApiError,
  createContainer,
  getDashboard,
  getDockerDashboard,
  readJsonBody,
  server,
  validateContainerInput,
  validateContainerId,
  validateVolumeName,
  validMagic,
  safeFileName,
  normalizeEmail,
  validateDisplayName,
  validatePassword,
  hashPassword,
  verifyPassword,
  sessionTokenHash,
};


