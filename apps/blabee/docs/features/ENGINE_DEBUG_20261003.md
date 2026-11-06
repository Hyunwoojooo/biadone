# Engine 디버깅 결과 — 2026-10-03

현재 작업 트리의 Engine·공통 Operational 연결을 검사했다. 기존 회귀는 통과했지만,
추가한 격리 재현에서 수정할 동작 3개와 입력 계약의 불일치 1개를 확인했다.
과거 사용자 실패 사건의 원인을 이번 결과만으로 확정하지 않는다.

최초 진단에서는 제품 구현과 기존 테스트를 변경하지 않았고, 재현 테스트는 `/private/tmp`의
소스 복사본에만 추가했다. 이후 1~4번 수정은 아래에 별도로 기록한다.
설치 앱, 사용자 세션, 운영 DB, 실제 Keychain 및 인증정보는 사용하거나 변경하지 않았다.
배포 앱 빌드·패키징·설치·commit·push는 수행하지 않았다. 테스트용 Swift 컴파일은 수행했다.

## 1. Hook이 queue receipt보다 먼저 들어오면 시스템 시각 보정에 취약함

**우선순위: 높음.** 선택 직후에도 `transport_completion_after_in_flight_deadline`으로
action context 전달이 거절될 수 있다. 조건은 시스템의 절대 시각이 앞으로 이동하는 경우다.
시간대 표시 변경만으로 발생한다는 뜻은 아니다.

- Operational은 `wallInstantGenerator()`의 시각으로 completion을 만든다.
  `app/coordination/CoordinatorOperationalApplication.swift:4390`.
- 일반 receipt-first 경로는 `prepareTransportCompletionLocked`로 monotonic anchor에
  맞게 시각을 보정한다. `engine/routing/CoordinatorRoutingApplication.swift:368`.
- Hook-first의 3개 이벤트 batch는 이 보정을 거치지 않는다.
  `engine/routing/CoordinatorRoutingApplication.swift:636`.
- Semantic은 전달 완료 시각을 300초 in-flight deadline과 비교한다.
  `engine/semantic/CoordinatorSemanticApplication.swift:903`.

**재현:** 선택·token 소비 후 monotonic clock은 1초만 진행하고 절대 시각만 10분 앞으로
옮긴 입력을 사용했다. Hook-first는 위 오류로 실패했다. 같은 입력의 receipt-first는
성공했고 논리 완료 시각, 단일 claim, 8개 이벤트 상태까지 기대값과 일치했다.
선택 유효기간·사용자 클릭 속도 문제와는 별개다.

**수정 방향:** Hook-first 완료 시각도 동일한 monotonic authority에서 계산한다.
원자적 3-event batch, CAS 충돌 처리, exact turn/session/digest 검증을 유지한다.
이미 완료된 동일 턴의 durable claim 재시도에 새로운 만료 조건을 붙여서는 안 된다.
수정 시 receipt-first/Hook-first, 시각 전진·후퇴, 실제 monotonic deadline 초과를 함께 검사한다.

### 1번 수정 완료 — 2026-10-05

- Hook-first의 `complete_transport`에도 기존 `prepareTransportCompletionLocked`를 적용했다.
  시스템 절대 시각 대신 dispatch의 연속 시간 anchor로 완료 시각을 계산한다.
- authority 조회가 오래 걸릴 수 있어, 조회 후 clock을 새로 읽고 실제 300초 deadline을
  검사한다. cached tick으로 시각을 소급하지 않는다. 연속 시계의 역행은 latch하고 focus를
  해제해 거절한다. 시계가 원래 값으로 돌아와도 scheduler 정리 전에는 다시 허용하지 않는다.
- 이 preflight는 journal을 읽거나 쓰지 않는다. timeout의 durable 정리는 기존 scheduler가
  담당하며, completion·close·claim의 단일 원자적 append와 supplied authority CAS를 유지한다.
- 이미 완료된 claim-only 경로에는 새 deadline이나 process-local anchor 조건을 추가하지 않았다.
  재시작 후 동일 턴의 정확한 재시도는 기존 durable claim으로 복구한다. 자동 재전송·실행은 없다.

