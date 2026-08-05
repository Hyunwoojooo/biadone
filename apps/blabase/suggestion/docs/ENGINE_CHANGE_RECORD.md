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

## 2026-07-26 Cross-source Work Cockpit and Attention monitor vertical slice v0.1

- Owner: Codex with human direction
- Goal:
  - Phase 2A pure runner의 실제 결과를 사용자가 기본 화면에서 확인
  - 추천이 없을 때도 평가 범위와 Codex 실행 현황을 보여주고, 실행별
    source health, 후보 gate, version/hash와 명시적 피드백을 모니터링
- Affected pipeline stages:
  - current GitHub/Codex snapshot orchestration과 live freshness gate
  - GitHub candidate scope gate
  - Phase 2A runtime result resolution의 local-only API 연결
  - metadata-only run/feedback persistence와 retention
  - Work Cockpit, Attention Lab presentation
  - GitHub connector local-store concurrency guard
- Behavior before:
  - Phase 2A runner는 pure function과 targeted test에서만 확인 가능
  - 제품 route와 UI에서 현재 Attention 결과를 볼 수 없음
  - run history, 후보별 sanitized gate, explicit feedback 기록이 없음
  - GitHub token/snapshot만 있고 repository scope가 비어도 live adapter가
    complete negative coverage를 주장할 수 있음
  - GitHub refresh 완료가 disconnect 뒤 snapshot/token을 복원하거나 더 오래된
    snapshot이 최신 파일을 덮을 수 있음
- Behavior after:
  - `GET /api/attention`은 저장된 snapshot을 현재 시각으로 평가하는
    side-effect-free preview
  - same-origin `POST /api/attention`만 GitHub/Codex refresh와 run persistence
    수행
  - GitHub 30분, Codex 5분, future skew 1분의 versioned live freshness policy
  - active installation과 non-archived repository scope가 없으면
    `no_action` 대신 candidate source unavailable/`insufficient_evidence`
  - Work Cockpit에서 top suggestion 또는 scoped no-action/insufficient result,
    source health, 미평가 Notion/Calendar, Codex overview 표시
  - Attention Lab에서 30일 run history, candidate funnel/assessment gate,
    reason/caveat, source coverage, latency, version/hash/commit과 feedback 확인
  - 동일 feedback은 idempotent하고 변경 feedback은 이전 event를 참조하는
    correction으로 append
  - 30일 cutoff가 API 응답뿐 아니라 private monitor file에도 반영되고
    atomic write 실패 시 temporary file 정리
  - GitHub store generation/mutation serialization과 monotonic snapshot write로
    disconnect resurrection과 out-of-order overwrite 차단
- Versions before:
  - local Attention orchestrator/API/monitor/UI: 없음
  - Phase 2A input/result/policy/rule: v0.1 유지
- Versions after:
  - live orchestrator: `attention-live-orchestrator-v0.1`
  - live freshness policy: `attention-live-freshness-policy-v0.1`
  - monitor run/store: `attention-monitor-run-v0.1`,
    `attention-monitor-store-v0.1`
  - explicit feedback: `attention-explicit-feedback-v0.1`
  - Phase 2A input/result/policy/rule와 Definition ID는 변경 없음
- Code commit:
  - current worktree는 미커밋
  - base commit:
    `66f2aaca40675f44cf32ba755988d15aa3f545fe`
  - local run은 repository HEAD를 기록하지만 dirty/untracked patch 자체는
    보존하지 않으므로 commit 전 run은 exact code replay가 불완전함
- Evaluation dataset:
  - family/version: `suggestion-cross-source-dev-v0.1`
  - revision: `2`, mutable Dev Candidate, synthetic only
  - materialized canonical SHA-256:
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - dataset label과 frozen input은 변경하지 않음
- Candidate run ID:
  - 실제 연결된 private local source로 smoke run을 기록
  - local run ID와 source content는 Git에 기록하지 않음
- Comparison run ID: 없음
- Commands executed:
  - `npm test -- --run tests/liveAttention.test.ts tests/attentionMonitorStore.test.ts tests/attentionRoutes.test.ts tests/phase2AttentionRouter.test.ts`
  - `npm test -- --run tests/githubConnector.test.ts tests/githubRoutes.test.ts tests/liveAttention.test.ts tests/attentionMonitorStore.test.ts tests/attentionRoutes.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - local same-origin `POST /api/attention` redacted smoke check
  - local `/api/attention/history` redacted persistence check
  - `git diff --check`
- Verification:
  - targeted live/API/store/GitHub concurrency tests 통과
  - 전체 23 test files, 159 tests, typecheck, lint, production build 통과
  - 실제 refresh run에서 GitHub/Codex fresh, source errors 없음,
    metadata history 기록과 candidate assessment detail 확인
  - GET preview 전후 history run count가 같음을 확인
  - Chrome extension의 localhost 자동 제어 정책 때문에 screenshot 기반
    visual QA는 수행하지 못했고, component accessibility audit와 API smoke,
    build output으로 검증
- Metrics changed:
  - monitor history에 decision/source/candidate/latency/version/error와 current
    explicit feedback count를 추가
  - 실제 smoke result는 `no_action`, Codex overview 9개, GitHub assessment
    1개였으며 private title/URL/task summary는 기록하거나 보고하지 않음
  - Acceptable@1, false-negative rate, human preference agreement는 아직 없음
- Baseline decision:
  - pure Phase 2A ranking/result contract와 synthetic Dev Dataset label은
    변경하지 않음
  - live source freshness/scope gate와 product orchestration은 targeted
    regression 및 실제 redacted smoke로 검증
  - reviewed/adjudicated frozen Cross-source Golden과 formal decision evaluator가
    아직 없어 Golden baseline은 보류
  - UI-only layout 변경은 engine input/output/filter/order/interpretation을
    변경하지 않으므로 별도 baseline 대상이 아님
- Regressions or accepted exceptions:
  - current Codex v2는 progress/failure/completion/request lifecycle과 safe
    destination을 제공하지 않아 overview-only
  - orchestrator 자체가 예외로 중단된 failed run은 현재 history에 남지 않고
    current API error로만 표시됨
  - local store는 metadata-only이므로 source snapshot hash를 확인할 수 있지만
    과거 private input payload를 exact replay하지는 못함
  - local snapshot reader는 missing/invalid/unsupported를 일부
    `COLLECTION_FAILED`로 합치며 세분화는 후속 read-outcome contract 필요
  - persisted contract의 미래 major version migration은 별도 historical schema
    union이 필요함. 이번 additive assessment/feedback 필드는 default migration
    처리
- Privacy or retention impact:
  - `.local/attention/monitor.json`만 사용하고 Git에서 제외
  - directory 0700, file 0600, atomic rename, 30일 cutoff, run/feedback hard cap
  - history에 title, URL, task summary, GitHub body/code/comment, Codex raw
    prompt/response/command/output, credential, private path 없음
  - 사용자 화면의 current result만 권한 범위 title/safe URL/opt-in summary를
    표시할 수 있음
  - explicit feedback은 `candidate` review state이며 자동 Gold가 아님
- Release decision:
  - private connector와 local store를 사용하는 개발용
    `http://127.0.0.1:3102` vertical slice
  - production/domain deployment는 하지 않음
  - richer Codex evidence 전에는 Codex exception candidate를 release하지 않음
- Rollback method:
  - `/api/attention`, Work Cockpit/Attention Lab과 `src/attention` 연결을 제거하면
    Phase 2A pure runner와 기존 conversation-only route는 유지
  - GitHub generation guard는 이전 local-store write/delete 구현으로 독립
    rollback 가능
- Follow-up work:
  - failed orchestrator run의 sanitized metadata 기록
  - private immutable replay input 또는 clean committed release에서 exact replay
    보장
  - connector local read outcome의 missing/parse/unsupported taxonomy 분리
  - historical store schema union/migration
  - screenshot과 실제 키보드/mobile visual QA
  - human review, Golden candidate freeze와 formal decision evaluator

## 2026-07-28 Phase 2A.1 Data Pipeline Stabilization v0.3

- Date: 2026-07-28
- Owner: Codex with human direction
- Goal:
  - 알고리즘 가중치 튜닝 전에 GitHub, Codex, Notion, Google Calendar의 수집,
    저장, 실패 복구와 화면 전파를 하나의 재현 가능한 서버 파이프라인으로
    안정화
  - 주간 최우선 결과와 명시적인 project identity를 실제 Attention input에
    연결하되, 현재 source가 증명하지 못하는 task 또는 Codex 실행 상태를
    만들지 않음
- Affected pipeline stages:
  - server-side source scheduling과 single-flight coordination
  - source별 sync attempt, retry/backoff와 snapshot revision 관리
  - latest sync state와 ordered sanitized attempt history persistence
  - Codex inventory/event-stream observation contract와 metadata history
  - explicit project identity mapping과 weekly outcome resolution
  - GitHub/Codex WorkSignal normalization
  - Calendar/Notion supporting-source adaptation
  - Cross-source Attention input, coverage, ranking context와 Work Cockpit output
  - browser polling, invalidation, connector disconnect와 UI propagation
- Behavior before:
  - connector별 화면 또는 Attention 요청이 독립적으로 refresh해 서버 전체의
    마지막 시도, 성공, 실패와 재시도 상태를 일관되게 관찰할 수 없음
  - connector store는 current snapshot 위주였고 source 전체의 ordered sync
    attempt history와 공통 revision이 없음
  - Work Cockpit과 Attention Lab은 snapshot이 바뀌어도 자동 갱신되지 않음
  - `thread/list`의 Codex inventory 상태를 실행 관찰과 구분하는 명시적 계약이
    없고 `not_loaded`가 실제 실행 정지처럼 읽힐 수 있음
  - GitHub/Codex `projectId`는 항상 `null`이고 Notion/Calendar와 함께 해석할
    project registry가 없음
  - weekly outcome과 Notion/Calendar snapshot은 live Attention input에
    연결되지 않음
- Behavior after:
  - 서버 `SourceSyncCoordinator`가 네 source의 scheduler, single-flight,
    성공 후 다음 실행과 지수 backoff를 관리하고 `/api/sync`와
    `/api/attention`, connector connect/callback과
    `evaluateCurrentAttention({refreshSources:true})`의 모든 명시적 snapshot
    수집을 같은 coordinator로 통과시킴
  - `GET /api/sync/status`와 `GET /api/attention`은 저장 상태만 읽으며
    scheduler를 시작하지 않음. visible UI가 same-origin
    `POST /api/sync/start`를 호출해 background scheduler를 명시적으로
    시작함. start 응답은 외부 source 수집 완료를 기다리지 않고 due timer를
    arm한 직후 반환함
  - source별 latest attempt/success/failure, retry count, next retry,
    sanitized error code와 latest snapshot revision/hash/count를 기록
  - `.local/sync/latest.json`과 newest-first
    `.local/sync/history.json`을 분리하고 history를 bounded append-only attempt
    audit로 유지
  - normal sync commit은 strict `source-sync-settlement-v1`에 exact
    latest/history target과 해당 attempt를 먼저 기록한 뒤 두 projection을
    적용함. history 적용 뒤 latest 전에 실패하면 같은 process에서 즉시
    idempotent replay와 exact read-back으로 성공을 확정하고, 복구도 실패하면
    `.local/sync/settlements.json`을 남겨 다음 read/mutation 또는 재시작이
    adapter 실행 전에 그대로 재생함. history만 보고 상태를 추정하거나 새
    attempt를 만들지 않음
  - pending settlement를 다음 source commit이 same-process에서 복구한 경우,
    복구된 disk latest를 authoritative base로 삼고 새 attempt source 하나만
    병합한 store를 저장·coordinator에 반환함. 따라서 stale coordinator
    caller가 복구된 다른 source를 덮어쓰지 않음. pending settlement가 없던
    정상 commit은 caller의 전체 latest를 유지해 adapter-registration
    normalization을 보존함. journal apply 전에는 transition 중이 아닌 source의
    retained history와 latest `lastAttempt`가 모순되지 않는지 교차검증함
  - `beginTransition`/`updateTransition`도 journal을 실제 복구한 경우에만
    authoritative latest를 coordinator로 넘기고, `completeTransition`은 그
    base에 transition source target만 병합한 persisted latest를 반환함.
    따라서 source A settlement 직후 source B reset/disconnect도 A를
    덮어쓰지 않으며 no-recovery transition의 caller normalization은 유지됨
  - coordinator는 sync 실행과 reset/disconnect intent 준비 전에 pending
    settlement recovery를 선택적으로 수행함. 같은 source disconnect도
    recovered `previous`에서 retry count, `lastSuccess`와 disconnect attempt를
    계산하므로 방금 복구한 성공 lineage를 stale target으로 지우지 않음
  - sync는 same-source transition/pending/in-flight 경계를 먼저 처리하고
    adapter 미등록 source는 즉시 skip함. 실제 등록 adapter는 unrelated
    transition이 진행 중이어도 global settlement queue에서 recovery를
    무조건 확인한 뒤 current/due/previous를 읽고 실행하므로 stale context로
    먼저 출발하지 않음
  - source별 reset/disconnect 전에 `.local/sync/transitions.json`에 strict
    `source-sync-transition-v1` intent, target state, retry 시각과 동일
    disconnect attempt를 먼저 저장함. finalization이 실패하거나 process가
    재시작돼도 intent를 adapter보다 먼저 idempotent replay하고, 다른 source
    commit은 pending target/intent를 보존함
  - atomic file replacement의 rename 뒤 chmod acknowledgement가 실패해도
    target 내용과 0600 mode를 read-back 검증해 이미 완료된 transition clear를
    성공으로 확정함. 따라서 disk intent가 사라진 뒤 coordinator만 pending을
    유지하며 `STORE_READ_FAILED`를 반복하는 상태를 만들지 않음
  - `/api/sync/status`의 pipeline revision을 visible-page polling으로
    확인하고 source snapshot revision/hash 또는 disconnect 상태가 바뀌면
    connector, Work Cockpit, Attention Lab과 timeline을 invalidation해
    저장본을 다시 읽음
  - 첫 status response에도 저장된 snapshot revision이 있으면 UI consumer를
    invalidation하고, polling stop/start가 in-flight request와 겹쳐도 새
    generation의 polling을 재개함
  - `CONNECTOR_DISCONNECTED`, `REAUTHORIZATION_REQUIRED`와 명시적인
    refresh-token 부재·만료는 persisted `disabled`와 `nextDueAt=null`로
    기록해 scheduled retry를 중단하고, reconnect 뒤 manual sync가 성공하면
    `ready`로 복구함
  - GitHub/Calendar/Notion provider HTTP 요청은 요청당 15초 상한을 적용함.
    disconnect는 local generation 증가와 token/snapshot 삭제를 먼저 확정하고
    remote revoke는 2초 bounded best-effort로 수행함
  - GitHub, Calendar와 Notion store의 reconnect/disconnect는 credential
    교체 전에 generation을 증가시키고 serialized mutation 안에서 이전
    snapshot을 제거해 이전 계정의 in-flight collection이 새 연결 아래
    token/snapshot을 되살리지 못하게 함
  - 네 connector store는 strict atomic-temp basename만 startup/read에서
    5분 grace와 active-write guard 뒤 정리함. explicit disconnect는 generation
    변경과 serialized local deletion 안에서 recognized inactive token/config/
    snapshot/observation temp를 age와 무관하게 제거하고 unrelated file,
    directory와 symlink는 보존함
  - OAuth replacement는 해당 source의 이전 connection lineage를
    latest/history에서 제거하고 다른 source history는 보존함. durable lineage
    purge가 성공하기 전에는 replacement credential을 저장하지 않음. purge
    저장이 일시적으로 실패하면 기존 credential을 유지하고 durable transition
    intent와 clean target/retry schedule을 남긴 채 adapter 실행 전에 bounded
    backoff로 purge를 재시도해 failure+other-source commit+restart에서도
    old/new 계정 기록을 섞지 않음
  - Codex scope 또는 content contract가 바뀌어도 같은 connection-generation
    reset을 새 config 저장 전에 적용하고, scope가 바뀌면 이전 snapshot과
    inventory observation history를 제거함
  - connection-generation/disconnect persistence 동안 source transition
    barrier와 source별 mutex가 concurrent manual/scheduled adapter 실행을
    막고 reset/disconnect 호출 순서를 보존함. 최초 lineage purge 또는
    disconnect finalization 실패도 scheduler timer를 durable source backoff
    시각으로 다시 예약하고 disconnect attempt는 중복 append하지 않음
  - coordinator disconnect settlement는 해당 source의 in-flight generation을
    즉시 supersede하고 latest snapshot metadata를 제거한 `disabled` 상태를
    persisted history에 기록함
  - Codex `thread/list`는 `observationMode=inventory_only`,
    `liveObservationAvailable=false`, `executionState=unknown`,
    `waitingState=null`, inventory event/reason/non-null timestamp의 exact tuple로
    고정함. managed waiting/reason/event가 섞인 inventory record는 거부함
  - `running`, `completed`, `failed`, `interrupted`는 blabase가 연결을 소유한
    long-lived App Server의 ordered thread/turn/item event에만 허용하는
    `managed_event_stream` 계약으로 분리하고 event별 execution
    state/waiting/reason tuple을 exact 검증함. 현재 외부 Codex 세션 inventory는
    이 managed live state를 주장하지 않음
  - exact validation을 `codex-execution-observation-v2`와
    `codex-observation-history-v2`로 식별함. semantically valid한 private v1
    history만 read-time v2 normalization하고 다음 정상 append에서 v2로
    교체하며, malformed v1/v2 inventory history는 fail closed함
  - GitHub repository, Codex scope, Notion resource와 Calendar OAuth 연결
    세대별 random `connectionScopeId`를 opaque source reference로 저장하고
    명시적 사용자 확인 mapping만 `projectId`로 적용. Calendar 재연결은
    같은 Google 계정이어도 기존 mapping을 자동 재사용하지 않아 사용자가
    새 scope를 다시 연결해야 함. Work Cockpit의 project mapping surface에는
    bounded, sanitized label만 표시하고 연결·해제 버튼을 누른 경우에만 반영
  - global 또는 project-scoped weekly outcome을 7일 cadence로 보존하고,
    현재 Attention source scope에 하나의 project가 명확하면 project outcome을,
    그렇지 않으면 global outcome을 선택. project override가 만료됐거나 아직
    시작되지 않았을 때도 active global outcome으로 fallback하며, registry가
    아직 없어도 global outcome을 Attention focus로 전달함. 제품 UI에서
    project mapping과 global weekly outcome 한 줄을 직접 생성·수정할 수 있고
    변경 즉시 Attention을 invalidation함
  - Calendar는 `schedule_context_only`, Notion은 `project_context_only`로
    Attention input과 coverage/Work Cockpit에 들어가며 직접 행동 후보를
    생성하지 않음. Calendar collection과 supporting constraint는 최대
    250개로 제한하고 초과 여부를 `truncated`로 보존함. Calendar repeated page
    token/10-page 초과는 실패로 종료하고, Notion은 unsupported/archived
    record만 계속 오는 경우에도 10 page에서 `truncated=true`로 안전하게 종료함
  - Codex inventory history는 동일 execution의 의미 상태가 바뀐 경우에만
    append하고 건수 절단 없이 30일 time retention을 적용함
  - Attention monitor run에 Calendar/Notion snapshot hash, fetched time,
    adapter version, item/mapping/truncation과 context registry/resolution/
    weekly-outcome store hash·상태를 metadata-only provenance로 기록함
  - current monitor run은 `analysisId`, `sessionId`와 private replay artifact
    hash를 요구함. 평가에 사용한 정확한 normalized Attention input을
    `attention-replay-input-v1`로 `.local/attention/replay-inputs`에 불변 저장하고
    run retention과 같은 30일 cutoff를 적용함. 이 artifact는 제품 API 응답에
    포함하지 않음
  - GET 자동 preview와 formal run/replay 저장에 실패한 degraded POST는
    `attention-monitor-preview-v1`로 응답함. 이 계약은
    `analysisId/sessionId=null`, replay `not_recorded`/hash null이며 monitor
    store가 persistence를 거부하므로 저장되지 않은 artifact를 주장하지 않음
  - explicit POST가 source sync 또는 Attention resolution에서 실패하면
    실행 전에 발급한 `runId`/`analysisId`/`sessionId`, failed status, 단계,
    sanitized error code, retry count, latency, engine/schema/policy/rule
    version과 성공 run과 같은 code provenance를
    `attention-monitor-failure-v0.2` private metadata로 기록함.
    raw exception과 provider detail은 기록하지 않음. 기존 v0.1 failure는
    code provenance를 `legacy_unknown`으로만 읽음
  - monitor history read는 v0.3 replay artifact의 실재, schema,
    run/analysis/session/input/captured-at linkage와 artifact SHA-256을
    교차검증하고 불일치 시 fail closed함. 실제 과거 v0.1/v0.2 run에 남아 있던
    execution/replay/code field는 읽을 때 null/`not_recorded`/`legacy_unknown`으로
    보수적으로 정규화해 신뢰 provenance로 노출하지 않음. 원본 legacy record는
    private store rewrite 시 그대로 보존해 기존 SHA를 silently overwrite하지 않음
  - replay retention cleanup은 monitor validation과 분리함. monitor가 손상돼
    retained run set을 신뢰할 수 없을 때는 strict canonical/temp 중 cutoff보다
    오래된 파일만 제거하며 current file, unsafe name, directory는 보존함.
    valid store에서만 retained run set 기반 orphan cleanup을 적용함
  - code provenance는 clean worktree의 commit SHA, 운영자가 명시한 commit SHA,
    dirty worktree fingerprint 또는 unavailable을 구분함. dirty run은
    `codeCommitSha=null`과 code fingerprint를 기록하며 clean/declared run만
    commit SHA를 기록함
  - 실제 Chromium browser를 구동하는 격리된 Playwright E2E가 transient
    polling 실패 후 recovery, 저장된 첫 revision의 Work Cockpit/Attention Lab
    전파, 실제 Codex disconnect route와 snapshot revision/hash 제거 및 이미
    열린 Attention Lab의 navigation 없는 UI 전파를 검증함
