export default function DashboardMetrics({ dashboard }) {
  const containers = dashboard.containers || [];
  const summary = dashboard.summary || {};
  const cpu = containers.reduce((sum, item) => sum + Number(item.cpuPercent || 0), 0);
  const memory = containers.reduce((sum, item) => sum + Number(item.memoryMb || 0), 0);
  const cards = [
    ["컨테이너", summary.total || 0, `${summary.running || 0}개 실행 중`, "blue"],
    ["CPU 사용량", `${cpu.toFixed(1)}%`, "전체 컨테이너", "purple"],
    ["메모리", `${memory.toFixed(0)} MB`, "현재 사용량", "green"],
    ["상태", summary.errors ? `${summary.errors}개 오류` : "정상", summary.errors ? "확인이 필요합니다" : "문제 없음", summary.errors ? "red" : "teal"],
  ];
  return (
    <section className="metrics" aria-label="리소스 요약">
      {cards.map(([label, value, hint, tone]) => (
        <article className={`metric metric-${tone}`} key={label}>
          <div className="metric-top"><span>{label}</span><i /></div>
          <strong>{value}</strong><p>{hint}</p>
        </article>
      ))}
    </section>
  );
}