**변경 파일:** `engine/routing/CoordinatorRoutingApplication.swift`,
`Tests/swift/CoordinatorSwiftTests/RoutingApplicationTests.swift`, 이 문서.

**검증:** 새 회귀 3개 함수(6개 시나리오)는 수정 전 실패, 수정 후 통과했다.
Hook/receipt 순서 × 절대 시각 전진·후퇴, authority 조회 도중 실제 deadline 도달,
연속 시계 역행 후 재시도 차단을 검사했다. 재시작 후 단일 claim과 추가 load 없음도 확인했다.
현재 모듈 소스 27개와 Engine 테스트 11개 파일을 그대로 복사한 격리 패키지에서
**254개 통과, 대용량 opt-in 벤치 2개 건너뜀**을 확인했다(러너 요약 256 tests passed).
기존 세션·턴 바인딩, 응답 유실·재시도, 다른 writer 변경,
freshness·MAC와 SQLite 검증 비용 회귀를 포함한다. 정상 claim의 공개 load 1회,
semantic replay 1회, append 1회, 전체 저장소 검증 3회 조건을 유지했다.
실제 Keychain 통합·복구는 필터에서 명시적으로 제외했다.
테스트 러너의 41.249초는 설치 앱의 처리 시간 측정값이 아니다.

원본 프로젝트의 `npm run test:swift -- --filter routingQueuedCompletion`은
이번 변경 밖의 `MCPInputLineReaderTests.swift`에서 `#expect`의 throwing 호출 처리
컴파일 오류로 테스트 시작 전에 중단됐다. 해당 파일은 이번 작업에서 변경하지 않았다.
격리 검증도 `npm run test:swift`와 기존 `/tmp/blabee-coordinator-swift-tests.lock`으로
직렬 실행했다. 원본과 사본의 38개 소스·테스트 파일 일치를 확인했다.
별도 정적 리뷰에서 추가 결함은 발견하지 못했다.

근거: `/private/tmp/blabee-engine-clock-fix-20261003-xuxuai5l/`의
`regression-before.log`(원본 프로젝트 컴파일 실패), `isolated-before.log`,
`isolated-after.log`, `engine-regression.log`, `source-copy-verification.json` 및 `before/`.

배포 앱 빌드·설치·실사용 검증은 하지 않았다. 원본 프로젝트의 별도 컴파일 오류를 해결한 뒤
전체 Swift 테스트를 다시 실행하고, 다음 설치본의 **새 카드**로 Hook 응답 수신·durable claim·
실제 실행을 각각 확인해야 한다. 이번 수정만으로 과거 사건의 원인이 확정되지는 않는다.

## 2. 저장소 잠금에 대기 상한이 없음

**우선순위: 높음.** 다른 writer가 잠금을 놓지 않으면 journal 처리와 그 처리를 기다리는
공통 서비스 요청이 길게 정지할 수 있다. SQLite의 busy timeout과 별도의 문제다.

`engine/persistence/StorageProcessLock.swift:27`의 `NSLock.lock()`과 72행의
blocking `flock(LOCK_EX)`에 timeout 또는 cancellation 조건이 없다.

**재현:** 현재 `StorageProcessLock` 소스를 그대로 컴파일한 두 임시 프로세스를 사용했다.
첫 프로세스가 임시 폴더의 잠금을 보유하는 동안 두 번째 프로세스는 **9.018초**가 지나도
busy/timeout 응답 없이 대기했다. 첫 프로세스가 잠금을 놓은 뒤에야 정상 종료했다.
이 측정은 설치 서비스 지연 측정이 아니다. 무제한 대기 가능성은 코드로 확인했고,
실험은 Hook 응답 예산을 초과하는 대기를 확인했다.

**수정 방향:** 프로세스 내부 잠금과 파일 잠금 모두 monotonic deadline 안에서 획득하고,
실패 시 무결성 오류와 구별되는 busy 결과를 반환한다. 제한 없는 재시도와 actor 점유를
피하고, 요청 종료 뒤 작업 자동 실행을 추가하지 않는다.