- Versions before:
  - runtime WorkSignal: `runtime-work-signal-v0.1`
  - runtime WorkSignal batch: `runtime-work-signal-batch-v0.1`
  - Attention input/result:
    `github-codex-attention-input-v0.1`,
    `github-codex-attention-result-v0.1`
  - policy: `aggressive-evidence-bound-attention-policy-v0.1`
  - GitHub rule: `github-direct-candidate-rule-v0.1`
  - Codex rule: `codex-current-overview-rule-v0.1`
  - live orchestrator: `attention-live-orchestrator-v0.1`
  - Codex observation validation:
    `codex-execution-observation-v1`,
    `codex-observation-history-v1`
- Versions after:
  - runtime WorkSignal: `runtime-work-signal-v0.2`
  - runtime WorkSignal batch: `runtime-work-signal-batch-v0.2`
  - Attention input/result:
    `cross-source-attention-input-v0.2`,
    `cross-source-attention-result-v0.2`
  - policy: `aggressive-evidence-bound-attention-policy-v0.2`
  - GitHub rule: `github-project-aware-candidate-rule-v0.2`
  - Codex rule: `codex-inventory-only-overview-rule-v0.2`
  - live orchestrator: `attention-live-orchestrator-v0.2`
  - Attention monitor run:
    `attention-monitor-run-v0.3` with `attention-monitor-run-v0.1` and
    `attention-monitor-run-v0.2` read compatibility
  - ephemeral Attention preview:
    `attention-monitor-preview-v1`
  - failed Attention execution:
    `attention-monitor-failure-v0.2` with
    `attention-monitor-failure-v0.1` read compatibility
  - private Attention replay input:
    `attention-replay-input-v1`
  - GitHub/Codex normalizer:
    `github-project-context-normalizer-v0.2`,
    `codex-inventory-observation-normalizer-v0.2`
  - Codex native timeline:
    `codex-native-observation-timeline-v0.2`
  - result ID policy:
    `cross-source-attention-result-id-v0.2`
  - source sync:
    `source-sync-attempt-v1`,
    `source-sync-state-v1`,
    `source-sync-latest-store-v1`,
    `source-sync-history-store-v1`,
    `source-sync-transition-v1`,
    `source-sync-transition-store-v1`,
    `source-sync-settlement-v1`,
    `source-sync-settlement-store-v1`
  - work context:
    `work-context-registry-v1`,
    `weekly-outcome-store-v1`,
    `resolved-work-context-v1`
  - supporting source adapter:
    `supporting-source-adapter-v0.3`
  - Codex observation:
    `codex-execution-observation-v2`,
    `codex-observation-history-v2` with exact `v1` read compatibility,
    `codex-app-server-v2-generated-2026-07-27`
- Code commit:
  - current worktree는 미커밋
  - base commit:
    `66f2aaca40675f44cf32ba755988d15aa3f545fe`
  - current run contract는 clean worktree에 `clean_commit`과 commit SHA를,
    명시적으로 주입한 SHA에 `declared_commit`을 기록함. dirty worktree에서는
    `codeCommitSha=null`, `codeState=dirty_worktree`와 deterministic
    `codeFingerprintSha256`을 기록하고 unavailable 상태도 명시함
  - private replay artifact가 정확한 평가 input은 보존하지만 dirty code 자체를
    materialize하지는 않는다. release 비교의 exact code replay gate는 변경을
    commit한 뒤 clean commit SHA를 run record에 고정하는 것임
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-cross-source-dev-v0.1`
  - revision: `2`
  - class: mutable synthetic Dev Candidate
  - materialized canonical SHA-256:
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - dataset content, label과 SHA-256은 이번 변경에서 수정하지 않음
- Candidate run ID: 없음. 현재 Cross-source dataset은 frozen Golden이 아니고
  이번 단계는 production ranking 품질 주장보다 deterministic pipeline
  regression을 검증함
- Comparison run ID: 없음
- Commands executed:
  - `npm test -- --run tests/sourceSyncCoordinator.test.ts tests/syncRoutes.test.ts tests/uiSyncController.test.ts tests/dataPipelineE2E.test.ts tests/connectorCallbackSyncRoutes.test.ts`
  - `npm test -- --run tests/workContext.test.ts tests/contextRoutes.test.ts tests/liveAttention.test.ts tests/supportingSourceAdapters.test.ts tests/codexObservationContract.test.ts`
  - `npm test -- --run tests/githubConnector.test.ts tests/codexConnector.test.ts tests/googleCalendarConnector.test.ts tests/notionConnector.test.ts`
  - `npm test -- --run tests/codexObservationContract.test.ts tests/codexConnector.test.ts`
  - `npm test -- --run tests/sourceSyncRuntime.test.ts tests/sourceScopeDiscovery.test.ts tests/projectMappingRoutes.test.ts tests/supportingConnectorDisconnectRoutes.test.ts`
  - `npm test`
  - `npm run test:e2e`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - parent app: `npm run typecheck`
  - parent app: `npm run lint`
  - parent app source-only: `npm run lint -- --ignore-pattern suggestion/.open-next`
  - localhost smoke:
    `GET /api/sync/status`, same-origin `POST /api/sync/start`,
    `GET /api/attention`, `GET /`
- Metrics changed:
  - Vitest 전체 `37` test files, `328` tests 통과
  - Playwright Chromium E2E `2` tests 통과
  - suggestion `typecheck`, `lint`, production `build` 통과
  - parent app `typecheck` 통과. parent app 전체 `lint`는 제품 소스가 아니라
    suggestion의 생성물 `.open-next` 안에 포함된 번들/config를 검사하면서
    `@typescript-eslint/no-explicit-any` rule 부재 및 bundled React lint
    오류로 실패함. `.open-next`를 제외한 parent source lint는 통과
  - 실제 기존 private monitor는 원본을 수정하지 않은 임시 복사본에서
    historical run `2`개를 모두 읽었고 normalized 결과의 trusted legacy
    provenance claim은 `0`개였음. 검증용 private 복사본은 즉시 삭제
  - 실제 browser E2E는 독립된 synthetic `.local` fixture와 Chromium에서
    실행하며 연결된 실제 credential이나 `.env.local`을 복사하지 않음
  - localhost smoke의 네 route가 HTTP 200과 versioned response contract를
    반환했고 private source payload는 이 tracked record에 기록하지 않음
  - sync single-flight, due polling, exponential backoff, retry recovery,
    non-blocking scheduler start, bounded provider request,
    disconnected disable/manual recovery와 in-flight supersession,
    latest/history separation,
    first/subsequent revision invalidation, PollController stop/start,
    four-source disconnect race와 callback coordinator routing의 회귀 coverage
    추가
  - filesystem-backed sync state/history와 UI invalidation propagation,
    registry 없는 global weekly outcome와 inactive project override fallback,
    supporting-source collection cap/pagination/provenance,
    Codex inventory boundary와 four-source Attention input 회귀 coverage 추가
  - Codex inventory/managed exact tuple schema parse, 모든 허용 managed native
    event 조합, valid persisted v1→v2 normalization과 malformed v1/v2 history
    fail-closed 회귀 coverage 추가
  - OAuth account replacement generation, Notion workspace identity,
    local-first disconnect/remote revoke timeout과 explicit project mapping
    discovery/UI route 회귀 coverage 추가
  - 네 connector atomic-temp strict matching, startup grace/active-write 보호,
    explicit disconnect credential-temp purge 회귀 coverage 추가
  - monitor run v0.3 ID/code provenance, immutable replay artifact의
    hash·권한·30일 pruning과 제품 API 비노출 회귀 coverage 추가
  - preview/degraded replay truthfulness, source transition barrier,
    lineage purge backoff 재예약과 replacement credential/config 선노출 방지
    failure/concurrency 회귀 coverage 추가
  - failed Attention source-sync/resolver execution record, current replay
    artifact read-time integrity, historical v0.1/v0.2 raw record 보존형
    conservative migration, corrupt-store 독립 retention cleanup과
    crashed temp retention 회귀 coverage 추가
  - durable transition intent의 reset/disconnect finalization failure,
    other-source commit, restart recovery, idempotent disconnect attempt와
    reset↔disconnect ordering 회귀 coverage 추가
  - filesystem history→latest 중간 실패의 exact settlement journal,
    disabled→manual-success same-process confirmation과 restart recovery,
    transition clear rename 뒤 chmod acknowledgement 실패의 read-back
    reconciliation 회귀 coverage 추가
  - source A settlement의 same-process recovery 직후 source B commit이 A/B
    latest와 history를 모두 보존하고 A adapter를 재실행하지 않는 회귀,
    settlement가 없는 정상 commit의 adapter-registration normalization 보존
    회귀 coverage 추가
  - source A durable settlement 뒤 source B disconnect transition이
    same-process recovery를 인계받아 A ready snapshot, B disabled attempt와
    두 source history를 함께 보존하는 회귀 coverage 추가
  - same-source durable success settlement 뒤 disconnect가 recovered
    `lastSuccess`, 정확한 retry count, 단일 disconnect attempt와 두 history
    entry를 보존하며 adapter를 재실행하지 않는 회귀 coverage 추가
  - GitHub settlement recovery와 unrelated Codex transition barrier가 겹칠 때
    등록 GitHub adapter가 barrier 전에 실행되지 않고, 해제 후 recovered
    previous snapshot을 받는 회귀 coverage 추가
  - Acceptable@1, human preference agreement와 candidate precision/recall은
    이번 단계에서 측정하지 않음
- Regressions or accepted exceptions:
  - 현재 Next.js process 안의 timer가 coordinator scheduling을 유지한다.
    process가 상시 유지되지 않는 production/serverless 환경에서는 durable
    scheduler 또는 외부 trigger가 별도로 필요함
  - UI는 `/api/sync/status`를 15초 간격으로 polling하고 client failure에
    backoff를 적용하므로 revision propagation은 실시간 push가 아니라 bounded
    eventual refresh임
  - current Codex collector는 inventory-only다. 이미 다른 Codex client가
    소유한 App Server의 live event stream에 attach하지 않으며 실행의
    running/completed/failed를 추론하지 않음
  - managed App Server notification contract, parser와 ordered history schema는
    존재하지만 실제 live managed observation은 blabase가 App Server
    connection과 execution lifecycle을 소유하는 후속 runtime이 필요함
  - Calendar와 Notion은 실제 Attention input/coverage에 포함되지만 각각
    schedule/project context-only이며 direct candidate가 아님
  - project mapping은 자동 title/path 유사성으로 확정하지 않고 explicit
    user confirmation을 요구함
  - weekly outcome text match는 eligibility, lane 또는 deadline을 만들지 않는
    같은 lane 내 보조 신호로 유지
  - 실제 browser E2E는 local single-process Next.js runtime에서 수행한다.
    production multi-process scheduler/lease와 process 간 single-flight는 후속
    운영 E2E 범위임
- Privacy or retention impact:
  - `.local/sync`는 directory 0700, file 0600, atomic replacement를 사용함
  - sync latest/history에는 snapshot payload나 provider error detail 대신
    revision, SHA-256, item count, timing, retry count와 sanitized error code만
    저장
  - sync transition journal도 credential/payload 없이 source, target metadata,
    sanitized disconnect attempt와 retry schedule만 private 0600 file에 저장하고
    transition 완료 뒤 빈 store로 정리함
  - sync settlement journal은 sanitized attempt와 exact latest/history
    projection만 0600 file에 보존하고 성공 확인 뒤 즉시 빈 store로 정리함.
    connector payload, credential 또는 raw provider error를 추가로 저장하지 않음
  - `.local/context`도 directory 0700, file 0600을 사용하며 explicit project
    mapping에는 provider scope의 opaque ID를, weekly outcome에는 사용자가
    입력한 최소 한 줄만 보존
  - `.local/attention/replay-inputs/run_<id>.json`은
    `attention-replay-input-v1`의 정확한 normalized Attention input을 run별
    immutable private artifact로 보존함. 이 입력에는 source title, safe URL,
    weekly outcome 등 평가에 실제 사용된 private 값이 포함될 수 있으므로
    directory 0700, file 0600, 30일 retention을 적용하고 Git과 제품 API
    응답에서 제외함
  - `.local/attention/monitor.json`은 replay payload를 복제하지 않고
    `analysisId`, `sessionId`, input/result/replay hash, source/context
    provenance, sanitized decision metadata와 failed execution metadata만 보존함.
    v0.2 failure에는 같은 실행에서 해석한 commit/fingerprint/unavailable code
    provenance를 포함하며 raw exception은 포함하지 않음
  - 실제 historical v0.1/v0.2 run의 raw legacy record는 private file 안에서
    rewrite 간 그대로 보존하되 read/API 결과에서는 execution/replay/code
    provenance를 모두 보수적 unknown으로 정규화함. 기존 SHA는 삭제하거나
    신뢰 가능한 current `codeCommitSha`로 승격하지 않음
  - current replay claim은 매 read에서 artifact와 교차검증하고, replay atomic
    write의 crash temp는 canonical artifact와 같은 최대 30일 retention을 적용함.
    corrupt monitor에서도 strict old canonical/temp cleanup은 실행하지만 current
    artifact와 unsafe name, directory는 보존함
  - Codex observation history는 metadata-only로 최대 30일 보존하고 raw
    prompt, response, command, output은 저장하지 않음. 동일 상태 polling은
    중복 append하지 않고 time cutoff만 retention 기준으로 사용함. valid v1
    record의 read-time normalization은 원본 private file을 즉시 rewrite하지
    않으며 다음 정상 append에서만 v2 atomic replacement함. malformed legacy
    record는 신뢰 가능한 live state로 승격하지 않고 fail closed함
  - disconnect는 connector snapshot/credential 범위와 Codex observation
    history를 삭제하며 generation guard가 늦게 끝난 in-flight write를
    거부하고 UI에 disconnected revision/invalidation을 전파함
  - connector atomic-write temp는 startup/read에서 5분 grace 뒤 제거하고,
    explicit disconnect에서는 recognized inactive temp를 즉시 함께 삭제해
    crash 후 credential remanence를 남기지 않음
  - production conversation이나 connector payload를 Golden/Regression
    dataset으로 승격하지 않음
- Release decision:
  - Phase 2A.1 local Data Pipeline Stabilization 완료
  - formal frozen baseline은 보류. 현재 Cross-source dataset이 mutable synthetic
    Dev Candidate이고 human-reviewed/adjudicated Golden이 없기 때문
  - baseline 해제 gate는 reviewed/adjudicated dataset freeze와 canonical
    SHA-256, clean committed code SHA, 동일 frozen input의 immutable replay
    artifact, candidate/comparison `runId`·`analysisId`·`sessionId` 기록
  - production durable scheduling과 managed Codex App Server ownership 전에는
    local product 범위를 유지
- Rollback method:
  - `src/sync`, `/api/sync`, sync UI polling/invalidation을 제거하면 기존
    connector별 수동 refresh 경계로 복귀
  - `src/context`, `/api/context`와 supporting source adapters를 제거하고
    WorkSignal/Attention input/result/rule/orchestrator version을 v0.1로
    되돌리면 이전 GitHub+Codex vertical slice로 복귀
  - Codex observation history와 inventory semantic fields를 제거하면 이전
    overview 표시 계약으로 복귀하되 `thread/list`가 live state가 아니라는
    안전 제한은 유지해야 함
- Follow-up work:
  - production runtime용 durable scheduler/lease와 multi-process coordinator
    설계
  - blabase가 실행을 소유하는 long-lived Codex App Server manager와 managed
    event ingestion 구현
  - production durable scheduler/lease의 multi-process E2E
  - project-specific weekly outcome 편집 UI
  - Calendar free/busy 기반 first-step fit과 mapped Notion task contract
- reviewed/adjudicated Cross-source Golden freeze와 formal baseline

## 2026-07-29 Codex historical prompt, answer, and execution capture v0.1

- Date: 2026-07-29
- Owner: Codex with human direction
- Goal:
  - 사용자가 명시적으로 동의한 경우 Codex의 전체 prompt, answer와 실행
    과정/결과를 bounded private artifact로 수집
  - 수집한 historical content가 live 실행 상태나 Attention 행동 후보로
    잘못 승격되지 않도록 raw/private, manifest/context, managed live observation
    경계를 분리
- Affected pipeline stages:
  - Codex App Server `thread/list` + `thread/read(includeTurns=true)` collection
  - Codex connector consent/config, snapshot과 private raw content persistence
  - prompt/answer/turn/item normalization, truncation과 content hashing
  - Codex WorkSignal historical overview context와 Attention input/result schema
  - connector configuration/preview와 Work Cockpit observability
  - scope/content-mode transition, expiry와 disconnect deletion
- Behavior before:
  - Codex collector는 `thread/list` inventory metadata와 선택적인 task summary만
    가져옴
  - user prompt, Codex answer, plan, command stdout/stderr와 exit result, file
    diff, tool result를 수집하거나 보존하지 않음
  - raw Codex content retention은 `none`이었고 content completeness/hash를
    나타내는 session manifest가 없음
- Behavior after:
  - Codex content mode를 `metadata_only`, `activity_summary`,
    `conversation_and_execution`으로 나누고 마지막 mode에 별도 explicit
    `codex-conversation-content-consent-v1` consent와 고정 7일 retention을 요구
  - 기존 summary consent는 raw consent로 자동 승격하지 않으며 consent contract,
    timestamp와 retention이 일치하지 않으면 collection을 시작하지 않음
  - config에도 exact consent contract version을 보존한다. contract가 없거나
    current version과 다르면 기존 full-content consent를 재사용하지 않고
    conservative summary mode로 낮춘 뒤 raw artifact를 purge함
  - selected/recent thread를 동일 App Server connection에서
    `thread/read(includeTurns=true)`로 읽고 strict envelope, expected thread ID와
    exact `updatedAt`을 검증
  - user prompt/reference, commentary/final agent answer, plan, command/action/
    working-directory/aggregated-output/exit/duration, file diff, MCP/dynamic
    tool input/result/error와 supported process event를 typed private item으로
    보존
  - reasoning payload는 정책상 제외하고 count와
    `REASONING_EXCLUDED_BY_POLICY`만 기록. unknown item은 추측하지 않고
    `UNSUPPORTED_ITEM` partial evidence로 기록
  - sync당 thread read 25개, thread당 turn 100개/item 1,000개, field 1 MiB,
    thread 16 MiB의 versioned cap을 적용. UTF-8 code point 경계에서 자르고
    original/stored bytes, full-value SHA-256, truncation과 exact partial reason을
    기록
  - raw session/store는 strict canonical hash로 연결하고
    `.local/connectors/codex/conversation-history.json`에 private atomic
    artifact로만 저장
  - `codex-snapshot-v3`에는 raw payload 대신 content hash, timestamps,
    completeness/reason, historical last-turn status, category count와 bounded
    sanitized excerpt를 가진 manifest만 둠
  - historical last-turn status는 persisted history의 상태일 뿐 live
    observation이 아님. Codex signal은 계속 overview/context-only,
    `liveObservationAvailable=false`,
    `forbiddenAsAttentionCandidate=true`를 유지
  - expiry/config read는 7일이 지난 raw artifact를 삭제하고 null로 취급함.
    mode downgrade는 먼저 raw consent를 비활성화한 뒤 snapshot/observation/raw
    content를 purge하고, scope 변경과 disconnect도 이전 raw artifact를 삭제.
    generation guard가 늦게 끝난 in-flight write를 거부
- Versions before:
  - Codex connector config: `codex-connector-config-v2`
  - Codex snapshot: `codex-snapshot-v2`
  - runtime WorkSignal/batch:
    `runtime-work-signal-v0.2`, `runtime-work-signal-batch-v0.2`
  - Codex normalizer: `codex-inventory-observation-normalizer-v0.2`
  - Attention input/result:
    `cross-source-attention-input-v0.2`,
    `cross-source-attention-result-v0.2`
  - Codex rule: `codex-inventory-only-overview-rule-v0.2`
  - result ID policy: `cross-source-attention-result-id-v0.2`
- Versions after:
  - Codex connector config: `codex-connector-config-v3`
  - Codex snapshot: `codex-snapshot-v3`
  - Codex raw consent: `codex-conversation-content-consent-v1`
  - Codex raw store/session:
    `codex-conversation-and-execution-store-v1`,
    `codex-conversation-and-execution-session-v1`
  - Codex content collector/limits:
    `codex-app-server-thread-read-v1`,
    `codex-conversation-content-limits-v1`
  - runtime WorkSignal/batch:
    `runtime-work-signal-v0.3`, `runtime-work-signal-batch-v0.3`
  - Codex normalizer: `codex-historical-context-normalizer-v0.3`
  - Attention input/result:
    `cross-source-attention-input-v0.3`,
    `cross-source-attention-result-v0.3`
  - Codex rule: `codex-historical-context-overview-rule-v0.3`
  - result ID policy: `cross-source-attention-result-id-v0.3`
  - policy, GitHub rule, live orchestrator와 Codex live observation/history는
    각각 v0.2에서 의미 변경 없음
- Code commit:
  - current worktree는 미커밋
  - exact release commit SHA는 commit 후 기록해야 함
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-cross-source-dev-v0.1`
  - revision: `2`
  - class: mutable synthetic Dev Candidate
  - materialized canonical SHA-256:
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - dataset content/label/hash는 수정하지 않았고 production Codex content를
    dataset에 추가하지 않음
- Candidate run ID: 없음. reviewed/adjudicated frozen Cross-source Golden이 없음
- Comparison run ID: 없음
- Commands executed:
  - `npx vitest run tests/codexConversationContract.test.ts tests/codexConversationPrivacy.test.ts tests/codexConversationCollection.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e`
