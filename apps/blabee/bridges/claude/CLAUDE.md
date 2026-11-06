# Claude Bridge 영역 안내

설치된 Blabee를 사용자의 일반 터미널 `claude` 세션에 붙이는 영역이다. Swift는 `swift/`(adapter·service·session·presentation),
Node Hook/MCP 코드는 `src/`, 개발 세션 launcher는 `launchers/`. 테스트는 `../../Tests/bridges/claude/`, 독립 검증 앱은 `../../dev/claude-standalone/`.
같은 폴더의 `AGENTS.md`는 Codex 등 다른 에이전트용 요약이다(2026-11-06 현재 구조로 갱신). 이 문서를 바꾸면 그쪽도 맞춘다. 다르면 이 문서와 `README.md`, `package.json`을 우선한다.

## 제품 연결 구조(자동 연결)

설정의 자동 연결을 켜면 `~/Library/Application Support/Blabee/shell/claude-v1/bin/claude` shim과 `.zshrc` 관리 블록이 설치된다.
shim은 `blabee-coordinator claude-auto-launch --claude-bin <원본> -- "$@"`를 실행하고, `ClaudeInstalledLauncher`가 실행마다 임시
`hooks.json`·`mcp.json`을 만들어 `--settings`/`--mcp-config`로 넘긴 뒤 UDS owner socket에 enroll하고 `posix_spawn`으로 실제 Claude를 띄운다.

- Hook: SessionStart, UserPromptSubmit, Stop(`asyncRewake`, timeout 660), StopFailure, SessionEnd → `src/session-v2-hook.mjs`(자동 연결은 `src/auto-connect-hook.mjs`).
  SessionStart·UserPromptSubmit의 additionalContext는 boundary 한 줄뿐이다. 작업 규칙은 MCP instructions(`SESSION_V2_WORKFLOW_INSTRUCTIONS`)와 도구 description에만 둔다.
  성공한 `emit_decision_v1`이 readiness를 5분 갱신하므로 모델은 제안 전에 연결 확인을 하지 않는다(2026-11-06).
- MCP 서버 `blabee-claude` → `src/session-v2-mcp.mjs`(자동 연결은 `src/auto-connect-mcp.mjs`). 도구는 `_v1` 다섯 개:
  `check_connection_v1`→`readiness.begin`, `ack_readiness_probe_v1`→`readiness.ack`, `emit_decision_v1`→`proposal.emit`,
  `claim_selection_v1`→`selection.claim`, `complete_selection_v1`→`selection.complete`(`src/session-v2-tools.mjs`).
- wire 스키마 `blabee.claude-session.v3`. lease 60분, owner 5분 갱신(`ClaudeSessionAuthority`, `ClaudeOwnerRenewalController`).
- 세션 수명: SessionStart → UserPromptSubmit마다 새 boundary → Stop에서 waiter가 `hook.poll`(500ms, 최대 600s), 선택이 오면 exit 2로 rewake
  → compact는 prompt_id 일치 시 새 내부 boundary, 불일치면 `new_prompt_required` → StopFailure는 미claim 작업 폐기, SessionEnd는 보고 권한까지 회수.
  SessionStart source는 경로마다 다르다: `session-v2-lifecycle.mjs`는 `startup`과 `compact`만 받고 나머지는 `unsupported_source`,
  자동 연결 `auto-connect-hook.mjs`는 `startup`/`resume`/`fork`를 native enrollment로 소비한다.
