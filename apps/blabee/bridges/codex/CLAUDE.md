# Codex Bridge 영역 안내

공식 Codex CLI를 Blabee Pet의 결정 카드·승인 카드와 연결한다. Swift는 `swift/`, Codex Plugin 소스는 `plugin/`.
`swift/core/*`만 `CoordinatorSwift` 타깃이고 나머지 `swift/*`는 `BlabeeCoordinator` 실행 타깃이다. `Package.swift`의 명시 sources로 확인한다.

## 두 경로

- **일반 Plugin/Hook 경로(fail-open).** `plugin/hooks/hooks.json`이 SessionStart/UserPromptSubmit/Stop/PermissionRequest를
  `plugin/scripts/blabee-launcher hook <Event>`로 보내고, launcher가 앱 번들의 coordinator를 실행한다. Hook 실패는 Codex를 막지 않는다.
  예외는 인식된 queued envelope로, 이때만 fail-closed로 context를 붙인다.
- **관리형 `blabee-codex` 경로(fail-closed).** 사용자가 고른 경우에만 App Server를 WebSocket으로 중계한다.
  실패하면 관리형 기능만 멈추고 공식 `codex`는 건드리지 않는다. 신뢰 모델은 `docs/features/MANAGED_CODEX_TRUST.md`.

미등록 Codex(2026-11-12, 2026-11-20 변경): SessionStart·UserPromptSubmit Hook이 호출자 계보를 읽어 `codex_runtime`(`qualified`/`unqualified`)과 실행 파일 경로를 붙인다(`HookCodexRuntimePayloadPolicy`). OpenAI 서명이지만 CDHash가 `qualifiedProfiles`에 없으면 `unqualified`다.
서비스의 `CodexUnreviewedRuntimeAdmission`이 그 Codex를 전달과 같은 검사로 백그라운드에서 판정하고, 코디네이터는 판정이 `eligible`(등록된 가장 높은 버전보다 새롭고 major가 같은 stable, 차단 목록 제외: `CodexCompatibility.pluginAdmission`)일 때만 세션을 켠다. Pet 스냅샷 `codex_runtime_status`는 `unreviewed`(켜짐) 또는 `unqualified`(지원 안 함)다. 판정 전이거나 판정할 수 없으면 안내 없이 꺼 둔다. 판정은 Hook 경로와 같은 파일로 이어지는 후보(Homebrew는 `/opt/homebrew/bin/codex`)를 통해 한다.
이런 세션의 PermissionRequest는 코디네이터에 보내지 않아 Codex 창에서 바로 승인한다. 승인 권한은 계속 등록된 CDHash만 갖는다. 계보를 읽을 수 없으면 값을 보내지 않고 기존 동작을 유지한다. 설계: `docs/features/CODEX_UNREVIEWED_VERSION_DESIGN.md`.

선택 전달은 `codex queue --thread <session> --message <msg>`(`swift/delivery/CodexQueueNextTurnDispatcher.swift`)로 다음 턴에 들어간다. 실패한 전달은 재전송하지 않는다.

## 파일 지도

| 경로 (`swift/`) | 역할 |
| --- | --- |
| `core/HookPermissionPolicy.swift` | 버전별 primary `codex` CDHash `qualifiedProfiles`. Allow는 일회성 `Approved`만 |
| `core/QueuedPromptEnvelope.swift` | queue로 보내는 프롬프트 envelope 분류 |
| `hooks/OperationalCLI.swift` | Hook·MCP 진입점, 결정 출력(`allow_once`/`deny`/`defer_to_codex`), `RuntimeSecretCorpus` 적용 |
| `hooks/CodexHookApprovalQualification.swift`, `DoctorHookTrustInspector.swift`, `PetHookReadiness.swift` | 호출 프로세스 계보·CDHash 확인, Hook 신뢰 진단, 준비 상태 |
| `approval/CodexAppServerApprovalAdapter.swift` | App Server 명령 승인 JSON-RPC 변환, `.decideInCodex` → `forwardToCodex` |
| `delivery/CodexQueueNextTurnDispatcher.swift` | `codex queue` 실행, 실행 파일 해석, 프로세스 runner |
| `runtime/CodexRuntimeBundle.swift` | 공식 패키지 검사: 파일별 SHA-256, 서명, Team ID, 공증, `QualificationCatalog`, fingerprint(v1/v2), private copy·seal·재검증 |
| `runtime/ManagedCodexTrust.swift`, `ManagedCodexLauncher.swift`, `ManagedCodexWebSocket.swift`, `ManagedCodexApprovalRuntime.swift` | 관리형 실행 파일 신뢰, TUI·App Server 실행(workspace 라우팅), WebSocket, 승인 브로커 |
| `runtime/CodexRuntimeTrust.swift`, `CodexNativeRuntime.swift`, `CodexNativeFailureGuard.swift` | PATH 런타임 진단, native CLI 조회, 실패 캐시 |
| `runtime/CodexUnreviewedRuntimeAdmission.swift` | 등록 전 Codex 세션을 켤지 정하는 판정 저장소(메모리, 백그라운드 검사). 권한을 주지 않는다 |
| `setup/CodexCompatibility.swift` | 버전별 capability(`.managedAppServer`, `.pluginCLI`, `.serverOwnedWorkspaceRoots`, `.updateLifecycle`) 정확 일치 목록. 지원 버전의 유일한 출처. Plugin 경로의 새 버전 허용 규칙 `pluginAdmission` |
| `setup/CodexPluginSetup.swift`, `CodexPluginCheckReport.swift` | marketplace 조회·설치·마이그레이션·진단 |
| `update/UpdateManagedCodex*.swift` | 업데이트 중 세션 lifecycle(`UpdateManagedCodexProfile.supportedVersions` = `.updateLifecycle` capability). 승인 권한 없음 |