- Metrics changed:
  - 전체 Vitest `40` files, `342` tests 통과
  - 신규 Codex content/privacy focused Vitest `3` files, `11` tests 통과
  - 명시적 raw consent API 거부/허용과 mutation ordering route regression 통과
  - Attention v0.2 replay input read compatibility regression 통과
  - Playwright Chromium data-pipeline E2E `2` tests 통과
  - suggestion typecheck, lint와 Next.js production build 통과
  - full synthetic thread fixture에서 prompt, answer, plan, failed command의
    aggregated stdout/stderr와 exit code, file diff, MCP/dynamic tool result
    보존과 reasoning payload 제외 검증
  - malformed thread fail-closed, unknown item partial, UTF-8-safe field cap과
    reason/hash metadata 검증
  - strict raw store hash의 deterministic/change-sensitive behavior와 raw
    sentinel의 bounded manifest 비노출 검증
  - opted-in raw store의 directory `0700`/file `0600`, mode opt-out와
    disconnect purge 검증
  - Acceptable@1, preference agreement와 candidate precision/recall은 Codex가
    여전히 행동 후보를 만들지 않으므로 측정하지 않음
- Regressions or accepted exceptions:
  - 이 collector는 저장된 thread history를 polling한다. 다른 Codex client가
    소유한 live event stream이 아니므로 current progress/stall/completion/
    failure를 주장하지 않음
  - reasoning은 사용자 요청 범위와 무관하게 수집하지 않음
  - “전체” content는 consented 7일 window와 versioned field/thread/turn/item
    cap 안의 source content를 뜻함. cap을 넘으면 silent loss 대신 `partial`과
    exact reason/byte/hash를 표시
  - 한 sync의 thread read는 25개로 제한하고 나머지는
    `THREAD_READ_LIMIT`; malformed/changed/failed response는 session별
    failed/stale manifest로 표시
  - historical content는 Attention candidate eligibility, lane, deadline,
    urgency 또는 live exception을 만들지 않고 Work Cockpit context로만 사용
- Privacy or retention impact:
  - raw prompt, answer, command, output, diff, tool payload와 turn error는
    explicit consent가 있는 동안 private `.local` store에만 최대 7일 보존
  - connector directory `0700`, file `0600`, atomic replacement와
    store/session SHA-256 integrity를 적용
  - full raw content는 snapshot/WorkSignal/Attention input/result, immutable
    Attention replay, monitor, sync audit, connector/status/Attention API,
    Golden/Regression dataset과 Git에 넣지 않음
  - snapshot manifest는 hash/count/completeness와 bounded sanitized clue만
    허용하고 reasoning payload는 어떤 artifact에도 저장하지 않음
  - expired store는 read/startup에서 삭제하고 scope 변경, opt-out,
    disconnect에서 raw artifact와 recognized temp를 purge
  - 모든 신규 fixture는 synthetic이며 production conversation, credential,
    private path나 실제 provider payload를 포함하지 않음
- Release decision:
  - local explicit opt-in capture, privacy boundary, connector→private
    store→v3 manifest→WorkSignal 통합과 전체 회귀 gate 통과
  - formal frozen baseline은 보류. 현재 Cross-source dataset은 mutable
    synthetic Dev Candidate이고 human-reviewed/adjudicated Golden이 없음
  - baseline/release comparison gate는 reviewed dataset freeze + canonical
    SHA-256 + clean committed code SHA + 동일 frozen input + candidate/comparison
    run ID
  - 최종 제품 변경 완료 gate는 전체 test, typecheck, lint, build와 connector/
    Attention integration regression 통과
- Rollback method:
  - `conversation_and_execution` 선택/API/UI를 비활성화하고 Codex v3
    snapshot/config을 v2 metadata/summary-only contract로 되돌림
  - v0.3 historical-context WorkSignal/Attention fields와 rule을 제거하고 v0.2
    inventory-only versions로 복귀
  - rollback 전에 existing private `conversation-history.json`과 recognized
    temp를 purge해 동의 없이 raw content가 남지 않게 함
- Follow-up work:
  - blabase가 lifecycle을 소유하는 long-lived Codex App Server manager와
    ordered managed event ingestion
  - production multi-process generation/retention deletion E2E
  - historical content와 explicit project workflow를 사용하는 후속 작업
    detector는 별도 schema/rule/evaluation으로 설계
  - human-reviewed/adjudicated Cross-source Golden freeze와 formal baseline

## 2026-07-30 Phase 2B.0 explicit Work Resumption v0.1

- Date: 2026-07-30
- Owner: Codex with human direction
- Goal:
  - Work Cockpit의 현재 제안을 사용자가 명시적으로 연결한 기존 Codex
    세션으로 안전하게 이어서 작업
  - 버튼 click 또는 버튼에 focus된 상태의 Enter 한 번으로 Companion이
    추적하는 Terminal을 focus하거나 새 macOS Terminal에서 기존 세션을 resume
  - 추천 엔진과 외부 source의 read-only 경계를 유지하면서 local
    safe destination만 제공
- Affected pipeline stages:
  - post-decision Work Cockpit destination UI
  - explicit task identity↔opaque Codex execution binding
  - local-only Work Resumption API, private binding/command/heartbeat store
  - Codex App Server execution target의 just-in-time resolution
  - macOS Local Companion command claim, execution lease와 Terminal adapter
  - Codex disconnect cleanup
  - Attention input, candidate eligibility, filtering, ordering, ranking,
    certainty와 result resolution은 변경하지 않음
- Behavior before:
  - Work Cockpit은 한 가지 제안과 관찰 상태만 보여주고 기존 Codex 작업으로
    이동하거나 재개하는 action이 없음
  - 사용자가 적절한 Codex 세션과 프로젝트 경로를 직접 다시 찾아야 함
- Behavior after:
  - 현재 top suggestion과 Codex 과거 세션을 사용자가 직접 선택해 연결
  - fresh Companion ownership과 active binding이 있을 때만
    `focus_or_resume` command를 30초 TTL로 생성
  - native thread ID와 cwd는 실행 순간 선택된 scope에서만 다시 resolve하고
    고정된 `codex resume <thread-id>` 흐름만 Terminal adapter에 전달
  - Companion이 연 busy Terminal과 random marker가 일치하면 해당 창을
    focus하고, 아니면 새 Terminal에서 resume
  - title/URL/path 유사성 자동 연결, prompt 자동 전송, 승인 자동 처리,
    실패 자동 재시도, arbitrary shell과 GitHub/Notion/Calendar mutation은
    수행하지 않음
  - command 상태 전이, unbind와 disconnect를 cross-process filesystem lease로
    직렬화하고 Codex connector deletion까지 같은 lease 안에서 수행하며 launch
    전 binding/Codex connection generation을 재검증
  - bind의 execution/scope도 같은 state lease 안에서 현재 Codex snapshot과
    connection을 다시 확인해 disconnect와 엇갈린 stale binding을 만들지 않음
  - 두 번째 fresh Companion은 command loop 전에 거부하고 자신의 heartbeat만
    compare-and-clear
  - launch 결과 기록 전 process crash는 자동 재실행하지 않고
    `LAUNCH_OUTCOME_UNKNOWN`으로 terminal 처리
- Versions before:
  - Work Resumption binding/store/API/Companion contract: 없음
  - Cross-source Attention semantic versions: v0.3 계열 유지
- Versions after:
  - binding store: `work-resumption-binding-store-v1`
  - schema: `work-resumption-schema-v1`
  - command: `work-resumption-command-v1`
  - heartbeat: `work-resumption-heartbeat-v1`
  - local protocol: `work-resumption-local-protocol-v1`
  - command retention: `work-resumption-command-retention-v1`
  - Cross-source Attention input/result/policy/rule versions: 변경 없음
- Code commit:
  - current worktree는 미커밋
  - exact release commit SHA는 commit 후 기록해야 함
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-cross-source-dev-v0.1`
  - revision: `2`
  - class: mutable synthetic Dev Candidate
  - case count: `30`
  - materialized canonical SHA-256:
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - dataset content/label/hash는 수정하지 않음
- Candidate run ID: 없음. Attention semantic output을 변경하지 않음
- Comparison run ID: 없음
- Commands executed:
  - `npx vitest run tests/workResumptionStore.test.ts tests/workResumptionRoutes.test.ts tests/workResumptionScopeResolution.test.ts tests/workResumptionClient.test.ts tests/workResumptionCompanion.test.ts tests/codexResumeTarget.test.ts tests/codexRoutes.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e`
  - `npm run cross-source:dev-hash`
  - `npm run companion:work-resumption -- --help`
- Metrics changed:
  - focused Work Resumption/Codex route Vitest `7` files, `69` tests 통과
  - 전체 Vitest `46` files, `394` tests 통과
  - Playwright Chromium `3` tests 통과
  - 신규 E2E에서 자동 binding 없음, explicit session 선택, keyboard Enter,
    prompt/shell payload 부재와 `RESUMED_IN_TERMINAL` 결과 문구 검증
  - typecheck, full lint, production build와 `git diff --check` 통과
  - Cross-source Dev Candidate SHA-256가 기존 revision 2와 동일함을 확인
  - Attention Acceptable@1, preference agreement와 candidate precision/recall은
    semantic selection이 바뀌지 않아 다시 측정하지 않음
- Regressions or accepted exceptions:
  - 첫 release는 macOS 기본 Terminal만 지원
  - 사용자가 별도 terminal에서 Companion을 실행해 두어야 하며 자동 시작,
    background packaging과 update는 아직 없음
  - Companion이 직접 연 Terminal만 process-memory marker로 focus할 수 있음.
    다른 Codex client가 연 창이나 동일 session의 cross-client ownership은
    식별·조정하지 않음
  - Terminal Automation 권한 거부는 typed launch failure로 표시하지만 실제
    사용자 Terminal을 여는 smoke test는 현재 작업 세션 보호를 위해 자동화하지
    않음
  - active binding은 현재 top suggestion에서만 직접 관리할 수 있다. 더 이상
    top이 아닌 binding을 한 화면에서 관리하는 UI는 후속 작업
- Privacy or retention impact:
  - `.local/work-resumption/`은 directory `0700`, file `0600`, atomic
    replacement와 private filesystem lock을 사용
  - persisted/public binding에는 표시 제목을 저장하지 않고 public API에서는
    private scope ID도 제거
  - native thread ID, 전체 cwd, prompt/answer, shell command, Terminal output,
    credential과 installation secret을 registry, queue, API, log, fixture와
    Git에 저장하지 않음
  - private command에는 bounded metadata와 hashed connection generation만
    저장하며 terminal result는 7일 뒤 제거
  - binding의 stable 최소 identity는 explicit unbind 또는 Codex disconnect까지
    보존하고 disconnect는 pending/claimed state보다 먼저 Work Resumption
    상태를 폐기
  - production binding/command signal을 Golden/Regression dataset으로 자동
    승격하지 않음
- Release decision:
  - Phase 2B.0 local beta vertical slice 완료
  - Attention semantic baseline은 의도적으로 재실행하지 않음. engine
    input/output/filtering/ordering/interpretation과 frozen dataset이 바뀌지
    않았기 때문
  - local single-user, macOS Terminal 범위에서만 활성화
- Rollback method:
  - Work Cockpit의 Work Resumption panel과 client, `/api/work-resumption`,
    `src/resumption`, Codex resume target resolver와 Companion tool/script를
    제거
  - Codex disconnect의 Work Resumption cleanup hook을 제거하면 이전 read-only
    Work Cockpit으로 복귀하며 Attention semantic version은 되돌릴 필요 없음
- Follow-up work:
  - signed installer/background Companion과 상태 진단 UI
  - 더 이상 top이 아닌 active binding을 조회·해제하는 관리 화면
  - iTerm, VS Code terminal, Windows/Linux adapter와 실제 macOS Automation
    manual smoke checklist
  - remote/cloud 확장 전 device pairing, local authentication과 signed command
  - managed Codex App Server events, progress/stall/failure detector와 configured
    workflow follow-through

## 2026-08-01 Phase 2B.1 Managed Codex Run Observability v0.1

- Date: 2026-08-01
- Owner: Codex with human direction
- Goal:
  - Blabase를 통해 재개한 Codex run의 현재 실행 진행을 Work Cockpit에서
    실시간으로 확인
  - inventory/historical session과 Blabase-owned live authority를 분리
  - semantic detector에 앞서 bounded local transport, ordered metadata history,
    liveness와 privacy 경계를 검증
- Affected pipeline stages:
  - Phase 2B.0 Local Companion daemon과 fixed Terminal resume destination
  - local loopback Codex App Server WebSocket transport와 remote TUI launch
  - explicit binding/connection ownership verification
  - managed lifecycle notification normalization, private event history와 latest
    projection
  - local-only managed projection API와 Work Cockpit progress UI
  - Codex disconnect managed-state cleanup
  - Attention input, candidate derivation, eligibility, filtering, ordering,
    ranking, result resolution, replay input과 monitor hash는 변경하지 않음
- Behavior before:
  - Companion은 existing thread를 새 local Terminal의
    `codex resume <thread-id>`로 열거나 이미 자신이 연 창을 focus함
  - Work Cockpit은 `thread/list` inventory와 opt-in historical content만
    표시하며 current execution state는 항상 `unknown`
  - managed schema/parser는 있었지만 Blabase-owned runtime event stream과
    public progress projection이 없음
- Behavior after:
  - explicit `focus_or_resume` 시 Companion daemon이
    `ws://127.0.0.1:<ephemeral-port>` App Server process와 observation
    connection을 소유
  - observer에서 `thread/resume`을 먼저 수행한 뒤 Terminal에
    `codex resume --remote <loopback-endpoint> <thread-id>`를 실행
  - queue execution lease 안에서는 manager가
    `callerHoldsOwnershipLease` 경로를 사용해 동일 Work Resumption lease를
    중첩 획득하지 않음
  - `thread/status/changed`, turn/item lifecycle allowlist만 strict normalized
    metadata로 append
  - managed run lifecycle과 latest turn state를 분리해 turn completion 뒤에도
    다음 turn을 계속 관찰
  - unexpected disconnect는 live claim을 제거하고 reconnect에는
    `gap_detected` continuity를 보존
  - reconnect 직후 과거 `running`/`idle`은 current effective state로 재사용하지
    않고 `unknown`으로 낮춤. `completed`/`failed`/`interrupted`는 마지막으로
    검증한 turn 결과로만 보존하며 managed run 또는 work item의 현재 상태로
    확대하지 않음. 이후 새 notification만 current state를 갱신하고 gap은 유지
  - public API는 Work Resumption state lease 안에서 fresh Companion owner와
    current binding/execution/scope/connection-generation exact authority를
    projection read까지 유지해 stale connected 표시를 fail closed
  - manager가 unbind/generation 변경을 감지하면 persisted `run_closed`를
    best-effort 기록하고 idle App Server session을 종료
  - registry, hash-chained ordered event history와 latest projection을 분리하고
    settlement journal로 중간 crash를 exact recovery
  - Work Cockpit의 historical overview와 별도인 “Codex 실시간 진행”에서
    managed projection을 표시하고 “관찰 전용 · 추천 우선순위에 반영하지
    않음”을 명시
  - prompt/turn 자동 시작, approval/input 자동 응답, 실패한 작업 자동 재시도와
    arbitrary shell은 수행하지 않음
- Versions before:
  - managed runtime registry/event/history/latest/public/settlement/retention:
    없음
  - Work Resumption: v1 계열
  - Codex observation/history: v2 계열
  - Cross-source Attention semantic versions: v0.3 계열
- Versions after:
  - registry: `codex-managed-run-registry-v1`
  - event: `codex-managed-event-v1`
  - ordered history: `codex-managed-event-history-v1`
  - latest store: `codex-managed-latest-projection-store-v1`
  - public projection: `codex-managed-public-projection-v1`
  - crash settlement: `codex-managed-settlement-v1`
  - retention: `codex-managed-retention-v1`
  - Work Resumption, Codex observation/history와 Cross-source Attention
    input/result/policy/rule versions: 변경 없음
- Code commit:
  - 이 Engine Change Record를 포함하는 Git commit을 Phase 2B.1 code version
    authority로 사용
  - exact SHA는 해당 commit의 repository history에서 확인
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-cross-source-dev-v0.1`
  - revision: `2`
  - class: mutable synthetic Dev Candidate
  - case count: `30`
  - materialized canonical SHA-256:
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - dataset content, label, revision과 hash는 수정하지 않음
- Candidate run ID: 없음. Attention semantic output을 변경하지 않음
- Comparison run ID: 없음
- Commands executed:
  - `npx vitest run tests/managedCodexRuntime.test.ts tests/managedCodexStore.test.ts tests/managedCodexRunsRoute.test.ts tests/workResumptionStore.test.ts tests/workResumptionCompanion.test.ts tests/codexRoutes.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e`
  - `npm run check:managed-codex-transport`
  - `npm run cross-source:dev-hash`
  - `git diff --check`
- Metrics changed:
  - focused managed/Work Resumption/Codex Vitest `6` files/`76` tests 통과
  - 전체 Vitest `51` files/`438` tests 통과
  - Playwright Chromium E2E `5` tests 통과. 이 중 managed progress UI가
    `2` tests
  - suggestion typecheck, lint와 production build 통과
  - 실제 `codex-cli 0.146.0`을 사용한 loopback App Server initialize/close
    transport smoke 통과
  - Cross-source Dev Candidate가 version `suggestion-cross-source-dev-v0.1`,
    revision `2`, `30` cases와 기존 canonical SHA-256
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`를
    그대로 유지함을 확인
  - `git diff --check` 통과
  - Attention Acceptable@1, preference agreement와 candidate precision/recall은
    semantic selection이 바뀌지 않아 다시 측정하지 않음
  - formal Golden baseline은 실행하지 않음. 이번 변경은 managed projection을
    Attention input, output, filtering, ordering, interpretation과 hash에서
    명시적으로 격리하고 dataset도 변경하지 않았기 때문
- Regressions or accepted exceptions:
  - App Server local WebSocket/remote TUI transport는 experimental beta로 취급
  - local single-user Companion daemon과 macOS 기본 Terminal만 지원
  - 기존 외부 Codex session은 historical/inventory context이며 managed live
    state를 주장하지 않음
  - Companion을 사용자가 별도 daemon으로 실행해야 하며 signed installer,
    background packaging과 update는 없음
  - 실제 Terminal launch와 native thread resume smoke는 활성 사용자 세션을
    방해할 수 있어 실행하지 않았고 별도 manual beta verification으로 남김.
    loopback App Server transport 자체는 실제 CLI smoke를 통과함
  - meaningful progress, stall, scope drift, failure intervention, stable request
    lifecycle와 configured follow-through detector는 아직 없음
- Privacy or retention impact:
  - `.local/connectors/codex/managed/` directory는 `0700`, file은 `0600`이며
    atomic replacement, cross-process lock과 settlement recovery를 사용
  - native Codex thread/turn/item ID, local cwd, prompt/answer/reasoning text,
    command/stdout/stderr/output, file path/diff, tool arguments/results,
    App Server endpoint와 raw error detail을 저장하지 않음
  - managed store는 execution/lifecycle/item category의 sanitized metadata만
    최대 30일, run별 최대 10,000 events 보존
  - public API는 private scope/connection generation/owner/hash와 raw field를
    제거하고 `Cache-Control: no-store`를 사용
  - 별도 explicit opt-in historical `conversation_and_execution` raw store의
    consent/7일 retention을 변경하거나 managed store로 복제하지 않음
  - production managed event와 implicit UI feedback은 Gold가 아니며 자동으로
    Golden/Regression dataset에 승격하지 않음
- Release decision:
  - Phase 2B.1 local beta observability vertical slice
  - 모든 public managed run은 `forbiddenAsAttentionCandidate=true`이고 semantic
    detector는 비활성화
  - frozen baseline 재실행은 의도적으로 생략. dataset 및 Attention semantic
    behavior가 변경되지 않았으며 기존 Dev Candidate revision/hash를 유지
  - focused/full test, typecheck, lint, production build, browser E2E, 실제 CLI
    transport smoke, dataset hash와 diff check가 모두 통과해 local beta release
    gate를 충족
- Rollback method:
  - Companion daemon에서 managed manager/remote endpoint wrapper를 제거하고
    Phase 2B.0의 direct local `codex resume <thread-id>`로 복귀
  - `/api/managed-codex-runs`, Work Cockpit managed progress panel과
    `src/managedCodex`/WebSocket transport를 제거
  - `.local/connectors/codex/managed/` artifact를 clear하고 Codex disconnect의
    managed cleanup hook을 제거
  - Attention semantic versions은 변경되지 않았으므로 되돌릴 필요 없음
- Follow-up work:
  - actual macOS Terminal launch/native thread resume manual smoke와 protocol
    compatibility checklist
  - signed/background Companion, diagnostics와 production multi-process/device
    ownership
  - native `isDraft`, GitHub checks/requested changes/merge conflict evidence
  - meaningful-progress/stall/failure/request lifecycle/follow-through detector는
    별도 schema/rule/evaluation과 Engine Change Record로 구현
  - reviewed/adjudicated Cross-source Golden freeze와 formal baseline

## 2026-08-01 Phase 2B.2A managed direct-fact semantic timeline

- Date: 2026-08-01
- Owner: Codex with human direction
- Goal:
  - Blabase가 직접 소유한 managed Codex ordered history를 사용해 사용자가
    실행 진행을 눈으로 확인할 수 있는 semantic timeline 제공
  - 직접 관찰한 Codex lifecycle과 사용자 task/outcome의 실제 진전을 분리
  - richer evidence가 없는 progress, stall과 request escalation을 fail closed
- Affected pipeline stages:
  - managed event history의 same-snapshot sanitized semantic window
  - direct-fact timeline과 turn/managed-run failure lifecycle detector
  - local-only managed observability API와 Work Cockpit UI
  - 별도 synthetic detector Dev Candidate loader, runner와 metric gate
  - Attention input/router/replay/monitor/ranking은 변경하지 않음
- Behavior before:
  - Work Cockpit은 managed run의 최신 projection 한 건만 표시
  - ordered history에서 turn completion/failure/interruption, managed run failure와
    continuity boundary를 해석하는 versioned semantic output이 없음
  - progress/stall/failure detector 전용 event-history evaluation dataset과 run
    record가 없음
