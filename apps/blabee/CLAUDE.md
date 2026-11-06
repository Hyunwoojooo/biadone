@AGENTS.md

# Blabee Claude Code 작업 안내

2026-11-04부터 Blabee 유지관리는 Claude Code로 한다. 위에 import한 Blabee AGENTS.md의 책임 구분·보호 규칙은 그대로 유효하다
(CLAUDE.md가 있으면 AGENTS.md가 자동 로드되지 않으므로 import로 유지한다). 이 문서는 세션을 영역별로 나누는 방법과
영역을 넘나들 때 지킬 공통 규칙을 더한다.

## 저장소 루트 규칙 요약

이 CLAUDE.md가 생기면서 저장소 루트 `AGENTS.md`(`../../AGENTS.md`)는 기본 설정에서 자동 로드되지 않고, 프로젝트 밖 경로는 import되지 않는다.
2026-11-06부터 이 저장소 사용자의 Claude Code 설정(`/config` → Project instructions = `claude-md-and-agents-md`)으로 AGENTS.md도 함께 로드된다.
다른 환경에서는 그렇지 않을 수 있으므로 아래 요약을 유지한다.
Blabee에 해당하는 루트 규칙을 여기 옮긴다. 원문이 우선한다.

- 요청한 작업을 푸는 최소한의 되돌릴 수 있는 변경을 택한다. 무관한 파일은 건드리지 않는다.
- 공개 API·계약은 테스트와 문서를 함께 갱신하지 않고는 바꾸지 않는다. 새 의존성은 이유를 설명한 뒤에만 추가한다.
- 각 하위 프로젝트의 이름·폴더·테스트 관례를 따른다. 동작을 바꾸면 가능한 한 테스트를 추가·갱신한다.
- 비밀값·인증 정보·토큰·개인 키·운영 환경 파일을 수정하지 않는다.
- 명시적 승인 없이 commit·push·merge·rebase·브랜치 삭제·이력 변경을 하지 않는다.
- 테스트를 돌릴 수 없으면 이유와 수동 확인 방법을 적는다.
- 완료 기준: 관련 테스트나 수동 확인 통과, 해당 시 typecheck·lint 통과, 바뀐 동작은 테스트나 문서로 커버,
  보고에는 변경 내용·파일·실행한 검사·위험·남은 후속 작업을 적는다.

## 세션 영역

이전 Codex 작업과 같이 세션을 네 영역으로 나눈다. 세션은 항상 `apps/blabee`에서 시작하고
첫 메시지에서 영역을 선언한다: `/blabee-engine`, `/blabee-codex-bridge`, `/blabee-claude-bridge`, `/blabee-db`.
영역 폴더의 CLAUDE.md는 그 폴더의 파일을 읽거나 고칠 때 자동으로 로드된다.

| 영역 | 소유 경로 | 영역 안내 |
| --- | --- | --- |
| Engine | `engine/`, `Contracts/v1/`, `Fixtures/v1/`, `Tests/support/reference-engine/`, `Tests/Contracts/`, `Tests/CoordinatorCore/`, `Tests/CoordinatorPersistence/`, `Tests/CoordinatorOperational/`, `Tests/swift/CoordinatorSwiftTests/`, `app/coordination/CoordinatorOperationalApplication.swift`, `app/coordination/PetEventArrivalLedger.swift` | `engine/CLAUDE.md` |
| Codex Bridge | `bridges/codex/`, `Fixtures/codex/`, `scripts/qualify-codex-compatibility.mjs`, `scripts/verify-update-managed-codex-native.py`, `Tests/RuntimeQualification/`, `Tests/swift/BlabeePetTests/`의 `Codex*`·`ManagedCodex*`·`UpdateManagedCodex*`·`Hook*`·`PetHookReadiness*` | `bridges/codex/CLAUDE.md` |
| Claude Bridge | `bridges/claude/`, `Contracts/bridge/`, `Tests/bridges/claude/`, `scripts/prepare-claude-runtime.mjs`, `scripts/sign-claude-runtime.mjs`, `dev/claude-standalone/` | `bridges/claude/CLAUDE.md` |
| DB | `supabase/`, `Tests/Cloud/`, `app/account/`, `app/telemetry/`, `account-web/` | `supabase/CLAUDE.md` |

공통 앱 셸(`app/entrypoints/`, `app/service/`, `app/ui/`, `app/update/`, 위 두 파일을 뺀 나머지 `app/coordination/`, `Packaging/`,
`scripts/build-*`, `Tests/AppPackaging/`)은 어느 영역에도 속하지 않는다. 필요한 세션이 사용자에게 범위를 확인한 뒤 고친다.
`app/coordination`의 두 파일은 `Package.swift`의 `coordinatorSwiftSources`에 들어 있어 CoordinatorSwift 타깃이므로 Engine이 맡지만,
`CoordinatorOperationalApplication.swift`의 Hook·승인 어댑터 부분은 Codex Bridge와 경계를 공유한다.

## 영역 밖 파일과 다른 세션의 변경

