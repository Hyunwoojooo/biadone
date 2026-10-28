# Blabee Test.app 기술 설계

상태: 2026-10-19 현재 **M2 T-007 구현·자동 회귀·실제 child 수용 완료 / 수동 UI·공존 수용 대기**다.
사용자가 M2 진행을 직접 승인해 M1 수동 수용과 별도로 진행했다. M1 최종 수용과 M2 실제 창 수용은 아직 남아 있다.
M3·실제 OAuth는 후속 미구현이며 이 문서는 설치 제품·운영 계정·DB·Keychain 변경 기록이 아니다.

관련 문서: [개요](README.md) · [조사](RESEARCH.md) · [코드맵](CODEMAP.md) · [실행 계획](IMPLEMENTATION_PLAN.md) · [작업표](AGENT_TASKS.md) · [진행 상태](TASK_STATUS.md)

## 1. 목표

동일 Mac에서 제품 Blabee를 유지하면서 첫 실행과 연결 오류를 반복 확인한다.
온보딩을 다시 보기 위해 사용자 계정 생성·설정 수동 삭제·재설치를 반복하지 않게 한다.
공통 화면과 Engine 소스는 한 벌로 유지하고, 실행 환경과 부수 효과를 분리한다.

검증 수준을 다음처럼 나눈다.

| 단계 | 확인하는 것 | 확인했다고 말할 수 없는 것 |
| --- | --- | --- |
| M1 UI 시뮬레이션 | 온보딩, 버튼, 상태 안내, 복구 흐름 | 실제 Plugin 설치, Engine 권위 검증, OAuth |
| M2 격리 Engine | 저장·검증·만료·claim·세션 바인딩 | 실제 Codex/Claude 연결, 제품 Keychain 복구 |
| M3 실제 도구 연결 | 격리된 도구 설정·Hook·카드 전달 | 깨끗한 OS에서의 설치·권한·업데이트 전체 |

DMG 설치·Gatekeeper·macOS 권한·업데이트는 최종 배포 검사로 별도 유지한다.

## 2. 전제와 범위

- 현재 변경은 기존 M1에 M2 실제 Engine 시나리오·서비스·저장 자원 조립을 추가한다. M1의 최종 수동 수용은 아직 남아 있다.
- M2 착수 승인은 M1 수용 완료를 뜻하지 않는다. 기존 M1은 M2·M3와 독립된 UI 시뮬레이션으로 유지한다.
- 현재 제품의 bundle ID, Contracts, 저장 schema, 권한 검증 규칙을 바꾸지 않는다.
- 사용 중인 제품 앱·Codex·Claude·DB·인증정보·셸 설정을 보존한다.
- 프로젝트 복사본을 별도 제품으로 유지하거나 모듈을 다시 나누지 않는다.
- `HOME` 변경이나 환경변수 하나만으로 격리가 끝났다고 간주하지 않는다.

## 3. 현재 구조에서 필요한 분리

[Package.swift](../../../Package.swift)는 기존 target에 소스를 명시적으로 등록한다.
같은 파일을 두 target에 중복 등록하는 방식으로 Test.app을 만들지 않는다.
[BlabeeProductProfile](../../../app/service/product-support/BlabeeProductProfile.swift) 등에는 제품 경로와 식별자에 대한 전제가 있다.
authority 경로에는 `HOME`만 바꿔도 바뀌지 않는 부분이 있다.
Codex 실행기, Plugin launcher, OAuth callback, Keychain service에도 별도 분리가 필요하다.
따라서 이름을 바꾼 `.app`이나 임시 DB만 지정한 제품 바이너리는 테스트 환경이 아니다.

수정 지점의 근거와 세부 위치는 [코드맵](CODEMAP.md)을 기준으로 한다.
현재 M1·M2 API는 아래 5~9절과 코드맵에 명시한다. M2 소스의 child·authority 경계와
그 경계의 실행 검증을 구분한다. M3 provider 경로·인증 계약은 후속 설계다.

## 4. 제품 결정과 기술 결정

### 제품 결정

