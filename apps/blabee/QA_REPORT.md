# Blabee M0, T-005, T-006, T-007, T-010 및 T-011 QA 보고서

상태: M0 타당성 범위 조건부 승인, T-005·T-006·T-007 완료, T-007b-A/A2/B1/B2/C 범위 조건부 승인, T-010 코드·headless 안전 게이트 조건부 승인, T-011 코드·Keychain 없는 제품 결합 범위 조건부 승인
검토일: 2026-08-22
대상: `spikes/m0/`, `spikes/m1/runtime-qualification/`, `Contracts/v1/`, `Fixtures/v1/`, `src/coordinator-core/`, `src/coordinator-swift/`, `Plugin/blabee/`, 관련 테스트, Codex CLI `0.148.0`·`0.149.0`, 설계·상태 문서

## 판정

역사적 `0.148.0` M0가 목표로 한 **결정 한 번 → 같은 턴 연속 진행 한 번**의 Hook-first 계약은 통과했다. T-007b-C에서는 `0.149.0` 실제 Hook+M0 격리 픽스처가 같은 lineage의 결정 두 사이클과 `M0_CONTINUED_TWICE`를 통과했다. 합성 임시 Git 저장소에서만 허용되는 체크포인트/롤백 스파이크도 지정한 안전 경계 안에서 통과했다.

T-006은 런타임 독립 v1 계약 범위에서 통과했다. 같은 턴의 여러 결정은 `decision_boundary_id`와 `boundary_sequence`로 구분하고, `revision`은 동일 경계 안의 패킷 수정에만 사용한다. 이 판정은 운영 이벤트 저널이나 반복 Pet 상태 머신을 구현했다는 뜻이 아니다.

T-005는 Node와 Swift의 동일 자격 시험을 마치고 Swift 네이티브 헬퍼를 제품 런타임으로 선택했다. Node는 계약 참조, C는 health 전용 성능 기준선이다. 통과한 ad-hoc 서명과 측정용 DMG는 공개 배포 승인이 아니며, 유효한 Developer ID identity 0개와 공증 미측정 상태는 T-012 차단 조건으로 남는다.

T-005 독립 QA는 공개 차단급·높음·중간·낮음 finding 없이 승인됐다. QA 샌드박스에서는 `hdiutil`을 독립 재실행하지 못했지만, 자격 실행기의 실제 패키징 경로는 별도 실행에서 성공했다.

T-007a 구현은 순수 reducer/replay, 같은 턴 경계 1→2, CAS 선택 선점, 정확한 봉인 패킷 해석, 일회성 토큰·형식 보정과 command/replay 동등성을 33개 자동 검사로 검증했다. 독립 QA와 별도 parity QA에서 범위 내 공개 차단급·높음·중간 correctness finding 없이 승인됐다. `InMemoryJournal`은 참조 전용이다.

T-007b-A는 Swift 제품 영속 커널 범위에서 조건부 승인한다. strict v1 ingress, SQLite WAL/`synchronous=FULL`/외래 키/`BEGIN IMMEDIATE`, 프로세스 간 CAS와 동일 top-level decision-boundary 중복 claim의 pre-commit 차단, crash·SIGKILL·commit 후 replay, 런타임 이벤트 MAC chain과 인증된 head anchor, packet/verification row-bound HMAC, 외부 32-byte 키와 fail-closed schema/binding 검증을 구현했다. A 단계 기준 Swift unit 18개와 별도 프로세스 persistence 통합 31개가 통과했고 독립 최종 QA에서 범위 내 open critical/high/medium finding은 0개다. 다만 이는 trusted caller가 T-007a와 동등한 lifecycle 의미 검증을 선행한다는 전제의 low-level kernel이며 Swift full coordinator state machine 승인이 아니다.

T-007b-A2도 제품 영속·freshness 커널 범위에서 조건부 승인한다. strict `initializing`/`committed`/`pending` Keychain record, 불변 DB identity·generation·sequence·head metadata, `kSecAttrGeneric` digest CAS, process mutex와 `0600` `flock`, 무변경 storage preflight/recheck를 구현했다. 과거 authentic DB snapshot, DB·키 손실, anchor 누락/손상, crash와 concurrent writer를 event 반환 전에 fail-closed하며 `pending + target DB`는 전체 authenticated replay 뒤에만 finalize한다. Swift unit 27개와 별도 프로세스 persistence 통합 40개, 전체 `npm test` 242개가 통과했고 범위 내 open critical/high/medium finding은 0개다.

