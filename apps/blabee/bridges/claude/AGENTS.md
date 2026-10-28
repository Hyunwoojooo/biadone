# Project AGENTS.md

## 2026-09-20 디렉터리 정리 이후

현재 범위는 `bridges/claude/`, 공통 회귀는 `Tests/bridges/claude/`, 독립 앱은
`dev/claude-standalone/`입니다. 아래 `claude/` 구조·명령은 이동 전 설명입니다.
현재 경로·명령은 같은 디렉터리 README.md와 package.json을 우선합니다.
기존 제품/runtime 격리·무관한 변경 보존·Git 게시 승인 규칙은 유지합니다.

이 지침은 `apps/blabee/claude/`에만 적용한다. 이 폴더는 공통 Blabee에 연결할 Claude 브릿지의 개발 공간이다. 현재 `blabee-claude` 앱과 Node Coordinator는 독립 검증용 런타임으로 유지한다. 최종 제품은 [SHARED_ENGINE_PLAN.md](../../docs/bridges/claude/SHARED_ENGINE_PLAN.md)의 공통 Swift 엔진과 도구별 브릿지 구조를 따른다. 다른 세션에서 수정 중인 기존 Blabee와 파일 변경 범위 및 실행 환경을 분리한다.

## Stack

- Framework: 공통 Swift Coordinator에 연결하는 Claude Hook·MCP bridge. 기존 독립 검증 버전은 Swift/AppKit Pet + Node.js Coordinator.
- Language: Swift 6, JavaScript ESM, Markdown.
- Package manager: npm. Node.js 22 이상. MCP SDK 버전은 lockfile로 고정한다.
- Database: 공통 경로는 runtime별 SQLite. 기존 독립 검증 버전은 원자적 JSON journal. 외부 DB 없음.
- Test framework: Node 내장 `node:test`; 실제 Swift/UDS·MCP 자식 프로세스 테스트 포함.

## Commands

- Install: `npm ci --ignore-scripts --cache ./build/npm-cache`
- Common-engine Claude session: `npm run claude:shared -- --coordinator-bin /absolute/product/blabee-coordinator --cwd /absolute/project/path`
- Prepared local live session: `npm run claude:live`. `build/shared-pet-live/`의 준비된 제품 빌드·테스트 폴더와 `--pet`을 위 launcher에 전달한다.
- Common-engine validation: `npm run test:common-pet`, `npm run test:shared-engine`, `npm run test:native-session`, `npm run test:product-ingress`
- Legacy development app: `npm run app`
- Legacy development Claude session: `npm run claude -- --cwd /absolute/project/path`
- Build: `npm run build`. 출력은 `build/` 안에 둔다. 실행 중인 앱을 덮어쓰지 않는다.
- Typecheck: 빌드 시 Swift 6 컴파일. JavaScript 별도 정적 타입 검사 없음.
- Syntax: `npm run check`. 별도 lint 설정 없음.
- Test: `npm test`. 앱 관련 테스트 전 빌드 필요. Unix socket 사용을 허용하는 실행 환경이 필요하다.
- Doctor: `npm run doctor`
- Live acceptance: 실제 Claude 대화의 제안 → Pet 선택 → 같은 세션의 실행·완료. 자동 protocol 테스트와 구분한다.

명령은 이 `claude/`에서 실행한다. 상위 Blabee의 명령을 이 프로젝트의 명령으로 대신 실행하지 않는다.

공통 엔진 연결 확인이나 도구 미등록 문의에는 [README의 현재 공통 엔진 안내](../../docs/history/claude/README_PRE_LAYOUT.md)를 먼저 따른다. `claude:shared`가 새 세션에 Hook·MCP를 전달하고 전용 Coordinator도 시작하므로 기존 `app`/`doctor`는 사전 단계가 아니다. 이 launcher의 도구는 `_v1` 이름이며, 실제 세션의 도구 목록을 확인한다. 일반 `claude`로 시작한 기존 세션이나 `tests/` 폴더에는 자동 등록되지 않는다. `--pet`은 기존 공통 UI를 같은 host에 연결한다. 이전 독립 앱의 도구·화면과 섞어 설명하지 않는다.

## Project structure