- 앱·메뉴바·설정·진단에 `TEST`를 표시한다. 제품과 동시에 켜도 구별되어야 한다.
- 시작 화면에서 시나리오를 고르고, 실행 중에도 온보딩을 다시 열 수 있다.
- `온보딩 다시 보기`는 현재 run을 유지하며 화면을 되돌린다.
- `새 테스트 시작`은 소유 작업을 정리한 뒤 새 run을 만든다.
- 시나리오 변경도 같은 초기화 절차로 새 run을 만든다. 현재 run의 응답 데이터만 교체하지 않는다.
- 앱을 다시 실행하면 `이전 테스트 이어보기` 또는 `새 테스트 만들기`를 명시적으로 고른다.
- 이전 선택 작업을 자동 재전송하거나 자동 실행하지 않는다.

### 기술 결정

- 기존 Swift target을 제품용 또는 테스트용으로 각각 컴파일한다.
- 컴파일 시 고정된 프로필을 초기 조립에 전달하고 scratch/output 경로도 분리한다.
- 제품 바이너리에 테스트 계정 허용 스위치나 런타임 프로필 전환을 넣지 않는다.
- 앱·서비스·helper가 서로 다른 프로필 또는 run으로 연결되면 요청을 거절한다.
- 테스트 여부를 UI 분기만으로 처리하지 않고 의존성 조립과 저장소 경계에 반영한다.
- 신규 production 의존성은 필요하지 않다. 기존 Swift·SwiftUI·테스트 도구를 우선 사용한다.

## 5. 프로필과 초기 조립

기존 `BlabeeProductProfile.current`를 `BLABEE_TEST_APP` 컴파일 조건으로 고정한다.
제품 결과는 `.blabee`, Test 결과는 `.blabeeTest`이며 별도 `AppExecutionProfile` 타입은 추가하지 않았다.
`main.swift`는 Test에서 제품 runtime admission·authority lease·설치·CLI dispatch 전에 조기 분기한다.
`BlabeeTestLaunchPolicy`는 인자 없는 M2 개발 bundle의 GUI 진입만 허용하고 제품 명령을 거절한다.
`main.swift`의 Test 분기는 `test-engine-service`와 `test-engine-check`를 각각 별도 검증 진입점으로 보낸다.
`distribution-profile` 출력은 조립 검사에 사용한다. 운영 실행 인자로 Test 프로필을 켤 수는 없다.

초기 제안 `TestRunContext` 대신 실제 구현은 다음 객체로 나뉜다.

- `BlabeeTestRunManifest`: schema·store/run UUID·UID·시나리오·생성 시각·소유 경로·defaults suite.
- `BlabeeTestRunStore`: marker·manifest 검증, create/resume/inventory, snapshot·로컬 결과 저장.
- `BlabeeTestRunLease`: 해당 run의 파일 lock. 프로세스를 검색하거나 종료하지 않는다.
- `BlabeeTestWorkspaceController`: 현재 run/composition, view generation, 전환·이어보기·재생 수명.
- `BlabeeTestComposition`: 공통 UI와 모의 계정·provider·설정 조립. `engineIsolation`에서만 실제 `BlabeeTestEngineSession`을 만든다.
- `BlabeeTestEngineSession`: 검증된 bundle·run 자원으로 직접 child를 만들고 요청·재시작·무효화·drain을 관리한다.
- `BlabeeTestEngineCore`: 공통 Swift journal·routing·operational actor와 Test 내부 fixture queue를 조립한다.

경로는 검증된 Test root에서 계산한다. 외부 입력의 절대 경로를 그대로 신뢰하지 않는다.
운영 경로로의 fallback은 없다. 구성 실패는 테스트 초기화 실패로 표시한다.

현재 namespace와 후속 설계는 다음과 같다. 기존 제품 기본값은 바꾸지 않는다.

| 대상 | Test 전용 기본안 | 적용 단계 |
| --- | --- | --- |
| 앱 이름·bundle ID | `Blabee Test.app` · `com.biadone.blabee.test` | M1 구현 |
| 조립 결과 | `build/test-app/<buildID>/Blabee Test.app`; 제품 설치 위치에 복사하지 않음 | M1 구현 |
| 영속 데이터 | 사용자 Application Support의 `Blabee Test/runs/<runUUID>/` | M1 구현 |
| UserDefaults suite | `com.biadone.blabee.test.run.<runUUID>`; manifest에 소유 suite 기록 | M1 구현 |
| 로컬 로그·결과 | `<runRoot>/logs/` · `results/m1-report.json` 또는 `results/m2-report.json`; 토큰·키 원문 저장 금지 | M1·M2 소스 구현 |
| Engine 자원 | `settings/engine-v1/storage/`의 DB·키, `authority/`, `project/`; 별도 registry | M2 소스 구현 |
| 서비스 수명 | Test가 직접 소유한 자식 프로세스; 제품 LaunchAgent 등록·재사용 없음 | M2 소스 구현 |
| freshness | `KeychainFreshnessAnchorStore.defaultService` + 정확한 `test-<소문자 runUUID>` account; `primary` 금지 | M2 소스 구현 |
| Codex 설정 | `<runRoot>/providers/codex/`; 설치·검사·실행의 CODEX_HOME 일치 | M3 |
| Claude 설정·프로젝트 | `<runRoot>/providers/claude/` · `<runRoot>/projects/`; 실제 인증 분리는 별도 확인 | M3 |
| OAuth callback | `com.biadone.blabee.test://auth/callback`; staging 허용 목록과 일치 | 선택 T-010 |

