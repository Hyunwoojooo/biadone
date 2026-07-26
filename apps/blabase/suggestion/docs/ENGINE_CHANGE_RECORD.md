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

## 2026-07-26 Cross-source Phase 0 close and Phase 1 runtime normalization v0.1

- Owner: Codex with human direction
- Goal: GitHub와 Codex를 함께 사용하는 초기 개발자 사용자를 위해
  Phase 0 Attention/evaluation dev contract를 닫고, 현재 connector snapshot을
  재현 가능한 runtime observation으로 변환하는 Phase 1 경계를 구현
- Affected pipeline stages:
  - 신규 Cross-source evaluation contract와 mutable synthetic Dev Dataset
  - source snapshot validation, canonicalization, hashing
  - freshness/completeness assessment
  - GitHub/Codex deterministic normalization
  - source-specific evidence와 runtime WorkSignal integrity
  - ordered native observation window와 Codex native timeline
  - runtime-to-synthetic evaluation mapping
- Behavior before:
  - Cross-source Attention의 runtime snapshot/WorkSignal 계약이 없음
  - connector timeline은 화면 표시용 축약 데이터만 제공
  - 현재 Codex v2의 activity badge와 GitHub query membership을 평가 input으로
    안전하게 옮기는 경계가 없음
- Behavior after:
  - current `github-snapshot-v2`와 `codex-snapshot-v2`만 strict validation
  - 성공 snapshot artifact와 sanitized collection failure를 분리
  - versioned TTL policy와 고정 `asOf`로 freshness를 결정하고 truncation,
    candidate completeness, overview/current-candidate usability를 별도 기록
  - GitHub assigned issue, review request, authored PR, milestone, activity를
    typed observation으로 변환
  - GitHub review의 현재 누락 field인 `isDraft`는 `unknown`으로 보존하고
    authored PR/activity는 overview-only로 제한
  - Codex `active`와 `system_error`를 semantic `unknown`으로 보존하고
    approval/input badge를 request lifecycle로 승격하지 않음
  - opt-in Codex task summary는 `display_only_unknown`으로만 보존
  - stable `signalId`, snapshot별 `observationId`, signal/batch/window SHA-256과
    deterministic output order 제공
  - ordered window는 history sufficiency만 계산하며 progress, stall, failure,
    completion, recovery 또는 request lifecycle을 만들지 않음
  - runtime signal은 explicit mapper 없이는 synthetic evaluation signal로
    사용하지 못함
- Versions before: Cross-source runtime normalization 없음
- Versions after:
  - source snapshot contract: `runtime-source-snapshot-v0.1`
  - collection failure contract:
    `runtime-source-collection-failure-v0.1`
  - snapshot assessment contract: `runtime-snapshot-assessment-v0.1`
  - WorkSignal contract: `runtime-work-signal-v0.1`
  - WorkSignal batch contract: `runtime-work-signal-batch-v0.1`
  - snapshot window contract: `runtime-snapshot-window-v0.1`
  - Codex native timeline:
    `codex-native-observation-timeline-v0.1`
  - snapshot validity policy: `snapshot-validity-policy-v0.1`
  - signal ID policy: `work-signal-id-policy-v0.1`
  - GitHub normalizer: `github-work-signal-normalizer-v0.1`
  - Codex normalizer: `codex-v2-safe-overview-normalizer-v0.1`
  - runtime/evaluation mapper:
    `runtime-to-synthetic-signal-mapping-v0.1`
- Code commit: 미커밋 로컬 작업, base
  `0859e7244acac4092b4c54ee19b6a24ca28270b3`
- Evaluation dataset:
  - family: `suggestion-cross-source`
  - version: `suggestion-cross-source-dev-v0.1`
  - revision: `1`
  - class: mutable Dev Candidate
  - materialized canonical SHA-256:
    `795578a9f907e23ae1e517852292ba69e4d28c21ec50e7d878cd60e8f9e08e21`
  - cases: 30 synthetic, production data 없음
- Candidate run ID: 없음. Phase 1은 selection engine이 아닌 pure
  normalization contract임
- Comparison run ID: 없음
- Commands executed:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - materialized Dev Dataset canonical SHA-256 확인
- Verification:
  - 전체 19 test files, 132 tests 통과
  - Phase 1 targeted 3 test files, 19 tests 통과
  - typecheck, lint, production build 통과
  - `git diff --check` 통과
- Metrics changed:
  - normalization determinism, source semantic boundary, freshness boundary,
    truncation preservation, integrity tampering, ordered history와 privacy
    regression coverage 추가
  - recommendation Acceptable@1이나 detector precision은 아직 측정하지 않음