- 우회: 비TTY, `CLAUDECODE` 설정됨, `-p`/`--help`/`mcp`/`doctor` 등 direct 호출, 사용자가 `--settings`/`--setting-sources`/`--mcp-config`/`--strict-mcp-config`/`--bare`를 준 경우는 원래 Claude를 그대로 실행한다.
- `cleanEnvironment`는 `BLABEE_*`, `DYLD_*`, `__XPC_DYLD_*`, `LD_*`, `NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, `ENV`, `CLAUDECODE`를 지우고 `MCP_PROTOCOL_NEGOTIATION=legacy`를 강제한다.
- `requireNoMCPCollision`: `/Library/Application Support/ClaudeCode/managed-mcp.json`이 존재해 파싱되면 이름과 무관하게 `managed_mcp_configuration_active`로 거부한다.
  cwd부터 `/`까지의 `.mcp.json`과 `$CLAUDE_CONFIG_DIR` 또는 `~/.claude.json`(projects 항목 포함)에 `blabee-claude` 이름이 있으면 `mcp_name_collision`으로 거부한다.

**이 저장소에서 작업하는 세션 자체가 이 경로로 실행되고 있다.** 코드를 고칠 때 설치된 shim·앱·`.zshrc` 블록은 건드리지 않는다. 설치 앱 반영은 별도 빌드·설치 단계다.

`launchers/claude-shared.mjs`(`npm run claude:shared`, `claude:live`)는 레거시 개발 경로다. `--strict-mcp-config`와 dev channels를 쓰며 제품 연결과 구분한다.

## 파일 지도

| 경로 | 역할 |
| --- | --- |
| `src/session-v2-{mcp,hook,client,lifecycle,waiter,tools,context,channel-poller}.mjs` | stdio MCP 서버(SDK 1.30.0), Hook 실행·boundary 주입, UDS 프레임 client(비밀 키 차단), Hook DTO 정규화, Stop waiter, 도구 매핑, env 검증, heartbeat |
| `src/auto-connect-{client,hook,mcp}.mjs` | 자동 연결 bootstrap(`CLAUDE_CODE_SESSION_ID` 기반) |
| `src/product-*.mjs`, `src/native-session-client.mjs` | 도구 스키마, 기존 v1 경로 |
| `swift/adapter/` (`ClaudeCoreAdapter` 타깃) | `ClaudeSessionAuthority`, `ClaudeNativeSession`, `ClaudeProductWireCodec`, `ClaudeBridgeIngress`, `ClaudeCoreAdapter`. engine routing API(`executeCommand`, `routeSelection`, `routeConsumePetAction`)를 직접 호출 |
| `swift/service/` | `ClaudeInstalledLauncher`, `ClaudeInstalledLaunchConfiguration`(documents·arguments·cleanEnvironment·requireNoMCPCollision·supportsVersion), `ClaudeAutoConnect{Command,Setup,Bootstrap}`, `ClaudeOwnerRenewalController`, `ClaudeRuntimePayload{,Use}`, `ClaudeNativeHost`, `ClaudeBridgeCoordinator`, `ClaudeProductServiceCoordinator` |
| `swift/session/` | `ClaudeSessionRegistry`(enroll/control/disconnect), `ClaudeSessionEnrollment`(peer 서명 검사), `ClaudeSessionMetadataStore`(SQLite) |
| `swift/presentation/` | `ClaudePetTransport`, `ClaudePetSnapshotProjector`, `ClaudePetApplication` |
| `../../Contracts/bridge/` | claude-session v2/v3, claude-owner, pet-provider, pet-directory 스키마. ContractPin 대상 아님. Node와 `Tests/bridges/claude/integration/*-schema.test.mjs`가 사용 |
| `../../scripts/prepare-claude-runtime.mjs`, `../../scripts/sign-claude-runtime.mjs` | Node 런타임 payload 번들(`CLAUDE_RUNTIME_SOURCE_FILES`)과 서명 |

## 바꾸면 안 되는 것

- `@modelcontextprotocol/sdk` 1.30.0 고정(lockfile), `MCP_PROTOCOL_NEGOTIATION=legacy`.
  `zod`·`fast-uri`는 보안 권고 때문에 `package.json`의 `overrides`로 정확한 버전을 고정한다. 올릴 때는 `scripts/prepare-claude-runtime.mjs`의 `CLAUDE_RUNTIME_PACKAGES`도 같이 바꾼다.
- 서버명 `blabee-claude`, `_v1` 도구 이름 다섯 개, 스키마 문자열 `blabee.claude-session.v3`, `blabee.claude-proposal.v1`, `blabee.claude-action.v1`, `blabee.claude-owner.v1`, `blabee.claude-runtime.v2`, `mcp-hook-v1`.
- 식별자 `com.biadone.blabee.claude-owner-renewal`, `com.biadone.blabee.claude-installed-owner`, Keychain account `claude-native-v1-<digest>`, 경로 `shell/claude-v1`,
  env 접두사 `BLABEE_CLAUDE_SESSION_V2_`, `BLABEE_CLAUDE_BOOTSTRAP_`.
- `src/` 파일을 추가하거나 이름을 바꾸면 `scripts/prepare-claude-runtime.mjs`의 `CLAUDE_RUNTIME_SOURCE_FILES`를 함께 갱신한다.
- 버전 gate: Claude Code 2.1.282 이상(`supportsVersion`), Node 22 이상. 최신 검증 범위는 `docs/bridges/claude/product-connection/COMPATIBILITY.md`.
- Fallback 금지: Codex socket·서비스로 넘어가지 않는다. 공통 `BLABEE_*` 설정을 재사용하지 않는다. 실패한 mutation을 자동 재전송하지 않는다.
  이전 boundary·선택을 추측하지 않는다. ad-hoc 서명을 공개 배포 fallback으로 쓰지 않는다. 원래 Claude를 그대로 실행하는 fallback은 pre-spawn 단계에만 허용된다.
- `dev/claude-standalone/`은 이전 Node Coordinator·AppKit Pet 보존용 독립 앱이다. 제품 코드를 그곳에 복사하거나 자동 승격하지 않는다.

## 테스트

이 디렉터리에서 실행한다(루트에서 `npm --prefix bridges/claude …`도 같다). 생성물은 루트 `build/claude-tests/`에 둔다.
macOS UDS `sun_path` 한계(104바이트) 때문에 client는 socket 경로를 103바이트로 제한한다. 긴 worktree 경로에서는 socket fixture가 실패할 수 있다.

| 명령 | 필요 | 범위 |
| --- | --- | --- |
| `npm run check` | Node | src·launchers·test-support·Tests `node --check` |
| `npm test` | Node | `Tests/bridges/claude/*.test.mjs` 최상위(integration 제외) |
| `npm run test:shared-engine` (`-- --lifecycle`) | Swift 빌드 | shared-engine 패키지 + integration client/roundtrip |
| `npm run test:product-ingress`, `test:native-session`, `test:product-registration`, `test:product-lifetime`, `test:product-lifecycle` | Swift 빌드 | coordinator 빌드 후 integration |
| `npm run test:installed-session` | Swift 빌드 | source/native/production phase, `BLABEE_CP05_COORDINATOR` |
| `npm run test:product-pet`, `test:runtime-payload`, `test:common-pet` | Swift 빌드 | Pet UI·런타임 payload 필터 |

Swift 명령은 모두 루트의 lockf·scratch·`--disable-keychain` 규칙을 쓴다. 두 세션이 동시에 돌리지 않는다.

## 참고 문서

`docs/bridges/claude/product-connection/`의 `PUBLIC_MCP_HOOK.md`, `AUTO_CONNECT.md`, `INSTALLED_SESSION.md`, `SESSION_LIFECYCLE.md`, `SESSION_AUTHORITY.md`,
`RUNTIME_PAYLOAD.md`, `COMPATIBILITY.md`, `TASK_STATUS.md`, `CODEMAP.md`; `docs/bridges/claude/COMMON_PET.md`.