- Behavior after:
  - verified private history를 public run projection과 같은 managed store lock에서
    읽고 private identity/hash/raw content를 제거한 semantic projection 생성
  - direct turn started/completed/failed/interrupted, item activity, thread state와
    stream/run lifecycle의 bounded timeline 제공
  - latest direct turn failure와 managed launch/transport failure를 분리
  - failure 뒤 새 turn이 있으면 현재 failure에서 억제하지만 recovery로 표현하지
    않음
  - reconnect 전 stale nonterminal state, prefix-pruned history와 clock regression을
    보수적으로 처리
  - task-level `meaningfulProgress=unknown`, `stall=not_evaluable`,
    `requestEscalation=unsupported`
  - public evidence와 timeline은 run별 최근 24개로 제한하고 전체 sanitized input은
    digest로 결합
  - Work Cockpit에 직접 이벤트 해석, 작업 진전 판단 불가, 정체 평가 불가와
    접이식 timeline 표시
  - 모든 결과는 `attentionDisposition=not_connected`와
    `forbiddenAsAttentionCandidate=true`
- Versions before:
  - managed semantic window/timeline/detector/run/projection: 없음
  - managed registry/event/history/latest/public/settlement: v1 계열
  - Codex observation/history: v2 계열
  - Cross-source Attention: v0.3 input/result, v0.2 policy/rules
- Versions after:
  - window: `codex-managed-semantic-window-v0.1`
  - timeline: `codex-managed-semantic-timeline-v0.1`
  - detector result: `codex-managed-semantic-detector-result-v0.1`
  - run result: `codex-managed-semantic-run-result-v0.1`
  - projection: `codex-managed-semantic-projection-v0.1`
  - schema: `codex-managed-semantic-schema-v0.1`
  - rule: `codex-managed-direct-event-detector-v0.1`
  - evidence policy: `codex-managed-direct-metadata-evidence-v0.1`
  - detector dataset schema: `codex-managed-detector-case-v0.1`
  - detector run record: `codex-managed-detector-evaluation-run-v0.1`
  - managed v1, Codex observation v2와 Cross-source Attention semantic versions:
    변경 없음
- Code commit:
  - base commit: `bddccfd98747939c386058762491eeebb65b5476`
  - candidate run code state: `dirty_worktree`
  - candidate run pre-record fingerprint:
    `160be65d538e8f4cc2d4eca0c85c14ab24ac7ea8ef678f1e9bff81574286ccd5`
  - 이 fingerprint는 아래 candidate run 직전의 전체 `suggestion/` 변경을
    나타낸다. 이 Engine Change Record 자체를 append한 문서-only 변경은 run 뒤에
    추가되었으며 semantic code/dataset/input/output을 변경하지 않음
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-codex-detector-dev-v0.1`
  - revision: `1`
  - class/lifecycle: mutable synthetic Dev Candidate
  - input boundary: `managed_codex_event_history`
  - case count: `18`
  - canonical SHA-256:
    `5436c590c8768b8b2732d675e96b6bd0d837e882dccffbeec67602466e76c838`
  - materialized input SHA-256:
    `d161272fe5815e42a7ac9fe30caf2ad45e2189e6acee9cdd5c5d1a0aedcaa747`
  - detector config:
    `eval/synthetic/managedCodexDetectorConfig.v0.1.json`
  - detector config SHA-256:
    `70df024c080ee8b7407273bd7005e2b5ebed9f8cf0c97994b0cf6a28dbeb47a7`
  - 기존 `suggestion-cross-source-dev-v0.1` revision `2`, `30` cases와 SHA-256
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
    는 변경하지 않음
- Candidate run ID: `detector_run_a4836622e4b5b1b483dfb2a5acc0551c`
- Comparison run ID: 없음 — 최초 event-history detector targeted baseline
- Commands executed:
  - `npx vitest run tests/managedCodexSemanticTimeline.test.ts tests/managedCodexStore.test.ts tests/managedCodexRunsRoute.test.ts tests/managedCodexRunsClient.test.ts`
  - `npx vitest run tests/managedCodexDetectorEvaluation.test.ts`
  - `npm run managed-codex:detector-baseline`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e`
  - `npm run cross-source:dev-hash`
  - `git diff --check`
- Metrics changed:
  - detector exact case match: `18/18` (`1.0`)
  - latest-direct failure precision/recall: `1.0/1.0`
  - active failure false positive/false negative: `0/0`
  - superseded failure leakage: `0`
  - gap stale-state leakage: `0`
  - systemError false failure: `0`
  - unsupported stall/request emission: `0`
  - deterministic output SHA-256:
    `60292c648f169be965c2da239d4b21315004c730c02455b4042dfacd2f69fd81`
  - focused managed semantic/store/route/client Vitest: `4` files/`31` tests 통과
  - detector evaluation Vitest: `5` tests 통과
  - full Vitest: `53` files/`455` tests 통과
  - Playwright Chromium E2E: `5` tests 통과, managed semantic UI `2` tests 포함
  - typecheck, lint, production build와 diff check 통과
  - provider/model/prompt/token usage: `not_applicable`; deterministic rule-only
- Regressions or accepted exceptions:
  - 현재 metadata는 task/outcome progress, verified stall, scope drift, stable
    request lifecycle와 configured follow-through를 증명하지 못함
  - Codex turn completed는 project task 완료로 해석하지 않음
  - `item_completed(file_change|command_execution)`은 성공 artifact/test/build
    근거가 아니므로 activity-only
  - `run_failed`는 managed launch/transport failure이며 Codex turn failure와 분리
  - failure 뒤 새 turn은 과거 failure를 current에서 억제하지만 해결됐다고 단정하지
    않음
  - synthetic dataset은 human-reviewed Golden이 아니며 제품 추천 품질을 증명하지
    않음
  - full E2E는 local single-process runtime이며 production multi-process/device
    ownership은 범위 밖
- Privacy or retention impact:
  - 기존 sanitized managed metadata만 입력으로 사용하고 새 production semantic
    store를 만들지 않음
  - prompt/answer/reasoning text, command/output, diff/path, tool arguments/results,
    native thread/turn/item ID, cwd, owner/scope/generation과 event hash를 semantic
    API/UI/dataset에 포함하지 않음
  - public semantic evidence와 timeline은 각각 최근 24개로 제한
  - source history와 같은 최대 30일 retention/cleanup 경계를 따르고 derived
    result를 별도 보존하지 않음
  - dataset은 synthetic sanitized metadata만 포함
  - production detector result와 implicit UI feedback은 Gold가 아니며 자동으로
    Golden/Regression dataset에 승격하지 않음
- Release decision:
  - Phase 2B.2A local beta observational semantic slice로 허용
  - Work Cockpit 가시성에는 사용하지만 Attention input/result/filtering/ordering,
    replay/monitor hash, candidate/ranking/selection에는 연결하지 않음
  - formal Golden baseline은 실행하지 않음. 이 branch는 Attention semantic
    behavior와 기존 Cross-source dataset을 변경하지 않고 별도 mutable synthetic
    detector targeted baseline으로 gate했기 때문
  - verified progress/stall이나 failure intervention의 production release가 아님
- Rollback method:
  - `/api/managed-codex-runs`의 `semantics` field와 Work Cockpit semantic summary/
    timeline을 제거하고 v1 public projection-only UI로 복귀
  - `src/managedCodex/semanticTimeline.ts`, managed observability combined reader와
    detector evaluation files/script를 제거
  - managed history v1 storage와 Phase 2B.1 latest projection은 유지 가능
  - Attention versions과 dataset은 변경되지 않아 별도 rollback 불필요
- Follow-up work:
  - private run-scoped opaque turn/item identity와 outcome pairing 검토
  - sanitized command/tool/test/build result와 artifact state evidence
  - stream/thread heartbeat, phase와 expected-next-event contract
  - stable approval/input request ID와 pending/resolved/expired lifecycle
  - Phase 3 explicit execution↔work/artifact relation과 project workflow
  - relation/materiality gate 뒤 failure intervention candidate를 별도 version과
    regression으로 구현
  - reviewed/adjudicated Cross-source Golden freeze와 formal baseline

## 2026-08-01 Phase 3A explicit managed Codex↔GitHub work relation

- Date: 2026-08-01
- Owner: Codex with human direction
- Goal:
  - Blabase가 관리하는 Codex 실행이 사용자가 직접 확인한 어떤 GitHub 작업을
    수행하는지 exact identity와 append-only lineage로 설명
  - GitHub snapshot freshness/absence/conflict와 current explicit project mapping을
    관계와 분리된 evidence로 표시
  - relation을 Work Cockpit에서 확인하되 Attention 추천에는 연결하지 않음
- Affected pipeline stages:
  - new GitHub bind의 exact native target pre-persistence validation
  - managed public run + WorkSessionBinding + normalized GitHub batch + context
    registry의 deterministic relation resolution
  - local-only relation API/client와 Work Cockpit relation status UI
  - 별도 synthetic relation Dev Candidate loader, evaluator와 baseline runner
  - Attention input/router/replay/monitor/candidate/ranking/selection은 변경하지 않음
- Behavior before:
  - managed run에 `bindingId`가 있었지만 GitHub native object와의 versioned
    `executes` projection 및 binding lifecycle 설명이 없음
  - stale/not-observed/unavailable GitHub evidence와 project conflict를 managed run
    UI에서 구분할 수 없음
  - new GitHub binding이 current stored snapshot의 exact native identity와
    일치하는지 persist 직전에 검증하지 않음
- Behavior after:
  - append-only WorkSessionBinding의 `explicit_user` bind만 `executes` authority로
    인정하고 exact binding/execution/managed-run identity coherence를 검증
  - `github:object:<native id>`만 join하며 title, URL, repository, project와 path
    유사성으로 relation을 만들지 않음
  - new GitHub bind는 current stored snapshot에서 exact object를 확인하고 absent,
    invalid 또는 incompatible duplicate identity를 typed error로 거부
  - rebind/unbind 뒤 과거 relation은 superseded lineage로 보존하고 current
    destination이나 Attention 후보로 사용하지 않음
  - GitHub current/stale/not-observed/unavailable/conflict와 project
    aligned/unmapped/conflict/unavailable을 서로 독립적으로 표시
  - snapshot absence는 completion이 아니며 `produces`와 `related_to`는 필요한
    explicit privacy-safe 계약 전까지 생성하지 않음
  - 별도 `GET /api/work-relations`와 15초 polling UI에서 관계 상태를 표시
  - UI는 exact managed-run resolution으로 join하고 polling revision이 엇갈릴 때
    같은 binding의 오래된 relation을 새 run에 붙이지 않음
  - 모든 projection/relation에 `attentionDisposition=not_connected`와
    `forbiddenAsAttentionCandidate=true`
- Versions before:
  - managed Codex work relation projection/schema/resolver/evidence policy: 없음
  - WorkSessionBinding, managed public projection, GitHub normalized signal과
    context registry: 기존 버전 유지
  - Cross-source Attention: v0.3 input/result, v0.2 policy/rules
- Versions after:
  - projection: `managed-codex-work-relation-projection-v0.1`
  - schema: `work-relation-schema-v0.1`
  - resolver: `managed-codex-explicit-binding-resolver-v0.1`
  - evidence policy: `explicit-binding-native-id-evidence-v0.1`
  - evaluation case: `work-relation-resolver-evaluation-case-v0.1`
  - evaluation run: `work-relation-resolver-evaluation-run-v0.1`
  - 기존 managed, binding, GitHub, context와 Attention semantic versions: 변경 없음
- Code commit:
  - base commit: `76dfc8d8391035f86a5d8e0a3c429feba187ebfd`
  - candidate run code state: `dirty_worktree`
  - candidate run pre-record fingerprint:
    `703ff5a9b8184be35e343e2492382650578adbbf460aa7208d5b614d670b4539`
  - 이 fingerprint는 아래 candidate run 직전의 전체 `suggestion/` 변경을
    나타낸다. 이 record와 평가 수치를 반영한 문서-only 변경은 run 뒤에
    추가됐으며 semantic code/dataset/input/output을 변경하지 않음
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-work-relation-dev-v0.1`
  - revision: `1`
  - class/lifecycle: mutable synthetic Dev Candidate
  - input boundary: `work_relation_resolution_inputs`
  - case count: `28`
  - canonical SHA-256:
    `b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002`
  - materialized input SHA-256:
    `7d43dd080f3730cf45557448ba57728632def4fabf30683c8729caf314d8424f`
  - resolver config: `eval/synthetic/workRelationResolverConfig.v0.1.json`
  - resolver config SHA-256:
    `f75d01cb54b58f8d76ba4174662df481b5637bae6824b40fd6d07be55987ecee`
  - 기존 `suggestion-cross-source-dev-v0.1` revision `2`, `30` cases와 SHA-256
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
    는 변경하지 않음
  - 기존 `suggestion-codex-detector-dev-v0.1` revision `1`, `18` cases와
    SHA-256
    `5436c590c8768b8b2732d675e96b6bd0d837e882dccffbeec67602466e76c838`
    는 변경하지 않음
- Candidate run ID: `relation_run_2fce51ef1e1447638f1d9ab1b79623b7`
- Comparison run ID: 없음 — 최초 relation resolver targeted Dev Candidate baseline
- Commands executed:
  - `npx vitest run tests/managedCodexWorkRelations.test.ts tests/githubBindingTarget.test.ts tests/workRelationsRoute.test.ts tests/workRelationsClient.test.ts tests/workResumptionRoutes.test.ts tests/workRelationEvaluation.test.ts`
  - `npm run work-relation:baseline`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e`
  - `npm run cross-source:dev-hash`
  - `git diff --check`
- Metrics changed:
  - relation exact case match: `28/28` (`1.0`)
  - expected/observed relation: `24/24`
  - relation precision/recall: `1.0/1.0`
  - false positive/false negative relation: `0/0`
  - false identity merge: `0`
  - unsupported relation/authority emission: `0/0`
  - title-only/project-only observation leakage: `0/0`
  - superseded-as-current leakage: `0`
  - conflict Attention leakage: `0`
  - lifecycle-only `produces` leakage: `0`
  - unsupported run resolved: `0`
  - permutation determinism/privacy sentinel leakage: `0/0`
  - deterministic output SHA-256:
    `bbf9d6a97090b44a464d362fee24cceb97b89b7a265baa2d8be30c454b1776a4`
  - focused Vitest: `6` files/`31` tests 통과
  - full Vitest: `58` files/`479` tests 통과
  - Playwright Chromium E2E: `11` tests 통과, relation 상태 UI `7` tests 포함
  - typecheck, lint, production build와 diff check 통과
  - provider/model/prompt/token usage: `not_applicable`; deterministic rule-only
- Regressions or accepted exceptions:
  - explicit binding 없는 managed run을 title/path/project 유사성으로 자동
    연결하지 않음
  - GitHub snapshot absence와 stale/truncated data는 task completion이 아님
  - Codex execution completion은 GitHub task completion이 아님
  - project mapping은 alignment/conflict evidence일 뿐 item relation authority가
    아님
  - `produces`, `related_to`, field-level claim authority, materiality와 failure
    intervention은 현재 범위 밖
  - synthetic dataset은 human-reviewed Golden이 아니며 제품 추천 품질을
    증명하지 않음
  - 직접 인앱 viewport 점검은 이 세션에 해당 browser surface가 연결되지 않아
    수행하지 못했으나 실제 Next.js server + Chromium E2E로 렌더링/interaction을
    검증함
- Privacy or retention impact:
  - 새 production relation store를 만들지 않고 현재 source ledger에서 bounded
    projection을 계산
  - raw prompt/answer/reasoning, command/output, diff/path, tool payload, native
    Codex thread/turn/item ID, private scope, GitHub title/repository name을 relation
    output/dataset에 포함하지 않음
  - safe GitHub destination URL은 exact normalized observation에서만 가져와
    local-only/no-store API에 노출하며 identity inference 또는 별도 보존에 사용하지
    않음
  - relation lifetime은 managed run과 source ledger의 기존 retention을 넘겨
    연장하지 않음
  - dataset은 synthetic sanitized metadata만 포함
  - production relation과 implicit UI feedback은 Gold가 아니며 자동으로
    Golden/Regression dataset에 승격하지 않음
- Release decision:
  - Phase 3A local beta observational relation slice로 허용
  - Work Cockpit 가시성과 bind integrity에는 사용하지만 Attention
    input/result/filtering/ordering, replay/monitor hash, candidate/ranking/selection에는
    연결하지 않음
  - formal Golden baseline은 실행하지 않음. Attention semantic behavior와 기존
    Cross-source dataset은 변경하지 않고 별도 mutable synthetic relation targeted
    baseline으로 gate했기 때문
  - execution failure/stall/follow-through 추천의 production release가 아님
- Rollback method:
  - `/api/work-relations`, relation client와 Work Cockpit relation badge/status를
    제거해 Phase 2B.2A managed semantic-only UI로 복귀
  - `src/relations`, relation evaluation dataset/runner와 new bind target validator를
    제거하고 기존 WorkSessionBinding ledger는 유지
  - relation production store가 없어 별도 data migration 또는 purge 불필요
  - Attention versions과 dataset은 변경되지 않아 별도 rollback 불필요
- Follow-up work:
  - privacy-safe explicit artifact identity와 `produces`
  - user-confirmed work-to-work `related_to`
  - GitHub/Notion field-level claim authority와 conflict record
  - relation + materiality를 요구하는 Codex failure intervention gate
  - configured project workflow 기반 completion follow-through
  - reviewed/adjudicated Cross-source Golden freeze와 formal baseline

## 2026-08-01 Phase 3B explicit managed Codex→GitHub artifact `produces`

- Date: 2026-08-01
- Owner: Codex with human direction
- Goal:
  - 사용자가 명시적으로 확인한 managed Codex run과 exact GitHub commit/PR
    artifact 사이의 `produces` lineage를 privacy-safe identity로 설명
  - attach/detach/reattach 결정을 retained window 안에서 append-only인 local
    ledger로 보존하고 Phase 3A `executes` relation의 run/binding/execution
    identity를 exact join
  - artifact 결과를 Work Cockpit에서 확인하되 Attention 추천에는 연결하지 않음
- Affected pipeline stages:
  - transient exact GitHub artifact URL validation과 source-native identity 생성
  - local private attribution decision store, 30일 prune와 disconnect clear
  - Phase 3A work relation + attribution ledger + normalized GitHub batch의
    deterministic artifact relation projection
  - loopback local-only mutation/read API, client와 Work Cockpit artifact UI
  - 별도 mutable synthetic Phase 3B Dev Candidate loader/evaluator/baseline runner
  - Attention input/router/replay/monitor/filtering/ordering/candidate/ranking/selection은
    변경하지 않음
- Behavior before:
  - Phase 3A는 explicit managed run↔GitHub work item `executes`만 설명하고 commit/PR
    artifact attribution은 생성하지 않음
  - Codex `turn_completed`, `file_change` 또는 사용자의 기억에만 의존해 어떤
    artifact를 만들었는지 추적해야 했음
  - raw GitHub artifact URL을 transient parse하고 native identity만 남기는 계약,
    detach/reattach lineage와 retention이 없음
- Behavior after:
  - relation authority `user_configured`, attribution decision source
    `explicit_user`만 허용
  - commit identity는 exact repository native ID + full lowercase 40/64-hex OID
  - v0.1 adapter는 commit object existence를 provider에서 확인하지 않으므로 commit
    attribution은 explicit-user assertion이며 GitHub current observation으로
    승격하지 않음
  - PR identity는 exact repository native ID + PR native object/database ID이며 PR
    number는 persisted display/corroboration metadata지만 stable artifact
    key/`artifactId`에서는 제외
  - PR attach는 로컬에 저장된 snapshot에서 exact native match를 요구하지만
    freshness/completeness를 요구하지 않음. stale/truncated는 explicit relation과
    source limitation으로 보존
  - raw URL과 repository 이름은 validation 뒤 폐기하고 attribution store,
    projection과 evaluation record에 저장하지 않음
  - Phase 3A `managedRunId`, `bindingId`, `executionId`, `executesRelationId` exact
    join을 통과한 attach만 `produces` relation으로 projection
  - v0.1은 per-attribution resolution enum/conflict code를 만들지 않고 join 실패를
    `unresolvedAttributionCount`로 집계
  - exact active duplicate는 no-op, detach는 과거 attach를
    `superseded_by_detach`, reattach는 새 active lineage로 보존
  - retained-window append-only ledger는 artifact마다 current producer 하나만
    허용하고 최대 1,000 decision/30일 cutoff 뒤에는 content 대신 lifetime
    revision/pruned count만 보존
  - unavailable/stale/not-observed/conflict를 서로 다른 observation status로
    보존하고 artifact projection의 `destinationUrl`은 항상 `null`
  - 모든 projection/relation에 `attentionDisposition=not_connected`와
    `forbiddenAsAttentionCandidate=true`
- Versions before:
  - managed Codex artifact relation projection/schema/resolver/evidence/identity
    policy와 attribution store: 없음
  - Phase 3A work relation projection/schema/resolver/evidence policy: v0.1 유지
  - Cross-source Attention: v0.3 input/result, v0.2 policy/rules 유지
- Versions after:
  - projection: `managed-codex-artifact-relation-projection-v0.1`
  - relation schema: `artifact-relation-schema-v0.1`
  - resolver: `managed-codex-explicit-artifact-resolver-v0.1`
  - evidence policy: `explicit-user-native-artifact-evidence-v0.1`
  - identity policy: `github-native-artifact-id-v0.1`
  - attribution store: `work-artifact-attribution-store-v0.1`
  - attribution schema: `work-artifact-attribution-schema-v0.1`
  - retention policy: `work-artifact-attribution-retention-30d-v0.1`
  - evaluation case: `artifact-relation-resolver-evaluation-case-v0.1`
  - evaluation run: `artifact-relation-resolver-evaluation-run-v0.1`
  - 기존 Phase 3A, managed Codex와 Attention semantic versions: 변경 없음
