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
사용한다. Hook은 연결·입력·응답 실패를 모두 fail-open하고, MCP는 JSON-RPC로
일반화한 오류만 반환한다. Plugin 설치, 제품 바이너리 PATH 등록, 자동 시작과
진단은 T-012가 소유한다.

## T-011 운영 경계

daemon은 `CoordinatorOperationalApplication` 하나를 UDS owner에 연결하며 다음
고수준 요청만 허용한다.

- `enable_project`, `session_start`, `user_prompt_submit`
- `emit_decision`, `stop`, `permission_request`
- Pet용 `get_state`/`pet_snapshot`, `focus_interaction`, `select`

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
