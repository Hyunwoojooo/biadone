# T-007b-C 같은 턴 반복 Hook 검증 보고서

상태: **조건부 완료**

검증일: 2026-08-21

## 결론

한 번의 사람이 제출한 작업 프롬프트 안에서 Blabee 결정 경계가 `1 → 2`로
반복될 수 있음을 두 개의 분리된 게이트로 확인했다.

1. 실제 Codex CLI `0.149.0`과 M0 fake coordinator를 연결한 격리
   픽스처에서 동일한 세션·턴·프롬프트·에피소드 계보로 결정 제안, 대기,
   선택, 연속 진행, 전송 종료가 두 번 실행됐다. 마지막 assistant message는
   `M0_CONTINUED_TWICE`였다.
2. Swift 제품 coordinator 게이트에서 같은 턴 계보의 경계 두 개를
   `boundary_sequence: 1, 2`로 열고, 각 경계의 선택·dispatch·consume·전송
   종료·작업 결과·경계 종료를 총 16개 이벤트로 영속화한 뒤 재시작 후
   재생했다.

두 시험은 실제 Hook의 반복 원시 동작과 제품 상태 의미를 각각 입증한다.
Hook·MCP·Pet을 Swift 제품 coordinator에 연결하는 장기 실행 고수준 adapter,
Unix domain socket ownership, 설치·신뢰·업데이트를 포함한 플러그인 패키징은
T-011 범위다. 따라서 이 결과는 공개 Pet dispatch나 사용자 작업공간 승인이
아니다.

이번 C 스파이크의 반복 한도는 의도적으로 경계 두 개(`1 → 2`)다. M0 fake
coordinator는 `MAX_SAME_TURN_BOUNDARIES = 2`로 세 번째 제안을 거부한다.
무제한 반복이나 공개 제품의 최종 경계 수 정책을 입증한 것이 아니며, T-011은
제품 정책을 명시하고 상한 도달 시 자동 실행 없이 안전하게 종료해야 한다.

## 검증한 반복 순서

```text
사람의 UserPromptSubmit 1회
→ 결정 제안 1
→ Stop 대기 1
→ Pet 선택 1
→ decision:block 연속 진행 1
→ 같은 session/turn/episode에서 결정 제안 2 stage
→ stop_hook_active:true Stop
→ 연속 진행 1 종료를 정확히 한 번 기록
→ Stop 대기 2
→ Pet 선택 2
→ decision:block 연속 진행 2
→ stop_hook_active:true Stop
→ 연속 진행 2 종료를 정확히 한 번 기록
→ 정상 종료
```

두 경계는 `source_turn_id`, `source_prompt_id`, `episode_id`,
`episode_root_prompt_id`, `episode_baseline_checkpoint_id`를 그대로 유지한다.
`decision_boundary_id`는 서로 다르고 `boundary_sequence`만 `1 → 2`로
증가한다. 첫 경계가 terminal 상태가 되기 전에 두 번째 제품 경계를 여는
시도는 `previous_decision_boundary_still_open`으로 거부한다.

## 실제 Codex 관찰

`spikes/m0/integration/run-codex-contract.mjs`의 기본 결정 계약은 이제 두
사이클을 실행한다.

- 실행 CLI: `codex-cli 0.149.0`
- MCP 검색: 프로젝트 `.codex/config.toml`만 사용
- 결정 사이클: 2
- 서로 다른 packet ID: 2개
- 서로 다른 continuation ID: 2개
- 최종 assistant message: `M0_CONTINUED_TWICE`
- 터미널 입력 주입: 없음
- 별도 LLM API 키: 없음
- 설명 전용 음성 계약: 결정 0회, `M0_EXPLAINED`

