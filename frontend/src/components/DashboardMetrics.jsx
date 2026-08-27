export default function DashboardMetrics() {
  return (
    <section className="metrics">
      <article className="metric metric-primary">
        <div><h2>CPU 사용률</h2><strong>0<small>%</small></strong><p>0개 코어 사용 중</p></div>
        <div className="spark">{Array.from({ length: 8 }, (_, index) => <i key={index}></i>)}</div>
      </article>
      <article className="metric">
        <h2>메모리</h2><strong>0<small> / 0 GB</small></strong><p>0% 사용 중</p>
        <div className="progress"><i></i></div>
      </article>
      <article className="metric">
        <h2>스토리지</h2><strong>0<small> / 0 GB</small></strong><p>0% 사용 중</p>
        <div className="progress"><i></i></div>
      </article>
      <article className="metric">
        <h2>컨테이너</h2><strong>0</strong>
        <div className="container-counts">
          <span><b>0</b> 실행 중</span><span><b>0</b> 중지</span><span><b>0</b> 오류</span>
        </div>
      </article>
    </section>
  );
}
