const friendlyErrors = {
  DOCKER_ENGINE_ERROR: "Docker가 실행 중인지 확인한 뒤 다시 시도해 주세요.",
  SERVER_ERROR: "서버에서 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  FRONTEND_NOT_BUILT: "화면 파일이 준비되지 않았습니다. 관리자에게 빌드를 요청해 주세요.",
  CONTAINER_NAME_CONFLICT: "같은 이름의 컨테이너가 이미 있습니다. 다른 이름을 사용해 주세요.",
  INVALID_CONTAINER_ID: "컨테이너 정보를 찾을 수 없습니다. 화면을 새로고침해 주세요.",
  INVALID_IMAGE_TYPE: "지원하지 않는 이미지 파일입니다. tar 또는 qcow2 파일을 사용해 주세요.",
  INVALID_IMAGE_CONTENT: "이미지 파일 내용을 확인할 수 없습니다. 정상적인 Docker 이미지 파일을 선택해 주세요.",
  IMAGE_TOO_LARGE: "이미지 파일이 너무 큽니다. 512MB 이하 파일을 사용해 주세요.",
  NETWORK_IN_USE: "사용 중인 네트워크는 삭제할 수 없습니다. 연결된 컨테이너를 먼저 분리해 주세요.",
  DEFAULT_NETWORK: "Docker 기본 네트워크는 삭제할 수 없습니다.",
  VOLUME_IN_USE: "사용 중인 볼륨은 삭제할 수 없습니다. 연결된 컨테이너를 먼저 확인해 주세요.",
  INVALID_JSON: "입력 내용을 읽지 못했습니다. 다시 입력해 주세요.",
  VALIDATION_FAILED: "입력한 내용을 확인해 주세요.",
  UNSUPPORTED_MEDIA_TYPE: "지원하지 않는 요청 형식입니다.",
  AUTH_REQUIRED: "로그인이 필요합니다.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않습니다.",
  EMAIL_ALREADY_EXISTS: "이미 가입된 이메일입니다.",
  DATABASE_UNAVAILABLE: "계정 데이터베이스에 연결할 수 없습니다. PostgreSQL 설정을 확인해 주세요.",
};

async function request(path, options) {
  const headers = { ...(options?.headers || {}) };
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(friendlyErrors[data.error?.code] || data.error?.message || "요청을 처리하지 못했습니다. 다시 시도해 주세요.");
  return data;
}

export function getDashboard() {
  return request("/api/dashboard");
}

export function getImages() {
  return request("/api/images");
}

export function getHealth() {
  return request("/api/health");
}

export function getNetworks() { return request("/api/networks"); }
export function createNetwork(input) {
  return request("/api/networks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function getNetwork(id) { return request(`/api/networks/${encodeURIComponent(id)}`); }
export function deleteNetwork(id) { return request(`/api/networks/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export function connectNetwork(networkId, containerId) {
  return request(`/api/networks/${encodeURIComponent(networkId)}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ containerId }),
  });
}
export function disconnectNetwork(networkId, containerId) {
  return request(`/api/networks/${encodeURIComponent(networkId)}/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ containerId }),
  });
}
export function getVolumes() { return request("/api/volumes"); }
export function createVolume(name) {
  return request("/api/volumes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}
export function deleteVolume(name) {
  return request(`/api/volumes/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function uploadImage(file) {
  return request("/api/images/upload", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });
}

export function createContainer(input) {
  return request("/api/containers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function runContainerAction(id, action) {
  return request(`/api/containers/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
  });
}

export function getAuthSession() {
  return request("/api/auth/session");
}

export function loginAccount(input) {
  return request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function createAccount(input) {
  return request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function logoutAccount() {
  return request("/api/auth/logout", { method: "POST" });
}

export function runTerminalCommand(id, command) {
  return request(`/api/containers/${encodeURIComponent(id)}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
}

export function deleteContainer(id) {
  return request(`/api/containers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
