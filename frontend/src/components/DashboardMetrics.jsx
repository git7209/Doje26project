export default function DashboardMetrics({ dashboard }) {
  const containers = dashboard.containers || [];
  const summary = dashboard.summary || {};
  const cpuPercent = containers.reduce((total, item) => total + Number(item.cpuPercent || 0), 0);
  const memoryMb = containers.reduce((total, item) => total + Number(item.memoryMb || 0), 0);
  return (
    <section className="metrics">
      <article className="metric metric-primary">
        <div><h2>CPU 사용률</h2><strong>{cpuPercent.toFixed(1)}<small>%</small></strong><p>{summary.running || 0}개 컨테이너 실행 중</p></div>
        <div className="spark">{Array.from({ length: 8 }, (_, index) => <i key={index}></i>)}</div>
      </article>
      <article className="metric">
        <h2>메모리</h2><strong>{memoryMb.toFixed(1)}<small> MB</small></strong><p>컨테이너 사용량</p>
        <div className="progress"><i></i></div>
      </article>
      <article className="metric">
        <h2>스토리지</h2><strong>0<small> / 0 GB</small></strong><p>0% 사용 중</p>
        <div className="progress"><i></i></div>
      </article>
      <article className="metric">
        <h2>컨테이너</h2><strong>{summary.total || 0}</strong>
        <div className="container-counts">
          <span><b>{summary.running || 0}</b> 실행 중</span><span><b>{summary.stopped || 0}</b> 중지</span><span><b>{summary.errors || 0}</b> 오류</span>
        </div>
      </article>
    </section>
  );
}
