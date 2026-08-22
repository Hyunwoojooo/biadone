# Blabee MVP 구현 계획

상태: M0·T-005·T-006·T-007 완료, T-007b-A/A2/B1/B2/C 범위 조건부 완료, T-010 네이티브 Pet 실제 macOS 1차 qualification 통과 및 환경 QA 진행 중, T-011 운영 어댑터 구현·검증 진행 중
업데이트: 2026-08-22

## 마일스톤 0 — 연동 계약 검증 스파이크

목표: Pet을 만들기 전에 Codex 연동 가능성을 입증한다.

1. 로컬 가짜 코디네이터와 Codex 플러그인 픽스처를 만든다.
2. 임시 최종 메시지 센티널로 구조화된 제안 추출 가능성을 격리된 1회성 실험에서만 확인하고 폐기 조건을 기록한다.
3. 번들 로컬 MCP `emit_decision`으로 원래 턴이 진행되는 동안 구조화된 결정 제안이 코디네이터에 도달하는지 검증한다. 이후 마일스톤은 MCP 경로만 사용한다.
4. `SessionStart`의 조건부 개발자 컨텍스트를 검증한다.
5. `UserPromptSubmit`에서 사람이 입력한 작업 프롬프트를 식별하고, `source_prompt_id`, `source_turn_id`, `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`를 모델에 프롬프트를 전달하기 전에 생성하는지 검증한다.
6. `continuation_origin`이 `pet_action` 또는 `internal_format_repair`인 두 연속 진행 봉투를 검증한다. `pet_action`은 대기 중인 `Stop`을 해제하는 `same_turn_stop` 전용이고 `UserPromptSubmit`으로 제출할 수 없다. `internal_format_repair`만 제출 봉투 모드를 사용하며 같은 결정 경계에서 최대 한 번 허용한다.
7. `Stop`이 대기한 뒤 동적 권장 작업, 동적 대안 작업, 고정 보류, 고정 롤백을 구분한다. 1·2에서는 전체 선택 바인딩을 확인하고 봉인된 작업 전체를 `decision: "block"`으로 같은 세션·턴·에피소드에 전달하며, `stop_hook_active: true` 후속 `Stop`에서 전송 수명 주기 종료가 정확히 한 번 관찰되는지 검증한다. 작업 성공은 별도 outcome/evidence로 판단한다.
8. 의미 있는 대안이 없을 때 2번이 `disabled_reason`과 함께 비활성화되고 `action_id`나 실행 본문을 갖지 않으며 다른 의미로 재사용되지 않는지 검증한다.
9. 60초 알림, 120초 패킷 만료, 자동 선택 없음, 재개 캡슐 저장, 만료 후 입력 거부를 검증한다.
10. 로컬 코디네이터 연결을 2초로 제한하고, 데몬 장애나 연결 시간 초과가 발생하면 Blabee 자동 동작만 끈 채 일반 Codex를 계속 사용할 수 있는지 검증한다.
11. `PermissionRequest`의 알림과 권한 요청 화면으로 돌아가기 위한 best-effort 앱 복귀를 검증한다. Hook 요청에는 원래 PID/창 identity가 없다는 한계를 표시하고, 허용/거부 왕복은 격리된 역량 측정만 수행하며 공개 v0.1 기능에는 연결하지 않는다.
12. Swift 헬퍼, TypeScript/Node 헬퍼, 소형 독립형 바이너리를 동일한 제한 health fixture로 측정하고 시작 지연, 배포 크기, IPC, 재시작 복구, 서명·공증, 진단성과 메모리 사용량을 기록한다. 정식 JSON 파서가 없는 후보의 결과는 프로토콜 동등성 근거로 사용하지 않는다.

완료 조건:

- 일반적인 설명 요청 턴 하나가 정상적으로 종료된다.
- 파일을 변경하는 턴 하나가 Pet에 도달한 뒤, 숫자가 아니라 패킷·리비전·옵션 ID와 작업 의미 전체를 담은 지시로 같은 세션·턴·에피소드에서 이어진다.
- 센티널은 실험 픽스처 밖의 운영 경로에 남지 않고, 로컬 MCP 경로가 계약 테스트를 통과한다.
- 사람이 입력한 시작 프롬프트 직전 기준선과 이후 Pet 연속 진행에서 생성된 모든 결정 패킷의 롤백 대상이 동일한 에피소드 ID로 연결된다.
- `pet_action`의 교차 바인딩과 중복 종료를 거부한다. `internal_format_repair` 제출 토큰의 재사용·만료·다른 프로젝트·세션·에피소드 사용, `source_turn_id`·`source_prompt_id` 불일치는 거부되고 새 사람 프롬프트로 오인되지 않는다. dispatch 후 `pet_action`의 in-flight deadline과 timeout 결과 계약은 T-006/B1에서 고정했고 B2 연속 단조 scheduler가 실제 terminal event를 제출한다.
- 내부 형식 보정은 같은 결정 경계에서 한 번만 실행되며 두 번째 실패에는 자동 진행이 없다.
- 120초 만료 후 자동 동작이나 늦은 단축키 실행이 발생하지 않는다.
- 코디네이터가 없거나 응답하지 않으면 2초 안에 Hook이 fail-open하며 자동 선택이나 롤백을 실행하지 않는다.
- 공개 권한 알림에서 허용/거부 응답을 전송할 수 없다.
- 터미널 키 입력 주입을 사용하지 않는다.
- 운영 코디네이터 런타임 선택 근거를 측정 보고서로 남기고, 근거가 부족하면 선택을 보류한다.

### M0 실행 결과 — 2026-08-21