T-007b-B1은 Swift 의미 application 범위에서 조건부 승인한다. T-007a의 12개 이벤트 replay/projection과 11개 command, latest revision·stale·expiry·rollback-disabled·reseal, candidate replay와 `load → replay → decide → atomic append`를 포팅했다. CAS는 최대 2회만 재시도하고 토큰은 retry 전 한 번만 생성하며 append 성공 전에는 effect를 노출하지 않는다. 제품 NDJSON은 `execute_command`만 허용하고 raw `append`는 test-harness compile flag에서만 존재한다. 독립 parity QA에서 신규 critical/high/medium finding은 0개였다.

T-007b-B2는 Swift routing/time 범위에서 조건부 승인한다. 같은 프로젝트·세션의 pending interaction 하나를 semantic decision과 replay 모두에서 원자적으로 강제하고, 여러 세션 queue·명시적 foreground/no-steal·exact binding selection을 구현했다. `mach_continuous_time`과 주입 clock이 60초 reminder, 120초 expiry, coordinator-owned 120초 Pet/형식 보정 token과 300초 in-flight timeout을 구동한다. direct Pet token consume은 차단하고 routed consume/claim 및 transport completion 시각을 logical monotonic time으로 덮어써 forged wall timestamp와 외부 기간으로 권한을 늘릴 수 없다. 재시작으로 anchor를 증명할 수 없는 pending/unterminated/token claim 상태는 fail-closed하며 foreground도 복원하지 않는다.

T-007b-C는 같은 턴 반복 계약 범위에서 조건부 승인한다. 실제 Codex CLI `0.149.0`과 M0 fake coordinator가 동일 session·turn·prompt·episode lineage로 `boundary_sequence` 1→2, 제안·대기·선택·dispatch·consume·완료 각 2회를 관찰했다. 별도 Swift 제품 게이트는 같은 lineage의 두 경계를 16개 이벤트로 영속화하고 재시작 후 재생했다. 실제 Hook→Swift 고수준 adapter·UDS·플러그인 패키징은 T-011 책임이므로 이 판정은 공개 dispatch 승인이 아니다.

T-011은 코드와 Keychain 없는 실제 제품 구성요소 결합 범위에서 조건부 승인한다. Codex Plugin v0.1.0의 조건부 Skill·4개 Hook·MCP, Swift 고수준 operational application, Pet `get_state`/v1 full-selection, UDS·storage 단일 owner를 구현했다. 실제 제품 Hook/MCP CLI와 Pet API용 UDS test client를 test-only in-memory freshness를 사용하는 실제 SQLiteJournal→Routing→Operational→UDS에 연결해 같은 lineage의 경계 1→2, staged promotion, 선택 두 번, Stop block 두 번과 final completion을 센티널 없이 통과했다. 지정된 첫 UserPrompt context 외 correlation token 재노출, proposal free-text copy, 원문 continuation token의 DB/WAL/SHM·공개 응답 유출을 차단한다.

T-010은 코드와 headless 안전 계약 범위에서 조건부 승인한다. 비활성 floating `NSPanel`, routing 순서와 exact binding을 보존하는 다중 세션 카드, 명시적 14-field focus 뒤 16-field selection, single-flight 선택, disabled·stale·expired·ambiguous 입력의 fail-closed, high/critical 1·2 확인, 동적 Carbon 단축키 등록과 오래된 registration 무효화를 구현했다. PermissionRequest는 새 요청만 알리고 Allow/Deny를 중계하지 않는다. 요청에 원래 PID/창 identity가 없어 알림 증가 polling 시점의 frontmost 외부 앱으로만 best-effort 복귀한다. Pet 25/25, Operational 14/14, Routing 필터 18/18(Routing 16 + Pet 2)과 Swift package XCTest 5/5 + Swift Testing 96/96이 통과했다.

현재 operational proposal path는 risk `info`, 빈 evidence, checkpoint `unavailable`, rollback disabled를 생성한다. 따라서 high/critical 확인, 채워진 evidence/checkpoint와 활성 rollback UI는 fixture로 fail-closed 동작을 검증했지만 아직 실제 Hook→MCP→Pet 제안에서 end-to-end로 도달하지 않는다.

