import { useEffect, useMemo, useRef, useState } from "react";
import { connectNetwork, createNetwork, createVolume, deleteNetwork, deleteVolume, disconnectNetwork, getNetwork, runTerminalCommand } from "../api/dockerApi.js";

const dateText = (value) => value ? new Date(value).toLocaleString("ko-KR") : "-";

function Page({ title, description, action, children }) {
  return <div className="content console-page"><section className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</section>{children}</div>;
}

export function NetworksPage({ networks, containers = [], loading, onRefresh, error, notify, autoOpenNetwork = false, confirmNetworkDelete = true }) {
  const defaultNetworkInfo = {
    bridge: "일반 컨테이너가 서로 통신할 때 사용하는 기본 가상 네트워크입니다.",
    host: "컨테이너가 호스트 컴퓨터의 네트워크를 직접 사용해야 할 때 필요합니다.",
    none: "네트워크를 완전히 차단해 컨테이너를 격리할 때 사용하는 기본 네트워크입니다.",
  };
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("bridge");
  const [internal, setInternal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [networkSort, setNetworkSort] = useState("asc");
  const [working, setWorking] = useState("");
  const [actionError, setActionError] = useState("");

  async function addNetwork(event) {
    event.preventDefault();
    const networkName = name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(networkName)) {
      setActionError("네트워크 이름은 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.");
      return;
    }
    setWorking("create"); setActionError("");
    try { const result = await createNetwork({ name: networkName, driver, internal }); setName(""); setDriver("bridge"); setInternal(false); notify?.(`${networkName} 가상 네트워크를 생성했습니다.`); await onRefresh(); if (autoOpenNetwork && result.network) openNetwork(result.network); }
    catch (requestError) { setActionError(requestError.message); }
    finally { setWorking(""); }
  }

  async function openNetwork(network) {
    setSelected({ ...network, loading: true }); setActionError("");
    try { const data = await getNetwork(network.id); setSelected(data.network); }
    catch (requestError) { setActionError(requestError.message); }
  }

  function openDefaultNetwork(network) {
    setSelected({ ...network, isDefault: true, explanation: defaultNetworkInfo[network.name] });
    setActionError("");
  }

  async function removeNetwork() {
    if (!selected || selected.containers.length || ["bridge", "host", "none"].includes(selected.name)) return;
    if (confirmNetworkDelete && !window.confirm(`${selected.name} 네트워크를 삭제하시겠습니까?`)) return;
    setWorking("delete"); setActionError("");
    try { await deleteNetwork(selected.id); notify?.(`${selected.name} 네트워크를 삭제했습니다.`); setSelected(null); await onRefresh(); }
    catch (requestError) { setActionError(requestError.message); }
    finally { setWorking(""); }
  }

  async function changeConnection(containerId, action) {
    if (!selected) return;
    setWorking(containerId); setActionError("");
    try { if (action === "connect") await connectNetwork(selected.id, containerId); else await disconnectNetwork(selected.id, containerId); const data = await getNetwork(selected.id); setSelected(data.network); await onRefresh(); }
    catch (requestError) { setActionError(requestError.message); }
    finally { setWorking(""); }
  }

  const connectedIds = new Set((selected?.containers || []).map((item) => item.id));
  const visibleNetworks = useMemo(
    () => networks.filter((item) => !["bridge", "host", "none"].includes(item.name)),
    [networks],
  );
  const sortedNetworks = useMemo(() => [...visibleNetworks].sort((a, b) => {
    const defaultRank = (item) => ({ bridge: 0, host: 1, none: 2 }[item.name] ?? 3);
    const rankDifference = defaultRank(a) - defaultRank(b);
    if (rankDifference) return rankDifference;
    if (networkSort === "newest") return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    return networkSort === "desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
  }), [visibleNetworks, networkSort]);
  return <Page title="네트워크" description="외부 네트워크가 아닌 Docker 내부 가상 네트워크만 관리합니다." action={<div className="heading-actions"><button type="button" onClick={onRefresh} disabled={loading || Boolean(working)}>{loading ? "조회 중..." : "새로고침"}</button></div>}>
    {(error || actionError) && <p className="dashboard-error page-alert" role="alert">{actionError || error}</p>}
    <section className="resource-cards"><article><span>전체 네트워크</span><strong>{visibleNetworks.length}</strong><small>개</small></article><article><span>연결된 컨테이너</span><strong>{visibleNetworks.reduce((sum, item) => sum + (Array.isArray(item.containers) ? item.containers.length : item.containers), 0)}</strong><small>개</small></article><article><span>내부 전용</span><strong>{visibleNetworks.filter((item) => item.internal).length}</strong><small>개</small></article></section>
    <form id="network-create-form" className="network-create-card" onSubmit={addNetwork}>
      <header><div><h2>네트워크 생성</h2><p>컨테이너가 사용할 가상 네트워크를 설정합니다.</p></div></header>
      <div className="network-form-grid"><label htmlFor="network-name"><span>네트워크 이름</span><input id="network-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: app-network" maxLength="63" /></label><label htmlFor="network-driver"><span>드라이버</span><select id="network-driver" value={driver} onChange={(event) => setDriver(event.target.value)}><option value="bridge">bridge</option><option value="overlay">overlay</option><option value="macvlan">macvlan</option></select></label></div>
      <label className="network-check-card"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /><span><b>내부 전용 네트워크</b><small>외부 연결 없이 컨테이너 간 통신만 허용합니다.</small></span></label>
      <footer><button className="primary" disabled={working === "create"}>{working === "create" ? "생성 중..." : "네트워크 생성"}</button></footer>
    </form>
    <ResourceTable title="네트워크 목록" count={visibleNetworks.length} action={<select className="resource-sort" aria-label="네트워크 정렬" value={networkSort} onChange={(event) => setNetworkSort(event.target.value)}><option value="asc">오름차순</option><option value="desc">내림차순</option><option value="newest">최신순</option></select>} headings={["이름", "드라이버", "서브넷", "범위", "컨테이너", "작업"]} rows={sortedNetworks.map((item) => { const open = () => openNetwork(item); return [<button className="table-link" type="button" onClick={open}><strong>{item.name}</strong></button>, item.driver, item.subnet, item.internal ? "내부 전용" : item.scope, `${Array.isArray(item.containers) ? item.containers.length : item.containers}개`, <button type="button" onClick={open}>상세</button>]; })} />
    {selected && <div className="volume-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setSelected(null); }}>
      <section className="dialog-card confirm-delete-dialog network-dialog" role="dialog" aria-modal="true" aria-labelledby="network-detail-title">
        <header><div><h2 id="network-detail-title">{selected.name} 네트워크</h2><p>Docker 내부 가상 네트워크 상세 정보</p></div><button className="dialog-close" type="button" aria-label="닫기" onClick={() => setSelected(null)} disabled={Boolean(working)}>×</button></header>
        {selected.isDefault && <div className="network-default-note"><strong>Docker 기본 네트워크</strong><p>{selected.explanation}</p><small>Docker 엔진이 컨테이너의 네트워크 연결과 격리를 관리하기 위해 기본으로 유지합니다.</small></div>}
        {selected.loading ? <p>상세 정보를 조회하는 중...</p> : <><dl className="network-detail-grid"><div><dt>드라이버</dt><dd>{selected.driver}</dd></div><div><dt>서브넷</dt><dd>{selected.subnet}</dd></div><div><dt>게이트웨이</dt><dd>{selected.gateway || "-"}</dd></div><div><dt>범위</dt><dd>{selected.internal ? "내부 전용" : selected.scope}</dd></div></dl>
          <h3>연결된 컨테이너</h3>{selected.containers.length ? <ul className="network-container-list">{selected.containers.map((item) => <li key={item.id}><span><strong>{item.name}</strong><small>{item.ipv4}</small></span><button type="button" disabled={Boolean(working)} onClick={() => changeConnection(item.id, "disconnect")}>{working === item.id ? "처리 중..." : "연결 해제"}</button></li>)}</ul> : <p className="empty-state">연결된 컨테이너가 없습니다.</p>}
          <label htmlFor="network-container-select">컨테이너 연결<select id="network-container-select" defaultValue="" onChange={(event) => { if (event.target.value) changeConnection(event.target.value, "connect"); event.target.value = ""; }} disabled={Boolean(working)}><option value="">컨테이너 선택</option>{containers.filter((item) => !connectedIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <footer><button type="button" onClick={() => setSelected(null)} disabled={Boolean(working)}>닫기</button><button className="confirm-danger" type="button" onClick={removeNetwork} disabled={Boolean(working) || selected.containers.length > 0 || ["bridge", "host", "none"].includes(selected.name)}>{working === "delete" ? "삭제 중..." : "네트워크 삭제"}</button></footer>
        </>}
      </section>
    </div>}
  </Page>;
}

const bytesText = (value) => {
  const bytes = Number(value) || 0;
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unit)).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
};