M1의 manifest는 저장 형식 `profile: test`를, 앱 배포 marker는 `blabee-test`를 사용한다.
M1은 UserDefaults suite만 run에 연결하고 socket·freshness·실제 OAuth·공급자 인증 저장소는 생성하지 않는다.
M2도 `manifest-v1.json`의 schema와 소유 경로 목록을 바꾸지 않는다. Engine 경로·freshness service/account는
`settings/engine-resources-v1.json`에 기록하고 Engine root의 `.blabee-test-engine-v1.json`과 대조한다.

## 6. M1: UI 시뮬레이션

[PetViewModel](../../../app/coordination/PetViewModel.swift)과 공통 SwiftUI 화면을 재사용한다.
초기 조립에서 계정·접근 상태·transport·CLI 검사·설정 쓰기 경계를 모의 구현으로 대체한다.
제품 계정의 로그인 상태나 실제 설치된 CLI를 읽어 시나리오를 덮어쓰지 않는다.
가짜 계정은 표시용 데이터이며 실제 JWT나 제품 entitlement를 만들지 않는다.
모의 transport로 표시한 카드는 실제 Engine 검증을 통과한 카드라고 기록하지 않는다.

M1의 필수 시나리오는 다음과 같다.

| 시나리오 | 재현할 화면과 사용자 행동 |
| --- | --- |
| 처음 설치 | 튜토리얼 → 모의 로그인 → 약관 → 연결 설정 |
| Codex 미설치 | 설치 안내와 다음 행동의 강조 |
| Plugin 준비 중 | 진행 상태, 중복 클릭 방지, 취소 |
| Hook 검토 대기 | Codex에서 할 행동과 Blabee 복귀 후 모의 재검사 |
| 연결 실패 | 원인 안내, 복구 버튼, 재시도 후 성공 |
| 연결 완료 | 완료 조건과 실제 카드 검증 여부의 구별 |
| 늦은 응답 | 다른 카드·시나리오 전환 후 이전 응답 무시 |
| 로그인 취소 | 첫 모의 로그인 취소 후 재시도 |
| 로그인 실패 | 첫 모의 로그인 실패와 오류 안내·재시도 |

시나리오의 시간·응답 순서·실패 결과는 재현 가능하게 고정한다.
시나리오 전환이 실제 설치·서비스 시작·브라우저 로그인·명령 실행으로 이어지면 안 된다.
M1은 네트워크·모델 호출·실제 Engine 생성·Keychain 접근을 0으로 유지한다.
자동 업데이트·로그인 항목·전역 단축키·운영 telemetry도 기본 비활성이다.
단순히 요청을 보내지 않는 설정 대신 해당 실행 경로를 조립하지 않는 방식을 우선한다.
현재 구현은 `BlabeeTestComposition`과 `BlabeeTestScenario`의 9개 preset을 사용한다.
로그인 취소·실패도 모의 응답이며 credential은 메모리에만 둔다. 저장한 인증정보를 복원하지 않는다.
모의 transport polling·접근 상태 확인 타이머는 허용하며 run 종료 시 취소한다. 실제 서비스·네트워크 polling은 없다.
전역 단축키는 등록하지 않는다. 카드의 `Unavailable / 사용 불가` 표식은 예상 가능하며 선택·건너뛰기는 마우스로 검사한다.

## 7. run 저장소와 경로 방어

기본 store root는 `~/Library/Application Support/Blabee Test`, 각 run은 `runs/<runID>`다.
현재 제품의 `.blabee`나 Codex·Claude 기본 설정 디렉터리를 공유하지 않는다.
run manifest와 소유권 marker를 생성하고, 새 생성과 이어보기에서 모두 검증한다.
심볼릭 링크·잘못된 소유자·예상 밖 권한·marker 불일치·run ID 불일치를 거절한다.
확인되지 않은 기존 디렉터리를 자동으로 테스트 root로 채택하지 않는다.

