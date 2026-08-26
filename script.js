const $ = (selector) => document.querySelector(selector);
const sidebar = $("#sidebar");
const resizer = $("#sidebar-resizer");
const reopen = $("#sidebar-reopen");
const edge = $("#sidebar-edge");
const refreshButton = $("#refresh-button");
const dialog = $("#create-container-dialog");
const form = $("#create-container-form");
const fields = {
  name: $("#container-name"),
  image: $("#container-image"),
  file: $("#custom-image-file"),
  ports: $("#container-ports"),
  cpuLimit: $("#container-cpu-limit"),
  memoryLimit: $("#container-memory-limit"),
  memoryUnit: $("#container-memory-unit"),
};
const errors = {
  name: $("#container-name-error"),
  image: $("#container-image-error"),
  ports: $("#container-ports-error"),
  cpuLimit: $("#container-cpu-error"),
  memoryMb: $("#container-memory-error"),
};
let images = [];
let uploadedImage = null;
let notificationTimer;

function notify(message) {
  clearTimeout(notificationTimer);
  const box = $("#app-notification");
  box.textContent = message;
  box.hidden = false;
  notificationTimer = setTimeout(() => (box.hidden = true), 4000);
}
function setSidebarWidth(width) {
  const bounded = Math.min(360, Math.max(170, width));
  document.documentElement.style.setProperty("--sidebar-width", `${bounded}px`);
  localStorage.setItem("lxc-sidebar-width", bounded);
  return bounded;
}
function hideSidebar() {
  document.body.classList.add("sidebar-hidden");
  reopen.hidden = true;
  localStorage.setItem("lxc-sidebar-hidden", "true");
}
function showSidebar() {
  document.body.classList.remove("sidebar-hidden");
  reopen.hidden = true;
  localStorage.setItem("lxc-sidebar-hidden", "false");
}
setSidebarWidth(Number(localStorage.getItem("lxc-sidebar-width")) || 228);
if (localStorage.getItem("lxc-sidebar-hidden") === "true") hideSidebar();
resizer.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  resizer.setPointerCapture(event.pointerId);
  document.body.style.userSelect = "none";
});
resizer.addEventListener("pointermove", (event) => {
  if (!resizer.hasPointerCapture(event.pointerId)) return;
  if (event.clientX < 150) {
    hideSidebar();
    resizer.releasePointerCapture(event.pointerId);
  } else setSidebarWidth(event.clientX);
});
resizer.addEventListener("pointerup", (event) => {
  if (resizer.hasPointerCapture(event.pointerId))
    resizer.releasePointerCapture(event.pointerId);
  document.body.style.userSelect = "";
});
edge.addEventListener("mouseenter", () => {
  if (document.body.classList.contains("sidebar-hidden")) reopen.hidden = false;
});
reopen.addEventListener("click", showSidebar);
reopen.addEventListener("mouseleave", () => {
  if (document.body.classList.contains("sidebar-hidden")) reopen.hidden = true;
});

function clearErrors() {
  Object.values(errors).forEach((e) => (e.textContent = ""));
  $("#create-form-error").textContent = "";
}
function sourceMode() {
  return form.elements.imageSource.value;
}
function toggleImageSource() {
  const custom = sourceMode() === "custom";
  $("#saved-image-field").hidden = custom;
  $("#custom-image-field").hidden = !custom;
  errors.image.textContent = "";
}
form.elements.imageSource.forEach((r) =>
  r.addEventListener("change", toggleImageSource),
);

function renderImages() {
  fields.image.replaceChildren(new Option("이미지를 선택하세요", ""));
  images.forEach((img) => {
    const option = new Option(`${img.label} · ${img.version}`, img.reference);
    option.dataset.detail = `${img.os} / ${img.arch} / ${img.sizeMb} MB / 갱신 ${new Date(img.updatedAt).toLocaleDateString("ko-KR")}`;
    fields.image.add(option);
  });
}
fields.image.addEventListener("change", () => {
  $("#image-detail").textContent =
    fields.image.selectedOptions[0]?.dataset.detail ||
    "이미지를 선택하면 세부 정보가 표시됩니다.";
});
async function loadImages() {
  try {
    const response = await fetch("/api/images", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error?.message || "이미지를 불러오지 못했습니다.");
    images = data.images || [];
    renderImages();
  } catch (error) {
    errors.image.textContent = error.message;
  }
}

