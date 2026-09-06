# Container Check 데스크톱 터미널 설계

## 1. 결정 사항

- 데스크톱 패키징은 현재 React + Node.js 구조와 가장 잘 맞는 Electron을 기준으로 한다.
- 렌더러에는 Node.js, Docker 소켓, `child_process`, `ipcRenderer`를 직접 노출하지 않는다.
- 데스크톱 터미널 데이터는 localhost WebSocket이 아니라 Electron IPC/MessagePort로 전달한다.
- Docker Desktop 또는 Linux/macOS에서는 Docker Engine의 interactive exec 스트림에 직접 연결한다.
- Windows의 WSL2 배포판 내부에만 Docker Engine이 있으면 `node-pty`로 하나의 지속형
  `wsl.exe ... docker exec -it` 프로세스를 실행한다.
- 두 실행 방식을 `TerminalTransport` 인터페이스 뒤에 숨겨 UI와 세션 관리 코드는 공유한다.
- 첫 버전은 실행 중인 Linux 컨테이너의 셸만 지원한다. 호스트 PowerShell/WSL 셸은 범위에서 제외한다.

현재 `POST /api/containers/:id/exec`는 명령마다 새 Docker Exec을 만들고 출력이 끝날 때까지
모아서 반환한다. 이 방식은 간단한 명령 실행 기능으로는 유지할 수 있지만, 대화형 터미널의
기반으로 사용하지 않는다.

## 2. 목표 사용자 경험

1. 사용자가 실행 중인 컨테이너를 선택하고 `터미널 열기`를 누른다.
2. 1초 안에 셸 탭이 열리고 커서가 입력 가능한 상태가 된다.
3. `cd`, 셸 변수, 명령 기록 등 상태가 같은 탭 안에서 유지된다.
4. Tab, 방향키, Ctrl+C, Ctrl+D, ANSI 색상, 전체 화면 프로그램이 동작한다.
5. 화면 크기가 바뀌면 컨테이너 TTY의 행/열도 함께 바뀐다.
6. 컨테이너 정지, 셸 종료, 연결 오류를 서로 다른 상태로 보여준다.
7. 탭이나 앱을 닫으면 연결된 Exec/PTY가 남지 않는다.

## 3. 전체 구조

```text
React renderer
  TerminalPage + xterm.js
          │
          │ window.containerCheck.terminal (좁은 preload API)
          ▼
Electron preload
          │
          │ IPC invoke + MessagePort/event
          ▼
Electron main
  TerminalSessionManager
          │
          ├── DockerExecTransport
          │     └── Docker Engine socket/named pipe
          │
          └── WslPtyTransport
                └── node-pty → wsl.exe → docker exec -it
```

### 권장 파일 구조

```text
desktop/
  main.cjs
  preload.cjs
  ipc/
    register-terminal-ipc.cjs
    validate-sender.cjs
  runtime/
    detect-docker-runtime.cjs
  terminal/
    terminal-session-manager.cjs
    terminal-errors.cjs
    docker-exec-transport.cjs
    wsl-pty-transport.cjs

frontend/src/
  components/terminal/
    TerminalPage.jsx
    TerminalTabs.jsx
    TerminalViewport.jsx
    TerminalStatusBar.jsx
  hooks/
    useTerminalSession.js
  desktop/
    terminalBridge.js
```

`ConsolePages.jsx`에 들어 있는 현재 `TerminalPage`는 위 전용 폴더로 분리한다.

## 4. 렌더러와 preload 계약

preload는 범용 `send(channel, value)` 함수를 노출하면 안 된다. 다음 기능만 명시적으로 노출한다.

```js
window.containerCheck.terminal = {
  open({ containerId, cols, rows, shell }),
  write({ sessionId, data }),
  resize({ sessionId, cols, rows }),
  close({ sessionId }),
  acknowledge({ sessionId, sequence }),
  onData(listener),
  onState(listener),
  onExit(listener),
};
```

### 요청과 응답

#### `open`