이 승인은 공개 운영 또는 실제 사용자 Pet dispatch 승인이 아니다. `pending + source DB`는 COMMIT 전 종료와 COMMIT 뒤 과거 DB 복원을 구분할 수 없어 자동 취소하지 않으며 exact canonical batch가 없으면 운영자 복구가 필요하다. commit 후 응답이 유실되면 권한 재발급을 금지하므로 continuation이 사용 불가능해질 수 있다. unsigned CLI는 entitlement 부재로 legacy login Keychain을 사용하고, 같은 UID 공격자가 Keychain까지 삭제·교체하거나 DB·키·anchor를 모두 제거하는 경우는 A2 경계 밖이다. 실제 사용자 Hook 신뢰, 로그인 Keychain 제품 daemon, Pet의 WindowServer·다중 디스플레이·Spaces·호스트 복귀 수동 매트릭스와 signed Data Protection Keychain은 아직 함께 검증하지 않았다.

T-006 최종 독립 QA에서 공개 차단급·높음·중간 finding은 없었다. T-007a QA에서 찾은 같은 턴 lineage, 전역 continuation ID·fingerprint, consume 시간·terminal 순서 불일치를 의미 검증기에 동기화했고 계약 검사는 114개로 늘었다. 낮음으로 보고된 중첩 미등록 스키마 탐지 공백도 completeness 검사를 재귀화해 닫았다.

이 판정은 공개 MVP나 실제 사용자 작업공간 롤백 승인이 아니다. 아래 High 항목을 닫기 전에는 제품 롤백이나 공개 Pet dispatch를 활성화하면 안 된다.

## 실행 증거

- 진단 가림 회귀 추가 직전 전 범위 `npm test`: 247/247 통과
- 추가 뒤 최신 전 범위 `npm test`: 248개 중 246개 통과. 나머지 2개는
  macOS `/usr/bin/security find-generic-password`가 각각 30초 동안 응답하지
  않은 Keychain 환경 timeout이며 독립 재실행에서도 같은 대기를 재현했다.
- T-007b-B2 완료 당시 Swift package: XCTest 5/5 + Swift Testing 57/57, 합계 62/62 통과
- `npm run test:t007a`: 33/33 통과
- 제품 foreground/semantic/NUL event·packet·continuation/restart/raw-append gate: 1/1 통과
- 비영속 계약·core·runtime qualification 회귀: 204/204 통과
- persistence 최신 독립 재실행: 40/40 통과. Int64 초과 입력은 strict parser에서 계속 거부하되, correlation 전용 구조 스캔이 안전한 top-level `request_id`만 복구해 즉시 `invalid_request`를 반환한다. unsafe·중복·runtime-secret ID는 `unknown`이며 출력에 노출되지 않는다.
- T-007b-C Hook 집중: 17/17, M0 전체: 55/55 통과. 실제 하네스 실패
  진단의 correlation/continuation token 가림 회귀를 포함
