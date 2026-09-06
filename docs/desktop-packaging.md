# Container Check 데스크톱 패키징

## 실행 환경

- Windows 10/11 x64
- Docker가 실행 중인 WSL2 배포판 또는 Docker Desktop
- 소스에서 빌드할 때 Node.js와 npm

Windows 앱은 실행 시 Docker가 동작하는 WSL 배포판을 먼저 찾고, 없으면 Windows Docker Engine을 사용합니다. 대시보드와 대화형 터미널은 항상 같은 엔진에 연결됩니다. 특정 런타임을 선택하려면 앱 실행 전에 다음 환경 변수를 설정할 수 있습니다.

- `CONTAINER_CHECK_WSL_DISTRO=Ubuntu`: 지정한 WSL 배포판을 우선 사용
- `CONTAINER_CHECK_DOCKER_RUNTIME=native`: Windows Docker Engine을 우선 사용

## 빌드

```powershell
npm ci
npm --prefix frontend ci
npm test
npm run package:win
```

설치 프로그램은 `release/Container-Check-Setup-1.0.0-x64.exe`에 생성됩니다. 설치하지 않고 실행할 수 있는 파일은 `release/win-unpacked/Container Check.exe`입니다.

패키지 내부의 Docker API와 대화형 PTY를 실제 WSL 컨테이너로 검증하려면 다음 명령을 사용합니다.

```powershell
npm run package:smoke -- Ubuntu
```

## 배포 참고

현재 로컬 빌드는 코드 서명 인증서로 서명되지 않습니다. 다른 PC에 배포할 때 Windows SmartScreen 경고를 줄이려면 신뢰할 수 있는 코드 서명 인증서를 electron-builder에 연결해야 합니다.