```js
// request
{
  containerId: "64자리 Docker ID",
  cols: 120,
  rows: 32,
  shell: "auto"
}

// response
{
  sessionId: "무작위 UUID",
  containerId: "...",
  shell: "/bin/sh",
  state: "active"
}
```

#### 출력 이벤트

```js
{
  sessionId: "...",
  sequence: 17,
  data: Uint8Array
}
```

#### 상태 이벤트

```js
{
  sessionId: "...",
  state: "opening | active | closing | closed | failed",
  reason: "user | shell_exit | container_stopped | renderer_gone | app_exit | transport_error",
  message: "사용자에게 표시할 안전한 메시지"
}
```

Renderer는 `data`를 그대로 `xterm.write(data)`에 전달한다. 키 입력은 `terminal.onData()`에서
받아 UTF-8 바이트로 `write`에 전달한다. 출력 텍스트를 JSON 문자열로 변환하지 않는다.

## 5. 세션 관리자

`TerminalSessionManager`가 모든 터미널 수명주기를 소유한다.

```js
sessions: Map<sessionId, {
  id,
  ownerWebContentsId,
  containerId,
  transport,
  state,
  cols,
  rows,
  createdAt,
  lastActivityAt,
  outputSequence,
  unacknowledgedBytes
}>
```

### 수명주기

```text
open 요청
  → 입력 검증
  → 컨테이너 실행 상태 확인
  → transport 선택
  → opening
  → 셸 시작 및 최초 resize
  → active
  → 입력/출력/resize
  → close 또는 프로세스 exit
  → closing
  → 스트림, 소켓, PTY 정리
  → closed
```

다음 상황에는 강제로 정리한다.

- 소유한 BrowserWindow가 닫힘
- 렌더러가 새로고침됨
- 앱 `before-quit`
- 컨테이너가 중지되거나 삭제됨
- 30분 동안 입력과 출력이 모두 없음(설정에서 변경 가능)
- 출력 소비가 장시간 멈춤

한 창에서 최대 6개, 앱 전체에서 최대 12개 세션만 허용한다. 같은 컨테이너에 여러 세션은
허용하되 각 세션은 독립 Exec으로 만든다.

### 출력 backpressure

터미널 출력이 빠른 경우 렌더러 IPC 큐가 무한히 커지지 않게 한다.

- 출력은 최대 16KB 또는 16ms 단위로 합쳐 보낸다.
- 이벤트마다 증가하는 `sequence`를 붙인다.
- 렌더러가 마지막 처리 sequence를 확인 응답한다.
- 미확인 데이터가 512KB를 넘으면 Docker stream/PTY를 `pause()`한다.
- 128KB 아래로 내려가면 `resume()`한다.
- 10초 동안 확인 응답이 없으면 해당 세션을 `transport_error`로 종료한다.

## 6. Transport 인터페이스

```js
class TerminalTransport {
  async open({ containerId, cols, rows, shell }) {}
  write(data) {}
  resize(cols, rows) {}
  close() {}
  pause() {}
  resume() {}
  onData(listener) {}
  onExit(listener) {}
  onError(listener) {}
}
```

### 6.1 DockerExecTransport

적용 환경:

- Windows Docker Desktop의 `//./pipe/docker_engine`
- Linux/macOS의 `/var/run/docker.sock`
- 사용자가 명시한 `DOCKER_SOCKET`

필요한 Docker API 흐름:

1. `POST /containers/{id}/exec`
2. `AttachStdin`, `AttachStdout`, `AttachStderr`, `Tty`를 모두 `true`로 설정
3. `POST /exec/{execId}/start`를 `Detach: false`, `Tty: true`로 시작
4. 응답 연결을 끝까지 모으지 말고 양방향 raw stream으로 유지
5. 크기 변경 시 `POST /exec/{execId}/resize?h={rows}&w={cols}`
6. 종료 시 socket을 닫고 `GET /exec/{execId}/json`으로 종료 상태를 확인