M1은 Unix socket을 열지 않는다. `BlabeeTestRunStore.proposedSocketURL`의 계산 형식은
`/private/tmp/blabee-test-<uid>/<소문자 runUUID>/svc.sock`이다. M2는 `prepareEngineStorage(for:)`에서
해당 짧은 경로의 디렉터리와 marker를 명시적으로 등록하고 child가 실제 socket을 연다.
Darwin의 103-byte pathname 예산을 넘지 않게 UTF-8 byte 수와 NUL 공간을 검증한다.
데이터 root 전체를 socket 경로에 이어 붙이거나 문자열 길이만 검사하지 않는다.
짧은 ID 충돌·남은 socket·다른 사용자의 root는 소유권 확인 없이 재사용하지 않는다.
UID root의 `.blabee-test-sockets-v1.json`과 run root의 `.blabee-test-socket-run-v1.json`은
profile·소유 UID·정규 경로와 해당 store/run을 검증한다. 긴 데이터 root를 바꿔도 socket scope는 검증한다.

## 8. 초기화·취소·이어보기

`새 테스트 시작`은 다음 순서를 따르는 단일 전환으로 설계한다.

1. 현재 뷰 generation을 먼저 무효화하여 늦은 결과가 UI를 갱신하지 못하게 한다.
2. 현재 run이 소유한 task에 취소를 전달하고 새로운 작업 접수를 중단한다.
3. 소유한 child와 lease를 drain하고 종료·자원 해제 여부를 확인한다.
4. 새 run을 준비·검증한 뒤 새 context와 화면을 한 번에 publish한다.

drain timeout이나 준비 실패 시 기존 run 파일과 진단 근거를 보존한다.
기존 generation을 되살리거나 실패했는데 새 run이 시작됐다고 표시하지 않는다.
필요한 경우 오류 화면에서 재시도·이어보기·명시적 종료 중 허용된 행동을 제공한다.
이어보기는 소유권과 남은 작업을 다시 확인하고 새 generation으로 조립한 뒤에만 허용한다.
후속 삭제 기능도 소유권이 확인된 항목에만 적용한다. 현재 M1은 부분 생성된 새 run도 보존한다.

현재 `transition`은 기존 작업을 중지하고 파일 lease를 교체한 뒤 새 run/composition 쌍을 publish한다.
실패 시 이전 객체는 무효화 상태를 유지한다. 이전·부분 생성 run은 보존하며 UI에 일괄 삭제 기능은 없다.
M2의 `BlabeeTestComposition.drain()`은 실제 Engine session의 drain까지 기다린다.
직접 만든 `Process`에만 `terminate()`를 보내며 2초 안에 종료하지 않으면 child 참조와 이전 lease를 보존한다.
성공한 reset으로 표시하거나 다음 run을 공개하지 않는다. 앱 종료도 drain 실패 시 완료로 응답하지 않는다.

PID·실행 파일 이름·경로가 같다는 이유만으로 프로세스를 종료하지 않는다.
실제 M2는 직접 생성한 `Process` 참조·생성 시 받은 PID·run/launch ID·lease·검증된 IPC를 사용한다.
`Process.processIdentifier == ownedPID`와 `isRunning`을 확인한 뒤 해당 객체만 종료한다.
외부 PID 검색·프로세스 채택이나 이름으로 일괄 종료하는 경로는 없다.
제품 앱·사용자 터미널·외부에서 시작된 Codex/Claude 세션은 종료 대상이 아니다.
온보딩 다시 보기도 기존 비동기 응답이 새 화면을 덮어쓰지 않게 뷰 generation을 바꾼다.

이어보기는 manifest·프로필·경로·상태 검증 후 명시적 선택으로만 수행한다.
남아 있는 선택·claim·중단 요청은 이력으로 표시하며 자동 실행하지 않는다.
시뮬레이션 pending 상태의 재현과 실제 작업의 재전송을 서로 다른 기능으로 취급한다.
현재 이어보기는 저장된 모의 온보딩·프로젝트·Plugin 설정을 읽고 계정·응답 객체를 시나리오로 재구성한다.
`replayOnboarding`은 같은 run의 온보딩 진행만 초기화하며 모의 계정·연결 객체는 유지한다.
M2의 명시적 이어보기와 같은 run의 child 재시작은 journal 이력을 다시 열되 seed·claim·queue를 자동 복원하지 않는다.
재시작한 child의 메모리 fixture queue는 0이며 새 launch ID와 runtime identity를 사용한다.

