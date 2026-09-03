const Icon = ({ children }) => <span className="nav-icon" aria-hidden="true">{children}</span>;

export default function Sidebar({ activeView, total, onNavigate }) {
  const navigation = [
    ["overview", "⌂", "홈"],
    ["containers", "▣", "컨테이너", total],
    ["images", "◇", "이미지"],
    ["storage", "▱", "볼륨"],
    ["networks", "⌘", "네트워크"],
    ["events", "≡", "이벤트"],
  ];

  return (
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => onNavigate("overview")}>
        <span className="brand-mark">C</span>
        <span><b>Container</b><small>DESKTOP</small></span>
      </button>
      <nav className="primary-nav" aria-label="주 메뉴">
        <p className="nav-label">리소스</p>
        {navigation.map(([id, icon, label, count]) => (
          <button className={activeView === id ? "active" : ""} type="button" key={id} onClick={() => onNavigate(id)} aria-current={activeView === id ? "page" : undefined}>
            <Icon>{icon}</Icon><span className="nav-text">{label}</span>
            {typeof count === "number" && <span className="nav-count">{count}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className={activeView === "settings" ? "active" : ""} onClick={() => onNavigate("settings")}><Icon>⚙</Icon><span className="nav-text">설정</span></button>
        <button type="button" className={activeView === "support" ? "active" : ""} onClick={() => onNavigate("support")}><Icon>?</Icon><span className="nav-text">도움말</span></button>
        <div className="engine-mini"><i /><span><b>Docker Engine</b><small>실행 중</small></span></div>
      </div>
    </aside>
  );
}

