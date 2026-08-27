import AppHeader from "./components/AppHeader.jsx";
import ContainerSection from "./components/ContainerSection.jsx";
import DashboardMetrics from "./components/DashboardMetrics.jsx";
import Sidebar from "./components/Sidebar.jsx";

export default function App() {
  const [dashboard, setDashboard] = useState({ containers: [], summary: {} });
  const [images, setImages] = useState([]);
  const [runtime, setRuntime] = useState("확인 중");
  const [lastChecked, setLastChecked] = useState("확인 전");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDashboard, imageData, health] = await Promise.all([
        getDashboard(),
        getImages(),
        getHealth(),
      ]);
      setDashboard(nextDashboard);
      setImages(imageData.images || []);
      setRuntime(health.runtime || "docker");
      setLastChecked(new Date().toLocaleTimeString("ko-KR"));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <>
      <Sidebar total={dashboard.summary.total || 0} />
      <main>
        <AppHeader />
        <div className="content">
          <section className="page-heading">
            <div><h1>개요</h1><p>호스트와 컨테이너의 현재 상태를 확인합니다.</p></div>
            <div className="heading-actions">
              <button type="button" onClick={refresh} disabled={loading}>
                {loading ? "조회 중..." : "새로고침"}
              </button>
              <button type="button" className="primary">컨테이너 생성</button>
            </div>
          </section>
          <p className="image-update-note">
            저장된 이미지 {images.length}개의 세부 정보는 자동으로 갱신됩니다.
          </p>
          {error && <p className="dashboard-error" role="alert">{error}</p>}
          <section className="system-bar">
            <div className="system-summary">
              <i className="status-dot"></i>
              <p><strong>{error ? "시스템 조회 실패" : "시스템 실행 중"}</strong><small>{lastChecked}</small></p>
            </div>
            <dl>
              <div><dt>호스트</dt><dd>작업 중</dd></div>
              <div><dt>가동 시간</dt><dd>0시간</dd></div>
              <div><dt>Docker Engine</dt><dd>{runtime}</dd></div>
            </dl>
          </section>
          <DashboardMetrics dashboard={dashboard} />
          <ContainerSection containers={dashboard.containers} />
        </div>
      </main>
    </>
  );
}
import { useCallback, useEffect, useState } from "react";
import { getDashboard, getHealth, getImages } from "./api/dockerApi.js";
