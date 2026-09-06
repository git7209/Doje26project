import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { runTerminalCommand } from "../../api/dockerApi.js";
import { terminalBridge } from "../../desktop/terminalBridge.js";

const Page = ({ title, description, action, children }) => (
  <div className="content console-page terminal-page">
    <section className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</section>
    {children}
  </div>
);

function BrowserCommandTerminal({ containers }) {
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
    if (!value || working || !selectedId) return;
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

  return <Page title="터미널" description="브라우저에서는 명령을 한 번씩 실행합니다. 데스크톱 앱에서 대화형 터미널을 사용할 수 있습니다.">
    <section className="terminal-card browser-command-terminal">
      <header>
        <label><span>컨테이너</span><select value={selectedId} onChange={(event) => setContainerId(event.target.value)} disabled={working}>
          {!runningContainers.length && <option value="">실행 중인 컨테이너 없음</option>}
          {runningContainers.map((container) => <option value={container.id} key={container.id}>{container.name}</option>)}
        </select></label>
        <span className="terminal-mode-badge">제한 모드</span>
        <button type="button" onClick={() => setLines([])} disabled={!lines.length || working}>화면 지우기</button>
      </header>
      <div className="terminal-output" role="log" aria-live="polite" onClick={() => inputRef.current?.focus()}>
        {lines.length ? lines.map((line, index) => <pre className={line.type} key={`${index}-${line.text}`}>{line.text}</pre>) : <p>{runningContainers.length ? "명령어를 입력해 시작하세요." : "먼저 컨테이너를 실행하세요."}</p>}
      </div>
      <form onSubmit={execute}>
        <span aria-hidden="true">$</span>
        <input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="예: ls -la" maxLength="1000" disabled={working || !selectedId} autoComplete="off" aria-label="실행할 명령어" />
        <button className="primary" type="submit" disabled={!command.trim() || working || !selectedId}>{working ? "실행 중" : "실행"}</button>
      </form>
    </section>
  </Page>;
}

const TerminalPane = forwardRef(function TerminalPane({ session, active, onExit }, ref) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const searchRef = useRef(null);

  useImperativeHandle(ref, () => ({
    clear: () => terminalRef.current?.clear(),
    findNext: (text) => Boolean(text && searchRef.current?.findNext(text, { incremental: true })),
    focus: () => terminalRef.current?.focus(),
    fit: () => fitRef.current?.fit(),
  }), []);

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      allowTransparency: false,
      theme: {
        background: "#0c1220",
        foreground: "#d7dfeb",
        cursor: "#61d6a3",
        selectionBackground: "#276da988",
        black: "#111827",
        brightBlack: "#68758b",
        red: "#ff8585",
        green: "#61d6a3",
        yellow: "#e5c07b",
        blue: "#65b2ff",
        magenta: "#c792ea",
        cyan: "#56cfe1",
        white: "#d7dfeb",
      },
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    const dataSubscription = terminal.onData((data) => terminalBridge.write(session.id, data));
    const resizeSubscription = terminal.onResize(({ cols, rows }) => terminalBridge.resize(session.id, cols, rows));
    const unsubscribe = terminalBridge.subscribe(session.id, {
      data: ({ data }) => terminal.write(data),
      exit: (event) => {
        terminal.write(`\r\n\x1b[90m[세션 종료: ${event.reason}]\x1b[0m\r\n`);
        onExit(session.id, event);
      },
    });
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
      });
    });
    resizeObserver.observe(hostRef.current);
    requestAnimationFrame(() => {
      fitAddon.fit();
      terminal.focus();
    });

    return () => {
      resizeObserver.disconnect();
      unsubscribe();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [session.id, onExit]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch {}
      terminalRef.current?.focus();
    });
  }, [active]);

  return <div className={`terminal-pane ${active ? "active" : ""}`} ref={hostRef} />;
});

