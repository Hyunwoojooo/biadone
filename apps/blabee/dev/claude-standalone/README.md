# 독립 Claude 개발 앱

이전 Node Coordinator와 별도 Swift/AppKit Pet를 보존한 검증용 앱입니다.
제품 공통 엔진 코드는 이 폴더에 복사하지 않습니다. 현재 제품 bridge는
[bridges/claude](../../bridges/claude/README.md)에서 개발합니다.

이 디렉터리에서 기존 SDK 1.30.0 lockfile로 의존성을 설치합니다.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm run app
npm run claude -- --cwd /absolute/project/path
```

`app`과 `claude`는 개발 앱 및 새 Claude 세션을 실행합니다. 사용자가 실행을 요청한
경우에만 사용하고 기존 설치 Blabee·Codex 세션·제품 소켓을 변경하지 않습니다.
테스트는 `../../Tests/bridges/claude/standalone/`에 있으며 실제 실행 앱을 먼저 빌드합니다.
앱 생성물과 기본 개발 runtime은 루트 `build/claude-standalone/`에 둡니다.
기본 소켓은 그 아래 `runtime/blabee-claude.sock`이며, 깊은 소스 경로가 macOS의
Unix 소켓 길이 제한을 넘지 않도록 개발 생성물을 분리했습니다.
임시 테스트 생성물은 루트 `build/claude-tests/`입니다.
기존 `claude/build/` runtime을 옮기거나 자동으로 재사용하지 않습니다.
기존 실행을 확인할 때는 명시적인 `--runtime /absolute/existing/runtime`을 사용합니다.
제품 식별자·runtime 분리 기준은 [APP_SEPARATION](docs/APP_SEPARATION.md),
이전 검증 기록은 [QA_REPORT](docs/QA_REPORT.md)에 있습니다.
