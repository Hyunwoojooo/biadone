# Engine 디버깅과 수정 — 2026-10-11

## 수정 반영

아래 네 문제의 제품 소스와 회귀 테스트를 수정했다. 뒤의 진단 기록은 수정 전 재현이며,
설치 앱의 현재 동작이나 과거 사용자 사건의 확정 원인을 뜻하지 않는다.

1. 선택·토큰 소비·형식 보정·전달 완료·카드 닫기에서 authority 조회 후, CAS 충돌로
   다시 조회한 후, SQLite의 최종 저장 검증 뒤에 연속 시각을 재확인한다. 시계 역행은
   즉시 권한을 해제하고, 정리 저장에 실패해도 해제 상태를 유지한다.
2. seal 등록은 입력과 durable packet의 canonical 문서 전체가 일치할 때만 로컬 anchor를
   부여한다. 다른 writer의 revision에는 이전 카드의 시각을 붙이지 않는다.
3. 닫힌 queued 경계도 consumed·completed·v1 durable claim과 원본 action이 검증되면
   결과를 기록할 수 있다. 내부 명령의 action_id·delivery_turn_id를 정확히 확인하며,
   경계를 다시 열거나 선택·실행하지 않는다. 결과 수신 endpoint는 추가하지 않았다.
4. 알려진 비밀값 검사는 JSON key·value·배열 leaf·루트 문자열을 모두 검사한다.
   비밀값 등록은 기존 지정 필드만 사용하고 canonical byte 검사도 유지한다.

### 시간 권한의 기준

기한 내 클릭만으로 영구 권한을 부여하지 않는다. 새 mutation의 최종 승인 시점은
저장소의 무결성·sequence·sidecar 검증과 임시 row 준비를 마친 뒤, pending freshness
CAS를 시작하기 직전이다. 이 검사는 SQLite 잠금 안에서 시계와 로컬 권한만 읽는다.
검사 실패는 row를 rollback하고 freshness를 변경하지 않는다. event의 occurred_at이나
disk COMMIT 완료 시각을 이 승인 시각과 동일하다고 간주하지 않는다.

한 append 호출에서 이미 승인한 원본 batch가 pending freshness 저장 중 응답을 잃으면,
정확한 동일 batch의 한 번뿐인 내부 복구에는 그 승인을 유지한다. semantic CAS 충돌이나
새 호출에는 승계하지 않는다. 기존 provider 권한 철회 commit gate는 복구 때도 검사한다.
이미 durable 완료된 receipt 정리와 정확한 같은 전달 턴 claim 재시도에는 새 deadline을
부과하지 않는다. timeout 작업의 자동 재전송·실행은 없다.

공통 protocol의 admission callback은 Claude journal wrapper에서도 그대로 전달한다.
이 변경은 공통 저장 검증의 전달 연결뿐이며, provider 권한·Hook·MCP 동작은 바꾸지 않는다.
Contracts/v1과 저장 schema는 변경하지 않았다.

### 수정 후 검사

| 검사 | 결과 |
| --- | --- |
| 격리 재현·비밀값·결과 기록·admission focused 검사 | Swift Testing 24개 + XCTest replay 9개 통과 |
| 기존+신규 Engine 전체 회귀 | Swift Testing 308개 + XCTest replay 9개 통과 |
| 리뷰 후 추가한 dismiss 최종 admission 검사 | 1개 통과. 만료된 close가 저장되지 않고 선택 권한은 해제됨 |
| Claude ProductAuthorityIntegrationTests | 22개 통과. 최종 admission 전달, lease 만료, owner revoke, commit gate 포함 |
| 변경 diff·소스 보존 검사 | whitespace 오류 없음. 지정한 Engine·회귀·연결 forwarding·문서 외 기준 파일 유지 |

위 숫자는 테스트 함수 단위이며 parameterized case는 별도 중복 합산하지 않았다.
focused 검사는 전체 회귀에 포함되므로 총합에 다시 더하지 않는다. 최종 검사 범위는
Engine 318개(추가 dismiss 포함), Claude 22개다. 첫 컴파일에서 발견한 throwing
autoclosure 오류는 수정 후 재검증했다. 기존 Package.swift의 unhandled-file 경고는
별도 폴더 정리 범위라 변경하지 않았다.

Engine 전체 명령은 아래 기존 명령과 같은 filter/skip·직렬 잠금을 사용했다.
Claude 검사는 `Tests/bridges/claude/shared-engine` 테스트 package에서
`--filter ProductAuthorityIntegrationTests --no-parallel --disable-keychain --disable-netrc`로
실행했고 같은 공용 Swift 잠금을 사용했다. 가짜 연속 시계·임시 SQLite·메모리 freshness
store만 사용했다. 이는 wall-clock 성능 수치나 설치 앱 acceptance 검사가 아니다.

