import AppHeader from "./components/AppHeader.jsx";
import ContainerSection from "./components/ContainerSection.jsx";
import DashboardMetrics from "./components/DashboardMetrics.jsx";
import Sidebar from "./components/Sidebar.jsx";

export default function App() {
  return (
    <>
      <Sidebar />
      <main>
        <AppHeader />
        <div className="content">
          <section className="page-heading">
            <div><h1>개요</h1><p>호스트와 컨테이너의 현재 상태를 확인합니다.</p></div>
            <div className="heading-actions">
              <button type="button">새로고침</button>
              <button type="button" className="primary">컨테이너 생성</button>
            </div>
          </section>
          <p className="image-update-note">저장된 이미지의 세부 정보는 자동으로 갱신됩니다.</p>
          <section className="system-bar">
            <div className="system-summary">
              <i className="status-dot"></i>
              <p><strong>시스템 확인 중</strong><small>확인 전</small></p>
            </div>
            <dl>
              <div><dt>호스트</dt><dd>작업 중</dd></div>
              <div><dt>가동 시간</dt><dd>0시간</dd></div>
              <div><dt>Docker Engine</dt><dd>확인 중</dd></div>
            </dl>
          </section>
          <DashboardMetrics />
          <ContainerSection />
        </div>
      </main>
    </>
  );
}
