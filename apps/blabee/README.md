# Blabee

macOS Pet에서 선택·승인 작업을 확인하고 원래 AI 세션으로 전달하는 앱입니다.
제품의 공통 Swift 엔진과 UI는 한 벌이며 Codex·Claude 연결 코드는 별도로 구분합니다.
디렉터리 구분과 Swift 모듈 소속은 다릅니다. 이번 정리는 기존 모듈과 동작을 보존합니다.

## 코드 찾기

| 위치 | 책임 |
| --- | --- |
| `engine/` | 의미·상태·라우팅·SQLite·검증 |
| `bridges/codex/` | Codex Hook·MCP·전달·관리형 세션·Plugin 소스 |
| `bridges/claude/` | Claude 공통 엔진 adapter·host·JS bridge |
| `app/` | 공통 UI·조정·서비스·계정·진단·업데이트 |
| `Tests/`, `Fixtures/` | Swift·Node 회귀, 참조 코어, 공통 fixture |
| `Contracts/` | v1 및 버전별 bridge 계약 |
| `Packaging/`, `scripts/` | 앱 조립·서명·검증·배포 |
| `dev/` | 독립 Claude 앱·UI 시안·촬영 예제·실험 |
| `account-web/`, `supabase/` | 독립 계정 웹, DB migration·보고 SQL |
| `docs/` | 현재 안내, 설계와 날짜가 명시된 이전 검증 기록 |

주요 진입점은 [문서 색인](docs/README.md), [이동 계획](docs/development/DIRECTORY_MIGRATION.md),
[Claude 브릿지](bridges/claude/README.md), [독립 Claude 개발 앱](dev/claude-standalone/README.md)입니다.
Claude 공통 엔진 연결 기반과 설치 앱의 최종 다중 provider 통합 완료는 구분합니다.

## 빌드·검증

Node 의존성은 기존 lockfile을 사용합니다. Swift 제품에는 새 외부 의존성이 없습니다.

```sh
npm ci --ignore-scripts
npm test
npm run test:swift
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift build --product blabee-coordinator
```

`Package.swift`는 기존 CoordinatorSwift, ClaudeCoreAdapter, BlabeeProductSupport,
BlabeeCoordinator와 테스트/helper target을 유지합니다. `test:swift`는 공용 잠금과
별도 scratch 경로를 사용합니다. 현재 구조 정리 검증의 제한은
[검증 기록](docs/development/DIRECTORY_MIGRATION.md)에 별도로 기록합니다.

Claude는 각 package에서 lockfile을 설치한 뒤 확인합니다.

```sh
npm --prefix bridges/claude ci --ignore-scripts
npm --prefix bridges/claude run check
npm --prefix bridges/claude test
npm --prefix dev/claude-standalone ci --ignore-scripts
npm --prefix dev/claude-standalone run build
npm --prefix dev/claude-standalone test
```

독립 앱 테스트에는 해당 패키지의 `npm run build`가 먼저 필요합니다. 실제 세션 실행은
각 README의 안내를 따릅니다. 테스트 통과는 실제 Codex·Claude 사용자 대화의 왕복을
자동으로 증명하지 않습니다.

## 앱 조립

기존 `build:macos-app`, `build:internal-dmg`, `build:release-dmg`, `notarize:dmg` 명령을
유지합니다. 상세 인자·서명·공증 단계는 [배포 안내](docs/development/RELEASE_DMG_PACKAGING.md)를 참고하세요.
Plugin 소스는 `bridges/codex/plugin`이지만 번들 내부의
`Contents/Resources/Plugin/blabee`와 기존 앱 식별자는 바꾸지 않았습니다.
`build/`는 생성물이며 제품 소스나 이전 사용자 runtime을 복사해 넣지 않습니다.