export function StoragePage({ volumes, loading, onRefresh, error, notify, confirmVolumeDelete = true }) {
  const [name, setName] = useState("");
  const [working, setWorking] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const used = volumes.filter((item) => item.containers?.length || item.refCount > 0).length;
  const totalSize = volumes.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0);

  async function addVolume(event) {
    event.preventDefault();
    const volumeName = name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(volumeName)) {
      setActionError("볼륨 이름은 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.");
      return;
    }
    setWorking("create"); setActionError("");
    try {
      await createVolume(volumeName);
      setName(""); notify?.(`${volumeName} 볼륨을 생성했습니다.`); await onRefresh();
    } catch (requestError) { setActionError(requestError.message); }
    finally { setWorking(""); }
  }

  function requestVolumeRemoval(volume) {
    if (volume.containers?.length || volume.refCount > 0) return;
    if (!confirmVolumeDelete) { removeVolumeImmediately(volume); return; }
    setDeleteTarget(volume);
    setDeleteConfirmation("");
    setActionError("");
  }

  async function removeVolumeImmediately(volume) {
    setWorking(volume.name); setActionError("");
    try { await deleteVolume(volume.name); notify?.(`${volume.name} 볼륨을 삭제했습니다.`); await onRefresh(); }
    catch (requestError) { setActionError(requestError.message); }
    finally { setWorking(""); }
  }

  function closeDeleteDialog() {
    if (working) return;
    setDeleteTarget(null);
    setDeleteConfirmation("");
  }

  async function removeVolume(event) {
    event.preventDefault();
    if (!deleteTarget || deleteConfirmation !== deleteTarget.name) return;
    const volumeName = deleteTarget.name;
    setWorking(volumeName); setActionError("");
    try {
      await deleteVolume(volumeName);
      setDeleteTarget(null); setDeleteConfirmation("");
      notify?.(`${volumeName} 볼륨을 삭제했습니다.`); await onRefresh();
    } catch (requestError) { setActionError(requestError.message); }
    finally { setWorking(""); }
  }

  return <Page title="스토리지" description="컨테이너 데이터를 영구 보관하는 Docker 볼륨을 관리합니다." action={<div className="heading-actions"><button onClick={onRefresh} disabled={loading || Boolean(working)}>{loading ? "조회 중..." : "새로고침"}</button></div>}>
    {(error || actionError) && <p className="dashboard-error page-alert" role="alert">{actionError || error}</p>}
    <section className="resource-cards storage-cards">
      <article><span>전체 볼륨</span><strong>{volumes.length}</strong><small>개</small></article>
      <article><span>사용 중</span><strong>{used}</strong><small>개</small></article>
      <article><span>확인된 사용량</span><strong>{bytesText(totalSize)}</strong></article>
    </section>
    <form className="volume-create-bar" onSubmit={addVolume}>
      <label htmlFor="volume-name"><span>새 볼륨 이름</span><input id="volume-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: app-data" maxLength="128" /></label>
      <button className="primary" disabled={working === "create"}>{working === "create" ? "생성 중..." : "볼륨 생성"}</button>
    </form>
    <section className="images-panel resource-panel">
      <header><div><h2>볼륨 목록</h2><p>사용 중인 볼륨은 연결된 컨테이너를 제거한 후 삭제할 수 있습니다.</p></div><span>{volumes.length}개</span></header>
      {volumes.length ? <div className="table-wrap"><table className="volume-table"><thead><tr><th>이름</th><th>사용량</th><th>연결된 컨테이너</th><th>마운트 경로</th><th>생성일</th><th>작업</th></tr></thead><tbody>{volumes.map((item) => {
        const inUse = Boolean(item.containers?.length || item.refCount > 0);
        return <tr key={item.name}>
          <td><strong>{item.name}</strong><small>{item.driver} · {item.scope}</small></td>
          <td>{bytesText(item.sizeBytes)}</td>
          <td>{item.containers?.length ? item.containers.join(", ") : inUse ? `${item.refCount}개 컨테이너` : "사용 안 함"}</td>
          <td><span className="path-cell" title={item.mountpoint}>{item.mountpoint}</span></td>
          <td>{dateText(item.createdAt)}</td>
          <td><button className="danger-action" type="button" disabled={inUse || Boolean(working)} title={inUse ? "사용 중인 볼륨은 삭제할 수 없습니다." : "볼륨 삭제"} onClick={() => requestVolumeRemoval(item)}>{working === item.name ? "삭제 중..." : "삭제"}</button></td>
        </tr>;
      })}</tbody></table></div> : <div className="empty-state"><strong>생성된 볼륨이 없습니다.</strong><p>위 입력란에서 첫 번째 데이터 볼륨을 생성해 보세요.</p></div>}
    </section>
    {deleteTarget && <div className="volume-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeleteDialog(); }}>
      <section className="dialog-card confirm-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-volume-title">
        <header><div><h2 id="delete-volume-title">볼륨 삭제</h2><p>이 작업은 되돌릴 수 없습니다.</p></div><button className="dialog-close" type="button" aria-label="닫기" onClick={closeDeleteDialog}>×</button></header>
        <form onSubmit={removeVolume}>
          <div className="destructive-warning"><strong>{deleteTarget.name}</strong> 볼륨과 내부에 저장된 데이터를 영구적으로 삭제합니다.</div>
          <div className="form-field">
            <label htmlFor="delete-volume-confirmation">계속하려면 볼륨 이름 <strong>{deleteTarget.name}</strong>을(를) 입력하세요.</label>
            <input id="delete-volume-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" autoFocus />
          </div>
          <footer><button type="button" onClick={closeDeleteDialog} disabled={Boolean(working)}>취소</button><button className="confirm-danger" disabled={deleteConfirmation !== deleteTarget.name || Boolean(working)}>{working ? "삭제 중..." : "볼륨 영구 삭제"}</button></footer>
        </form>
      </section>
    </div>}
  </Page>;
}

