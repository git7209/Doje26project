import DashboardMetrics from "./DashboardMetrics.jsx";

const statusLabels = {
  running: "실행 중",
  stopped: "중지됨",
  paused: "일시 정지",
  error: "오류",
  dead: "오류",
};

const ShortcutIcon = ({ children }) => <span className="shortcut-icon" aria-hidden="true">{children}</span>;

export default function HomeOverview({
  dashboard,
  images,
  networks,
  volumes,
  runtime,
  lastChecked,
  loading,
  error,
  onRefresh,
  onCreate,
  onNavigate,
}) {
  const containers = dashboard?.containers || [];
  const summary = dashboard?.summary || {};
  const visibleContainers = containers.slice(0, 4);
  const initialLoading = loading && lastChecked === "확인 전";
  const customNetworkCount = (networks || []).filter((item) => !["bridge", "host", "none"].includes(item.name)).length;
  const inventory = [
    { id: "images", label: "이미지", value: images?.length || 0, detail: "컨테이너 생성 소스", icon: "◇" },
    { id: "storage", label: "볼륨", value: volumes?.length || 0, detail: "영구 데이터 저장소", icon: "▱" },
    { id: "networks", label: "네트워크", value: customNetworkCount, detail: "사용자 정의 네트워크", icon: "⌘" },
  ];

  return (
    <div className="content desktop-content home-overview">
      <section className="desktop-heading home-heading">
        <div>
          <span className="eyebrow">WORKSPACE OVERVIEW</span>
          <h1>홈</h1>
          <p>Docker 환경의 상태와 핵심 리소스를 빠르게 확인하세요.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="refresh-button" onClick={onRefresh} disabled={loading}>↻ {loading ? "새로 고치는 중" : "새로 고침"}</button>
          <button type="button" className="primary create-button" onClick={onCreate}>＋ 컨테이너 생성</button>
        </div>
      </section>

      {error && <p className="dashboard-error" role="alert"><strong>Docker Engine에 연결할 수 없습니다.</strong><span>{error}</span></p>}

      <section className="runtime-strip" aria-label="Docker Engine 상태">
        <div><i className={error ? "error" : initialLoading ? "checking" : ""} /><span><strong>{initialLoading ? "Engine checking" : error ? "Connection issue" : "Engine running"}</strong><small>{error ? "Docker Engine 연결 상태를 확인하세요" : `Docker Engine · ${runtime}`}</small></span></div>
        <p>{initialLoading ? "상태를 확인하는 중" : `마지막 확인 ${lastChecked}`}</p>
      </section>

      <DashboardMetrics dashboard={dashboard} loading={initialLoading} />

      <section className="home-overview-grid" aria-label="빠른 작업과 리소스 현황">
        <article className="home-card quick-actions-card">
          <header><div><h2>빠른 작업</h2><p>자주 사용하는 관리 화면으로 바로 이동합니다.</p></div></header>
          <div className="quick-action-list">
            <button type="button" className="quick-action primary-quick-action" onClick={onCreate}>
              <ShortcutIcon>＋</ShortcutIcon><span><strong>새 컨테이너</strong><small>이미지와 리소스를 선택해 생성</small></span><b aria-hidden="true">›</b>
            </button>
            <button type="button" className="quick-action" onClick={() => onNavigate("containers")}>
              <ShortcutIcon>▣</ShortcutIcon><span><strong>컨테이너 관리</strong><small>시작·중지·재시작 및 삭제</small></span><b aria-hidden="true">›</b>
            </button>
            <button type="button" className="quick-action" onClick={() => onNavigate("images")}>
              <ShortcutIcon>◇</ShortcutIcon><span><strong>이미지 확인</strong><small>사용 가능한 이미지 살펴보기</small></span><b aria-hidden="true">›</b>
            </button>
            <button type="button" className="quick-action" onClick={() => onNavigate("terminal")}>
              <ShortcutIcon>&gt;_</ShortcutIcon><span><strong>터미널 열기</strong><small>실행 중인 컨테이너에 명령 실행</small></span><b aria-hidden="true">›</b>
            </button>
          </div>
        </article>

        <article className="home-card inventory-card">
          <header><div><h2>리소스 현황</h2><p>로컬 Engine에 등록된 항목입니다.</p></div></header>
          <div className="inventory-list">
            {inventory.map((item) => (
              <button type="button" key={item.id} onClick={() => onNavigate(item.id)}>
                <span className="inventory-icon" aria-hidden="true">{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <b>{initialLoading ? "—" : item.value}{!initialLoading && <small>개</small>}</b>
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="home-card recent-containers-card" aria-labelledby="home-containers-title">
        <header>
          <div><h2 id="home-containers-title">컨테이너 요약</h2><p>전체 {summary.total || 0}개 중 {summary.running || 0}개가 실행 중입니다.</p></div>
          <button type="button" className="text-action" onClick={() => onNavigate("containers")}>전체 관리 <span aria-hidden="true">→</span></button>
        </header>
        {initialLoading ? (
          <div className="home-empty-state home-loading-state" role="status"><span className="loading-spinner" aria-hidden="true" /><div><strong>컨테이너 현황을 불러오는 중입니다.</strong><p>Docker Engine의 응답을 기다리고 있습니다.</p></div></div>
        ) : visibleContainers.length ? (
          <ul className="recent-container-list">
            {visibleContainers.map((container) => (
              <li key={container.id}>
                <button type="button" onClick={() => onNavigate("containers")} aria-label={`${container.name} 컨테이너 관리 화면 열기`}>
                  <span className="recent-container-identity"><i aria-hidden="true">▣</i><span><strong>{container.name}</strong><small>{container.image}</small></span></span>
                  <span className={`status-pill ${container.status}`}><i />{statusLabels[container.status] || container.status}</span>
                  <span className="recent-container-usage"><span>CPU <b>{Number(container.cpuPercent || 0).toFixed(1)}%</b></span><span>메모리 <b>{Number(container.memoryMb || 0).toFixed(0)} MB</b></span></span>
                  <span className="row-arrow" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="home-empty-state"><span aria-hidden="true">◇</span><div><strong>아직 컨테이너가 없습니다.</strong><p>첫 컨테이너를 만들어 로컬 환경을 시작하세요.</p></div><button type="button" onClick={onCreate}>컨테이너 생성</button></div>
        )}
      </section>
    </div>
  );
}