- Code commit:
  - base commit: `c15c82ef78fb9c84c05e1e9af7b5b6968130d2f4`
  - candidate run code state: `dirty_worktree`
  - candidate run fingerprint:
    `78040ab5b4f297692c94e0968e0dd33f78a108b30e90c1616849797f9fd0aa62`
  - 이 fingerprint는 아래 candidate run 직전의 전체 `suggestion/` 변경과 ECR
    draft를 나타낸다. run 뒤의 ECR run/hash 치환과 관련 contract/gate 문서
    정합성 수정은 documentation-only이며 semantic code/dataset/materialized
    input/output을 변경하지 않음
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-artifact-relation-dev-v0.1`
  - revision: `1`
  - class/lifecycle: mutable synthetic Dev Candidate
  - data origin/production data: `synthetic` / `false`
  - input boundary: `explicit_artifact_attribution_inputs`
  - case count: `32`
  - canonical SHA-256:
    `fdc9112a5164c63619489304ec8af398cae498597631303ffe6e3cda51f8a2c8`
  - materialized input SHA-256:
    `9c67f337ddbc379e66e4295ddd6cfd1468dd7a78ec61b36db54cfe7852432bf5`
  - resolver config: `eval/synthetic/artifactRelationResolverConfig.v0.1.json`
  - resolver config SHA-256:
    `04427b788d092601159be4991ed33981940078d1a66ca8e0fe4bd30487897006`
  - 기존 Phase 3A `suggestion-work-relation-dev-v0.1` revision `1`, `28` cases의
    canonical SHA-256
    `b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002`
    는 변경하지 않음
  - 기존 Cross-source/managed detector dataset도 변경하지 않음
- Candidate run ID:
  `artifact_relation_run_4f88b0aad069ee7e0ba51545fea32eae`
- Comparison run ID: 없음 — 최초 Phase 3B artifact relation targeted Dev Candidate
  baseline
- Commands executed:
  - `npx vitest run tests/githubArtifactTarget.test.ts tests/workArtifactAttributions.test.ts tests/managedCodexArtifactRelations.test.ts tests/workArtifactMutationService.test.ts tests/workArtifactsRoute.test.ts tests/workArtifactsClient.test.ts tests/artifactRelationEvaluation.test.ts tests/workRelationEvaluation.test.ts tests/workRelationsRoute.test.ts tests/workRelationsClient.test.ts tests/workResumptionStore.test.ts tests/githubRoutes.test.ts tests/managedCodexRunsRoute.test.ts`
  - `npm run artifact-relation:baseline`
  - `npm run work-relation:baseline`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npx playwright test e2e/managed-codex-progress.spec.ts --project=chromium`
  - Cross-source Dev Candidate canonical dataset hash 확인
  - `git diff --check`
- Metrics changed:
  - artifact relation exact case match: `32/32` (`1.0`)
  - expected/observed `produces` relation: `23/23`
  - relation precision/recall: `1.0/1.0`
  - false positive/false negative relation: `0/0`
  - hard-negative/invalid-identity/run-identity leakage: `0/0/0`
  - source-limitation current-claim leakage: `0`
  - unsupported authority emission: `0`
  - Attention leakage: `0`
  - privacy sentinel/stored raw URL leakage: `0/0`
  - permutation determinism failure/tampered-store acceptance: `0/0`
  - Phase 3A dataset hash mismatch: `0`
  - deterministic output SHA-256:
    `c93da98c113dfe8d9187ba363b43f6c3027c6150396d039480079cab8b3c7d04`
  - focused Vitest: `13` files/`112` tests 통과
  - full Vitest: `65` files/`542` tests 통과
  - Playwright Chromium E2E: `14/14` tests 통과
  - typecheck, lint, production build와 diff check 통과
  - Phase 3A regression run ID:
    `relation_run_134aea62b2acbb2d0072aaa2fe08d583`
  - Phase 3A materialized input/output SHA-256:
    `7d43dd080f3730cf45557448ba57728632def4fabf30683c8729caf314d8424f` /
    `bbf9d6a97090b44a464d362fee24cceb97b89b7a265baa2d8be30c454b1776a4`
  - Phase 3A exact case/relation match: `28/28`, `24/24`
  - Cross-source Dev Candidate: v0.1 revision `2`, `30` cases, canonical SHA-256
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - provider/model/prompt/token usage: `not_applicable`; deterministic rule-only
- Regressions or accepted exceptions:
  - `turn_completed`, `file_change`, title, branch, project와 time similarity는
    `produces` authority가 아님
  - short/non-hex commit OID, ambiguous repository, PR corroboration conflict를 거부
  - exact run/binding/execution/executes relation mismatch는 ledger를 삭제하지 않고
    unresolved로 유지하며 relation을 생성하지 않음
  - unavailable/stale/not-observed/conflict는 기존 explicit attribution을 지우지
    않지만 current evidence 또는 Attention eligibility를 주장하지 않음
  - Codex execution/artifact relation은 task/project 완료를 의미하지 않음
  - user-confirmed `related_to`, field authority, materiality와 failure/stall
    intervention은 현재 범위 밖
  - managed repository HEAD transition은 hard `produces` 근거가 아니며, 향후
    허용 여부는 사용자 결정으로 남김
  - synthetic dataset은 human-reviewed Golden이나 제품 추천 품질 증명이 아님
- Privacy or retention impact:
  - raw GitHub URL은 request validation에서만 transient parse하고 persistence 전에
    폐기
  - local private store에는 repository/object native ID, full commit OID와 bounded
    attribution lineage만 30일 cutoff로 저장하고 다음 store 접근에서 prune.
    앱이 실행되지 않는 동안의 물리적 삭제는 다음 접근에서 수행
  - artifact projection/API의 destination URL은 항상 `null`; repository-bearing
    URL과 name을 출력하지 않음
  - raw prompt/answer/reasoning, command/output, diff/file path, tool payload,
    native Codex thread/turn/item ID를 store/projection/dataset에 포함하지 않음
  - GitHub disconnect/connection/installation replacement와 Codex
    disconnect/Work Resumption clear가 attribution file을 함께 제거하고 private
    permission/atomic write 경계를 사용. strict-name crash temporary file도 다음
    read/write와 source lifecycle purge에서 제거하고 다른 sibling file은 보존
  - attach의 GitHub snapshot read/URL validation과 GitHub connection mutation을
    같은 shared state lease 순서로 직렬화해 old snapshot 기반 ledger 재생성을 차단
  - invalid attribution store는 fail closed하고 file mtime이 30일 cutoff를 넘은
    경우 해당 실패 read에서 삭제
  - shared state lease를 획득한 뒤 동일 read/decision 시각을 생성해 잠금 대기 중
    stale time 판정을 막음. Phase 3B lease 내부는 bounded local 작업만 수행하고
    provider/network 요청을 포함하지 않음
  - shared filesystem lease는 5초 renewal과 token/device/inode/owner-PID 확인,
    stale 삭제 전 재검증, 종료 current-owner 검증을 적용. ownership loss는 fail
    closed하며 이 경계는 single local filesystem beta용이고 distributed/device 간
    fencing은 범위 밖
  - decision-time regression과 future-asOf evidence를 거부하고 empty ledger는 stable
    epoch를 사용. artifact store는 shared state lease 안에서 별도 nested lock 없이
    read/prune/write
  - dataset은 synthetic sanitized metadata만 포함하고 production conversation,
    production attribution 또는 implicit feedback을 사용하지 않음
  - production relation과 LLM judge score는 Gold가 아니며 자동으로
    Golden/Regression dataset에 승격하지 않음
- Release decision:
  - Phase 3B local beta explicit-user observational artifact relation slice로 허용
  - Work Cockpit의 attach/detach와 lineage 가시성에만 사용하고 Attention
    input/result/filtering/ordering, replay/monitor hash, candidate/ranking/selection에는
    연결하지 않음
  - formal Golden baseline은 실행하지 않음. 기존 frozen/Phase 3A dataset을
    변경하지 않고 별도 mutable synthetic targeted baseline으로 gate했기 때문
  - artifact evidence 기반 failure/stall/follow-through 추천의 production release가
    아님
  - in-app browser runtime에서는 viewport session을 열 수 없었지만 실제 Next.js
    server를 사용하는 Playwright Chromium E2E `14/14`로 Work Cockpit UI와
    attach/detach 즉시 갱신을 검증함
- Rollback method:
  - Work Cockpit artifact UI/client, `/api/work-artifacts` mutation surface와
    `/api/work-relations`의 nested artifact read projection 제거
  - `src/artifacts`, attribution store integration, Phase 3B dataset/evaluator/runner를
    제거하고 Phase 3A `executes` projection과 WorkSessionBinding ledger는 유지
  - local `.local/work-resumption/artifact-attributions.json`을 clear/disconnect
    경로로 제거; 별도 production migration 없음
  - Attention versions/dataset은 변경되지 않아 별도 Attention rollback 불필요
- Follow-up work:
  - managed repository HEAD transition을 hard `produces` evidence로 인정할지 사용자
    결정
  - user-confirmed work-to-work `related_to`
  - GitHub/Notion field-level claim authority와 conflict record
  - relation + materiality를 요구하는 Codex failure/stall intervention gate
  - configured project workflow 기반 completion follow-through
  - reviewed/adjudicated Cross-source Golden freeze와 formal baseline

## 2026-08-02 Phase 3C observation-only claim authority and conflict resolution

- Date: 2026-08-02
- Owner: Codex with human direction
- Goal:
  - GitHub, managed Codex와 explicit project mapping이 직접 증명하는 서로 다른
    semantic field를 범용 state/deadline으로 합치지 않고 canonical claim으로
    보존
  - exact target/field/lineage 안에서 authority, freshness, completeness와
    conflict를 보수적으로 판정하고 원본 claim을 유지
  - 결과를 Work Cockpit의 관찰 정보로만 표시하고 Attention 추천 판단과
    격리
- Affected pipeline stages:
  - GitHub normalized work signal과 direct field evidence의 claim normalization
  - managed Codex public projection + exact semantic window/detector evidence의 claim
    normalization
  - Phase 3A work relation과 explicit source-scope mapping의 project alignment claim
  - field authority, lineage selection, resolution/conflict graph와 canonical hash
  - local-only `/api/work-relations` nested `claims` projection, strict browser client
    validation과 Work Cockpit conflict/coverage UI
  - 별도 mutable synthetic Phase 3C Dev Candidate loader/evaluator/baseline runner
  - Attention input/router/replay/monitor/filtering/ordering/candidate/ranking/selection은
    변경하지 않음
- Behavior before:
  - Phase 3A는 managed Codex run과 GitHub work item의 explicit `executes` relation,
    Phase 3B는 explicit GitHub artifact `produces` relation만 제공
  - source별 current state, authority, stale/context-only 근거와 field conflict를
    하나의 reproducible projection으로 설명하지 못함
  - managed Codex execution state와 GitHub work-item state가 서로 다른 semantic
    field라는 machine-readable claim boundary가 없음
- Behavior after:
  - current live authority는 GitHub exact native fields, Blabase-owned managed Codex
    direct semantic evidence와 서로 다른 두 explicit project mapping lineage로 제한
  - Codex inventory는 context-only고, 현재 Notion/Calendar adapter는 task/event
    direct field와 exact same-work equivalence가 없어 live conflict authority로 사용하지
    않음
  - source-origin-field-target matrix, bounded value, evidence/relation refs, source
    coverage/claim authority/freshness coherence와 duplicate coverage를 fail closed
  - managed target은 `managedRunId + bindingId + executionId`를 모두 포함하고,
    state와 일치하는 semantic evidence ID/sequence/event와 window, detector,
    semantic projection SHA를 evidence ref에 포함
  - Phase 3A/3B projection SHA, GitHub batch/snapshot SHA, managed revision/time,
    managed semantic projection SHA와 context registry SHA를 exact dependency로 기록
  - claim evidence timestamp는 `asOf + 60,000ms` provider clock skew까지 허용하고
    managed projection generation time은 future skew 없이 거부
  - deduplicated claims/resolutions/conflicts 각각 최대 `12,000`, claim/conflict
    relation refs 최대 `100`; projection overflow를 silent truncation하지 않음
  - pre-dedup claim multiplicity를 input hash에 포함하고 stable resolution/conflict
    ID, exact partition, winner, reason/next action, relation union과 충돌 그래프를
    server schema에서 재검증
  - browser client는 ready/non-ready union, version/dependency, bounded nested fields,
    refs와 resolution/conflict graph를 검증한 경우에만 UI에 전달
  - 모든 projection/resolution/conflict에
    `attentionDisposition=not_connected`, `forbiddenAsAttentionCandidate=true`를 강제
- Versions before:
  - Phase 3C claim projection/schema/conflict/resolver/authority/evidence policy: 없음
  - Phase 3A work relation과 Phase 3B artifact relation: v0.1
  - Cross-source Attention: v0.3 input/result, v0.2 policy/rules
- Versions after:
  - projection: `claim-authority-projection-v0.1`
  - claim schema: `work-claim-schema-v0.1`
  - conflict schema: `claim-conflict-schema-v0.1`
  - resolver: `cross-source-claim-resolver-v0.1`
  - field authority policy: `field-claim-authority-policy-v0.1`
  - evidence policy: `direct-source-claim-evidence-v0.1`
  - evaluation dataset/case/run:
    `claim-authority-resolver-evaluation-dataset-v0.1` /
    `claim-authority-resolver-evaluation-case-v0.1` /
    `claim-authority-resolver-evaluation-run-v0.1`
  - managed semantic v0.1, Phase 3A/3B와 Attention versions: 변경 없음
- Code commit:
  - base commit: `25d4f26bbfc858b3a4ac2ba666c5883ba195d2fc`
  - candidate run code state: `dirty_worktree`
  - final candidate fingerprint:
    `0848f74ca1d1557007a24f430ab7cd0c3c3b77f5b49076d9ebd37784fbb17b9b`
  - final release commit: 생성하지 않음 — 이 작업에서는 commit 승인을 받지 않음
  - 이 fingerprint는 아래 candidate run 직전의 전체 `suggestion/` 변경과 ECR
    placeholder를 나타낸다. run 뒤의 ECR 값 치환과 gate 상태 갱신은 semantic
    code/dataset/materialized input/output을 바꾸지 않는 documentation-only 변경
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-claim-authority-dev-v0.1`
  - revision: `1`
  - class/lifecycle: mutable synthetic Dev Candidate
  - data origin/production data: `synthetic` / `false`
  - input boundary: `normalized_claim_resolution_inputs`
  - case count: `40` (`current_runtime 21`, `future_contract 9`, `integrity 10`)
  - normal projection/expected rejection: `38/2`
  - computed canonical SHA-256:
    `65e7b3dea1b197133b3c776970b2bf3342bfb59777cbc2a1a0a01b31ec11606d`
  - materialized input SHA-256:
    `12f1eb24d6522170e828bfbf406b324d8d2d600b7a9013016d6c6adf95d5f8f1`
  - resolver config: `eval/synthetic/claimAuthorityResolverConfig.v0.1.json`
  - resolver config SHA-256:
    `98ddd2fd399286a89f23737ab7a3fa76cd16e2317150ca78800edcd2bfe63db0`
  - Phase 3A dependency SHA-256:
    `b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002`
  - Phase 3B dependency SHA-256:
    `fdc9112a5164c63619489304ec8af398cae498597631303ffe6e3cda51f8a2c8`
  - Cross-source Dev Candidate revision 2 dependency SHA-256:
    `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - 이 dataset은 frozen Golden이 아니며 lifecycle `datasetSha256`/`immutableRef`/
    `frozenAt`은 `null`인 mutable targeted Dev Candidate
- Candidate run ID:
  `claim_authority_run_f2bc1b560e8e1b298f0c3bf2b5174648`