기존 SQLite journal load/replay 횟수 회귀도 전체 검사에서 통과했다. 새 최종 시간 검사는
journal을 추가 조회하지 않는다. selection/consume은 이미 읽은 authority projection을
semantic 실행에 넘겨 정상 경로에서 같은 상태를 중복 조회하지 않는다.

미실행: 실제 Keychain 통합 2개, opt-in 대용량 benchmark 2개, 설치 앱의 사용자 선택
roundtrip, 배포 앱 빌드·패키징·공증·설치. 운영 DB·Keychain·사용자 세션을 수정하지
않았고 commit·push도 하지 않았다. 새 앱에 반영한 뒤 Codex receipt-first/Hook-first,
Claude 카드 선택·미루기와 실제 지연 조건을 별도로 확인해야 한다.

수정 파일:

- `engine/routing/CoordinatorRoutingApplication.swift`
- `engine/semantic/CoordinatorSemanticApplication.swift`, `CoordinatorSemanticState.swift`
- `engine/persistence/SQLiteJournal.swift`, `engine/validation/RuntimeSecretCorpus.swift`
- `bridges/claude/swift/adapter/ClaudeProductAuthorityJournal.swift` (공통 callback 전달만)
- `Tests/swift/CoordinatorSwiftTests/`의 RoutingApplicationTests, SQLiteQueuedActionClaimTests,
  SemanticApplicationTests, SemanticReplayTests, CoordinatorSwiftTests 및 새
  RuntimeSecretCorpusTests, SQLiteAdmissionTests
- `Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/ProductAuthorityIntegrationTests.swift`
- 이 문서와 `docs/features/QUEUED_HOOK_ORDERING.md`

수정 검증 근거: `/private/tmp/blabee-engine-fixes-20261011-u70g8pxn/`의
`focused-2.log`, `engine-regression.log`, `dismiss-regression.log`,
`claude-authority-regression.log`, `before/`와 `baseline.json`.

## 수정 전 진단 기록

기존 Engine 회귀 285개는 통과했지만, 추가한 격리 재현에서 네 종류의 문제를 확인했다.
첫 번째 시간 검증 문제에는 전달 완료·형식 보정·카드 선택의 세 경로가 포함된다.
과거 사용자 실패 사건의 원인이 이 문제였다고 단정하지 않는다.

최초 진단 단계에서는 제품 소스와 기존 테스트를 수정하지 않았으며, 새 재현 테스트는
`/private/tmp`의 소스 사본에만 추가했다. 설치 앱·운영 DB·사용자 세션·실제 Keychain과
인증정보에는 접근하지 않았다. 테스트용 Swift 컴파일은 수행했고 배포 앱 빌드·패키징·
공증·설치·commit·push는 하지 않았다.

## 1. 느린 저장소 조회 뒤 이전 시각으로 제한 시간을 판정함

**우선순위: 높음.** 이미 만료된 새 처리도 조회 전 시각으로 기록될 수 있다.
실제 시계를 기다리거나 바꾸지 않고 메모리 journal의 조회 callback에서 가짜 연속 시계를
진행시켜 재현했다. 실행 시간 측정이나 운영 서비스의 지연 측정 결과는 아니다.

| 경로 | 재현 조건 | 실제 결과 |
| --- | --- | --- |
| Receipt-first 전달 완료 | dispatch anchor=1초, 완료 처리 진입=300초, authority 조회 종료=301초(300초 deadline 도달) | 완료·경계 닫기를 기록해 sequence 5→7. `transport_completion_after_in_flight_deadline` 거절이 없고 scheduler의 timeout 정리도 사라짐 |
| 형식 보정 claim | 예약=0초, claim 진입=119초, 조회 종료=120초 | claim 1건을 추가해 sequence 2→3. 120초 유효기간 검사를 지나감 |
| 카드 선택 | 선택 진입=599초, packet 조회 종료=600초 | 선택·dispatch를 각각 1건 기록. 조회 전 599초를 발급 시각으로 사용 |

관련 코드:

- `engine/routing/CoordinatorRoutingApplication.swift:365`: 시간 정리 이후
  `authorityProjection()`을 수행한다. `:369`와 `:1869`는 조회 전에 저장된
  `lastClockNanoseconds`를 사용한다.
