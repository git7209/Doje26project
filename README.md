# LXC 컨테이너 관리 대시보드

Node.js 대시보드에서 로컬 Docker Engine의 이미지와 컨테이너를 관리하는 프로젝트입니다.

## 실행 준비

1. Docker Engine을 실행합니다.
2. `.env.example`을 `.env`로 복사합니다.
3. Windows PowerShell에서 `npm run build`로 React 화면을 빌드합니다.
4. WSL에서 `npm start`를 실행합니다.
5. `http://localhost:8081`을 엽니다.

현재 Windows 환경에서는 Docker Engine이 Ubuntu WSL2 안에 설치되어 있으므로 다음
명령으로 서버를 실행합니다.

```powershell
npm run build
wsl -d Ubuntu -u root -- bash -lc "cd /mnt/c/Users/deok7/LxcProgramMade && /usr/bin/npm start"
```

React 화면만 개발할 때는 백엔드를 실행한 상태에서 별도 PowerShell을 열고 다음을
사용합니다. 개발 화면은 `http://localhost:5173`이며 `/api` 요청은 8081 백엔드로
자동 전달됩니다.

```powershell
cd frontend
npm run dev
```

VS Code Live Server의 `http://localhost:5500`으로 열면 상대 경로 `/api` 요청도
5500 포트로 전달되어 Docker API와 연결되지 않습니다. 이 프로젝트는 Live Server를
사용하지 않고 Node 서버 주소인 `http://localhost:8081`로 접속합니다. Windows의
8080 포트는 기존 Apache가 사용하고 있어 기본 포트를 8081로 지정했습니다.

서버는 기본적으로 `127.0.0.1`에서만 요청을 받습니다. Docker socket 접근 권한은
호스트 관리자 권한과 비슷하므로, 인증 기능을 추가하기 전에는 `HOST=0.0.0.0`으로
외부에 공개하지 마세요.

기본 Docker 소켓은 Linux/macOS에서 `/var/run/docker.sock`, Windows에서
`//./pipe/docker_engine`입니다. 다른 로컬 소켓을 사용하면 `.env`의
`DOCKER_SOCKET`에 경로를 지정합니다.

## 로그인 데이터베이스

회원 계정은 PostgreSQL의 `users` 테이블에, 로그인 세션은 `user_sessions`
테이블에 저장됩니다. 서버가 첫 인증 요청을 받을 때 테이블을 자동으로 생성합니다.
`.env`의 `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`를 실제
PostgreSQL 접속 정보로 설정해야 합니다. HTTPS로 배포할 때는
`AUTH_COOKIE_SECURE=true`로 설정하세요.

## 현재 Docker 연동 범위

- 로컬 이미지 목록 조회
- 전체 컨테이너 목록과 상태 조회
- 컨테이너 생성
- 컨테이너 시작, 중지, 재시작, 삭제
- 실행 중 컨테이너의 CPU 및 메모리 사용량 조회
- CPU 개수, 메모리, 포트 바인딩 적용

포트는 `8080:80` 또는 `5353:53/udp` 형식이며 여러 개는 쉼표로 구분합니다.
보안을 위해 공개 포트는 기본적으로 `127.0.0.1`에만 바인딩됩니다.

컨테이너 생성 후에는 자동으로 시작하지 않습니다. 실행 중인 컨테이너는 먼저
중지해야 삭제할 수 있습니다. 대시보드를 새로 고칠 때 실제 Docker 통계를 조회합니다.