추가 보강 후보로 blocking 경로에 잠금 파일 inode/nlink 재확인이 빠져 있다.
그러나 실제 제품이 잠금 파일을 교체하는 경로는 찾지 못했으며 SQLite transaction과
freshness CAS도 독립적으로 유지된다. 이를 중복 실행이나 데이터 손상으로 보고하지 않는다.

### 2번 수정 — 2026-10-05

- `StorageProcessLock`의 내부 mutex와 `flock`을 nonblocking 획득으로 바꾸고,
  두 잠금이 하나의 250ms 연속 시간 deadline을 공유하도록 했다. 재시도 간격은 최대 5ms다.
- 같은 `SQLiteJournal` 인스턴스의 선행 mutex에도 별도 250ms 대기 상한을 적용했다.
  인스턴스 mutex와 저장소 잠금의 합산 대기 예산은 최대 500ms다. 이것은 **잠금 획득 대기**의
  제한이며, OS 스케줄링·파일시스템 호출·잠금을 얻은 뒤의 검증/작업 전체를 선점하는 제한은 아니다.
- timeout은 `freshness_lock_busy`로 구분한다. 만료된 요청의 callback은 실행하거나 나중에
  재개하지 않는다. 앱의 시작 오류 전달과 안내에도 busy 코드를 보존한다.
- 잠금 획득 뒤에도 inode·owner·mode·nlink와 경로 일치를 재검사한다.
  잠금 파일 교체, hard link, symlink, 권한 변경은 작업 전에 거절한다.

새 `StorageProcessLockTests.swift`는 가짜 연속 시계로 deadline/요청 횟수를 검증하고,
별도 임시 프로세스의 실제 `flock` 경쟁도 검사한다. 시간값 assertion과 OS 프로세스 검사 결과를
구분하며, 테스트 러너의 실행 시간을 설치 서비스의 응답 시간으로 해석하지 않는다.

## 3. pending-source 상태의 안전한 복구가 일반 실행 경로에 연결되지 않음

**우선순위: 높음.** freshness anchor를 pending으로 만든 후 SQLite commit 전에 실패하면,
안전하게 차단된 상태에서 일반 요청이나 단순 재연결만으로 회복하지 못할 수 있다.

- pending 기록과 SQLite commit 사이에 실패 가능한 구간이 있다.
  `engine/persistence/SQLiteJournal.swift:421`.
- 기존 SQLite journal은 원본 batch가 정확히 같은 경우의 복구 append를 지원한다.
- 그러나 semantic 재시도는 먼저 `journal.load()`를 호출한다.
  `engine/semantic/CoordinatorSemanticApplication.swift:124`.
  이 load가 `freshness_transition_pending`으로 차단되어 복구 append에 도달하지 않는다.
- 기존 missing-storage 복구는 DB와 key가 모두 없는 경우만 대상으로 한다.
  `engine/persistence/MissingStorageRecovery.swift:149`.

**재현:** 실제 Keychain 대신 메모리 freshness store에 pending CAS 직후의 일회성 실패를
주입했다. 같은 semantic command 재시도와 journal 재연결 후 재시도 모두
`freshness_transition_pending`으로 막혔다. 반면 보존한 정확한 원본 batch를 직접 append한
대조군은 committed/sequence 1로 정상 복구됐다. 제품 전체 재시작을 실행한 것은 아니다.

**수정 방향:** 원본 batch와 원래 권한을 안전하게 보존·재검증하는 명시적 복구 경로가 필요하다.
선택 작업의 자동 재실행, anchor 삭제, 무결성 검사 우회로 해결해서는 안 된다.
원본 batch를 복원할 수 없는 경우에는 사용자에게 해당 상태와 별도 복구 절차를 표시해야 한다.

### 3번 수정 — 2026-10-05

- semantic journal append가 원본 canonical batch를 보유한 **동일 호출 안에서만**
  pending-source 전환을 최대 한 번 복구하도록 연결했다. token/effect를 다시 만들지 않는다.