- 같은 파일 `:1848`: 형식 보정 claim도 이전 tick을 사용한다.
- 같은 파일 `:861`, `:870`: 카드 선택 시각을 읽은 뒤 packet/semantic 조회를 추가로 수행한다.
- Hook-first 경로에는 조회 뒤 새 clock을 읽는 검사가 이미 있다(`:636` 부근).
  기존 회귀는 그 경로만 조회 지연을 검사한다.

**수정 방향:** 아직 완료되지 않은 새 mutation은 권위 조회 뒤 최신 연속 시각과 역행 상태를
검사한다. CAS 재시도에서도 이 기준을 유지한다. 이미 완료된 동일 턴의 정확한 claim 재시도에
새 만료 제한을 추가하거나, timeout 작업을 자동 재전송하면 안 된다.

카드 선택은 추가 정책 구분이 필요하다. 현재 인접 경로처럼 최종 권한 검증 시점의 만료를
적용할지, 기한 내 접수한 클릭 자체를 권한 획득으로 인정할지 명시해야 한다. 후자라면
인증된 접수 증거를 별도로 보존해야 하며 단순히 오래된 시각을 재사용하는 것으로 대체하지 않는다.
이 재현은 늦은 처리가 허용되는 사례이며, 즉시 선택한 작업이 거절됐던 과거 사건을 설명하지 않는다.

## 2. 카드 등록 시 서로 다른 revision의 identity와 시각이 섞임

**우선순위: 중간.** 로컬 rev1을 저장한 직후 다른 writer가 rev2를 저장하면,
로컬 pending 등록이 rev2 identity와 rev1의 sealedAt/expiresAt/연속 시계 anchor를 섞는다.

`CoordinatorRoutingApplication.swift:1749`의 `registerSealedPacketLocked`는 원래 명령의
packet을 파싱하지만, 다시 읽은 journal에서 최신 reference를 가져와 `:1755` 이후 identity를
만든다. 두 packet의 정확한 일치를 확인하지 않는다.

**재현:** 메모리 journal의 rev1 append callback에서 독립 semantic writer가 유효한 rev2를
seal했다. journal에는 rev2가 남고 로컬 pending에도 rev2가 등록됐다. 이어지는 rev2 foreground
설정도 거절되지 않았다. 다른 writer의 revision은 로컬 anchor 없이 자동 채택하지 않는
기존 reseal·expiry 회귀의 정책과 다르다.

**수정 방향:** 입력 packet과 검증된 durable packet의 identity·문서가 정확히 같은 경우에만
해당 anchor로 등록한다. 불일치 시 로컬 pending 권한을 만들지 않고 재조회 결과를 반환한다.
이미 저장된 원래 seal을 재전송하지 않는다.

실제 운영에서 같은 순간 다른 writer가 개입했다는 증거는 없다. 단일 서비스 소유권과는 별도로
Engine API가 방어해야 하는 동시 변경 경계로 분류한다.

## 3. 정상 queued 전달 뒤 실제 작업 결과를 기록할 수 없음

**우선순위: 중간, 결과 수집 기능 연결 전 보완.** 현재 앱의 선택 실행 실패 원인으로 분류하지 않는다.

- queue 전달 완료는 원래 결정 경계를 닫는다.
- `CoordinatorSemanticApplication.swift:1024`의 `recordWorkOutcome`은 닫힌 경계를 거절한다.
- `CoordinatorSemanticState.swift:395`는 닫힌 경계에서 queued claim만 예외로 허용하고,
  `:400`에서 결과 이벤트도 거절한다.
- 반면 `Contracts/v1/README.md`는 queue receipt·claim과 실제 결과를 구분하고,
  이후 결과를 별도 `work_outcome_recorded`로 기록하도록 명시한다.

**재현:** consume → 원자적 전달 완료·close → 정확한 queued claim → 결과 기록 순서를 만들었다.
command와 직접 replay 양쪽에서 `decision_boundary_closed`로 거절됐고 sequence는 증가하지 않았다.
기존 정상 회귀는 결과를 먼저 기록한 뒤 경계를 닫는 순서만 확인한다.

공통 Operational 앱에는 현재 `record_work_outcome` 수신 경로가 없다. 이번 결과는
**Engine API와 결과 기록 계약의 불일치**이며, 설치 앱이 수신한 결과를 실제로 잃었다는 증거는 아니다.

**수정 방향:** 닫힌 경계를 다시 열지 않고 기존 continuation의 결과만 기록할 수 있도록 분리한다.
원본 binding·action·terminal transport·중복 결과 차단을 유지하고, 결과 제출자가 정확한
delivery turn에 속하는지 확인하는 호출 계약을 함께 정한다. 결과를 확인하지 못했다면 계속 unknown이다.