- `Plugin/`: workflow 참고 파일. 아직 설치 가능한 플러그인 패키지가 아니다.
- `src/`: Claude용 연동과 실행 코드.
- `scripts/`: 빌드·앱 실행·doctor·새 Claude 세션 launcher.
- `tests/`: Claude용 테스트와 픽스처.
- `build/`: 생성물과 개발용 임시 실행 데이터. `.gitkeep` 외에는 Git에서 제외한다.
- `CLAUDE.md`: Claude Code에서 이 작업 규칙을 읽기 위한 안내.
- `README.md`: 현재 상태와 폴더 구성.
- `APP_SEPARATION.md`: 제품 이름·실행 식별자·경로와 동시 실행 기준.
- `IMPLEMENTATION_PLAN.md`: 현재 구현과 IPC 계약.
- `QA_REPORT.md`: 자동 검증과 실제 실행 증거, 남은 확인.

## Project rules

- 독립 브릿지 작업의 기본 범위는 이 `claude/`다. 사용자가 승인한 공통 엔진·Pet 통합에는 상위 `ClaudeCoreAdapter`, native host, 공통 Pet의 provider 연결과 관련 테스트를 포함한다. 상세 범위는 [COMMON_PET.md](../../docs/bridges/claude/COMMON_PET.md)를 따른다. 그 외 상위 소스·Plugin·설치·패키징은 별도 승인 범위다.
- 제품 식별자와 runtime 분리는 [APP_SEPARATION.md](../../dev/claude-standalone/docs/APP_SEPARATION.md)를 따른다. 기존 `Blabee.app`을 `blabee-codex`로 이름 변경하지 않는다. Claude용 앱은 기존 앱과 동시에 독립 실행 가능해야 한다.
- 기존 파일을 이동·정리·포맷하거나 다른 세션의 변경을 되돌리지 않는다. 기존 코드와의 공통화는 별도 작업 범위로 다룬다.
- 빌드 결과와 임시 실행 데이터는 이 폴더의 `build/` 아래에 둔다. 기존 Blabee의 앱, 서비스, 소켓, 데이터베이스와 설치 설정을 공유하거나 변경하지 않는다. 실행 연동을 추가할 때 Claude 전용 경로와 식별자를 먼저 정한다.
- Claude용 연결 실패 시 기존 Codex용 socket·서비스로 fallback하지 않는다. 기존 공통 `BLABEE_*` 실행 설정을 Claude용 설정으로 자동 적용하지 않는다. 종료·업데이트·제거는 Claude용의 정확한 식별자와 경로만 대상으로 삼는다.
- 이 폴더는 부모 Git checkout의 브랜치를 공유한다. GitHub의 `claudecode` 브랜치와 자동으로 연결되는 폴더가 아니다. 기존 작업 폴더에서 브랜치를 전환하지 않는다.
- 별도 브랜치에서 독립적으로 커밋해야 할 때는 별도 worktree를 사용한다. 다른 세션의 미커밋 변경을 자동 복사하거나 stash하지 않는다.
- 명시적인 사용자 요청 없이 commit, push, merge, rebase, 브랜치 삭제 또는 이력 변경을 하지 않는다. staging을 요청받으면 승인된 경로만 지정한다.
- 의존성은 필요성을 설명한 뒤 추가한다. 비밀값, 인증 정보, 토큰, 개인 키와 운영 환경 파일은 수정하지 않는다.
- 동작이나 공개 계약을 바꾸면 관련 테스트와 문서를 함께 갱신한다.

## Done means

- 변경 파일은 승인된 브릿지·공통 연결 범위 안에 있고, 생성물은 `claude/build/`에 있다.
- Codex 기존 동작의 회귀를 확인하고, 설치 상태와 실행 서비스를 변경하지 않았다.
- 동작 변경이 있으면 해당 테스트와 적용 가능한 typecheck·lint 결과를 보고한다.
- 앱 또는 runtime을 구현하면 두 제품의 동시 실행, 제품별 중복 실행 제어, Claude용 종료·재시작이 Codex용에 영향을 주지 않는지 검증한다. 문서만으로 동시 실행을 검증했다고 보고하지 않는다.
- 폴더·문서만 변경한 경우에는 구조, Git 추적·제외 규칙과 변경 범위를 확인한다.
- 완료 보고에 변경 내용, 검증 결과와 아직 구현하지 않은 부분을 구분한다.
