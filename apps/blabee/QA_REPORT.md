# Blabee M0 및 T-006 QA 보고서

상태: M0 타당성 범위 조건부 승인, T-006 런타임 독립 계약 통과
검토일: 2026-08-21
대상: `spikes/m0/`, `Contracts/v1/`, `Fixtures/v1/`, `Tests/Contracts/`, Codex CLI `0.148.0`, 설계·상태 문서

## 판정

M0가 목표로 한 **결정 한 번 → 같은 턴 연속 진행 한 번**의 Hook-first 계약은 통과했다. 합성 임시 Git 저장소에서만 허용되는 체크포인트/롤백 스파이크도 지정한 안전 경계 안에서 통과했다.

T-006은 런타임 독립 v1 계약 범위에서 통과했다. 같은 턴의 여러 결정은 `decision_boundary_id`와 `boundary_sequence`로 구분하고, `revision`은 동일 경계 안의 패킷 수정에만 사용한다. 이 판정은 운영 이벤트 저널이나 반복 Pet 상태 머신을 구현했다는 뜻이 아니다.

최종 독립 QA에서 공개 차단급·높음·중간 finding은 없었다. 낮음으로 보고된 중첩 미등록 스키마 탐지 공백도 completeness 검사를 재귀화해 닫았다.

이 판정은 공개 MVP나 실제 사용자 작업공간 롤백 승인이 아니다. 아래 High 항목을 닫기 전에는 제품 롤백을 활성화하면 안 된다.

## 실행 증거

- `npm test`: 155/155 통과
  - T-006 계약 102
  - 기존 M0 체크포인트/롤백 36
  - 기존 M0 Hook/코디네이터 15
  - 기존 M0 런타임 2
- `npm run test:contracts`: 102/102 통과
- Ajv 8 strict/offline 스키마 컴파일: 10/10 통과
- 계약 Fixture: 유효 15, 무효 10, 의미 이벤트 trace 7개
- `npm audit --json`: 알려진 취약점 0건
- 실제 positive contract: 프로젝트 로컬 `.codex/hooks.json`과 `.codex/config.toml`만으로 `emit_decision`, Pet 1번, 같은 턴 연속 진행, 후속 Stop을 거쳐 마지막 JSONL `agent_message = M0_CONTINUED` 확인
- 실제 negative contract: 설명 요청에서 `decision_proposal_received = 0`, `decision_wait_started = 0`, 파일 변경 없음, 마지막 JSONL `agent_message = M0_EXPLAINED` 확인
- Codex plugin validator 통과
- 모든 M0 JavaScript 파일 `node --check` 통과

두 실제 계약 모두 터미널 키 입력 주입과 별도 LLM API 키를 사용하지 않았다. 프로젝트 trust override와 `--dangerously-bypass-hook-trust`는 격리된 테스트 harness에만 사용했다.

## QA 중 수정한 결함

- 한 패킷의 `option_id`와 non-null `action_id` 중복, 기준 체크포인트·활성 롤백 대상 불일치를 의미 검증에서 거부
- 같은 선택의 두 번째 dispatch, continuation 중복 consume, consume 전 transport 완료를 거부
- 같은 결정 경계의 두 번째 형식 보정을 새 ID·토큰으로 우회할 수 없게 함
- 형식 보정 예약·claim을 별도 durable 이벤트로 고정해 journal replay 뒤에도 결정 경계당 1회 제한이 유지되게 함
- durable 이벤트에서 원문 토큰을 거부하고 SHA-256/HMAC-SHA-256 fingerprint 형식만 허용함. 실제 CSPRNG 발급과 constant-time 비교는 T-007 인수 조건으로 남김
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

## 공개 전 차단 조건

### High

1. **실제 저장소 동시성**: canonical repository identity 기준 전역 잠금, 기준선 이중 스냅샷, mutation 직전 재검증, 같은 경로 작성자 provenance가 필요하다. 현재 `projectId` 기반 임시 잠금과 `ownedPaths`만으로는 실제 편집기와의 경쟁을 증명하지 못한다.
2. **복구 스냅샷 재적용**: 현재는 생성·보존만 검증했다. staged Git object의 독립 보존, index/manifest 해시, 원자적 저장, 실제 재적용, 삭제·reset·catalog 단계별 실패 주입을 통과해야 한다.
3. **반복 Pet 루프 런타임**: T-006 계약은 같은 턴의 연속 경계를 `decision_boundary_id`와 `boundary_sequence`로 분리했다. 그러나 M0 코디네이터는 여전히 `session + turn`당 proposal 한 개만 허용하므로 T-007에서 저널·원자적 claim·반복 상태 머신을 구현해야 한다.

### Medium

1. `continuation_completed`는 정확한 후속 Stop을 관찰한 전송 수명 주기 종료이지 작업 성공 판정이 아니다. 성공·실패 outcome과 근거는 별도 이벤트로 모델링해야 한다.
2. 120초는 선택 전 결정 패킷 대기에 적용한다. T-006은 dispatch된 same-turn 작업의 `in_flight_deadline_at`과 timeout 시 결과 `unknown`·자동 재시도 금지 계약을 고정했지만 실제 시계·재시작 복구는 아직 없다.
3. 소켓 `0600` 외에 같은 사용자 프로세스를 구분할 IPC 인증이 없다. 제품에서는 launch secret/capability token, peer 검증, 메서드별 권한 분리가 필요하다.
4. coordinator 상태가 메모리에만 있다. 재시작·절전·resume/compact·장시간 대기와 pending Stop 복구가 필요하다.
5. T-006은 선택 요청을 식별자 전용으로 제한하고 패킷 자체의 의미를 검증하지만, `option_id`를 현재 봉인 패킷에서 조회해 활성 슬롯의 작업만 물질화하는 교차 문서 원자적 resolver는 T-007 책임이다. 비활성·오래된 옵션의 실제 실행 거부는 그 상태 머신에서 다시 검증해야 한다.
6. T-006은 `internal_format_repair_reserved`를 1회 예산의 진실 원본으로 정하고 replay 의미를 검증했다. 실제 journal append의 원자성, CSPRNG 최소 128-bit 토큰 발급, fingerprint 키 관리와 constant-time 비교는 T-007에서 구현·검증해야 한다.

### Low

- C 런타임 후보는 정식 JSON 파서가 아니므로 성능 기준선으로만 사용한다. 프로토콜 동등성 근거가 아니다.

## 그래프 및 검토 한계

codebase-memory Tier 2 확인에서 `apps/blabee` 범위에 기록된 coverage gap은 없었다. 다만 그래프 세대는 2026-08-20이고 수정 문서는 `metadata_changed`, 새 T-006 계약·Fixture·테스트 파일은 `not_tracked`로 보고됐다. 따라서 구현 결론은 최신 소스 직접 읽기, 전체 JSON 파싱과 실행 테스트를 기준으로 했다.