현재 `DockerEngine.request()`는 응답을 Buffer로 전부 모으므로 그대로 사용할 수 없다.
다음 메서드를 별도로 추가한다.

```js
DockerEngine.openInteractiveExec(containerId, options)
DockerEngine.resizeExec(execId, rows, cols)
DockerEngine.inspectExec(execId)
```

일반 JSON 요청과 hijacked/raw stream 요청을 같은 메서드에 억지로 섞지 않는다.

TTY를 `true`로 사용하면 stdout/stderr가 하나의 터미널 스트림으로 합쳐지고 ANSI 제어 문자를
그대로 받을 수 있다. TTY가 없는 로그/명령 실행 기능을 나중에 추가할 경우 Docker의 multiplexed
stream 헤더를 별도로 해석해야 한다.

### 6.2 WslPtyTransport

적용 환경:

- Windows 앱에서 named pipe Docker Engine을 찾지 못함
- 선택한 WSL2 배포판 안에서는 `docker info`가 성공함

MVP 명령 형태:

```text
wsl.exe -d <검증된 배포판 이름> --
  docker exec -it <검증된 컨테이너 ID> /bin/sh
```

이 명령은 입력할 때마다 실행하지 않는다. `node-pty`로 한 번 실행하고 탭이 닫힐 때까지
같은 프로세스와 ConPTY를 유지한다. `pty.write()`와 `pty.resize()`를 사용한다.

보안 조건:

- 배포판 이름은 `wsl.exe --list --quiet` 결과 중 하나만 허용한다.
- 컨테이너 ID는 현재 Engine 목록에서 얻은 전체 ID와 대조한다.
- 셸은 허용 목록에서만 고른다.
- 문자열을 `cmd.exe /c` 또는 PowerShell 명령 문자열로 조합하지 않는다.
- 실행 파일과 각 인자를 분리하여 전달한다.
- 관리자/root로 자동 승격하지 않는다.

장기적으로 WSL에 자체 helper를 번들해 Docker Engine API에 직접 붙일 수 있지만, MVP에서는
`node-pty + docker exec`가 설치 및 디버깅 복잡도가 더 낮다.

## 7. Runtime 자동 감지

앱 시작 시 다음 순서로 검사한다.

1. 환경 변수 또는 사용자 설정의 `DOCKER_SOCKET`
2. Windows named pipe `//./pipe/docker_engine`
3. Linux/macOS `/var/run/docker.sock`
4. Windows라면 WSL 배포판 목록 조회
5. 각 후보 배포판에서 짧은 제한 시간으로 `docker info` 확인

자동 감지가 여러 WSL 배포판을 찾으면 임의로 root 배포판을 선택하지 않고 설정 화면에서
사용자에게 한 번 선택하게 한다. 선택은 Electron의 userData 디렉터리에 저장한다.

상태 코드는 UI에서 구분한다.

```text
DOCKER_NOT_FOUND
DOCKER_PERMISSION_DENIED
WSL_NOT_INSTALLED
WSL_DISTRO_NOT_FOUND
DOCKER_CLI_NOT_FOUND_IN_WSL
CONTAINER_NOT_RUNNING
NO_SUPPORTED_SHELL
TERMINAL_SESSION_LIMIT
TERMINAL_CONNECTION_LOST
```

## 8. 셸 선택

초기값은 `auto`다.

Linux 컨테이너:

```text
/bin/bash → /bin/ash → /bin/sh
```

실제로는 `/bin/sh`를 부트스트랩으로 실행해 사용 가능한 셸을 찾고 `exec`로 교체한다.
`/bin/sh`조차 없는 distroless/scratch 이미지는 `NO_SUPPORTED_SHELL`로 안내한다.

Windows 컨테이너 지원을 추가할 때만 다음 후보를 활성화한다.

```text
powershell.exe → pwsh.exe → cmd.exe
```

MVP에서는 사용자가 임의 실행 파일이나 시작 명령을 입력하게 하지 않는다. 이후 고급 설정에서
허용 목록 방식으로 확장한다.

## 9. xterm.js 화면 설계

