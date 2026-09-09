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
  /usr/bin/lockf -t 0 -k -w /tmp/blabee-coordinator-swift-tests.lock \
  /usr/bin/xcrun swift test --package-path src/coordinator-swift \
  --scratch-path /tmp/blabee-coordinator-swift-build \
  --experimental-maximum-parallelization-width 1
```

저장된 Codex 런타임 검사는 실제 path ABA 공격을 놓치지 않도록 디렉터리 조상의
전체 metadata 변경을 fail closed로 처리한다. 따라서 전체 테스트도 서로 다른 suite의
임시 fixture 변경이 공격처럼 보이지 않도록 위 명령 또는 `npm run test:swift`로 한
process씩 실행한다. 공통 `lockf`가 이미 실행 중인 전체 Swift 테스트가 있으면 두 번째
실행을 즉시 거부하므로, 같은 socket·Keychain·임시 경로를 쓰는 두 process가 섞이지 않는다.
Xcode/toolchain을 바꿀 때는 experimental flag 지원 여부와 전체 suite를 다시 검증한다.

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

2026-09-07 앱 실행형 서비스 (내부 테스트, 설치본 검증 별도):

- 설정에서 `앱 실행형 서비스 켜기`를 명시적으로 선택한 뒤에만 같은 앱 번들의
  `app-service` 자식을 시작한다. 다음 앱 실행에서도 선택을 유지하며 패널 닫기는
  숨김만, `Blabee 종료`는 소유한 서비스 종료까지 수행한다. `앱 실행형 끄기`는 다음
  실행의 자동 시작도 비활성화한다. 기본값은 꺼짐이다.
- 기존 SMAppService가 등록/승인 대기 중이면 사용자에게 등록 해제를 안내하며 자동으로
  등록을 변경하지 않는다. 아래 기존 등록 방식과 동시에 서비스 소유권을 잡지 않는다.
- 부모 lifetime pipe EOF, 소유 PID의 waitpid/종료 직렬화, 독립 종료 watchdog으로
  앱 crash/종료를 처리한다. 등록·spawn만으로 ready라 하지 않고 자식 READY 신호와
  검증된 snapshot을 모두 확인한다. 12초 시작/재연결 제한 뒤에는 수동 복구만 제공한다.
- 실패 polling은 기본 0.5초에서 1/2/4초로 늘리고 정상 응답 시 복귀한다. 같은 ready
  상태를 반복 publish하지 않으며, 새 generation에서 이전 snapshot/timeout을 무시한다.
- 이 모드는 기존 ad-hoc SMAppService 서명 오류의 근본 해결 또는 공개 배포 자격이
  아니다. 자세한 범위와 검증 기준은 `../../APP_OWNED_SERVICE_PLAN_KO.md`를 따른다.

T-012b-3b Pet 온보딩 (기존 macOS 등록 방식):

- exact 제품 앱의 Pet 설정 화면에서 `notRegistered`, `enabled`,
  `requiresApproval`, `notFound`, unknown 서비스 상태를 표시한다.
- 앱 실행형 모드를 선택하지 않은 앱 시작·poll·snapshot·설정 화면 열기는 읽기 전용이다. 등록·해제·System Settings
  열기와 프로젝트 추가·제거는 각 명시적 버튼에서만 수행한다.
- 변경은 single-flight이며 성공·실패 뒤 실제 상태와 설정을 다시 읽는다. 설정 읽기
  실패에서는 프로젝트 추가·제거를 차단한다. `notFound`는 macOS가 아직 번들 서비스를
  발견하지 못한 최초 설치 상태일 수 있으므로 사용자의 명시적 등록 시도만 허용하고,
  unknown 상태에서는 모든 service mutation을 fail-closed한다.
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

이전 dogfood Plugin 마이그레이션의 삭제 경로는 앱 bundle과 Codex 실행 파일의
신뢰 재검증을 먼저 끝낸다. 그 뒤 exact Marketplace/Plugin 소유권과 descriptor 기반
파일 identity를 마지막 조건으로 다시 확인하고 별도 사전 검사 없이 삭제 subprocess를
호출한다. 다만 Codex Plugin CLI에는 확인한 identity를 조건으로 삭제하는
compare-and-remove API가 없다. 따라서 최종 identity 확인과 외부 CLI의 실제 경로 사용
사이에서 같은 사용자가 대상을 바꾸는 경쟁을 원자적으로 제거할 수는 없다. Blabee는 이
구간을 최소화하고 실행 후 상태를 다시 검증하지만, 이미 실행된 잘못된 삭제를 되돌렸다는
의미는 아니다. 완전한 해결은 Codex가 조건부 remove token/API를 제공해야 가능하다.

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
NFC 안전 단일 행 command만 받는다. 서명된 Codex `0.153.4` arm64의 고정 CDHash와
live process ancestry가 입력/출력 시 모두 검증된 경우에만 `이번만 승인`을 활성화한다.
카드는 항상 `1 이번만 승인`, `2 거절`, `3 Codex에서 직접 선택`을 표시하며, 검증 불가
요청의 1번은 사유와 함께 비활성화한다. 번호 표시는 숫자 키 입력 처리와 별개다.
Hook allow는 원본 세션·턴·명령·
세션 위치를 바이트 단위로 대조한 뒤 해당 요청의 `behavior: allow`만 출력한다.
입력에 실린 자격 표식은 폐기하고 로컬 검증 결과로 다시 만든다. cwd는 Codex Hook이
제공하는 세션 위치이며 실제 command workdir/environment를 증명하지 않는다.
명시적 관리형 App Server 요청은 별도의 `accept` 경로다. 숨은·알 수 없는 필드, MCP·`apply_patch`, 다른 tool, 긴·여러
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
CLI가 allow/deny 공식 승인 JSON을 stdout에 성공적으로 쓰거나, `Codex에서 직접
결정`의 빈 stdout을 확정하고 EOF를 닫은 뒤 exact delivery ack를 보낸 경우에만
Pet receipt를 반환한다. 이 receipt도 Codex가 stdout을 소비했거나 명령을 실행·완료했다는
증거는 아니다. launcher가 자식 stdout을 종료까지 버퍼링하므로 ACK는 adapter 출력
접수 증거에 한정된다. write·EOF·ack가 실패하거나 결과가 불명확하면 자동으로 재출력·재시도하지
않는다.

관리형 Codex 자식 프로세스에는 `BLABEE_MANAGED_APPROVALS=1`을 명시해 같은
명령에 App Server 승인과 Hook 승인이 동시에 대기하지 않도록 한다. 이 표식이 있는
`PermissionRequest` Hook은 IPC를 호출하지 않고 빈 stdout으로 즉시 끝난다.

로컬 dogfood 실행:

```sh
# Plugin/Hook을 사용하는 일반 경로
codex [Codex arguments]