- Comparison run ID: 없음 — 최초 Phase 3C targeted Dev Candidate baseline
- Commands executed:
  - `npm test -- tests/claimAuthorityResolver.test.ts tests/currentClaimAuthority.test.ts tests/claimAuthorityEvaluation.test.ts tests/workRelationsRoute.test.ts tests/workRelationsClient.test.ts`
  - `npm run claim-authority:baseline`
  - `npm run work-relation:baseline`
  - `npm run artifact-relation:baseline`
  - `npm run cross-source:dev-hash`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e -- e2e/managed-codex-progress.spec.ts`
  - `git diff --check -- apps/blabase/suggestion`
- Metrics changed:
  - targeted deterministic evaluation exact case/projection: `40/40`
  - expected/observed resolution: `42/42`
  - expected/observed conflict: `9/9`
  - resolution precision/recall: `1.0/1.0`
  - conflict precision/recall: `1.0/1.0`
  - semantic projection mismatch, wrong authority winner, context/stale winner,
    cross-domain conflation, false/missed conflict, critical auto-resolution,
    activity/absence completion, timestamp-only override, unsupported authority,
    future evidence, original claim loss, Attention/privacy leakage, order
    determinism과 Phase 3A/3B/Cross-source hash mismatch: 모두 `0`
  - deterministic output SHA-256:
    `cb8e60f7a62d35ab87cac554967c370244bf9a252afa74dcc30452c74b3d08bd`
  - provider/model/prompt/token usage: `not_applicable`; deterministic rule-only
  - focused claim/resolver/route/client: `5` files / `56` tests 통과
  - full Vitest: `68` files / `588` tests 통과
  - Playwright Desktop Chrome: `14/14` tests 통과
  - typecheck, lint, production build와 diff check 통과
  - final persisted baseline latency: `68ms`
  - record artifact:
    `.local/evaluations/claim-authority/claim_authority_run_f2bc1b560e8e1b298f0c3bf2b5174648.json`
  - record artifact SHA-256:
    `59567057b198efacf34dc96b7db4fae958977e72e1ff4b4cc043c139b9ffe4c0`
  - Phase 3A regression run:
    `relation_run_3b0e1446ac0d74eecf577681c8c021b8`, exact `28/28`, relation
    `24/24`, deterministic output
    `bbf9d6a97090b44a464d362fee24cceb97b89b7a265baa2d8be30c454b1776a4`
  - Phase 3B regression run:
    `artifact_relation_run_a9891994e1c6dece303cf0e144063df4`, exact `32/32`,
    relation `23/23`, deterministic output
    `c93da98c113dfe8d9187ba363b43f6c3027c6150396d039480079cab8b3c7d04`
- Regressions or accepted exceptions:
  - 현재 GitHub collector는 query membership이 직접 증명하는 `open`만 current
    work-item state로 생성. closed/merged는 exact bound-object adapter 후속 범위
  - Notion v1과 Calendar는 context-only이므로 live `GitHub completed ↔ Notion
    open` conflict를 생성하지 않음. future-contract synthetic cases는 schema/
    resolver boundary를 검증하지 live adapter 제공을 의미하지 않음
  - same project, title/path/time similarity, `executes`/`produces`만으로
    cross-source same-work/equivalent-field relation을 만들지 않음
  - managed execution `completed`는 GitHub/Notion task/project 완료를 의미하지 않음
  - conflict correction/feedback ledger가 없어 UI는 해결 button을 제공하지 않음
  - unresolved critical conflict는 아직 Attention hard eligibility에 연결하지
    않음. Phase 4의 별도 version/evaluation gate 후에만 적용
  - synthetic dataset은 human-reviewed Golden이나 실제 recommendation 품질 증명이
    아님
- Privacy or retention impact:
  - 새 production claim/conflict store를 만들지 않고 기존 GitHub snapshot,
    context registry, managed semantic evidence와 Phase 3A/3B projection에서 request-time
    projection을 계산
  - claim/conflict를 persistence하지 않으므로 source store의 기존 retention을
    연장하지 않음
  - public projection/UI는 bounded enum/timestamp, opaque hash/ID, reason code만
    노출하고 repository name/title/URL, GitHub native object ID/full commit OID,
    Notion/Calendar title/native ID를 복사하지 않음
  - raw Codex prompt/answer/reasoning, command/output, diff/path와 tool payload를
    claim, API, UI, committed evaluation data에 포함하지 않음
  - evaluation artifact는 synthetic sanitized metadata만 사용하고 final run은
    `.local/evaluations/claim-authority/`의 `0700` directory/`0600` exclusive file로
    저장
  - production conversation, implicit feedback, runtime projection을 Golden/Regression
    dataset으로 자동 승격하지 않음
- Compatibility:
  - local-only `GET /api/work-relations`에 `claims` nested object를 추가한 additive
    contract이며 internal server/client는 함께 업데이트
  - Phase 3A `executes`, Phase 3B `produces`, source store schema/retention은 변경
    없음
  - Attention v0.3 input/result, v0.2 policy/rules, replay/monitor hash와 기존
    frozen/Dev Candidate datasets는 변경 없음
  - old/partial runtime의 dependency mismatch는 거짓 ready 응답 대신 sanitized
    fail-closed error로 표시. 이는 보수적 관찰 계약의 의도된 호환성 경계
- Release decision:
  - Phase 3C local beta observation-only candidate의 final gate를 통과해 허용
  - final candidate baseline run/fingerprint, full regression,
    typecheck/lint/build/E2E와 dependency regression을 위 값으로 기록
  - Work Cockpit의 상태/coverage/conflict 가시성에만 사용하고 Attention
    input/result/filtering/ordering, replay/monitor hash, candidate/ranking/selection에는
    연결하지 않음
  - formal Golden baseline은 실행하지 않음. frozen dataset을 바꾸지 않고
    별도 mutable synthetic targeted resolver baseline으로 gate하기 때문
  - 현재 범위는 이미 확정한 exact identity, observation-only, fail-closed,
    Attention 격리 원칙을 구현하므로 추가 사용자 판단이 필요하지 않음
- Rollback method:
  - Work Cockpit claim/conflict summary, claim-aware client guard와
    `/api/work-relations` nested `claims` projection을 제거해 Phase 3B UI/API로 복귀
  - `src/claims`, claim evaluation dataset/config/evaluator/runner를 제거하고 Phase 3A
    work relation, Phase 3B artifact relation과 source ledgers는 유지
  - 신규 production store/migration이 없어 data migration, purge나 backfill이 필요
    없음
  - Attention semantic version과 dataset을 변경하지 않았으므로 Attention
    rollback은 필요 없음
- Follow-up work:
  - exact bound GitHub object의 closed/merged current-state adapter
  - configured Notion task DB property mapping과 Calendar native event adapter
  - user-confirmed same-work-item/equivalent-field `related_to` relation
  - explicit feedback/correction ledger와 conflict resolution UX
  - Phase 4 `NoCriticalConflict` hard eligibility와 materiality gate
  - reviewed/adjudicated Cross-source Golden freeze와 formal baseline

## 2026-08-02 Phase 4A current-only attention eligibility shadow

- Date: 2026-08-02
- Owner: Codex with human direction
- Goal:
  - GitHub direct-work 후보가 current authoritative evidence와 exact conflict
    boundary를 통과하는지 ranking 전에 결정론적으로 판정
  - 사용자만 해결할 수 있는 conflict와 source refresh가 해결해야 하는
    uncertainty를 서로 다른 route로 보존
  - 결과를 Attention Lab에서 관찰하되 현재 Work Cockpit 추천, lane, ordering,
    selection, replay와 monitor hash에는 반영하지 않음
- Affected pipeline stages:
  - current GitHub work-item signal의 opaque candidate seed derivation
  - Phase 3A work relation, Phase 3B artifact relation, Phase 3C claim/conflict의
    exact dependency graph 검증
  - hard eligibility status와 deterministic reason/review route projection
  - local-only current projection API, strict browser client guard와 Attention Lab
    shadow diagnostics
  - 별도 mutable synthetic Phase 4A Dev Candidate evaluator/baseline runner
  - 기존 Phase 2 Attention input/result/router/history는 변경하지 않음
- Behavior before:
  - Phase 2 GitHub candidate gate는 source freshness, context-only status와 native
    destination만 사용했고 Phase 3C claim/conflict와 격리돼 있었음
  - Phase 3C unresolved conflict를 Work Cockpit에서 볼 수는 있었지만 어떤 후보를
    막는지, 사용자 판단과 source refresh 중 무엇이 필요한지 계산하지 않음
  - 전체 conflict count를 잘못 사용하면 다른 project/target의 안전한 후보까지
    차단할 위험이 있었음
- Behavior after:
  - current GitHub assigned issue와 review-status inspection을 opaque exact target으로
    seed하고 `eligible | review_required | ineligible`로 판정
  - state, user relationship, direct signal completeness와 native destination을
    material evidence로 검사하고 terminal state는 불필요한 clarification보다 먼저
    제외
  - candidate target 또는 candidate exact relation ref와 연결된 conflict만 material
    conflict로 취급
  - unresolved `nextAction=user_review`는 `review_required/user_review`, stale 또는
    refreshable evidence는 `review_required/refresh_sources`로 분리
  - unrelated unresolved conflict와 authority/freshness로 해결된 conflict는 safe
    candidate의 hard block이 아님
  - partial candidate coverage에서도 candidate 자체의 material evidence가 독립적으로
    완결되면 limited-coverage reason을 붙여 eligible을 허용
  - projection/API/UI는 title, repository, native URL/ID와 Codex raw content를 포함하지
    않고 current request에서만 계산
  - `attentionSelectionEffect=none`, `attentionDisposition=shadow_only`,
    `forbiddenAsAttentionCandidate=true`를 계약으로 강제
- Versions before:
  - eligibility projection/candidate seed/policy/evidence/resolver/ID policy: 없음
  - Phase 3A/3B/3C: v0.1
  - Cross-source Attention: v0.3 input/result, v0.2 policy/rules
- Versions after:
  - projection: `attention-eligibility-shadow-projection-v0.1`
  - candidate seed: `attention-candidate-seed-v0.1`
  - policy: `hard-attention-eligibility-policy-v0.1`
  - evidence: `attention-eligibility-evidence-v0.1`
  - resolver: `attention-eligibility-resolver-v0.1`
  - ID policy: `attention-eligibility-id-v0.1`
  - evaluation dataset/case/run:
    `attention-eligibility-gate-evaluation-dataset-v0.1` /
    `attention-eligibility-gate-evaluation-case-v0.1` /
    `attention-eligibility-gate-evaluation-run-v0.1`
  - Phase 3A/3B/3C와 Attention input/result/policy/rules: 변경 없음
- Code commit:
  - repository base commit: `e06325a0e274b384c4b66d314a4daa540ac6463d`
  - suggestion semantic base commit: `a2707d9`
  - candidate run code state: `dirty_worktree`
  - final candidate fingerprint:
    `08d1e993d642d63b7b3d7adaae04cf8125e1986935561806fc7e7cfaf0d3e7e0`
  - 이 fingerprint는 final baseline 직전의 semantic code, dataset, UI, docs와 이
    ECR placeholder를 나타낸다. 아래 값 치환은 documentation-only이고 evaluator
    input/output을 변경하지 않음
  - final release commit: 생성하지 않음 — 이 작업에서는 아직 commit 승인을 받지 않음
- Evaluation dataset version and SHA-256:
  - family/version: `suggestion-attention-eligibility-dev-v0.1`
  - revision: `1`
  - class/lifecycle: mutable synthetic Dev Candidate
  - data origin/production data: `synthetic` / `false`
  - input boundary: `exact_phase3_evidence_graph`
  - case count: `26`; expected/observed assessment target: `24/24`
  - computed canonical SHA-256:
    `8bc76248801595e30df40e575180e1aa18e1e454ca61a6cd3624c8b8629667bb`
  - materialized input SHA-256:
    `f1739a4f066c11075127e8216b3ea1d887589e1e0f37e6f2efb8ddd27518cbfa`
  - resolver config: `eval/synthetic/eligibilityGateConfig.v0.1.json`
  - resolver config SHA-256:
    `33c2719e45d6d3715053c44e87f5d5e36317f0457e3ee939ca76aa36c53a2e57`
  - 이 dataset은 frozen Golden이 아니며 production data나 implicit feedback을
    포함하지 않음
- Candidate run ID:
  `attention_eligibility_run_686eb8f8f2d3d0a7e7fc6da1deea1b56`
- Comparison run ID: 없음 — 최초 Phase 4A targeted Dev Candidate baseline
- Commands executed:
  - `npm test -- --run tests/eligibilityGateEvaluation.test.ts tests/attentionEligibilityResolver.test.ts tests/attentionEligibilityRoute.test.ts tests/eligibilityClient.test.ts`
  - `npm run attention-eligibility:baseline`
  - `npm run claim-authority:baseline`
  - `npm run work-relation:baseline`
  - `npm run artifact-relation:baseline`
  - `npm run cross-source:dev-hash`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - local HTTP checks for `/api/attention/eligibility` and `/attention-lab`
  - `git diff --check -- apps/blabase/suggestion`
- Metrics changed:
  - targeted exact case: `26/26`; assessment precision/recall `1.0/1.0`
  - unsafe eligible, wrong review route, user-conflict auto eligibility,
    refresh-conflict user misroute, unrelated-conflict false block, absence candidate,
    dependency/batch fail-open, Attention selection/candidate leakage, privacy/raw-field
    leakage, canonical ordering/determinism/config failure: 모두 `0`
  - deterministic output SHA-256:
    `f3cf74ee441b86ae9571db09063ede1cd139f2b8a959dedadc4201e03ee063a8`
  - provider/model/prompt/token usage: `not_applicable`; deterministic rule-only
  - final persisted baseline latency: `99ms`
  - record artifact:
    `.local/evaluations/attention-eligibility/attention_eligibility_run_686eb8f8f2d3d0a7e7fc6da1deea1b56.json`
  - record artifact SHA-256:
    `3a460156205a3f62477269485958408277e9e892fc0b9619a8a4b1ac869fd2b1`
  - full regression: `72/72` test files, `613/613` tests passed
  - compatibility baselines:
    - Phase 3A work relation:
      `relation_run_488170b9e7198c298233447f09a6c53c` (`28/28` cases,
      `24/24` expected relations)
    - Phase 3B artifact relation:
      `artifact_relation_run_9273e8416e27a09df2b2a0bfcc5c6f65`
      (`32/32` cases, `23/23` expected relations)
    - Phase 3C claim authority:
      `claim_authority_run_131879d8aee95341369447072c25df8b`
      (`40/40` cases, `42/42` resolutions, `9/9` conflicts)
    - cross-source Dev Candidate revision `2`: `30` cases, canonical SHA-256
      `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
  - `npm run typecheck`, `npm run lint`, `npm run build`: passed
  - `git diff --check -- .`: passed
- Regressions or accepted exceptions:
  - Phase 4A candidate universe는 GitHub work item만 포함. managed Codex current
    failure, verified stall/scope drift와 configured completion follow-through는 Phase
    4B에서 exact managed run identity와 workflow evidence를 추가한 뒤 평가
  - GitHub review request는 native draft state가 없어 실제 review가 아니라
    `actionKind=inspect` 상태 확인만 eligible
  - current-only shadow는 Attention history에 persistence/replay되지 않음
  - synthetic Dev Candidate는 human-reviewed Golden/holdout이 아니므로 active
    recommendation filter의 일반화 품질을 증명하지 않음
  - Phase 4A는 전체 decision status, lane, ranking 또는 top selection을 만들지 않음
- Privacy or retention impact:
  - 새 production store나 retention window를 만들지 않고 기존 request-time evidence
    graph에서 current projection을 계산
  - API는 local-only, safe-origin, no-store이고 내부 오류를 sanitized code로 제한
  - projection/UI는 opaque candidate/claim/relation/conflict refs, bounded task kind,
    status, route와 reason code만 노출
  - repository name, title, URL/native object ID, Codex prompt/answer/reasoning,
    command/output/diff/path/tool payload와 credential을 저장하거나 반환하지 않음
  - baseline artifact는 synthetic sanitized metadata만 `.local/evaluations/
    attention-eligibility/`에 `0700` directory/`0600` exclusive file로 기록
  - production conversation과 implicit feedback을 Golden/Regression으로 자동 승격하지
    않음
- Compatibility:
  - `GET /api/work-relations` orchestration을 shared server function으로 추출했지만
    기존 response contract는 유지
  - 신규 `GET /api/attention/eligibility`는 local-only additive endpoint
  - Attention v0.3 input/result, v0.2 policy/rules, current decision, replay/monitor hash와
    기존 dataset은 변경 없음
  - exact dependency mismatch 또는 invalid projection은 거짓 ready response 대신
    sanitized fail-closed error
- Release decision:
  - Phase 4A current-only shadow candidate: 검증 통과, Attention Lab 관찰용으로
    허용
  - active Work Cockpit filtering/ordering 적용: 보류. Phase 4B candidate/lane/
    selection 계약과 별도 평가를 통과한 뒤 결정
  - formal Golden baseline은 실행하지 않음. frozen dataset을 수정하지 않고 별도
    mutable synthetic targeted baseline으로 shadow gate를 검증하기 때문
- Rollback method:
  - Attention Lab eligibility panel/client와 `/api/attention/eligibility`를 제거
  - `src/eligibility`, synthetic evaluator/config/cases와 baseline runner를 제거
  - shared current evidence function의 내용을 기존 `/api/work-relations` route로 되돌림
  - 신규 store/migration이 없어 data migration, purge 또는 backfill이 필요 없음
  - Attention semantic contract를 변경하지 않아 Attention rollback은 필요 없음
- Follow-up work:
  - Phase 4B managed Codex current failure/recovery와 configured follow-through candidate
  - eligible set의 lane classifier, deterministic within-lane ranking과 selection
  - user-review → `needs_clarification`, refresh → `insufficient_evidence`, scoped
    `no_action` decision route
  - same server-side graph에서 active Attention result/replay version integration
  - human-reviewed frozen Golden/holdout와 explicit local rollout approval
  - Phase 4C local supervisor와 Raycast shortcut launcher

## 2026-08-03 Phase 4B active Attention decision and workflow follow-through

- Date: 2026-08-03
- Owner: Codex with human direction
- Goal:
  - Phase 4A current-only eligibility shadow를 Work Cockpit의 실제 한 가지 제안으로
    승격
  - GitHub direct-work, Blabase-owned managed Codex direct failure와 사용자가 설정한
    완료 후속 작업을 하나의 exact evidence-bound decision으로 결합
  - candidate hard gate 뒤 lane, deterministic ranking, clarification/no-action과
    explanation을 같은 replayable contract로 기록
  - managed recommendation을 열 때 계산 당시 binding/execution identity가 여전히
    current인지 재검증
- This record supersedes:
  - 위 Phase 4A record의 `active Work Cockpit filtering/ordering 적용: 보류`와
    Phase 4B follow-up 항목. Phase 4A 당시의 판단과 baseline 값은 역사적 기록으로
    그대로 보존한다.
- Affected pipeline stages:
  - current GitHub/managed Codex evidence graph assembly와 archived project exclusion
  - active candidate derivation, eligibility, deduplication, recovery/supersession
  - `must_now | unblock | close_loop | focus` lane과 within-lane ordering
  - weekly outcome inheritance, full eligible alternatives와 deterministic explanation
  - project workflow configure/clear/closure projection과 2분 grace
  - active Work Cockpit, Attention Lab, `/api/attention`, polling/invalidation
  - monitor run/failure validation, private replay persistence와 exact local replay
  - Work Resumption open route/store/client의 expected binding/execution check
  - GitHub same-native PR compatible-role claim derivation
  - active/Claim Authority/Eligibility synthetic evaluation
- Behavior before:
  - Work Cockpit top result는 Phase 2 GitHub 중심 result였고 Phase 4A eligibility는
    Attention Lab current-only shadow에만 존재
  - managed Codex의 direct failure와 completion은 관찰 UI에만 표시되고 실제
    candidate/lane/selection을 만들지 않음
  - project별 completion workflow를 저장·적용·닫는 계약이 없음
  - user-review conflict와 source-refresh uncertainty가 active result로 연결되지 않음
  - replay v1과 monitor v0.3은 Phase 4A shadow/managed workflow evidence를 exact
    active input으로 보존하지 않음
  - managed recommendation open은 현재 binding identity와 계산 당시 identity의
    차이를 route/store 경계에서 확인하지 않음
  - 같은 pull request가 authored와 review-requested query에 함께 나타나면
    compatible role을 critical relationship conflict로 잘못 만들 수 있었음
- Behavior after:
  - hard eligibility를 통과한 GitHub direct-work, unrecovered managed direct failure,
    configured follow-through를 deterministic candidate set으로 생성
  - 동일 대상의 더 최신 managed attempt/state는 오래된 failure를 supersede하고,
    failure가 follow-through나 generic candidate보다 우선하도록 deduplicate
  - normal running/recent completion, inventory/history-only Codex, workflow가 없는
    completion, inactive link, archived project·archived project workflow와
    incompatible action/target을 제외
  - workflow는 기본 `unknown`; explicit configure 시각 이후 시작된 exact managed
    run에만 적용하고 completion 뒤 `120000ms` grace, closure와 artifact evidence를
    검사
  - `create_pull_request`는 issue, `request_review`는 사용자가 작성한 pull request
    target에서만 허용
  - relevant unresolved `user_review` conflict만 `needs_clarification`, refresh/history/
    liveness gap은 `insufficient_evidence`, complete negative coverage는 scoped
    `no_action`으로 반환
  - eligible 후보가 있으면 aggressive evidence-bound policy로 한 개를 선택하고
    나머지 전체 ranking과 caveat를 보존
  - active result와 그 계산에 사용한 exact eligibility projection을 response,
    monitor v0.4와 replay v2에 함께 보존하고 local replay 시 전체 output을 비교
  - source sync, normalization과 resolver를 포함한 production route 전체 latency를
    run timing으로 기록
  - Work Resumption open은 expected binding ID와 execution ID를 둘 다 요구하거나
    둘 다 생략하도록 하고, current identity가 다르면 `409
    BINDING_IDENTITY_CHANGED`로 fail closed
  - browser client도 expected identity pair가 한쪽만 존재하면 network mutation 전
    local fail-closed
  - same-native PR multi-role은 exact native identity가 모두 같을 때 action-driving
    review role 하나를 relationship claim으로 선택하고, identity가 다르면 기존
    conflict 경계를 유지
  - managed failure 제안에서 세션을 여는 것 자체는 resolution/snooze가 아니며 더
    최신 direct state/run이 없으면 다시 제안될 수 있음
- Versions before:
  - active input/result/candidate/lane/ranking/resolver: 없음
  - live orchestrator: `attention-live-orchestrator-v0.2`
  - monitor/replay: `attention-monitor-run-v0.3` /
    `attention-replay-input-v1`
  - monitor failure: `attention-monitor-failure-v0.2`
  - Cross-source Attention: input/result v0.3, policy v0.2
  - Claim resolver: `cross-source-claim-resolver-v0.1`
  - project workflow store/schema/policy: 없음
  - Work Resumption: v1 contract, expected identity field 없음
- Versions after:
  - active input/result: `cross-source-active-attention-input-v0.4` /
    `cross-source-active-attention-result-v0.4`
  - active policy: `aggressive-evidence-bound-attention-policy-v0.3`
  - candidate rule: `github-managed-codex-active-candidate-rule-v0.1`
  - lane/ID: `active-attention-lane-policy-v0.1` /
    `active-attention-id-v0.1`
  - ranking/resolver: `active-attention-ranking-policy-v0.2` /
    `active-attention-decision-resolver-v0.3`
  - live orchestrator/freshness: `attention-live-orchestrator-v0.4` /
    `attention-live-freshness-policy-v0.1`
  - monitor/replay/failure: `attention-monitor-run-v0.4` /
    `attention-replay-input-v2` / `attention-monitor-failure-v0.3`
  - workflow store/schema/policy/projection/ID:
    `project-workflow-store-v0.1` / `project-workflow-schema-v0.1` /
    `project-workflow-follow-through-policy-v0.1` /
    `project-workflow-projection-v0.1` / `project-workflow-id-v0.1`
  - Claim resolver: `cross-source-claim-resolver-v0.2`; claim/projection/authority/
    evidence schema는 v0.1 유지
  - Work Resumption: v1 contract 유지, optional expected binding/execution pair를
    additive하게 추가
  - Phase 2 input/result v0.3과 policy v0.2는 `baseResult` compatibility용으로 유지
- Code commit:
  - suggestion subtree base commit:
    `6209a07b05d7df77d08c643c04d62bf9f0c55cad`
  - base subject: `feat(suggestion): add phase 4a eligibility shadow`
  - candidate run code state: `dirty_worktree`
  - final active baseline code fingerprint:
    `71b0319dfc2e53866081c6b9b73f0ed1815c1fb5204a2a3b75edeae7d32e72a3`
  - pre-audit active candidate code fingerprint:
    `eb9557c5e7dc28a2009ec81722dae5c396bc9e2c208e30acbed7320fccf58e71`
  - Claim/Eligibility compatibility baseline code fingerprint:
    `6ec1896adacc92f474b9894a903095cf74667dcd680922c4eb542e6dee6cc0d5`
  - 각 fingerprint는 pre-audit active candidate, dependency compatibility run과
    final safety-audit active baseline의 서로 다른 dirty-worktree 시점을 정직하게
    보존한다.
  - final release commit: 생성하지 않음 — 이 작업에서는 commit 요청을 받지 않음
- Active evaluation dataset version and SHA-256:
  - family/version: `suggestion-active-attention-dev-v0.1`
  - revision/class/lifecycle: `2` / mutable synthetic Dev Candidate / mutable
  - input boundary: `exact_phase4b_replayable_evidence_envelope`
  - data origin/production data: `bounded_synthetic` / `false`
  - case count: `44`; expected/observed assessments: `80/80`
  - canonical SHA-256:
    `e10bf1fa0415e39003f5d03d760feb75dbe13dac1e606253e78ebb1ab9f0f290`
  - materialized input SHA-256:
    `b1b467a42f1de6564e1a2d08a48b3823c74077fe87c9eb8af4318112480e1c58`
  - config immutable ref: `eval/synthetic/activeAttentionDecisionConfig.v0.2.json`
  - config SHA-256:
    `f8da1f5c0b8f55aaa6acffbd6885bdf4a1a759ca0c0f3cf61d84dcb35b6df30b`
  - deterministic output SHA-256:
    `1be64deabff76cc625de4e7ac8dd292fe5d403380cbdf9308cb6108dbaa3a276`
- Candidate run ID:
  `active_attention_eval_run_1a661f6515069b5721c9bbce775677d2`
- Comparison run ID:
  - 없음. revision 1과 revision 2는 dataset/config/resolver가 달라 직접 metric
    comparison으로 취급하지 않음
- Historical pre-audit active candidate:
  - run `active_attention_eval_run_325d24b34e38226344b2adbc11f1648f`
  - revision `1`, cases `42/42`, assessments `76/76`
  - dataset SHA-256
    `3fe00665ca62dd34e65289c6620905776314ac1c759aed849b8b3085e536c9b2`
  - materialized input SHA-256
    `081a1ff7f2587ea98bd3bb197bfb553392d1e722169c81d063505261511adcfd`
  - config `eval/synthetic/activeAttentionDecisionConfig.v0.1.json`, SHA-256
    `3433e9dcd52f7e8903c158c2993d98e3f7b5ff91e46d039b989478c53c762d16`
  - deterministic output SHA-256
    `51f04bc5f06ba13a22b1f340539c193e572b39a731095132fc35bf62b878b880`
  - canonical payload/file SHA-256
    `7366de3d5237f4b8af1215eeaaedce3d304f5cd684b73c227cdf859de1c80e77` /
    `c15a262110f749a0ccbe1a75ebf83f7480ea404ce42a6baade6858bddc1afdbe`
  - archived-project workflow, authored-PR review gate와 client partial identity
    audit 전 candidate history이며 final release baseline이 아님
- Active artifact:
  - path:
    `.local/evaluations/active-attention/active_attention_eval_run_1a661f6515069b5721c9bbce775677d2.json`
  - canonical record payload SHA-256:
    `f8c9311a46f2893225f0c378cd24ad410877573ad4c5a49daea81efaba6f3f80`
  - file artifact SHA-256:
    `c4606ff0d7db7e20dfc7d6b60bda863c8bd619457df0a1a616b468bd7bca80d7`
  - file mode: `0600`