- T-007b-C Swift 제품 반복 게이트: 1/1 통과, 같은 turn lineage의 16개 이벤트를 재시작 후 재생
- T-011 부모 최종 `npm run test:t011`: 23/23 통과. 실제 제품 Hook/MCP CLI와 Pet API용 UDS test client를 SQLite→Routing→Operational→UDS에 연결한 두 경계 gate 포함
- T-011 두 경계 제품 결합 gate 단독 반복: 3/3 통과. 지정된 correlation context 1회, CSPRNG continuation token 2개 발급과 DB/WAL/SHM 비저장, product binary의 test-server mode 비노출 포함
- T-011 최신 UDS 종료 집중: 6개 × 3회, 18/18 통과. 결합 gate 추가 전 6개 × 5회, 30/30도 통과
- T-011 Swift Operational: 12/12 통과, 최종 동결 소스에서 3회 연속 재통과. full 16-field selection, pre-write secret copy 차단, staged active Stop, open/seal·selection·completion·scheduler의 pre/post-commit 응답 유실, retained monotonic anchor와 timeout promotion 회귀 포함
- T-011 Swift Routing: 16/16 통과. open→seal journal 인접성, 모호한 선택의 exact authority 재조정·250 ms backoff·원문 token 비재발급, terminal notice exactly-once 회귀 포함
- T-011 격리 Codex Plugin lifecycle: 실제 `0.149.0` install/cache-buster update/remove 통과. 제공 Python validator는 PyYAML 부재로 검증 전에 중단
- T-010 Swift Pet: 25/25 통과. strict snapshot parsing, routing 순서와 bijective join, 명시적 focus/no-steal, stale·expiry·single-flight, 위험 확인, PermissionRequest 알림, 동적 단축키 충돌·교체·retired ID 회귀 포함
- T-010과 연동한 Swift Operational: 14/14, Routing 필터: 18/18(Routing 16 + Pet 2) 통과. `focus_interaction` exact 14-field binding과 foreground 없는 `select` 거부 포함
- 최종 Swift package: XCTest 5/5 + Swift Testing 96/96 통과
- T-007b-A strict ingress: 영속 경계 4개 계약 타입, manifest fixture 20개 Ajv oracle parity 통과
- 현재 production `SQLiteJournal.swift` SHA-256: `399c0715678a3e6cd0863481d91f512a6a3f7965320d1ed09863baadacb0dae8`
- `npm run test:contracts`: 114/114 통과
- `npm run test:t005`: 4/4 통과
- Ajv 8 strict/offline 스키마 컴파일: 10/10 통과
- 계약 Fixture: 유효 15, 무효 10, 의미 이벤트 trace 7개
- `npm audit --json`: 알려진 취약점 0건
- 실제 positive contract: 프로젝트 로컬 `.codex/hooks.json`과 `.codex/config.toml`만으로 `emit_decision`, Pet 선택, 같은 턴 연속 진행과 후속 Stop을 두 번 거쳐 `decision_cycle_count = 2`, 마지막 JSONL `agent_message = M0_CONTINUED_TWICE` 확인
- 실제 하네스의 실패 진단은 Codex JSONL과 coordinator state를 출력하기 전에
  원문 `correlation_token`과 `continuation_token`을 구조적으로 가린다. 같은
  원문이 다른 문자열 필드에 반복돼도 함께 치환하고 비민감 식별자는 유지한다.
- 실제 negative contract: 설명 요청에서 `decision_proposal_received = 0`, `decision_wait_started = 0`, 파일 변경 없음, 마지막 JSONL `agent_message = M0_EXPLAINED` 확인
- Codex plugin validator 통과
- 모든 M0 JavaScript 파일 `node --check` 통과

두 실제 계약 모두 터미널 키 입력 주입과 별도 LLM API 키를 사용하지 않았다. 프로젝트 trust override와 `--dangerously-bypass-hook-trust`는 격리된 테스트 harness에만 사용했다.

## QA 중 수정한 결함과 닫은 불변식

