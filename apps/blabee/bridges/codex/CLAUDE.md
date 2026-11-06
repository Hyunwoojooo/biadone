# Codex Bridge 영역 안내

공식 Codex CLI를 Blabee Pet의 결정 카드·승인 카드와 연결한다. Swift는 `swift/`, Codex Plugin 소스는 `plugin/`.
`swift/core/*`만 `CoordinatorSwift` 타깃이고 나머지 `swift/*`는 `BlabeeCoordinator` 실행 타깃이다. `Package.swift`의 명시 sources로 확인한다.

## 두 경로

- **일반 Plugin/Hook 경로(fail-open).** `plugin/hooks/hooks.json`이 SessionStart/UserPromptSubmit/Stop/PermissionRequest를
  `plugin/scripts/blabee-launcher hook <Event>`로 보내고, launcher가 앱 번들의 coordinator를 실행한다. Hook 실패는 Codex를 막지 않는다.
  예외는 인식된 queued envelope로, 이때만 fail-closed로 context를 붙인다.
- **관리형 `blabee-codex` 경로(fail-closed).** 사용자가 고른 경우에만 App Server를 WebSocket으로 중계한다.
  실패하면 관리형 기능만 멈추고 공식 `codex`는 건드리지 않는다. 신뢰 모델은 `docs/features/MANAGED_CODEX_TRUST.md`.

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
| `setup/CodexCompatibility.swift` | 버전별 capability(`.managedAppServer`, `.pluginCLI`) 정확 일치 목록 |
| `setup/CodexPluginSetup.swift`, `CodexPluginCheckReport.swift` | marketplace 조회·설치·마이그레이션·진단 |
| `update/UpdateManagedCodex*.swift` | 업데이트 중 세션 lifecycle(`UpdateManagedCodexProfile.supportedVersions`). 승인 권한 없음 |

Plugin: `plugin/.codex-plugin/plugin.json`, `plugin/.mcp.json`, `plugin/hooks/hooks.json`, `plugin/scripts/blabee-launcher`, `plugin/skills/`.
앱 번들 내부 경로는 `Contents/Resources/Plugin/blabee`, marketplace 상대 경로는 `./Plugin/blabee`. 소스 위치와 번들 경로를 혼동하지 않는다.

소비자는 `app/coordination`(`PetViewModel`, `PetConnectionSetup`), `app/ui/settings`, `app/ui/onboarding`, `app/service/DoctorApplication.swift`, `app/telemetry`, `app/entrypoints/main.swift`다.

## 신규 Codex 버전 지원

`/codex-version-support` 스킬의 체크리스트를 따른다. 버전은 정확한 문자열로만 등록하고 범위·prerelease로 일반화하지 않는다.
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
- 실패 캐시 정책 revision은 지원 목록에서 계산된다. 사용자 DB·실패 기록을 수동 초기화하지 않는다.
- Logger subsystem `com.biadone.blabee`.
- 알려진 경계: 0.166.0에서 PermissionRequest `cwd`(실제 명령 폴더)와 Hook 실행 폴더(`tool_hook_cwd`)가 다르면 Blabee의 세션 경로 동일성 검사 때문에
  Codex 기본 승인으로 돌아갈 수 있다(`docs/features/CODEX_0166_QUALIFICATION.md` 남은 경계). Swift 소스에 `tool_hook_cwd` 처리는 아직 없다. 동일성 조건을 임의로 풀지 않는다.

## 테스트

| 명령 | 범위 |
| --- | --- |
| `npm run test:codex-compatibility` | 패키지 검사기 회귀. 계정·네트워크 불필요 |
| `npm run test:t005` | `Tests/RuntimeQualification/*` 전체 |
| `npm run qualify:codex-compatibility -- --expected-version X --runtime-dir <절대경로> [--release-evidence …] [--check-notarization] [--hook-tests] [--plugin-lifecycle] [--json]` | 공식 런타임 smoke. darwin, 정확한 stable 버전 필요 |
| `python3 scripts/verify-update-managed-codex-native.py --execute --expected-version X --codex … --catalog … --expected-sha256 …` | native lifecycle. `--execute` 없으면 프로세스를 띄우지 않음 |
| `npm run test:swift -- --filter 'Codex\|ManagedCodex\|UpdateManagedCodex\|Hook\|PetHookReadiness\|DoctorApplication'` | 이 영역 Swift suite(`Tests/swift/BlabeePetTests/`). `DoctorApplicationTests`는 소비자지만 패키지 레이아웃·버전 목록을 그대로 검사하므로 함께 돌린다 |

실제 설치 Codex 검증은 opt-in이다: `BLABEE_NATIVE_LIVE_VERIFY=1`, `BLABEE_NATIVE_LIVE_EXECUTABLE=<codex>`,
선택으로 `BLABEE_NATIVE_LIVE_EXPECTED_VERSION`, `BLABEE_NATIVE_LIVE_TIMEOUT_MS`(기본 45000).
공식 artifact 대조는 `BLABEE_CODEX_RUNTIME_ARTIFACT=<패키지>`와 `BLABEE_REQUIRE_CODEX_RUNTIME_ARTIFACT=1`.
`Packaging/CI/codex-compatibility.yml`은 템플릿이며 활성화되지 않았다. 개인 self-hosted runner와 계정·서명 secret 사용은 금지.

## 참고 문서

`docs/features/CODEX_COMPATIBILITY_QUALIFICATION.md`, `docs/features/CODEX_LATEST_SUPPORT.md`, `docs/features/MANAGED_CODEX_TRUST.md`,
`docs/features/PERMISSION_CARD_APPROVAL_KO.md`, `docs/features/APPROVAL_THREAD_ROUTING_AND_DISMISS.md`, `docs/features/QUEUED_HOOK_ORDERING.md`, `docs/AUTOMATIC_UPDATES.md`.
