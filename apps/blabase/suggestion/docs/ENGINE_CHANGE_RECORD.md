# Engine Change Record

- Date: 2026-07-24
- Owner: Codex with human direction
- Goal: 최소 3개의 동일 사용자 ChatGPT 공유 대화로부터 가장 먼저 처리할 task 한 개를 제안하는 독립 로컬 MVP 구현
- Affected pipeline stages: 신규 URL batch validation, conversation restoration, task candidate prompt, evidence verification, cross-conversation merge, priority scoring, result selection
- Behavior before: 제안 엔진과 다중 URL 입력 화면이 존재하지 않음
- Behavior after: 3~10개 URL을 받아 복원·LLM 분석에 각각 3개 이상 성공했을 때만 검증된 top suggestion 또는 보류 결과 반환
- Versions before: 없음
- Versions after:
  - engine: `suggestion-engine-v0.1`
  - schema: `suggestion-schema-v0.1`
  - prompt: `task-candidate-prompt-v0.1`
  - verifier: `task-evidence-verifier-v0.1`
  - scoring: `priority-score-v0.1`
- Code commit: 미커밋 로컬 작업
- Evaluation dataset version and SHA-256: 아직 생성하지 않음
- Candidate run ID: 실제 사용자 URL 실행 전이므로 없음
- Comparison run ID: 없음
- Commands executed:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - 상위 blabase `npm run typecheck`
  - 상위 blabase `npm run lint`
- Metrics changed: 신규 테스트 16개 통과; 실제 제안 품질 baseline은 아직 없음
- Regressions or accepted exceptions: 기존 `src/`와 기존 Golden Dataset은 변경하지 않음. 대화 간 task 병합은 v0에서 정규화된 canonical key의 정확 일치를 사용함
- Privacy or retention impact: 요청 수명 동안 대화 원문을 메모리에서 처리하며 원본 URL과 전체 대화를 응답·Git·기존 analysis store에 저장하지 않음
- Release decision: 로컬 프로토타입 전용. 운영 기본값 또는 도메인에 배포하지 않음
- Rollback method: 독립 `suggestion/` 디렉터리를 실행하지 않으면 기존 blabase 동작에 영향 없음
- Follow-up work:
  - 합성된 3개 이상 대화 묶음 평가셋과 사람 라벨 작성
  - 실제 provider별 structured output 호환성 확인
  - 대화 간 task identity resolver 정밀화
  - 최종 문구 합성 guardrail 확대

## 2026-07-24 v0.2 compatibility correction

- Goal: Gemini Interactions API가 거부한 과도하게 복잡한 candidate schema를 호환 가능하고 보수적인 task signal schema로 교체
- Behavior before: LLM이 priority 관련 문구, ISO deadline, impact, effort, confidence까지 생성했으며 Gemini가 schema 요청을 HTTP 400으로 거부
- Behavior after: LLM은 title, target, deliverable, owner, state, origin, raw deadline, consequence, evidence만 반환하며 key, span, confidence, deadline 해석, priority 이유와 첫 단계는 코드가 생성
- Versions after:
  - engine: `suggestion-engine-v0.2`
  - schema: `suggestion-schema-v0.2`
  - prompt: `task-candidate-prompt-v0.2`
  - verifier: `task-evidence-verifier-v0.2`
  - scoring: `priority-score-v0.2`
- Provider health check: Gemini 기본 요청, JSON response format, generation config, 전체 task signal schema, Zod validation 통과
- Privacy impact: synthetic empty-task health check만 외부 provider에 전송. 사용자 대화나 URL을 진단 출력에 포함하지 않음
- Evaluation: 단위·파이프라인 테스트 17개 통과. 실제 3-URL 품질 평가는 사용자 재실행 필요

## 2026-07-24 v0.3 top-eligible selection

- Goal: 제안 품질을 빠르게 확인하는 MVP에서 임의의 최소 점수와 동점 보류 때문에 유효한 task가 숨겨지는 문제 제거
- Behavior before: eligible 후보가 있어도 최고 점수가 50 미만이거나 상위 점수 차가 작으면 제안을 보류
- Behavior after: evidence와 상태 안전 gate를 통과한 eligible 후보가 하나라도 있으면 점수순 1위를 항상 제안하고 나머지는 alternatives로 표시
- Preserved gates: 완료, 취소, 대체, AI 전담, assistant-only, evidence 불일치, review-required 후보는 top suggestion 대상이 아님
- Versions after:
  - engine: `suggestion-engine-v0.3`
  - scoring/selection: `priority-score-v0.3`
- Rollback: `selectSuggestion`의 minimum score와 tie clarification gate 복원