function extensionAllowed(name) {
  return /\.(tar|tar\.gz|tgz|tar\.xz|zip|qcow2)$/i.test(name);
}
async function inspectFile(file) {
  uploadedImage = null;
  const status = $("#custom-image-status");
  if (!file) {
    status.textContent = "";
    return;
  }
  if (file.size > 512 * 1024 * 1024)
    throw new Error("파일은 512MB 이하여야 합니다.");
  if (!extensionAllowed(file.name))
    throw new Error("지원하지 않는 이미지 형식입니다.");
  const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const valid =
    (bytes[0] === 0x1f && bytes[1] === 0x8b) ||
    (bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    String.fromCharCode(...bytes.slice(0, 4)) === "QFI\xfb" ||
    (bytes.length > 262 &&
      String.fromCharCode(...bytes.slice(257, 262)) === "ustar");
  if (!valid)
    throw new Error(
      "파일 헤더를 확인할 수 없습니다. 올바른 컨테이너 이미지인지 확인하세요.",
    );
  status.textContent = `검사 완료: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
}
fields.file.addEventListener("change", async () => {
  errors.image.textContent = "";
  try {
    await inspectFile(fields.file.files[0]);
  } catch (error) {
    fields.file.value = "";
    $("#custom-image-status").textContent = "";
    errors.image.textContent = error.message;
  }
});
async function uploadCustomImage() {
  const file = fields.file.files[0];
  if (!file) throw new Error("커스텀 이미지 파일을 선택하세요.");
  const response = await fetch("/api/images/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message || "이미지 업로드에 실패했습니다.");
  uploadedImage = data.image.reference;
  return uploadedImage;
}

function intValue(input, label) {
  if (!input.value) return 0;
  const n = Number(input.value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error(`${label}은 0 이상의 정수여야 합니다.`);
  return n;
}
async function submit(event) {
  event.preventDefault();
  clearErrors();
  const name = fields.name.value.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,9}[a-z0-9])?$/.test(name)) {
    errors.name.textContent =
      "영문 소문자, 숫자, 하이픈으로 11자 이하이며 하이픈으로 시작하거나 끝날 수 없습니다.";
    return;
  }
  let image = fields.image.value;
  try {
    if (sourceMode() === "custom") image = await uploadCustomImage();
    if (!image) {
      errors.image.textContent = "이미지를 선택하세요.";
      return;
    }
    const payload = {
      name,
      image,
      ports: fields.ports.value.trim(),
      cpuLimit: intValue(fields.cpuLimit, "CPU 제한"),
      memoryMb:
        intValue(fields.memoryLimit, "메모리 제한") *
        (fields.memoryUnit.value === "GB" ? 1024 : 1),
    };
    $("#submit-create-container").disabled = true;
    const response = await fetch("/api/containers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(data.error?.message || "생성 요청에 실패했습니다."),
        { fields: data.error?.fields },
      );
    form.reset();
    toggleImageSource();
    dialog.close();
    notify("컨테이너 생성 요청을 저장했습니다.");
    refreshDashboard();
  } catch (error) {
    if (error.fields)
      Object.entries(error.fields).forEach(([key, value]) => {
        if (errors[key]) errors[key].textContent = value;
      });
    else $("#create-form-error").textContent = error.message;
  } finally {
    $("#submit-create-container").disabled = false;
  }
}
form.addEventListener("submit", submit);
$("#open-create-dialog").addEventListener("click", () => {
  clearErrors();
  dialog.showModal();
  fields.name.focus();
});
$("#close-create-dialog").addEventListener("click", () => dialog.close());
$("#cancel-create-dialog").addEventListener("click", () => dialog.close());

function statusLabel(status) {
  return (
    { running: "실행 중", stopped: "중지", paused: "일시 정지", error: "오류" }[
      status
    ] || "확인 중"
  );
}
function renderDashboard(data) {
  const list = $("#container-list");
  const containers = data.containers || [],
    summary = data.summary || {};
  ["total", "running", "stopped", "errors"].forEach((k) => {
    const el = $(`#container-${k}`);
    if (el) el.textContent = summary[k] || 0;
  });
  $("#sidebar-container-total").textContent = summary.total || 0;
  if (!containers.length) {
    list.innerHTML =
      '<tr><td colspan="5"><strong>컨테이너 0개</strong><small>등록된 컨테이너가 없습니다.</small></td></tr>';
    return;
  }
  list.replaceChildren(
    ...containers.map((c) => {
      const row = document.createElement("tr");
      [
        c.name,
        statusLabel(c.status),
        `${Number(c.cpuPercent || 0)}% / ${Number(c.memoryMb || 0)} MB`,
        c.ipAddress || "-",
        c.uptime || "-",
      ].forEach((v, i) => {
        const cell = document.createElement("td");
        if (i === 0) {
          const strong = document.createElement("strong");
          strong.textContent = v;
          const small = document.createElement("small");
          small.textContent = c.image;
          cell.append(strong, small);
        } else cell.textContent = v;
        row.append(cell);
      });
      return row;
    }),
  );
}
async function refreshDashboard() {
  refreshButton.disabled = true;
  refreshButton.textContent = "조회 중...";
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error();
    renderDashboard(data);
    $("#system-status").textContent = "시스템 실행 중";
    $("#last-checked").textContent =
      `마지막 확인 ${new Date().toLocaleTimeString("ko-KR")}`;
  } catch {
    $("#system-status").textContent = "조회 실패";
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "새로고침";
  }
}
refreshButton.addEventListener("click", refreshDashboard);
loadImages();
refreshDashboard();