- 한 패킷의 `option_id`와 non-null `action_id` 중복, 기준 체크포인트·활성 롤백 대상 불일치를 의미 검증에서 거부
- 같은 선택의 두 번째 dispatch, continuation 중복 consume, consume 전 transport 완료를 거부
- 같은 결정 경계의 두 번째 형식 보정을 새 ID·토큰으로 우회할 수 없게 함
- 형식 보정 예약·claim을 별도 durable 이벤트로 고정해 journal replay 뒤에도 결정 경계당 1회 제한이 유지되게 함
- durable 이벤트에서 원문 토큰을 거부하고 SHA-256/HMAC-SHA-256 fingerprint 형식만 허용함. T-007a에서 CSPRNG 최소 128-bit 발급, SHA/HMAC fingerprint와 constant-time 비교를 구현·검증함
- strict RFC 3339 실제 달력 검증과 `sealed_at`/`issued_at`/`expires_at`/in-flight deadline 순서 검사를 추가
- 1~9자리 소수초를 밀리초로 잘라 비교하던 오류를 exact epoch-nanosecond `BigInt` 비교로 수정해 1ns 역전도 거부
- 스키마 매니페스트 completeness 검사를 재귀화해 하위 폴더의 미등록 `.schema.json`도 검출
- packet 만료 뒤 선택, deadline 전 timeout, deadline 이후 transport 완료, 선택 뒤 interaction expiry를 거부
- 이전 결정 경계를 닫기 전 같은 턴의 다음 경계를 열거나 닫힌·만료된 경계에 후속 이벤트를 기록하지 못하게 함
- 토큰을 제외한 continuation 봉투 전체를 봉인하고 추가 필드·ID·만료값 변조를 거부
- `pet_action = same_turn_stop`, `internal_format_repair = submitted_envelope`로 전달 모드를 상호배타화해 이중 실행 차단
- 형식 보정을 결정 경계당 한 번으로 제한하고 repair kind allowlist 적용
- 같은 세션 ID가 다른 프로젝트로 재바인딩될 때 이전 wait/proposal/dispatch/token 라우팅 폐기
- 슬롯 3·4 선택 후 상태를 `paused`·`rollback_intent`로 기록
- Unix domain socket 권한을 `0600`으로 제한
- 디버그 로그에서 continuation 토큰과 작업 본문 비노출
- `assume-unchanged`, `skip-worktree`/sparse 상태, `core.filemode=false`, Git이 추적하지 않는 POSIX mode 변경에서 롤백 차단
- 저장소 밖 변경·외부 효과 등 위험 attestation이 누락되면 `unknown`으로 보고 fail-closed
- 실제 Codex 결과를 단순 문자열 포함이 아니라 마지막 JSONL `agent_message`의 정확 일치로 검증
- `decision_packet_sealed` 이벤트에 작업 본문 전체가 없는 v1 경계를 확인하고 봉인 패킷 문서 sidecar를 이벤트와 원자 저장해 정확한 리비전·옵션만 해석하도록 함
- `continuation_dispatched` 이벤트에 Pet token fingerprint가 없는 v1 경계를 확인하고 원문 토큰·작업 본문을 포함하지 않는 불변 verification sidecar를 선택·dispatch 이벤트와 원자 저장함
- 런타임 이벤트를 수명 주기 진실 원본으로 유지하고, 필수 sidecar 누락·고아·불일치 replay를 fail-closed함
- 선택 성공 뒤에만 continuation 효과를 노출하고 CAS 경쟁의 패자는 효과를 받지 않도록 함
- 전송 완료와 작업 성공 outcome을 분리하고, deadline timeout은 `unknown`만 기록하며 자동 재시도·취소·실패를 추론하지 않게 함
- `__proto__`, `constructor`, `toString` 같은 prototype property 이름을 식별자로 사용해도 projection lookup·중복 검사를 우회하지 못하게 null-prototype record와 own-key 검사를 적용함
- 같은 세션·턴의 다음 decision boundary가 `source_prompt_id`, `episode_id`, root prompt, baseline checkpoint lineage를 바꾸거나 boundary sequence를 초기화하면 `decision_boundary_lineage_mismatch`로 command와 replay를 fail-closed함
- 스키마상 유효하지만 action/option 유일성·baseline checkpoint 결합을 깨는 패킷을 command와 replay에서 의미 검증하고, T-007a가 지원하지 않는 enabled rollback은 `rollback_not_supported_in_core`로 거부함
- Pet과 형식 보정 전체에서 continuation ID와 fingerprint 재사용을 거부하고 계약 의미 검증기에도 같은 전역 ledger 규칙을 동기화함
- continuation 봉투의 발급·만료·in-flight 시각을 persisted dispatch와 정확히 결합하고 발급 전, 만료 시점, terminal 이후 소비를 command와 replay 양쪽에서 거부함
- 슬롯 1·2 선택 뒤 dispatch와 terminal 관찰 없이 경계를 닫지 못하게 하고 슬롯 3의 `episode_paused` close 의미를 양방향으로 결합함
- 이전 packet 만료 뒤 reseal, repair 예약 이전 claim, 기존·동일 batch event ID 중복, 닫힌 경계의 outcome 기록을 command와 replay에서 같은 오류로 거부함
- 코어가 생성하는 identifier·stable code·summary·evidence list·token의 v1 길이·패턴 상한을 Unicode code point 기준으로 검증해 스스로 strict schema-invalid 이벤트나 봉투를 저장하지 않게 함
- Swift ingress에서 duplicate key, invalid UTF-8, 과도한 depth, 실제 달력 오류, unknown field를 strict하게 거부하고 contract manifest와 모든 schema hash pin을 필수 검증함
- SQLite를 WAL/`synchronous=FULL`/foreign key로 고정하고 `BEGIN IMMEDIATE` expected-sequence CAS로 두 독립 프로세스 중 정확히 한 batch만 commit하게 함
- crash before commit, SIGKILL, commit 뒤 응답 전 crash를 분리해 rollback 또는 durable replay 결과를 확인하고 불확실한 commit의 안전하지 않은 재시도를 허용하지 않음
- 런타임 이벤트를 row identity·sequence·이전 MAC과 연결한 MAC chain으로 인증하고 별도 인증된 head anchor로 마지막 행 삭제를 포함한 mutation/deletion을 fail-closed함
- packet/seal/selection/action과 verification binding 전체를 exact 비교하고 packet/verification JSON·MAC 교체, row swap, orphan/missing artifact를 거부함
- 정수 입력을 exact Int64로 제한하고 DB·키 손실, key mode/상위 디렉터리 mode/symlink, exact `sqlite_schema`·trigger 변조를 fail-closed함
- crash injection은 test-only gate 뒤에 두고 키 경로는 `openat` 기반으로 검사하며, 원문 continuation/correlation token이 DB·WAL·SHM·로그에 남지 않음을 관찰한 secret corpus로 확인함
- 같은 top-level decision-boundary binding의 순차 중복, revision을 바꾼 중복, 두 프로세스 selection 경쟁에서 저장층이 두 번째 claim을 commit 전에 거부하고 정확히 한 승자만 남김
- Keychain anchor를 strict canonical `initializing`/`committed`/`pending` record로 제한하고 불변 DB identity와 generation/sequence/head checkpoint를 결합함
- Keychain `kSecAttrGeneric`에 canonical record digest를 저장해 compare-and-swap하고 process mutex와 secure `0600` `flock`을 append 전체 freshness 전이에 유지함
- 저장 파일을 만들기 전 preflight와 lock 획득 뒤 recheck로 DB/키 loss·anchor 누락을 무변경 fail-closed하고 pre-A2 DB를 자동 migration/adoption하지 않음
- SQLite commit 전 Keychain pending CAS, commit 뒤 전체 authenticated replay, committed CAS/read-back 순서를 적용함. `pending + target DB`만 replay 뒤 finalize하며 `pending + source DB`는 exact canonical batch 재시도 외에는 차단함
- crash point 85/87/88/86, 과거 authentic DB snapshot, DB·키 손실, anchor 변조/손상, Keychain CAS 경쟁과 concurrent writer 회귀 검사를 통과함
- Keychain `errSecDecode`/`errSecInvalidKeychain`은 corrupt, 잠금·interaction 불가는 unavailable로 fail-closed하고, test cleanup은 명시적 namespace gate와 `test-` account로 제한함
- Swift application에서 malformed non-null nested binding의 top-level fallback을 제거하고 append 전에 candidate snapshot 전체를 replay함
- action/repair token generator와 application HMAC key 불일치를 append 전에 거부하되 토큰이 필요 없는 슬롯 3 pause는 영향을 받지 않게 함
- 새 저장 ID는 NFC를 요구하고 continuation·packet·option·checkpoint 참조는 UTF-8 byte-exact로 비교해 Swift canonical-equivalence alias를 차단함
- Foundation의 큰 decimal/exponent 정수 반올림을 차단하고 일반 Int64 lexeme, 안전한 ±2^53 decimal/exponent, exact RFC3339 nanosecond 경계를 분리해 검증함
- SQLite bind/read에 explicit UTF-8 byte length를 사용해 embedded NUL이 있는 event·packet·continuation ID를 재시작 뒤에도 정확히 복원함
- 제품 raw append를 compile-time test gate 뒤로 이동하고 발급 토큰이 허용된 stdout effect에 정확히 한 번만 나타나며 consume·stderr·durable state에는 다시 노출되지 않게 함
- 같은 프로젝트·세션에서 두 decision boundary가 동시에 packet을 seal하지 못하게 decision/replay 양쪽에 atomic invariant를 추가하고 다른 세션 queue는 독립적으로 유지함
- foreground가 없을 때 selection을 차단하고, 새 세션 카드가 기존 foreground를 선점하지 않으며 명시적 전환 뒤에만 exact project/session/episode/interaction/packet/revision/option 입력을 받게 함
- 제품 `execute_command`의 direct `select_option`·Pet token consume·expiry/timeout을 차단하고 `set_foreground`·`route_selection`·`route_consume_pet_action`·`routing_snapshot`·`process_time`으로 권한 경계를 분리함
- 60초 reminder·120초 expiry와 300초 in-flight deadline을 독립 continuous-clock anchor로 처리하고 wall clock forward/backward 입력이 selection window를 바꾸지 않게 함
- Pet token은 119초까지 소비되고 정확히 120초부터 forged wall timestamp와 무관하게 거부되며, 형식 보정 예약·claim도 caller expiry를 무시한 고정 120초와 restart anchor-loss fail-closed를 적용함
- transport completion 시각을 dispatch anchor의 logical monotonic time으로 덮어쓰고, stdin readable-cycle에서 JSON 파싱 전에 scheduler를 진행해 malformed 입력 폭주가 deadline을 굶기지 않게 함
- 재시작 뒤 증명할 수 없는 pending packet과 terminal 없는 continuation을 각각 sealed `expires_at`과 `in_flight_deadline_at`에서 fail-closed하고 foreground 자동 복원을 금지함
- selection CAS 패배 뒤 local pending/foreground를 journal replay와 다시 맞춰 stale card가 남지 않게 하고, completion/selection 경쟁에서 패배한 scheduler notice를 거짓으로 내보내지 않게 함
- T-011 UDS 외부 API를 project/session/prompt/proposal/Stop/permission/Pet state/full selection 고수준 allowlist로 제한하고 low-level append·direct semantic/token operation을 차단함
- Pet 선택을 v1 16-field selection request 전체와 현재 봉인 packet·revision·option·9-field binding에 exact 결합하고 누락·변조 시 journal write 없이 거부함
- correlation token은 지정된 UserPromptSubmit context와 MCP 지정 필드에만 왕복시키고 proposal free-text copy를 append 전에 거부하며 이후 공개 응답·DB/WAL/SHM에서 재노출하지 않음
- 원문 continuation token을 Stop block 응답 전에 즉시 소비하고 test-only recorder가 두 번 발급한 CSPRNG raw token의 DB/WAL/SHM 비저장을 daemon 종료 때 검사함
- Stop 원문 대신 HMAC observation digest·request generation·delivery digest로 최초 delivery, 중복 replay와 후속 active completion을 분리하고 staged boundary가 있으면 같은 active Stop을 다음 waiter로 전환함
- socket runtime `0700`, socket/lease `0600`, 양방향 peer UID, 1 MiB/64 admission, active socket 보존, stale same-UID 회수와 owned-inode cleanup을 적용함
- 정규화한 절대 DB 경로 identity의 별도 storage authority를 storage preflight 전에 획득해 같은 DB·다른 socket의 두 번째 제품 owner와 legacy entry 우회를 차단함
- Keychain 없는 실제 SQLiteJournal→Routing→Operational→UDS에 제품 Hook/MCP CLI와 Pet API용 UDS test client를 연결해 같은 turn 경계 1→2와 마지막 completion을 센티널 없이 통과함