function ResourceTable({ title, count, action, headings, rows }) {
  return <section className="images-panel resource-panel"><header><div><h2>{title}</h2><p>Docker Engine에서 조회한 최신 정보입니다.</p></div><div className="resource-table-tools">{action}<span>{count}개</span></div></header>{rows.length ? <div className="table-wrap"><table><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <div className="empty-state"><strong>표시할 항목이 없습니다.</strong><p>새 항목이 생성되면 이곳에 표시됩니다.</p></div>}</section>;
}

export function EventsPage({ events = [] }) {
  const [filter, setFilter] = useState("all");
  const visibleEvents = useMemo(() => events.filter((item) => filter === "all" || item.status === filter), [events, filter]);
  return <Page title="이벤트" description="컨테이너의 최근 상태와 변경 시점을 확인합니다.">
    <section className="events-list"><header><div><h2>최근 활동</h2><p>자동 새로고침 중 감지된 컨테이너 상태 변화입니다.</p></div><label>필터<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">전체</option><option value="running">실행</option><option value="stopped">중지</option><option value="paused">일시정지</option></select></label><span>{visibleEvents.length}건</span></header>{visibleEvents.length ? <ol>{visibleEvents.map((item) => <li key={item.id}><span className={`event-mark ${item.status}`}></span><div><strong>{item.name}</strong><p>{item.message || <>컨테이너 상태가 <b>{item.status}</b>로 변경되었습니다.</>}</p></div><time>{dateText(item.updatedAt)}</time></li>)}</ol> : <div className="empty-state"><strong>표시할 이벤트가 없습니다.</strong><p>컨테이너 상태가 변경되면 이곳에 기록됩니다.</p></div>}</section>
  </Page>;
}

