export default function Sidebar() {
  return (
    <>
      <button className="sidebar-reopen" type="button" aria-label="사이드바 펼치기" hidden>
        <span></span><span></span><span></span>
      </button>
      <div className="sidebar-edge"></div>
      <aside className="sidebar">
        <a className="brand" href="#"><span>LX</span><b>LXC Console</b></a>
        <nav className="primary-nav" aria-label="주 메뉴">
          <a className="active" href="#">개요</a>
          <a href="#">컨테이너 <span><b>0</b>개</span></a>
          <a href="#">이미지</a><a href="#">네트워크</a>
          <a href="#">스토리지</a><a href="#">이벤트</a>
        </nav>
        <nav className="secondary-nav"><a href="#">설정</a><a href="#">지원</a></nav>
        <div className="account">
          <span>DK</span><p><strong>deok7</strong><small>Administrator</small></p>
        </div>
        <button className="sidebar-resizer" type="button" aria-label="사이드바 너비 조절"></button>
      </aside>
    </>
  );
}