## 공개 전 차단 조건

### High

1. **실제 저장소 동시성**: canonical repository identity 기준 전역 잠금, 기준선 이중 스냅샷, mutation 직전 재검증, 같은 경로 작성자 provenance가 필요하다. 현재 `projectId` 기반 임시 잠금과 `ownedPaths`만으로는 실제 편집기와의 경쟁을 증명하지 못한다.
2. **복구 스냅샷 재적용**: 현재는 생성·보존만 검증했다. staged Git object의 독립 보존, index/manifest 해시, 원자적 저장, 실제 재적용, 삭제·reset·catalog 단계별 실패 주입을 통과해야 한다.
3. **실사용 Hook→Swift→Pet qualification**: T-011은 Keychain 없는 실제 제품 구성요소에서 첫 action 중 다음 proposal staging, 후속 active Stop의 이전 경계 terminal 처리와 다음 경계 open/seal, 단일 UDS/storage owner와 원문 token 비노출을 하나의 두 경계 경로로 연결했고 T-010 Pet 코드는 UDS 계약에 연결했다. 공개 dispatch 전 실제 사용자 Hook 신뢰 검토, 로그인 Keychain 제품 daemon, sleep/재시작, WindowServer·다중 디스플레이·Spaces·호스트 앱 복귀를 한 실환경 경로에서 통과해야 한다.
4. **배포 Keychain 격리**: unsigned CLI에서는 Data Protection Keychain이 `errSecMissingEntitlement(-34018)`로 거부되어 legacy login Keychain을 사용한다. 현재 UI 차단에는 deprecated `kSecUseAuthenticationUIFail` 경고도 남아 있다. T-012에서 signed wrapper, provisioning/access group, `LAContext`, code-signing ACL을 검증하고 deprecated API를 교체해야 한다. 같은 UID 공격자의 anchor 삭제·교체와 DB·키·anchor 동시 삭제는 현재 A2만으로 차단하지 못한다.