필수 패키지:

```text
@xterm/xterm
@xterm/addon-fit
@xterm/addon-search
@xterm/addon-web-links
```

### 구성

- 상단: 실행 중인 컨테이너 선택기, 새 탭, 검색, 전체 화면, 종료
- 탭: `컨테이너명 — shell`과 연결 상태 표시
- 본문: xterm.js viewport
- 하단: Engine 종류, 컨테이너명, shell, `cols × rows`, 연결 상태

### 동작

- `FitAddon.fit()` 이후 계산된 cols/rows로 세션을 연다.
- `ResizeObserver`로 부모 크기를 감지하고 100ms debounce 후 resize를 보낸다.
- xterm의 `onData`는 입력 원문을 그대로 전달한다.
- 컨테이너에서 받은 `Uint8Array`는 디코딩 없이 xterm에 쓴다.
- Ctrl+C는 복사할 선택 영역이 있을 때만 복사로 처리하고, 없으면 `\x03`을 컨테이너에 보낸다.
- Ctrl+V/Shift+Insert 붙여넣기는 Electron clipboard 정책을 통과시킨다.
- 터미널 기록은 메모리에만 두고 기본적으로 디스크에 저장하지 않는다.
- 탭을 다른 메뉴로 이동해도 세션은 유지하고, 사용자가 탭을 닫을 때 종료한다.

권장 기본값:

```js
{
  cursorBlink: true,
  convertEol: false,
  scrollback: 5000,
  fontFamily: "Cascadia Mono, Consolas, monospace",
  fontSize: 13,
  allowTransparency: false
}
```

## 10. Electron 보안 설정

BrowserWindow 기본값:

```js
{
  webPreferences: {
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false
  }
}
```

추가 요구사항:

- 패키징된 로컬 UI만 로드하고 임의 URL navigation을 차단한다.
- `window.open`은 기본 차단한다.
- `Content-Security-Policy`는 최소 `default-src 'self'`를 기준으로 구성한다.
- 모든 IPC에서 sender가 메인 앱 창인지 검증한다.
- preload는 메서드별 API만 노출하고 원본 `ipcRenderer`를 노출하지 않는다.
- Docker 오류의 내부 socket 경로나 명령 전체를 사용자 메시지에 그대로 노출하지 않는다.
- renderer가 보낸 container ID를 신뢰하지 않고 Engine의 현재 컨테이너 목록과 대조한다.
- `node-pty` 네이티브 바이너리는 패키지 서명 대상과 `asarUnpack` 설정에 포함한다.

Docker 소켓 접근 권한은 사실상 호스트 제어 권한과 비슷하다. 터미널 기능 자체보다 renderer에서
Docker 권한 계층으로 넘어가는 IPC 경계를 가장 엄격하게 관리해야 한다.

## 11. 기존 웹 모드와의 관계

React 앱이 일반 브라우저에서도 실행될 수 있으므로 bridge 유무로 기능을 나눈다.

```js
const interactiveAvailable = Boolean(window.containerCheck?.terminal);
```

- Electron: xterm 기반 interactive terminal 제공
- 일반 브라우저: 현재의 한 줄 명령 실행 UI를 제한 모드로 유지하거나 읽기 전용 안내 표시

웹 모드까지 interactive하게 만들 필요가 생기면 그때 인증된 WebSocket 프로토콜을 별도 설계한다.
데스크톱 MVP를 위해 localhost WebSocket 서버를 먼저 노출하지 않는다.

## 12. 오류와 복구

| 상황 | 사용자 표시 | 처리 |
|---|---|---|
| 컨테이너가 이미 중지됨 | 실행 중인 컨테이너가 아닙니다 | 세션 생성하지 않음 |
| 실행 중 컨테이너가 정지됨 | 컨테이너가 정지되어 연결이 종료됐습니다 | 탭을 종료 상태로 유지 |
| 셸 명령이 없음 | 이 이미지에는 사용할 수 있는 셸이 없습니다 | distroless 안내 |
| Docker 연결 끊김 | Docker Engine 연결이 끊겼습니다 | 모든 관련 세션 종료 |
| WSL 배포판 종료 | WSL 연결이 종료됐습니다 | 재연결 버튼 표시 |
| renderer 새로고침 | 표시 없음 | 해당 renderer 소유 세션 정리 |
| 출력 과다/응답 없음 | 터미널 응답이 중단됐습니다 | backpressure timeout 후 종료 |