## 4. 알려진 비밀값 검사에서 JSON 문자열 배열 등이 누락됨

**우선순위: 낮음, 공통 검증 보강.** `RuntimeSecretCorpus.swift:68`의 walker가 dictionary의
직접 문자열 값만 방문한다. 배열 leaf·루트 문자열·object key는 검사하지 않는다.

**재현:** 가상의 문자열을 corpus에 명시적으로 등록한 뒤 다섯 위치를 검사했다.
dictionary 값에서는 감지했지만 배열·중첩 배열·루트·key에서는 감지하지 못했다.
임시 SQLite와 실제 semantic seal 경로로 추가 비교했다.

- 일반 ASCII 문자열은 canonical byte 검사에서 거절됐고 journal sequence 1을 유지했다.
- 따옴표·역슬래시·LF를 포함한 가상 문자열을 action의 `constraints` 배열에 넣으면
  JSON escape 때문에 byte 검사도 통과했다. sequence가 2가 됐고, 저장 문서를 decode하면
  해당 가상 원문이 남아 있었다.

`SQLiteJournal.swift:1265` 부근의 객체 검사와 byte 검사를 모두 통과한 사례다.
현재 발급되는 base64url/JWT 계열 토큰과는 문자 구성이 다르므로 **설치 앱의 실제 인증정보
유출을 확인한 것은 아니다.** 실제 비밀값을 읽거나 테스트에 사용하지 않았다.

**수정 방향:** 비밀 필드 등록용 key-aware 탐색과 검사용 모든 문자열 탐색을 분리한다.
검사에서는 배열의 문자열·루트 문자열·object key도 방문하고, 저장 전 decoded/canonical 검사
둘 다 유지한다.

## 검증과 증거

기준 회귀 명령:

```sh
npm run test:swift -- --filter CoordinatorSwiftTests --skip 'keychainFreshnessStoreIntegration|missingStorageKeychainRecoveryArchivesUniqueTestItem|sqliteReceiptCompletionBenchmarkWithClosedHistory|sqliteQueuedClaimBenchmarkWithPacketRichHistory'
```

실제 Keychain을 사용하는 두 검사와 opt-in 대용량 benchmark 두 개를 명시적으로 제외했다.
공용 `/tmp/blabee-coordinator-swift-tests.lock`과 기존 직렬 실행을 유지했다.
배포 제품 바이너리 대신 현재 소스의 테스트 target만 실행했다.

| 검사 | 결과 |
| --- | --- |
| 현재 작업 트리 Engine 기준 회귀 | 285개 통과 |
| 격리 routing 재현 | 4개 함수 모두 의도한 정상 동작 assertion 실패. 18개 assertion issue는 네 가지 재현의 중복 관측이며 18개의 독립 버그가 아님 |
| semantic·검증 진단 | 3개 함수, 9개 시나리오 통과. 문제 상태가 실제로 발생하는지를 assert했으므로 정상 동작/수정 완료를 뜻하지 않음 |
| 소스 보존 | 시작 시 기록한 36개 파일 변경 없음. 사본에 포함한 제품 소스 27개 + 기존 테스트 13개 원본도 변경 없음. 제품 사본 27개는 원본과 동일 |

기존 검사에는 정확한 claim 재시도·다른 세션/턴 거절·MAC/freshness·중단된 append 복구·
시간 파서·잠금 대기 제한이 포함된다. 이번 범위에서 해당 보호를 약화할 이유는 찾지 못했다.
추가 제품 성능 측정, 실제 Keychain 통합, 설치 앱 재시작·사용자 대화 roundtrip은 수행하지 않았다.

근거 디렉터리: `/private/tmp/blabee-engine-debug-20261011-o4vi9xby/`.

- `engine-baseline.log`: 기준 회귀.
- `routing-probes.swift`, `routing-probes.log`: 시간·revision 재현과 실제 결과.
- `semantic-probes.swift`, `validation-probes.swift`, `durable-secret-probes.swift`,
  `semantic-validation-probes.log`: 결과 기록 및 가상 비밀값 검사.
- `baseline.json`, `copied-sources.json`, `source-preservation.json`: 원본·사본 일치 증거.
- `repro/`: 상대 경로를 보존한 Engine 전용 격리 패키지. 추가 테스트는 여기에만 있다.

최초 진단 후 사용자의 네 항목 수정 요청에 따라 위의 소스 수정과 회귀 검사를 진행했다.
