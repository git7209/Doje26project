import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthSession, getDashboard, getHealth, getImages, getNetworks, getVolumes } from "./api/dockerApi.js";
import AppHeader from "./components/AppHeader.jsx";
import ContainerSection from "./components/ContainerSection.jsx";
import CreateContainerDialog from "./components/CreateContainerDialog.jsx";
import HomeOverview from "./components/HomeOverview.jsx";
import ImagesSection from "./components/ImagesSection.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { EventsPage, NetworksPage, ProfilePage, SettingsPage, StoragePage, SupportPage, TerminalPage } from "./components/ConsolePages.jsx";

const dateText = (value) => value ? new Date(value).toLocaleString("ko-KR") : "-";

export default function App() {
  const [activeView, setActiveView] = useState("overview");
  const [authUser, setAuthUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [dashboard, setDashboard] = useState({ containers: [], summary: {} });
  const [images, setImages] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [runtime, setRuntime] = useState("확인 중");
  const [lastChecked, setLastChecked] = useState("확인 전");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notification, setNotification] = useState("");
  const [settings, setSettings] = useState(() => JSON.parse(localStorage.getItem("lxc-console-settings") || '{"refresh":10,"compact":false,"theme":"blue","darkMode":false,"autoRefresh":true,"autoOpenNetwork":true,"browserNotifications":true}'));
  const [profile, setProfile] = useState(() => JSON.parse(localStorage.getItem("lxc-console-profile") || '{"name":"deok7","email":"admin@localhost","role":"Administrator"}'));
  const [events, setEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [panel, setPanel] = useState("");
  const previousContainers = useRef([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDashboard, imageData, health, networkData, volumeData] = await Promise.all([
        getDashboard(), getImages(), getHealth(), getNetworks(), getVolumes(),
      ]);
      const nextContainers = nextDashboard.containers || [];
      const changes = nextContainers.filter((item) => previousContainers.current.some((old) => old.id === item.id && old.status !== item.status));
      const detected = changes.map((item) => ({
        id: `${item.id}-${item.updatedAt}-${item.status}`,
        name: item.name,
        status: item.status,
        updatedAt: new Date().toISOString(),
        message: `${item.name} 컨테이너 상태가 ${item.status}(으)로 변경되었습니다.`,
      }));
      if (detected.length) {
        setEvents((current) => [...detected, ...current].slice(0, 50));
        setNotifications((current) => [...detected, ...current].slice(0, 20));
      }
      previousContainers.current = nextContainers;
      setDashboard(nextDashboard);
      setImages(imageData.images || []);
      setRuntime(health.runtime || "docker");
      setNetworks(networkData.networks || []);
      setVolumes(volumeData.volumes || []);
      setLastChecked(new Date().toLocaleTimeString("ko-KR"));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getAuthSession()
      .then((data) => setAuthUser(data.user || null))
      .catch(() => setAuthUser(null))
      .finally(() => setAuthChecking(false));
  }, []);
  useEffect(() => {
    if (authChecking) return;
    if (authUser) refresh();
    else setLoading(false);
  }, [authChecking, authUser, refresh]);
  useEffect(() => {
    if (!authUser || settings.autoRefresh === false) return undefined;
    const timer = window.setInterval(refresh, settings.refresh * 1000);
    return () => window.clearInterval(timer);
  }, [authUser, refresh, settings.refresh, settings.autoRefresh]);
  useEffect(() => { document.body.classList.toggle("compact-mode", settings.compact); }, [settings.compact]);
  useEffect(() => { document.body.classList.toggle("dark-mode", settings.darkMode); }, [settings.darkMode]);

  function updateSettings(next) { setSettings(next); localStorage.setItem("lxc-console-settings", JSON.stringify(next)); }
  function updateProfile(next, persist = true) { setProfile(next); if (persist) localStorage.setItem("lxc-console-profile", JSON.stringify(next)); }
  function notify(message) { setNotification(message); window.setTimeout(() => setNotification(""), 2500); }
  async function handleCreated(name) { setDialogOpen(false); notify(`${name} 컨테이너를 생성했습니다.`); await refresh(); }
  function handleAuthenticated(user) { setAuthUser(user); notify(`${user.name}님, 환영합니다.`); }
  function handleLoggedOut() {
    setAuthUser(null);
    setDashboard({ containers: [], summary: {} });
    setImages([]); setNetworks([]); setVolumes([]); setEvents([]); setNotifications([]);
    setActiveView("overview");
    notify("로그아웃했습니다.");
  }

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={setActiveView} total={dashboard.summary.total || 0} profile={profile} />
      <main>
        <AppHeader user={authUser} authChecking={authChecking} notifications={notifications} onOpenNotifications={() => setPanel(panel === "notifications" ? "" : "notifications")} onOpenDocs={() => setPanel(panel === "docs" ? "" : "docs")} onAuthenticated={handleAuthenticated} onLoggedOut={handleLoggedOut} onOpenAuth={() => setPanel("")} />

        {panel === "notifications" && <section className="header-panel">
          <header><h2>알림</h2><button type="button" onClick={() => { setNotifications([]); setPanel(""); }}>모두 읽음</button></header>
          {notifications.length ? notifications.map((item) => <p key={item.id}><strong>{item.name}</strong> 상태 변경<time>{dateText(item.updatedAt)}</time></p>) : <p>새 알림이 없습니다.</p>}
        </section>}
        {panel === "docs" && <section className="header-panel">
          <header><h2>빠른 도움말</h2><button type="button" onClick={() => setPanel("")}>닫기</button></header>
          <p>이 콘솔은 로컬 Docker Engine의 컨테이너, 이미지, 볼륨과 네트워크를 관리합니다.</p>
          <button type="button" onClick={() => { setActiveView("support"); setPanel(""); }}>도움말 열기</button>
        </section>}

        {!authChecking && !authUser && <section className="content signed-out-state"><span>ACCOUNT REQUIRED</span><h1>로그인이 필요합니다</h1><p>오른쪽 위의 로그인 버튼을 눌러 로그인하거나 새 계정을 만드세요.</p></section>}
        {authUser && activeView === "images" && <ImagesSection images={images} loading={loading} onRefresh={refresh} notify={notify} requestError={error} />}
        {authUser && activeView === "networks" && <NetworksPage networks={networks} containers={dashboard.containers} loading={loading} onRefresh={refresh} error={error} notify={notify} autoOpenNetwork={settings.autoOpenNetwork} confirmNetworkDelete={settings.confirmNetworkDelete} />}
        {authUser && activeView === "storage" && <StoragePage volumes={volumes} loading={loading} onRefresh={refresh} error={error} notify={notify} confirmVolumeDelete={settings.confirmVolumeDelete !== false} />}
        {authUser && activeView === "events" && <EventsPage events={events.length ? events : dashboard.containers.map((item) => ({ ...item, message: `현재 ${item.status} 상태입니다.` }))} />}
        {authUser && activeView === "terminal" && <TerminalPage containers={dashboard.containers} />}
        {authUser && activeView === "settings" && <SettingsPage settings={settings} onSettingsChange={updateSettings} notify={notify} />}
        {authUser && activeView === "support" && <SupportPage runtime={runtime} lastChecked={lastChecked} notify={notify} />}
        {authUser && activeView === "profile" && <ProfilePage profile={profile} onProfileChange={updateProfile} notify={notify} />}

        {authUser && activeView === "overview" && <HomeOverview
          dashboard={dashboard}
          images={images}
          networks={networks}
          volumes={volumes}
          runtime={runtime}
          lastChecked={lastChecked}
          loading={loading}
          error={error}
          onRefresh={refresh}
          onCreate={() => setDialogOpen(true)}
          onNavigate={setActiveView}
        />}

        {authUser && activeView === "containers" && <div className="content desktop-content containers-view">
          <section className="desktop-heading">
            <div><span className="eyebrow">CONTAINER MANAGEMENT</span><h1>컨테이너</h1><p>컨테이너를 검색하고 상태를 확인하거나 실행 작업을 관리하세요.</p></div>
            <div className="heading-actions"><button type="button" className="refresh-button" onClick={refresh} disabled={loading}>↻ {loading ? "새로 고치는 중" : "새로 고침"}</button><button type="button" className="primary create-button" onClick={() => setDialogOpen(true)}>＋ 컨테이너 생성</button></div>
          </section>
          {error && <p className="dashboard-error" role="alert"><strong>Docker Engine에 연결할 수 없습니다.</strong><span>{error}</span></p>}
          <ContainerSection containers={dashboard.containers} loading={loading} onChanged={refresh} notify={notify} confirmDelete={settings.confirmContainerDelete !== false} confirmStop={settings.confirmContainerStop !== false} requireNameConfirmation={settings.requireNameConfirmation} />
        </div>}
      </main>
      {authUser && dialogOpen && <CreateContainerDialog images={images} volumes={volumes} onClose={() => setDialogOpen(false)} onCreated={handleCreated} />}
      {notification && <div className="notification">{notification}</div>}
    </div>
  );
}