### Medium

1. `continuation_completed`는 정확한 후속 Stop을 관찰한 전송 수명 주기 종료이지 작업 성공 판정이 아니다. 성공·실패 outcome과 근거는 별도 이벤트로 모델링해야 한다.
2. 120초는 선택 전 결정 패킷 대기에 적용한다. B2는 sleep을 포함하는 continuous clock과 재시작 fail-closed 처리를 구현했지만, 실제 장시간 macOS sleep/복귀와 daemon lifecycle은 서명된 패키징 환경에서 다시 검증해야 한다.
3. 소켓 `0600` 외에 같은 사용자 프로세스를 구분할 IPC 인증이 없다. 제품에서는 launch secret/capability token, peer 검증, 메서드별 권한 분리가 필요하다.
4. SQLite transaction, cross-process CAS와 crash replay는 T-007b-A에서 검증했고 B2가 세션 queue와 deadline을 연결했다. T-011은 정상적인 두 경계 Hook pending Stop을 제품 구성요소에 연결했지만, 실제 resume/compact와 daemon 재시작 중 pending Stop 복구 UX는 후속 운영 범위다.
5. packet/seal/selection/action/verification 교차 문서 binding과 row-bound 인증은 T-007b-A에서 입증했고 T-011이 실제 Hook/MCP/Pet 경로의 full selection exact binding을 검증했다. 실제 사용자 Codex 버전별 호환성은 allowlist gate로 다시 검증해야 한다.
6. 외부 키 파일 `0600`과 상위 디렉터리 `0700`은 다른 UID를 막는 파일 권한 경계다. A2는 login Keychain freshness를 추가했지만 키 회전과 일반 운영자 복구는 아직 없다. 특히 exact batch가 없는 `pending + source DB`는 자동 복구하지 않는다. runtime-known secret corpus는 관찰·등록된 값만 검사하고 재시작 시 다시 등록하며, 보지 못한 임의 secret 전체의 비유출 증거가 아니다.
7. T-011 storage authority는 정규화한 절대 DB 경로별 singleton을 storage 초기화 전에 강제한다. 다만 symlink/hard-link/특수 mount에서 서로 다른 path가 같은 inode를 가리키는 alias는 현재 path digest가 합치지 못한다. 공개 설치 경로를 고정하고 alias 공격을 별도 hardening해야 한다.
8. Stop 입력 자체에는 `decision_boundary_id`나 Hook invocation ID가 없다. T-011은 HMAC observation·request generation·delivery digest·phase gate로 같은 Stop replay와 후속 active Stop을 구분하고 두 경계 gate를 통과했다. 이 ledger는 process-local이며 completion은 계속 transport 수명 주기 종료일 뿐 work outcome이 아니다.