자동 재연결은 새 셸을 생성하므로 이전 프로세스 상태를 복구할 수 없다. 따라서 사용자 동의 없이
자동으로 새 세션을 만들지 않고 `새 세션 열기` 버튼을 제공한다.

## 13. 테스트 계획

### 단위 테스트

- 허용/거부되는 container ID, distro, shell, rows/cols 값
- 세션 상태 전이
- 창 종료 시 소유 세션만 정리
- 최대 세션 수 제한
- 출력 batching, sequence, pause/resume
- 중복 close의 멱등성
- transport 오류를 안전한 UI 오류로 변환

### Docker 통합 테스트

테스트 컨테이너는 작은 Alpine 이미지를 사용한다.

- 셸이 열리고 prompt가 나타남
- `echo hello` 출력
- `cd /tmp` 다음 `pwd`가 `/tmp`를 출력하여 상태가 유지됨
- `sleep 30`에 Ctrl+C 전송 시 중단됨
- `stty size`가 resize 이후 값과 일치
- 한글 UTF-8 입출력
- `exit` 시 정상 종료 이벤트
- 컨테이너 stop 시 종료 이유가 `container_stopped`

### Windows/WSL 테스트

- WSL 미설치
- 배포판은 있으나 Docker CLI 없음
- Docker group 권한 없음
- 여러 배포판 중 선택
- WSL 배포판 종료 후 터미널 종료 처리
- 앱 종료 후 `wsl.exe`/ConPTY 프로세스가 남지 않음

## 14. 구현 단계와 완료 기준

### 1단계: 데스크톱 골격

- Electron main/preload 생성
- 로컬 빌드 UI 로드
- 안전한 BrowserWindow 설정
- 개발/패키지 실행 스크립트

완료 기준: 설치 전 개발 모드에서 기존 대시보드가 Electron 창에 정상 표시된다.

### 2단계: 터미널 세션 코어

- `TerminalSessionManager`
- preload 계약
- fake transport 단위 테스트
- renderer 종료 정리

완료 기준: 가짜 stream으로 입력/출력/resize/close가 검증된다.

### 3단계: DockerExecTransport

- Docker raw interactive stream
- exec resize/inspect
- xterm.js 연결

완료 기준: Docker Desktop/Linux에서 Alpine 컨테이너에 대화형 셸로 접속한다.

### 4단계: WslPtyTransport

- WSL 배포판 탐지 및 선택
- node-pty 패키징
- 지속형 `docker exec -it`

완료 기준: 현재 Ubuntu WSL2 Docker 컨테이너에서 입력, Ctrl+C, resize가 동작한다.

### 5단계: 제품 UI와 안정화

- 다중 탭, 검색, 전체 화면, 상태바
- 세션/출력 제한
- 오류 안내와 재연결 UX
- 앱 종료 정리 및 설치본 smoke test

완료 기준: 개발 환경과 설치된 Windows 앱에서 동일한 핵심 시나리오가 통과한다.

## 15. MVP에서 하지 않을 것

- 호스트 PowerShell, CMD, WSL 일반 셸
- 웹 브라우저 원격 interactive terminal
- SSH 접속
- 터미널 세션 복구/재부착
- 명령 기록 클라우드 저장
- 파일 업로드/다운로드 프로토콜
- Windows 컨테이너 interactive shell

이 범위를 지키면 첫 구현은 “선택한 실행 중 Linux 컨테이너에 안전하게 붙는 실제 터미널”에
집중할 수 있고, 패키징 구조를 나중에 다시 뒤집지 않아도 된다.
