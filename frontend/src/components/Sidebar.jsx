const Icon = ({ children }) => <span className="nav-icon" aria-hidden="true">{children}</span>;

const MenuIcon = ({ name }) => {
  const paths = {
    overview: <><path d="m3 11 9-8 9 8" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" /></>,
    containers: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v8.5" /></>,
    images: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 3.5 3.5 2.5-2.5 5 5" /></>,
    storage: <><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    networks: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="m10.7 7.2-4.4 8.6m7-8.6 4.4 8.6M7.5 18h9" /></>,
    events: <><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="7" cy="5" r="1.5" /><circle cx="16" cy="12" r="1.5" /><circle cx="10" cy="19" r="1.5" /></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
  };

  return <Icon><svg viewBox="0 0 24 24" focusable="false">{paths[name]}</svg></Icon>;
};

export default function Sidebar({ activeView, total, onNavigate }) {
  const resources = [
    ["containers", "컨테이너", total],
    ["images", "이미지"],
    ["storage", "볼륨"],
    ["networks", "네트워크"],
    ["events", "이벤트"],
    ["terminal", "터미널"],
  ];

  return (
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => onNavigate("overview")} aria-label="홈으로 이동">
        <span className="brand-mark">C</span>
        <span><b>Container</b><small>DESKTOP</small></span>
      </button>
      <nav className="primary-nav" aria-label="주 메뉴">
        <div className="overview-nav">
          <p className="nav-label">개요</p>
          <button className={`home-nav-button ${activeView === "overview" ? "active" : ""}`} type="button" onClick={() => onNavigate("overview")} aria-label="홈, 전체 운영 현황" aria-current={activeView === "overview" ? "page" : undefined}>
            <MenuIcon name="overview" />
            <span className="nav-copy"><span className="nav-text">홈</span><small>전체 운영 현황</small></span>
          </button>
        </div>
        <div className="resource-nav">
          <p className="nav-label">리소스 관리</p>
          {resources.map(([id, label, count]) => (
            <button className={activeView === id ? "active" : ""} type="button" key={id} onClick={() => onNavigate(id)} aria-label={label} aria-current={activeView === id ? "page" : undefined}>
              <MenuIcon name={id} /><span className="nav-text">{label}</span>
              {typeof count === "number" && <span className="nav-count">{count}</span>}
            </button>
          ))}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className={activeView === "settings" ? "active" : ""} onClick={() => onNavigate("settings")} aria-label="설정"><Icon>⚙</Icon><span className="nav-text">설정</span></button>
        <button type="button" className={activeView === "support" ? "active" : ""} onClick={() => onNavigate("support")} aria-label="도움말"><Icon>?</Icon><span className="nav-text">도움말</span></button>
        <div className="engine-mini"><i /><span><b>Docker Engine</b><small>실행 중</small></span></div>
      </div>
    </aside>
  );
}