- pending 쓰기를 시도한 뒤의 실패이며 SQLite transaction이 rollback된 상태여야 한다.
  현재 anchor의 pending 전환과 원본 batch digest·expected sequence·source checkpoint가
  모두 일치할 때만 기존 append 검증으로 다시 진입한다.
- 재시도도 schema·MAC·sidecar·from/to·단일 선택/claim을 검증하고 현재 commit gate를 거친다.
  freshness CAS는 gate보다 먼저 수행해, 그 사이에 만료/철회된 권한을 최종 commit에서 차단한다.
  gate의 입장 거절은 재시도하지 않는다. commit callback의 누락·중복도 성공으로 처리하지 않는다.
- 이미 commit된 target, 불명확한 rollback, 다른 batch·checkpoint·freshness 상태는
  pending-source 재시도 대상에서 제외한다. 기존 raw append의 명시적 exact retry 계약은 유지한다.
- `load`, snapshot, 서비스 재시작은 버려진 작업을 재전송하거나 실행하지 않는다.
  **프로세스 종료 또는 영구 실패로 원본 batch가 사라진 과거 pending-source 상태는 여전히
  자동 복구하지 않는다.** 해당 상태에는 원본 저장 내용과 권한의 확인이 필요하다는 안내를 추가했다.
  DB/Keychain anchor 삭제나 검증 우회로 복구하지 않는다.

## 4. 입력 validator와 semantic timestamp 파서가 불일치함

**우선순위: 낮음.** `V1IngressValidator.matches`는 정규식 일치 구간이 존재하는지만 검사한다.
정규식의 `$`가 마지막 개행 직전에도 일치하므로 timestamp 뒤의 개행을 허용한다.
`engine/validation/V1IngressValidator.swift:200`, `:584`.

**재현:** `occurred_at = "2026-08-21T01:00:00Z\\n"`에서 실제 LF를 넣은 JSON은
V1 validator와 low-level SQLite append/load를 통과했다. 동일 snapshot을 semantic replay하면
`runtime_event_time_invalid`로 거절됐다.

운영 앱은 raw append를 허용하지 않고 semantic command를 요구한다.
`app/entrypoints/main.swift:446`의 raw append는 테스트 harness 컴파일 조건 내부다.
따라서 **운영 입력으로 DB가 손상되는 경로를 입증한 것은 아니다.** 공개 validator와
low-level 저장 API의 일관성 문제로 한정한다.

**수정 방향:** 정규식이 전체 문자열을 소비했는지 확인하고 timestamp에는 동일한 strict
RFC3339 검증을 사용한다. LF·CRLF·추가 문자와 정상 fractional seconds/offset을 회귀 검사한다.

### 4번 수정 — 2026-10-05

- ingress timestamp도 semantic과 동일한 `RFC3339Instant`로 검사한다. 기존 ingress 오류 코드
  `contract_validation_failed`와 `Contracts/v1` 파일은 유지한다.
- pattern 검사는 정규식 match가 문자열 전체를 소비해야 통과한다. 마지막 개행뿐 아니라
  덧붙인 문자도 허용하지 않는다.
- 새 `IngressTimestampTests.swift`에서 잘못된 시간 31종, 정상 시간 10종,
  timestamp를 가진 16개 필드 경로와 code/token/fingerprint의 전체 문자열 검증을 검사한다.
  잘못된 두-event batch는 journal·freshness를 바꾸지 않고 거절되며 이후 정상 append는 가능하다.
- 과거 low-level API로 이미 기록된 비정상 timestamp가 있다면 이제 load 단계에서 거절될 수 있다.
  이 작업은 기존 저장 내용을 고치거나 무결성 검증을 완화하지 않는다.

## 검증 근거와 한계

- 최초 진단 시 원본 Engine 회귀: **253 tests pass**.
  실제 Keychain 통합·복구 함수는 명시적으로 제외했고 benchmark opt-in도 비활성화했다.