### Low

- C 런타임 후보는 정식 JSON 파서가 아니므로 성능 기준선으로만 사용한다. 프로토콜 동등성 근거가 아니다.
- Swift cold-start p95에 큰 이상치가 포함됐으므로 실제 앱 번들·지원 macOS/아키텍처 매트릭스에서 다시 측정해야 한다.
- `decide`와 reducer가 같은 불변식을 각각 검사하므로 drift 위험이 있다. command/replay adversarial parity 행렬을 T-007b-A 영속 경계와 B/C 어댑터에도 유지해야 한다.
- Swift와 JS replay는 단일 결함 오류 코드를 맞췄지만 한 입력에 여러 결함이 있으면 raw-token·binding·DTO 검사 순서 때문에 첫 오류가 다를 수 있다. 현재 확인된 차이는 수용성 우회가 아닌 진단 우선순위다.
- `record_work_outcome`과 `close_boundary`의 외부 audit timestamp는 권한 기간을 늘리지는 않지만 별도 trusted clock provenance가 없다. 만료된 미claim 형식 보정 reservation의 운영자 정리·복구 UX도 후속 범위다.
- non-object `seal_packet.packet`의 오류 코드가 JS/Swift에서 다르다. 전체 JS↔Swift 부정 사례 differential matrix에서 정리한다.

## 그래프 및 검토 한계

codebase-memory Tier 2 확인에서 기존 `apps/blabee` 범위의 구조를 참고했다. 다만 graph generation은 현재 작업보다 이전이며 수정 문서는 `metadata_changed`, 새 T-005/T-006/T-007/T-010/T-011 소스·Plugin·Fixture·테스트 파일은 `not_tracked`로 보고될 수 있다. 따라서 최신 구현 결론은 소스 직접 읽기, JSON 파싱과 실행 테스트를 기준으로 했다.
