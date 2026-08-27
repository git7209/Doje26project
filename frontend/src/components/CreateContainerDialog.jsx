import { useEffect, useRef, useState } from "react";
import { createContainer } from "../api/dockerApi.js";

const initialForm = {
  name: "",
  image: "",
  ports: "",
  cpuLimit: "0",
  memory: "0",
  memoryUnit: "MB",
};

export default function CreateContainerDialog({ images, onClose, onCreated }) {
  const dialogRef = useRef(null);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,9}[a-z0-9])?$/.test(form.name)) {
      setError("이름은 영문 소문자, 숫자, 하이픈으로 11자 이하이어야 합니다.");
      return;
    }
    if (!form.image) {
      setError("Docker 이미지를 선택하세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await createContainer({
        name: form.name,
        image: form.image,
        ports: form.ports.trim(),
        cpuLimit: Number(form.cpuLimit || 0),
        memoryMb: Number(form.memory || 0) * (form.memoryUnit === "GB" ? 1024 : 1),
      });
      await onCreated(form.name);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} onCancel={onClose}>
      <div className="dialog-card">
        <header>
          <div><h2>컨테이너 생성</h2><p>Docker Engine에 저장된 이미지를 선택해 설정합니다.</p></div>
          <button className="dialog-close" type="button" aria-label="닫기" onClick={onClose}>×</button>
        </header>
        <form noValidate onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="container-name">컨테이너 이름 <span>필수</span></label>
            <input id="container-name" name="name" maxLength="11" value={form.name} onChange={update} autoFocus />
            <small>영문 소문자, 숫자, 하이픈으로 11자 이하</small>
          </div>
          <div className="form-field">
            <label htmlFor="container-image">저장된 이미지 <span>필수</span></label>
            <select id="container-image" name="image" value={form.image} onChange={update}>
              <option value="">이미지를 선택하세요</option>
              {images.map((image) => (
                <option key={image.reference} value={image.reference}>
                  {image.label} · {image.version} ({image.sizeMb} MB)
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="container-ports">포트</label>
            <input id="container-ports" name="ports" value={form.ports} onChange={update} placeholder="8082:80" />
            <small>호스트 포트:컨테이너 포트</small>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="container-cpu">CPU 제한</label>
              <input id="container-cpu" name="cpuLimit" type="number" min="0" step="1" value={form.cpuLimit} onChange={update} />
            </div>
            <div className="form-field">
              <label htmlFor="container-memory">메모리 제한</label>
              <div className="input-with-unit">
                <input id="container-memory" name="memory" type="number" min="0" step="1" value={form.memory} onChange={update} />
                <select name="memoryUnit" value={form.memoryUnit} onChange={update}><option>MB</option><option>GB</option></select>
              </div>
            </div>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={onClose}>취소</button>
            <button className="primary" disabled={submitting}>{submitting ? "생성 중..." : "생성"}</button>
          </footer>
        </form>
      </div>
    </dialog>
  );
}