- 최종 `npm test`: 53/53 통과. 체크포인트 36개, Hook/코디네이터 15개, 런타임 2개다.
- 실제 Codex CLI `0.148.0` 임시 프로젝트에서 `.codex/hooks.json`과 프로젝트의 `.codex/config.toml`만으로 `SessionStart → UserPromptSubmit → MCP emit_decision → Stop → Pet 선택 → 같은 턴 연속 진행 → 수명 주기 종료 관찰`을 확인했다. 마지막 agent message가 정확히 `M0_CONTINUED`여서 이 라이브 픽스처의 작업 성공도 별도로 확인했다.
- 실제 계약 결과는 `mcp_config_source = project_config_only`, `final_assistant_message = M0_CONTINUED`, `terminal_input_injection = false`, `separate_llm_api_key = false`다.
- 설명 전용 실제 계약도 통과했다. `--explanation-only`에서는 `project_enabled`, `session_started`, `human_episode_started`만 관찰됐고 결정 제안·대기 이벤트는 0건, `result.txt`는 없었으며 마지막 agent message는 정확히 `M0_EXPLAINED`였다.
- `0.148.0`의 역사적 M0 증거는 결정 한 번과 연속 진행 한 번이다. T-007b-C에서 `0.149.0` 실제 Hook+M0 격리 픽스처를 두 결정 사이클로 확장해 같은 lineage와 `boundary_sequence` 1→2, `M0_CONTINUED_TWICE`를 확인했다. 별도 Swift 제품 게이트도 같은 lineage의 두 경계를 16개 이벤트로 영속·재생했다.
- 관찰 이벤트는 `project_enabled`, `session_started`, `human_episode_started`, `decision_proposal_received`, `decision_wait_started`, `pet_action_selected`, `continuation_dispatched`, `continuation_consumed`, `continuation_completed`다. 마지막 이름은 M0 관찰기 명칭이며 v1 규범 계약에서는 `continuation_transport_completed`로 분리했다.
- 터미널 키 입력 주입과 별도 LLM API 키는 사용하지 않았다.
- 프로젝트 로컬 플러그인 구조는 별도 검증했다. 실제 계약 하네스의 Hook 신뢰 우회 플래그는 테스트 전용이며, 마켓플레이스 설치·번들 코디네이터 자동 시작·Developer ID 서명·공증·실제 앱 DMG는 아직 검증하지 않았다.
- 롤백은 합성 임시 Git 픽스처에서만 검증했다. 실제 작업공간과 공개 제품에는 연결하지 않았다.
- T-005 공통 자격 시험에서 Node·Swift의 durable append, 강제 종료 replay, partial-tail 복구, 지속 부하, 단조 대기 probe, 구조화 진단, ad-hoc 서명과 측정용 DMG를 비교해 Swift 네이티브 헬퍼를 제품 런타임으로 선택했다. Node는 계약 참조, C는 정식 JSON 파서가 없는 health 전용 성능 기준선이다.
- QA 판단은 M0 연동 타당성에 대한 조건부 승인이다. T-006에서 반복 경계와 in-flight deadline의 데이터 계약을 고정했지만, 실제 사용자 작업공간과 공개 MVP는 T-007 반복 상태 머신·운영 롤백·패키징의 높은 위험 차단 항목을 닫기 전까지 승인하지 않는다.