## 9. M2: 실제 Engine 격리 — 구현·자동 회귀·실제 child 수용 완료

`BlabeeTestScenario.engineIsolation`만 `usesRealEngine=true`이며 M1 UI 모드와 구분한다.
`BlabeeTestEngineCore`는 공통 `SQLiteJournal`, `CoordinatorRoutingApplication`,
`CoordinatorOperationalApplication`을 연결한다. Node 참조 엔진을 실행 권위로 사용하지 않는다.
DB·storage key·continuation key·selector key·socket·authority·freshness 식별자는 run에 바인딩한다.
[SQLiteJournal](../../../engine/persistence/SQLiteJournal.swift)의 검증을 모의 성공으로 대체하지 않는다.
MAC·sequence·freshness·만료·단일 claim·세션 바인딩·stale revision 검출을 유지한다.
test 요청에 대해서만 검증을 생략하는 우회 경로를 제품 Engine에 추가하지 않는다.

freshness는 `BlabeeTestEngineFreshnessFactory.make`가 `KeychainFreshnessAnchorStore.defaultService`와
정확히 `"test-" + run.runID.uuidString.lowercased()`인 account로 만든다.
service 변경을 허용하려고 Engine 생성자 guard를 넓히지 않는다.
`test-*` 접두어만으로 허용하지 않고 경로의 account와 store의 `storageSlot`이 해당 run 값과 모두 같아야 한다.
`primary`·다른 run은 거절하며 `allowsTestDeletion=false`로 생성해 초기화 중 Keychain 삭제를 하지 않는다.
M2에서는 운영 primary·로그인 계정 항목의 조회·수정·삭제를 0으로 유지한다.
MAC·rollback·freshness 검증을 유지하며 파일 store로 조용히 fallback하지 않는다.
M1의 Keychain 호출 0과 M2의 테스트 freshness 항목 사용을 서로 다른 정책으로 기록한다.
계정 인증용 Keychain의 전용 service·run별 slot은 app 계층의 별도 설계 대상이다.

child는 `test-engine-service --store-root ... --run-id ... --launch-id ... --parent-pid ...`로 시작한다.
argv에는 소유 좌표만 넣으며 selector·키는 검증한 run의 파일에서 읽는다. 직접 부모의 UID·실행 파일·현재
parent PID를 확인하고 parent 소실 시 server를 정지한다. `CoordinatorAuthorityLease`는 run 전용
`authorityRootURL`과 `includesPrimaryNamespace=false`를 사용해 운영 authority 및 primary lock과 분리한다.

UDS runtime identity는 store/run/launch와 selector key를 hash한 값이다. 각 요청은
`blabee_test_scope`의 `profile`, `store_id`, `run_id`, `launch_id`와 `auth_token`을 확인한다.
호출자가 이미 scope/auth를 넣은 요청, 다른 run·launch·selector, 다른 project cwd는 거절한다.
동기 UDS I/O는 GUI actor 밖에서 수행하고 응답 후에도 active launch를 다시 확인한다.

Test 제어는 기존 `doctor_status` route의 `blabee_test_engine.operation`에 `report`·`seed`·`claim`만 허용한다.
제품 server allowlist나 Contracts/v1을 추가하지 않는다. `seed`는 빈 journal에서만 명시적으로 실행한다.
공통 카드 UI의 선택은 Test child 내부 `BlabeeTestEngineFixtureQueue`에만 기록하며 실제 provider로 보내지 않는다.
`claim`은 해당 선택의 delivery turn을 재사용하므로 같은 턴 재시도는 durable claim을 늘리지 않아야 한다.
재시작 때 journal의 claim 이력은 남지만 메모리 queue를 복원하거나 이전 선택을 재전송하지 않는다.

`BlabeeTestEngineReport`는 실제 journal·integrity·sidecar·queue·claim 수를 반환하고
provider 제출·실행 수를 0으로 표시한다. `results/m2-report.json`으로 저장하며 실제 작업 완료 증거로 해석하지 않는다.
child 로그는 bounded ready/error frame의 고정 진단 코드만 저장하고 raw 출력·selector·키를 남기지 않는다.