Plugin: `plugin/.codex-plugin/plugin.json`, `plugin/.mcp.json`, `plugin/hooks/hooks.json`, `plugin/scripts/blabee-launcher`, `plugin/skills/`.
앱 번들 내부 경로는 `Contents/Resources/Plugin/blabee`, marketplace 상대 경로는 `./Plugin/blabee`. 소스 위치와 번들 경로를 혼동하지 않는다.

소비자는 `app/coordination`(`PetViewModel`, `PetConnectionSetup`), `app/ui/settings`, `app/ui/onboarding`, `app/service/DoctorApplication.swift`, `app/telemetry`, `app/entrypoints/main.swift`다.

## 신규 Codex 버전 지원

버전 데이터는 `bridges/codex/qualification/<ver>.json`이 유일한 출처이고 Swift는 생성 파일(`*.generated.swift`)을 읽는다. 등록은 `npm run codex:register`(2026-11-13).

`/codex-version-support` 스킬의 체크리스트를 따른다. 버전은 정확한 문자열로만 등록하고 범위·prerelease로 일반화하지 않는다.
2026-11-20부터 등록 전 새 버전도 제안 카드와 선택 전달은 동작한다. 등록은 그 버전의 승인 카드와 관리형 경로를 켜는 일이다. 문제가 확인된 버전은 `bridges/codex/blocked-versions.json`에 넣고 `npm run codex:qualification -- generate`를 돌린다.
기록은 `docs/features/CODEX_LATEST_SUPPORT.md`(최신이 맨 위)와 `docs/features/CODEX_<ver>_QUALIFICATION.md`.

## 바꾸면 안 되는 것

- 기존 `qualifiedProfiles` 항목, 레거시 `qualifiedVersion`/`qualifiedCDHash`, `qualificationKey`. 승인을 `ApprovedForSession`으로 넓히지 않는다.
  `codex-exec-server` 같은 보조 실행 파일을 Hook 호출자로 신뢰하지 않는다.
- 과거 catalog record와 v1 fingerprint 도메인. 바꾸면 기존 seal·staging이 깨진다.
- Plugin manifest: `plugin/.mcp.json`의 `./scripts/blabee-launcher mcp`와 `env_vars: ["BLABEE_SOCKET"]`, hooks.json의 symlink 거부 guard,
  timeout(PermissionRequest 320초 > launcher 315초, 나머지 8초).
- 번들 경로 `Contents/Resources/Plugin/blabee`. `scripts/release-signing.mjs`, `Tests/AppPackaging/`, `app/service/AppRuntimeUseLease.swift`가 의존한다.
- `BLABEE_MANAGED_CODEX_AUTH_TOKEN`이 App Server 환경으로 새면 안 된다(`ManagedCodexBrokerTests`, `CodexPluginSetupTests`의 must-not-leak 테스트).
  Hook 출력·MCP 응답은 `RuntimeSecretCorpus`를 거친다. delivery_token·토큰은 해시만 기록한다.
- 실패 캐시 정책 revision은 허용 규칙·지원 목록·차단 목록에서 계산된다(`CodexCompatibility.pluginPolicyRevision`). 사용자 DB·실패 기록을 수동 초기화하지 않는다.
- 새 버전 허용은 Plugin 경로의 기본 기능까지다. `pluginAdmission`의 `unreviewedNewer`를 승인(`qualifiedProfiles`)이나 관리형 경로(`qualify(version:)`)로 넓히지 않는다.
- 실패 기록(2026-11-12, schema 2): 실행 파일 자체의 실패(서명·버전·출력)는 수동 재검사까지 유지하고, 환경 실패(공증 조회·시간 초과·실행 불가·도중 종료·결과 불명)는 10분 뒤 풀린다. 풀린 뒤에도 실패한 전달은 다시 보내지 않고 새 선택만 검사받는다. 32칸이 차면 경로가 사라졌거나 정책이 바뀐 기록부터 재사용한다. 공증 온라인 조회는 같은 파일에 대해 서비스 수명 동안 한 번만 한다(`CodexNotarizationCache`).
- Logger subsystem `com.biadone.blabee`.
- 승인 요청의 폴더 조건(2026-11-14 사용자 승인): `cwd`가 세션의 활성 프로젝트 안이면 받는다(`permissionPath(_:belongsTo:)`). 세션·turn 바이트 일치와
  호출 Codex 서명 확인은 승인 권한의 근거이므로 더 풀지 않는다. PermissionRequest 키 목록은 `scripts/codex/register-version.mjs`의 `PERMISSION_REQUEST_KEYS`와 같아야 한다.