공식 기능 근거: [Hooks](https://learn.chatgpt.com/docs/hooks), [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [플러그인 만들기](https://developers.openai.com/plugins/build/plugins).

## 마일스톤 1 — 프로토콜과 로컬 코디네이터

1. **완료 — T-006:** 결정 제안, 결정 패킷, 선택 요청, `pet_action`/`internal_format_repair` 연속 진행 봉투, 네이티브 요청, 재개 캡슐, 런타임 이벤트의 v1 스키마를 확정했다. 패킷에는 `source_prompt_id`, `source_turn_id`, `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`, `decision_boundary_id`, `boundary_sequence`, `expires_at`을 포함한다.
2. **조건부 완료 — T-007b-A/B1/B2/C:** T-007a journal port의 영속 경계를 Swift 제품 커널과 SQLite 이벤트 저널로 구현하고 B1 의미 application 및 B2 routing/time 경계로 감쌌다. C는 실제 Hook 반복과 Swift 제품 반복을 분리된 게이트로 검증했다. T-011이 두 경계를 연결하는 운영 adapter를 구현했으며, 공개 dispatch에는 실환경 Hook 신뢰·제품 daemon qualification이 더 필요하다.
3. **조건부 완료 — T-007b-A/A2:** strict v1 ingress와 패킷·출처·선택 binding, 프로세스 간 CAS, crash-safe 원자 transaction에 OS Keychain freshness high-water를 결합했다. 불변 DB identity·generation·sequence·head를 strict `initializing`/`committed`/`pending` record로 추적하고 과거 authentic DB snapshot과 DB·키 손실을 fail-closed한다.
4. **조건부 완료 — T-007b-B1/B2:** B1에서 T-007a와 동등한 Swift lifecycle command/reducer 및 제품 semantic 경계를 구현했다. B2는 그 앞에 세션별 활성 패킷 하나, 전역 전면 카드 하나, 추가 세션 대기열과 명시적 전면 선택 계약을 두고 새 카드의 foreground 선점을 막는다. direct B1 selection·Pet token consume·scheduler command는 제품 API에서 차단하고 token consume/claim은 routed monotonic authority를 거친다.
5. **부분 완료 — T-007a:** 슬롯 1·2의 동적 의미와 disabled 대안, 슬롯 3 보류를 참조 코어에서 구현했다. 슬롯 4 제품 롤백은 계속 비활성이고 실제 실행기는 후속 범위다.
6. **조건부 완료 — T-007a/T-007b-A/T-007b-C/T-011:** 봉인된 정확한 패킷·리비전·옵션에서 작업 전체를 읽는 의미와 exact packet/seal/selection/action/verification 영속 binding을 구현했다. T-011 운영 adapter는 Pet의 full 16-field selection과 후속 Stop phase/idempotency gate를 적용한다.
7. **조건부 완료 — T-007b-A/A2:** 형식 보정 예약·claim, 결정 경계당 정확히 한 번, CSPRNG 최소 128-bit 토큰/fingerprint 의미를 crash-safe 영속 트랜잭션에 연결했다. 외부 32-byte 키와 row-bound HMAC, Keychain freshness CAS를 구현했다. 키 회전과 일반 운영자 복구는 후속 범위다.
8. Codex 네이티브 질문/권한 요청을 Blabee 결정 패킷과 다른 상호작용 종류와 ID로 보존한다.
9. **조건부 완료 — T-007b-A/A2/B1/B2:** SQLite 이벤트·패킷·검증 원장, Keychain freshness high-water, Swift 의미 projection, 세션 queue·foreground·continuous deadline projection을 구현했다. foreground와 monotonic anchor는 의도적으로 비영속이며 재시작 때 fail-closed한다.
10. **조건부 완료 — T-011:** 검증된 Skill, Hook, 로컬 MCP를 Swift 운영 어댑터와 단일 UDS owner에 연결해 버전 `0.1.0` Codex 플러그인으로 패키징했다. 운영 패키지에는 센티널 spike 코드를 포함하지 않는다. Keychain 없는 실제 SQLite/Swift 제품 구성요소로 Hook→MCP→Stop→Pet 두 경계 1→2 결합 왕복을 통과했으며, 수동 Hook 신뢰와 로그인 Keychain 제품 daemon은 실환경 게이트로 남긴다.
11. 알파 기준 Codex `0.148.0`을 고정하고 지원 버전 허용 목록을 만든다.
12. `blabee doctor`에 앱, 데몬, 플러그인, Hook 신뢰 설정, Codex 버전/허용 목록, 프로젝트 활성화 여부 검사를 추가한다.

완료 조건:

- 정보 제공 상호작용과 결정 상호작용을 계약 테스트로 구분한다.
- 1·2는 패킷별 동적 내용, 3·4는 고정 의미를 유지하며 2번 비활성 상태를 계약 테스트로 검증한다.
- 숫자만 전달하거나 패킷·리비전·옵션 ID 중 하나가 빠진 연속 진행 요청을 거부한다.
- 비활성 슬롯의 사유 코드와 `action_id = null`을 검증하고 실행 본문이 있으면 거부한다.
- 두 연속 진행 봉투의 필수 필드를 구분하며 형식 보정은 같은 결정 경계에서 한 번만 허용한다.
- 하나의 패킷을 두 번 실행하거나 잘못된 세션에서 실행할 수 없다.
- 두 세션에 패킷이 동시에 대기해도 명시적으로 선택한 전면 카드만 실행된다.
- 코디네이터를 재시작하면 저널을 바탕으로 lifecycle을 복원하되, monotonic 경과를 증명할 수 없는 pending packet과 unterminated continuation은 각각 expiry와 `timed_out_unknown`으로 fail-closed하고 foreground는 명시적으로 다시 선택해야 한다.
- 형식 보정 상태는 별도 진실 원본 없이 `internal_format_repair_reserved`·`internal_format_repair_claimed` journal projection으로 복원되며, 예약 append와 경계당 1회 예산 소비가 원자적이다.
- continuation token은 CSPRNG 최소 128-bit로 발급하고 durable journal에는 SHA-256/HMAC-SHA-256 fingerprint만 저장하며, 검증은 constant-time 비교 테스트를 통과한다.

### T-006 실행 결과 — 2026-08-21

- `Contracts/v1`: JSON Schema Draft 2020-12 스키마 10개와 오프라인 `$id` 매니페스트를 확정했다.
- `Fixtures/v1`: 유효 15개, 무효 10개 계약 Fixture와 동일 턴 경계 1→2·stale 선택·binding mismatch·in-flight timeout·형식 보정 예약/claim·재시작 replay 이벤트 trace 7개를 고정했다.
- `Tests/Contracts`: strict Ajv 컴파일, 무효 사례의 안정 오류 코드 매핑, 식별자 전용 선택, 반고정 슬롯, 두 continuation 모드의 일회성·만료·exact binding, 형식 보정 예약·claim의 재시작 안전 replay, 전송/작업 결과 분리를 검증한다.
- T-006 완료 당시 `npm run test:contracts`는 102/102, 기존 M0까지 포함한 `npm test`는 155/155 통과했다. T-005와 T-007a를 포함한 현재 통합 결과는 아래 실행 결과에 기록한다.
- T-006은 런타임 독립 계약만 완료했다. 이후 T-007a가 의미 상태 머신을, T-007b-A가 저수준 이벤트 저널·원자 저장·재시작 복구를, T-007b-B1이 Swift semantic application port를, B2가 세션 라우팅·시간 처리를 구현했고 C가 실제 Hook 반복과 제품 상태 반복을 분리된 게이트로 검증했다.
- 실제 사용자 저장소 롤백은 연결하지 않았다. T-006/M1 Fixture에서는 슬롯 4를 `rollback_not_enabled_in_build`로 비활성화한다.

### T-005, T-007a 및 T-007b-A/A2/B1/B2/C 실행 결과 — 2026-08-21

- T-005는 Node와 Swift에 공통 NDJSON·durable journal 자격 계약을 적용해 강제 종료 replay, partial-tail 절단, 지속 부하, 구조화 진단, 축약한 명목상 120초 단조 대기, ad-hoc 서명과 측정용 DMG를 통과시켰다. Swift 네이티브 헬퍼를 제품 런타임으로 선택하고 Node는 계약 참조, C는 health 전용 기준선으로 남겼다.
- 유효한 Developer ID codesign identity는 읽기 전용 확인에서 0개였고 Apple 공증은 측정하지 않았다. 공개 서명·공증 앱 DMG, updater와 `blabee doctor`는 T-012 범위다.
- T-007a는 JavaScript ESM의 런타임 중립 참조 코어로 순수 `decide`/`reduce`/`replay`, 예상 sequence 기반 CAS append, 같은 턴 경계 1→2, stale·교차 세션·비활성·중복 선택 거부, 슬롯 1·2 dispatch와 슬롯 3 pause를 구현했다.
- v1 `decision_packet_sealed` 이벤트가 작업 본문 전체를 담지 않으므로 봉인 패킷 문서 sidecar를, `continuation_dispatched` 이벤트가 Pet token fingerprint를 담지 않으므로 검증 sidecar를 추가했다. 두 sidecar는 관련 런타임 이벤트와 원자 저장되고 불변이며, 수명 주기 상태의 진실 원본은 계속 v1 런타임 이벤트다. 원문 토큰과 작업 본문은 검증 sidecar에 저장하지 않는다.
- 참조 코어 31개 테스트가 패킷 exact resolution, 모든 유효 trace prefix replay, CSPRNG·SHA/HMAC·constant-time 검증, format repair exactly-once, timeout `unknown`, 전송 종료와 작업 outcome 분리, prototype-key 충돌 fail-closed, command/replay 동등성, 같은 턴의 불변 prompt/checkpoint lineage와 패킷 의미 검증을 통과했다. T-007a가 지원하지 않는 enabled rollback도 명시적으로 거부한다.
- T-007a QA와 동기화하며 계약 의미 검증에 같은 턴 lineage, 전역 continuation ID·fingerprint 재사용 금지, consume 유효 시간과 terminal 이후 재소비 금지를 추가했다.
- T-007b-A는 독립 Swift Package의 제품 영속 커널로 strict JSON/고정 v1 ingress, contract hash pin, SQLite WAL/FULL/FK와 프로세스 간 CAS, crash/SIGKILL·commit 후 replay를 구현했다. ingress는 영속 경계의 4개 계약 타입과 manifest fixture 20개를 지원하며 나머지 계약 타입을 범용 CLI ingress로 주장하지 않는다.
- T-007b-B1은 T-007a의 12개 런타임 이벤트와 11개 command를 Swift로 포팅했다. application은 `load → replay → decide → candidate replay → atomic append` 순서를 강제하고 CAS 충돌을 최대 2회만 재시도하며, 토큰은 재시도 전 한 번만 생성하고 commit 전에는 effect로 노출하지 않는다.
- T-007b-B2는 같은 프로젝트·세션의 pending interaction 하나를 decision/replay 양쪽에서 원자적으로 강제하고, 여러 세션 queue·명시적 foreground/no-steal·exact binding selection을 제품 API에 연결했다. `mach_continuous_time`과 주입 clock으로 60초 reminder, 120초 expiry, coordinator-owned 120초 Pet·형식 보정 token/300초 in-flight deadline을 처리한다. token 소비와 transport 완료의 audit 시각도 logical monotonic time으로 덮어써 외부 wall timestamp와 기간을 권위로 사용하지 않는다.
- B2 재시작은 process-local foreground와 token claim anchor를 복원하지 않는다. monotonic anchor를 증명할 수 없는 persisted pending packet은 audit `expires_at`에서 만료하고 terminal 없는 continuation은 `in_flight_deadline_at`에서 `timed_out_unknown`으로 정확히 한 번 기록한다. 새 product event loop는 stdin `poll(2)` timeout과 readable-cycle 선처리로 정상·비정상 입력 폭주 중에도 deadline을 진행한다.
- 런타임 이벤트는 MAC chain과 인증된 head anchor로, packet/verification sidecar는 exact row identity를 포함한 HMAC으로 인증한다. 외부 32-byte 키는 파일 `0600`·상위 디렉터리 `0700`·symlink fail-closed 정책을 따르며 `openat` 기반 경로 검사를 사용한다.
- QA 보강으로 exact packet/seal/selection/action/verification binding, exact Int64, DB·키 손실, exact `sqlite_schema`와 trigger 변조, 필수 contract pin, test-only crash gate, post-commit replay를 검증했다. runtime-known secret corpus는 프로세스가 관찰·등록한 값만 검사하고 재시작 시 다시 등록하며, 보지 못한 임의 secret 전체를 탐지한다고 주장하지 않는다.
- T-007b-A2는 strict canonical `initializing`/`committed`/`pending` Keychain record, immutable DB identity와 generation/sequence/head metadata, `kSecAttrGeneric` digest CAS, process mutex와 `0600` `flock`을 추가했다. storage preflight와 lock 뒤 recheck는 DB/키 loss나 anchor 누락에서 파일을 만들지 않으며, 기존 DB·키에 anchor가 없는 pre-A2 상태를 자동 migration/adoption하지 않는다.
- append는 Keychain `pending(from,to,batch digest)`을 CAS한 뒤 SQLite를 commit하고, 전체 authenticated replay 뒤에만 `committed(to)`를 CAS한다. `pending + target DB`는 replay 성공 뒤 finalize하고, `pending + source DB`는 자동 취소하지 않으며 exact canonical batch 재시도만 허용한다. crash point 85/87/88/86으로 각 경계를 검증했다.
- 과거 authentic DB snapshot, DB·키 손실, anchor 누락/손상, Keychain CAS 경쟁과 concurrent writer를 fail-closed했다. Keychain `errSecDecode`/`errSecInvalidKeychain`은 corrupt, 잠금·interaction 불가는 unavailable로 분류하고 test namespace cleanup은 명시적 gate와 `test-` account로 제한했다.
- B1 제품 NDJSON은 `execute_command`만 노출한다. raw `append`는 `BLABEE_JOURNAL_TEST_HARNESS` compile flag로 만든 테스트 바이너리에만 존재한다. 생성 토큰은 허용된 effect에 stdout 1회만 나타나고 DB·WAL·SHM·stderr에는 기록하지 않으며, consume과 로그는 제출 토큰을 다시 출력하지 않는다.
- Swift 식별자는 저장 시 NFC를 요구하고 참조 비교는 UTF-8 byte-exact로 수행한다. SQLite text bind/read는 명시적 UTF-8 byte length를 사용해 NUL 포함 ID를 보존한다. decimal/exponent 정수 표기는 Foundation 반올림을 막기 위해 ±2^53까지만 허용하고 일반 정수 표기는 Int64 전체 범위를 유지한다.
- A/A2 기준선은 Swift unit 27/27, persistence Node 통합 40/40, 당시 통합 `npm test` 242/242였다. 진단 가림 회귀 추가 직전 전체 `npm test`는 247/247 통과했다. 추가 뒤 최신 실행은 248개 중 246개가 통과했고, 나머지 2개는 macOS Keychain `security` 조회가 각각 30초 동안 응답하지 않은 환경 timeout이다. T-007b-B2 완료 당시 집중 결과는 Swift package 62/62, T-007a 33/33, persistence 이전 독립 실행 40/40, M0 55/55였다. 전 범위에서 발견한 Int64 초과 NDJSON 응답 상관관계도 안전한 request-ID 전용 복구로 수정했다. 현재 `SQLiteJournal.swift` SHA-256은 `399c0715678a3e6cd0863481d91f512a6a3f7965320d1ed09863baadacb0dae8`이다.
- T-007b-A/A2 판정은 제품 영속·freshness 커널 범위의 조건부 완료다. unsigned CLI는 entitlement 부재로 legacy login Keychain을 사용하며, 서명된 wrapper와 Data Protection Keychain/access group·`LAContext` 전환은 T-012에 남는다. 같은 UID 공격자의 Keychain 삭제·교체와 DB·키·anchor 동시 제거, exact batch가 없는 pending-source 운영 복구는 A2 밖이다.
- T-007b-C는 실제 Codex CLI `0.149.0`+M0 fake coordinator의 두 사이클과 Swift 제품 coordinator의 16-event 반복 게이트를 각각 통과해 조건부 완료했고, T-007 전체는 `done`으로 판정한다. T-011은 고수준 Hook/MCP/Pet adapter, 단일 daemon/UDS ownership, full selection binding, Stop observation digest와 원문 continuation token 비노출을 구현했다. 실제 장시간 macOS sleep, 로그인 Keychain 제품 daemon과 수동 Hook 신뢰 검토는 패키징·실환경 게이트에 남는다. `pending + source DB`와 응답 유실 뒤 원문 토큰 재발급 금지는 안전하게 차단되지만 운영자 복구 UX가 필요하다.

### T-011 실행 결과 — 2026-08-22

- `Plugin/blabee/`에 Skill, 4개 Hook, MCP 설정, fail-open launcher를 포함한 Codex Plugin v0.1.0을 추가했다. 모든 답변을 결정 카드로 바꾸지 않으며 운영 경로에 M0 센티널이나 fake coordinator가 없다.
- `CoordinatorOperationalApplication`이 project/session/prompt/proposal/Stop/permission/Pet state/full selection만 노출하고, v1 16-field selection과 봉인 packet의 9-field binding을 exact 검증한다. 1·2는 동적, 3은 보류, 4는 `rollback_not_enabled_in_build`다.
- 하나의 UDS owner가 `0700` runtime directory, `0600` socket/lease, 양방향 peer UID, 1 MiB 한 줄·64개 동시 연결, stale same-UID socket 회수와 owned-inode cleanup을 강제한다. 정규화한 절대 DB 경로 identity의 별도 storage authority가 같은 DB·다른 socket의 두 번째 제품 프로세스를 storage 초기화 전에 차단한다.
- 지정된 UserPromptSubmit context 외 correlation token 재노출과 proposal free-text copy를 차단한다. action continuation 원문 token은 Stop block 전에 소비하며 DB/WAL/SHM·Hook/MCP/Pet/UDS 공개 응답에 싣지 않는다. Stop 원문 메시지 대신 HMAC observation과 request generation으로 delivery/completion을 구분한다.
- 실제 제품 Hook/MCP CLI와 test-only in-memory freshness를 사용하는 실제 SQLiteJournal→Routing→Operational→UDS를 연결해 같은 lineage의 경계 1→2, staged promotion, full Pet selection 두 번과 마지막 completion을 센티널 없이 통과했다.
- 부모 최종 `npm run test:t011` 23/23, Swift Operational 12/12와 Routing 16/16이 통과했다. Operational은 최종 동결 소스에서 3회 연속 재통과했다. 새 결합 gate 3/3 반복과 최신 UDS 종료 집중 18/18도 통과했다. Python Plugin/Skill validator는 PyYAML 부재로 실행 전에 중단됐지만 실제 Codex CLI `0.149.0`의 격리 install/cache-buster update/remove와 자체 package 계약 검사가 통과했다.
- open/seal, 선택, completion/close, expiry/timeout의 pre-commit 실패와 commit 뒤 응답 유실을 fault injection으로 검증했다. open→seal journal 인접성과 최초 seal의 monotonic anchor를 유지하고, 선택 commit이 모호하면 authoritative journal을 250 ms backoff로 재조정하되 원문 continuation token은 재발급하지 않는다. terminal notice와 staged promotion은 exactly-once로 수렴한다.
- 실제 로그인 Keychain 제품 daemon은 비밀번호 prompt를 피하기 위해 실행하지 않았다. Hook 신뢰 수동 검토, signed Data Protection Keychain, PATH/launchd/doctor/DMG/터미널 매트릭스는 T-012에 남는다.

## 마일스톤 2 — 증거, 체크포인트, 진행 중인 프로젝트 도입

1. 저장소를 변경하지 않고 도입 기준선을 구현한다.
2. 사람이 직접 입력한 작업 프롬프트만 경계로 삼고 Pet 1·2의 같은 턴 Stop 연속 진행은 같은 기준선을 유지하는 프롬프트 에피소드와, 선택적 읽기 전용 프로젝트 캡슐 생성을 구현한다.
3. 출처 정보와 함께 Git 상태/diff, 파일 변경, 명령 결과, 테스트/lint/build 증거를 수집한다.
4. 결정론적 위험 게이트를 구현한다.
5. `source_prompt_id`, `source_turn_id`, `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`를 원자적으로 연결하고 시작 프롬프트 전달 직전 기준선과 각 결정 경계의 사후 상태를 구현한다.
6. 공개 v0.1에서는 사람이 에피소드를 시작하는 프롬프트 입력 직전 Git 작업 트리와 인덱스가 깨끗할 때만 롤백 후보를 만든다. 기존 변경이 있으면 권장 작업·대안 작업·보류는 유지하되 롤백만 비활성화하며, Pet 1·2 연속 진행에서는 clean-worktree 게이트를 다시 적용하지 않는다.
7. 파일당 16 MiB, 체크포인트당 128 MiB, 프로젝트당 1 GiB 한도를 구현한다. 한도 초과 시 범위를 `partial` 또는 `unavailable`로 바꾸고 롤백을 비활성화한다.
8. 1 GiB 보관 한도에 가까워지면 종료된 에피소드부터 정리하되 활성·보류 기준선, 대기 패킷 참조, 최신 복구 스냅샷을 보호하는 정리 정책을 구현한다. 보호 대상을 지우지 않고 공간을 확보할 수 없으면 새 롤백을 비활성화한다.
9. 무시 파일, 하위 모듈, LFS, 저장소 루트 밖 경로와 외부 부수 효과를 제외 대상으로 기록하고, 에피소드가 이를 건드렸거나 건드리지 않았음을 증명할 수 없으면 롤백을 비활성화한다.
10. Git 저장소가 아닌 프로젝트에서는 권장 작업·대안 작업·보류를 유지하고 롤백만 `not_a_git_repository` 사유로 비활성화한다.
11. 저장소 전체 배타 잠금과 TOCTOU 재검증, 브랜치/HEAD 변경과 같은 경로의 사람 동시 편집 감지, 롤백 직전 복구 스냅샷, 복원, 바이트·Git 실행 비트·인덱스 검증을 구현한다. sparse/skip-worktree/assume-unchanged는 `unsupported_index_state`, `core.filemode = false`는 `unsupported_git_configuration`, 비추적 POSIX 모드는 `unsupported_file_metadata`로 차단한다.
12. ignored/submodule/LFS/outside-root/external-effect hazard attestation 다섯 개 모두가 명시적으로 안전하다고 증명되지 않으면 `hazard_attestation_missing`으로 차단한다.
13. 재개 캡슐의 영속 저장을 구현한다.
14. 권장 작업, 대안 작업, 보류, 롤백 실행기를 구현한다. 롤백은 활성 결정 패킷의 `episode_root_prompt_id` 직전 기준선부터 현재 결정 경계까지의 에피소드 하나만 대상으로 한다.

완료 조건:

- Blabee 도입 이전 작업을 롤백 안전 대상으로 표시하지 않는다.
- 깨끗한 기준선에서 시작한 프롬프트 에피소드가 만든 지원 범위의 추적 파일, 미추적 파일, 바이너리, 이름 변경, Git 실행 비트, 심볼릭 링크가 정확히 제거되거나 원래 상태로 복원된다. 그 밖의 POSIX 모드 변화는 unsupported로 롤백이 비활성화된다.
- 사람이 에피소드를 시작하는 프롬프트를 입력하기 전에 스테이징된 변경, 스테이징되지 않은 변경 또는 미추적 파일이 있으면 공개 v0.1 롤백이 비활성화된다.
- Stop Hook 내부의 기계적 재시도·형식 보정과 Pet 1·2의 같은 턴 연속 진행에서 생긴 변경은 시작 프롬프트와 같은 에피소드로 복원된다. 사람이 새 작업 프롬프트를 직접 입력할 때만 이전 에피소드를 닫고 다음 기준선을 판단한다.
- 한도 초과, 제외 경로, 동시 편집, 브랜치/HEAD 변경이나 외부 부수 효과가 있으면 롤백을 비활성화한다.
- 1 GiB 정리 시 보호된 기준선·패킷 참조·최신 복구 스냅샷은 남고 종료된 에피소드부터 제거된다.
- Git 저장소가 아닌 프로젝트에서는 1·2·3이 동작하고 4만 비활성화된다.
- 복원 실패 시 롤백 직전 복구 스냅샷의 위치와 수동 복구 절차를 제시한다.
- 복구 스냅샷의 실제 재적용과 복원 단계별 실패 주입 테스트가 통과한다.
- 저장소 밖 경로와 외부 효과의 무변경을 증명할 수 없으면 fail-closed한다.

## 마일스톤 3 — 네이티브 macOS Pet

1. 활성화되지 않으면서 항상 최상단에 표시되는 NSPanel을 만든다.
2. 대기, 작업 중, 결정, 네이티브 요청 알림, 60초 알림, 만료, 보류, 복원 완료, 복구 상태를 구현한다.
3. 여러 세션의 대기 카드를 프로젝트·경로·세션 식별자와 함께 보여 주고, 전면 카드의 명시적 선택 및 전환 UI를 구현한다.
4. 설정 가능한 `Option + 1·2·3·4` 단축키와 Pet 열기/닫기 단축키를 구현한다.
5. 1번과 2번에는 현재 패킷의 동적 제목을 표시하고, 3번은 보류, 4번은 롤백으로 고정한다. 대안이 없으면 2번을 비활성 상태로 표시한다.
6. 전면 상호작용 ID, 프로젝트·세션·에피소드 ID, 패킷 ID, 리비전, 옵션 ID에만 단축키 입력을 전달하고 모호하거나 만료된 입력을 거부한다.
7. 위험도가 `high` 또는 `critical`이면 1·2 전역 단축키를 비활성화하고 펼친 위험 확인을 거쳐 작업 지시를 보내도록 한다. 이 확인은 Codex 네이티브 승인을 대신하지 않는다.
8. Codex 네이티브 요청은 Blabee 결정 카드와 구분되는 알림으로 표시하고, 공개 v0.1에서는 polling 시점 frontmost 앱으로의 best-effort 복귀만 제공한다. 정확한 원래 창이나 원문·선택지 전체 미러링을 약속하지 않는다.
9. 증거, 위험, 체크포인트, 원본 결과 상세 보기를 추가한다.
10. 다중 모니터, Spaces, 전체 화면, 포커스, 단축키 충돌 테스트를 추가한다.

완료 조건:

- 일반 타이핑의 입력 포커스를 빼앗지 않는다.
- 유효한 활성 상호작용이 없으면 단축키가 아무 동작도 하지 않는다.
- 하나의 결정을 두 번 실행할 수 없다.
- 두 세션의 카드가 동시에 대기할 때 새 카드가 전면 대상을 빼앗지 않고, 명시적으로 전환하기 전에는 기존 전면 카드에만 단축키가 적용된다.
- 2번 비활성 상태에서 단축키가 실행되지 않고, 다른 의미로 대체 표시되지 않는다.
- `high`·`critical` 위험 작업은 전역 숫자 단축키로 시작되지 않고, Pet 확인과 Codex 네이티브 승인이 별도로 유지된다.
- 120초 만료 후 늦은 단축키가 새 턴이나 롤백을 시작하지 않는다.
- 네이티브 요청 알림에서 허용/거부를 전송할 수 없다.

### T-010 실행 결과 — 2026-08-22

- `blabee-coordinator pet` 모드에 SwiftUI 기반 비활성 floating `NSPanel`을 추가했다. panel은 always-on-top, 모든 Space 참여, 전체 화면 보조 표시와 화면 visible frame 안쪽 위치 보정을 적용하며 표시할 때 앱을 활성화하지 않는다.
- 코디네이터 snapshot을 엄격한 typed model로 읽고 routing 순서를 보존한 exact identity/binding join만 허용한다. 사용자가 카드를 명시적으로 전환할 때 14-field `focus_interaction`을 먼저 보내고, 선택할 때 16-field v1 request를 보내며 `select` 자체가 foreground를 바꾸지 않는다.
- 슬롯 1·2는 패킷별 동적 작업, 3은 보류, 4는 롤백 자리로 표시한다. disabled 슬롯, 만료, stale revision, 모호한 routing, 중복 option/action ID와 불완전한 rollback checkpoint는 fail-closed한다. 한 interaction의 선택은 슬롯이 달라도 single-flight다.
- 기본 `Option+1·2·3·4`와 `Option+Space`를 Carbon으로 동적 등록하고, 설정 화면에서 Option을 포함한 제한된 modifier·숫자·영문자·Space 조합만 선택하게 한다. Option 단독은 숫자와 Space로 제한하고 중복·미지원 조합은 저장 전에 거부한다. 활성 binding 변경 중 일부라도 등록에 실패하면 후보 전체를 폐기하고 이전 설정과 binding을 복원하며, 성공한 경우에만 UserDefaults에 저장한다. 카드에는 저장값이 아니라 실제 등록 상태를 기준으로 chord·`Pet 확인`·`사용 불가`·`충돌`·`등록 실패`를 표시한다. 실제 활성 슬롯만 등록하고 오래된 registration ID는 무시한다. `high`·`critical`의 1·2는 전역 숫자 단축키에서 제외하고 펼친 확인 UI를 거치며 3번 보류는 계속 사용할 수 있다.
- PermissionRequest는 새 요청 수만 알리고 Allow/Deny를 제공하지 않는다. Pet 선택 후 복귀할 호스트와 권한 알림에서 열 호스트를 분리해 기억하지만, 요청에 원래 PID/창 identity가 없어 권한 알림 증가를 polling한 시점의 frontmost 외부 앱으로만 best-effort 복귀한다.
- 현재 operational 제안 생성은 risk `info`, 빈 evidence, checkpoint `unavailable`, rollback disabled를 고정한다. 따라서 `high`·`critical` 확인, 채워진 evidence/checkpoint 상세와 활성 롤백은 Pet fixture로 안전 동작을 검증한 경로이며 아직 실제 제안에서 end-to-end로 도달하지 않는다.
- Pet 35/35, Operational 14/14, Routing 필터 18/18(Routing 16 + Pet 2)과 Swift package XCTest 5/5 + Swift Testing 106/106가 현재 소스에서 통과했다. `npm run test:t011` 23/23과 `npm run test:contracts` 114/114도 재통과했다.
- `/tmp`의 격리 UDS·임시 번들·호스트 프로브로 실제 WindowServer 1차 qualification을 수행했다. Pet·설정·Picker 조작 중 호스트 active/key/focus와 입력 연속성을 유지했고, 취소 복원과 격리 저장/재시작, 실제 Carbon 충돌 label, 유효 카드의 exact 14-field focus·16-field select를 확인했다. 접기→펼치기→접기 위치 점프를 발견해 lower-trailing anchor 보존으로 수정했고 실제 frame이 `92×92@(3328,1328) → 440×620@(2980,800) → 92×92@(3328,1328)`로 왕복했다.
- Keychain 없는 실제 UDS와 제품 Hook·MCP·Stop 경로의 연속 시계 qualification에서 reminder `60,056.709 ms`, expiry `120,030.318 ms`, 늦은 focus/select 거부와 최종 빈 routing 상태를 확인했다. Pet의 local foreground 시각 표시는 computer-use runtime 중단으로 별도 환경 게이트에 남겼다.
- 다중 디스플레이 이동·분리·재연결, Spaces/전체 화면·Stage Manager, 물리 전역 키와 키보드 레이아웃, Pet 시각 만료·sleep, Terminal·VS Code·Orca 호스트 복귀는 수동 검증으로 남는다. `.app`/Info.plist/entitlement/launchd/서명·공증·DMG는 T-012 책임이다. 따라서 T-010 상태는 `in_progress`다.

## 마일스톤 4 — 패키징과 내부 사용

1. 플러그인 미리보기/설치/업데이트/제거 흐름을 만든다.
2. 명시적 동의를 거쳐 선택적으로 CLI와 로그인 항목을 설치하도록 한다.
3. 서명과 공증을 거쳐 DMG를 빌드한다.
4. Terminal, iTerm, VS Code 터미널, Orca에서 동일한 기본 플러그인 경로를 테스트한다.
5. 알파에서 Codex `0.148.0` 계약 픽스처를 실행하고, 공개 버전 허용 목록과 비지원 버전 차단/안내를 검증한다.
6. `blabee doctor`에서 Codex 버전, 앱/데몬, Plugin/MCP, Hook 신뢰, 프로젝트 활성화 상태를 진단한다.
7. 주간, 새 Codex 버전 발견 시, Blabee 릴리스 전에 호환성 계약 검사를 실행하는 절차를 만든다.
8. 일주일 동안 내부 사용을 진행하며 결정 커버리지, 지연 시간, 연속 루프, 수정 비율, 롤백 성공률을 기록한다.
9. 고위험 및 롤백 릴리스 게이트를 실행한다.

T-012a 실행 결과:

- `blabee-coordinator doctor`와 operational state를 변경하지 않는 전용 UDS `doctor_status`를 구현했다.
- Codex exact 버전, Plugin 설치/version/local source와 v0.1.0 manifest·MCP·Hook·launcher·Skill 계약, PATH coordinator identity, 앱/daemon/프로젝트 범위를 fail-closed로 검사한다.
- Hook 신뢰는 자동 추정하지 않고 항상 `/hooks` 수동 검토를 요구한다. 지원 allowlist는 아직 비어 있다.
- Doctor 18/18, Operational 15/15, T-011 23/23, v1 계약 114/114가 통과했다. 실제 signed app·Keychain·DMG·공증·버전 승인·터미널 매트릭스와 공개용 TOCTOU/process-group hardening은 후속 단계다.

T-012b-1 실행 결과:

- 저장소 또는 시스템 임시 영역의 명시적 절대 경로에만 `Blabee.app`을 조립한다. 기존 출력은 덮어쓰지 않고, sibling staging을 완료한 뒤 최종 디렉터리를 원자 선점해 `Contents`를 게시한다.
- 앱에는 고정 `Info.plist`, 단일 release `blabee-coordinator`, exact `Contracts/v1`, exact `Plugin/blabee`, 서명 전 파일 경로·크기·모드·SHA-256 manifest를 포함한다. 입력/출력 symlink와 특수 파일, 잘못된 plist 값·타입, 비실행 바이너리, 동시 조립을 fail-closed한다.
- 정확한 `com.biadone.blabee`의 `Blabee.app` 무인자 실행과 정상 LaunchServices PSN만 Pet 모드로 연결하고, 기존 명령과 일반 CLI 무인자/legacy 인자는 그대로 유지한다.
- 패키징 5/5, Swift Pet/Doctor/진입 55/55, T-011 23/23, v1 계약 114/114가 통과했다. 실제 release 앱은 entitlement 없이 `adhoc,runtime` 서명과 deep/strict 검증을 통과했고 Info.plist 변조 후 검증은 실패했다.
- 이 단계는 로컬 조립 자격이다. `/Applications`, PATH, 셸 설정, launchd/로그인 항목, Keychain, Developer ID, 공증, Gatekeeper, DMG를 변경하거나 승인하지 않는다.

T-012b-2 실행 결과:

- 제품 `service` 모드는 exact `Blabee.app` identity와 `Contents/Resources/Contracts/v1`을 요구하고, Application Support 아래 DB·key·socket·설정 경로를 고정 파생한다. 추가 인자와 `HOME`·`BLABEE_SOCKET` 기반 우회를 허용하지 않으며 기존 개발용 `daemon` 계약은 유지한다.
- `config/service.json`은 exact v1 스키마, 절대 프로젝트 경로, 64 KiB·256개·4096 byte 상한을 적용한다. 설정 디렉터리 `0700`, 파일 `0600`, 현재 사용자 소유, regular/non-symlink 조건과 descriptor 기반 bounded read를 fail-closed로 검사한다. 설정 누락은 활성 프로젝트 0개이고 기존의 잘못된 설정은 시작 실패다.
- 정적 LaunchAgent plist를 `Contents/Library/LaunchAgents`에 서명 전 포함한다. exact 네 키와 `service` argv를 강제하고 assembly manifest에 hash·size·mode를 기록한다. 실제 수명주기 검증 전에는 `RunAtLoad`만 사용하며 `KeepAlive`는 제외한다.
- Product service 10/10, Swift Pet 전체 65/65, 패키징 7/7, T-011 23/23, v1 계약 114/114가 통과했다. 실제 release 앱의 ad-hoc deep/strict 서명과 LaunchAgent 변조 거부도 통과했다.
- 이 단계는 설치·등록 전 계약 자격이다. 실제 `service`, Keychain, `SMAppService.register()`, launchctl, `/Applications`, Developer ID, 공증 또는 DMG는 실행·변경하지 않았다.

T-012b-3a 실행 결과:

- exact `Blabee.app`에서만 동작하는 `project-settings enable|disable --project ABSOLUTE_PATH`를 추가했다. raw binary·lookalike bundle, loose argument와 환경·CWD 기반 설정 경로 우회는 설정 변경 전에 거부한다.
- Application Support와 `Blabee/config`를 descriptor로 순회해 current-user secure directory만 사용하고, 설정은 process mutex와 persistent `0600` `flock` 아래에서 strict read-modify-write한다. same-directory temporary file을 완전히 쓰고 file `fsync` 뒤 `renameat`, directory `fsync`로 게시한다. 멱등 재시도도 directory sync 전에는 성공하지 않는다.
- enable 프로젝트 경로는 `/tmp`·`/var` system alias를 고정한 뒤 루트부터 모든 구성요소를 `O_NOFOLLOW`로 열어 ancestor/final symlink를 거부한다. disable은 삭제된 stale path를 제거할 수 있다. service reader도 Application Support→`Blabee`→`config`를 같은 read-only descriptor 경계로 열며 누락만 빈 설정으로 처리한다.
- writer 12/12, 독립 fresh reader+writer 23/23, Swift Pet 78/78, 전체 Swift package XCTest 5/5+Swift Testing 150/150, release product build와 패키징 7/7이 통과했다. 같은 프로세스와 별도 프로세스의 실제 overlap, restrictive umask, lock name 교체, 64 KiB 보존, rename 전후 실패와 durability 재시도를 포함한다.
- 이 단계는 설정 writer와 최소 CLI seam의 로컬 자격이다. 당시 남았던 Pet 온보딩 UI와 `SMAppService` 상태·등록·해제 코드 계약은 T-012b-3b에서 연결했고, 실제 등록/승인, service·Keychain 실행, 설치·공개 배포는 계속 후속 단계다.

T-012b-3b 실행 결과:

- Pet 설정 화면에 서비스 상태와 프로젝트 온보딩을 연결했다. `notRegistered`·`enabled`·`requiresApproval`·`notFound`·unknown을 별도 상태로 표시하고, unknown/notFound에서는 변경 동작을 fail-closed한다.
- 앱 시작·poll·snapshot 갱신·설정 화면 열기는 상태와 설정만 읽는다. 등록·해제·System Settings 열기·프로젝트 enable/disable은 각 명시적 사용자 버튼에서만 호출하며, 자동 등록·낙관적 상태 변경·자동 service 재시작은 하지 않는다.
- 모든 변경은 single-flight로 직렬화하고 성공·실패 뒤 실제 상태와 설정을 다시 읽는다. 설정 읽기가 실패하면 기존 목록을 지우고 비권위 상태로 표시해 프로젝트 변경을 막는다.
- 저장된 `configured projects`와 현재 daemon snapshot의 `active projects`를 구분한다. 설정에서 제거했지만 아직 실행 중인 프로젝트도 `현재 서비스에서만 활성`로 유지하며, 변경은 다음 service 재시작부터 적용된다고 안내한다.
- fake adapter 집중 10/10, Pet 88/88, 전체 Swift package XCTest 5/5+Swift Testing 160/160, T-011 23/23, 패키징 7/7, v1 계약 114/114, release build와 임시 ad-hoc 앱 deep/strict 서명 검증이 통과했다. 온보딩 집중 테스트는 fake만 사용했고 실제 `SMAppService`, `service`, `NSOpenPanel`, System Settings, 사용자 Application Support 또는 제품 primary Keychain은 호출·변경하지 않았다. 전체 Swift 회귀가 사용한 격리된 임의 test-only Keychain account는 종료 전에 정리했다.
- 이 단계는 UI와 수명주기 어댑터의 코드 계약 자격이다. signed app에서 실제 등록·승인·해제와 로그인/재부팅 수명주기를 검증하는 T-012b-3c는 시스템 상태 변경 전 사용자 동의를 받는 별도 실기기 gate다.

완료 조건:

- 터미널에 다시 입력하지 않고 저위험 루프 세 번을 연속으로 성공한다.
- 검증된 롤백 실패: 0건.
- 높음/치명적 위험 작업의 전역 숫자 단축키 시작 및 Codex 네이티브 원클릭 승인: 0건.
- 별도의 LLM API 키가 필요하지 않다.
- 허용 목록 밖 Codex 버전에서는 자동 동작을 차단하고 진단 메시지를 제공한다.

## 마일스톤 5 — 관리형 app-server 모드

이 단계는 Hook MVP에 필수적이지 않다.

1. 로컬 JSON-RPC 브로커의 프로토타입을 만들거나 안전한 다중 클라이언트 요청 소유권을 입증한다.
2. 공식 TUI 동작을 유지하면서 네이티브 질문과 승인을 Pet에도 표시하고, 명시적인 별도 릴리스 게이트를 통과한 뒤에만 응답 중계를 검토한다.
3. 정확한 스레드 목록 조회, 재개, 전체 `requestUserInput`, app-server 스레드 구독 및 네이티브 요청 대기열을 추가한다. 이는 Hook v0.1의 로컬 결정 카드 대기열과 별도다.
4. Codex 버전별 프로토콜 호환성 픽스처를 고정한다.

완료 조건:

- Pet에 전달된 모든 요청은 요청 ID를 기준으로 정확히 한 번만 처리된다.
- Pet을 사용할 수 없을 때 사용자가 원래 TUI에서 응답할 수 있다.
- 지원하지 않는 기존 세션 자동 연결 기능을 제품 메시지에서 주장하지 않는다.

## 테스트 전략

- 정보 제공, 동적 권장 작업, 동적 대안 작업, 대안 없음, 보류, 롤백, 부분 완료, 차단, 실패, 형식 오류, 만료 패킷에 대한 스키마 골든 픽스처
- `packet_id`, `revision`, `option_id`와 전체 작업 의미 전달, 누락/불일치/숫자 단독 입력 거부에 대한 선택 계약 테스트
- `pet_action`의 same-turn Stop 전용 전달·수명 주기 종료 관찰과 `UserPromptSubmit` 경로 거부, 선택 전 패킷 만료, `internal_format_repair` 제출 봉투의 토큰 재사용·만료·교차 프로젝트·세션·에피소드·`source_turn_id`·`source_prompt_id` 불일치 거부와 형식 보정 1회 한도 테스트. T-006/B1은 dispatch 후 `pet_action`의 `in_flight_deadline_at`, timeout 결과 `unknown`, 자동 재시도·취소·실패 추론 금지를 고정하며 B2가 실제 연속 단조 runtime 시계를 검증한다.
- 비활성 2·4 슬롯의 안정적인 `disabled_reason`, `action_id = null`, 실행 본문 부재와 단축키 거부 테스트
- SessionStart, UserPromptSubmit, 도구, 권한 알림, Stop, 재개, 압축, 2초 연결 fail-open, 60초 알림, 120초 만료, 데몬 손실에 대한 실제 시간 초과 Hook 통합 픽스처
- 절전/복귀와 시스템 시계 앞·뒤 변경에도 연속 단조 시계 기준 60초·120초가 늘어나지 않고, 재시작 후 경과가 모호하면 만료되는지 확인하는 시간 테스트
- 사람의 새 작업 프롬프트만 에피소드 경계를 만들고, Pet 1·2의 같은 턴 Stop 연속 진행과 Hook 내부 기계적 재시도·형식 보정은 기존 에피소드와 기준선을 유지하는지 확인하는 테스트
- 중복/순서가 뒤바뀐 이벤트, 만료 후 입력과 잘못된 전이에 대한 상태 머신 테스트
- 두 개 이상의 Hook 세션이 동시에 대기할 때 전면 카드 선점, 명시적 전환, 독립 만료, 교차 세션 입력·롤백 거부를 확인하는 라우팅 테스트
- 깨끗한 기준선의 생성/수정/삭제/이름 변경, 미추적 파일, 바이너리, 심볼릭 링크, Git 실행 비트 복원과 그 밖의 POSIX 모드 변화 차단에 대한 Git 픽스처
- 기존 스테이징/스테이징되지 않은 변경·미추적 파일, 16 MiB/128 MiB/1 GiB 한도, 저장소 잠금/TOCTOU와 같은 경로 동시 작성자, 브랜치/HEAD 변경, sparse/index flags, 비-Git POSIX 모드, 무시 파일, 하위 모듈, LFS, 루트 밖 변경, 외부 부수 효과에서 롤백 비활성화를 검증하는 음성 픽스처
- 프로젝트 1 GiB 한도에서 종료된 에피소드부터 정리하고 활성·보류 기준선, 대기 패킷 참조, 최신 복구 스냅샷을 보존하는 테스트
- Git 저장소가 아닌 프로젝트에서 1·2·3은 유지하고 4만 `not_a_git_repository`로 비활성화하는 테스트
- 롤백 직전 복구 스냅샷의 생성·실제 재적용과 복원 단계별 실패 주입·수동 복구 테스트
- 인증, 결제, 마이그레이션, 배포, 자격 증명, 파괴적 파일 작업에 대한 안전 픽스처
- `high`·`critical` 작업의 전역 단축키 차단, 펼친 위험 확인, 이후 Codex 네이티브 승인 소유권 분리를 확인하는 테스트
- 포커스를 빼앗지 않음, 동적 1·2/고정 3·4 표시, 2번 비활성, 네이티브 요청 분리, 다중 디스플레이, Spaces, 전체 화면, 단축키 충돌에 대한 macOS 테스트
- Codex `0.148.0` 알파 픽스처와 지원 허용 목록의 모든 CLI 버전에 대한 실제 계약 테스트
- 센티널이 운영 패키지에 포함되지 않고 로컬 MCP만 결정 제안 경로로 사용되는지 확인하는 패키지 검사