- Baseline decision:
  - frozen Cross-source Golden과 selection evaluator가 아직 없고 현재 Dev Dataset은
    normalization 이후 경계를 평가하므로 semantic decision baseline은 보류
  - 해제 gate는 reviewed/adjudicated Golden freeze, Phase 2 decision runner,
    동일 frozen input의 candidate/comparison run ID 기록
  - Phase 1 source adapter는 현재 targeted integration fixture와 contract
    tests로 검증
- Regressions or accepted exceptions:
  - 기존 conversation-only `suggestion-engine-v0.3`, connector snapshot
    schema, connector storage, timeline과 API route는 변경하지 않음
  - current GitHub snapshot에 `isDraft`가 없어 review signal은 최종 eligibility
    입력으로 충분하지 않음
  - current Codex snapshot에는 progress/failure/completion/request lifecycle,
    GitHub linkage와 안전한 open destination이 없음
  - local store reader는 missing/invalid/unsupported를 여전히 `null`로
    합치므로 Phase 1 validator는 직접 전달된 current-v2 snapshot과 명시적
    failure만 구분
  - 실제 ordered history persistence는 추가하지 않고 pure window builder만
    구현
- Privacy or retention impact:
  - 새 production persistence 없음
  - raw snapshot artifact는 normalizer 내부 경계이며 batch, issue와 failure에
    credential, raw provider error, local path, raw Codex thread ID를 기록하지 않음
  - GitHub body/code/comment와 Codex raw prompt/response/command/output를
    WorkSignal에 넣지 않음
  - Codex task summary는 기존 명시적 opt-in snapshot에서만 display clue로
    전달
  - synthetic dataset만 Git에 두며 production data 없음
- Release decision:
  - Phase 0 dev contract 종료
  - Phase 1 pure runtime normalization contract 완료
  - product API, Work Cockpit selection 또는 production recommendation에는
    아직 연결하지 않음
- Rollback method:
  - 신규 `src/crossSource/`, 두 connector `toWorkSignals.ts`, evaluation mapper와
    Phase 1 tests를 제거하면 기존 runtime route는 그대로 유지
- Follow-up work:
  - GitHub connector에 native `isDraft` 추가
  - richer Codex observability/history/request lifecycle contract 설계
  - private snapshot history persistence와 read outcome 구분
  - Phase 2 overview/candidate derivation과 coverage-aware decision runner
  - human review/adjudication 후 별도 Golden version freeze

## 2026-07-26 Cross-source Phase 2A aggressive decision vertical slice v0.1

- Owner: Codex with human direction
- Goal:
  - 서비스가 실제로 만드는 추천을 먼저 확인하고 빠르게 수정할 수 있도록
    evidence-backed 후보가 하나라도 있으면 적극적으로 기본 후보 하나를 제안
  - current GitHub와 Codex contract만으로 Work Cockpit overview와 첫
    Attention Router decision을 end-to-end로 생성
- Affected pipeline stages:
  - Cross-source Attention selection policy
  - GitHub WorkSignal candidate derivation
  - Codex current-contract overview projection
  - coverage-aware suggested/no-action/insufficient-evidence resolution
  - deterministic ranking, result ID/hash integrity
  - mutable synthetic Dev Dataset tie label
- Behavior before:
  - Phase 1은 runtime WorkSignal을 만들지만 product decision을 생성하지 않음
  - 동등한 eligible 후보는 `needs_clarification` label
  - current GitHub review request는 draft unknown으로 candidate decision 없음
- Behavior after:
  - fresh assigned issue는 minimum score나 weekly outcome 없이 `do` 후보
  - native milestone이 overdue 또는 versioned 48시간 window 안이면
    `must_now`
  - draft unknown review request는 `review`로 추정하지 않고 safe destination이
    있을 때 provisional `inspect`로 상태 확인 제안
  - current Codex `active`, `system_error`, approval/input badge와 task summary는
    Work Cockpit overview-only
  - 동급 후보도 source update time과 stable ID로 결정적인 default를 고르고
    caveat와 최대 두 alternatives를 반환
  - truncated source의 확인된 positive candidate는 provisional suggestion
  - scoped `no_action`은 fresh complete GitHub negative coverage에서만 허용
  - stale/invalid/unsafe 또는 candidate 없는 partial scope는
    `insufficient_evidence`
- Versions before:
  - Attention definition:
    `cross-source-attention-definition-v0.1`
  - Phase 2 decision input/result/policy: 없음
  - Dev Dataset revision: `1`
- Versions after:
  - Attention definition:
    `cross-source-attention-definition-v0.2`
  - input contract: `github-codex-attention-input-v0.1`
  - result contract: `github-codex-attention-result-v0.1`
  - policy: `aggressive-evidence-bound-attention-policy-v0.1`
  - GitHub candidate rule: `github-direct-candidate-rule-v0.1`
  - Codex overview rule: `codex-current-overview-rule-v0.1`
  - result ID policy: `github-codex-attention-result-id-v0.1`
  - future retention contract: `codex-metadata-retention-30d-v0.1`
  - Dev Dataset revision: `2`