- 작업 전 `git status --short`로 다른 세션의 미커밋 변경을 확인한다. 그 파일은 읽을 수 있지만 수정·되돌리기·stash·포맷하지 않는다.
- 영역 밖 파일을 고쳐야 작업이 끝나면, 고치기 전에 사용자에게 파일과 이유를 말하고 확인을 받는다.
  계약(`Contracts/v1`, `Contracts/bridge`)을 바꾸면 양쪽 영역의 테스트를 함께 돌린다.
- 여러 세션이 함께 쓰는 파일(`Package.swift`, `package.json`, `README.md`, `docs/github/public/CHANGELOG*.md`)은 작업 끝에 한 세션이 모아서 고친다.

## 모든 영역에서 지키는 것

- **ContractPin.** `Contracts/v1`의 manifest와 schema 10개는 SHA-256으로 고정된다. 공백 하나만 바뀌어도 데몬이 시작되지 않는다. 변경 절차는 `engine/CLAUDE.md`.
- **식별자.** bundle ID `com.biadone.blabee`, LaunchAgent `com.biadone.blabee.coordinator`, Keychain 서비스명, HMAC 도메인 문자열,
  SQLite `schema_version` 1, UserDefaults 동의 키, MCP 서버명 `blabee-claude`와 `_v1` 도구명, wire 스키마 문자열. 정리 중 바꾸지 않는다.
- **Fallback 금지.** 실패한 전달을 자동 재전송하지 않는다(`automatic_retry`는 항상 false). Claude 연결 실패 시 Codex socket으로 넘어가지 않는다.
  이전 boundary나 선택을 추측해 재사용하지 않는다.
- **비밀값.** `.env*`, 인증 정보, notary 프로필, delivery_token·auth token 원문은 수정·출력·로그에 남기지 않는다. 해시만 기록한다.
- **운영 DB.** 운영 Supabase에 Claude Code가 SQL을 실행하거나 cron을 등록하지 않는다. 적용은 사람이 SQL Editor에서 한다.
- **설치 환경.** `/Applications/Blabee.app`, 실행 중인 서비스·세션, `~/Library/Application Support/Blabee`, `.zshrc`의 Blabee 관리 블록을 바꾸지 않는다.

## 명령

전체 목록은 `package.json`과 `README.md`에 있다.

| 목적 | 명령 |
| --- | --- |
| Node 전체 | `npm test` |
| Swift 전체 | `npm run test:swift` |
| Swift 일부 | `npm run test:swift -- --filter <Suite 또는 정규식>` |
| Claude 브릿지 Node | `npm --prefix bridges/claude run check`, `npm --prefix bridges/claude test` |
| DB(PGlite, 운영 접속 없음) | `npm run test:access-sql`, `npm run test:connection-sql` |
| 빌드 | `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift build --product blabee-coordinator` |

- `test:swift`는 `/tmp/blabee-coordinator-swift-tests.lock`과 scratch `/tmp/blabee-coordinator-swift-build`를 모든 세션이 공유한다.
  다른 세션이 돌리는 중이면 `lockf -t 0`이 즉시 실패한다. 기다렸다가 다시 돌리고, 다른 세션의 프로세스를 죽이지 않는다.
- `xcode-select`는 CommandLineTools를 가리키므로 Swift 명령에서 `DEVELOPER_DIR`을 생략하지 않는다. npm 스크립트는 이미 지정한다.
- 빌드·패키징·서명·공증·설치(`build:*`, `notarize:dmg`, `prepare:dogfood`)는 사용자가 요청할 때만 실행한다.
- 보고할 때 기존 실패와 새 회귀, 테스트/빌드/패키징/설치/실사용 결과를 구분한다.

## 이 저장소에서 `claude`를 실행하면 생기는 일

사용자 셸에는 Blabee 자동 연결 shim이 설치되어 있다. 터미널의 `claude`는 `blabee-coordinator claude-auto-launch`를 거쳐
임시 `hooks.json`·`mcp.json`을 `--settings`/`--mcp-config`로 주입받는다. 그래서 세션에 `blabee-claude` MCP와 Stop Hook이 보인다.
이것은 제품 dogfooding이며 정상이다. 상세는 `bridges/claude/CLAUDE.md`.

- 프로젝트 설정(`.claude/settings.json`, `.mcp.json`)에 `blabee-claude` 이름의 MCP 서버를 정의하지 않는다. 런처가 실행을 거부한다.
- `disableAllHooks`를 켜거나 차단형(exit 2, decision block) Stop Hook을 추가하지 않는다. 선택 전달 흐름과 섞인다.
- `--settings`, `--mcp-config`, `--strict-mcp-config`, `--bare`를 직접 주면 shim이 연결을 건너뛴다. 연결 없는 일반 세션이 필요할 때만 쓴다.
- `blabee-claude` 도구는 MCP 서버 지시문을 따른다. 이전 boundary_id를 재사용하거나 추측하지 않는다. 거절·불일치는 제품 관찰로 기록할 가치가 있다.

## 현재 상태를 보는 곳

`git status --short`, `docs/features/CODEX_LATEST_SUPPORT.md`(Codex 버전 지원), `docs/bridges/claude/product-connection/TASK_STATUS.md`(Claude 연결),
`docs/github/public/CHANGELOG.md`(릴리스). `docs/development/DIRECTORY_MIGRATION.md`는 디렉터리 이동 이력과 후속 분리 대상을 적는다.
