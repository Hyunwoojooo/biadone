# Blabee Swift Coordinator

T-007b의 영속·의미·routing 커널과 T-011의 Codex 운영 어댑터를 포함하는
macOS 제품 런타임이다. T-005 spike를 참조하지 않는 독립 Swift Package이며
외부 production dependency를 사용하지 않는다.

- `CoordinatorSwift`: 고정 v1 ingress, 12개 이벤트 replay/projection,
  11개 semantic command, contract pin, 외부 키 저장소, HMAC sidecar,
  SQLite 원자 저널, Keychain freshness high-water, 세션 라우팅과 연속 단조 시계
- `blabee-coordinator`: legacy NDJSON, 단일 UDS daemon, Codex Hook, MCP 진입점을
  제공하는 제품 실행 파일

빌드와 테스트:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path src/coordinator-swift \
  --scratch-path /tmp/blabee-coordinator-swift-build
```

실행:

```sh
blabee-coordinator --database /path/to/coordinator.sqlite3 \
  --key /path/to/coordinator.key \
  --contracts /path/to/repository/Contracts/v1
```

T-011 운영 daemon:

```sh
blabee-coordinator daemon \
  --database "/path/to/coordinator.sqlite3" \
  --key "/path/to/coordinator.key" \
  --contracts "/path/to/repository/Contracts/v1" \
  --socket "/path/to/blabee.sock" \
  --enabled-project "/absolute/project/path"

BLABEE_SOCKET="/path/to/blabee.sock" \
  blabee-coordinator hook UserPromptSubmit

BLABEE_SOCKET="/path/to/blabee.sock" \
  blabee-coordinator mcp
```

T-010 개발용 네이티브 Pet:

```sh
blabee-coordinator pet --socket "/path/to/blabee.sock"
```

T-012b-1 로컬 앱 조립:

```sh
node scripts/build-macos-app.mjs \
  --binary "/absolute/path/to/release/blabee-coordinator" \
  --output "/tmp/blabee-build/Blabee.app" \
  --adhoc-sign
```

출력은 저장소 또는 시스템 임시 영역의 명시적 절대 경로만 허용한다. 기본은
unsigned이며 `--adhoc-sign`은 entitlement 없는 로컬 Hardened Runtime 자격용이다.
정확한 앱 bundle identity로 인자 없이 실행하면 Pet을 시작하지만 shell에서 직접
실행하는 기존 CLI 동작은 유지한다. 이 명령은 `/Applications`, PATH, launchd,
Keychain, Developer ID, 공증 또는 DMG를 변경하지 않는다.

위 저수준 `build-macos-app.mjs`와 달리 로컬 통합 산출물을 만드는
`prepare-local-dogfood.mjs`는 signed runtime identity를 검증할 수 있도록 항상 앱을
ad-hoc 서명한다. 호출자가 unsigned dogfood를 선택하는 옵션은 제공하지 않으며 서명이
실패하면 준비도 실패한다. 이 로컬 서명은 Developer ID 서명·공증이나 배포 승인을
뜻하지 않는다.

T-012b-2 제품 서비스 계약:

```text
Blabee.app/Contents/MacOS/blabee-coordinator service
  -> Contents/Resources/Contracts/v1
  -> ~/Library/Application Support/Blabee/config/service.json
  -> storage/coordinator.sqlite3
  -> storage/coordinator.key
  -> runtime/blabee.sock
```

`service`는 LaunchAgent 전용 내부 모드이며 추가 인자를 모두 거부한다. 설정은
`schema_version = "1.0"`과 절대 경로 배열 `enabled_projects`만 허용하고,
설정 디렉터리 `0700`·파일 `0600`·현재 사용자 소유·non-symlink 조건을 요구한다.
설정이 없으면 service reader는 활성 프로젝트 0개로 해석하며 읽기 과정에서 파일을
자동 생성하지 않는다. 앱에는
`Contents/Library/LaunchAgents/com.biadone.blabee.coordinator.plist`가 정적으로
포함되지만 아직 등록되지 않아 자동 시작하지 않는다. 실제 `service` 실행은 제품
Keychain과 저장소를 사용할 수 있으므로 로컬 자격 명령으로 실행하지 않는다.

T-012b-3a 프로젝트 설정 명령:

```sh
Blabee.app/Contents/MacOS/blabee-coordinator \
  project-settings enable --project "/absolute/project/path"

Blabee.app/Contents/MacOS/blabee-coordinator \
  project-settings disable --project "/absolute/project/path"