# App Server 권한 중계를 명시적으로 선택하는 실험 경로
/absolute/path/to/local-dogfood/bin/blabee-codex [Codex TUI arguments]
# 예: blabee-codex resume <thread-id>
```

일반 경로는 Blabee가 만든 native passthrough를 거치지 않는다. 사용자 셸에서 원래
`codex`를 그대로 실행하며, Blabee는 그 argv나 환경을 정리하거나 바꾸지 않는다.
`blabee-codex`는 호환 별칭이 아니라 사용자가 직접 선택한 관리형 실험 진입점이다.
관리형 실행은 먼저 인자 문법을 검증하고, 첫 번째로 발견된 native Codex source의
trust와 official package manifest를 확인한 뒤 본체, `codex-code-mode-host`, `rg`와
resources를 하나의 사용자 전용 private runtime bundle로 고정하고 지원 버전을 검사한다. 이 단계가
실패하면 안전한 실행 대상을 확정하지 못한 것이므로 fail-closed하며 네이티브
fallback하지 않는다. private bundle이 확정된 뒤 token·listener 같은 준비 단계가 첫
관리형 자식을 시작하기 전에 실패한 경우에만 같은 argv로 그 bundle의 `bin/codex`를 정확히 한 번
실행한다. 자식이 하나라도
시작된 뒤에는 사용자 작업이 시작됐을 수 있으므로 자동 재실행하지 않는다. 시작한
자식은 정리하고 실패를 보고한다. signal로 끝난 자식의 종료 상태는
`128 + signal` 규칙으로 보존한다.
세부 신뢰 기준은 [관리형 Codex 실행 신뢰 경계](docs/MANAGED_CODEX_TRUST.md)에 고정한다.
기본 `doctor`는 정적·읽기 전용이다. `codex --version`, Plugin 목록, Hook
App Server를 실행하지 않고 package manifest·layout·identity와 Blabee
build identity만 검사한다. 실제 Plugin locator가 확인되지 않으면 표준 앱 fallback만으로
build identity를 통과시키지 않는다. 실제 binary 버전, Plugin/Hook 활성, code-mode는
별도 live qualification 전까지 `action_required`로 보고한다.
semantic version allowlist와 production bundle catalog는 별도다. 2026-09-02 현재
exact full-bundle fingerprint가 등록된 production 대상은 official Homebrew Codex
`0.151.0` Apple Silicon 하나이며, 같은 Team ID·version만으로 다른 release host를
신뢰하지 않는다. `0.149.1`·`0.150.1`과 Intel target은 별도 bundle qualification 전
관리형 실행 자격이 없고, `0.152.0`·`0.152.1`은 version allowlist에도 포함하지 않는다.

Blabee는 `.zshrc`, alias, shell function 또는 전역 `codex` 명령을 설치하거나
변경하지 않는다. 일반 Codex와 Plugin/Hook 통합은 다음과 같이 원래 명령 형태와
동작을 그대로 사용한다.

```sh
codex
codex resume
codex resume <thread-id>
```

`blabee-codex`는 호출할 때마다 PATH·NVM·표준 Homebrew 후보의 소유권, 모드, ACL과
심볼릭 링크 target을 새로 검사한다. 첫 번째로 존재하는 후보의 bounded
`codex-package.json`과 exact package tree를 검사해 본체·host·resource가 같은 배포
단위인지 확인한다. 이를 canonical current-user 전용 임시 경로에 원자 복사하고 private
bundle의 `bin/codex`에서 지원 버전을 한 번 확인한다. 다른 버전의 host를 섞거나 본체만
복사하지 않는다. 버전 probe는 private process group과 bounded output을 사용하며 정상
종료·timeout·출력 초과에서 descendant를 정리한다.
복사 전에는 recovery plan을 임시 파일에 fsync한 뒤 원자 게시한다. 비정상 종료 뒤에는
exact managed UUID 이름, owner-only root, unlocked lease, plan과 partial tree가 모두
일치할 때만 잔여물을 회수하며 unrelated 임시 파일이나 unknown entry는 삭제하지 않는다.
`blabee-codex` wrapper는 coordinator를 실행하기 전에 `DYLD_*`, `__XPC_DYLD_*`,
`LD_*` loader override를 값 노출 없이 거부하고, coordinator도 같은 환경 경계를 다시
검증한다. wrapper 검사 도구가 실패해도 실행을 계속하지 않는다. 관리형 경로만 실패
폐쇄하며 일반 `codex` 환경은 변경하지 않는다.
probe·App Server·TUI·보조 세션과 fallback은 모두 같은 검증된 환경 snapshot을 사용한다.
승인 파일이나 원래 Codex 경로는 영속 저장하지 않는다. App Server·TUI·보조 세션과
fallback은 모두 같은 private bundle만 실행하며 첫 App Server 시작 직전을 포함한 각
spawn 경계에서 exact metadata tree와 작은 seal digest를 다시 확인한다. 전체 payload의
digest·서명은 bundle 최초 생성 때 검증하며 매 spawn마다 수백 MB를 다시 해시하지 않는다.
manifest·본체·host·resource identity가 바뀌면 실패 폐쇄한다. 관리형
환경의 host override는 제거하고 검증한 bundle의 exact host만 사용한다. 이 검사는
명시적 관리형 기능에만 적용되며 기본 `codex` 실행 허가에는 관여하지 않는다. 이미 실행 중인
Codex를 관리형 App Server 승인 경로로 사후 전환할 수는 없으므로, 그 기능이 필요할
때만 한 번 `/exit`한 뒤 `blabee-codex resume <thread-id>`로 다시 시작한다. 일반
Plugin/Hook 연결과 Hook 신뢰 여부는 이 관리형 경로와 별개의 Codex 보안 경계다.

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

현재 protocol semantic allowlist는 Codex `0.149.1`, `0.150.1`, `0.151.0`이다.
이 목록만으로 production managed runtime 승인을 뜻하지 않는다. Pet은 요청의
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
현재 새 결정 패킷은 우선순위가 매겨진 실행 가능한 다음 항목 2~4개만 가진다.
슬롯 1은 가장 권장하는 작업이고 슬롯 2~4는 순서대로 차선이다. 보류와 롤백은
새 숫자 슬롯으로 발행하지 않는다. 과거 고정 네 슬롯 패킷의 보류·rollback 의미는
이미 저장된 journal 및 frozen v1 packet replay 호환 목적으로만 읽는다.

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
아니다. 실제 wire identity와 manifest digest는 서명 후 패키지 coordinator의
`blabee.runtime-identity-inspection.v2` 응답이 같은 검증 snapshot으로 계산해
`runtime.identity.wire_runtime_identity`에 별도로 기록한다.
`strategy: process_cached_signed_code_and_manifest_v1`과
`resolved_at_process_start: true`가 나타내듯 process 시작 때 결정된다.

모든 새 UDS 요청은 `blabee.runtime-identity.v1/` request-type namespace와 같은
runtime identity를 함께 보낸다. 현재 identity는 기존 전체 operation을 사용한다.
assembly manifest v2가 검증된 이전 `Blabee.app`에서 계산해 명시적으로 승인한
identity는 `session_start`, `user_prompt_submit`, `emit_decision`, `stop`만 사용할 수
있다. 승인된 이전 요청의 성공·application error response는 요청 identity를 echo해
기존 client의 exact response 검사를 만족한다. 그 밖의 이전 identity와 Pet, Doctor,
프로젝트 설정, 권한 승인 operation은 dispatch 전에 거부한다. 호환 목록은 최대 두
개이며 다음 build로 자동 상속하지 않는다. 새 client가 구 server에 붙는 경로도 기존
namespaced type 검사에서 계속 mutation 전에 거부된다.

관리형 App Server 승인의 취소 가능 socket client도 이 계약을 예외 없이 사용한다.
선택 요청과 delivery ack의 response는 request ID와 exact runtime identity를 먼저
검사한다. downstream write 전 선택 요청의 mismatch·transport·application failure는
decision이나 token을 신뢰·재시도하지 않고 원래 Codex 승인 경로로 복귀한다. write 뒤
delivery ack는 한 번만 보내며 실패해도 재시도·네이티브 fallback·정상 bridge 종료를
하지 않고 coordinator의 미확정 전달 상태를 보존한다.

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