- Code commit: 미커밋 로컬 작업, base
  `0859e7244acac4092b4c54ee19b6a24ca28270b3`
- Evaluation dataset:
  - family/version: `suggestion-cross-source-dev-v0.1`
  - class: mutable Dev Candidate, synthetic only
  - revision 1 materialized SHA-256:
    `795578a9f907e23ae1e517852292ba69e4d28c21ec50e7d878cd60e8f9e08e21`
  - revision 2 materialized SHA-256:
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - material change:
    `AD-DEV-DS-002`를 preference tie clarification에서 aggressive default
    suggestion으로 변경
  - revision 2 distribution:
    suggested 12, needs_clarification 0, no_action 10,
    insufficient_evidence 8
- Candidate run ID: 없음. formal synthetic decision evaluator가 아직 없으며
  targeted runtime acceptance tests로 현재 contract를 검증
- Comparison run ID: 없음
- Commands executed:
  - `npm run cross-source:dev-hash`
  - `npm test -- --run tests/phase2AttentionRouter.test.ts`
  - `npm test -- --run tests/phase2AttentionRouter.test.ts tests/crossSourceDatasetSchema.test.ts tests/workSignalNormalization.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- Verification:
  - 전체 20 test files, 140 tests 통과
  - Phase 2A targeted test 1 file, 8 tests 통과
  - Phase 1/2와 dataset targeted 3 files, 44 tests 통과
  - typecheck, lint, production build 통과
  - Dev Dataset revision 2 canonical SHA-256 재현 확인
  - `git diff --check` 통과
- Metrics changed:
  - Phase 2A runtime acceptance 8 tests 추가
  - assigned/review/deadline/weekly focus/tie/Codex overview/invalid
    source/coverage/integrity contract regression coverage 추가
  - Acceptable@1, candidate precision/recall과 human preference agreement는
    아직 측정하지 않음
- Baseline decision:
  - mutable Dev Dataset은 expected rich synthetic signal에서 current runtime
    batch를 생성하는 formal runner가 아직 없어 full decision metric baseline을
    주장하지 않음
  - targeted tests는 실제 Phase 1 normalizer batch를 Phase 2A runner에 넣어
    behavior regression을 검증
  - 해제 gate는 reviewed/adjudicated Golden freeze, synthetic-to-runtime
    replay adapter 또는 동등한 decision evaluator, 동일 frozen input의
    candidate/comparison run ID 기록
- Regressions or accepted exceptions:
  - 사용자의 적극 추천 결정에 따라 preference-only 동점은 clarification으로
    보류하지 않음
  - 현재 review에는 `isDraft`가 없어 confirmed `review` 대신 provisional
    `inspect`만 제공
  - weekly outcome은 explicit project mapping 전까지 같은 lane의 결정적인
    token overlap 보조 신호일 뿐 eligibility나 lane을 만들지 않음
  - current Codex contract에는 progress/failure/completion/request lifecycle와
    safe destination이 없어 exception candidate를 만들지 않음
  - 제품 API, UI와 기존 conversation-only suggestion engine은 변경하지 않음
- Privacy or retention impact:
  - source action은 read-only이며 외부 write/approval/merge를 수행하지 않음
  - 새 persistence 없음
  - 결과는 사용자 화면용 GitHub title, safe native URL과 opt-in Codex
    task summary를 포함할 수 있음
  - weekly outcome 원문은 result에 복사하지 않고 active/match 상태만 표시
  - error와 integrity failure는 raw provider detail, title, URL, token,
    local path를 echo하지 않음
  - future Codex history store 정책은 metadata 최대 30일, raw
    prompt/response/command/output retention `none`; 현재 구현에는 store 없음
- Release decision:
  - Phase 2A pure decision runner와 contract test 완료
  - product default, API 또는 Work Cockpit route에는 아직 연결하지 않음
  - Phase 2B connector evidence 전에는 confirmed review와 Codex exception을
    release하지 않음
- Rollback method:
  - `attentionSchema.ts`, `runAttentionRouter.ts`, Phase 2 test와 contract
    문서를 제거하고 definition v0.1/Dev Dataset revision 1 label로 되돌리면
    Phase 1 runtime behavior는 유지됨
- Follow-up work:
  - GitHub connector native `isDraft`와 confirmed review contract
  - Codex metadata history store에 실제 30일 retention/delete 적용
  - richer Codex phase/progress/failure/completion/request lifecycle
  - explicit project/workflow/GitHub relation
  - synthetic decision evaluator와 reviewed Golden candidate
  - 제품 API와 Work Cockpit presentation 연결