Test 전용 `test-engine-check --store-root /private/tmp/blabee-test-m2-check-<소문자 UUID>`는 새 root만 허용한다.
내부 `test-store`에 새 run을 만들고 실제 freshness Keychain·owned child·UDS로 초기 빈 상태 → seed →
선택 → claim → 같은 턴 재시도 → child 재시작 → queue 0·claim 이력 보존 → drain을 검사하도록 구현했다.
실제 CLI 수용은 PASS(exit 0)했다. queue 1·claim 1·동일 턴 재시도의 추가 이벤트 0, 재시작 queue 0·claim 1,
integrity `ok`·child 종료·provider 실행 0을 확인했다. 실제 test freshness 항목과 검증 파일은 보존한다.
CLI 오류 정리 중 drain이 실패하면 `drainBlabeeTestEngineCheck`가 `cleanup_pending`을 한 번 보고하고
child 종료 전까지 session·lease·event loop를 유지한다. spawn 실패 재시도도 새 launch ID·로그 경로를 사용한다.
수동 창 조작과 제품 공존은 이 CLI가 검증한 범위에 포함되지 않는다.

## 10. M3: 실제 Codex·Claude 연결 — 후속 미구현

설치·검사·Hook·launcher가 같은 run의 설정 root와 프로필을 사용해야 한다.
Codex에 별도 설정 root를 전달하는 whitelist와 자식 환경 구성을 함께 검토한다.
별도 launcher가 run ID·profile·authority 경로를 전달하고 양쪽에서 확인한다.
Test Plugin 설치물이 제품 서비스나 기본 사용자 설정으로 되돌아가지 않게 한다.
기존 사용자 Plugin·CLI 설정·세션·`.zshrc`는 변경하지 않는다.

실제 도구 로그인이 필요한 경우 테스트 프로필에서 사용자가 명시적으로 진행한다.
모델 호출과 비용은 이 단계에서만 발생할 수 있으며 M1·M2와 구분한다.
과거 사건의 ref를 재전송하지 않고 새 테스트 작업으로 카드 수신→선택→claim을 확인한다.
작업 전달 성공과 실제 실행 완료의 근거를 각각 남긴다.

Blabee 실제 OAuth는 M3의 암묵적 요구사항이 아니다.
별도 staging backend·OAuth client·callback·Keychain 분리가 준비된 후 후속 단계로 검토한다.
그 전에는 계정 화면을 모의하며 production OAuth callback을 공유하지 않는다.

## 11. 빌드·패키징 경계

기존 target·모듈명을 유지하고 프로필별 컴파일 조건과 앱 조립 입력을 분리한다.
같은 Swift 파일은 정확히 하나의 target에만 포함한다.
제품 빌드와 테스트 빌드는 scratch/output을 공유하지 않는다.
프로필 식별 메타데이터를 앱과 helper에 넣어 혼합 번들을 거절한다.
Test.app은 별도 이름·bundle ID·아이콘 표시·설정 namespace로 조립한다.
제품 release 조립은 Test 메타데이터·시나리오·모의 계정이 포함되면 실패해야 한다.
Test.app 자동 업데이트와 Applications의 제품 덮어쓰기는 허용하지 않는다.
현재 builder는 [build-test-app.mjs](../../../scripts/build-test-app.mjs)다.
`npm run build:test-app -- --build-id <ID>`로 `build/test-app/<ID>/Blabee Test.app`을 조립한다.
동일 ID를 덮어쓰지 않으며 Test 전용 scratch·도구 HOME·모듈 cache를 사용한다.
로컬 ad-hoc 서명·strict 확인을 수행한다. Developer ID 서명·Apple 공증·DMG·제품 설치는 하지 않는다.
현재 builder metadata는 milestone `M2`, mode `isolated-development`, simulation flag `false`, Engine flag `true`다.
`TestAppManifest.json`의 `keychain_policy`는 `run_scoped_freshness_only`이며 native provider·운영 서비스·network는 false다.
현재 [M2 Blabee Test.app](../../../build/test-app/m2-20261019/Blabee%20Test.app)의 조립·ad-hoc strict 서명·plist·
`blabee-test` / `com.biadone.blabee.test` profile 확인을 통과했다. 파일 hash와 실행 근거는 M2 QA 기록을 따른다.
아래는 과거 M1 근거이며 M2 심볼 수나 M2 화면 검증 기록이 아니다.
M1 검증 산출물은 [m1-20261019-02의 Blabee Test.app](../../../build/test-app/m1-20261019-02/Blabee%20Test.app)이다.
실제 조립·strict 서명·plist 검사를 통과했고 profile probe는 Test였다. Test 바이너리에서 `service` 명령을 거절(exit 1)했다.
제품 실행 파일의 `BlabeeTest` 심볼 0개, Test 실행 파일의 해당 심볼 76개를 확인했다.