```

이 명령은 exact 앱 identity와 고정 Application Support 경로를 통과한 경우에만
동작한다. enable은 프로젝트 경로의 모든 구성요소를 descriptor로 순회해 symlink를
거부하고, disable은 이미 삭제된 프로젝트의 stale entry도 제거할 수 있다. 설정은
current-user `0700` directory와 `0600` single-link file, process mutex+`flock`,
strict locked read-modify-write, same-directory temporary file의 full write와 file
`fsync`, atomic `renameat`, directory `fsync` 순서로 갱신한다.

T-012b-3b Pet 온보딩:

- exact 제품 앱의 Pet 설정 화면에서 `notRegistered`, `enabled`,
  `requiresApproval`, `notFound`, unknown 서비스 상태를 표시한다.
- 앱 시작·poll·snapshot·설정 화면 열기는 읽기 전용이다. 등록·해제·System Settings
  열기와 프로젝트 추가·제거는 각 명시적 버튼에서만 수행한다.
- 변경은 single-flight이며 성공·실패 뒤 실제 상태와 설정을 다시 읽는다. 설정 읽기
  실패에서는 프로젝트 추가·제거를, `notFound`/unknown 상태에서는 모든 mutation을
  fail-closed한다.
- configured project와 현재 daemon의 active snapshot을 분리한다. 설정 변경은
  service를 자동 재시작하지 않으며 다음 재시작부터 적용된다.
- raw `pet --socket`에는 변경 불가 adapter를 사용해 기존 개발 Pet 시작을 보존한다.

온보딩 집중 테스트는 fake adapter와 fake folder chooser만 사용한다. 실제
`SMAppService.register()`, `service`, `NSOpenPanel`, System Settings, 사용자
Application Support 또는 제품 primary Keychain은 호출·변경하지 않는다. 전체 Swift
회귀에는 격리된 임의 test-only Keychain account를 사용 후 정리하는 integration
test가 포함된다.

Pet 모드는 이미 실행 중인 daemon의 UDS에 연결하며 데이터베이스·키·계약 경로를
직접 열지 않는다. 로컬 `.app` 조립, 제품 service 경로 해석과 ad-hoc 서명 자격은
구현됐지만 실제 `SMAppService` 등록·승인·로그인 수명주기, signed Keychain,
Developer ID 서명·공증과 DMG는 T-012 후속 범위다.

`--enabled-project`는 여러 번 지정할 수 있다. `--socket`을 생략하면
`BLABEE_SOCKET`, 그마저 없으면 사용자 Application Support 아래 기본 소켓을
사용한다. Hook launcher는 coordinator stdout을 비공개 임시 파일에 완전히 모은 뒤
성공한 응답만 내보낸다. 출력은 1 MiB 이하로 제한하고 stderr는 항상 버린다. 실행기
누락, timeout, nonzero·signal 종료, 부분 출력, 닫히지 않은 pipe나 남은 descendant,
출력 상한 초과는 모두 빈 stdout·stderr와 exit 0으로 합쳐 일반 Codex를 계속
실행한다. 내부 deadline은 `SessionStart`·`UserPromptSubmit` 7초, `Stop` 5초,
`PermissionRequest` 57초다. coordinator Hook CLI는 일반 요청 5초,
`PermissionRequest` 55초 상한을 사용하므로 Codex의 바깥 Hook 상한보다 먼저
종료된다. timeout·signal 정리에서는 launcher가 소유한 process group을 제한된
TERM grace 뒤 KILL하고 무한히 기다리지 않는다. MCP는 이 fail-open buffering을
사용하지 않고 coordinator 오류나 부재를 JSON-RPC 오류와 nonzero 상태로 반환하는
fail-closed 경로다. Plugin 설치, 제품 바이너리 PATH 등록, 자동 시작과 진단은
T-012가 소유한다.

## T-011 운영 경계

daemon은 `CoordinatorOperationalApplication` 하나를 UDS owner에 연결하며 다음
고수준 요청만 허용한다.

- `enable_project`, `session_start`, `user_prompt_submit`
- `emit_decision`, `stop`, `permission_request`, `resolve_permission_request`,
  `ack_permission_request_delivery`
- `managed_command_approval`, `resolve_managed_command_approval`,
  `ack_managed_command_approval_delivery`
- Pet용 `get_state`/`pet_snapshot`, `focus_interaction`, `select`

`PermissionRequest` 중계는 동결된 `native-request` v1과 별개인 process-local
운영 IPC다. 일반 Hook 경로는 최상위 필드와 `tool_input` 필드를 exact allowlist로
검사하고, `permission_mode: default`의 `Bash` 요청 중 120 Unicode scalar 이하인
NFC 안전 단일 행 command만 받는다. 이때 Pet은 `이번만 허용`, `거절`,
`Codex에서 직접 결정`을 표시하고, `이번만 허용`은 현재 Hook 요청 하나의 공식
`allow`로만 출력한다. 숨은·알 수 없는 필드, MCP·`apply_patch`, 다른 tool, 긴·여러
행·제어/방향성 문자를 포함한 command는 일부만 표시하지 않고 빈 stdout으로 끝내
Codex 네이티브 승인 체계에 결정을 돌려준다.

Pet의 상태 조회는 빈 진단 요청과 구분되는 exact typed heartbeat
`blabee_pet_snapshot_request`를 보낸다. coordinator는 이를 process-local 연속 단조
시계의 3초 consumer lease로만 유지하고 journal에는 기록하지 않는다. 살아 있는
lease가 없으면 Hook `PermissionRequest`와 관리형 App Server command approval은
request ID, 카드, FIFO, notice를 만들기 전에 각각 `defer_to_codex`와
`decide_in_codex`로 즉시 반환한다. lease가 만료될 때에도 아직 선택되지 않은 두
종류의 요청만 네이티브 Codex로 돌려보내며, 이미 선택돼 delivery token이 노출된
exact-once 전달 상태는 지우거나 다시 발급하지 않는다. daemon 재시작은 새 Pet
heartbeat 전까지 lease가 없는 상태다.

명시적 `blabee-codex` 실행기만 공식 TUI를 인증된 loopback WebSocket으로, App
Server를 stdio JSONL로 실행해 command approval을 관리형 실험 경로로 연결한다.
관리형 `이번만 허용`은 원본 request의 `accept`로만 전송하며
`acceptForSession`은 어떤 경로에서도 표시·저장·전송하지 않는다. 관리형 자식의
Hook 중계는 비활성화해 같은 명령에 App Server 승인과 Hook 승인이 동시에 생기지
않게 한다.

Hook과 관리형 요청은 transport·request binding을 분리하되, 코디네이터가 부여한
공통 단조 `arrival_sequence`로 하나의 Pet 승인 FIFO를 만든다. Pet은 두 종류 중
가장 오래된 선두 하나만 표시·focus·선택하며 관리형 요청을 고정 우선하지 않는다.
경로별 최대 8개를 process-local로 보관하고, 전역 선두의 exact binding과 response
ID가 일치할 때만 한 번 응답한다. 요청과 bounded tombstone은 journal에 쓰지 않으며
daemon 재시작 뒤 복구하지 않는다. `PermissionRequest` 시간 예산은 coordinator
50초, Hook CLI 55초, launcher 57초, Codex Hook 60초다. 50초 안에 선택하지 않거나
daemon·transport 오류, 상한 초과, Hook peer disconnect, 같은 세션의 새 사람 턴이
발생하면 남은 Hook 요청은 결정 없이 Codex 네이티브 승인 체계로 반환한다. 관리형
요청은 사용자 결정 120초, broker 130초, socket 135초의 별도 예산을 사용한다.

Hook 카드를 선택하면 코디네이터는 선택된 요청을 전역 FIFO 선두로 유지한다. Hook
CLI가 allow/deny의 공식 승인 JSON을 stdout에 성공적으로 쓰거나, `Codex에서 직접
결정`의 빈 stdout EOF를 명시적으로 전달한 뒤 exact delivery ack를 보낸 경우에만
Pet receipt를 반환한다. 이 receipt도 Codex가 stdout을 소비했거나 명령을 실행·완료했다는
증거는 아니다. write·EOF·ack가 실패하거나 결과가 불명확하면 자동으로 재출력·재시도하지
않는다.

관리형 Codex 자식 프로세스에는 `BLABEE_MANAGED_APPROVALS=1`을 명시해 같은
명령에 App Server 승인과 Hook 승인이 동시에 대기하지 않도록 한다. 이 표식이 있는
`PermissionRequest` Hook은 IPC를 호출하지 않고 빈 stdout으로 즉시 끝난다.

로컬 dogfood 실행:

```sh
# 네이티브 Codex 의미를 보존하는 일반 경로
/absolute/path/to/local-dogfood/bin/codex-with-blabee [Codex arguments]

