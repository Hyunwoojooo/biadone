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