## 12. 검증 전략과 위험

M1은 금지된 네트워크·CLI·Engine·Keychain port 호출을 실패시키는 대역으로 검사한다.
초기화·앱 재실행·취소·늦은 응답·두 Test 인스턴스 충돌을 회귀 조건에 넣는다.
Test가 소유한 임시 경로에 제품 경로 대역과 sentinel을 만들고 보존 여부를 검사한다.
이 검사를 위해 실제 운영 폴더를 읽거나 sentinel을 쓰지 않는다. profile 혼합도 거절한다.
M2는 검증 실패 fixture를, M3는 격리된 새 세션의 실제 왕복 근거를 사용한다.
영어·한국어, 밝은·어두운 화면, 460×550 및 좁은 창에서 주 버튼을 확인한다.
`npm run test:swift:test-app`은 기존 직렬 잠금, Test profile, 전용 scratch를 유지하고 Engine 관련 필터를 추가했다.
M2는 Node 패키징 9개와 Swift 실행기의 98 tests / 7 suites PASS를 확인했다.
Swift 회귀의 freshness는 명시적으로 주입한 메모리 대역이며, 실제 Keychain·owned child/UDS CLI 수용도 별도로 통과했다.
조건부 화면 render 1개는 `BLABEE_TEST_APP_RENDERS=0`으로 skip했다. 제품 identity/profile 회귀는 2 tests / 1 suite PASS다.
제품 stateless profile은 `blabee` / `com.biadone.blabee`, `nm`의 `BlabeeTest` 검색 결과는 Test 82행·제품 0행이다.
M2 Test의 제품 `service` 명령과 기존 수용 root 재사용은 exit 1로 거절했다. 저장 report의 event/sequence는 8/8,
integrity·quick check ok, sidecar 2개이며 재시작 뒤 queue·durable queued 0, claim 1·provider 실행 0을 확인했다.
과거 M1 Test Swift 51개/4 suites, 제품 profile 회귀 70개/8 suites 통과는 현재 M2 소스의 검증 결과가 아니다.
M1 Test 검사는 `BLABEE_TEST_APP_RENDERS=1 npm run test:swift:test-app`으로 렌더를 포함했다.
처음 설치·미설치·카드의 영어 밝은 화면/한국어 어두운 화면 PNG 6장을 생성하고 직접 시각 검토했다.
native 조작 도구 부재로 실제 창 클릭·메뉴바 재열기·제품 앱과의 동시 실행은 미실행이며 T-006 수용은 대기다.
M1의 네트워크·Keychain 차단 판단은 조기 분기·DI·금지 경로 검토에 근거하며 OS sandbox나 전체 API 계측의 증거는 아니다.
M2는 기존 freshness service를 바꾸지 않고 해당 run의 test account만 사용했다. 운영 `primary`·계정 항목은
접근 대상이 아니며, 이 판단은 소스·scope·실행 근거에 기반한다. OS 전체 Keychain API 계측을 수행한 결과는 아니다.
과거 결과는 [M1 QA 기록](QA_REPORT.md), 현재 결과는 [M2 QA 기록](M2_QA_REPORT.md)에 구분한다.

가장 큰 위험은 공통 코드의 암묵적 제품 singleton과 hard-coded 식별자다.
다음 위험은 reset 도중 늦은 결과·살아 있는 helper가 새 run에 연결되는 경쟁 조건이다.
M2는 사용자의 직접 진행 승인에 따라 M1 수동 수용과 별도로 착수했다. 각 단계의 수용 상태는 합치지 않는다.
실제 Engine의 자동·CLI 수용을 마쳤다. 수동 창·공존과 외부 CLI 인증 namespace는 별도 수용 및 M3 후속으로 남긴다.
결정이 남은 항목은 M3 도구별 분리 지원 범위와 실제 OAuth 도입 여부다.
새 Test.app의 공증·외부 배포는 개발용 MVP 완료와 별도로 결정한다.
