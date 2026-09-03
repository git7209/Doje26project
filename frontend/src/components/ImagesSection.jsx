import { useRef, useState } from "react";
import { uploadImage } from "../api/dockerApi.js";

const imageArtwork = {
  archlinux: "/assets/image-archlinux.png",
  debian: "/assets/image-debian.png",
  ubuntu: "/assets/image-ubuntu.png",
  nginx: "/assets/image-nginx.png",
  alpine: "/assets/image-alpine.png",
  httpd: "/assets/image-httpd.png",
};

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

export default function ImagesSection({ images, loading, onRefresh, notify, requestError }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true); setError("");
    try {
      await uploadImage(file); notify(`${file.name} 업로드 완료`); await onRefresh();
    } catch (uploadError) { setError(uploadError.message); }
    finally { setUploading(false); event.target.value = ""; }
  }

  return <div className="content images-content">
    <section className="page-heading">
      <div><h1>이미지</h1><p>컨테이너 생성에 사용할 로컬 이미지를 확인하고 관리합니다.</p></div>
      <div className="heading-actions">
        <button type="button" onClick={onRefresh} disabled={loading}>{loading ? "조회 중..." : "새로고침"}</button>
        <button type="button" className="primary" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? "업로드 중..." : "이미지 업로드"}</button>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".tar,.tar.gz,.tgz,.tar.xz,.zip,.qcow2" onChange={handleFile} />
      </div>
    </section>
    {(error || requestError) && <p className="dashboard-error" role="alert">{error || requestError}</p>}
    <section className="image-summary" aria-label="이미지 요약">
      <div><span>저장된 이미지</span><strong>{images.length}</strong><small>개</small></div>
    </section>
    <section className="images-panel">
      <header><div><h2>로컬 이미지</h2><p>Docker Engine에 저장된 이미지 목록입니다.</p></div><span>{images.length}개 표시</span></header>
      {images.length ? <div className="table-wrap"><table className="images-table">
        <thead><tr><th>이미지</th><th>태그</th><th>OS / 아키텍처</th><th>용량</th><th>생성일</th></tr></thead>
        <tbody>{images.map((image) => <tr key={image.reference}>
          <td><div className="image-identity">{imageArtwork[image.label]
            ? <img src={imageArtwork[image.label]} alt="" />
            : <span>{(image.label || "I").slice(0, 2).toUpperCase()}</span>}
            <p><strong>{image.label}</strong><small>{image.reference}</small></p></div></td>
          <td><span className="image-tag">{image.version || "latest"}</span></td><td>{image.os || "Linux"} / {image.arch || "-"}</td>
          <td>{Number(image.sizeMb || 0).toLocaleString()} MB</td><td>{formatDate(image.updatedAt)}</td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state"><strong>저장된 이미지가 없습니다.</strong><p>이미지를 업로드하면 이곳에 표시됩니다.</p></div>}
    </section>
  </div>;
}
