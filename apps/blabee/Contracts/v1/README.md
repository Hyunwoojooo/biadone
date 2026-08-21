# Blabee 계약 v1

이 디렉터리는 Codex, 로컬 코디네이터, Pet이 주고받는 런타임 독립 JSON 계약이다. 모든 최상위 메시지는 `schema_version: "1.0"`으로 고정하며, `common`과 `action`은 메시지 안에서 참조하는 공용 정의다. 모든 객체는 알 수 없는 필드를 거부한다.

## 경계와 선택

`decision_boundary_id`와 `boundary_sequence`는 같은 Codex 턴에서 이어지는 여러 결정 경계를 구분한다. `revision`은 한 경계 안에서 봉인된 패킷의 리비전이므로 경계 순서와 다른 개념이다. 패킷, 선택, 연속 진행 봉투, 결정 런타임 이벤트는 프로젝트·세션·턴·프롬프트·에피소드·결정 경계 바인딩을 모두 가진다.

같은 `project_id`·`session_id`·`source_turn_id`에서 이어지는 경계는 `source_prompt_id`, `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`를 바꿀 수 없다. 사람이 새 프롬프트를 제출해 새 턴을 만들 때만 새 에피소드와 기준선을 시작한다.

한 경계의 첫 패킷은 `revision: 1`이다. 선택 전 갱신은 같은 `interaction_id`와 `packet_id`에서 리비전을 정확히 1씩 올릴 때만 가능하다. 선택, 만료, 경계 종료 뒤에는 패킷을 다시 봉인할 수 없고 선택은 항상 최신 리비전을 가리켜야 한다.

선택 요청은 식별자와 `boundary_sequence`·`revision`만 운반한다. 슬롯 번호, `action_id`, 토큰, 작업 본문은 Pet이 제출할 수 없다. 코디네이터가 봉인된 패킷에서 선택 의미를 다시 읽어야 한다.

T-006은 이 문서 형태와 패킷 내부 의미를 고정한다. T-007a 참조 코어와 T-007b-B1 Swift application은 선택의 `option_id`가 현재·미만료 패킷의 활성 슬롯인지 원자적으로 조회하고 그 슬롯의 봉인된 작업만 물질화하는 resolver 의미를 구현했다. T-007b-C는 M0 실제 Hook 반복과 Swift 제품 상태 반복을 분리된 게이트로 검증했다. 실제 Hook→Swift 운영 연결은 T-011이 구현한다.

v1 JSON Schema의 `identifier` 정의는 문자열 형태와 길이만 고정한다. 코디네이터 의미 계층에서 새로 생성·저장하는 식별자는 NFC 정규형이어야 하고, 이미 저장된 식별자를 가리키는 값은 UTF-8 바이트가 정확히 같아야 한다. 이는 Swift `String`의 canonical-equivalence 비교가 서로 다른 wire ID를 같은 키로 취급하지 못하게 하는 의미 불변식이며, 고정된 v1 스키마 해시를 변경하지 않는다.

결정 패킷은 네 슬롯을 정확히 이 순서로 가진다.

1. 동적 권장 작업
2. 동적 대안 작업 또는 안정적인 사유 코드가 있는 비활성 슬롯
3. 보류
4. 롤백 또는 안정적인 사유 코드가 있는 비활성 슬롯

비활성 슬롯은 `action_id: null`이고 실행 본문을 가질 수 없다. 활성 슬롯은 `disabled_reason: null`이다.

한 패킷 안의 `option_id`는 네 슬롯에서 모두 유일해야 하고, `null`이 아닌 `action_id`도 서로 달라야 한다. JSON Schema만으로 이 교차 항목 유일성을 표현하지 않으므로 계약 의미 테스트와 이후 코디네이터의 원자적 검증에서 강제한다.

## 전달 완료와 작업 결과

`continuation_transport_completed`는 봉투가 같은 턴 Stop 경로에서 소비되어 전달 수명 주기가 끝났다는 뜻일 뿐, 선택한 작업이 성공했다는 뜻이 아니다. 실제 결과는 별도 `work_outcome_recorded` 이벤트로 기록한다.

`continuation_transport_timed_out_unknown`은 작업 결과가 `unknown`이라는 뜻이다. 취소나 실패를 추론하지 않으며 `automatic_retry`는 항상 `false`다. 중복 실행 위험 때문에 자동 재시도하지 않는다.

`pet_action`은 `dispatch_mode: "same_turn_stop"`만 허용한다. `internal_format_repair`는 `dispatch_mode: "submitted_envelope"`만 허용하며 같은 결정 경계에서 `repair_attempt = max_repair_attempts = 1`이다. 두 봉투의 필드는 서로 섞을 수 없다.

