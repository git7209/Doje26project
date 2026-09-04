import { useMemo, useState } from "react";
import { deleteContainer, runContainerAction } from "../api/dockerApi.js";

const statusLabels = { running: "실행 중", stopped: "중지됨", paused: "일시 정지", error: "오류", dead: "오류" };

export default function ContainerSection({ containers = [], loading = false, onChanged, notify, confirmDelete = true, confirmStop = true, requireNameConfirmation = false }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [workingIds, setWorkingIds] = useState(() => new Set());
  const statusCounts = {
    all: containers.length,
    running: containers.filter((item) => item.status === "running").length,
    stopped: containers.filter((item) => item.status === "stopped").length,
    paused: containers.filter((item) => item.status === "paused").length,
    error: containers.filter((item) => item.status === "error" || item.status === "dead").length,
  };
  const filters = [
    ["all", "전체"],
    ["running", "실행 중"],
    ["stopped", "중지됨"],
    ["paused", "일시 정지"],
    ["error", "오류"],
  ];
  const visibleContainers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return containers.filter((container) => {
      const matchesQuery = !normalizedQuery || [container.name, container.image, container.ports, container.port]
        .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      const matchesStatus = statusFilter === "all"
        || container.status === statusFilter
        || (statusFilter === "error" && container.status === "dead");
      return matchesQuery && matchesStatus;
    });
  }, [containers, query, statusFilter]);

  async function runAction(container, action) {
    if (workingIds.has(container.id)) return;
    if (action === "delete" && confirmDelete && !window.confirm(`${container.name} 컨테이너를 삭제하시겠습니까?`)) return;
    if (action === "stop" && confirmStop && !window.confirm(`${container.name} 컨테이너를 중지하시겠습니까?`)) return;
    if (action === "delete" && requireNameConfirmation && window.prompt(`삭제하려면 ${container.name}을 입력하세요.`) !== container.name) return;
    setWorkingIds((current) => new Set(current).add(container.id));
    try {
      if (action === "delete") await deleteContainer(container.id);
      else await runContainerAction(container.id, action);
      notify(`${container.name} 컨테이너 작업을 완료했습니다.`);
      await onChanged();
    } catch (error) { notify(error.message); }
    finally {
      setWorkingIds((current) => {
        const next = new Set(current);
        next.delete(container.id);
        return next;
      });
    }
  }

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
  }

  return (
    <section className="resource-panel table-panel">
      <header className="panel-header">
        <div><h2>컨테이너 관리</h2><p>로컬 Docker Engine의 컨테이너를 검색하고 직접 제어합니다.</p></div>
        <span className="panel-result-count" aria-live="polite">{visibleContainers.length}개 표시</span>
      </header>
      <div className="container-toolbar">
        <label className="container-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 이미지 또는 포트 검색" aria-label="컨테이너 검색" />
        </label>
        <div className="status-filters" role="group" aria-label="컨테이너 상태 필터">
          {filters.map(([id, label]) => (
            <button type="button" className={statusFilter === id ? "active" : ""} key={id} onClick={() => setStatusFilter(id)} aria-pressed={statusFilter === id}>
              {label}<span>{statusCounts[id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap" role="region" aria-label="컨테이너 목록" aria-busy={loading} tabIndex={0}>
        <table className="container-table">
          <thead><tr><th>이름</th><th>상태</th><th>포트</th><th>CPU</th><th>메모리</th><th>작업</th></tr></thead>
          <tbody>
            {visibleContainers.length === 0 ? (
              <tr><td className="empty-container" colSpan="6"><span className={loading ? "loading-spinner" : "empty-cube"} aria-hidden="true">{loading ? "" : "◇"}</span><strong>{loading ? "컨테이너를 불러오는 중입니다" : containers.length ? "조건에 맞는 컨테이너가 없습니다" : "컨테이너가 없습니다"}</strong><small>{loading ? "Docker Engine의 응답을 기다리고 있습니다." : containers.length ? "검색어나 상태 필터를 변경해 보세요." : "오른쪽 위의 ‘컨테이너 생성’ 버튼으로 첫 컨테이너를 시작하세요."}</small>{!loading && containers.length > 0 && <button type="button" onClick={clearFilters}>필터 초기화</button>}</td></tr>
            ) : visibleContainers.map((container) => {
              const running = container.status === "running";
              const paused = container.status === "paused";
              const working = workingIds.has(container.id);
              return <tr key={container.id}>
                <td><div className="container-name"><span>▣</span><p><strong>{container.name}</strong><small>{container.image}</small></p></div></td>
                <td><span className={`status-pill ${container.status}`}><i />{statusLabels[container.status] || container.status}</span></td>
                <td>{container.ports || container.port || "—"}</td>
                <td>{Number(container.cpuPercent || 0).toFixed(1)}%</td>
                <td>{Number(container.memoryMb || 0).toFixed(0)} MB</td>
                <td><div className="container-actions">
                  {running ? <button type="button" title="중지" aria-label={`${container.name} 중지`} disabled={working} onClick={() => runAction(container, "stop")}>■</button> : !paused && <button type="button" title="시작" aria-label={`${container.name} 시작`} disabled={working} onClick={() => runAction(container, "start")}>▶</button>}
                  {(running || paused) && <button type="button" title="재시작" aria-label={`${container.name} 재시작`} disabled={working} onClick={() => runAction(container, "restart")}>↻</button>}
                  <button type="button" className="danger" title={running || paused ? "실행 중인 컨테이너는 먼저 중지하세요" : "삭제"} aria-label={`${container.name} 삭제`} disabled={running || paused || working} onClick={() => runAction(container, "delete")}>⌫</button>
                </div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

