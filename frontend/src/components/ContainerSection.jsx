export default function ContainerSection() {
  return (
    <section className="operations-grid">
      <article className="table-panel">
        <header><div><h2>컨테이너</h2><p>현재 컨테이너를 표시합니다.</p></div></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>이름</th><th>상태</th><th>CPU / 메모리</th><th>IP 주소</th><th>가동 시간</th><th>작업</th></tr></thead>
            <tbody><tr><td colSpan="6"><strong>컨테이너 0개</strong></td></tr></tbody>
          </table>
        </div>
      </article>
      <aside className="events-panel">
        <header><h2>최근 이벤트</h2><a href="#">로그 보기</a></header>
        <ol><li><time>현재</time><strong>작업 중</strong><span>이벤트 0개</span></li></ol>
      </aside>
    </section>
  );
}