- Plugin 0.1.4(hooks.json의 SessionStart 한도 없음, PermissionRequest `matcher: "Bash"`)는 Doctor 고정 계약(`DoctorApplication.validatePluginHooks`, manifest SHA-256)과 함께 바꾼다.
  Hook 정의를 바꾸면 Plugin 버전을 올린다. 같은 버전이면 설치된 Plugin이 갱신되지 않는다.
- 전달 실행 파일: 세션 Hook이 서명을 확인한 Codex 경로(`CodexSessionRuntimeHints`)를 먼저 시도한다. 없거나 일반 검증에서 거부되면 고정 후보 목록으로 넘어가지만,
  시간 초과·실행 중·실패 기록 잠금 같은 오류는 기존 `qualifyFirst` 규칙대로 그 자리에서 실패한다. `CODEX_HOME`은 Hook 환경의 값을 확인 없이 넘긴다(같은 사용자가 이미 고칠 수 있는 설정 선택).

## 테스트

| 명령 | 범위 |
| --- | --- |
| `npm run test:codex-compatibility` | 패키지 검사기 회귀. 계정·네트워크 불필요 |
| `npm run test:t005` | `Tests/RuntimeQualification/*` 전체(qualification JSON·생성 Swift 일치 포함) |
| `npm run codex:check-latest` | 등록되지 않은 새 Codex 안정판 목록(GitHub 공개 API 조회만). `--fail-on-new`면 있을 때 exit 2 |
| `scripts/codex/check-latest-notify.sh [node]` | 위 검사를 돌려 새 버전·실패 시 macOS 알림. 관리자 Mac의 LaunchAgent `com.joo.blabee-codex-check-latest`가 매일 09:00 실행(로그 `~/Library/Logs/blabee-codex-check-latest.log`, 끄기: `launchctl bootout gui/$(id -u)/com.joo.blabee-codex-check-latest`) |
| `npm run codex:register -- --version X --download` | 새 버전 등록(공식 asset 다운로드라 사용자 승인 후). `/codex-version-support` 참고 |
| `npm run test:codex-live` | 설치된 `codex`로 Plugin 설치·제거 왕복(opt-in, `BLABEE_LIVE_CODEX_EXECUTABLE`로 경로 지정). 기본 `npm test`에서는 건너뛴다(REPO-17) |
| `npm run qualify:codex-compatibility -- --expected-version X --runtime-dir <절대경로> --evidence <절대경로.json> [--release-evidence …] [--source-revision …] [--hook-tests] [--plugin-lifecycle]` | 공식 런타임 smoke. darwin, 정확한 stable 버전 필요. 서명·공증은 항상 검사하고 결과는 `--evidence` JSON에 쓴다(2026-11-13 전 안내의 `--check-notarization`·`--json`은 없는 인자) |
| `python3 scripts/verify-update-managed-codex-native.py --execute --expected-version X --codex … --catalog … --expected-sha256 …` | native lifecycle. `--execute` 없으면 프로세스를 띄우지 않음 |
| `npm run test:swift -- --filter 'Codex\|ManagedCodex\|UpdateManagedCodex\|Hook\|PetHookReadiness\|DoctorApplication'` | 이 영역 Swift suite(`Tests/swift/BlabeePetTests/`). `DoctorApplicationTests`는 소비자지만 패키지 레이아웃·버전 목록을 그대로 검사하므로 함께 돌린다 |

실제 설치 Codex 검증은 opt-in이다: `BLABEE_NATIVE_LIVE_VERIFY=1`, `BLABEE_NATIVE_LIVE_EXECUTABLE=<codex>`,
선택으로 `BLABEE_NATIVE_LIVE_EXPECTED_VERSION`, `BLABEE_NATIVE_LIVE_TIMEOUT_MS`(기본 45000).
공식 artifact 대조는 `BLABEE_CODEX_RUNTIME_ARTIFACT=<패키지>`와 `BLABEE_REQUIRE_CODEX_RUNTIME_ARTIFACT=1`.
`Packaging/CI/codex-compatibility.yml`은 템플릿이며 활성화되지 않았다. 개인 self-hosted runner와 계정·서명 secret 사용은 금지.

## 참고 문서

`docs/features/CODEX_COMPATIBILITY_QUALIFICATION.md`, `docs/features/CODEX_LATEST_SUPPORT.md`, `docs/features/MANAGED_CODEX_TRUST.md`,
`docs/features/PERMISSION_CARD_APPROVAL_KO.md`, `docs/features/APPROVAL_THREAD_ROUTING_AND_DISMISS.md`, `docs/features/QUEUED_HOOK_ORDERING.md`, `docs/AUTOMATIC_UPDATES.md`.
