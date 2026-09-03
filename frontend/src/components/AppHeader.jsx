export default function AppHeader({ runtime, notifications = [], onOpenNotifications, onOpenDocs }) {
  return (
    <header className="app-header">
      <label className="global-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" placeholder="컨테이너, 이미지, 볼륨 검색" aria-label="리소스 검색" />
        <kbd>Ctrl K</kbd>
      </label>
      <div className="engine-status" title={`Runtime: ${runtime || "docker"}`}><i />Engine running</div>
      <button className="icon-button" type="button" onClick={onOpenDocs} aria-label="문서 열기">?</button>
      <button className="icon-button header-action" type="button" onClick={onOpenNotifications} aria-label="알림">
        ♢{notifications.length > 0 && <b className="header-badge">{Math.min(notifications.length, 99)}</b>}
      </button>
    </header>
  );
}