# App Server 권한 중계를 명시적으로 선택하는 실험 경로
/absolute/path/to/local-dogfood/bin/blabee-codex [Codex TUI arguments]
# 예: blabee-codex resume <thread-id>
```

`codex-with-blabee`는 `BLABEE_COORDINATOR_BINARY`, `BLABEE_SOCKET`,
`BLABEE_MANAGED_APPROVALS`, `BLABEE_MANAGED_CODEX_AUTH_TOKEN`,
`BLABEE_RUNTIME_IDENTITY`를 제거한 뒤 원래 Codex에 같은 argv를 전달한다. 자동
연결이 생성하는 네이티브 셸 경로도 이 관리 상태를 물려주지 않는다.
`blabee-codex`는 호환 별칭이 아니라 사용자가 직접 선택한 관리형 실험 진입점이다.
관리형 실행은 먼저 인자 문법을 검증하고, 실행할 exact native Codex를 resolve한 뒤
trust·지원 버전 자격을 확인한다. 이 단계가 실패하면 안전한 실행 대상을 확정하지
못한 것이므로 fail-closed하며 네이티브 fallback하지 않는다. 그 exact executable이
확정된 뒤 token·listener 같은 준비 단계가 첫 관리형 자식을 시작하기 전에 실패한
경우에만 같은 argv의 네이티브 Codex를 정확히 한 번 실행한다. 자식이 하나라도
시작된 뒤에는 사용자 작업이 시작됐을 수 있으므로 자동 재실행하지 않는다. 시작한
자식은 정리하고 실패를 보고한다. signal로 끝난 자식의 종료 상태는
`128 + signal` 규칙으로 보존한다.

Pet의 `Blabee 설정`에서 **Codex 자동 연결**을 명시적으로 켜면 실제 zsh 시작
파일에는 Blabee가 소유한 versioned source 블록 하나만 추가된다. 기본 대상은
`~/.zshrc`이고, 안전하게 해석할 수 있는 절대 `ZDOTDIR`가 있으면 그 아래의
`.zshrc`를 사용한다. 동적으로 계산되는 경로처럼 대상을 증명할 수 없으면 파일을
추측해 수정하지 않고 실패 폐쇄한다. 실제 함수는
`~/Library/Application Support/Blabee/shell/v1/` 아래의 별도 관리 파일에 둔다.

v4 관리 함수는 모든 기본 `codex` 호출을 활성화 때 확정한 공식 Codex 절대 경로로
직접 `exec`한다. 인수가 없거나 `resume`인 호출도 App Server나 `--remote` 경로로
바꾸지 않고 원래 Codex가 그대로 처리한다. App Server 기반 권한 중계는 위의
`blabee-codex`처럼 사용자가 명시적으로 선택한 실험 진입점에만 남긴다. 따라서
사용자는 다음 명령을 포함해 평소의 Codex 명령 형태와 동작을 그대로 사용한다.

```sh
codex
codex resume
codex resume <thread-id>
```

활성화 시 `0600` 승인 파일에 공식 Codex의 경로·identity·지원 버전과 정책 버전을
기록한다. 이 기록과 allowlist는 Blabee의 관리형 실험 기능을 켤 수 있는지만 결정하며,
기본 Codex 실행 허가로 사용하지 않는다. coordinator·daemon·승인 기록 또는 Blabee
고정 실행기가 없거나 손상돼도 새 셸의 기본 명령은 기록된 공식 Codex를 직접 실행한다.
고정 실행기는 업데이트 전에 이미 Blabee 함수를 읽은 열린 셸을 위해 네이티브
pass-through로만 보존하며, 새 함수의 기본 실행 경로에는 포함하지 않는다.

자동 연결은 기본 비활성이고 설정 화면 조회만으로 셸 파일을 변경하지 않는다. 켜기와
끄기는 명시적인 버튼에서만 수행하며, 해제할 때도 Blabee marker와 Blabee가 생성한
관리 상태만 제거한다. 해제 뒤 새 셸은 Blabee 함수를 읽지 않고, 이미 열린 셸도
보존된 네이티브 pass-through를 통해 Codex를 계속 실행한다. 이미 실행 중인 Codex를
관리형 App Server 승인 경로로 사후 전환할 수는 없으므로, 그 실험 기능이 필요할 때만
한 번 `/exit`한 뒤 `blabee-codex resume <thread-id>`로 다시 시작한다. 일반
Plugin/Hook 연결과 Hook 신뢰 여부는 이 관리형 실험 경로와 별개의 Codex 보안 경계다.

위 `blabee-codex` wrapper로 새로 시작하거나 재개한 세션만 관리하며 이미 독립 실행 중인 TUI에는
연결하지 않는다. App Server WebSocket 계약은 Codex 버전 의존 실험 경로이므로
설치본 실제 왕복과 지원 버전 자격을 통과하기 전 공개 기능으로 간주하지 않는다.
다른 Codex 클라이언트가 이미 writer를 보유한 세션의 `thread/resume`은 Codex가
원래대로 거부한다. Blabee는 정확히 대응하는 원본 오류를 TUI에 먼저 byte-exact로
전달한 뒤 고정된 설명을 최대 한 번 덧붙일 뿐이다. 세션 archive/unarchive, writer
lock 삭제, 소유 프로세스 종료, 자동 재시도, 오류 대체는 수행하지 않는다. 즉 이
안내는 충돌 원인을 설명하지만 Codex의 단일-writer 보호를 우회하지 않는다.
Pet의 관리형 승인 receipt는 코디네이터가 선택을 검증한 뒤 브로커가 exact response
bytes를 App Server 또는 TUI stream에 write했고, exact delivery token과 transport
binding으로 이를 확인했다는 뜻이다. App Server가 응답을 처리한 사실과 명령의
실행·완료·성공은 여전히 별도 증거다. 앞 단계만으로 뒤 단계를 성공 처리하지 않으며,
브로커 연결이 먼저 끊기거나 write 결과가 불명확하면 대기 카드를 취소하고 자동
재시도하지 않는다. 새 브로커는 delivery token이 없는 `accept_once`·`decline`을
stale/malformed coordinator 응답으로 거부하며, token 없는 응답은 Pet 선택이 아닌
`decide_in_codex` fallback에만 허용한다.

현재 관리형 계약 지원 버전은 Codex `0.149.1`, `0.150.1`, `0.151.0`이다. Pet은 요청의
`environmentId`를 함께 표시하고, 관리형 대기는 도착 시점부터 사용자 결정
120초·브로커 130초·socket 135초의 순서화된 상한과 동시 8개로 제한한다. Pet 노출
순서는 위 공통 `arrival_sequence`가 결정한다. 연결별 request ID 기억이
256개에 도달하면 이후 승인 가로채기를 중지하고 공식 TUI로만 전달한다. 이는 오래된
ID를 버려 중복 관리 승인을 허용하지 않기 위한 안전 경계다.

Pet은 먼저 14개 identity 필드의 `blabee_pet_focus_request`로 대기 중인 전면
카드를 명시적으로 선택한다. 그 다음 선택은 번호만 보내지 않고
`selection_request.schema.json`의 16개 필드를 모두 제출한다. 코디네이터는 현재
봉인 패킷·revision·option·9-field binding과 byte-exact로 일치하고, 그 카드가
이미 전면으로 선택돼 있을 때만 실행한다. `select` 자체는 전면 카드를 바꾸지
않으므로 전환 뒤 도착한 오래된 단축키가 다른 카드를 다시 선택해 실행할 수 없다.
슬롯 1은 동적 권장 작업, 슬롯 2는 동적 대안 또는 비활성, 슬롯 3은 보류다.
슬롯 4는 계약상의 rollback 자리이지만 현재 제품 빌드에서는
`rollback_not_enabled_in_build`로 비활성이다.

사람이 제출한 새 프롬프트에는 경계용 correlation token을 한 번 만들고 지정된
`UserPromptSubmit` `additionalContext`에만 전달한다. MCP 제안은 그 exact token을
지정 필드에서 되돌려야 한다. 바인딩이 성공하면 같은 값을 자유 텍스트에 복사한
제안을 journal append 전에 거부하며, MCP·Pet·UDS 공개 응답과 로그에는 다시
출력하지 않는다. Pet action의 원문 continuation token은 Stop 응답을 만들기 전에
즉시 소비하고 durable journal이나 공개 응답에 싣지 않는다. Stop 관찰은 원문
메시지가 아니라 HMAC digest와 요청 generation으로 중복·전달·후속 완료를 구분한다.

운영 계층은 open/seal, selection, completion/close, expiry/timeout의 pre-commit
실패와 commit 뒤 응답 유실을 journal authority로 재조정한다. open→seal은 journal에서
인접하게 유지하고 최초 seal 시도의 continuous-clock anchor를 재시도에도 보존한다.
선택 commit이 모호하면 250 ms backoff로 authority를 다시 읽되 원문 continuation
token은 복원하거나 재발급하지 않는다. durable action은 fail-closed dispatch 결과로,
pause는 paused 결과로 waiter를 해제하고, 미커밋 선택은 원래 pending authority에서
exact 요청을 다시 시도할 수 있다. terminal notice와 staged promotion은 정확한
boundary binding으로 exactly-once 수렴한다.

UDS 런타임 디렉터리는 `0700`, 소켓과 lease는 `0600`이며 서버와 클라이언트 모두
peer effective UID를 확인한다. 요청은 한 줄 1 MiB 미만, 동시 연결은 최대 64개다.
활성 소켓은 탈취하지 않고 같은 UID의 stale socket만 회수하며, 종료 때 자신이
만든 inode만 제거한다. 저장소 singleton은 소켓이나 키 경로가 아니라 정규화한
절대 DB 경로의 SHA-256 identity로
`~/Library/Application Support/Blabee/runtime/authority/` 아래에서 획득한다.
따라서 같은 DB를 다른 소켓으로 연 두 번째 제품 프로세스도 storage 접근 전에
거부된다. hard link나 특수 볼륨의 서로 다른 경로가 같은 inode를 가리키는 alias는
현재 경로 identity만으로 합치지 못하는 잔여 위험이다.

패키지 앱의 UDS runtime identity는 Security.framework가 검증한 실행 중 `SecCode`
CDHash와 설치된 앱 `SecStaticCode` CDHash가 일치하고 bundle identifier가
`com.biadone.blabee`일 때만 만든다. 여기에 코드 서명이 보호하는 bounded
`assembly-manifest.json`의 SHA-256을 domain-separated SHA-256으로 결합한다. 이
identity는 프로세스 시작 뒤 한 번만 계산해 cache하므로 Pet poll마다 앱이나 전체
manifest를 다시 hash하지 않는다. 패키지 앱의 서명·identifier·CDHash·manifest 검증
중 하나라도 실패하면 환경 변수나 파일 metadata로 우회하지 않고 fail-closed한다.
`.app/Contents/MacOS/blabee-coordinator`가 아닌 SwiftPM·test 실행만 격리된
environment/filesystem identity fallback을 사용할 수 있다.

dogfood summary의 `runtime.identity.assembly_manifest_sha256`은 위 결합에 들어가는
manifest digest를 정적으로 확인하기 위한 값일 뿐 UDS wire의 `runtime_identity`가
아니다. 실제 wire identity에는 실행 중 CDHash가 추가로 필요하므로
`strategy: process_cached_signed_code_and_manifest_v1`과
`resolved_at_process_start: true`가 나타내듯 process 시작 때 결정된다.

모든 새 UDS 요청은 `blabee.runtime-identity.v1/` request-type namespace와 같은
runtime identity를 함께 보내고, 서버는 identity와 namespace를 모두 확인한 뒤에만
실제 operation을 dispatch한다. 새 client가 구 server에 붙으면 구 server가 모르는
namespaced type에서, 구 client가 새 server에 붙으면 identity/namespace 검사에서
mutation 전에 거부된다. response identity도 일치해야 성공으로 소비하므로 앱·Plugin
교체 도중 old/new runtime 혼합이 요청을 실행한 뒤 뒤늦게 실패하는 경로를 만들지
않는다.

한 줄에 하나의 JSON request를 stdin으로 받고 같은 `request_id`를 가진 JSON
response를 stdout으로 반환한다. 원문 continuation token과 키 재료는 로그에
남기지 않는다.

T-007b-B1 의미 경로는 `{ "op": "execute_command", "command": { ... } }`를
받아 `load → replay → decide → candidate replay → atomic append` 순서로 실행한다.
selection-once, latest revision, stale/expiry, rollback-disabled, reseal과 형식
보정 의미를 append 전에 검증한다. CAS 충돌은 최대 2회만 재시도하고 토큰은
retry 전에 한 번만 생성하며 commit 전에는 effect를 노출하지 않는다.

T-007b-B2 제품 경로는 선택 권한을 별도 operation으로 분리한다.

- `set_foreground`: `expected_state = pending`과 9개 binding,
  interaction/packet/revision이 현재 대기 카드와 exact match할 때만 전면 카드를
  명시적으로 설정하거나 전환한다.
- `route_selection`: 현재 전면 카드와 같은 binding·interaction·packet·revision인
  `select_option`만 B1 application으로 전달한다. `action`과 작업 본문은 요청에서
  신뢰하지 않고 봉인 packet에서 다시 읽는다.
- `route_consume_pet_action`: 선택 때 발급한 exact continuation/binding/token을
  연속 단조 120초 안에서만 소비하고 외부 `occurred_at`은 logical 시각으로
  덮어쓴다.
- `routing_snapshot`: 세션별 대기 카드, 전면 카드, reminder와 in-flight 개수를
  반환한다.
- `process_time`: 연속 단조 clock 기준의 60초 reminder, 120초 선택 만료와 300초
  in-flight timeout 결과를 처리한다. 실행 파일은 stdin을 `poll(2)`하며 같은
  deadline에 자동으로 깨어나므로 입력이 없어도 terminal event를 append한다.
  stdin이 계속 readable이거나 malformed 입력이 반복돼도 JSON 파싱 전에 due
  work를 진행한다.

제품 `execute_command`에서 `select_option`을 직접 호출하면
`foreground_selection_required`, `consume_pet_action`을 직접 호출하면
`routing_token_consumption_required`, `expire_interaction` 또는
`timeout_transport_unknown`을 직접 호출하면 `routing_scheduler_command_required`로
거부된다. Pet과 형식 보정 continuation token 수명은 120초, in-flight deadline은
300초로 코디네이터가 고정하며 호출자가 입력한 벽시계나 기간으로 늘릴 수 없다.
형식 보정 reserve/claim과 transport completion도 `execute_command` 안에서
연속 단조 logical 시각으로 다시 쓴다.

각 프로젝트·세션에는 대기 상호작용을 최대 하나만 원자적으로 seal할 수 있다.
다른 세션의 카드는 함께 대기하지만 새 카드가 기존 전면 카드를 선점하지 않는다.
시스템 시계 변경은 권한 판정에 사용하지 않고 packet seal audit 시각에
`mach_continuous_time` 경과를 더한 logical 시각을 semantic event에 사용한다.
프로세스 재시작 뒤 monotonic anchor를 증명할 수 없는 persisted pending packet은
즉시 만료하고 terminal 없는 continuation은 `timed_out_unknown`으로 기록한다.
foreground는 재시작 뒤 복원하지 않는다.

제품 바이너리에서 `op: "append"`는 `semantic_command_required`로 거부된다.
raw append는 persistence fault-injection 테스트가
`BLABEE_JOURNAL_TEST_HARNESS` Swift compile flag로 별도 빌드한 바이너리에만
존재한다. Hook, Pet 또는 비신뢰 IPC는 일반 lifecycle에는 `execute_command`,
Pet 선택에는 `set_foreground` 뒤 `route_selection`, 발급 토큰 소비에는
`route_consume_pet_action`을 호출해야 한다.

새로 저장하는 의미 식별자는 NFC여야 하며 기존 식별자 참조는 UTF-8 byte-exact로
비교한다. SQLite text bind/read는 explicit UTF-8 byte length를 사용하므로 embedded
NUL도 prefix에서 잘리지 않는다. 일반 JSON integer lexeme는 Int64 전체 범위를,
decimal/exponent 정수 표기는 Foundation 반올림을 피할 수 있는 ±2^53 범위를
허용한다.

`--contracts`는 선택 사항이 아니다. 프로세스는 시작할 때 v1 manifest와 모든
schema의 고정 hash를 검사하며, 파일 집합이나 내용이 다르면 시작하지 않는다.
`crash_point`는 제품 동작이 아니라 테스트 fault injection이다. 해당 필드는
`BLABEE_T007B_ENABLE_CRASH_INJECTION=1`인 테스트 프로세스에서만 허용된다.

library에서 `SQLiteJournal`을 직접 만들 때는 `FreshnessAnchorStore`를 명시적으로
주입해야 한다. 실행 파일은 service
`com.biadone.blabee.coordinator.freshness.v1`, account `primary`인
`KeychainFreshnessAnchorStore`를 주입한다. 따라서 의도하지 않은 테스트가 제품
Keychain 항목을 읽거나 쓰는 암묵적 기본값은 없다.

## 영속성 및 무결성 경계

- DB, 외부 키, Keychain anchor가 모두 없을 때만 새 journal을 만든다. 먼저
  Keychain에 `initializing` identity를 기록한 뒤 키와 DB를 만들며, 초기화 중
  종료되면 같은 identity로만 재개한다. 기존 DB 또는 키가 있는데 anchor가 없으면
  자동 등록하거나 migration하지 않고 `freshness_anchor_missing`으로 차단한다.
- Keychain marker가 남은 상태에서 DB 또는 키가 사라지거나 DB가 0-byte가 되면
  어떤 저장 파일도 새로 만들지 않고 `freshness_storage_missing`으로 차단한다.
  이 판단은 lock 디렉터리나 lock 파일을 만들기 전의 무변경 preflight에서 먼저
  수행하고, 실제 lock을 획득한 뒤에도 다시 확인한다.
- v1 SQLite table/index 정의를 exact allowlist로 확인한다. 추가 table, index,
  trigger, view 또는 변경된 table 정의가 있으면 journal을 열거나 append하지
  않는다.
- runtime event는 sequence, event identity, 이전 MAC을 포함하는 HMAC chain으로
  인증한다. packet/verification sidecar는 서로 다른 domain과 row identity로
  인증한다.
- packet은 seal event의 9개 top-level binding, interaction, packet/revision,
  expiry, seal timestamp, seal event sequence와 정확히 일치해야 한다. selection도
  참조 packet의 binding, interaction, packet/revision과 정확히 일치해야 한다.
- COMMIT 뒤에는 응답을 만들기 전에 전체 authenticated replay와 요청 batch의
  최종 sequence/event suffix를 다시 확인하고 Keychain `committed` checkpoint를
  read-back한다. 확인하지 못하면 effect를 성공으로 반환하지 않고
  `freshness_commit_ambiguous`를 반환한다.

각 append는 process-global mutex와 키 디렉터리의 `0600` `flock`을 잡은 채 다음
순서로 처리한다.

```text
DB와 Keychain committed checkpoint 대조
→ SQLite BEGIN IMMEDIATE 및 batch 적용
→ Keychain pending(from, to, batch digest) CAS/read-back
→ SQLite COMMIT
→ 전체 authenticated replay
→ Keychain committed(to) CAS/read-back
→ lock 해제 및 성공 응답
```

`pending + source DB`는 COMMIT 전 종료와 COMMIT 후 과거 DB 복원을 구분할 수
없으므로 절대로 자동 취소하지 않는다. health/load/integrity와 다른 batch는
`freshness_transition_pending`으로 차단하고, 같은 canonical batch digest의 정확한
append 재시도만 허용한다. `pending + target DB`는 전체 replay 뒤 committed로
승격할 수 있다. Keychain보다 과거이거나 같은 sequence/head가 다른 authentic DB는
첫 event를 반환하기 전에 `freshness_rollback_detected`로 차단한다.

모든 init/health/load/integrity/append 경로는 DB metadata checkpoint와 Keychain
high-water를 먼저 비교하고, 그 다음에 event와 sidecar를 전체 replay한다. 이 첫
비교 단계는 순수 분류만 수행하며 Keychain을 갱신하지 않는다. `initializing` 또는
`pending + target DB`의 committed 승격은 전체 replay가 성공한 뒤에만 수행한다.

fault injection 지점은 다음과 같다.

- `before_commit`(exit 85): 기존 이름을 유지한 pending 기록 뒤/SQLite COMMIT 전 지점
- `after_freshness_pending_before_sqlite_commit`(exit 87)
- `after_sqlite_commit_before_freshness_finalize`(exit 88)
- `after_commit_before_response`(exit 86): Keychain committed read-back 뒤

통합 테스트는
`BLABEE_T007B_ENABLE_KEYCHAIN_TEST_NAMESPACE=1`과 안전한
`BLABEE_T007B_KEYCHAIN_ACCOUNT=test-...`를 함께 사용한다. cleanup 전용
`BLABEE_T007B_DELETE_KEYCHAIN_TEST_ANCHOR=1`은 이 두 조건이 모두 맞고 account가
`primary`가 아닐 때만 journal/DB를 열기 전에 `SecItemDelete`를 실행하고 종료한다.

`RuntimeSecretCorpus`는 coordinator가 실제로 관찰하거나 발급한 secret의 raw
bytes와 알려진 textual representation을 프로세스 메모리에만 보관한다. append와
stdout/stderr 직렬화 전에 그 값이 포함되었는지 검사한다. continuation envelope의
typed token field는 CLI에서 자동 등록하며, 상위 runtime이 별도로 발급한 token은
같은 corpus에 등록해야 한다. corpus 자체는 secret을 영속화하지 않으므로 재시작
뒤에는 상위 runtime이 아직 유효한 secret을 다시 등록해야 한다. 전혀 관찰하지
않은 임의의 secret을 일반 문자열만 보고 판별할 수 있다고 주장하지 않는다.

현재 독립 CLI는 ad-hoc/unbundled 실행에서 Data Protection Keychain을 요청하면
`errSecMissingEntitlement`가 발생하므로 legacy login Keychain을 사용한다. 조회와
CAS에는 UI 금지 옵션을 넣고 잠금·interaction 불가를 `freshness_anchor_unavailable`로
fail-closed한다. 서명된 앱 wrapper, provisioning과 access-group을 갖춘 Data
Protection Keychain 전환은 T-012/공개 패키징의 release blocker다.

따라서 현재 `0700`/`0600` 외부 키와 login Keychain은 다른 UID, 우발적 키 없는
변조, DB 파일만의 offline rollback을 막는 경계다. 악성 same-UID 프로세스가
Keychain 항목까지 삭제·교체할 수 있는 경우와 DB·키·Keychain 항목을 모두 지워
최초 설치처럼 만드는 경우는 A2만으로 구분하지 못한다. code-signing ACL과
상위 설치 identity 검증은 후속 보안 경계다.
