const statusLabels = {
  running: "실행 중",
  stopped: "중지",
  paused: "일시 정지",
  error: "오류",
  dead: "오류",
};

export default function ContainerSection({ containers, onChanged, notify }) {
  async function runAction(container, action) {
    if (action === "delete" && !window.confirm(`${container.name} 컨테이너를 삭제하시겠습니까?`))
      return;
    try {
      if (action === "delete") await deleteContainer(container.id);
      else await runContainerAction(container.id, action);
      const labels = { start: "시작", stop: "중지", restart: "재시작", delete: "삭제" };
      notify(`${container.name} 컨테이너 ${labels[action]} 완료`);
      await onChanged();
    } catch (error) {
      notify(error.message);
    }
  }

  function actions(container) {
    const running = container.status === "running";
    const paused = container.status === "paused";
    return (
      <div className="container-actions">
        {running && <button type="button" onClick={() => runAction(container, "stop")}>중지</button>}
        {!running && !paused && <button type="button" onClick={() => runAction(container, "start")}>시작</button>}
        {(running || paused) && <button type="button" onClick={() => runAction(container, "restart")}>재시작</button>}
        <button type="button" className="danger" disabled={running || paused} onClick={() => runAction(container, "delete")}>삭제</button>
      </div>
    );
  }
  return (
    <section className="operations-grid">
      <article className="table-panel">
        <header><div><h2>컨테이너</h2><p>현재 컨테이너를 표시합니다.</p></div></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>이름</th><th>상태</th><th>CPU / 메모리</th><th>IP 주소</th><th>가동 시간</th><th>작업</th></tr></thead>
            <tbody>
              {containers.length === 0 ? (
                <tr><td colSpan="6"><strong>컨테이너 0개</strong></td></tr>
              ) : containers.map((container) => (
                <tr key={container.id}>
                  <td><strong>{container.name}</strong><small>{container.image}</small></td>
                  <td>{statusLabels[container.status] || container.status}</td>
                  <td>{Number(container.cpuPercent || 0)}% / {Number(container.memoryMb || 0)} MB</td>
                  <td>{container.ipAddress || "-"}</td>
                  <td>{container.uptime || "-"}</td>
                  <td>{actions(container)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
      <aside className="events-panel">
        <header><h2>최근 이벤트</h2><a href="#">로그 보기</a></header>
        <ol><li><time>현재</time><strong>작업 중</strong><span>이벤트 0개</span></li></ol>
      </aside>
    </section>
  );
}
import { deleteContainer, runContainerAction } from "../api/dockerApi.js";