- 격리 재현: 3개 테스트 함수. 저장소 진단 2개는 **문제 상태가 실제로 생기는지**를
  assert하여 통과했다. 시간 변경 테스트는 2개 처리 순서 중 Hook-first에서 의도한 정상
  동작 assertion이 실패했고 receipt-first 대조군은 통과했다. 모두 정상 동작했다는 뜻이 아니다.
- 별도의 실제 소스 기반 잠금 probe로 9.018초 초과 대기를 확인했다.
- Swift 실행에는 기존 `/tmp/blabee-coordinator-swift-tests.lock` 직렬 잠금을 사용했다.
- 첫 원본 검사 시도는 컴파일러 캐시 샌드박스 제한으로 테스트 시작 전에 중단됐다.
  허용된 실행으로 재시도했다. 잠금 probe의 첫 실행은 테스트 바이너리 경로가 달라 중단됐고,
  실제 SwiftPM `debug` 경로로 고친 뒤 재현했다. 제품 결함으로 계산하지 않았다.
- 모듈 소스 27개가 임시 복사본과 같고, 시작 시 기록한 원본 소스·테스트 해시가 끝까지
  변하지 않았음을 확인했다. 최근 journal 후보 인덱스 최적화의 새 무결성 회귀는 이 범위에서
  발견하지 못했다.

근거 디렉터리: `/private/tmp/blabee-engine-debug-20261003-d2jqrfrw/`

- `engine-baseline-unrestricted.log`
- `reproduction-tests.log`, `routing-probe.swift`, `storage-probes.swift`
- `lock-probe.py`, `lock-probe-result.json`
- `baseline.json`, `snapshot-source-files.json`, `source-preservation.json`
- `repro/`: 제품 소스의 격리 사본 및 진단용 테스트

1번은 위 범위에서 수정·검증했고, 2~4번의 후속 구현·검증은 위 수정 기록과 아래에 구분한다.
설치 앱의 기존 실패 사건과 연결하려면 해당 사건의
시각 변화·잠금 점유·freshness 상태 증거가 추가로 필요하다. 과거 ref를 재전송해서는 안 된다.

## 2~4번 후속 검증 — 2026-10-05

근거 디렉터리: `/private/tmp/blabee-engine-fixes-2-4-20261005-rfftc524/`.
이번 변경 전 파일은 `before/`, 소스 목록과 해시는 `baseline.json`에 보관했다.
현재 명시된 CoordinatorSwift 소스 27개를 복사한 Engine 전용 패키지와, 공통 앱 소스 및
선택한 테스트 파일만 복사한 별도 패키지에서 기존 전역 잠금을 공유해 직렬 검증한다.
실제 Keychain 통합 및 opt-in native/대용량 테스트는 실행하지 않는다.

최초 재개 시 검증 프로세스 생성 자체가 `Too many open files (os error 24)`로 실패했고,
보조 작업도 네트워크 권한 회수로 중단됐다. 이 실패에서 제품 테스트는 실행되지 않았다.
이후 명령 실행이 회복된 뒤 검증을 재개했다. 관측 당시 열린 파일 수는 16,042개,
시스템 전체 한도는 245,760개였다. 이는 실패 시점의 원인 프로세스나 누수를 확정하는 증거가 아니다.
운영 프로세스 종료나 시스템 한도 변경은 하지 않았다.

최종 결과:

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 잠금 및 timestamp 신규 회귀 | 17개 함수 통과 | `lock-timestamp.log` |
| pending 복구 및 같은 journal 잠금 회귀 | 7개 함수, 12개 시나리오 통과 | `pending-regression.log` |
| Engine 전체 격리 회귀 | 278개 통과, opt-in benchmark 2개 건너뜀(러너 요약 280) | `engine-regression.log` |
| 앱 오류 안내·busy frame 전달, 실제 Claude 권한 gate | 2개 함수, 3개 시나리오 통과 | `app-regression-final.log` |
| 사본과 작업 트리 소스 비교 | Engine 40개, 앱 167개 파일 일치 | `source-copy-verification.json` |
| 기존 변경 보존 | 기록한 497개 파일 중 이번 소유 범위 밖 변경 없음 | 같은 JSON의 `preservation` |
| 정적 검사 | 소유 파일의 whitespace 및 diff 검사 통과, 별도 리뷰에서 추가 차단 결함 없음 | 작업 기록 |

