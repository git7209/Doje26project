import { deleteContainer, runContainerAction } from "../api/dockerApi.js";

const statusLabels = { running: "실행 중", stopped: "중지됨", paused: "일시 정지", error: "오류", dead: "오류" };

export default function ContainerSection({ containers, onChanged, notify, confirmDelete = true, confirmStop = true, requireNameConfirmation = false }) {
  async function runAction(container, action) {
    if (action === "delete" && confirmDelete && !window.confirm(`${container.name} 컨테이너를 삭제하시겠습니까?`)) return;
    if (action === "stop" && confirmStop && !window.confirm(`${container.name} 컨테이너를 중지하시겠습니까?`)) return;
    if (action === "delete" && requireNameConfirmation && window.prompt(`삭제하려면 ${container.name}을 입력하세요.`) !== container.name) return;
    try {
      if (action === "delete") await deleteContainer(container.id);
      else await runContainerAction(container.id, action);
      notify(`${container.name} 컨테이너 작업을 완료했습니다.`);
      await onChanged();
    } catch (error) { notify(error.message); }
  }

  return (
    <section className="resource-panel table-panel">
      <header className="panel-header">
        <div><h2>컨테이너</h2><p>로컬 Docker Engine에서 실행되는 컨테이너입니다.</p></div>
        <div className="panel-tools"><button type="button">필터</button><button type="button">⋮</button></div>
      </header>
      <div className="table-wrap">
        <table className="container-table">
          <thead><tr><th><input type="checkbox" aria-label="전체 선택" /></th><th>이름</th><th>상태</th><th>포트</th><th>CPU</th><th>메모리</th><th>작업</th></tr></thead>
          <tbody>
            {containers.length === 0 ? (
              <tr><td className="empty-container" colSpan="7"><span className="empty-cube">◇</span><strong>컨테이너가 없습니다</strong><small>오른쪽 위의 ‘컨테이너 생성’ 버튼으로 첫 컨테이너를 시작하세요.</small></td></tr>
            ) : containers.map((container) => {
              const running = container.status === "running";
              const paused = container.status === "paused";
              return <tr key={container.id}>
                <td><input type="checkbox" aria-label={`${container.name} 선택`} /></td>
                <td><div className="container-name"><span>▣</span><p><strong>{container.name}</strong><small>{container.image}</small></p></div></td>
                <td><span className={`status-pill ${container.status}`}><i />{statusLabels[container.status] || container.status}</span></td>
                <td>{container.ports || container.port || "—"}</td>
                <td>{Number(container.cpuPercent || 0).toFixed(1)}%</td>
                <td>{Number(container.memoryMb || 0).toFixed(0)} MB</td>
                <td><div className="container-actions">
                  {running ? <button type="button" title="중지" onClick={() => runAction(container, "stop")}>■</button> : !paused && <button type="button" title="시작" onClick={() => runAction(container, "start")}>▶</button>}
                  {(running || paused) && <button type="button" title="재시작" onClick={() => runAction(container, "restart")}>↻</button>}
                  <button type="button" className="danger" title="삭제" disabled={running || paused} onClick={() => runAction(container, "delete")}>⌫</button>
                </div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