- Compatibility evaluation records:
  - Claim Authority revision `2`:
    - run `claim_authority_run_0079980ec2ea503ca9718bc48f8846e6`
    - cases `40/40`, resolutions `42/42`, conflicts `9/9`
    - dataset SHA-256
      `809e459b2e27e26791ce20ba4599450818425b48603ba76cb2a8cad45544fe4d`
    - materialized input SHA-256
      `12f1eb24d6522170e828bfbf406b324d8d2d600b7a9013016d6c6adf95d5f8f1`
    - deterministic output SHA-256
      `34e560c4894f1b84c66348779a804fb014fdd01f28d70088c49a9163ce0a654a`
    - artifact SHA-256
      `0d2c04922a4746113fea55f33f3fe683466ae8188205c1b08d174f1cef5cf452`
  - Attention Eligibility revision `2`:
    - run `attention_eligibility_run_acaa74c69c3f8fa721eeb253d9916400`
    - cases `26/26`, assessments `24/24`
    - dataset SHA-256
      `7e53abbdf7ccf64ec30152c3fdd0c08161db10f5e2b191286745cbe729bb0343`
    - materialized input SHA-256
      `1d1a2ab3fd41cc53a2437e74b874b988fdeb5d7794fd105f2a401da75745f034`
    - deterministic output SHA-256
      `da6814647c9425fe088940cf8b6407af90a1ed310bd7291d58d84fc3c73fb5a3`
    - artifact SHA-256
      `0f288303d126efd0d08eab735f4da4afe7dea0470a19b7b40f73c51edb0a5490`
  - Claim/Eligibility는 frozen Golden이 아닌 mutable Dev Candidate revision `2`다.
    이전 revision artifact를 덮어쓰지 않았고 frozen dataset은 변경하지 않음
- Commands executed:
  - `npm run active-attention:baseline`
  - `npm run claim-authority:baseline`
  - `npm run attention-eligibility:baseline`
  - active resolver/evaluator, workflow store/API/client, monitor compatibility,
    managed artifact invalidation와 Work Resumption exact identity focused Vitest
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e -- e2e/work-resumption.spec.ts`
  - `git diff --check`
- Metrics changed:
  - active exact cases: `44/44`; assessments `80/80`
  - assessment precision/recall: `1.0/1.0`
  - schema/hash/status/review-route/lane/rank, Phase 2 truncation, weekly focus loss,
    unsafe/recovered/unhealthy candidate leakage, workflowless/archived-project/
    incompatible/retroactive/grace/closed/artifact leakage, duplicate loop, refresh/user-review,
    unavailable/inactive-link/scoped-no-action, integrity/evidence graph/upstream,
    privacy/raw Codex, ordering/determinism/config guardrail: 모두 `0`
  - full unit/integration regression: Vitest `79/79` files, `670/670` tests passed
  - 신규 regression: archived-project workflow 제외, review-requested 다른 사용자
    PR 제외, client partial expected identity local fail-closed와 명시적 빈 identity
    pair의 server 검증
  - browser Work Resumption E2E final rerun: Chromium `3/3` passed (`7.8s`)
  - `npm run typecheck`, `npm run lint`, production `npm run build`: passed
  - final active baseline latency: `609ms`
  - provider/model/prompt/token usage: `not_applicable`; deterministic rule-only
- Regressions or accepted exceptions:
  - mutable synthetic Dev Candidate는 human-reviewed Gold가 아니며 production
    distribution이나 실제 사용자 유용성을 추정하지 않음
  - managed candidate 범위는 direct failure와 configured follow-through. verified
    stall, scope drift, meaningful progress와 approval/input escalation은 후속
  - Notion과 Calendar는 context-only이며 candidate/fit을 만들지 않음
  - native draft state가 없는 GitHub review는 실제 review action이 아닌 현재
    bounded inspection 경계를 유지
  - 실패 suggestion을 여는 것은 resolution/snooze가 아니므로 direct state가
    바뀌기 전 반복 노출될 수 있음
  - 동일 target의 managed run이 같은 millisecond `startedAt`을 가지면 현재 evidence로
    authoritative newer ordering을 증명할 수 없어 오래된 failure supersession이
    지연될 수 있음. 임의 ID tie-break를 최신성 근거로 사용하지 않으며 후속
    monotonic run-start sequence 계약이 필요
  - pre-audit 기간에 `monitor v0.4` 또는 failure v0.3을 resolver v0.2로 저장한
    local record가 있다면 current v0.3 replay reader가 semantic 재현을 보장할 수
    없어 store read가 fail closed할 수 있음. 현재 local monitor store에는 해당
    record가 없음을 확인했으며, formal release 전 versioned migration 또는 안전한
    invalidation 계약이 필요
  - workflow local file mutation serialization은 단일 Node process만 보장하며
    multi-process production 전 durable transactional store/lock이 필요
- Privacy and retention impact:
  - active input/monitor/API/UI에는 raw prompt, answer, reasoning, command/output,
    diff/path/thread, repository title/name/URL을 새로 노출하지 않음
  - project workflow store는 `.local/context/project-workflows.json` mode `0600`에
    opaque project/run/binding/execution ID, enum과 timestamp만 append-only 저장;
    decision `10,000`, closure `50,000` 상한
  - private replay v2는 기존 최대 `30일` retention을 유지하고 제품 API와 Git에
    노출하지 않음. monitor metadata도 기존 최대 `30일` 정책 유지
  - evaluation artifact는 synthetic sanitized metadata만 포함하고 mode `0600`
  - production conversation, raw Codex content, implicit feedback을 Golden/Regression
    dataset으로 승격하지 않음
  - external GitHub/Notion/Calendar mutation, prompt 전송, approval 응답 또는
    Codex retry를 자동 실행하지 않음
- Compatibility:
  - Phase 2 base result를 `baseResult`로 보존하고 monitor/replay v1 및 monitor
    v0.1/v0.2/v0.3 read compatibility 유지
  - active v0.4 route/client/monitor는 exact version/dependency mismatch를 fail closed
  - Claim resolver v0.2와 Eligibility revision 2 baseline으로 same-PR multi-role
    교정이 Phase 3C/4A behavior를 깨지 않음을 확인
  - Work Resumption callers가 expected identity를 보내지 않는 기존 수동 open은
    v1 compatibility를 유지하고, active managed recommendation 경로만 exact pair를
    요구
  - browser client는 partial identity를 local에서 거부하고, 명시적으로 전달된 빈
    identity pair를 truthy 검사로 생략하지 않아 server schema 검증이 fail closed
- Release decision:
  - Phase 4B local beta active Work Cockpit/Lab 사용: 허용
  - formal production release 또는 human-approved quality claim: 보류
  - frozen Golden baseline: 실행하지 않음. mutable synthetic Dev Candidate와
    targeted compatibility baseline만 사용
  - 외부 source write/자동 Codex 제어 확대: 허용하지 않음
- Rollback method:
  - `/api/attention`과 `liveAttention`에서 active result를 제거하고 Phase 2
    `baseResult` presentation으로 복귀
  - Work Cockpit/Lab active panels와 workflow UI/API/client/store consumer를 제거
  - monitor v0.4/replay v2 writer를 제거하되 이전 reader compatibility는 유지
  - Work Resumption active-open expected identity 전달을 제거하고 기존 v1 manual
    open 경로로 복귀
  - active 기능은 Phase 2 `baseResult`로 비활성화한다. v0.2/config v0.1/revision 1은
    알려진 safety-audit gap이 있는 historical artifact로만 보존하고 재활성화하지 않음
  - Claim resolver/client expectation과 Claim/Eligibility mutable dataset을 v0.1/
    revision 1 behavior로 함께 복귀
  - 신규 database migration이나 external write가 없어 backfill/remote cleanup은
    필요 없음. local workflow file은 inert audit artifact로 보존 가능
- Follow-up work:
  - Phase 4C local supervisor와 단축키/Raycast launcher
  - formal release 전 pre-audit resolver v0.2 monitor/failure record migration 또는
    안전한 invalidation
  - managed failure explicit acknowledgement/snooze와 재노출 정책
  - verified meaningful progress, stall, scope drift와 stable request escalation
  - native GitHub closed/merged/draft coverage 강화
  - Notion task property mapping과 Calendar free-block/first-step
  - explicit feedback/correction ledger, independent human review/adjudication,
    Cross-source Golden과 locked holdout

## 2026-08-03 Phase 4C macOS native launcher and bundled Local Agent

- Date: 2026-08-03
- Owner: Codex with human direction
- Goal:
  - 별도 웹 Work Cockpit을 유지하면서 macOS 메뉴바에 상주하는 native launcher를
    제공
  - `⇧ Space`로 Phase 4B가 선택한 현재 제안 한 개, 근거, 첫 단계와 평가하지 못한
    source를 즉시 표시
  - 사용자가 명시적으로 실행할 때만 exact current identity를 재검증해 기존 Codex
    작업을 focus/resume
  - source checkout이나 사용자 설치 Node에 의존하지 않는 `.app`과 개발용 DMG 생성
- This record supersedes:
  - 위 Phase 4B record의 `Phase 4C local supervisor와 단축키/Raycast launcher`
    follow-up. Phase 4B engine/baseline 기록과 값은 변경하지 않는다.
- Affected pipeline stages:
  - Active Attention result의 public launcher projection
  - Local Agent JSONL request/response transport와 child-process lifecycle
  - explicit Work Resumption execution의 stale/current identity 및 중복 요청 gate
  - macOS menu bar, global hotkey, floating panel, login item과 URL open boundary
  - bundled Node/Agent build, app signing, DMG packaging과 local verification
- Behavior before:
  - 현재 제안은 Work Cockpit/Attention Lab 웹 UI에서만 확인 가능
  - Work Resumption Companion을 별도 terminal process로 실행해야 함
  - 설치형 macOS host, global shortcut, login-start와 fixed Local Agent runtime이 없음
- Behavior after:
  - AppKit accessory app이 메뉴바에 상주하고 Carbon `⇧ Space`를 등록해 SwiftUI
    floating panel을 현재 Space 중앙에 표시
  - launcher는 자체 candidate/ranking을 만들지 않고 현재 Active Attention top
    suggestion만 `blabase-launcher-attention-v1`로 투영
  - `suggested`, `needs_clarification`, `no_action`, `insufficient_evidence`와
    unavailable source를 모두 정상 화면 상태로 표시
  - GitHub action은 exact `https://github.com/{owner}/{repo}/issues|pull/{number}`만
    열고 query/fragment/userinfo/port와 다른 host/path는 거부
  - Codex action은 cached result/candidate와 current top, binding/execution identity,
    Companion liveness를 실행 직전에 다시 확인
  - 같은 process의 동일 `resultId + candidateId` 반복 실행은 새 command를 만들지
    않고 최초 command 상태를 반환하며 UI도 처리 중 Enter/버튼을 비활성화
  - Agent stdin write는 serial queue에서 수행하고 Task 취소 시 pending continuation과
    timeout을 즉시 정리. malformed/oversized response는 fail closed하고 bounded
    restart 적용
  - JSONL input은 64 KiB 고정 byte buffer로 처리해 split oversized frame 전체를
    메모리에 보관하지 않고 다음 delimiter 뒤 정상 request부터 복구
  - 표시된 recommendation은 `asOf` 뒤 5분이 지나면 실행 전에 stale로 거부
  - 기본 Application Support root는 bundle Agent가 유일한 `managed` source sync
    writer이고, 명시적 data-root override는 자동 `read_only`가 되어 scheduler,
    source sync와 monitor history write를 수행하지 않음
  - release build는 bundle의 고정 Node/Agent만 실행하고 data-root symlink의 `/`와
    HOME 우회, standalone CLI의 symlink/미존재 leaf 우회, `NODE_OPTIONS`,
    `NODE_PATH`, `DYLD_*`, `LD_PRELOAD` 주입을 거부
  - build 시 commit 또는 dirty-worktree fingerprint와 bundled Agent SHA-256을
    runtime manifest에 기록하고, 설치 host는 ambient provenance를 제거한 뒤 검증된
    manifest provenance만 Agent에 전달
  - `/Applications` 또는 user Applications 설치본만 `SMAppService` 자동 등록을
    시도하고 requires-approval이면 System Settings로 안내
  - notarized release script는 Node JIT 예외와 Node/host Apple Events entitlement를
    모두 확인하지 못하면 중단
  - 앱 종료 시 scheduler, Companion과 child Agent가 함께 종료
- Versions before:
  - launcher IPC/projection/execution/runtime manifest: 없음
  - Active Attention/Work Resumption: Phase 4B versions 유지
- Versions after:
  - IPC: `blabase-launcher-ipc-v1`
  - attention projection: `blabase-launcher-attention-v1`
  - execution projection: `blabase-launcher-execution-v1`
  - bundled runtime manifest: `blabase-launcher-runtime-manifest-v1`
  - Active Attention input/result/policy/ranking/resolver: 변경 없음
  - Work Resumption storage/queue contract: 변경 없음
- Code commit:
  - suggestion subtree base commit:
    `54d3f174fa83cf1a05096d6aa485cb1c03f3eac0`
  - base subject: `feat(suggestion): complete phase 4b active attention`
  - implementation state: `dirty_worktree`
  - final release commit: 생성하지 않음 — 이 작업에서는 commit 요청을 받지 않음
- Evaluation dataset and run:
  - 새 dataset/run 없음
  - engine input, candidate, eligibility, lane, ordering, selection과 explanation을
    변경하지 않아 frozen Golden과 Phase 4B baseline 재실행 대상이 아님
  - production conversation, implicit feedback 또는 실제 launcher 표시 결과를
    Gold로 승격하지 않음
- Commands executed:
  - launcher/provenance focused Vitest (`5` files, `41` tests)
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - Swift debug/release build with local SDK compatibility override
  - `npm run launcher:swift:smoke`
  - bundled Agent esbuild/JSONL process smoke
  - `.app` build, `codesign` verification, DMG create/checksum/read-only mount verification
  - actual app launch with existing local data root, refresh, accessibility inspection와
    `Esc` close
  - `git diff --check`
- Metrics and verification:
  - full Vitest: `83/83` files, `702/702` tests passed
  - launcher/provenance focused: `41/41` passed
  - typecheck, lint, Next.js production build: passed
  - Swift debug/release build and XCTest-independent model smoke: passed
  - authored Swift XCTest: 이 머신의 Command Line Tools에 XCTest module과 full
    Xcode가 없어 미실행; external beta CI에서 필수
  - actual UI: 당시 기본값 `⌥ Space`의 hotkey registration success, current
    `insufficient_evidence`, scope와 `미평가: GitHub` rendering, refresh와 Esc close를
    확인. 이후 기본값 `⇧ Space` 변경은 Swift build/model smoke로 검증
  - final development DMG: 약 `40 MB`; exact SHA-256은 Git 밖의 생성된
    `Blabase-dev-beta.dmg.sha256` sidecar에 기록
  - provider/model/prompt/token usage: `not_applicable`; launcher가 LLM을 호출하지 않음
- Regressions or accepted exceptions:
  - Developer ID certificate와 notarization credential이 없어 ad-hoc local beta만 생성
  - full Xcode가 없어 Swift XCTest execution은 보류했으나 tests는 source에 포함
  - default `~/Library/Application Support/Blabase`에 기존 prototype connector data를
    자동 복사하는 first-run migration/settings UX는 아직 없음
  - server-authoritative recommendation과 multi-device state는 후속이며 현재 beta는
    local engine/Local Agent가 권위
  - 실제 Codex/GitHub primary action은 외부 동작을 만들지 않기 위해 수동 UI
    검증에서 누르지 않았고 unit regression과 exact allowlist로 검증
- Privacy and retention impact:
  - IPC projection에는 raw prompt/answer/reasoning, command/output/diff, native thread
    ID, project cwd, replay input, credential과 token을 포함하지 않음
  - `.app`/DMG에는 `.local`, `.env*`, credential, token, production record를 포함하지
    않고 Node license와 bundle dependency notice만 포함
  - Local Agent는 기존 data-root 아래 store/retention 계약을 재사용하며 새 cloud
    telemetry나 remote retention을 추가하지 않음
  - shared data-root override에서는 source sync와 monitor history를 쓰지 않고 저장된
    snapshot을 읽어 평가; root별 source sync writer를 하나로 제한
  - stderr는 `~/Library/Logs/Blabase/launcher-agent.log`에 sanitized code만 기록하고
    mode `0600`, `1 MiB`에서 이전 로그 한 개로 회전
  - external source mutation, 새 prompt 생성/전송, approval 응답, 자동 retry를
    추가하지 않음
- Compatibility:
  - Phase 4B Active Attention과 Work Resumption public contracts는 변경하지 않음
  - dashboard는 별도 URL로 유지하고 launcher projection은 향후 server-authoritative
    transport로 교체 가능한 versioned boundary
  - Windows는 동일 JSONL/public projection을 재사용하고 native host만 후속 구현 가능
- Release decision:
  - 이 Mac의 local development beta `.app`/DMG 사용: 허용
  - 외부 사용자 배포: Developer ID signing, notarization, full Xcode test와 first-run
    data/config UX 전까지 보류
  - production quality 또는 human-approved 유용성 주장: 보류
- Rollback method:
  - macOS launcher 앱과 Local Agent process를 종료하고 `.app`/DMG를 제거
  - `src/launcher`, `tools/launcher-agent.ts`, `desktop/macos`와 package scripts를 제거
  - 기존 Work Cockpit, Active Attention, source store와 Work Resumption 데이터는
    launcher와 독립적이므로 migration/backfill 없이 그대로 유지
- Follow-up work:
  - full Xcode CI에서 Swift XCTest 실행
  - 실제 Developer ID hardened-runtime signing, Terminal automation permission E2E와
    Apple notarization
  - first-run connector/data-root migration 및 설정 UI
  - production server-authoritative recommendation transport와 multi-device sync
  - pre-audit resolver v0.2 monitor/failure record migration 또는 안전한 invalidation
  - Windows native host

## 2026-08-04 Phase 4C.1 first-run data setup and persisted launcher configuration

- Date: 2026-08-04
- Owner: Codex with human direction
- Goal:
  - 설치 직후 어떤 Blabase store를 평가할지 사용자가 명시적으로 확인하기 전에는
    Local Agent를 시작하지 않음
  - 기본 Application Support store와 기존 Blabase store 연결을 안전하게 구분하고,
    기존 store에는 source `read_only` ownership을 강제
  - 별도 웹 Work Cockpit URL, 현재 source 평가 범위와 설정 복구 상태를 native
    settings UI에서 확인
- This record supersedes:
  - 위 Phase 4C record의 `first-run connector/data-root migration 및 설정 UI`
    follow-up. Active Attention/Work Resumption의 semantic baseline과 결과 계약은
    변경하지 않는다.
- Affected pipeline stages:
  - macOS launcher startup gate와 child Agent lifecycle
  - runtime data-root/source-mode configuration selector
  - launcher dashboard navigation preference와 source availability display
  - UserDefaults configuration persistence, legacy environment migration과 recovery
- Behavior before:
  - 앱 시작 즉시 Agent를 load하고 기본 Application Support root를 만들거나
    `BLABASE_LAUNCHER_DATA_ROOT` 환경변수를 사용
  - data root와 dashboard URL은 환경변수 기반이며 native Settings scene은 비어 있음
  - 설정 변경용 Agent stop/wait/restart transaction과 persisted schema가 없음
- Behavior after:
  - versioned 설정을 명시적으로 완료하기 전에는 Agent request/process와 managed data
    root 생성을 시작하지 않고 first-run window를 표시
  - `managed_default`는 physical
    `~/Library/Application Support/Blabase`의 non-symlink directory만 허용하고
    유일한 source writer로 시작
  - `existing_read_only`는 사용자가 `.local`의 부모 root를 선택해야 하며 physical
    path, readable/writable `.local`과 알려진 regular store marker를 검증한 뒤 source
    sync/scheduler/Attention monitor write를 차단
  - `read_only`는 filesystem 전체 불변이 아니라 source ownership mode다. Codex
    Work Resumption queue, heartbeat와 만료 command 정리는 같은 root에 제한적으로
    기록될 수 있음
  - 설정에는 schema/revision, data-root choice/physical path, allowlisted dashboard
    origin과 onboarding 완료 상태만 저장. source mode 문자열, token, credential,
    snapshot 내용은 저장하지 않음
  - 손상/unknown schema, 사라진 root, identity/symlink 변경과 exhausted revision은
    managed root로 fallback하지 않고 setup-required로 복귀
  - 이전 `BLABASE_LAUNCHER_DATA_ROOT`/`BLABASE_DASHBOARD_URL`은 설정이 전혀 없는
    first-run candidate로만 표시하고 자동 적용하지 않음. 명시적으로 저장된
    preference가 이후 ambient environment보다 우선
  - root 변경은 pending UI work와 supervisor restart를 취소하고 이전 Agent의 실제
    종료를 bounded wait로 확인한 뒤 `activate → persist → load` 순서로 적용. stop이나
    activation 실패 시 새 설정을 저장하거나 동시 Agent를 시작하지 않음
  - configuration generation이 오래된 load/action response가 새 화면을 덮어쓰지
    못하게 함. dashboard-only 변경은 Agent를 재시작하지 않음
  - dashboard origin은 `https://app.blabase.com`과
    `http://localhost|127.0.0.1[:port]`만 저장·열 수 있음
  - 설정 화면은 root draft와 현재 projection을 섞지 않고 loading/error/setup/
    unavailable source 상태를 구분해 표시
- Versions before:
  - launcher settings schema/data-root policy: 없음
  - local launcher contract: Phase 4C v0.1
  - launcher IPC/attention/execution/runtime manifest: v1 유지
- Versions after:
  - launcher settings schema: `launcher-settings-schema-v1`
  - settings storage key: `com.biadone.blabase.launcher.settings.v1`
  - data-root selector policy: `launcher-data-root-policy-v0.2`
  - local launcher contract: Phase 4C.1 v0.2
  - launcher IPC/attention/execution/runtime manifest: 변경 없음
  - Active Attention input/result/policy/ranking/resolver: 변경 없음
- Code commit:
  - suggestion base commit:
    `3d5969d2dcb791f62e69f64066f8b8032ac6ad3c`
  - base subject: `feat(blabase): add native macOS attention launcher`
  - implementation state: `dirty_worktree`
  - packaged runtime code fingerprint:
    `503fed8f56dd14aaaece7404d42803a31c6661aff328593982c75ac6c22ec321`
  - implementation commit:
    `feat(blabase): add first-run launcher data setup` (이 change record를 포함한 commit)