function DesktopTerminal({ containers }) {
  const runningContainers = useMemo(
    () => containers.filter((container) => container.status === "running"),
    [containers],
  );
  const [containerId, setContainerId] = useState("");
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const paneRefs = useRef(new Map());
  const tabsRef = useRef([]);
  const selectedId = runningContainers.some((container) => container.id === containerId)
    ? containerId
    : runningContainers[0]?.id || "";

  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => () => {
    for (const tab of tabsRef.current) {
      if (tab.status !== "closed") terminalBridge.close(tab.id);
    }
  }, []);

  async function openSession() {
    if (!selectedId || opening) return;
    const container = runningContainers.find((item) => item.id === selectedId);
    setOpening(true);
    setError("");
    try {
      const session = await terminalBridge.open({ containerId: selectedId, cols: 100, rows: 30, shell: "auto" });
      const tab = { id: session.sessionId, containerId: selectedId, name: container?.name || selectedId.slice(0, 12), shell: session.shell, runtime: session.runtime, status: "active", reason: "" };
      setTabs((current) => [...current, tab]);
      setActiveId(tab.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setOpening(false);
    }
  }

  const handleExit = useCallback((sessionId, event) => {
    setTabs((current) => current.map((tab) => tab.id === sessionId
      ? { ...tab, status: "closed", reason: event.reason }
      : tab));
  }, []);

  function closeTab(sessionId) {
    const tab = tabs.find((item) => item.id === sessionId);
    if (tab?.status !== "closed") terminalBridge.close(sessionId);
    paneRefs.current.delete(sessionId);
    setTabs((current) => {
      const index = current.findIndex((item) => item.id === sessionId);
      const next = current.filter((item) => item.id !== sessionId);
      if (activeId === sessionId) setActiveId(next[Math.max(0, index - 1)]?.id || next[0]?.id || "");
      return next;
    });
  }

  const activeTab = tabs.find((tab) => tab.id === activeId);
  return <Page
    title="터미널"
    description="실행 중인 컨테이너에 대화형 셸로 연결합니다."
    action={<div className="terminal-launcher">
      <select value={selectedId} onChange={(event) => setContainerId(event.target.value)} disabled={opening || !runningContainers.length} aria-label="터미널 대상 컨테이너">
        {!runningContainers.length && <option value="">실행 중인 컨테이너 없음</option>}
        {runningContainers.map((container) => <option value={container.id} key={container.id}>{container.name}</option>)}
      </select>
      <button className="primary" type="button" onClick={openSession} disabled={!selectedId || opening}>{opening ? "연결 중…" : "＋ 새 터미널"}</button>
    </div>}
  >
    {error && <p className="terminal-error" role="alert">{error}</p>}
    <section className="terminal-workspace">
      <header className="terminal-workspace-bar">
        <div className="terminal-tabs" role="tablist" aria-label="열린 터미널">
          {tabs.map((tab) => <div className={`terminal-tab ${tab.id === activeId ? "active" : ""}`} key={tab.id} role="tab" aria-selected={tab.id === activeId}>
            <button className="terminal-tab-select" type="button" onClick={() => setActiveId(tab.id)}>
              <i className={tab.status} /><span>{tab.name}</span><small>{tab.shell === "auto" ? "shell" : tab.shell}</small>
            </button>
            <button className="terminal-tab-close" type="button" onClick={() => closeTab(tab.id)} aria-label={`${tab.name} 터미널 닫기`}>×</button>
          </div>)}
          {!tabs.length && <span className="terminal-no-tabs">열린 터미널 없음</span>}
        </div>
        <div className="terminal-tools">
          <button type="button" onClick={() => setSearchOpen((current) => !current)} disabled={!activeTab} aria-label="터미널 검색">⌕</button>
          <button type="button" onClick={() => paneRefs.current.get(activeId)?.clear()} disabled={!activeTab} aria-label="화면 지우기">지우기</button>
        </div>
      </header>
      {searchOpen && <form className="terminal-search" onSubmit={(event) => { event.preventDefault(); paneRefs.current.get(activeId)?.findNext(search); }}>
        <input value={search} onChange={(event) => { setSearch(event.target.value); paneRefs.current.get(activeId)?.findNext(event.target.value); }} placeholder="터미널 내용 검색" autoFocus />
        <button type="submit">다음</button><button type="button" onClick={() => setSearchOpen(false)}>닫기</button>
      </form>}
      <div className="terminal-stage">
        {!tabs.length && <div className="terminal-empty">
          <span aria-hidden="true">&gt;_</span>
          <strong>컨테이너 터미널을 여세요</strong>
          <p>실행 중인 컨테이너를 선택한 뒤 새 터미널을 누르세요.</p>
          <button type="button" className="primary" onClick={openSession} disabled={!selectedId || opening}>새 터미널</button>
        </div>}
        {tabs.map((tab) => <TerminalPane
          key={tab.id}
          ref={(value) => { if (value) paneRefs.current.set(tab.id, value); else paneRefs.current.delete(tab.id); }}
          session={tab}
          active={tab.id === activeId}
          onExit={handleExit}
        />)}
      </div>
      <footer className="terminal-statusbar">
        <span><i className={activeTab?.status || "idle"} />{activeTab ? (activeTab.status === "active" ? "연결됨" : "종료됨") : "대기 중"}</span>
        {activeTab && <><span>{activeTab.runtime}</span><span>{activeTab.name}</span><span>{activeTab.shell === "auto" ? "자동 셸" : activeTab.shell}</span></>}
      </footer>
    </section>
  </Page>;
}

export default function TerminalPage({ containers = [] }) {
  return terminalBridge.available
    ? <DesktopTerminal containers={containers} />
    : <BrowserCommandTerminal containers={containers} />;
}