pending 회귀는 원본 event·packet·verification batch와 단일 token/effect, 재시도 중 gate 거절,
load/reopen의 무실행, 다른 batch·freshness rollback·MAC 변조·잘못된 target 거절을 검사했다.
gate가 commit callback을 호출하지 않거나, 호출 후 오류를 내거나, 두 번째 호출의 오류를 삼켜도
성공으로 오인하거나 event를 중복 기록하지 않는 것을 확인했다.
Engine의 가짜 gate 외에도 기존 Claude registry 테스트에서 pending CAS 도중 실제 연속 시계의
만료와 owner disconnect를 주입해 commit이 거절되는 조건을 검사했다.

이 테스트들은 새 배포 앱 빌드나 설치 앱 실사용 검사가 아니다. Engine 전체 러너의 42.780초와
잠금 회귀의 경과 시간은 end-to-end Hook 처리 시간 측정값이 아니다. 기존 journal 검증·replay
횟수 회귀와 정확한 claim 재시도 검사는 통과했고, MAC·freshness·세션/턴 바인딩을 완화하지 않았다.
정상 append에 pending 복구용 추가 조회는 붙지 않는다. 복구 조회는 pending 쓰기 이후 실패한
경로에만 제한되고, 원본 배치로 최대 한 번만 재시도한다.

**격리 검증 당시의 미실행 및 후속:** 이 시점에는 원본 프로젝트 전체 Swift 테스트를
다시 실행하지 않았다. 이후 원본 컴파일 수정과 추가 검증은 다음 절에 기록한다.
앞선 `MCPInputLineReaderTests.swift` 컴파일 실패와 이번 수정의 회귀를 분리하기 위해,
앱 격리 사본에는 `PetAppServiceTests.swift`, `ClaudeSessionRegistryTests.swift`,
`PetTestSupport.swift`만 포함했다. 해당 원본 테스트 파일은 수정하지 않았다.
실제 Keychain, 설치 서비스 부하/잠금 경쟁, 배포 패키징·설치·실사용은 검증하지 않았다.
원본 테스트 컴파일 문제를 해결한 뒤 전체 검사를 통과시키고, 추후 설치본의 새 카드에서
Hook 응답·durable claim·실제 실행을 각각 확인해야 한다. 원본 batch를 잃은 pending-source 상태의
별도 복구 기능은 이번 변경에 포함되지 않는다.

이번 변경 파일은 `StorageProcessLock.swift`, `SQLiteJournal.swift`,
`CoordinatorSemanticApplication.swift`, `V1IngressValidator.swift`, `PetAppService.swift`,
`AppOwnedServiceProcess.swift`, `CoordinatorSwiftTests.swift`, `StorageProcessLockTests.swift`,
`IngressTimestampTests.swift`, `PetAppServiceTests.swift`, 이 문서다.

## 원본 프로젝트 추가 검증 — 2026-10-05

2~4번 Engine 구현과 기존 회귀는 보존했다. 전체 검증을 막던
`Tests/swift/BlabeePetTests/MCPInputLineReaderTests.swift`의 컴파일 실패를 다시 재현했다.
`#expect` 매크로 안에만 `try`가 있는 클로저가 nonthrowing으로 추론돼 발생한 오류였다.
해당 클로저 6개에 `throws -> Void`를 명시했고, 제품 MCP 구현과 테스트 기대값은 변경하지 않았다.
원본 프로젝트 컴파일과 MCP 입력 테스트 **7개 함수 / 8개 시나리오가 통과**했다.

근거: `/private/tmp/blabee-engine-fixes-full-20261005-742v4a4s/`의
`mcp-compile-before.log`, `mcp-compile-after.log`, `mcp-test-fix.diff`.
최초 `--list-tests` 시도는 현 Swift의 목록 명령과 기존 직렬화 옵션이 호환되지 않아
실행 전에 종료됐다(`root-compile-before.log`). 이후 정상 `--filter` 경로를 사용했다.

