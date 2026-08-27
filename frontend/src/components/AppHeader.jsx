export default function AppHeader() {
  return (
    <header className="app-header">
      <label className="search">
        <span>검색</span><input type="search" placeholder="컨테이너, 이미지, IP 주소" />
      </label>
      <button className="quiet" type="button">알림</button>
      <button className="quiet" type="button">문서</button>
    </header>
  );
}
