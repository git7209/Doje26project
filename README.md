# LXC 컨테이너 관리 대시보드

Node.js 대시보드에서 로컬 Docker Engine의 이미지와 컨테이너를 관리하는 프로젝트입니다.

## 실행 준비

1. Docker Engine을 실행합니다.
2. `.env.example`을 `.env`로 복사합니다.
3. `npm start`를 실행합니다.
4. `http://localhost:8080`을 엽니다.

현재 Windows 환경에서는 Docker Engine이 Ubuntu WSL2 안에 설치되어 있으므로 다음
명령으로 서버를 실행합니다.

```powershell
wsl -d Ubuntu -u root -- bash -lc "cd /mnt/c/Users/deok7/LxcProgramMade && /usr/bin/npm start"
```

서버는 기본적으로 `127.0.0.1`에서만 요청을 받습니다. Docker socket 접근 권한은
호스트 관리자 권한과 비슷하므로, 인증 기능을 추가하기 전에는 `HOST=0.0.0.0`으로
외부에 공개하지 마세요.

기본 Docker 소켓은 Linux/macOS에서 `/var/run/docker.sock`, Windows에서
`//./pipe/docker_engine`입니다. 다른 로컬 소켓을 사용하면 `.env`의
`DOCKER_SOCKET`에 경로를 지정합니다.

## 현재 Docker 연동 범위

- 로컬 이미지 목록 조회
- 전체 컨테이너 목록과 상태 조회
- 컨테이너 생성
- CPU 개수, 메모리, 포트 바인딩 적용

포트는 `8080:80` 또는 `5353:53/udp` 형식이며 여러 개는 쉼표로 구분합니다.
보안을 위해 공개 포트는 기본적으로 `127.0.0.1`에만 바인딩됩니다.

컨테이너 생성 후에는 자동으로 시작하지 않습니다. 시작·중지·삭제와 실시간 자원
사용량은 다음 구현 단계에서 추가합니다.