원본 전체 회귀는 기존 `npm run test:swift`와 전역 직렬 잠금으로 실행한다.
다음 함수는 실제 사용자 자원에 접근하므로 제외한다.

- `keychainFreshnessStoreIntegration`, `missingStorageKeychainRecoveryArchivesUniqueTestItem`:
  실제 Keychain 통합·복구.
- `CodexRuntimeTrustTests.auditedProductionBundleMatchesCatalogWhenInstalled`:
  설치된 Codex 또는 외부 artifact 검증.
- `PetProductMetricsTests.requiresFreshConsent`, `PetInsightMetricsTests.freshVersionThreeConsent`:
  고유 UserDefaults와 별개로 `PetUsageAnalytics.live`가 실제 `BlabeeUsage` 저장 경로에 접근.

native/packaged-runtime/benchmark opt-in, Codex runtime artifact 지정,
렌더 이미지 외부 저장 경로 환경변수는 테스트 자식 프로세스에서 해제한다.
운영 환경 파일이나 사용자의 인증정보를 수정하는 방식은 사용하지 않는다.

검증 도중 Codex 브리지와 관련 테스트의 별도 변경이 관측됐다. 이번 작업에서는 해당 파일들을
수정하거나 되돌리지 않았다. `concurrent-source-observation.json`에 파일별 관측을 기록했다.
`CodexRuntimeBundle.swift`는 전체 테스트가 시작된 뒤에도 바뀌었으므로, 이번 실행만으로
다른 세션의 최종 브리지 변경까지 검증됐다고 간주하지 않는다.

전체 회귀 중 로그 출력이 정체된 구간의 테스트 프로세스만 3초간 관측했다.
스택은 기존 `ClaudeSessionMetadataStoreTests.thousandReplayIDs()`의 1,000건 저장 회귀와
metadata 검증에 있었다(`swift-test-sample.txt`). 설치 앱의 스택이나 성능 측정이 아니며,
표본 수를 실제 호출 횟수로 해석하지 않는다.

**원본 전체 회귀 결과:** 종료 코드 0. CoordinatorSwift는 **278개 통과 / 선택 벤치마크 2개
건너뜀**(러너 요약 280), BlabeePet은 **1,717개 통과 / native 선택 검사 2개 건너뜀**
(러너 요약 1,719)이다. 위 실제 자원 접근 함수 5개는 실행 필터에서 별도로 제외했다.
근거는 `full-swift-regression.log`다. 대용량 metadata 검사는 345.819초 후 통과했으며,
전체 러너 시간은 Engine 42.752초와 앱 426.861초였다. 테스트 비용과 설치 앱 지연을 혼동하지 않는다.

전체 컴파일을 막던 문제는 해소됐다. 이번 후속에서 추가 수정한 파일은
`Tests/swift/BlabeePetTests/MCPInputLineReaderTests.swift`와 이 문서다.
2~4번 제품 구현과 회귀는 그대로 유지했다. 배포 빌드·패키징·공증·설치·운영 앱 재시작·
commit·push는 수행하지 않았다. 실제 Keychain과 설치 앱에서의 새 카드 실행 검증은 남아 있다.

전체 실행 도중 바뀐 Codex 런타임 파일은 현재 소스로 다시 컴파일하고,
실제 설치본 검사를 제외한 `CodexRuntimeTrustTests` **67개를 추가 통과**했다
(`concurrent-runtime-regression.log`, 4.589초). 추가 검사 전후 338개 입력의 해시를 비교해
제품·테스트의 변경이 없었고, 2~4번 Engine 제품 파일도 앞선 격리 통과본과 일치했다.
검증 중 바뀐 파일은 이 기록 문서뿐이다(`final-verification.json`).
이는 Codex 브리지의 전체 native qualification이나 설치 실사용 검사를 대신하지 않는다.