- Evaluation dataset and run:
  - 새 dataset, candidate run ID와 comparison run ID 없음
  - 선택한 store가 runtime `cwd`/snapshot input source를 바꿀 수 있어 이 Engine
    Change Record는 남기지만, candidate eligibility, lane, filtering, ordering,
    selection과 explanation 의미는 변경하지 않음
  - frozen Golden과 Phase 4B semantic baseline은 재실행하지 않음. 기존 mutable
    synthetic Dev Candidate나 production 결과를 Gold로 재분류하지 않음
- Commands executed:
  - full `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - Swift debug/release build with MacOSX15.4 SDK and sandbox compatibility override
  - `launcher:swift:smoke` equivalent script
  - `swift test` attempt
  - `.app` build, ad-hoc nested/outer `codesign` verification
  - DMG create, checksum, read-only mount와 mounted app verification
  - actual app first-run accessibility tree/screenshot inspection and quit
  - `git diff --check`
- Verification and metrics:
  - full Vitest: `83/83` files, `702/702` tests passed
  - typecheck, lint, Next.js production build: passed
  - Swift debug and release build: passed
  - XCTest-independent smoke: settings codec/fresh setup/persisted precedence,
    root/marker/URL rejection, revision overflow, transaction order/stop failure,
    actual `/bin/sh` child pending disconnect/stop/restart passed
  - Swift XCTest source를 settings round-trip, missing-root fail-closed, legacy candidate,
    dashboard/root apply plan과 privacy assertion으로 확장. 현재 Command Line Tools에
    `XCTest` module이 없어 실행은 full Xcode CI로 보류
  - final development DMG: 약 `40 MB`, SHA-256
    `72a0b54fea3da692a5786465267ab226e9c36688f4aaeb16f8544640df81f67c`
  - app/DMG signature, runtime manifest/Agent hash, checksum와 mounted layout: passed
  - actual first-run UI: Agent 시작 전 managed/existing choice, dashboard URL,
    네 source의 `저장 후 확인`, fixed bottom `설정 저장 및 시작` button과 dashboard
    accessibility label 확인
  - provider/model/prompt/token usage: `not_applicable`; deterministic local config/UI
- Regressions or accepted exceptions:
  - dashboard URL은 navigation destination이며 선택한 data root와 동일한 snapshot을
    본다는 handshake가 아직 없음. local Work Cockpit은 선택 root를 소유한 process로
    실행해야 하며 Cloud/local data bridge도 후속
  - source `read_only`는 Work Resumption runtime state write까지 차단하지 않음
  - 실제 filesystem integration에서 connector snapshot/Attention monitor 불변과
    Resumption-only write set을 함께 hash하는 테스트는 후속
  - full Xcode/XCUITest가 없어 NSOpenPanel, relaunch와 deterministic first-run UI
    automation은 보류
  - Developer ID/notarization credential이 없어 ad-hoc local beta만 생성
- Privacy and retention impact:
  - UserDefaults에는 physical absolute path와 allowlisted dashboard origin이 저장될 수
    있으나 네트워크, IPC projection, log, Git과 DMG에는 포함하지 않음
  - path selection은 marker의 존재/regular-file/readability만 확인하고 파일 내용을
    읽거나 token, OAuth credential, snapshot을 복사·이동·병합하지 않음
  - raw prompt/answer/reasoning, command/output/diff와 native Codex identity의 기존
    private retention 및 IPC exclusion 계약은 변경하지 않음
  - 새 cloud telemetry, remote retention, source mutation, approval 응답 또는 Codex
    retry를 추가하지 않음
- Compatibility:
  - Phase 4C launcher IPC/projection/execution과 Phase 4B Active Attention public
    contracts 유지
  - legacy environment는 fresh first-run migration candidate로만 호환하고 저장 뒤에는
    versioned preference가 우선해 UI/effective config 불일치를 방지
  - settings 변경 전 시작된 response는 generation mismatch로 폐기
- Release decision:
  - 이 Mac의 local development `.app`/DMG에서 first-run beta 사용: 허용
  - external beta: full Xcode tests, Developer ID signing/notarization과 dashboard/root
    handshake 전까지 보류
  - Golden/production quality claim: 변경 없음, 허용하지 않음
- Rollback method:
  - Phase 4C.1 settings window/store/policy를 제거하고 Phase 4C의 env/default runtime
    resolution으로 복귀
  - 저장된 UserDefaults Data는 inert local preference이며 source store나 connector
    data migration/backfill이 없어 보존하거나 사용자가 앱 설정을 초기화할 때 제거 가능
  - 선택한 기존 root의 source snapshot과 credential에는 migration을 수행하지 않아
    별도 복구가 필요 없음
- Follow-up work:
  - dashboard status API의 opaque root identity + snapshot revision handshake
  - shared-root filesystem integration: source/monitor 불변과 Resumption write set 검증
  - full Xcode Swift XCTest/XCUITest에서 folder picker, relaunch와 Agent lifecycle E2E
  - Developer ID hardened-runtime signing, Terminal automation permission와 notarization
  - server-authoritative recommendation/data bridge와 multi-device sync

## 2026-08-04 Phase 4C.2 launcher diagnostics and explicit local-root recovery

- Date: 2026-08-04
- Owner: Codex with human direction
- Goal:
  - 추천이 없을 때 일반적인 `안전하게 한 가지를 고르기 어렵습니다`
    문구 대신 decision 근거, 후보 수와 source별 차단 원인을 표시
  - fresh managed root와 기존 연결 data root가 분리된 상태에서 token·snapshot을
    복사하지 않고 사용자가 기존 root를 명시적으로 선택해 복구
  - 기존 root 선택 시 기본 Cloud dashboard를 그 root의 local Work Cockpit
    endpoint로 맞춤
- Affected pipeline stages:
  - launcher-only Attention public projection과 TypeScript/Swift decoder
  - macOS launcher no-suggestion/settings presentation
  - first-run/existing-root dashboard default selection policy
- Behavior before:
  - attention projection v1은 decision status, card, scope와 unavailable source만
    전달해 source 연결·수집·후보 범위 중 어디가 막혔는지 표시할 수 없음
  - fresh managed root에 source가 없어도 런처는 일반적 insufficient-evidence
    문구만 표시
  - 기존 root를 선택해도 기본 Cloud dashboard URL이 남아 local root와
    dashboard owner가 다를 수 있음
- Behavior after:
  - `blabase-launcher-attention-v2`가 bounded `decisionReasonCodes`, eligible/review/
    ineligible `candidateCounts`와 canonical GitHub/Codex/Notion/Google Calendar
    `sourceDiagnostics`를 필수로 전달
  - TypeScript schema와 Swift decoder가 decision/count, source state/reason, source 순서,
    signal count와 candidate completeness 불일치를 fail closed
  - no-suggestion 화면이 decision 설명, 후보 수와 2x2 source 진단을 표시하고
    GitHub·Codex 중 하나라도 `available`이 아니면 root ownership에 맞는
    복구 동작을 표시. existing root는 `/sources`, managed root는 native 설정을 열음
  - 기존 root를 선택할 때 dashboard가 기본 Cloud URL이면
    `http://localhost:3102`로 전환하고, 사용자가 명시한 다른 허용
    localhost URL은 보존
  - settings source 상태도 v2 diagnostic state와 signal count를 사용
  - no-suggestion 복구 버튼은 42 pt로 고정하고 launcher panel origin을 active
    screen visible frame 안으로 clamp
- Versions before:
  - launcher attention projection: `blabase-launcher-attention-v1`
  - local launcher contract: Phase 4C.1 v0.2
  - data-root selector policy: `launcher-data-root-policy-v0.2`
- Versions after:
  - launcher attention projection: `blabase-launcher-attention-v2`
  - launcher IPC/execution/settings schema: v1 유지
  - local launcher contract: Phase 4C.2 v0.3
  - data-root selection default policy: local recovery behavior 추가
  - Active Attention input/result/policy/ranking/resolver: 변경 없음
- Code commit:
  - suggestion base commit:
    `c60caf5821122b4e60c0800cd8cac571e75f7d96`
  - base subject: `feat(blabase): add first-run launcher data setup`
  - evaluation-time implementation state: `dirty_worktree`; 현재 record에서 commit을
    생성하지 않음
  - subsequent implementation commit:
    `8e2fe01af08f141ccbb3e424549620543f3c6857`
  - commit subject: `feat(blabase): add developer signal intelligence`
  - 위 검증은 commit 전에 실행됐으며 이 change는 이후 해당 commit에 함께
    materialize됐다. 기존 검증을 clean-commit run으로 소급하지 않음
- Evaluation dataset and run:
  - 새 dataset, Golden/Regression version, engine comparison run ID 없음
  - resolver input, candidate 생성, eligibility, filtering, ranking, selection과 explanation
    의미를 변경하지 않는 projection/configuration/UI 변경이므로 frozen Golden과
    Phase 4B semantic baseline은 재실행하지 않음
- Commands executed:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run launcher:swift:smoke`
  - `npm run launcher:app:build`
  - local same-origin `/api/sync/start`, `/api/sync` and `/api/attention` runtime check
  - `git diff --check`
- Verification and metrics:
  - full Vitest: `83/83` files, `704/704` tests passed
  - typecheck, ESLint, Next.js production build: passed
  - XCTest-independent Swift v2 model/presentation/settings smoke: passed
  - macOS release executable, bundled Agent, ad-hoc signature verification: passed
  - actual app accessibility/screenshot: decision reason, `0/0/0` candidate counts,
    GitHub disconnected, Codex 9 signals, Notion·Calendar diagnostic과 42 pt 복구 버튼
    표시 확인. sync 후 Codex가 available이어도 GitHub 하나가 disconnected이면
    `Source 연결 관리`가 남고 owner Work Cockpit `/sources` GET 200으로 이동함을 확인
  - final runtime: launcher host 1개, bundled Agent 1개가 선택한
    `/Users/nika/biadone/apps/blabase/suggestion` root를 사용함을 확인
  - local coordinator 명시적 sync: Codex·Notion latest snapshot success, GitHub
    `CONNECTOR_DISCONNECTED`, Google Calendar `REAUTHORIZATION_REQUIRED` 확인. 이후
    Attention은 GitHub coverage unavailable·Codex eligible candidate 0으로 계속
    `DECISION_RELEVANT_COVERAGE_INSUFFICIENT`
  - provider/model/prompt/token usage: `not_applicable`; deterministic projection/config/UI
- Regressions or accepted exceptions:
  - dashboard URL을 local로 맞추는 것은 navigation default이며 opaque root identity/
    snapshot revision handshake가 아님. local Work Cockpit process가 선택 root를 소유해야 함
  - 기존 root의 GitHub connector가 disconnected이거나 Codex snapshot이 candidate coverage를
    만족하지 못하면 진단은 정확히 표시되지만 추천을 조작해 만들지 않음
  - Command Line Tools 환경의 XCTest module 제약으로 full Swift XCTest는
    external beta CI의 full Xcode에서 계속 확인해야 함
- Privacy and retention impact:
  - v2에는 bounded decision/source code와 개수만 추가. raw prompt/answer/reasoning,
    command/output/diff, URL, native thread ID, cwd, credential과 token은 여전히 IPC에 없음
  - 기존 root 선택은 path/allowlisted dashboard URL만 preference에 저장하고
    token, OAuth credential와 snapshot을 복사·이동·병합하지 않음
  - 새 cloud telemetry, remote retention, source mutation과 production data 수집을 추가하지 않음
- Compatibility:
  - attention projection v1 consumer는 v2를 거부하므로 Node Agent와 Swift host는 같은
    app artifact로 함께 배포해야 함
  - launcher IPC/execution, Work Resumption, Phase 4B Active Attention public result와
    source snapshot schema는 변경 없음
- Release decision:
  - 이 Mac의 local development `.app`에서 사용: 허용
  - external beta: full Xcode tests, Developer ID signing/notarization과 dashboard/root
    handshake 전까지 보류
  - Golden/production recommendation quality claim: 변경 없음
- Rollback method:
  - Swift host/Node Agent를 같은 이전 app artifact로 돌려 attention projection v1로 복귀
  - local dashboard default selection policy를 제거. source store와 connector data migration은
    수행하지 않았으므로 rollback/backfill 필요 없음
- Follow-up work:
  - dashboard status API의 opaque root identity + snapshot revision handshake
  - GitHub OAuth 재연결과 Codex conversation/candidate coverage를 사용자 동의 후 완성
  - full Xcode Swift XCTest/XCUITest와 Developer ID/notarized external beta

## 2026-08-05 Developer Signal Intelligence v0.1 and actionable authored PRs

- Date: 2026-08-05
- Owner: Codex with human direction
- Goal:
  - GitHub·Codex normalized signal을 바로 점수화하지 않고 재현 가능한 Developer
    Work Ledger와 단계별 Candidate Funnel을 거치게 함
  - 본인이 연 PR에서 현재 확인된 failed checks, changes requested, merge conflict를
    실제 Attention 후보로 만들고, 단순 open/draft/unknown PR은 계속 제외
  - Codex prompt·answer·execution의 bounded 과거 맥락에서 open-loop claim을 추출하되
    currentness 검증 전에는 추천 후보로 승격하지 않음
- Affected pipeline stages:
  - GitHub App REST collection, snapshot validation과 WorkSignal normalization
  - Phase 4A eligibility와 Phase 4B Active candidate generation/ranking/explanation
  - Codex bounded WorkSignal → OpenLoopClaim adapter
  - runtime Work Ledger, Candidate Funnel과 public aggregate projection
  - live Attention API, Attention Lab observability와 monitor compatibility reader
- Behavior before:
  - authored PR은 context-only로만 보존되어 CI 실패·변경 요청·병합 충돌이 있어도
    후보가 될 수 없음
  - Codex normalized history는 overview였지만 명시적 미완료 claim과 그 근거를
    별도 lifecycle로 추적하지 않음
  - 추천 결과에서 source item이 collected 이후 어느 단계에서 제외됐는지 볼 수 없음
- Behavior after:
  - `github-snapshot-v3`가 최대 25개 authored PR을 대상으로 PR detail, reviews,
    Check Runs와 Commit Status를 bounded concurrency 4로 수집하고 snapshot-level
    actionability coverage를 complete/partial/unavailable로 기록
  - `checks_failed`, `changes_requested`, `merge_conflict`의 verified positive만
    authored PR eligibility를 통과하며 기본 lane은 `unblock`, intervention은 `do`
  - 보조 endpoint 실패나 cap은 negative coverage를 partial로 낮추지만 이미 확인된
    positive는 보존. unknown 상태는 actionability로 추정하지 않음
  - GitHub v2 snapshot은 기존 normalizer와 materialized hash를 유지하고 v3만 새
    actionability normalizer를 사용
  - Codex OpenLoop extractor가 goal, remaining work, blocker, verification needed와
    follow-through를 exact bounded field evidence, confidence, verification status,
    7일 expiry와 supersession 정보로 기록
  - Codex history claim은 private ledger에 들어가지만 funnel의 verified 단계에서
    rejected되고 eligibility/selection으로 진입하지 않음. 기존 managed-live Codex
    failure와 configured follow-through의 Active 의미는 유지
  - API는 ledger/funnel hash, entity·claim count와 여섯 단계 summary만 반환하며
    Attention Lab에서 현재 run의 수집→정규화→해석→검증→자격→선택 funnel을 표시
- Versions before:
  - GitHub snapshot/normalizer: v2 / `github-project-context-normalizer-v0.2`
  - eligibility policy/evidence/resolver: v0.1
  - Active result/policy/candidate/ranking/resolver: v0.4/v0.3/v0.1/v0.2/v0.3
  - live orchestrator/monitor run/failure: v0.4/v0.4/v0.3
- Versions after:
  - GitHub snapshot: v3; v2 read compatibility 유지
  - GitHub actionability normalizer: `github-pr-actionability-normalizer-v0.3`
  - Work Ledger, Candidate Funnel, runtime projection: v0.1
  - Codex OpenLoop schema/rule/evidence/expiry: v1
  - eligibility policy/evidence/resolver: v0.2; v0.1 projection read compatibility 유지
  - Active result/policy/candidate/ranking/resolver: v0.5/v0.4/v0.2/v0.3/v0.4
  - live orchestrator/monitor run/failure: v0.5/v0.5/v0.4
  - monitor v0.4 + replay v2와 v0.3 + replay v1 read compatibility 유지
- Code commit:
  - evaluation-time provenance: `codeCommitSha=null`, `codeState=dirty_worktree`;
    이 record에서 commit을 생성하지 않음
  - baseline code fingerprint:
    `d59d2fdbe5e26ae0d678a3f8ca7e055348647e5c54d86efee3dfdd6c023320d8`
  - subsequent implementation commit:
    `8e2fe01af08f141ccbb3e424549620543f3c6857`
  - commit subject: `feat(blabase): add developer signal intelligence`
  - 위 baseline run은 commit 전에 기록된 dirty fingerprint로 실행됐다. 기존 run ID를
    `8e2fe01`의 clean-commit run으로 소급하지 않음
- Evaluation dataset and run:
  - 기존 mutable Dev Candidate 원본 v0.1 revision 2와 기대 hash를 수정하지 않음
  - 별도 expectation revision artifact로 eligibility v0.2 revision 3와 Active v0.2
    revision 3을 생성. frozen Golden/Regression dataset 변경 없음
  - eligibility dataset SHA-256:
    `3bb839262a78095b5a54a4e73c105802c41f276fe19a5743fadd50c20bd235d4`
  - eligibility materialized input SHA-256:
    `1d1a2ab3fd41cc53a2437e74b874b988fdeb5d7794fd105f2a401da75745f034`
  - eligibility baseline run:
    `attention_eligibility_run_cecf4c97681437b38b3857ddd6cfccfc`, passed 26/26
  - Active dataset SHA-256:
    `fc8be53b229f4c685591e34b005a4e99fbf49eb7722cc86cd4aeab97f04c8a26`
  - Active materialized input SHA-256:
    `baa7a6ec69173b4207e4409b900519c3148ad06995726aad78f9e2d6ef79f940`
  - Active baseline run:
    `active_attention_eval_run_056c3ce2e6084663841f28a20d408088`, passed 44/44
  - prior run IDs are retained in private local evaluation history but are not reported as a
    formal metric comparison because the Active exact input envelope changed with upstream
    eligibility versions
  - authored PR three-state regression, Codex OpenLoop and sidecar privacy/currentness are
    bounded synthetic Vitest cases, not human-approved Gold
- Commands executed:
  - `cd suggestion && npm test`
  - `cd suggestion && npm run typecheck`
  - `cd suggestion && npm run lint`
  - `cd suggestion && npm run build`
  - `cd suggestion && npm run attention-eligibility:baseline`
  - `cd suggestion && npm run active-attention:baseline`
  - local `127.0.0.1:3102/api/attention` aggregate-only runtime check
  - root `npm run typecheck`
  - root `npm run lint` attempt
  - `git diff --check -- suggestion`
- Verification and metrics:
  - full Vitest: `87/87` files, `732/732` tests passed
  - relevant suggestion typecheck, ESLint and production Next.js build: passed
  - root typecheck: passed
  - both deterministic baselines: passed; provider/model/prompt/token usage
    `not_applicable`
  - GitHub collector/normalizer tests verify positive preservation, partial coverage,
    v2 hash compatibility and privacy minimization
  - public summary strict schema rejects display values, excerpts, URLs and paths
  - local explicit refresh migrated the stored GitHub snapshot to v3 and returned HTTP 200
    with public summary v0.1. The observed authored PR was draft/context-only with no verified
    action-required reason, so 1 item was ineligible and 0 selected; actionability and activity
    coverage remained partial. Only aggregate state and reason codes were printed
- Regressions or accepted exceptions:
  - root lint traverses generated `suggestion/.next` and `.open-next` files and fails on
    generated framework code; the relevant suggestion lint command explicitly ignores those
    build directories and passes
  - v0.1 sidecar summary is returned for the current API result but not yet stored per historical
    monitor run; historical funnel comparison is a follow-up
  - GitHub unresolved review threads, Project priority/dependency and linked issue semantics are
    not included
  - Codex OpenLoop history has no direct candidate path until a current managed run, verified
    GitHub binding/current state, or explicit user confirmation supplies currentness
- Privacy and retention impact:
  - GitHub snapshot stores no check name/output, reviewer identity, commit SHA, branch, review
    body or comment body; only bounded counts/booleans/reason codes and coverage
  - Codex adapter reads normalized bounded facts only. conversation excerpts remain private,
    retain the existing 7-day expiry and never enter public API/history
  - Work Ledger is an ephemeral private runtime sidecar. public projection is aggregate metadata
    with hashes/counts only and uses the existing 30-day monitor privacy posture
  - no external LLM call, new cloud telemetry, production→Gold promotion, credential mutation or
    source write was added
- Compatibility:
  - existing GitHub v2 snapshots normalize with v0.2 semantics until the next successful v3 sync
  - old eligibility projections and monitor/failure contracts remain parseable only as their own
    generation; mixed semantic version tuples fail closed
  - API adds `developerSignals` aggregate summary. launcher v2 projection ignores this additive
    field and continues to use the Active result contract
- Operational requirement:
  - GitHub App repository permissions must include `Pull requests: Read-only`,
    `Checks: Read-only`, `Commit statuses: Read-only`; existing installations may require owner
    re-approval. Missing permissions degrade actionability coverage rather than inventing a task
- Release decision:
  - local developer beta and Attention Lab observation: allowed
  - external recommendation quality claim: deferred until human-reviewed Developer Attention
    dataset and production shadow evaluation exist
- Rollback method:
  - stop producing v3 snapshots and return to the v2 normalizer; v2 data remains readable
  - revert Active/eligibility versions and authored actionability gate together
  - remove runtime sidecar/API summary without deleting connector or monitor stores; no source
    migration/backfill is required
- Follow-up work:
  - persist metadata-only funnel summaries per monitor run and compare funnel drift over time
  - verify Codex OpenLoop currentness through managed run lifecycle, explicit project binding and
    user confirmation
  - add GitHub unresolved review threads, Project priority, dependencies and linked issues
  - capture explicit feedback for wrong link/already done/not important/later and build a
    human-reviewed Developer Attention Golden Dataset