두 모드 모두 전체 바인딩과 만료 시각이 정확히 일치할 때만 한 번 claim할 수 있다. `continuation_id`와 token fingerprint는 Pet 작업과 형식 보정을 합친 저널 전체에서 재사용할 수 없다. `internal_format_repair`는 새 ID와 토큰을 발급하더라도 같은 결정 경계에서 두 번째로 claim할 수 없다. Pet dispatch는 `issued_at < expires_at <= in_flight_deadline_at` 순서를 지켜야 하며 deadline 전에는 timeout으로 기록할 수 없다. 형식 보정의 예약·claim 이벤트는 각각 `issued_at <= occurred_at < expires_at` 범위 안에 있어야 한다.

형식 보정은 일반 Pet `continuation_dispatched`를 재사용하지 않는다. 발급 시 `internal_format_repair_reserved`를 원자적으로 durable journal에 추가하고, 이 이벤트 하나만 해당 결정 경계의 1회 보정 예산을 소비했다는 진실 원본으로 취급한다. 토큰과 전체 봉투 바인딩 검증이 끝난 뒤에는 `internal_format_repair_claimed`를 정확히 한 번 추가한다. T-007 reducer는 두 이벤트의 최상위 프로젝트·세션·턴·프롬프트·에피소드·결정 경계 바인딩과 payload의 `continuation_id`, `repair_request_id`, `parent_prompt_id`, 시도 제한, 전달 모드, 발급·만료 시각을 재생해 재시작 뒤에도 예약·claim 상태를 복구해야 한다. `parent_prompt_id`는 이벤트 최상위 `source_prompt_id`와 정확히 일치해야 한다.

원문 continuation/correlation token은 어떤 durable event에도 기록하지 않는다. 발급자는 CSPRNG로 최소 128-bit 엔트로피의 토큰을 만들고 journal에는 `sha256:<64 lowercase hex>` 또는 `hmac-sha256:<64 lowercase hex>` 형태의 `correlation_token_fingerprint`만 남긴다. 검증 비교는 constant-time으로 수행해야 한다. T-007a 참조 코어는 생성·fingerprint·비교 의미를 구현했으며, 제품 키 보관·회전과 영속 sidecar 인증은 T-007b 책임이다.

## M1 롤백 정책

현재 M1 계약·픽스처 빌드에서는 실제 사용자 저장소 롤백을 연결하지 않는다. 슬롯 4와 에피소드·재개 캡슐의 롤백 정책은 `enabled: false`, `disabled_reason: "rollback_not_enabled_in_build"`로 발행해야 한다. 스키마가 미래의 활성 롤백 형태를 표현할 수 있더라도 M1 구현에서 활성화할 수 있다는 뜻은 아니다.

## 오프라인 로딩

`manifest.json`의 모든 파일을 읽고, `date-time`에 [`Tests/Contracts/rfc3339.mjs`](../../Tests/Contracts/rfc3339.mjs)와 동등한 실제 달력 검증기를 등록한 Ajv 8 인스턴스에 각 스키마를 `addSchema`하면 외부 네트워크 없이 절대 `$id` 참조를 해석할 수 있다. 형식 검증 없이 strict compile을 시도하거나 `date-time`을 무시해서는 안 된다. 매니페스트의 `id`는 각 파일의 `$id`와 정확히 같아야 한다.

`timestamp`는 실제 달력 날짜와 1~9자리 소수초를 확인하는 RFC 3339 `date-time` 형식이다. 계약 테스트는 Ajv에 오프라인 형식 검증기를 등록해 존재하지 않는 날짜와 잘못된 시각·오프셋을 거부하고, 시간 순서는 exact epoch-nanosecond `BigInt`로 비교해 소수초를 잘라내지 않는다.

JSON Schema만으로 서로 다른 문서의 값 동일성, 시간 순서, 이벤트 순서 단조 증가, 패킷 안 ID 유일성, ID 일회성, 패킷 체크포인트와 롤백 대상의 동일성을 모두 표현할 수는 없다. 이 불변 조건은 계약 테스트와 이후 코디네이터의 원자적 상태 전이에서 추가로 검증한다.

의미 검증기는 JSON Schema를 대신하지 않는다. 모든 소비자는 strict Ajv 스키마 검증을 먼저 통과한 값만 의미 검증기와 reducer에 전달해야 하며, 이 순서를 강제하는 운영 통합 테스트는 T-007에서 추가한다.
