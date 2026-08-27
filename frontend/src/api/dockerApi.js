async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message || "Docker 요청에 실패했습니다.");
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

export function deleteContainer(id) {
  return request(`/api/containers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