Codex 공식 문서에서 Stop Hook의 `reason`은 모델에게 새 사용자 프롬프트처럼
작동하는 continuation prompt다. 이는 사람이 새 프롬프트를 제출했거나
`UserPromptSubmit` Hook이 다시 발생했다는 뜻이 아니다. Blabee는 이 둘을
구분하고, 지원 판정한 CLI 버전에서 동일 turn lineage가 유지되는지를 계약
테스트로 확인해야 한다. 참고: [OpenAI Hooks](https://learn.chatgpt.com/docs/hooks#stop)

## 자동 검사

- M0 Hook/coordinator: 55/55 통과
- 반복 Hook 집중 검사: 17/17 통과. 두 번의 대기·선택·dispatch·consume·완료,
  중복 제안 거부, terminal 중복 무효화, 같은 lineage, 연속 경계 순서와 실패
  진단의 원문 token 가림을 검증
- Swift 제품 반복 게이트: 1/1 통과
- 제품 반복 게이트 이벤트: 16개, 재시작 후 동일 순서 재생
- 진단 가림 테스트 추가 직전 전체 `npm test`: 247/247 통과
- 추가 뒤 최신 전체 `npm test`: 248개 중 246개 통과. 실패 2개는 제품
  assertion이 아니라 macOS `/usr/bin/security find-generic-password`가 각각
  30초 동안 응답하지 않은 Keychain 환경 timeout이며, 두 테스트의 독립
  재실행에서도 같은 환경 대기를 재현했다.
- 전체 Swift package: XCTest 5/5 + Swift Testing 57/57, 합계 62/62 통과
- 전체 coordinator persistence: 40/40 통과
- 전 범위 실행 중 발견한 기존 Int64 초과 입력의 NDJSON 응답 상관관계 결함도
  수정했다. 안전한 `request_id`만 오류 응답에 복구하고 unsafe·중복·비밀 ID는
  계속 `unknown`으로 차단한다.

## 버전 판정

- `0.148.0`: 알파 기준은 유지한다. 기존 한 사이클은 검증됐지만 반복 두
  사이클은 현재 설치 바이너리가 없어 미검증이다.
- `0.149.0`: 실제 Hook 두 사이클이 관찰됐다. 이 한 번의 결과만으로 제품
  지원 허용 목록에 추가하지 않는다.
- 범위 비교(`>= 0.148.0`)가 아니라 exact-version capability allowlist를
  사용한다. 통합 계약을 통과하지 못한 버전에서는 Blabee 자동화만
  fail-open으로 비활성화한다.

## 보안 경계

M0는 타당성 검증을 위해 연속 진행 봉투를 Stop `reason`에 넣는다. T-011의
제품 adapter는 원문 `continuation_token`을 모델 입력, Pet 상태, 로그 또는
durable journal에 노출하지 않는다. 장기 실행 adapter가 원문 envelope를
process-local로 보관하고 모델에는 봉인된 작업 본문과 비민감 binding만
전달한 뒤, 후속 Stop에서 adapter가 직접 token을 소비하는 구조를 사용한다.
adapter 재시작으로 token을 잃으면 재발급·자동 재시도하지 않고
`timed_out_unknown`으로 수렴시킨다.

M0 실제 Codex 하네스도 실패 진단을 만들기 전에 coordinator state와 Codex
JSONL 전체에서 `correlation_token`과 `continuation_token`을 구조적으로
가린다. 같은 원문이 다른 문자열 필드에 반복돼도 함께 치환하며, packet과
option 같은 비민감 진단 식별자는 유지한다.

## T-011로 넘기는 작업

- M0 fake coordinator의 Hook/MCP 상태를 Swift 제품 coordinator의
  `execute_command`, `set_foreground`, `route_selection`,
  `route_consume_pet_action`에 연결하는 고수준 adapter
- 첫 action 중 도착한 다음 proposal을 process-local로 stage하고, 후속 활성
  Stop에서 이전 경계를 terminal로 만든 뒤 다음 경계를 open/seal하는 전이
- Stop 입력에는 경계 ID가 없으므로, 다음 경계 dispatch 직후 이전 활성 Stop이
  재전달돼도 다음 전송을 조기 완료하지 않는 phase/idempotency 게이트. 현재
  M0 fake coordinator는 이 재전달을 구분하지 못하므로 작업 성공을 추론하면
  안 된다.
- 단일 daemon/UDS owner lease, 재시작 fail-closed, 다른 Stop Hook과의 결과
  충돌 처리
- exact-version allowlist, Hook 신뢰 검토, 설치·업데이트·제거, `blabee doctor`
- 원문 token 비노출과 reason 크기 제한에 대한 음성 테스트