export function SettingsPage({ settings, onSettingsChange, notify }) {
  const themes = [
    { id: "green", name: "그린 포레스트", colors: ["#E8F5E9", "#A5D6A7", "#66BB6A", "#1B5E20"] },
    { id: "purple", name: "퍼플 캔디", colors: ["#FFF4BF", "#FFBEFB", "#DC95FF", "#8C56D4"] },
    { id: "blue", name: "블루 세이지", colors: ["#3368A0", "#66A3BF", "#C8DFDB", "#F2EFE7"] },
    { id: "red", name: "선셋 레드", colors: ["#FFEDB9", "#FFCB56", "#FFA259", "#FF7E7E"] },
  ];
  function save(event) { event.preventDefault(); onSettingsChange(settings); notify("설정을 저장했습니다."); }
  return <Page title="설정" description="이 브라우저에서 사용할 콘솔 환경을 설정합니다."><form className="settings-card" onSubmit={save}><h2>일반 설정</h2><label className="check-row"><input type="checkbox" checked={settings.autoRefresh !== false} onChange={(event) => onSettingsChange({...settings, autoRefresh: event.target.checked})}/><span><b>자동 새로고침</b><small>Docker 상태를 주기적으로 다시 조회합니다.</small></span></label><label><span>새로고침 주기</span><select value={settings.refresh} disabled={settings.autoRefresh === false} onChange={(event) => onSettingsChange({...settings, refresh: Number(event.target.value)})}><option value="5">5초</option><option value="10">10초</option><option value="30">30초</option><option value="60">1분</option></select></label><fieldset className="theme-picker"><legend>화면 테마</legend><div className="theme-options">{themes.map((theme) => <label className={`theme-option ${settings.theme === theme.id ? "selected" : ""}`} key={theme.id}><input type="radio" name="theme" value={theme.id} checked={settings.theme === theme.id} onChange={(event) => onSettingsChange({...settings, theme: event.target.value})}/><span className="theme-swatch" aria-hidden="true">{theme.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span><span className="theme-name">{theme.name}</span><span className="theme-check">✓</span></label>)}</div></fieldset><label className="check-row"><input type="checkbox" checked={Boolean(settings.darkMode)} onChange={(event) => onSettingsChange({...settings, darkMode: event.target.checked})}/><span><b>다크 모드</b><small>선택한 색상 팔레트에 맞는 어두운 화면으로 전환합니다.</small></span></label><label className="font-size-setting"><span>글자 크기</span><select value={settings.fontSize || "medium"} onChange={(event) => onSettingsChange({...settings, fontSize: event.target.value})}><option value="small">작게</option><option value="medium">기본</option><option value="large">크게</option><option value="xlarge">더 크게</option></select></label><label className="check-row"><input type="checkbox" checked={settings.autoOpenNetwork !== false} onChange={(event) => onSettingsChange({...settings, autoOpenNetwork: event.target.checked})}/><span><b>네트워크 생성 후 자동 상세 화면</b><small>생성한 네트워크의 상세 정보를 바로 엽니다.</small></span></label><h3 className="settings-section-title">안전 설정</h3><label className="check-row"><input type="checkbox" checked={settings.confirmContainerDelete !== false} onChange={(event) => onSettingsChange({...settings, confirmContainerDelete: event.target.checked})}/><span><b>컨테이너 삭제 전 확인</b></span></label><label className="check-row"><input type="checkbox" checked={settings.confirmContainerStop !== false} onChange={(event) => onSettingsChange({...settings, confirmContainerStop: event.target.checked})}/><span><b>컨테이너 중지 전 확인</b></span></label><label className="check-row"><input type="checkbox" checked={settings.confirmNetworkDelete !== false} onChange={(event) => onSettingsChange({...settings, confirmNetworkDelete: event.target.checked})}/><span><b>네트워크 삭제 전 확인</b></span></label><label className="check-row"><input type="checkbox" checked={settings.requireNameConfirmation !== false} onChange={(event) => onSettingsChange({...settings, requireNameConfirmation: event.target.checked})}/><span><b>위험 작업 이름 입력 확인</b><small>컨테이너 삭제 시 이름을 직접 입력해야 합니다.</small></span></label><label className="check-row"><input type="checkbox" checked={settings.confirmVolumeDelete !== false} onChange={(event) => onSettingsChange({...settings, confirmVolumeDelete: event.target.checked})}/><span><b>볼륨 삭제 전 확인</b></span></label><label className="check-row"><input type="checkbox" checked={settings.protectDefaultNetworks !== false} disabled/><span><b>기본 네트워크 보호</b><small>bridge, host, none은 항상 삭제할 수 없습니다.</small></span></label><h3 className="settings-section-title">알림</h3><label className="check-row"><input type="checkbox" checked={settings.browserNotifications !== false} onChange={(event) => onSettingsChange({...settings, browserNotifications: event.target.checked})}/><span><b>브라우저 알림</b><small>컨테이너 상태 변경과 작업 결과를 브라우저 알림으로 표시합니다.</small></span></label><label className="check-row"><input type="checkbox" checked={settings.compact} onChange={(event) => onSettingsChange({...settings, compact: event.target.checked})}/><span><b>간결한 목록 사용</b><small>표의 행 간격을 줄여 더 많은 정보를 표시합니다.</small></span></label><footer><button className="primary" type="submit">설정 저장</button></footer></form></Page>;
}

export function SupportPage({ runtime, lastChecked, notify }) {
  async function copy() { await navigator.clipboard?.writeText(`LXC Console\nRuntime: ${runtime}\nLast checked: ${lastChecked}`); notify("진단 정보를 복사했습니다."); }
  return <Page title="지원" description="문제 해결에 필요한 정보와 사용 안내를 확인합니다."><section className="support-grid"><article><h2>빠른 도움말</h2><details open><summary>컨테이너가 시작되지 않아요</summary><p>이미지가 존재하는지, 포트가 다른 컨테이너와 충돌하지 않는지 확인하세요.</p></details><details><summary>이미지를 어떻게 추가하나요?</summary><p>이미지 메뉴의 업로드 버튼에서 tar, tar.gz, tgz, tar.xz, zip 또는 qcow2 파일을 선택하세요.</p></details><details><summary>네트워크 주소가 보이지 않아요</summary><p>컨테이너가 실행 중이고 Docker 네트워크에 연결되어 있는지 확인하세요.</p></details></article><article className="diagnostic-card"><h2>진단 정보</h2><dl><div><dt>런타임</dt><dd>{runtime}</dd></div><div><dt>마지막 확인</dt><dd>{lastChecked}</dd></div><div><dt>콘솔 버전</dt><dd>1.0.0</dd></div></dl><button type="button" onClick={copy}>진단 정보 복사</button></article></section></Page>;
}

export function ProfilePage({ profile, onProfileChange, notify }) {
  function save(event) { event.preventDefault(); onProfileChange(profile); notify("프로필을 저장했습니다."); }
  return <Page title="프로필" description="콘솔에 표시되는 계정 정보를 관리합니다."><form className="profile-card" onSubmit={save}><div className="profile-avatar">{profile.name.slice(0, 2).toUpperCase()}</div><div className="profile-fields"><label><span>표시 이름</span><input value={profile.name} onChange={(event) => onProfileChange({...profile, name: event.target.value}, false)} required /></label><label><span>이메일</span><input type="email" value={profile.email} onChange={(event) => onProfileChange({...profile, email: event.target.value}, false)} required /></label><label><span>역할</span><input value={profile.role} disabled /></label><button className="primary" type="submit">프로필 저장</button></div></form></Page>;
}

export function TerminalPage({ containers = [] }) {
  const runningContainers = containers.filter((container) => container.status === "running");
  const [containerId, setContainerId] = useState("");
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState([]);
  const [working, setWorking] = useState(false);
  const inputRef = useRef(null);
  const selectedId = runningContainers.some((container) => container.id === containerId)
    ? containerId
    : runningContainers[0]?.id || "";

  async function execute(event) {
    event.preventDefault();
    const value = command.trim();
    if (!value || working) return;
    if (!selectedId) {
      setLines((current) => [...current, { type: "command", text: `$ ${value}` }, { type: "error", text: "실행 중인 컨테이너가 없습니다. 컨테이너를 먼저 실행하세요." }]);
      return;
    }
    setCommand("");
    setWorking(true);
    setLines((current) => [...current, { type: "command", text: `$ ${value}` }]);
    try {
      const result = await runTerminalCommand(selectedId, value);
      setLines((current) => [...current, { type: "output", text: result.output || "(출력 없음)" }]);
    } catch (error) {
      setLines((current) => [...current, { type: "error", text: error.message }]);
    } finally {
      setWorking(false);
    }
  }

  return <Page title="터미널" description="실행 중인 컨테이너에서 셸 명령을 실행합니다.">
    <section className="terminal-card">
      <header>
        <span className="terminal-target-label">컨테이너</span>
        <div className="terminal-targets" aria-label="터미널 대상 컨테이너">
          {!runningContainers.length && <span>실행 중인 컨테이너 없음</span>}
          {runningContainers.map((container) => <button className={selectedId === container.id ? "active" : ""} type="button" key={container.id} onClick={() => { setContainerId(container.id); setLines([]); }} disabled={working}>{container.name}</button>)}
        </div>
        <button type="button" onClick={() => setLines([])} disabled={!lines.length || working}>화면 지우기</button>
      </header>
      <div className="terminal-output" role="log" aria-live="polite" onClick={() => inputRef.current?.focus()}>
        {lines.length ? lines.map((line, index) => <pre className={line.type} key={`${index}-${line.text}`}>{line.text}</pre>) : <p>{runningContainers.length ? "명령어를 입력해 시작하세요." : "먼저 컨테이너를 실행하세요."}</p>}
      </div>
      <form onSubmit={execute}>
        <span aria-hidden="true">$</span>
        <input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="예: ls -la" maxLength="1000" disabled={working} autoComplete="off" autoFocus aria-label="실행할 명령어" />
        <button className="primary" type="submit" disabled={!command.trim() || working}>{working ? "실행 중" : "실행"}</button>
      </form>
    </section>
  </Page>;
}
