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

## 2026-08-05 Phase 4C.3 source connection onboarding and root handshake v0.4

- Date: 2026-08-05
- Owner: Codex with human direction
- Goal:
  - macOS launcher의 네 source 진단을 실제 연결 화면으로 이어지는 provider별 동작으로
    만들고 OAuth 종료 뒤 사용자가 시작한 source card로 복귀
  - launcher가 선택한 read-only data root와 owner Work Cockpit이 같은 persisted store를
    보는지 절대 경로를 노출하지 않고 확인한 뒤에만 source navigation 허용
  - 아직 root-owning Connection Hub가 없는 managed development root는 연결 동작을
    제공하는 것처럼 표시하지 않음
- Affected pipeline stages:
  - local root marker persistence와 persisted source-sync revision projection
  - dashboard local root-context API
  - launcher JSONL `status.get`, Swift dashboard preflight와 URL allowlist
  - native settings/source recovery UI
  - web `/sources` focus/navigation과 GitHub·Notion·Google OAuth return destination
- Behavior before:
  - launcher의 `/sources` 동작은 dashboard URL만 열어 선택 root와 같은 store인지
    증명하지 않음
  - 네 source card가 native에서 개별 연결 동작을 제공하지 않고 managed root도 연결할
    수 있는 것처럼 안내
  - OAuth callback과 GitHub installation return이 `/`로 돌아가 `/sources`에만 mount된
    connector notice와 다음 단계를 보여주지 못함
- Behavior after:
  - owner가 `<root>/.local/root-context.json`에 stable opaque root ID를 atomic하게
    생성하고 `.local` `0700`, marker `0600`, current UID/non-symlink를 강제. read-only
    consumer는 missing/invalid marker를 만들거나 복구하지 않음
  - dashboard `GET /api/system/root-context`와 launcher `status.get`이 path/secret 없이
    root ID, mutation authority와 같은 persisted sync revision을 반환
  - native는 initial Agent → dashboard → fresh Agent 순서로 확인하고 read-only,
    authority, non-null root ID와 revision이 모두 맞을 때만 고정 source URL을 열음.
    managed는 dashboard에 요청하기 전에 차단
  - GitHub/Codex는 핵심, Notion/Calendar는 선택 source로 표시하고 unapplied root/URL
    draft가 있으면 navigation과 retry를 취소·비활성화
  - launcher entry는 exact `github|codex|notion|google-calendar`만 해당 card로 focus하며
    arbitrary `returnTo`를 해석하지 않음
  - GitHub/Notion/Calendar의 local/config/callback/install 결과는 provider-typed static
    `/sources?<status>#source-*`로 돌아옴. GitHub account 승인 뒤 repository install은
    card에서 별도 명시 단계로 진행
- Versions before:
  - local launcher contract: Phase 4C.2 v0.3
  - launcher IPC envelope: `blabase-launcher-ipc-v1`
  - root identity/status contract: 없음
- Versions after:
  - local launcher contract: Phase 4C.3 v0.4
  - root marker: `blabase-root-marker-v1`
  - dashboard root context: `blabase-root-context-v1`
  - launcher status projection: `blabase-launcher-status-v1`
  - launcher IPC envelope과 attention/execution projection: 기존 v1/v2/v1 유지
  - Active Attention resolver, source snapshot schema와 connector collection semantics:
    변경 없음
- Code commit:
  - base commit: `8e1da0a54a2d3a9c8710104816caafc9f04f23cd`
  - base subject: `docs(blabase): synchronize attention engine records`
  - evaluation-time implementation state: `dirty_worktree`; 이 record에서 commit을
    생성하지 않음
- Evaluation dataset and run:
  - 새 dataset, Golden/Regression version, candidate/comparison run ID 없음
  - root identity/control-plane, native/web navigation과 callback location만 변경하며
    engine input, eligibility, filtering, ranking, selection과 explanation 의미를 바꾸지
    않으므로 Golden Dataset과 semantic baseline은 재실행하지 않음
- Commands executed:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - focused Playwright `dashboard-navigation.spec.ts`
  - `npm run launcher:swift:smoke`
  - fresh Swift release build와 targeted XCTest-source typecheck
  - `npm run launcher:package`
  - local `/api/system/root-context`와 `/sources` runtime checks
  - `git diff --check -- suggestion`
- Verification and metrics:
  - full Vitest: `91/91` files, `769/769` tests passed
  - typecheck, ESLint, Next.js production build: passed
  - focused browser navigation: `3/3` passed
  - XCTest-independent launcher model smoke, fresh Swift release executable build와 targeted
    root-context test typecheck: passed
  - `.app`, bundled Agent hash/provenance, ad-hoc signature, compressed DMG checksum, mounted
    DMG app signature: passed
  - local dashboard root context와 packaged Agent의 read-only `status.get`이 같은 opaque
    root ID와 `null` revision을 반환; migrated `.local` permission은 `0700`, marker는
    `0600`; fixed `/sources` route returned HTTP 200
  - rebuilt launcher process and local Work Cockpit were started for manual dogfood
  - provider/model/prompt/token usage: `not_applicable`; no LLM or semantic evaluation run
- Regressions or accepted exceptions:
  - installed compatible Command Line Tools SDK에 XCTest module이 없어 full `swift test`는
    실행하지 못함. full Xcode CI/XCUITest는 external beta gate로 유지
  - `mutationAuthority`는 선언된 ownership이며 coordinator exclusive lease가 아님.
    dashboard를 수동으로 같은 managed root에 붙이는 dual-writer를 API가 아직 차단하지
    않음
  - launcher preflight 이후 browser/OAuth mutation session이 expected root에
    cryptographically bound되지는 않음. dashboard가 그 사이 다른 root로 재시작되는
    TOCTOU는 internal operator boundary로 남음
  - connector route는 development loopback 전용이고 GitHub/Notion/Google credential은
    operator가 provision해야 하므로 zero-config external onboarding이 아님
  - Orca computer-use runtime이 launch 직후 unavailable 상태로 종료되어 새 native UI의
    accessibility screenshot은 확보하지 못함. native model/smoke/package checks와 기존
    launcher process 실행은 통과
- Privacy and retention impact:
  - root ID는 random opaque identifier이며 API/IPC/URL에 절대 data-root path를 넣지 않음
  - root context에는 credential, token, source content, prompt/answer와 native thread
    identity가 없음
  - OAuth state/cookie validation과 token store는 변경하지 않고 arbitrary return URL을
    추가하지 않음
  - 새 cloud telemetry, production data 수집, production→Gold 승격과 remote retention
    없음
- Compatibility:
  - 기존 attention/execution JSONL method와 IPC v1 envelope는 유지되며 `status.get`만
    additive하게 추가
  - Swift/Node status contract는 같은 `.app` artifact로 함께 배포
  - 기존 `/sources` 직접 접근과 Codex in-place 연결은 유지
- Release decision:
  - 이 Mac의 existing-root/read-only internal dogfood: 허용
  - managed root source onboarding과 external beta: Connection Hub, product-owned OAuth,
    lease/session proof, full Xcode tests, Developer ID signing/notarization 전까지 보류
  - engine recommendation quality claim: 변경 없음
- Rollback method:
  - Swift host와 bundled Node Agent를 이전 Phase 4C.2 app artifact로 함께 복귀
  - web source navigation/callback destination을 이전 `/` return으로 되돌릴 수 있음
  - `.local/root-context.json`은 connector data와 독립인 opaque marker라 제거하지 않아도
    이전 runtime에 영향 없음. 제거가 필요하면 owner가 중지된 상태에서 별도 검토
- Follow-up work:
  - coordinator exclusive lease와 connector mutation authority gate
  - launcher-issued session proof를 OAuth state와 `/sources` mutation에 bind
  - managed root를 단독 소유하는 bundled Connection Hub와 lifecycle management
  - product-owned OAuth registration/broker, full Xcode XCTest/XCUITest, Developer ID signing
    및 notarization

## 2026-08-06 Phase 4B.1 Current WorkStream and Current Focus shadow v0.1

- Date: 2026-08-06
- Owner: Codex with human direction
- Goal:
  - 같은 `asOf`에 묶인 GitHub와 Codex의 최근 의미 이벤트로 사용자가 방금 하던
    Current WorkStream과 Current Focus를 결정적으로 복원
  - Current Focus와 기존 Next Attention을 분리하고, Focus가 기존 authority와
    eligibility hard gate를 통과한 후보의 counterfactual 순서에만 영향을 주도록 제한
  - Phase 1에서는 실제 추천을 바꾸지 않고 Work Cockpit과 Attention Lab에서 결과와
    shadow 차이를 관찰
- Affected pipeline stages:
  - GitHub normalized batch와 managed Codex direct/historical evidence에서 별도 Recent
    Meaningful Event projection 생성
  - exact identity/relation/artifact evidence만 사용하는 Current WorkStream reconstruction
  - currentness/completeness/conflict를 보존하는 Current Focus selection
  - 기존 Active Attention 결과 위의 focus-aware shadow ranking
  - attention API, monitor/replay, Work Cockpit, Attention Lab과 synthetic evaluation
- Behavior before:
  - Work Cockpit은 현재 intervention 추천만 표시하고 사용자가 최근 머물렀던 작업
    흐름을 별도로 복원하지 않음
  - 표시 전용 `ConnectorTimeline`의 시간 항목은 source lineage, shared `asOf`, authority,
    currentness가 없어 엔진 입력으로 사용할 수 없음
- Behavior after:
  - `ConnectorTimeline`을 재사용하지 않고 source snapshot/batch, relation, artifact,
    claim-authority hash와 모든 policy version을 고정한 별도 projection을 계산
  - 이벤트는 `occurredAt`, source, kind, stable ID 순으로 결정적으로 정렬하며 오래된
    이벤트는 bounded history일 뿐 합산 점수로 최신 이벤트를 역전하지 않음
  - 제목/문장/시간 유사도는 grouping에 사용하지 않음. exact task relation이 없고
    project mapping만 있으면 project-level WorkStream까지만 생성
  - stale, partial, identity/authority conflict, latest-time tie와 dependency mismatch는
    fail closed. Focus sidecar만 unavailable/unresolved가 되고 기존 Active 결과는 보존
  - 정상 managed run은 Focus에 보이지만 사용자 개입 근거가 없으면 candidate를 만들지
    않음. 완료/취소/merged, owner, conflict, deadline, blocker와 eligibility gate는 Focus가
    역전하지 못함
  - Notion과 Calendar는 engine input에서 제외된 context-only이며 Focus, WorkStream,
    candidate, blocker, owner, completion, lane 또는 no-action coverage를 만들지 않음
  - GitHub v6 push는 raw commit SHA를 snapshot 저장 전에 opaque artifact ID로 바꾼다.
    기존 Artifact Relation v0.1은 commit을 계속 `not_observed`로 유지하며, 별도 Recent
    Event projection만 active explicit attribution + exact work relation + 같은 batch의
    opaque push ID/repository scope를 교차 검증한다. 따라서 기존 Active graph와 replay
    hash는 바뀌지 않음
  - GitHub v6 Issue/PR lifecycle activity는 `/search/issues` task binding과 같은 Issues
    REST object ID로 canonicalize한 뒤 internal identity로 승격한다. 현재 task의 exact
    repository/number mapping을 우선 사용하고, 없으면 authenticated
    `/repos/{owner}/{repo}/issues/{number}` lookup을 최대 25개, concurrency 4로 제한한다.
    lookup 실패/한도 도달은 activity coverage를 partial/truncated로 낮추고 해당 event를
    제외한다. raw PullRequestEvent ID는 저장하거나 public projection에 노출하지 않음
  - open-only task가 사라져도 v6 canonical identity로 attributed push, managed run,
    close/merge를 하나의 exact WorkStream으로 복원한다. v5/v0.5와 v4/v0.4 reader
    compatibility는 유지하되, pre-canonical v5 raw PR ID는 disappeared-task native bridge로
    신뢰하지 않음
  - 동일 managed failure는 privacy-safe fingerprint, 60초 window, 최대 sequence gap 3을
    모두 만족할 때만 반복 관찰로 제외한다. event/diagnostic retention 초과와 shadow
    100-row diagnostic 초과는 omitted count로 명시함
  - GitHub task native lifecycle target을 안정 anchor로 사용해 open → merged/closed에서도
    WorkStream ID와 유효한 explicit Focus confirmation을 유지함
- Versions before:
  - Recent Meaningful Event, Current WorkStream, Current Focus, Focus shadow: 없음
  - live orchestrator: `attention-live-orchestrator-v0.5`
  - monitor run: `attention-monitor-run-v0.5`
  - replay input: `attention-replay-input-v2`
- Versions after:
  - GitHub snapshot/native activity normalizer: `github-snapshot-v6`,
    `github-native-activity-identity-normalizer-v0.6`; v5/v0.5와 v4/v0.4 read
    compatibility 유지
  - Artifact Relation schema/resolver/evidence는 기존 경계를 유지:
    `artifact-relation-schema-v0.1`, `managed-codex-explicit-artifact-resolver-v0.1`,
    `explicit-user-native-artifact-evidence-v0.1`
  - Recent event schema/rule/ID: `recent-meaningful-event-schema-v0.2`,
    `github-managed-codex-meaningful-event-rule-v0.5`,
    `recent-meaningful-event-id-v0.2`
  - WorkStream schema/reconstruction/currentness/ID:
    `current-workstream-schema-v0.1`, `exact-identity-current-workstream-v0.5`,
    `current-workstream-currentness-policy-v0.1`, `current-workstream-id-v0.5`
  - Focus schema/selection/ID: `current-focus-schema-v0.1`,
    `recent-direct-current-focus-policy-v0.2`, `current-focus-id-v0.1`
  - shadow schema/ranking/resolver/rollout:
    `focus-aware-attention-shadow-schema-v0.2`, `focus-aware-ranking-policy-v0.1`,
    `focus-aware-attention-shadow-resolver-v0.2`, `current-focus-shadow-rollout-v0.1`
  - live orchestrator/monitor/failure/replay: `attention-live-orchestrator-v0.6`,
    `attention-monitor-run-v0.6`, `attention-monitor-failure-v0.5`,
    `attention-replay-input-v3`; released v2 remains Active-only replay compatible
  - existing Active Attention input/result, candidate rule, eligibility, lane and ranking
    policies: unchanged
- Code commit:
  - base commit: `783f70c120e6829f08e6caf9dd0ac6e51805b841`
  - base subject: `feat(gptmemory): add conversation timeline and resume workspace`
  - evaluation-time implementation state: `dirty_worktree`; 이 record에서 commit을
    생성하지 않음. baseline code fingerprint SHA-256:
    `baf18ac4689c56ff2e7b6226d19f8b9ff7c6c0f6f8ef32be84dd207a69ee277c`
- Evaluation dataset and runs:
  - separate mutable synthetic Dev Candidate:
    `suggestion-current-focus-dev-v0.2`, revision 1, 13 cases, production data 없음
  - dataset SHA-256:
    `f595b6985ce0c5c957898f4cdaa536dca151f07a15f6cbb3c476f93f7a207277`
  - config version/SHA-256: `current-focus-config-v0.3`,
    `7bac6d17d0d786d025b50f65936d85a31d08b152ac6cd8edf2140b54722add89`
  - deterministic run A:
    `current_focus_run_7dd3b05598a2190390e83c83baa1a114`, passed 13/13
  - deterministic run B:
    `current_focus_run_8e99c6863bb089999ffd4b57eb85bc2b`, passed 13/13
  - 두 run은 unique run ID와 실행 시각을 제외하고 dataset/config/version/code
    fingerprint, counts, per-case input hash/projection/result, metrics, privacy,
    comparison, review status와 limitations가 동일. stable comparison payload
    SHA-256는 `ef8262628bf998cc773d15c43d0490d37097635c29f030332abd399c809144ab`
  - unchanged Active Attention targeted baseline:
    `active_attention_eval_run_7eabf55c31cf3c97297da53002636f2b`, passed 44/44
  - Active dataset/materialized input SHA-256:
    `fc8be53b229f4c685591e34b005a4e99fbf49eb7722cc86cd4aeab97f04c8a26`,
    `baa7a6ec69173b4207e4409b900519c3148ad06995726aad78f9e2d6ef79f940`
  - Active deterministic output SHA-256:
    `6ce881d595ab1476e95f33710c5ee7c6cd9be412d492b2b79daa26faf71c0d55`
  - unchanged Eligibility run:
    `attention_eligibility_run_9923b28ff65ce26ae897d598a11f77aa`, passed 26/26,
    projection-hash mismatch 0
  - unchanged Artifact Relation run:
    `artifact_relation_run_f417353eeda4375b09bc8e3bcaf9748f`, passed 32/32;
    deterministic output
    `c93da98c113dfe8d9187ba363b43f6c3027c6150396d039480079cab8b3c7d04`
  - frozen Golden/Regression dataset은 수정하지 않았고 production conversation을
    Dev Candidate로 승격하지 않음
- Commands executed:
  - `cd suggestion && npm test -- --run` for focused and full Vitest suites
  - `cd suggestion && npm test`
  - `cd suggestion && npm run typecheck`
  - `cd suggestion && npm run lint`
  - `cd suggestion && npm run build`
  - `cd suggestion && npm run current-focus:baseline` twice
  - `cd suggestion && npm run active-attention:baseline`
  - `cd suggestion && npm run attention-eligibility:baseline`
  - `cd suggestion && npm run artifact-relation:baseline`
  - focused Playwright `current-focus-cockpit.spec.ts`
  - `git diff --check`
- Verification and metrics:
  - required 13 synthetic scenarios: 13/13 passed
  - focused engine/monitor/evaluation regression: 12 files, 161/161 tests passed
  - full Vitest: 96/97 files and 853/854 tests passed. The sole failure is the unrelated
    `codexConversationCollection.test.ts` fixture fixed at 2026-07-29; the production reader
    correctly expires it under the real-clock seven-day retention policy on 2026-08-06
  - typecheck, ESLint, Next.js production build, browser E2E 1/1, diff check: passed
  - Current Focus precision `1.0`; abstention accuracy `1.0`; top-switch precision `1.0`
  - context-only leakage `0`; eligibility diff `0`; stale/currentness violation `0`;
    deterministic hash failure `0`; privacy sentinel leakage `0`; accepted dependency tamper `0`
  - 1/13 counterfactual top switch, 0/13 actual selection changes;
    `attentionSelectionEffect = "none"`
  - existing Artifact/Eligibility/Active exact hashes restored and unchanged; replay v2
    v0.1 artifact lineage regression passed
  - provider/model/prompt/token usage: `not_applicable`; implementation and evaluation use no LLM
- Regressions or accepted exceptions:
  - review-request transition, CI recovery, merge-conflict recovery and command/test transition
    timestamps are not available in current source contracts and are not inferred
  - GitHub push-to-PR exact identity requires an existing explicit relation or verified artifact;
    timing or title similarity never bridges the gap
  - persistent create/change/clear UI and expiry storage for explicit user-confirmed Focus is not
    part of Phase 1; the resolver accepts a validated explicit input when supplied
  - synthetic Dev Candidate is mutable development evidence, not a human-approved Golden result
  - full-suite clock-sensitive fixture failure is not caused by this engine change and was not
    modified to keep unrelated user work untouched
- Privacy and retention impact:
  - public/API/monitor projections exclude credentials/tokens, absolute local paths, raw Codex
    thread/run/execution IDs, raw command/prompt/conversation content and commit SHA
  - public identities are opaque references; privacy sentinels cover Codex private fields and
    context-only Notion/Calendar payloads
  - evaluation artifacts are synthetic-only, local under `.local/evaluations/`, directory `0700`
    and files `0600`; no remote telemetry added
  - existing source retention remains unchanged: Codex conversation seven days and attention
    monitor 30 days. The new projection adds no production source-content retention
- Compatibility:
  - attention API adds four sidecars: recent events, WorkStreams, Current Focus and Focus shadow
  - monitor v0.6 stores only bounded status/hash/top/effect diagnostics. replay v3 recomputes and
    verifies Focus and shadow; replay v2 and previous monitor v0.5 remain parseable as Active-only
    history with artifact relation v0.1 pinned by regression
  - genuine monitor v0.4 + replay v2 records validate their immutable envelope, artifact/input
    hashes, run/analysis/session linkage, capture time and frozen historical dependency matrix.
    Available batches require the historical live freshness policy v0.1 and exact historical
    source/collector/normalizer tuple; the production GitHub collector `2026-03-10` is retained
    and generic snapshot-policy or current eligibility relabels fail closed. Historical Active
    resolver v0.3 is not retained, so a current v0.5 semantic result/hash is never treated as
    equivalent
  - Focus failure does not fail the request or mutate the existing Active result/hash/candidate
    universe; legacy ChatGPT suggestion engine is untouched
- Release decision:
  - Phase 1 local shadow observation in Work Cockpit and Attention Lab: allowed
  - Phase 2 Focus-aware selection activation: blocked pending human review, feature-flag policy
    decision and targeted production-shadow evidence
  - freezing a Current Focus Golden/Regression dataset: blocked pending lawful human review
- Rollback method:
  - disable/remove the Current Focus sidecar construction and shadow call from the v0.6 live
    orchestrator/API and return to the v0.5 Active-only path
  - monitor v0.6 records are additive; monitor v0.5 + replay v2 remains supported. GitHub
    v6/v5/v4 snapshot readers and matching normalizers remain in place even if the writer or
    Focus projection is disabled. No connector store, credential, Golden Dataset or production
    conversation needs migration or deletion
- Follow-up work:
  - human review of the one counterfactual switch and real dogfood false-positive cases before
    Phase 2
  - decide versioned feature flag, explicit Focus create/change/clear UX and expiry policy
  - extend source contracts only when direct trustworthy timestamps for currently unsupported
    GitHub/Codex transitions can be collected
  - fix the unrelated clock-sensitive conversation fixture by controlling test time in a separate
    change

## 2026-08-08 Source sync cross-coordinator lost-update fix

- Date: 2026-08-08
- Owner: Codex with human direction
- Goal:
  - prevent a stale route-local source sync coordinator from overwriting a successful snapshot
    committed by another coordinator that shares the same filesystem store
- Affected pipeline stages:
  - source sync latest/history settlement commit and filesystem repository concurrency behavior
- Behavior before:
  - a normal commit used the caller coordinator's cached latest store as its merge base unless a
    pending settlement had just been recovered
  - a stale Codex coordinator could therefore replace a newer persisted GitHub success state with
    its older GitHub state while committing the Codex attempt
- Behavior after:
  - a validated persisted latest store is always the authoritative merge base when present
  - all filesystem repository reads and mutations for one normalized sync directory share a
    process-global `Symbol.for` queue across repository instances and Next.js route bundles
  - commit changes only `attempt.source`; other source states and snapshots remain byte-valid
    inputs to the existing schema, transition protection, history coherence, hash, and settlement
    integrity checks
- Versions before:
  - latest/history/settlement store contracts: existing v1 contracts
- Versions after:
  - latest/history/settlement store contracts: unchanged v1 contracts
  - no version-ledger bump: this is a runtime persistence correctness fix with no schema, serialized
    contract, source normalizer, semantic rule, ranking, prompt, verifier, or dataset change
- Code commit:
  - `ab19ee9aae2f4292f095b853e38a1a254fe4cd2d`
- Evaluation dataset version and SHA-256:
  - not applicable; no Golden, Regression, production conversation, or semantic evaluation input
    changed
- Candidate run ID: not applicable
- Comparison run ID: not applicable
- Commands executed:
  - `cd suggestion && npm test -- --run tests/sourceSyncCoordinator.test.ts -t "preserves persisted snapshots when a stale coordinator commits another source|does not persist another source's caller normalization during commit"`
- Metrics changed:
  - targeted deterministic source-sync regressions: 2/2 passed
  - semantic quality metrics: unchanged and not rerun
- Regressions or accepted exceptions:
  - serialization is process-global but intentionally local to one Node.js process; separate OS
    processes writing the same managed sync directory still require an external filesystem lease
  - attempt commit and begin/update/complete disconnect or reset transitions use the shared queue;
    existing generation, transition, settlement, history-coherence, schema, and integrity guards
    remain authoritative
- Privacy or retention impact:
  - none; fixtures contain synthetic revisions and hashes only, and no token, credential, raw source
    content, production data, telemetry, or retention policy was added or changed
- Release decision:
  - allowed for local source-sync reliability after the targeted regression passes
  - no semantic baseline is required because engine input interpretation, eligibility, filtering,
    ordering, ranking, and recommendation output contracts are unchanged
- Rollback method:
  - remove the process-global directory queue, restore the previous per-repository-instance queue
    and commit/transition merge-base conditions, and remove the two persistence-invariant
    regression expectations; no data or schema migration is required
- Follow-up work:
  - add a cross-process filesystem lease before permitting multiple writer processes for the same
    managed root

## 2026-08-09 - GitHub reauthorization state reconciliation and Current Focus launcher presentation

### Change identity

- Change ID: `sync-reauth-focus-presentation-2026-08-09`
- Code state: uncommitted working tree
- Dataset: unchanged
- Prompt/model/guardrail configuration: unchanged
- Sync serialized schema: unchanged
- Active Attention candidate, eligibility, ranking, and decision policies: unchanged
- Current Focus selection policy: unchanged
- Launcher contract: `blabase-launcher-attention-v2`, additive optional `currentFocusSummary`

### Problem and evidence

A successful GitHub OAuth callback could persist a new connector snapshot while a route-local sync coordinator continued to expose an older terminal `REAUTHORIZATION_REQUIRED` disabled state. The runtime coordinator registry was module-local, and an idle coordinator did not reconcile its cached projection with the durable latest store. Separately, the web and macOS empty-result presentation collapsed an observed Current Focus and a missing actionable candidate into the generic statement that one item could not be chosen safely.

### Behavior change

- Runtime coordinators are shared process-wide by normalized data directory through a `Symbol.for` registry.
- Idle coordinators reconcile from the durable latest store before status, start, tick, sync, and connection-transition operations. In-flight attempts and pending or active transitions remain protected.
- Persisted revision/state is authoritative while the coordinator is idle; wall-clock ordering is not used to reject a logically newer durable reauthorization result.
- The launcher v2 projection may include a bounded, display-only `currentFocusSummary`. Missing and `null` remain valid for older producers and consumers.
- Focus summary data cannot create a card, change candidate counts, modify eligibility or ranking, or enable an execution guard. Its selection effect is fixed to `none`.
- Web and macOS no-action/insufficient-evidence copy now distinguishes an observed current workstream from the absence of a verified intervention candidate and keeps no-action claims scoped to the evaluated range.

### Tests and review

Added regression coverage for process-global runtime identity, stale disabled coordinator reconciliation after a separate reset and successful sync, logically newer durable state with an older wall-clock timestamp, launcher projection/service compatibility, Swift decoding and validation, presentation copy, and absence of Focus-driven execution behavior. Tests were added but not executed in this change session. Static QA found no remaining blocking or medium issue after corrections.

### Privacy and retention

No raw conversation, prompt, command, path, URL, thread identifier, native object identifier, commit SHA, credential, or token is added to the launcher projection. The optional summary contains only a bounded display label, canonical Focus reason codes, selected status, and `attentionSelectionEffect: none`. Storage locations, retention periods, and deletion behavior are unchanged.

### Compatibility, rollback, and residual risk

The launcher contract identifier remains v2 because the new field is optional/default-null and Swift uses optional decoding; older consumers ignore the unknown field. Rollback removes durable reconciliation/global runtime registry changes, the optional launcher summary, presentation branches, and their regression tests. Repository serialization remains process-local across separate OS processes, so filesystem-level lease/CAS is still a follow-up for true multi-process mutation authority. Low residual risks are adapter-normalization timestamp/timer churn, non-finally runtime-test cleanup, and minor Swift/TypeScript validation differences for Unicode length and unknown keys.

## 2026-08-10 Recent Work repository-scope projection v0.1 evaluation checkpoint

- Date: 2026-08-10
- Owner: Codex with human direction
- Goal:
  - add a strict, reproducible evaluation harness for the already implemented
    `recent-work-projection-v0.1` repository-scope/display-only sidecar
  - cover current positive, boundary, mapping, rollout, privacy, determinism,
    and no-effect behavior without representing the planned full continuation
    system as implemented
- Affected pipeline stages:
  - new bounded synthetic Recent Work projection Dev Candidate and mutable config
  - new strict evaluation run record and private `.local` baseline writer
  - one fixed-clock paired `evaluateAttentionSnapshots` production integration
    probe compares shadow and present over identical synthetic raw snapshots,
    private context, clocks, and execution IDs
  - no production resolver, connector, Current Focus, launcher, monitor, replay,
    ranking, eligibility, or execution behavior is changed
- Behavior before:
  - targeted unit tests covered core Recent Work resolution and presentation,
    but there was no versioned projection-specific dataset/config, aggregate
    evaluator, private baseline artifact, or explicit human freeze/rollout gate
- Behavior after:
  - `suggestion-recent-work-projection-dev-v0.1` defines 23 bounded synthetic,
    non-private case records and 28 runtime variants with distinct
    `RW-PROJ-DEV-*` IDs
  - the evaluator covers `shadow|present`, all five public tracking states,
    focus 24-hour and Local Git five-minute boundaries, both +60-second future
    skew boundaries, partial/stale/non-push/project-level Focus, missing,
    different, removed, archived, duplicate and same-project multi-repository
    mapping, unavailable/unborn Local Git, invalid rollout fallback, public
    seconds-to-milliseconds canonicalization, privacy, deterministic direct
    resolution, and Recent Work no-effect invariants
  - one separately recorded production integration probe requires both Recent
    Work projections to match and compares exact replay input/input hash, full
    Active result, ordered candidate content, eligibility projection and
    assessments, decision, and result hash; shadow public output must be null
    while present public output must be non-null
  - production-integration privacy checks materialize bounded synthetic config
    path/label, GitHub login/repository/ref, Codex summary, installation secret,
    and a source-boundary raw commit sentinel, and inspect the public Recent Work
    and launcher-safe Recent Work/Current Focus surfaces
  - raw prompt, command, and conversation bodies are explicitly classified as
    unrepresentable in `ResolveRecentWorkInput`; they are not counted as
    materialized zero-leak measurements
  - removed and archived mapping cases are labeled
    `upstream_filtered_runtime`: the input contains their honest absence from
    the confirmed-link resolution, rather than pretending the Recent Work
    resolver reads registry history
  - `npm run recent-work:baseline` publishes a new private artifact
    under `.local/evaluations/recent-work-projection/` with private `0700`
    directories, a synced `0600` sibling temporary file, complete pre-link
    byte/mode/inode validation, atomic hard-link no-clobber publication,
    cleanup, code provenance, and canonical hashes
- Versions before:
  - Recent Meaningful Event rule:
    `github-managed-codex-meaningful-event-rule-v0.6`
  - Local Git snapshot/collector: `codex-local-git-snapshot-v1`,
    `codex-local-git-metadata-v1`
  - context registry: `work-context-registry-v1`, schema v1
  - Recent Work projection/schema/resolver:
    `recent-work-projection-v0.1`, `recent-work-schema-v0.1`,
    `repository-scope-recent-work-resolver-v0.1`
  - launcher attention: `blabase-launcher-attention-v2`, additive optional
    Recent Work summary
  - Active Attention input/result/resolver: existing v0.4/v0.5/v0.4
- Versions after:
  - all production versions above are unchanged
  - new evaluation dataset/config remain mutable v0.1:
    `recent-work-projection-evaluation-dataset-v0.1`,
    `recent-work-projection-config-v0.1`
  - corrected measurement semantics and the integration-probe shape use:
    `recent-work-projection-evaluation-run-v0.2`,
    `recent-work-projection-evaluation-policy-v0.2`
  - prompt/model/LLM configuration is not applicable: this evaluator invokes
    only deterministic production resolvers over bounded synthetic inputs
  - no actor/origin provenance version, exact-commit policy, continuation
    observation/context/offer, heartbeat/resume policy, four-mode rollout,
    applied-selection, monitor v0.7, or replay v4 version is introduced
- Code commit:
  - `commitSha=null`, `codeState=dirty_worktree`
  - evaluation-time dirty fingerprint:
    `e945093bbf259f653a85a4263f75a7a9b99d0b7939e91e489357107b94c1ecdc`
  - this post-run documentation-only record update changes the current dirty
    worktree fingerprint. It does not change the runtime sources evaluated by
    the historical run, and the historical fingerprint is not rewritten
- Evaluation dataset version and SHA-256:
  - mutable candidate: `suggestion-recent-work-projection-dev-v0.1`, revision 1
  - lifecycle: `datasetSha256=null`, `immutableRef=null`, `frozenAt=null`
  - config lifecycle: `configSha256=null`, `immutableRef=null`
  - dataset candidate-payload SHA-256:
    `8cea73e117622048907f46171daf7928cf6e2290cd24df2ca9a38d317ee9b182`
  - exact materialized-input SHA-256:
    `110dc54517198b8864854320e66a84563b3b1d101dd320a44d7f5c89b4eb8b8d`
  - config candidate-payload SHA-256:
    `fde94e2070121d65bc2a7dce399f8356f260cde9ee2c5a5025ef324f2b05717c`
  - these execution hashes identify the mutable candidate and its exact input;
    none is a frozen dataset SHA, immutable reference, or approval
- Candidate run ID:
  - `recent_work_run_9b9150ff2629744a1070846834df2cd5`
  - started `2026-08-10T12:49:57.865Z`; completed
    `2026-08-10T12:49:57.931Z`
  - automatic status: passed; human review status: `not_started`
- Comparison run ID:
  - none; there is no same-frozen-input comparison or improvement claim
- Commands executed:
  - `npm run typecheck` — passed
  - targeted Vitest run — `14` files, `104` tests passed
  - `npm run recent-work:baseline` — passed
  - lint, build, and Git commands are not part of this recorded verification
- Metrics changed:
  - cases: `23/23` passed; runtime variants: `28/28` measured and passed
  - all recorded measurement-failure, status/reason, boundary, mapping,
    rollout, canonicalization, determinism, privacy, replay-input,
    candidate-universe, eligibility-projection, assessment, selection,
    Active-result/result-hash, and Recent Work effect failure/diff counts: `0`
  - all eight automatic gates: `true`
  - this is one mutable Dev Candidate run, not a human-reviewed quality score,
    frozen baseline comparison, or improvement claim
  - fixture materialization and its canonical hash are inside the evaluator's
    fail-closed boundary; a materialization failure records a sanitized reason,
    null measurements, and `materializedInputSha256=null` rather than inventing
    provenance or aborting the complete evaluation record
- Private artifact:
  - path:
    `.local/evaluations/recent-work-projection/recent_work_run_9b9150ff2629744a1070846834df2cd5.json`
  - run-record canonical-payload SHA-256:
    `edc6dfaa2c4128af911364ed7687081d35883fdc9658087846a43fb5f60e4467`
  - serialized file SHA-256:
    `3094eaec2125df3f8002d9c9d190d623ac462c92c0c47668fd6e8ccc9efba85a`
  - bytes: `46477`; mode: `0600`
- Regressions or accepted exceptions:
  - the current projection correlates repository scope only. It has no
    actor/origin provenance or exact commit equality and cannot establish a
    full continuation identity
  - removed/archived/missing mappings are indistinguishable after the upstream
    confirmed-link boundary except for synthetic case metadata; the resolver
    correctly sees only link absence
  - project-level Focus may produce display-only recent repository context; it
    cannot create a candidate or an Attention, ranking, eligibility, or
    execution effect
  - the two-value presentation parser is not the proposed four-mode rollout;
    invalid values only fall back to shadow
  - there is no observation/context/offer lifecycle, heartbeat validation,
    resume action, applied selection, monitor v0.7, or replay v4
  - the dataset is builder-backed and mutable. It is not a frozen Regression,
    Golden, Rolling, or Holdout result and contains no human-approved labels
- Privacy or retention impact:
  - dataset and integration-probe content is bounded synthetic/non-private;
    no real production conversation, credential, token, identity, branch,
    commit, prompt, command, thread ID, repository path, or local path is used
  - synthetic private-shaped login/ref/path/label/summary/secret values are
    materialized only in fixed production integration inputs and checked against
    available public Recent Work and launcher-safe surfaces; artifacts record
    hashes and field categories rather than copying those sentinel values
  - only explicitly executed evaluation artifacts are written to `.local`;
    no remote telemetry, production retention, source retention, or
    production-to-Gold promotion is added
- Compatibility:
  - production Recent Work v0.1, Current Focus, Local Git v1, Active Attention,
    launcher v2, monitor v0.6, and replay v3 contracts are unchanged
  - the package script and evaluation modules are additive; older consumers do
    not read evaluation artifacts
- Release decision:
  - the historical mutable-candidate automatic evaluation passed; human review
    remains `not_started`
  - projection default: remain shadow
  - release decision: deferred; `frozenDatasetEligible=false`,
    `presentRolloutEligible=false`, `activeEffectEligible=false`, and
    `humanReviewRequired=true`
  - dataset freeze, present rollout, any continuation mode, and any Attention
    effect still require independent human review and a separate Release
    Decision Record
- Rollback method:
  - remove the new dataset/config, builder, evaluator, runner, evaluator tests,
    package script, and these checkpoint notes
  - the recorded artifact is private local evidence and may be removed with the
    evaluation tooling if this candidate run is intentionally discarded; no
    production state, credential, connector store, schema migration, or frozen
    dataset was created
- Follow-up work:
  - run lint or an additional clean-provenance evaluation if required by the
    eventual release review; do not rewrite this dirty-worktree historical run
  - review every case and the project-level display-only policy; record reviewer
    decisions separately from automatic verdicts
  - freeze a new dataset version and SHA only after materialized inputs and
    labels receive human review; then record baseline/comparison run IDs on the
    same frozen input if a behavior change is compared
  - make separate product and release decisions before adding source-native
    actor/origin provenance, exact commit equality, continuation
    observation/context/offer, heartbeat/resume action, four-mode rollout,
    applied selection, monitor v0.7, or replay v4

## 2026-08-11 — Verified GitHub push Recent Work fallback v0.2

- Change type: deterministic engine behavior change; display-only sidecar
- Behavior before:
  - Recent Work required a selected Current Focus and one confirmed exact
    GitHub repository to Codex scope link.
  - a complete recent push was hidden whenever aggregate GitHub coverage was
    partial or repository-scope mapping was unresolved.
- Behavior after:
  - the existing exact Focus/link path remains first priority.
  - if that path abstains, one individually complete GitHub push with a valid
    repository scope and source timestamp inside the existing 24-hour window
    may produce a display-only Recent Work summary.
  - mapping conflict is presented as `작업 공간 선택 필요`; absence of a
    confirmed link is presented as a local-workspace connection requirement.
  - the fallback cannot create or modify an Active Attention candidate,
    eligibility, ranking, decision, primary action, or execution authority.
- Versions before:
  - projection/schema/resolver v0.1/v0.1/v0.1
- Versions after:
  - projection/schema/resolver v0.2/v0.2/v0.2
  - Active Attention, Current Focus, Local Git, launcher v2, monitor, and replay
    versions are unchanged.
- Evidence and privacy:
  - only normalized push kind, complete signal state, bounded source time,
    opaque repository scope validity, signal hash, and batch hash are consumed.
  - public output contains no repository ID, scope ID, commit SHA, ref, URL,
    path, message, credential, or raw GitHub payload.
  - no production conversation or connector data is added to a dataset.
- Evaluation status:
  - unit regressions were added for Focus abstention, fresh complete push,
    mapping conflict guidance, shadow suppression, present projection, privacy,
    and display-only effects.
  - `npm run typecheck` passed.
  - targeted Vitest passed: 7 files, 49 tests. The new verified-push fallback
    has its own resolver and presentation regressions.
  - `npm run lint` passed.
  - `npm run build` passed with Next.js 15.5.21 after the final v0.2 source
    and evaluation metadata changes.
  - live local `GET /api/attention` in `present` mode returned `status=ready`,
    `currentFocus.status=unresolved`, and a non-null display-only Recent Work
    summary with both Attention-selection and execution effects equal to `none`.
  - mutable v0.2 baseline run
    `recent_work_run_e376c022b3ac0f706d959543470b2700` passed at
    `2026-08-11T12:42:12.482Z`–`2026-08-11T12:42:12.523Z` with 23/23 cases,
    28/28 variants, all eight automatic gates true, and every privacy,
    replay-input, candidate, eligibility, assessment, selection, Active result,
    result-hash, and Recent Work effect failure/diff count equal to zero.
  - code fingerprint:
    `31d13fa255c18d3d18b88e16460cfe790e2b4eab7f28c007e7eee9e787a889a3`.
    Subsequent evidence-only ECR edits change the current dirty-worktree
    fingerprint but do not rewrite the runtime sources evaluated by this run.
  - dataset candidate/materialized/config hashes remain
    `8cea73e117622048907f46171daf7928cf6e2290cd24df2ca9a38d317ee9b182`,
    `110dc54517198b8864854320e66a84563b3b1d101dd320a44d7f5c89b4eb8b8d`,
    and `fde94e2070121d65bc2a7dce399f8356f260cde9ee2c5a5025ef324f2b05717c`.
  - private artifact:
    `.local/evaluations/recent-work-projection/recent_work_run_e376c022b3ac0f706d959543470b2700.json`;
    canonical/file hashes
    `544590f498df98ff753c87ed91a700d753b289c8345c400b7e1c97d6a2cf0311` /
    `c331e2285e23d6cf0073ed0b06273a02b66c3d6a4e4768de333b0ed0f40fee50`,
    46605 bytes, mode 0600.
  - the mutable 23-case dataset remains the exact-link regression set; the new
    fallback is targeted-test evidence, not a frozen dataset case or a formal
    comparison/improvement claim.
  - automatic checks are complete; release/present approval remains deferred
    until the independent human release gate is recorded.
- Rollback:
  - return presentation mode to `shadow`, or revert the v0.2 fallback and
version constants. No persisted-state or schema migration is required.

## 2026-08-12 — Suggestion Engine vNext Draft ECR v0.1

- Status: **Draft — planning complete for `D-001`; implementation and release not approved by this record**
- Date: 2026-08-12
- Product decision owner: User
- Implementation executor and record author: Codex (AI)
- Technical QA reviewer: `qa_reviewer` agent (AI, advisory; not a human reviewer or release authority)
- Human dataset reviewers/adjudicator: Pending
- Release approver: User; release decision pending
- Goal: Preserve the existing strict Active Attention lane while adding independent Continuation and Setup lanes plus a deterministic Proposal Router that can surface recent GitHub/Codex work without claiming unverified urgency, importance, ownership, or completion state.
- Affected pipeline stages: Planned new Continuation observation/candidate/identity/score/resolver contracts, Work Suggestion Board composer, evaluation, monitoring/replay, additive APIs, web presentation, later mapping/action and launcher integration. Existing Active Attention candidate admission, eligibility, ranking, result and result hash are protected invariants.
- Behavior before: Active Attention is the only actionable recommendation lane. Recent Work v0.2 is display-only and may show a generic verified-push fallback, while ordinary Codex inventory and source-local activity cannot produce a ranked continuation proposal. `Attention.no_action` can therefore appear to users as if no useful next step exists.
- Planned behavior after: All valid Active Attention remains primary. When no valid Attention exists, a deterministic Continuation candidate may become primary; Attention, Continuation and Setup remain separately labeled lanes. A fresh single-source GitHub push or Codex session may be displayed with bounded non-urgent copy. Missing mapping becomes a navigation-only Setup action instead of candidate exclusion. MVP actions are limited to `display`, `open_source` and `open_setup_surface` and cannot persist mapping or selection, resume a session, fill a prompt, execute a command, retry, or mutate a source.
- Approved MVP product policy: Activity window 7 days with source snapshot freshness versioned separately; exact remote match may prefill a proposal but persistent mapping requires explicit confirmation; verified repository/project names may be shown in local web/macOS surfaces but raw names are excluded from external telemetry, monitor, replay and evaluation artifacts; explicit feedback alone may affect bounded Continuation ranking; clicks and non-response are analytics-only and not Gold; deterministic rules only.
- Deferred product direction: Post-MVP may auto-fill a bounded prompt draft into a reviewable composer after exact-target and action-time revalidation. Automatic prompt send, approval, command execution, retry or external mutation is not approved and requires a separate schema, ECR, security/privacy review and explicit human gate.
- Versions before: Existing Active Attention versions unchanged; Recent Work projection v0.2 remains display-only/no-effect; GitHub snapshot v6 and Codex snapshot v3 are existing inputs.
- Versions after: Proposed, not implemented or released. New Continuation observation/candidate/identity/rule/score/resolver v1 and Work Suggestion Board/composer v1. Monitor, replay, API, resumption and launcher version changes remain task-specific proposals and must be recorded when contracts are implemented. Unknown or mixed version tuples must fail closed for Continuation/Board without changing Active Attention.
- Code commit: Not applicable for this planning-only draft. No semantic engine code was changed by `D-001`; no clean commit SHA or dirty-run fingerprint is claimed.
- Evaluation dataset version and SHA-256: Not created. Planned families are mutable Continuation Dev Candidate, human-reviewed frozen Continuation Regression, frozen Board Regression, private dogfood and locked holdout.
- Candidate run ID: Not created.
- Comparison run ID: Not created.
- Commands executed: Documentation inspection and editing only. No engine typecheck, lint, unit/integration test, build, baseline, launcher smoke, evaluation run or Git command was executed for this draft.
- Metrics changed: None measured. Provisional hypotheses, not achieved results: human-reviewed `Acceptable@1 >= 75%`, `Acceptable@3 >= 90%`, and critical safety/identity/privacy/Active-result-diff errors equal to zero. Actual thresholds require review against the same frozen materialized input.
- Regressions or accepted exceptions: None evaluated or accepted. Production clicks, non-response, AI evaluator verdicts and synthetic labels are not human-approved Gold.
- Privacy or retention impact: MVP reuses bounded existing GitHub v6 and Codex v3 metadata and does not add commit subjects, diffs, file paths, raw prompts/answers, commands or outputs. Repository/project names are sensitive local display data. Exact retention durations, deletion verification, telemetry policy and human dataset lawful-basis review remain pending gates.
- Compatibility: `/api/attention`, Active Attention candidate universe, eligibility, ranking, result and hash must remain byte-equivalent for the same input. Recent Work v0.2 keeps its current meaning. New contracts are additive and feature-gated; older consumers must ignore optional data or fail closed according to their declared reader contract.
- Release decision: **Deferred.** Implementation, automated verification, advisory AI technical QA of implementation, human dataset review, frozen same-input comparison, privacy/retention approval and explicit user release approval remain pending. Default rollout remains `off` or `shadow`.
- Rollback method: Disable `continuationAction`, then `continuationPresentation`, restore `boardComposer=legacy`, and set `continuationResolution=shadow|off`. Active Attention remains independently available throughout rollback.
- Follow-up work: `C-001` contract/version ledger is next. Before semantic implementation, open the implementation section of this Draft ECR with exact affected files and proposed versions. Then build the mutable dataset/evaluator before resolver behavior, prove Active byte-equivalence, complete human dataset review/freeze, record real run IDs/hashes, and obtain separate presentation, action and release approvals.

### C-001 hash-contract correction — 2026-08-12

- Status: Implemented locally as a pre-`E-001` contract correction; not released and not a contract-freeze approval.
- Goal and behavior after: Continuation decisions and Work Suggestion Board results now carry a stable `semanticResultSha256` in addition to the existing full-artifact `resultSha256`. Continuation semantics omit run, candidate/observation ID and private locator lineage. Board semantics hash only contract/version/policy/as-of values, explicit ordered item semantics (lane, optional WorkContext, label/summary, timestamps, evidence/capability and target-capability presence), and execution policy; Active/Continuation dependency hashes and Board/source IDs remain artifact lineage. Full artifact hashes and Board dependencies continue binding supplied semantic hashes, lane artifact hashes and IDs, while semantic field changes alter the semantic and full artifact hashes.
- Versions before: Internal Continuation decision contract/schema/hash domain v0.1; internal Board input/result/schema/hash domains v0.1. Public Continuation and Board DTO contracts are v0.1.
- Versions after: Internal Continuation decision contract/schema/full-hash/semantic-hash domains v0.2; internal Board input/result/schema/full-hash/semantic-hash domains v0.2. No legacy adapter was added because no production or persisted vNext artifact exists. Public Continuation and Board DTO shapes, contracts and schema literals remain v0.1 through separate public schema constants. Active Attention contracts and hashes are unchanged.
- Affected files: `src/crossSource/versions.ts`, `src/continuation/contracts.ts`, `src/suggestionBoard/contracts.ts` and their targeted contract tests.
- Evaluation dataset and runs: No dataset version, dataset SHA-256, candidate run ID or comparison run ID was created. This correction establishes the hash contract consumed by `E-001`.
- Commands executed: Per orchestration instruction, no test, typecheck, lint, build, baseline, evaluation or Git command was executed by this correction task. Targeted tests were authored for run/locator stability, semantic changes, tamper rejection, Board lineage and public projection privacy; execution remains pending parent verification.
- Privacy or retention impact: None. Semantic projections omit run metadata, candidate artifact hashes and private target locator references; public DTOs expose neither private hash. No production data, raw conversation or private evaluation artifact was read or written.
- Rollback: Revert the additive semantic hash fields and restore only the new internal Continuation decision and Board domains to v0.1 before any artifact is persisted. Active Attention remains untouched.

### E-001 dataset/evaluator scaffold and runner wiring — 2026-08-12

- Status: Implemented locally; the E-001 automated evaluation checkpoint completed on 2026-08-12. Twelve executable contract oracles passed and ten resolver-behavior cases remain deferred. Human review, dataset freeze, Gold promotion, resolver quality evaluation, release and rollout remain incomplete or unapproved.
- Goal and behavior after: A bounded synthetic Continuation Dev Candidate, strict case/config/run-record contracts, deterministic contract-scaffold evaluator, private atomic artifact path and CLI runner are now wired before resolver behavior. The runner resolves code provenance from the current working directory, persists only under `.local/evaluations/continuation/`, prints only status, run ID, artifact path, hashes and aggregate counts, and returns a nonzero exit status when scaffold validation fails. It does not print raw cases or privacy sentinels.
- Versions before: No E-001 Continuation evaluation dataset, case, config, run-record or evaluation-policy contract existed. The internal Continuation decision and Work Suggestion Board dual-hash contracts were already v0.2 as recorded in the preceding C-001 correction; E-001 had no production consumer.
- Versions after: Mutable candidate contracts `continuation-evaluation-dataset-v0.1`, `continuation-evaluation-case-v0.1`, `continuation-evaluation-config-v0.1`, `continuation-evaluation-run-v0.1` and `continuation-contract-scaffold-evaluation-v0.1`. These version labels identify development artifacts; they do not make the dataset frozen or human-approved Gold. Internal Continuation/Board dual-hash remains v0.2, and the new evaluator is structurally evaluation-only with no production consumer wired. Exact Active runtime and byte/hash equivalence is not inferred from that structural isolation.
- Affected files: `eval/synthetic/continuationCaseBuilder.ts`, `eval/synthetic/continuationEvaluationCases.v0.1.json`, `eval/synthetic/continuationEvaluationConfig.v0.1.json`, `src/evaluation/continuation/*`, `tests/continuationEvaluation.test.ts`, `tools/run-continuation-baseline.ts`, `package.json`, this Draft ECR and the vNext implementation plan.
- Evaluation dataset and config: The input remains a mutable synthetic Dev Candidate, not a frozen dataset or human-approved Gold. Dataset candidate SHA-256 is `c834c86ab9b37822b58debd9c6f08dab9a481cb87e9a1183cf8153a63ada7b98`; materialized dataset SHA-256 is `32d70998725cee9730533f0cf80442324a84c4425d4da660cb11d112717c2ffe`. Config candidate SHA-256 is `4624f4c404c995ddce6bc0c6bda94c2dcf00247fa26344477669a15631f99de9`; deterministic config SHA-256 is `bd5cd9bdd46134eb1e162f5bb3282d72ebf47c60b53ea241c3bc378d6245ca2d`. The frozen `datasetSha256` and `configSha256` fields remain `null`.
- Evaluation run and artifact: Run `continuation_eval_run_df5a85b1e2bb784355c035969f835380` started and completed at `2026-08-12T12:43:25.306Z`. Its private artifact is `.local/evaluations/continuation/continuation_eval_run_df5a85b1e2bb784355c035969f835380.json`, 32400 bytes with mode 0600. Canonical artifact-payload SHA-256 is `a0415e30359a2edc1e943e19ae3b507cbf7e2db0b350c3d3346209939c4f1bcc`; the recorded stored-artifact SHA-256 and independently checked file SHA-256 both equal `0d5797a2b85af65548d2c92c0e25449d6af50ce143723856928921c174f32427`.
- Code provenance: The run recorded `commit=null`, state `dirty_worktree`, and fingerprint `302444b13f840627e6e57f21140b134fe6dccdc795680b6d030f8d409212271f`. The documentation-only evidence edits made after the run can change the current dirty-worktree fingerprint; the recorded fingerprint is historical run-time provenance, and no baseline rerun is required for these docs-only changes.
- Commands executed: Targeted Vitest for three files passed 39/39; `npm run typecheck` passed after correcting a test-only fixture whose environment object omitted required `NODE_ENV`; `npm run lint` passed before that test-only correction, with production/source semantics unaffected; and `npm run continuation:baseline` passed. The initial typecheck failure was limited to that test fixture. Build was not run for this checkpoint.
- Metrics and review: 22 total cases were recorded: 12 executable, 12 passed, 0 failed, and 10 deferred/`not_evaluated`. `exactOraclePassRate=1`, all recorded critical failure counts are zero, automatic review passed, and human review is `not_started`. These scaffold results do not establish `Acceptable@1`, `Acceptable@3`, setup-route accuracy, resolver quality, production generalization, comparison improvement, or release quality. No comparison run or improvement claim is made.
- Regressions or accepted exceptions: No executable contract oracle failed. Ten resolver-behavior cases are deliberately deferred until their resolver/board dependencies land; automatic output and synthetic labels are not human-approved Gold.
- Privacy or retention impact: Synthetic bounded inputs only; no production conversation was promoted or read. Future run artifacts are private local files under `.local/` written atomically with restrictive permissions. Console output excludes raw cases and sentinel values. No new remote telemetry or production retention path was added.
- Compatibility and release decision: The contract-level `HS-001` oracle executed and passed. That is the only Active-equivalence claim from this checkpoint; runtime integration equivalence for Active input, candidate universe, eligibility, ordering, result bytes and hash remains deferred. Release remains **deferred**, `releaseEligible=false`, and all Continuation presentation/action/resolution flags remain off.
- Rollback: Remove the additive E-001 synthetic artifacts, evaluator module, CLI runner and package script. No production state, persisted schema migration or Active rollback is required.
- Follow-up work: Complete the deferred resolver/board tasks and evaluate their ten behavior cases, begin human review, create and freeze a separately reviewed immutable dataset version, run same-frozen-input comparisons, and obtain separate privacy, presentation, action and release approvals.

### C-002 Observation identity and provenance correction — 2026-08-12

- Status: Implemented locally as an internal contract correction; validation was not run by this task and release remains deferred.
- Goal and behavior after: Continuation Observation v0.2 accepts a zero `boundedActivityCount` as metadata-only Codex presence without inferring inactivity. Logical Observation identity is derived from an adapter-provided opaque source identity, a distinct event-level `sourceRecordRef`, and source activity time; it no longer depends on refresh-specific `snapshotCapturedAt` or mutable payload fields. The sealed artifact still hashes snapshot capture time, payload, supporting evidence, and provenance, so refreshed artifacts can differ while retaining one logical event ID.
- Provenance: Every Observation now binds exact source snapshot schema, adapter version, and `sourceSnapshotSha256`. GitHub/Codex observations must match the corresponding available input dependency tuple and snapshot hash. Mixed or unknown tuples fail closed. Local Git provenance constants are reserved for the existing local payload shape, but no Local Git v2 adapter or runtime wiring is added.
- Opaque reference boundary: Source identities, source-record references, and evidence references are format-validated opaque values supplied by adapters. Adapters are responsible for keyed HMAC derivation; installation secrets, HMAC keys, raw repository/session IDs, URLs, paths, prompts, commit text, diffs, and source payloads are not fields in this contract.
- Versions before: Observation contract/schema/hash domain and identity behavior v0.1.
- Versions after: Observation contract/schema/hash domain v0.2, a narrow `continuation-observation-id-policy-v0.2`, and the enclosing Continuation input contract/schema/hash domain v0.2. The shared non-Observation ID policy, Candidate, Decision, Board, public DTO, Active Attention, and source snapshot contracts are unchanged. GitHub/Codex adapter labels remain v0.1 because their first implementation is not yet persisted or released.
- Legacy compatibility: No v0.1 reader or migration adapter was added because no production, persisted, or released vNext Observation artifact exists. A v0.1 artifact is rejected by the strict v0.2 boundary.
- Tests authored: Metadata-only count zero, refresh-stable logical ID with artifact-hash change, supporting-evidence stability/canonical order, same-time distinct source-record identity, semantically equivalent timestamp normalization, exact provenance tuple, dependency cross-provenance, tamper rejection, and non-throwing safe parsing. Per task instruction, tests, typecheck, lint, build, baseline, evaluation, and Git commands were not run.
- Dataset and evaluation: No dataset content, frozen version/hash, evaluation run, comparison run, or metric changed. The existing E-001 historical run is not rewritten and does not validate C-002.
- Privacy and retention impact: No new persistence or retention path. Only keyed opaque references and source artifact SHA-256 values are added to the private internal contract; the installation secret is never stored in an Observation. G2 human privacy approval remains required before adapter activation.
- Rollback: Before any Observation is persisted, revert the v0.2 Observation fields/identity/hash constants and the matching tests. No state migration, public API rollback, or Active Attention change is required.

### S-001 GitHub/Codex source adapters — 2026-08-12

- Status: Implemented locally and awaiting automated validation. The adapters are pure, shadow-only and unwired; they are not connected to runtime collection, resolver, persistence, API, UI, monitoring or action paths. Release and activation remain deferred.
- Owner: Connector owner implementation by Codex; human privacy approver is pending.
- Goal and behavior after: Exact GitHub snapshot v6 and Codex snapshot v3 inputs can be projected into sealed Continuation Observation v0.2 artifacts without inferring a WorkContext or action. Activity eligibility uses the exact seven-day interval `(asOf - 7 days, asOf]`; snapshot freshness remains a separate caller-supplied cutoff. Future activity fails closed, stale snapshots remain explicitly stale, and partial source collection remains partial rather than being promoted to complete coverage. Codex metadata-only presence may emit `boundedActivityCount=0`; zero means no bounded activity count was available from that metadata, not proven inactivity.
- Versions before: Observation and enclosing Continuation input contracts were v0.2 after C-002, but no GitHub or Codex Continuation adapter implementation existed. GitHub snapshot schema was v6 and Codex snapshot schema was v3.
- Versions after: `continuation-github-adapter-v0.1` and `continuation-codex-adapter-v0.1`, consuming exact GitHub snapshot v6 and Codex snapshot v3 and emitting Continuation Observation/Input v0.2. No public DTO, source snapshot, Candidate, Decision, Board, Active Attention or Recent Work version changed.
- Affected pipeline stages and files: Additive private source projection under `src/continuation/adapters/*`, its `src/continuation/index.ts` export, and targeted adapter tests. Candidate derivation, identity mapping, ranking, resolver behavior and product presentation remain out of scope.
- Dataset and evaluation: No dataset content, version, SHA-256, evaluation run, comparison run or metric changed. A baseline rerun is not applicable to this unconnected adapter checkpoint: the E-001 mutable dataset still defers resolver behavior and does not exercise source adapters. The historical E-001 run is not rewritten and does not validate S-001.
- Commands executed: `npm run typecheck` passed; the targeted Continuation contract, source-adapter and identity test run passed 3 files and 34/34 tests; `npm run lint` passed. Build, baseline, evaluation and Git commands were not run for this checkpoint.
- Privacy and retention impact: No new collection, persistence, telemetry or retention path is wired. Adapter outputs retain only keyed-HMAC opaque source, record and evidence references plus bounded metadata and source artifact provenance. Installation HMAC keys and raw repository/session IDs, repository/project names, URLs, refs, SHAs, paths, prompts, summaries, commands, outputs, commit text, diffs and source payloads are prohibited from adapter output. G2 human privacy approval remains required before activation.
- Regressions or accepted exceptions: None evaluated or accepted. Source partiality, stale state and metadata-only count zero are preserved explicitly so downstream work cannot overstate source facts. Unit coverage is authored but unverified until the targeted checks run.
- Compatibility and release decision: The change is additive and has no production consumer. Active Attention and current Recent Work behavior remain unchanged. S-001 automated validation passed, but release is **deferred**; source-adapter activation and any presentation remain prohibited until required human gates are completed.
- Rollback: Remove the GitHub/Codex adapter files, their Continuation barrel export and targeted adapter tests. Because the adapters are unwired and no artifacts are persisted, no data migration, public API rollback or Active Attention rollback is required.
- Follow-up work: Obtain G2 privacy human sign-off. R-001 is implemented and validated below; R-002 candidate derivation is the next engine task.

### R-001 pure Continuation identity resolution — 2026-08-12

- **Status:** Implemented locally; shadow-only and not activated. Validated on 2026-08-13 KST: `npm run typecheck` passed, targeted Vitest (`continuationIdentity`, `continuationSourceAdapters`, `continuationContracts`) passed 3 files/38 tests, and `npm run lint` passed. This run includes the missing/duplicate proof, valid conflicting proof, terminal remove, and isolated HMAC-tamper regressions.
- **Goal and behavior after:** `resolveContinuationIdentity(unknown, { installationSecret })` consumes integrity-checked WorkContext Registry data and server-side private adapter batches, verifies their HMAC identity binding proofs with a separately supplied installation secret, and maps an observation only through a terminal explicit-user confirmed registry decision.
- **Contract/version:** R-001 input, result, and schema are v0.2. S-001's private adapter batch contract is v0.2 and carries canonical `identityBindings` proofs containing an opaque source identity, HMAC scope binding reference, source snapshot hash, adapter version, key ID, and proof HMAC. GitHub/Codex adapter versions remain v0.1 and Continuation Observation remains v0.2.
- **Integrity boundary:** A proof set must cover the exact observation identity set. A missing proof or identical duplicate proof is an adapter-batch contract violation and fails closed as `IDENTITY_INPUT_REJECTED`; it is not a user-facing Setup state. A structurally valid batch with a tampered proof or the wrong installation secret is also rejected after HMAC verification. Hostile getters and other unknown-boundary exceptions fail closed rather than escaping.
- **Resolution policy:** A valid proof plus exactly one matching terminal explicit confirmation yields `mapped`. A valid proof with no confirmed registry mapping, a proposal-only mapping, or a terminal remove/unmapped decision yields `setup_needed/null`. Multiple distinct valid proofs that bind one identity to different scope references, or an otherwise ambiguous scope/project match, yield `conflict/null`. The obsolete `IDENTITY_BINDING_MISSING` resolution reason is removed because proof absence cannot cross the validated input boundary.
- **Privacy and data handling:** Neither the adapter batch nor the R-001 input/result exposes naked raw `SourceScopeRef` values for source identities. Scope matching recomputes installation-keyed binding references from the existing registry in memory. Result records contain registry/source batch hashes and resealed observations, not secrets, proofs, repository IDs, Codex scope IDs, names, URLs, paths, prompts, summaries, commit text, or diffs. Existing evidence minimization and private artifact rules remain unchanged.
- **Scope exclusions:** No persistence, public API, runtime consumer, UI, Active/Recent Work behavior, automatic confirmation, project auto-selection, candidate derivation, scoring, or action execution was added. R-002 remains the next engine task.
- **Evaluation/baseline:** Baseline is N/A at R-001 because R-002 candidate behavior is not implemented. No frozen dataset, comparison, quality improvement, release, or activation claim is made.
- **Human gates:** G2 privacy approval and later shadow/activation/release approvals remain pending. Persistent mapping and correction/removal remain post-MVP human-gated work.
- **Rollback:** Remove `resolveIdentity.ts`, its export and R-001 tests, and if necessary revert the private adapter-batch proof contract from v0.2. Because the feature is unwired and has no persistence/API/UI side effects, rollback does not require data migration.
- **Residual risk:** Proofs authenticate source identity-to-scope/snapshot/adapter binding, while observation authenticity still relies on the trusted server-side S-001 producer and verified source snapshot boundary. Do not expose the private adapter batch as a caller-authoritative public contract without a separate keyed whole-batch authenticity design and review.

### R-002 deterministic Continuation candidate derivation — 2026-08-13

- **Status:** Implemented and automatically validated locally on 2026-08-13 KST; pure, unwired and not activated. `npm run typecheck` passed, targeted Vitest passed 5 files/70 tests, and `npm run lint` passed. Build, baseline, comparison evaluation and Git commands were not run for this checkpoint.
- **Goal and behavior after:** `deriveContinuationCandidates` consumes an integrity-checked R-001 result plus an explicit versioned `asOf`/configuration envelope and produces a strict sealed result in deterministic `candidateId` order. A fresh mapped GitHub or Codex observation produces one display-only single-source candidate. Fresh GitHub and Codex observations produce `linked_workstream` only when both have the exact same explicit WorkContext; name or timestamp similarity never links work. `setup_needed` and `conflict` produce separate `workspace_mapping` candidates with reason-specific deterministic private setup descriptors. Conflict never becomes a ready mapped candidate.
- **Eligibility and bounded meaning:** Every admitted observation must be nonfuture, nonterminal, free of observation conflict/error, and satisfy `observedAt <= asOf < expiresAt`, where `expiresAt` is exactly `observedAt + 7 days` under the current activity-window policy. Stale snapshots are excluded. Partial or unknown coverage and unknown terminal state may be admitted only with explicit caveats; they do not support unfinished, current, urgent or important claims. Per source/WorkContext identity, only the newest eligible observation survives and superseded observations are counted. Exclusion and setup-reason histograms are bounded and derived exactly from the sealed candidates.
- **Candidate/action separation:** Mapped single-source and linked candidates use `capability=display`, `availability=ready`, and `privateActionTarget=null`. Setup candidates use `capability=open_setup_surface`, `availability=setup_required`, `workContextId=null`, and a private descriptor derived from the R-001 result hash, canonical source observation IDs, the reason-specific domain and setup-target policy. That descriptor is not executable, persisted or caller-authoritative and grants no navigation or target authority by itself.
- **Scoring boundary:** R-002 assigns `continuityScore=0` and sets every score-breakdown field to zero. It does not rank by score, choose a primary, enforce diversity or resolve a Continuation decision; those behaviors belong to R-003.
- **Integrity and authenticity boundary:** Envelope, content and sealed result schemas are strict canonical fail-closed boundaries, including hostile getters, cycles, `BigInt`, non-finite numbers and `undefined`. Candidate/result IDs and hashes are deterministic. Result-schema success proves artifact structure and hash integrity only. Consumers that require derivation authenticity against a particular R-001 result must use `verifyContinuationCandidateDerivationResultAgainstInput`, which strict-parses both inputs, re-runs the pure derivation and requires byte-identical canonical output. R-002 also rejects inconsistent resolutions for one exact source identity.
- **Freshness provenance correction:** During R-002 hardening, the private S-001 adapter-batch contract/schema/hash domain moved from v0.2 to v0.3 and added hash-bound `evaluatedAsOf` and `snapshotFreshnessCutoff` for available batches; unavailable batches retain null provenance. R-001 input/result/schema/hash moved from v0.2 to v0.3 and carries canonical per-source freshness evaluations containing the source, exact adapter-batch hash, evaluated time and cutoff. R-002 requires its envelope `asOf` to equal every present source evaluation time and recomputes each observation's freshness from its snapshot capture time and recorded cutoff. This prevents reuse of a formerly fresh snapshot under a later derivation time.
- **R-002 versions and compatibility:** The current internal derivation envelope, result, schema, result/config hash domains and rule are v0.2. The initial internal v0.1 derivation draft was superseded before release. Strict v0.3 S-001/R-001 boundaries reject legacy exact-v0.2 artifacts, and strict R-002 v0.2 boundaries reject the superseded v0.1 derivation tuple. No compatibility adapter or migration was added because none of these private artifacts has a production consumer or persisted/released state. Public Candidate, Continuation Decision, Work Suggestion Board, Active Attention and Recent Work contracts and behavior are unchanged.
- **Affected files:** `src/continuation/deriveCandidates.ts`, `src/continuation/index.ts`, `src/crossSource/versions.ts`, `src/continuation/adapters.ts`, `src/continuation/resolveIdentity.ts`, and the targeted Continuation candidate, source-adapter and identity tests. No API, UI, runtime collector/consumer, Board composer, persistence, monitor/replay, action gateway or E-001 dataset row was added or changed.
- **Dataset, evaluation and quality claims:** E-001 resolver rows are not wired to R-002 and the existing mutable Dev Candidate was not modified or promoted. There is no frozen dataset, human-approved Gold, candidate/comparison run or same-input quality comparison for R-002. The 70 targeted regressions are the automated checkpoint for contract, provenance, canonicalization, boundary and candidate behavior only. Evaluator integration is deferred to R-003/B-001 or a separately authorized evaluation task. No quality improvement, release readiness or rollout claim is made.
- **Evidence, confidence, errors and runtime cost:** Candidates preserve bounded evidence references and use only `single_source`, `corroborated` or `setup` evidence bands. Observation conflicts/errors are excluded or represented as Setup clarification as applicable; no LLM confidence is fabricated. The engine is deterministic and invokes no model, so model latency and token usage are not applicable.
- **Privacy and retention impact:** Display labels are generic and do not contain raw repository/session IDs, native paths, URLs, source SHAs, prompts, commands or diffs. The setup target is a private opaque non-executable descriptor. Processing remains in memory with no new persistence, telemetry or retention path. G2 privacy approval remains pending. The trusted private S-001 producer boundary and mandatory input-bound verifier for provenance-sensitive consumers remain explicit residual requirements.
- **Scope and release decision:** No API, UI, runtime, Board, persistence, monitor, action, production flag or migration was wired. All Continuation flags remain off/unwired, Active Attention and Recent Work remain unchanged, and release/activation is deferred pending the existing human gates.
- **Rollback:** Remove `deriveCandidates.ts`, its barrel export, R-002 version constants and candidate tests; revert the private adapter batch fields/schema/hash domain from v0.3 to v0.2 in `adapters.ts` and its tests; and revert R-001 input/result/schema/hash plus source freshness evaluations from v0.3 to v0.2 in `resolveIdentity.ts` and its tests. Because no flag, consumer or persisted artifact is wired, rollback needs no data migration and does not affect public Candidate/Decision/Board, Active Attention or Recent Work.
- **Follow-up work:** R-003 scoring and Continuation resolution is the next engine task. It must consume only an input-bound verified R-002 result, add deterministic scoring/diversity/tiebreak behavior, and complete the deferred evaluator integration without treating this checkpoint as a quality or release baseline.

### R-003 provisional Continuation scoring and input-bound resolver — 2026-08-13

- **Status:** Core implemented and automatically validated locally on 2026-08-13 KST; pure, unwired and not activated. `npm run typecheck` passed, targeted Vitest passed 7 files/89 tests, and `npm run lint` passed. E-001 resolver integration, baseline/comparison evaluation, human review, shadow activation and release remain deferred.
- **Goal and behavior after:** R-003 scores only an input-bound verified R-002 candidate set, selects a deterministic ready-or-Setup pool and produces a distinct sealed resolved-decision artifact. Ready candidates always take absolute precedence over Setup candidates. Within the chosen pool ordering is continuity score descending and `candidateId` lexical ascending; non-null WorkContext diversity is capped at one candidate per WorkContext, null-WorkContext Setup candidates are not auto-deduped, and primary plus alternatives is capped at three.
- **Provisional score policy:** Epoch-millisecond recency uses exact half-open buckets `[0,2h)=35`, `[2h,8h)=28`, `[8h,24h)=21`, `[24h,72h)=14`, `[72h,168h)=7`; future and age `>=7d` values are rejected. Exact corroboration contributes 25 only for an input-bound `linked_workstream` with `evidenceBand=corroborated` and two exact source observations. Resumability, local continuity and explicit preference remain 0. Setup candidates receive recency only and remain partitioned from ready candidates. This score is a provisional shadow/dev ordering hypothesis, not a probability, importance score, quality threshold or release gate.
- **Coverage and status policy:** Coverage is derived from authenticated global source assessments, not the selected candidate's evidence band. An offer is `COMPLETE` only when required GitHub and Codex batches are both available, complete and fresh at the exact resolver `asOf` and there is no quality exclusion. A separate excluded future/conflicting/error row may leave a valid offer available while downgrading it to `SOURCE_LOCAL_PARTIAL`. A normal empty/outside-window result becomes `no_recent_context/COMPLETE` only after the same full source and quality proof. `setup_required` is always `SOURCE_LOCAL_PARTIAL` because identity/actionability is incomplete. No candidate plus safety/quality exclusions yields `insufficient_evidence/INSUFFICIENT`; two unavailable required sources yield `unavailable/UNAVAILABLE`.
- **Mandatory authenticity boundary:** The R-003 API accepts the original authenticated `ContinuationIdentityInput`, the claimed R-001 result, the R-002 derivation envelope/result, an explicit resolution envelope and trusted options. It re-runs R-001 with the separately supplied installation secret, canonical-exact compares the claimed R-001 result, calls the R-002 input-bound rederive verifier and rejects artifacts that do not match. `verifyContinuationDecisionAgainstInput` re-runs the complete chain and canonical-exact compares the resolved artifact. Artifact-schema success alone proves local structure/integrity, not derivation authenticity. The installation secret is never serialized, hashed into output or retained.
- **Source and registry trust hardening:** The private adapter batch contract/schema/hash is v0.4 and authenticates canonical whole-batch content with a domain-separated installation-secret HMAC, including status, source tuple, source snapshot hash, observations, identity bindings, exclusions/counts, source assessment and freshness provenance. Every status, including unavailable, carries an HMAC-bound `evaluatedAsOf`; available batches also carry the exact freshness cutoff and assessment. This prevents replay of an old empty or failure assertion under a later resolver time. R-001 input/result/schema/hash is v0.4. Its builder binds the exact registry with a separate authority HMAC, while resolve requires a mandatory out-of-band trusted `expectedRegistrySha256`; a previously valid signed registry cannot be replayed after removal or reassignment. HMAC verification uses fixed-length/constant-time comparison and hostile unknown inputs fail closed.
- **Execution provenance boundary:** Resolution options require trusted `expectedRegistrySha256`, `expectedCodeCommitSha`, and an exact nullable/present dataset version/SHA pair separate from serialized run claims. The resolution envelope supplies explicit run IDs and timestamps; latency and input/config hashes are deterministically derived, but these caller-supplied receipt fields are not represented as external clock or Git attestation. Every adapter batch `evaluatedAsOf`, R-002 derivation `asOf` and R-003 resolution `asOf` must match exactly.
- **Exact internal version tuple:** Private adapter batch contract/schema/hash v0.4; R-001 identity input/result/schema/hash v0.4; R-002 derivation envelope/result/schema/hash v0.3 with rule/config v0.2; R-003 scoring result/schema, resolver and scoring policy v0.1; resolution envelope/schema v0.1; distinct resolved-decision artifact/schema/hash v0.1. The existing base Continuation Decision v0.2 is nested as the decision body but is deliberately not an R-003 authenticity marker and must not be accepted alone as resolver output. Unknown, legacy or mixed tuples fail closed. No compatibility adapter was added because there are no released or persisted vNext artifacts.
- **Affected files and scope:** Core changes are confined to `src/continuation/adapters.ts`, `resolveIdentity.ts`, `deriveCandidates.ts`, `scoreContinuity.ts`, `resolveContinuation.ts`, the Continuation barrel/version/contract support required by those modules, and targeted Continuation tests. No API, UI, runtime collector/consumer, Board composer, action store/gateway, persistence, monitor/replay, Active Attention or Recent Work path was added or changed.
- **Dataset, evaluation and quality claims:** Baseline/evaluator execution is explicitly **deferred**. E-001 remains a mutable, unfrozen Dev Candidate with the historical 12 measured contract-oracle cases and 10 `not_evaluated` resolver/Board behavior cases. A minimal mapping review found eight resolver cases directly executable against R-003; the CX terminal-state oracle requires a semantic correction or must remain deferred, and B-001 cross-lane cases remain deferred until Board implementation. No new baseline, candidate run, comparison run or same-input comparison was performed. Acceptable@1 and Acceptable@3 remain null. This record makes no resolver-quality improvement, release-readiness or rollout claim.
- **Evidence, errors and runtime cost:** Scored candidates preserve the R-002 evidence bands and exact bounded candidate fields; R-003 does not invent confidence. Decision/run errors are allowlisted and sanitized with null detail. The engine invokes no model, so model token usage is null and model latency is not applicable. Explicit run latency is derived from supplied timestamps.
- **Privacy and retention impact:** Generic display labels remain bounded. Raw repository/session identifiers, scopes, names, URLs, native paths, source SHAs, prompts, commands, outputs, commit text and diffs are not added to decision artifacts. Private Setup descriptors remain opaque and non-executable. Installation secrets and raw registry/source values are not stored or output. Processing remains in memory; retention, telemetry and persistence are unchanged. G2, G3 and G8 human gates remain pending.
- **Compatibility, release and rollback:** Public Candidate/Decision DTO behavior, Work Suggestion Board, Active Attention and Recent Work remain unchanged. No production flag is wired; `continuationResolution` remains effectively off/unwired, so operational rollback is to keep it off and remove `scoreContinuity.ts`, `resolveContinuation.ts`, their exports, v0.1 R-003 version constants and scoring/resolver tests. If the entire trust-boundary tuple must be reverted to the pre-R-003 checkpoint, revert adapter batch v0.4 to v0.3, R-001 v0.4 to v0.3 and R-002 envelope/result v0.3 to v0.2 together; never accept a mixed tuple. Because no artifact is persisted or consumed in production, no migration, API rollback or user-data repair is required.
- **Follow-up work:** Wire the eight directly executable E-001 resolver cases, resolve or explicitly defer the CX terminal oracle, record an actual reproducible evaluation run without rewriting the historical run, and keep B-001 cross-lane evaluation deferred until its implementation. B-001 may be the next code task only if it consumes the trusted R-003 input-bound verifier seam. Shadow use, dataset freeze, G2/G3/G8, quality thresholds and release require later explicit human approval.

### E-001 v0.2 authenticated R-003 resolver-behavior integration — 2026-08-13

- **Status and goal:** Implemented and automatically validated locally on 2026-08-13 KST. E-001 now exercises nine resolver-behavior rows through the actual bounded synthetic GitHub v6/Codex v3 source snapshots, private adapter batch v0.4, authenticated R-001 v0.4 input/result, R-002 v0.3 derivation and R-003 v0.1 resolved artifact. The evaluator verifies both `continuationResolvedDecisionSchema` and the full original-input-bound `verifyContinuationDecisionAgainstInput` seam. This is a synthetic contract/resolver regression checkpoint, not production activation, recommendation-quality evidence or release approval.
- **Behavior and oracle correction:** The 22-row matrix now measures 12 contract oracles and 9 resolver behaviors; only `E1-RV-DT-001` remains `not_evaluated` pending B-001 cross-lane behavior. GitHub mapped recent, missing mapping/Setup, Codex metadata-only, exact seven-day boundaries, stale/partial/future source facts, privacy, same-name non-linking and deterministic tie/permutation behavior run through authenticated producers rather than hand-sealed downstream artifacts. The historical Codex-completed row is corrected to assert that persisted completion metadata leaves live `terminalState=unknown`; it must not fabricate an unfinished, current, urgent or terminal source fact. The same-name row asserts bounded Setup and no automatic merge, not a fabricated R-001 identity conflict.
- **Versions after:** Evaluation dataset contract/case schema, evaluator config, run-record contract and evaluator policy are v0.2. Dataset identity remains `suggestion-continuation-dev-v0.1`, now revision 2, mutable and unfrozen with `datasetSha256=null`; evaluator `configSha256` also remains null. The exercised engine tuple is GitHub source v6/Codex source v3, source adapters v0.1, private adapter batch v0.4, R-001 input/result/schema v0.4, R-002 envelope/result/schema v0.3 with rule/config v0.2, R-003 scoring/resolution/resolved-decision tuple v0.1, and nested base Decision v0.2 only. Existing v0.1 JSON files and the historical v0.1 run remain immutable and untouched.
- **Validation commands:** `npm run typecheck` passed; targeted Vitest passed 8 files/112 tests; `npm run lint` passed. The final two `npm run continuation:baseline` executions also passed.
- **Authoritative evaluation runs:** Run `continuation_eval_run_bb3fa6da77edc64e74d976bbe1a8999e` ran from `2026-08-12T18:30:20.342Z` to `2026-08-12T18:30:20.549Z` (207 ms). Its private artifact is `.local/evaluations/continuation/continuation_eval_run_bb3fa6da77edc64e74d976bbe1a8999e.json`, 43683 bytes with mode 0600; canonical artifact SHA-256 is `afdc1025...` and stored-file SHA-256 is `6e2c9a...`. Run `continuation_eval_run_a74dc27b4c9b6fa9a78e72ad4b668966` ran from `2026-08-12T18:30:26.244Z` to `2026-08-12T18:30:26.503Z` (259 ms). Its private artifact is `.local/evaluations/continuation/continuation_eval_run_a74dc27b4c9b6fa9a78e72ad4b668966.json`, 43683 bytes with mode 0600; canonical artifact SHA-256 is `691a1fe9...` and stored-file SHA-256 is `4d52bfff...`. The abbreviated artifact hashes are copied exactly as supplied by the final validation record and are not presented as independently recomputed full digests.
- **Shared reproducibility hashes and code state:** Dataset candidate payload SHA-256 is `bbb996404c9154d576fda3274ba3f815048405b22795237a1e53ee7f4461edd3`; materialized-input SHA-256 is `94b8562a628bb330e0d38ea53b753a7cb74de43e1cf32ad98f643c121c79042f`; config candidate SHA-256 is `4df7bb61a62e901ebc5ff7be69adc7a9b955e2e0d23d01b53a76c31ab4e4e444`; deterministic-output SHA-256 is `0e81d5281c1c1396b84c84a229c7ae28c4fc9e9b7ff25a9206d9721fe8136ad4`. The runs had `codeCommitSha=null` and dirty-worktree fingerprint `262f6091d1147e737b3fff16b77d872a973098f8a954210a6d75523d7d7a57a7`; therefore they are reproducible dirty-worktree checkpoints, not commit-attested release evidence.
- **Metrics and review:** Both authoritative runs recorded 22 total, 21 measured, 21 passed, 0 failed, 12/12 contract-oracle passes, 9/9 resolver-behavior passes and 1 deferred/`not_evaluated` B-001 row. All critical-error counts are zero and run status is `passed`. Automatic review passed; human review remains `not_started`. The quality claim is limited to `contract_and_resolver_regression_only`; Acceptable@1, Acceptable@3, setup-route quality and setup runtime quality remain null. `releaseGateApplicable=false`, release decision is `deferred`, and no comparison or improvement claim is made. Earlier same-turn diagnostic runs `b375`, `b40c`, `0b407` and `af911` were superseded after correcting materialized descriptors, same-name semantics, timing and tie provenance; they are non-authoritative diagnostics and are not comparisons.
- **Privacy, storage and retention:** Fixtures are bounded synthetic data with no production conversations. Raw fixtures, installation secret, proof/HMAC material and privacy sentinels are not stored in run records. Full artifacts remain only in the private `.local/` store with mode 0600. No public API, runtime, Board, action, persistence, monitoring, Active Attention or Recent Work path changed, and retention policy is unchanged.
- **Release, rollback and follow-up:** R-003 is complete only at this synthetic regression checkpoint. G2, G3 and G8, human review, dataset freeze, shadow/presentation approval and release remain pending. Board integration must consume the outer R-003 artifact together with mandatory input-bound verification; the current Board is not integrated. Rollback removes the additive v0.2 evaluation JSON, resolver fixture/evaluator support and v0.2 evaluation contracts while retaining the untouched v0.1 artifacts and historical run; no production migration or user-data repair is required. B-001 is the next code task.

### B-001 authenticated Work Suggestion Board composer and E-001 v0.3 Board checkpoint — 2026-08-13

- **Status and goal:** B-001 core and the additive E-001 v0.3 revision 3 synthetic Board checkpoint were implemented and automatically validated locally on 2026-08-13 KST. B-001 composes an authenticated read-only Work Suggestion Board without changing Active Attention or trusting a bare Continuation Decision. The implementation remains pure and unwired: no API, UI, runtime consumer, persistence, monitor/replay, action gateway, production flag, external mutation or automatic action was added or activated. This record is a synthetic contract/resolver/Board regression checkpoint, not shadow, presentation, release or quality approval.
- **Exact version tuple:** Internal Work Suggestion Board input contract, result contract, schema, input hash domain, result hash domain and semantic-result hash domain are v0.3. Public Work Suggestion Board contract/schema remain v0.1. Board composer, Attention→Continuation→Setup precedence policy and Board ID policy remain v0.1 because their semantics did not change. The exact upstream tuple remains private adapter batch v0.4, R-001 input/result/schema/hash v0.4, R-002 envelope/result/schema/hash v0.3 with rule/config v0.2, R-003 scoring/resolution/resolved-decision tuple v0.1 and nested base Continuation Decision v0.2. Unknown, legacy or mixed tuples fail closed; no compatibility adapter was added because these internal artifacts are neither released nor persisted.
- **Authenticated composition boundary:** `composeWorkSuggestionBoard` accepts one strict composition bundle containing the exact Active v0.5 artifact and the complete original R-001/R-002/R-003 inputs/artifacts, plus separate trusted resolver options. Before reading the outer artifact's nested `.decision`, it calls `verifyContinuationDecisionAgainstInput` against the exact original inputs, installation secret and trusted registry/code/dataset expectations. A bare base Decision, legacy artifact, mixed tuple, locally rehashed or forged outer artifact, wrong secret, registry SHA, code SHA, dataset version/SHA, `asOf` or version yields typed `WORK_SUGGESTION_BOARD_INPUT_REJECTED` and no Board. The caller retains its unchanged Active artifact. Hostile unknown values fail closed at exported Board boundaries.
- **Exact artifact binding and verification:** The Board input embeds and hashes the exact caller-owned Active result and exact outer `ContinuationResolvedDecision v0.1`; it does not substitute parsed/trimmed copies. Dependencies separately bind Board input SHA, Active result SHA, outer R-003 result SHA, nested base artifact SHA and nested semantic SHA. The composer preserves the exact Active object/reference, canonical bytes and `resultSha256` and does not re-run, rebuild or mutate Active. `verifyWorkSuggestionBoardResultAgainstInput` recomposes from the full authenticated bundle and canonical-exact compares the complete Board. Low-level Board schema/hash success establishes local integrity only, not authenticity against a particular input chain.
- **Precedence and dedupe behavior:** Active `suggested` candidates or the Active `needs_clarification` item always lead the exact Board-visible sequence, followed by the outer R-003 Continuation/Setup order. Attention and Continuation numeric scores are never compared. Cross-lane dedupe occurs only for an exactly equal non-null WorkContext and Active wins. Equal labels with different WorkContexts remain separate. Null-WorkContext Setup items are not auto-deduped. Lane order is preserved and the result schema requires exactly the first three expected items: primary plus at most two alternatives, not an arbitrary prefix.
- **Capability, privacy and semantic-hash policy:** Board composition never elevates authority. A valid `open_source` or `open_setup_surface` capability preserves its exact existing private target only when capability, availability and target agree with the established Board policy; `display` remains targetless. Public Attention Board items are contractually display-only with `action=null`. Execution policy remains `automaticExecutionAllowed=false`, `explicitUserActionRequired=true`, `externalMutationAllowed=false`. Public safe-text and private-identifier sentinels remain enforced. The Board semantic hash changes for visible semantic changes and records target capability, but intentionally excludes the private target locator; the full artifact/input hashes still bind exact private targets.
- **Evaluation versioning:** E-001 is an additive v0.3 revision 3 change. Dataset contract/case schema, evaluator config, run-record contract and evaluator policy are v0.3. Dataset identity remains `suggestion-continuation-dev-v0.1`, revision 3, class `dev_candidate`, mutable and unfrozen; lifecycle `datasetSha256` and `configSha256` remain null until a separately approved freeze. The v0.1 and v0.2 dataset/config/run artifacts and their historical records are immutable and were not rewritten.
- **Validation evidence:** On 2026-08-13 KST, `npm run typecheck` passed, targeted Vitest passed 9 files/119 tests, and `npm run lint` passed. Both final `npm run continuation:baseline` executions passed. These are the actual recorded checks for this checkpoint; no build, production runtime or UI validation claim is made.
- **Authoritative evaluation runs and private artifacts:** Run `continuation_eval_run_fa965c0e27a9984410b0a3dd61bf9c9e` passed; its canonical artifact SHA-256 is `d2af2a190b369991851299b66151458ec84757f1031a48946f86b5a75677cbac` and stored-file SHA-256 is `b801984ab3f80ac876ab38fedf5cee4bc2bbf58c9624b04af6f1cee52d13e93e`. Run `continuation_eval_run_374acb944d5a79845453fb8e93eabbab` passed; its canonical artifact SHA-256 is `3e3ded697842ee4f98aa723782115026bb148c3941d57a6f524d11c63720c0e2` and stored-file SHA-256 is `3bca184a1aa1c8c72cccc8ddf0c0d241349e5efa446bc91613a79f711402d8a1`. Full artifacts remain outside Git under `.local/evaluations/continuation/` with mode 0600. Per-run canonical/stored artifact hashes differ as expected because run receipts are distinct; this is not a deterministic semantic-output mismatch.
- **Shared reproducibility hashes:** Both authoritative runs share dataset candidate payload SHA-256 `98a3c8135b23c6ac2aeddd3c2ada511d3d9a46638fb016d95d86945c8f6d8f31`, materialized-input SHA-256 `de9dd348173cdf5087905a1c7b33e2ee20cd948159280572e8f090b95cdb9da2`, config candidate SHA-256 `60ac735cc0d8566772ef7fbf5329f5e626d89c02a8e408d3dafbda28f658221b` and deterministic-output SHA-256 `bd6dfccc525cef2ee1837b08dfb2fa3a88b8776c7283732bb36e4502fd0db4e7`. The shared deterministic hash, rather than per-run receipt hashes, is the replay-equivalence evidence.
- **Metrics and claim boundary:** Both runs recorded 22 total, 22 measured, 22 passed, 0 failed and 0 deferred: 12/12 contract-oracle, 9/9 resolver-behavior and 1/1 Board-behavior pass. Critical-error counts are zero and automatic review passed; human review remains `not_started`. Acceptable@1, Acceptable@3, setup-route accuracy and setup runtime quality remain null. `releaseGateApplicable=false`, the release decision remains `deferred`, and release/activation is false. No quality improvement, comparison, frozen-baseline, Gold or production-readiness claim is made.
- **Privacy, retention and data handling:** Revision 3 uses bounded synthetic fixtures and contains no production conversations. Raw fixtures, installation secret, registry/source values, proof/HMAC material and privacy sentinels are not emitted in run records. Exact private targets remain internal, are excluded from public projection and are not executed or persisted by B-001. Tracked retention and telemetry behavior are unchanged; private evaluation artifacts remain `.local/` mode 0600 and outside Git. No new production dependency was added.
- **Compatibility and rollback:** Public Board v0.1, public Continuation DTOs, Active Attention, Recent Work and production behavior remain unchanged. Operational rollback is to keep the unwired Board/Continuation flags off and remove the additive B-001 composer/contracts/exports/tests plus v0.3 evaluation artifacts/support while retaining immutable v0.1/v0.2 history. Because no API, runtime consumer or persisted Board was introduced, rollback requires no migration, user-data repair or Active redeployment.
- **Next task and human gates:** B-001 is implemented and validated at the synthetic core checkpoint. Dependency order makes A-001 the next code task, but this record does not authorize it or any activation. G2 privacy approval, G3 shadow/dual-lane approval and the A-001 public API review must be recorded before wiring; G4 presentation, G5 action, G7 dataset freeze and G8 release gates remain pending. Until then the exact Board output remains read-only and unwired.

### A-001 action-disabled local Work Board shadow monitoring slice — 2026-08-13

- **Status and scope boundary:** The narrow A-001 action-disabled local shadow monitoring slice is implemented and automatically validated at the current head on 2026-08-13 KST. It is not completion of the full A-001 action/public rollout: no Continuation action API, public rollout, production activation or release is approved.
- **Runtime behavior:** One request uses a single bounded live capture and passes that exact capture through the actual `S1 → R1 → R2 → R3 → B1` chain. The slice does not trigger a source refresh, take a second capture for recomposition, or persist a Board/result artifact. It is not filesystem-byte-pure: the reused existing Attention/store read paths may acquire leases and perform bounded recovery, temporary-file cleanup or retention maintenance. Those existing local maintenance effects are not Continuation actions and do not authorize external mutation.
- **Transport and flag contract:** The additive wrapper contract serves `GET /api/work-board` only behind the exact `BLABASE_WORK_BOARD_SHADOW_READ_ENABLED` flag. The flag is default-off. The route is local-only, enforces the safe-origin boundary and returns `Cache-Control: no-store`; disabling or rejecting the shadow path does not enable another Continuation surface. The known local-store side-effect residual is rated Medium and accepted only for bounded local review, not for production shadow activation.
- **Presentation and fallback:** An Attention Lab panel may render the public display-only Board projection. When the shadow Board cannot be safely produced, the slice preserves a bounded Active-only fallback. It does not change or integrate `WorkCockpit`, and it does not reinterpret Active Attention or promote a fallback into a Continuation claim.
- **Public-text safety boundary:** The new `publicTextSafety.ts` boundary is applied by the public contracts/projection. Credential-shaped public text fails closed before a Board wrapper can be returned. This complements the existing private-target/native-identifier exclusions and does not make arbitrary source text safe by assertion.
- **Authority exclusions:** This slice adds no action execution or offer endpoint, Continuation/Board/result persistence, source refresh, external mutation, telemetry, WorkCockpit integration, `GET /api/continuation`, or `POST /api/continuation/open`. Public items do not expose private targets or identifiers, and the wrapper grants no capability beyond display. Existing bounded Attention/store lease, recovery, cleanup and retention-maintenance effects remain explicitly outside this no-new-persistence claim.
- **Version and semantic boundary:** Public Work Suggestion Board contract/schema remains v0.1. The exact private S-001/R-001/R-002/R-003/B-001 tuple and the core E-001 v0.3 revision 3 dataset/config/evaluator checkpoint are unchanged. The wrapper is an additive display-projection boundary and does not change engine admission, ranking, input interpretation, result resolution, output semantics or hashes.
- **Validation evidence:** At the current head on 2026-08-13 KST, `npm run typecheck` passed; targeted Vitest passed 5 files/52 tests (`liveWorkBoardShadow`, `workBoardRoute`, `suggestionBoardContracts`, `continuationContracts`, `continuationResolver`); and `npm run lint` passed. This current-head run covers the public-text safety and documented local-side-effect boundary. A baseline run remains N/A because no core engine ranking/input/output semantics changed and the core v0.3 dataset remains unchanged. No baseline, comparison, quality-improvement or release-readiness claim is made.
- **Privacy and retention impact:** No new Board/result persistence, external telemetry or source-refresh retention path is added, and no production conversation is promoted into evaluation data. Existing Attention/store reads may still perform the bounded local lease, recovery, temporary cleanup and retention-maintenance effects described above. The public v0.1 projection plus `publicTextSafety.ts` fail-closed screening remains the privacy boundary; private targets, raw source data and credential-shaped public text are not returned.
- **Gates, rollback and release:** G2 privacy and G3 production shadow/dual-lane gates are blocked until an approved preserve-mode read or atomic snapshot path removes the known local-store mutation ambiguity. The Medium residual is accepted only for local review. Human public API/presentation/action/release approvals remain pending. Operational rollback is to leave or set `BLABASE_WORK_BOARD_SHADOW_READ_ENABLED` disabled; the Active-only path remains available and no Board/result migration or user-data repair is required.
- **Next safe task:** Add or select an explicit preserve-mode or atomic snapshot path, validate that path, and then perform the narrow flag-off/flag-on local API and Attention Lab smoke review covering safe-origin, no-store, credential-shaped public-text rejection and Active-only fallback. G2/G3 and public API review must remain blocked before production exposure. Action, Board/result persistence, source refresh, external mutation, telemetry, WorkCockpit integration and Continuation endpoints remain out of scope.

### Semantic Continuation v0.1 authenticated local title overlay — 2026-08-13

- **Status and goal:** Implemented and automatically validated locally. This
  narrow slice lets a user explicitly confirm `QA_RUN` for one currently
  visible, mapped, display-only Continuation item and deterministically show
  `${subjectLabel} QA 진행하기`. It is a local display-copy overlay, not a QA
  result, action offer, execution gateway, ranking signal, feedback signal or
  telemetry event.
- **Owner and code provenance:** Codex with human direction; uncommitted shared
  working tree. No commit, push, merge, rebase or other Git mutation was run.
- **Behavior before and after:** Before, the post-public Work Board always kept
  its generic Continuation title. After a strict same-origin/local/authenticated
  confirmation, a fresh `ready/full` base Board is evaluated again and its
  exact public item/context refs, registry SHA-256, observed time and candidate
  expiry are bound into a private decision. A later authenticated GET keeps the
  complete base `WorkBoardApiResponse` byte-identical and schema-valid, and may
  return a separate itemRef-bound `displayTitle` presentation. The client uses
  that value only while rendering; base title/summary, item/order/lane,
  evidence/caveats, capability/action, execution policy and all authenticated
  S1/R1/R2/R3/B1 artifacts remain unchanged. Missing, corrupt, expired or
  mismatched state returns `semanticPresentation=null` beside the unchanged
  generic base response.
- **Contracts and versions after:** New additive contracts are
  `semantic-continuation-intent-v0.1`,
  `semantic-continuation-intent-store-v0.1`,
  `semantic-continuation-schema-v0.1`,
  `semantic-continuation-title-overlay-v0.1` and
  `semantic-continuation-presentation-v0.1`,
  `semantic-continuation-work-board-response-v0.1`,
  `semantic-continuation-intent-ttl-24h-v0.1`. Existing Continuation
  observation/input/candidate/decision contracts, R1/R2/R3 policies and
  artifacts, B1 contracts/composer, E-001 evaluator tuple and public Work Board
  contract/schema literals remain unchanged.
- **Confirmation and currentness boundary:** `POST /api/work-board/intent`
  accepts only `{intent:"QA_RUN", subjectLabel, itemRef, workContextRef,
  explicitUserConfirmation:true}`. It checks local request, exact same origin,
  the default-off Work Board flag and configured Basic authorization before
  parsing the body or reading private state. The server freshly evaluates the
  unoverlaid base Board and accepts only a non-expired mapped Continuation item
  with `capability=display` and `action=null`. The response exposes only the
  bounded status, intent, deterministic title and expiry.
- **Authenticated read boundary:** `GET /api/work-board` retains its local,
  safe-origin, no-store and default-off gates and additionally fails closed
  unless `SUGGESTION_ACCESS_PASSWORD` is configured and the request carries
  valid Basic authorization. It checks authorization before evaluating the
  live Board or reading the private semantic store, so a development middleware
  bypass cannot expose a confirmed subject label.
- **Private persistence and retention:** The append-only local record is stored
  at `.local/semantic-continuation/intent-store.json` with directory mode 0700,
  file mode 0600, serialized mutations and temporary-file atomic rename. It
  binds public opaque refs, registry SHA-256, target observation/candidate
  expiry, confirmation/effective expiry and supersession; its effective expiry
  is `min(confirmedAt + 24h, candidateExpiresAt)`. Reads are pure and never
  repair, prune or rewrite missing/corrupt/stale state. The bounded history is
  currently limited to 1,000 decisions; an explicit retention-maintenance
  design is follow-up work before long-lived use.
- **Public and privacy boundary:** Subject labels reject controls, path
  separators and relative traversal, URLs, all known internal/public ref
  prefixes, Git-sized hashes, credential-shaped text and Korean/English tokens
  that could smuggle pass/fail/completion/result/apply/execution claims. The
  semantic-token check also runs after NFKC normalization and separator removal,
  so camelCase and concatenated claim forms fail closed. Raw source artifacts,
  repository/session/native IDs, HMAC/proof material, local paths,
  URLs, prompts and credentials are neither stored in the semantic intent
  record nor returned outside the authenticated local presentation boundary.
  The base public Board JSON keys, values and contract/schema literals do not
  change. The additive response envelope keeps `base` under the existing strict
  schema and carries a separately versioned nullable `semanticPresentation`
  whose overlays contain only `itemRef` and deterministic `displayTitle`.
- **Authority exclusions:** The overlay does not create QA pass/fail/completion
  facts, apply results, execute work, change capability/action, rank or dedupe
  candidates, emit telemetry, refresh sources or persist any core Board or
  engine artifact. `automaticExecutionAllowed=false`,
  `explicitUserActionRequired=true` and `externalMutationAllowed=false` remain
  unchanged.
- **Validation evidence:** From `suggestion/`, targeted Vitest passed 8 files
  and 35/35 tests covering contracts, privacy controls, decision/store
  integrity, TTL/supersession/atomic permissions, pure corrupt reads,
  byte-identical base/fallback, separate display-title presentation, client parsing, route
  local/origin/auth/currentness behavior, live shadow and UI presentation.
  `npm run typecheck` and `npm run lint` passed. Build and manual browser smoke
  were not run.
- **Evidence and runtime accounting:** Evidence is the exact freshly projected
  item/context/registry/time binding plus the explicit confirmation literal;
  no confidence score is created. The path invokes no model, so token usage and
  model latency are not applicable. No latency/telemetry record is added;
  transport failures use bounded `WORK_BOARD_INTENT_*` codes and private parse
  details are not returned.
- **Dataset and baseline decision:** No Golden, Regression or mutable E-001
  dataset input, version, hash, label or artifact changed; no production
  conversation was used. A core baseline/comparison run is N/A because the
  authenticated Continuation/Board inputs, candidate admission, ranking,
  resolution, artifacts and hashes are unchanged. The targeted overlay
  regression is the evidence for this presentation-only semantic change; no
  quality-improvement or release-readiness claim is made.
- **Compatibility, release and rollback:** The flag remains default-off and the
  feature is limited to the existing local Attention Lab boundary. Production
  exposure and release approval remain pending. Rollback is to keep
  `BLABASE_WORK_BOARD_SHADOW_READ_ENABLED` disabled, remove the additive intent
  route/UI/semantic module and leave the private `.local` file unused or remove
  it through an explicitly approved local cleanup. No core artifact migration,
  Active Attention rollback or remote repair is required.
- **Residual risks and follow-up:** Atomic rename plus a process-global queue is
  designed for one local Next.js process, not multi-process CAS. The store's
  1,000-record ceiling needs explicit retention maintenance before long-lived
  use. Manual same-origin Basic-auth browser smoke and a reviewed
  retention-maintenance policy remain follow-up work.

### SC-002 explicit local Semantic Validation receipts — 2026-08-13

- **Status and scope:** The first SC-002 slice is implemented and automatically
  validated locally. Only an explicit, argument-free
  `npm run semantic-validation` invocation may start validation. Browser GET,
  intent POST, polling, client and UI paths import no SC-002 producer/profile or
  validation-subprocess execution path. The reused A-001 live capture still has
  its pre-existing read-only Git code-provenance probe; this slice therefore
  claims no **validation** subprocess from HTTP, not zero OS child processes
  across the complete inherited capture graph. This slice records local QA
  validation state; it does not run
  work, apply a result, create a structured finding, alter rank/evidence/action,
  or authorize a Continuation capability.
- **Behavior before and after:** Before, an active SC-001 confirmation could
  only render `${subjectLabel} QA 진행하기`. After a verified current validation
  receipt, the separate presentation overlay may instead render exactly
  `QA 진행 상태 확인하기`, `QA 실패 항목 검토하기`, or
  `QA 통과 결과 확인하기`. Inconclusive, missing, invalid, stale, code-drifted
  or binding-mismatched state falls back to the SC-001 title. A newly started
  run is authoritative immediately and shadows every older result, including an
  older valid pass. The existing `base` WorkBoard API response remains
  byte-identical and is reparsed at the boundary; title state exists only in the
  separate itemRef-bound presentation envelope.
- **Contracts and version tuple:** New private contracts are
  `semantic-continuation-validation-receipt-v0.1`,
  `semantic-continuation-validation-store-v0.1`,
  `semantic-continuation-validation-schema-v0.1`, fixed profile v0.1, receipt
  policy v0.1, 24-hour TTL policy v0.1 and validation-title template policy
  v0.1. To admit the three new fixed titles without changing the base Board,
  only the additive presentation envelope advances from v0.1 to
  `semantic-continuation-presentation-v0.2`,
  `semantic-continuation-work-board-response-v0.2` and
  `semantic-continuation-presentation-schema-v0.2`. The persisted SC-001 intent,
  overlay and TTL contracts stay v0.1. Core Continuation/R1/R2/R3/B1 and E-001
  contracts, policies, hashes and dataset remain unchanged.
- **Fixed execution profile:** The profile validates the current package scripts
  and then launches the resolved Node executable directly with realpath-confined
  fixed entrypoints for TypeScript, ESLint and Vitest in the exact order
  `typecheck`, `lint`, `unit_test`. Arguments, cwd, environment and timeouts are
  fixed; `shell:false` and ignored stdin/stdout/stderr are mandatory. Arbitrary
  command, package script, argv, cwd, label-derived path and client receipt
  upload are rejected or absent. The working root is the realpath-validated
  `suggestion/` directory only. Dirty, declared or unavailable code provenance
  yields an inconclusive receipt with no validation subprocess.
- **Authority, lifecycle and currentness:** Run start first acquires a renewable
  private filesystem run lease; a loser reads no intent/receipt/base/code
  authority and spawns no validation subprocess.
  SC-001 confirmation and SC-002 start reuse the same filesystem coordination
  lock, and run start re-reads the exact current unsuperseded intent while
  holding it. The start receipt binds intent decision ID/hash, item/context refs,
  registry SHA-256, observation and candidate expiry, intent confirmation and
  expiry, plus typed clean-code provenance. Before terminal persistence the
  producer rechecks run-lease ownership, end provenance, fresh Board/intent
  currentness and the validation window. A stale dead-process lease is recovered
  as an `inconclusive/RUN_ABANDONED` terminal event before a new run starts.
- **Receipt integrity and storage:** Running and terminal events form a strict,
  chronological, append-only SHA-256/HMAC revision chain with one explicit
  current-run/current-receipt pointer. The HMAC key is derived in memory from the
  existing installation secret, which is never placed in a receipt, API response
  or CLI summary. Any malformed or unauthenticated tail rejects the complete
  store; no prefix salvage or repair occurs. State is atomically stored under
  `.local/semantic-continuation/validation/receipts.json`; directories and files
  are enforced as 0700 and 0600. Receipts are bounded to 512 and expire at the
  earliest of 24 hours, intent expiry and candidate expiry.
- **Privacy and output boundary:** Stored/API/presentation data contains no raw
  stdout/stderr, command strings, executable or workspace paths, repository or
  session native IDs, URL, prompt, credential or installation secret. CLI output
  is limited to bounded status/code, run ID, receipt SHA-256 and three step
  statuses. Test process output is discarded by the production runner and no
  telemetry or remote persistence was added.
- **Validation evidence:** From `suggestion/`, targeted Vitest passed 13 files
  and 56/56 tests covering receipt/store HMAC and tamper rejection, exact status
  arrays and lifecycle, TTL/current-run shadowing, private modes and pure reads,
  serialized appends, live/stale run leases, fixed profile and injection
  rejection, fail-fast execution, provenance drift, presentation fallback/base
  invariants, HTTP validation-execution isolation, SC-001 client/route/store and UI
  compatibility. `npm run typecheck` and `npm run lint` passed. The production
  validation CLI itself was not invoked: it is reserved for explicit user
  invocation and the current shared worktree is intentionally uncommitted.
- **Dataset, baseline and release:** No Golden/Regression/E-001 input, label,
  version, hash, evaluation artifact or production conversation changed. Core
  engine semantics and Board bytes are unchanged, so a core baseline is N/A.
  This local validation receipt is not a release gate, Gold label, quality score
  or production approval. Default-off/local/authenticated SC-001 boundaries and
  all existing human release gates remain in force.
- **Threats, rollback and follow-up:** A same-user attacker who can replace both
  the private state and the installation-secret authority can forge or roll back
  state. HMAC and append chaining detect ordinary corruption/tampering, but a
  replay of an older fully valid store cannot be detected without a separate
  monotonic anchor. Cross-host/distributed execution is unsupported. The
  512-receipt ceiling needs an approved retention/compaction policy; manual CLI
  and browser smoke remain pending. Rollback removes the additive validation
  module, CLI/script and presentation v0.2 handling while leaving the v0.1
  intent store and byte-identical base Board path intact; private receipts may be
  left unused or removed only through an explicitly approved cleanup.

### A-001 PR-001 preserve-only local read boundaries — 2026-08-13

- **Status and scope:** PR-001 is implemented and validated; A-001 remains
  partial. This slice adds explicit preserve-only read boundaries but does not
  wire them into live Attention, the Work Board route, Semantic Continuation,
  or any formal public API. Existing callers continue to use backward-compatible
  `maintain` mode.
- **Owner:** User is product/release approver. Codex implemented the scoped
  source/tests and authored this record. Independent QA subagents performed
  advisory static/reproduction review; this is not human release approval.
- **Versions before and after:** Before PR-001 there was no serialized or public
  preserve-read contract and local reads exposed only implicit maintenance
  behavior. After PR-001, `LocalReadMode = "maintain" | "preserve"` is an
  additive internal TypeScript boundary with no new persisted schema literal.
  The following persisted versions are exactly unchanged before → after:
  GitHub `github-snapshot-v6`; Codex `codex-connector-config-v3`,
  `codex-snapshot-v3`, `codex-local-git-snapshot-v1`,
  `codex-observation-history-v2`, and
  `codex-conversation-and-execution-store-v1`; Google Calendar
  `google-calendar-snapshot-v1`; Notion `notion-snapshot-v1`; managed Codex
  `codex-managed-run-registry-v1`, `codex-managed-event-v1`,
  `codex-managed-event-history-v1`,
  `codex-managed-latest-projection-store-v1`,
  `codex-managed-public-projection-v1`, `codex-managed-settlement-v1`, and
  `codex-managed-retention-v1`; work-artifact attribution
  `work-artifact-attribution-store-v0.1`,
  `work-artifact-attribution-schema-v0.1`, and
  `work-artifact-attribution-retention-30d-v0.1`. S1/R1/R2/R3/B1,
  public Work Board, E-001 dataset/config/evaluator, SC-001, and SC-002 versions
  are also unchanged.
- **Behavior before and after:** Connector reads previously performed bounded
  stale-temp cleanup and Codex privacy/retention cleanup. Managed Codex
  observability and work-artifact attribution reads could also acquire locks,
  recover settlements, prune retention state, and rewrite or delete local
  files. Connector readers now accept shared `LocalReadMode` with default
  `maintain`; `preserve` reads only stable, owned 0700/0600 local state and
  performs legacy migration or retention projection in memory. Additive
  `readManagedCodexObservabilityPreservingState` and
  `readWorkArtifactAttributionStorePreservingState` APIs acquire no lease and
  perform no cleanup, recovery, permission repair, retention write, rename, or
  deletion. Pending settlement, lock/temp evidence, corrupt or incoherent
  stores, unsafe modes, symlinks, and unstable file identity fail closed while
  leaving the observed state in place.
- **Compatibility and authority:** All existing read signatures remain valid
  and default to their prior maintenance behavior. The new APIs do not claim
  pending data is current and do not elevate any Board, Continuation, action,
  execution, or result authority. No core S1/R1/R2/R3/B1 contract, schema,
  version, hash, ranking, evidence, candidate, or evaluation artifact changes.
- **Privacy and retention:** Preserve reads expose no new public data and add no
  persistence. Codex corrupt, expired, or unconsented conversation state is
  unavailable without unlinking its private history; managed and attribution
  retention is projected in memory only. Stable reads reject final-component
  or controlled-ancestor symlinks, unsafe ownership/mode, replacement, and
  mid-read change. Raw local content remains private and is not copied into Git
  or an API response. OS-managed `atime` is explicitly outside the invariant:
  successful `read`/`readdir` may update access accounting on macOS. Preserve
  guarantees no code-controlled mkdir/write/rename/unlink/chmod/utimes, lease,
  recovery, cleanup, or disk-retention mutation; it does not claim zero access
  accounting.
- **Validation evidence:** Targeted Vitest passed 11 files and 128/128 tests,
  covering filesystem content/mode/mtime/inode/listing preservation, missing
  state without mkdir, pending/temp/lock/history preservation, in-memory
  retention, corrupt/partial/final-or-ancestor-symlink/unsafe-mode fail-closed,
  deterministic shared/managed/attribution inode replacement, controlled
  directory-chain identity change, in-memory legacy migration, and
  default-maintain cleanup compatibility. Settlement-only, managed temp-only,
  managed state-lock, and attribution state-lock regressions are independent
  cases rather than one combined fixture.
  `npm run typecheck`, `npm run lint`, `git diff --check`, and bounded static
  cross-review passed. Cross-review reproduced an ancestor-symlink redirect and
  a missing-state confirmation TOCTOU; both were fixed with controlled-chain
  pre/post validation and re-reviewed with no remaining scoped finding. No
  model/provider run or production data is involved.
- **Exact validation commands and files:** Commands ran from `suggestion/`:

  ```text
  npm test -- --run tests/localPreserveConnectorReads.test.ts tests/localPreserveManagedStores.test.ts tests/connectorTempCleanup.test.ts tests/codexConversationPrivacy.test.ts tests/codexConnector.test.ts tests/codexLocalGitCollector.test.ts tests/githubConnector.test.ts tests/googleCalendarConnector.test.ts tests/notionConnector.test.ts tests/managedCodexStore.test.ts tests/workArtifactAttributions.test.ts
  npm run typecheck
  npm run lint
  git diff --check -- src/localReadMode.ts src/connectors/github/localStore.ts src/connectors/codex/localStore.ts src/connectors/googleCalendar/localStore.ts src/connectors/notion/localStore.ts src/managedCodex/store.ts src/artifacts/attributionStore.ts tests/localPreserveConnectorReads.test.ts tests/localPreserveManagedStores.test.ts docs/ENGINE_CHANGE_RECORD.md docs/SUGGESTION_ENGINE_VNEXT_IMPLEMENTATION_PLAN.md docs/SUGGESTION_ENGINE_VNEXT_TECH_SPEC.md
  ```

  The exact 11 Vitest files are the paths following `--run` above; no broader
  suite or production CLI is implied by this evidence.
- **Base revision and scoped patch fingerprint:** Base revision is
  `d620ae9724958efa5a80999c9d127fea34450811`. Work remains uncommitted. Policy
  `a001-pr001-scoped-worktree-sha256-v1` sorts records of
  `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  for the nine PR-001 implementation/test paths and hashes those records with
  SHA-256. Documentation and every unrelated dirty file are deliberately
  excluded, avoiding a self-referential ECR hash and shared-worktree capture.
  The resulting fingerprint is
  `8ce5941e65cf584706400910df1b3008f956a8afec7afecf417435dc937f8744`.
  The exact command executed from `apps/blabase/` was:

  ```zsh
  scope=(suggestion/src/localReadMode.ts suggestion/src/connectors/github/localStore.ts suggestion/src/connectors/codex/localStore.ts suggestion/src/connectors/googleCalendar/localStore.ts suggestion/src/connectors/notion/localStore.ts suggestion/src/managedCodex/store.ts suggestion/src/artifacts/attributionStore.ts suggestion/tests/localPreserveConnectorReads.test.ts suggestion/tests/localPreserveManagedStores.test.ts)
  prefix=$(git rev-parse --show-prefix)
  { for file in $scope; do if base=$(git rev-parse "HEAD:${prefix}${file}" 2>/dev/null); then :; else base=ABSENT; fi; mode=$(stat -f '%Lp' "$file"); work=$(shasum -a 256 "$file" | awk '{print $1}'); printf '%s\t%s\t%s\t%s\n' "$file" "$base" "$mode" "$work"; done; } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  ```
- **Dataset and baseline decision:** Golden/Regression/E-001 datasets and
  frozen evaluation artifacts are unchanged. A core baseline is N/A because
  PR-001 changes only additive, currently unwired local I/O boundaries: it does
  not change an engine input/output, candidate admission, ranking, evidence,
  hash, public Board byte, dataset row, evaluator, or live capture caller.
  Therefore no comparable semantic metric could change. PR-002 integration
  validation remains required before the Work Board path can claim
  preserve-only behavior.
- **Remaining risk and rollback:** Current live Work Board evaluation still
  traverses the Work Resumption authority lease and maintenance-mode readers;
  it is therefore not byte-pure after PR-001 alone. PR-002 must add a coherent
  preserve authority snapshot, propagate preserve mode through live Attention,
  and re-run route/UI privacy and fallback checks. Rollback removes the additive
  preserve APIs/mode while existing default maintenance behavior remains the
  compatibility baseline. Production G2/G3 and release approval remain blocked.

### A-001 PR-002 coherent live preserve capture — 2026-08-13

- **Status and scope:** PR-002 is implemented and automatically validated
  locally. Work Board GET and the semantic intent POST now evaluate their base
  Board through one coherent preserve capture. Existing `/api/attention` and
  all omitted-mode callers remain default `maintain`. This change does not add
  an action/execution API, source refresh, Board/result persistence, telemetry,
  production-conversation promotion, public rollout or release approval.
- **Owner:** User remains product/release approver. Codex implemented the
  bounded source/tests and authored this record. Parallel AI workers owned the
  authority/capture, live/route, provenance/env and fixed-Codex-clock slices;
  an advisory independent AI QA review was requested. Automated or AI review
  is not human privacy, security or release approval.
- **Versions before and after:** Before PR-002 there was no serialized coherent
  capture contract and live Work Board still used the mutating Work Resumption
  authority lease. After PR-002, internal
  `attention-preserve-capture-v0.1` is added with scopes `base | semantic`.
  `LiveReadMode = maintain | preserve` remains an additive internal TypeScript
  boundary with default `maintain`; it is not a persisted/public schema. Public
  Work Board v0.1, semantic presentation/response/schema v0.2, SC-001/SC-002,
  GitHub v6, Codex v3, Calendar/Notion v1, Work Resumption, managed Codex,
  work-artifact attribution, S1/R1/R2/R3/B1 and E-001 versions/hashes are exactly
  unchanged before → after.
- **Behavior before and after:** Before, Work Board forced no source refresh but
  inherited maintenance-mode connector reads, process/filesystem leases,
  recovery/temp cleanup and retention writes from live Attention. After, Work
  Board internally forces `{readMode:"preserve", refreshSources:false}` and
  rejects `preserve + refreshSources=true` before inspecting env, sources or
  stores. One request-local Date/environment snapshot feeds connectors, context,
  workflow, Work Resumption authority, managed observability, attribution,
  current evidence and engine timestamps. The existing `/api/attention` default
  and explicit source-sync behavior are unchanged.
- **Coherent filesystem boundary:** `attention-preserve-capture-v0.1` scans only
  fixed roots below the caller-supplied trusted cwd. Base scope covers
  `.local/connectors`, `.local/context`, `.local/work-resumption`; semantic scope
  covers `.local/semantic-continuation`. Sorted O_NOFOLLOW manifest entries bind
  content/listing SHA-256 and type/mode/uid/gid/device/inode/link-count/size/
  mtime/ctime. Shared cwd/`.local` ancestors retain trust identity plus a
  scope-filtered listing hash while normalizing unrelated volatile listing
  metadata, so semantic creation cannot invalidate a base capture and vice
  versa. Final/ancestor symlink, unsafe owner/mode, recognized temp/partial,
  Work Resumption/managed/artifact lock and managed settlement fail closed.
- **Retry and failure policy:** Exact pre/post manifest mismatch or an unstable
  descriptor read retries at most once; a second change fails typed. Generic
  callback/programming errors are not retried or relabeled. The live boundary
  normalizes only known Work Resumption, managed Codex, artifact-attribution and
  workflow preserve-store failures to a typed capture read failure. Authenticated
  GET/intent responses map typed base capture failures to sanitized 503; generic
  evaluator/programming failures remain sanitized 500. Semantic intent/receipt
  uses its own manifest scope, and any optional semantic missing/corrupt/unsafe/
  unstable read returns the strict-valid, byte-identical base with
  `semanticPresentation=null`.
- **Authority and one-asOf:** The preserve Work Resumption API acquires no
  process queue or filesystem lease. It consumes the already-read Codex config,
  stable-reads bindings/heartbeat, derives owner/connection authority, supplies
  the exact binding store to current evidence and verifies exact content plus
  fingerprint again after the callback. Current evidence uses the PR-001 managed
  observability and artifact-attribution preserve readers and never re-reads the
  binding through a maintenance helper. Context registry, weekly outcome and
  workflow are read once in preserve mode and passed to a pure resolver. The
  same cloned Date controls GitHub normalization, Codex nested-conversation
  expiry, authority freshness, retention projection, evidence `asOf`, run start/
  completion and zero-latency monitor timestamps; preserve readers do not sample
  ambient time.
- **Environment and code provenance:** Preserve mode creates a fresh
  null-prototype environment from safe own data properties; proxy, accessor,
  symbol, non-enumerable, non-string and inherited enumerable state fails
  closed without invoking a getter/trap. It does not read `.env.local` or shared
  env files and does not mutate caller env, `process.env` or the legacy module
  cache. Preserve provenance accepts declared commit/fingerprint authority only
  and invokes no Git/worktree child process. Missing declared provenance safely
  makes Continuation prerequisites unavailable and permits the existing bounded
  Active-only fallback. Maintain Git probing is separately hardened to exact
  `/usr/bin/git`, fixed arguments/timeout, `shell:false`, sanitized environment,
  `GIT_OPTIONAL_LOCKS=0`, ambient config disabled and fsmonitor/untracked-cache
  disabled.
- **Privacy and mutation review:** Installation secret is captured once and
  remains request-closure authority; semantic live evaluation reuses it and
  never re-reads Codex config. Its raw value is absent from the response, public
  Board and semantic presentation; the private config manifest entry exposes
  only a SHA-256 digest of the complete file bytes, not the value or file bytes.
  No new raw stdout/stderr, command,
  local path, native source/session ID, prompt, URL or credential is persisted
  or returned. Preserve reads perform no code-controlled mkdir/write/rename/
  unlink/chmod/utimes, lease, recovery, cleanup or disk-retention mutation.
  Successful `read`/`readdir` may update OS-managed `atime` on macOS; access-time
  accounting is explicitly outside this invariant.
- **Validation evidence:** From `suggestion/`, targeted Vitest passed 21 files
  and 150/150 tests. Coverage includes full-tree before/after content, type,
  mode, uid, gid, device, inode, link count, size, mtime, ctime, listing and hash
  equality (excluding atime); stable base/semantic scope isolation; one retry;
  replacement, corrupt, symlink, unsafe mode, temp, settlement and every critical
  lock sentinel; missing-state no-create; no-lease authority reuse; exact
  one-asOf; maintain/preserve semantic equivalence; fixed Codex expiry clock;
  hostile env and zero preserve Git execution; base 503, generic 500 and semantic
  null fallback; SC-001/SC-002 compatibility and HTTP validation-execution
  isolation. A real non-empty fixture jointly exercises Codex config/snapshot,
  context/outcome/workflow, binding/heartbeat, managed-run authority, a resolved
  work relation and artifact attribution through a `ready/full` Board with a
  Continuation item while the complete cwd tree remains unchanged. Empty-cwd
  cross-scope `.local` creation/removal is also locked by a bidirectional
  no-retry regression. `npm run typecheck`, `npm run lint` and
  `git diff --check` passed.
- **Exact validation command and files:** The targeted command ran from
  `suggestion/`:

  ```text
  npm test -- --run tests/preserveCapture.test.ts tests/preserveAuthoritySnapshot.test.ts tests/livePreserveCapture.test.ts tests/preserveCodeProvenance.test.ts tests/preserveCodexClock.test.ts tests/localPreserveConnectorReads.test.ts tests/localPreserveManagedStores.test.ts tests/liveAttention.test.ts tests/attentionRoutes.test.ts tests/workResumptionStore.test.ts tests/projectWorkflowStore.test.ts tests/contextRoutes.test.ts tests/liveWorkBoardShadow.test.ts tests/workBoardRoute.test.ts tests/workBoardIntentRoute.test.ts tests/semanticContinuationStore.test.ts tests/semanticValidationStore.test.ts tests/semanticValidationOverlay.test.ts tests/semanticValidationHttpIsolation.test.ts tests/semanticContinuationClient.test.ts tests/livePreserveIntegratedFixture.test.ts
  npm run typecheck
  npm run lint
  git diff --check
  ```

  No production semantic-validation CLI, provider/model call, production data,
  Golden run, build or manual browser smoke is implied by this evidence.
- **Base revision and scoped patch fingerprint:** Base revision is
  `d620ae9724958efa5a80999c9d127fea34450811`; the integrated worktree remains
  uncommitted. Policy `a001-pr002-integrated-worktree-sha256-v1` sorts records of
  `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  for 23 PR-002 implementation/test paths and hashes the records with SHA-256.
  Documentation and unrelated shared dirty files are excluded. Because several
  routes/stores already contained compatible SC/PR-001 uncommitted work, this is
  an integrated exact-path worktree checkpoint rather than a claim that every
  byte on those paths originated in PR-002. The fingerprint is
  `7e427c21dc4a36d7e6e2e982aa6591a04db0d7a9c93e4ae7393cb3453f2d1733`.
  This fingerprint was computed before the final QA-only absent-`.local`
  scope-isolation hardening and integrated-fixture test; the final checkpoint is
  recomputed below rather than silently replacing this recorded intermediate.
  The exact command ran from `apps/blabase/`:

  ```zsh
  scope=(suggestion/src/attention/preserveCapture.ts suggestion/src/attention/liveAttention.ts suggestion/src/attention/codeProvenance.ts suggestion/src/localEnv.ts suggestion/src/connectors/codex/localStore.ts suggestion/src/context/localStore.ts suggestion/src/context/resolve.ts suggestion/src/workflows/store.ts suggestion/src/resumption/store.ts suggestion/src/workEvidence/currentWorkEvidence.ts suggestion/src/suggestionBoard/liveShadow.ts suggestion/src/semanticContinuation/localStore.ts suggestion/src/semanticContinuation/validation/store.ts suggestion/app/api/work-board/route.ts suggestion/app/api/work-board/intent/route.ts suggestion/tests/preserveCapture.test.ts suggestion/tests/preserveAuthoritySnapshot.test.ts suggestion/tests/livePreserveCapture.test.ts suggestion/tests/preserveCodeProvenance.test.ts suggestion/tests/preserveCodexClock.test.ts suggestion/tests/liveWorkBoardShadow.test.ts suggestion/tests/workBoardRoute.test.ts suggestion/tests/workBoardIntentRoute.test.ts)
  prefix=$(git rev-parse --show-prefix)
  { for file in $scope; do if base=$(git rev-parse "HEAD:${prefix}${file}" 2>/dev/null); then :; else base=ABSENT; fi; mode=$(stat -f '%Lp' "$file"); work=$(shasum -a 256 "$file" | awk '{print $1}'); printf '%s\t%s\t%s\t%s\n' "$file" "$base" "$mode" "$work"; done; } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  ```
- **Final QA checkpoint fingerprint:** After the absent-`.local` scope fix and
  integrated fixture, the same policy over 24 paths produces
  `3e50214f3ae3b5f4919f5692b9bf3887355c27d6bdd8bcc24396a0e7d007cff5`.
  This is the final uncommitted scoped patch checkpoint used for the 21-file/
  150-test validation above. The exact command ran from `apps/blabase/`:

  ```zsh
  scope=(suggestion/src/attention/preserveCapture.ts suggestion/src/attention/liveAttention.ts suggestion/src/attention/codeProvenance.ts suggestion/src/localEnv.ts suggestion/src/connectors/codex/localStore.ts suggestion/src/context/localStore.ts suggestion/src/context/resolve.ts suggestion/src/workflows/store.ts suggestion/src/resumption/store.ts suggestion/src/workEvidence/currentWorkEvidence.ts suggestion/src/suggestionBoard/liveShadow.ts suggestion/src/semanticContinuation/localStore.ts suggestion/src/semanticContinuation/validation/store.ts suggestion/app/api/work-board/route.ts suggestion/app/api/work-board/intent/route.ts suggestion/tests/preserveCapture.test.ts suggestion/tests/preserveAuthoritySnapshot.test.ts suggestion/tests/livePreserveCapture.test.ts suggestion/tests/preserveCodeProvenance.test.ts suggestion/tests/preserveCodexClock.test.ts suggestion/tests/liveWorkBoardShadow.test.ts suggestion/tests/workBoardRoute.test.ts suggestion/tests/workBoardIntentRoute.test.ts suggestion/tests/livePreserveIntegratedFixture.test.ts)
  prefix=$(git rev-parse --show-prefix)
  { for file in $scope; do if base=$(git rev-parse "HEAD:${prefix}${file}" 2>/dev/null); then :; else base=ABSENT; fi; mode=$(stat -f '%Lp' "$file"); work=$(shasum -a 256 "$file" | awk '{print $1}'); printf '%s\t%s\t%s\t%s\n' "$file" "$base" "$mode" "$work"; done; } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  ```
- **Dataset and baseline decision:** No Golden/Regression/E-001 input, label,
  version, hash, run artifact or production conversation changed. PR-002 changes
  local I/O capture authority and failure transport, not S1/R1/R2/R3/B1 input,
  candidate admission, evidence, rank, resolved semantic result, Board projection
  bytes or evaluator interpretation. A comparable core semantic baseline is
  therefore N/A; targeted filesystem/route regression is the relevant evidence.
- **Compatibility, risks and rollback:** Maintain mode and `/api/attention`
  remain the compatibility baseline. The optimistic manifest cannot detect a
  malicious same-user ABA that restores identical content and recorded metadata,
  and preserve declared-only provenance may reduce Work Board to Active-only
  when deployment provenance is absent. Manual authenticated default-off/on
  browser/Attention Lab smoke, privacy review and production G2/G3 remain open.
  Rollback removes Work Board `readMode=preserve` wiring and the internal capture/
  authority APIs while keeping PR-001 preserve readers unused and maintain mode
  unchanged. Public/action rollout, dataset freeze and release require separate
  human approval.

### A-001 formal display-only Continuation read API — 2026-08-13

- **Status and scope:** Implemented and automatically validated locally as a
  read-only A-001 milestone. This record covers a new formal
  `GET /api/continuation`, its private single-capture/R3 seam, strict public DTO,
  browser-safe parser and focused regression evidence. It does not add a POST,
  open/action capability, UI integration, source refresh, persistence,
  telemetry, public rollout or release approval.
- **Owner and authority:** User remains product, privacy and release approver.
  Codex implemented and recorded this scoped milestone; read-only explorer
  agents mapped the route/security and private seam constraints, and an
  independent AI QA review is recorded below after validation. AI review is
  advisory and is not human G2/G3 or release approval.
- **Versions before and after:** Before this slice no formal Continuation read
  API contract or route existed. After it, the only new public version is exact
  `continuation-read-api-v0.1`. Existing public Work Board v0.1, semantic
  presentation/response/schema v0.2, SC-001/SC-002, internal
  `attention-preserve-capture-v0.1`, S1/R1/R2/R3/B1 contracts, schemas, hash
  domains, policies and E-001 dataset/evaluator versions are unchanged.
- **Single-capture private seam:** `composeCapturedBoardResolution` returns the
  existing strict Work Board response together with a private continuation
  state. The exact R3 resolved decision is available only when the same
  request-local preserve capture completes authenticated identity, derivation,
  resolution, B1 composition and public Board projection successfully. Existing
  Work Board/SC callers continue to consume only `.response`; their public
  bytes, schemas and versions do not change. The formal evaluator invokes
  `evaluateCurrentAttentionWithLiveInputs` once with
  `{readMode:"preserve", refreshSources:false}` and performs no second store
  read or capture.
- **Public projection contract:** A success response contains only
  `{contract, generatedAt, status, coverageCode, items}`. It preserves the exact
  authenticated base-decision status, coverage code and `asOf` timestamp and
  exposes at most three selected R3 items as
  `{title, summary, caveats, capability:"display", action:null}`. Setup items
  remain display-only. Caveats are restricted to the exact bounded public-safe
  derivation caveat allowlist. Candidate/project/WorkContext/source/run/proof/
  hash/ref fields and private action targets are absent by schema.
- **Stable fallback and failure transport:** Proven R3
  `no_recent_context/COMPLETE`, `insufficient_evidence/INSUFFICIENT` and
  `unavailable/UNAVAILABLE` pass through unchanged. Stable pre-R3 failures use
  only existing authenticated stage results to select bounded unavailable or
  insufficient responses and expose no internal reason detail. Typed preserve
  capture failures become sanitized 503; unexpected evaluator/projector/schema
  failures become sanitized 500. The route does not serialize an exception,
  local path, token or private target.
- **HTTP authority and privacy:** Gate order is local-only, safe-origin, exact
  default-off `BLABASE_CONTINUATION_READ_ENABLED`, configured Basic auth and
  valid Basic authorization, all before evaluation. Responses use no-store,
  restrictive CSP, no-referrer, nosniff and frame-deny headers. Public text
  rejects controls, path/URL, credential, SHA and known internal identifier/ref
  forms. The browser client uses type-only server imports plus an independent
  exact-key/status/coverage/caveat/display-only parser, avoiding a Node crypto
  dependency. No secret, native locator, raw source data or private receipt is
  returned or persisted.
- **Validation evidence:** From `suggestion/`, targeted Vitest passed 16 files
  and 110/110 tests. Coverage includes exact offers/setup/normal-empty/
  insufficient/unavailable projection, max-three order, strict display/null
  capability, caveat allowlist, descriptor/accessor/extra-field/text privacy,
  gate-before-evaluation, sanitized 503/500, client fail-closed parsing,
  one-capture reuse, a real non-empty whole-cwd preserve fixture with unchanged
  bytes/metadata, and Work Board/SC/core contract compatibility. `npm run
  typecheck`, `npm run lint` and `git diff --check` also passed. The exact
  targeted command was:

  ```text
  npm test -- --run tests/continuationReadContracts.test.ts tests/continuationReadRoute.test.ts tests/continuationReadClient.test.ts tests/continuationContracts.test.ts tests/continuationResolver.test.ts tests/suggestionBoardComposer.test.ts tests/suggestionBoardContracts.test.ts tests/liveWorkBoardShadow.test.ts tests/livePreserveIntegratedFixture.test.ts tests/preserveCapture.test.ts tests/preserveAuthoritySnapshot.test.ts tests/livePreserveCapture.test.ts tests/workBoardRoute.test.ts tests/workBoardIntentRoute.test.ts tests/semanticContinuationClient.test.ts tests/semanticValidationHttpIsolation.test.ts
  npm run typecheck
  npm run lint
  git diff --check
  ```

- **Base revision and scoped patch fingerprint:** Base revision is
  `d620ae9724958efa5a80999c9d127fea34450811`; the integrated worktree remains
  uncommitted. Policy `a001-continuation-read-worktree-sha256-v1` sorts records
  of `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  for 11 implementation/test paths and hashes the records with SHA-256. Docs
  and unrelated shared dirty files are excluded. Because three test/live seam
  paths also contain compatible earlier uncommitted A-001/SC work, this is an
  exact integrated path checkpoint rather than attribution of every byte to
  this slice. Fingerprint:
  `987667e62933979e568be7076957e7697c50553b247f94e81b9075d450ef4f7a`.
  The exact command ran from `apps/blabase/`:

  ```zsh
  scope=(suggestion/src/continuation/readApi.ts suggestion/src/continuation/index.ts suggestion/src/suggestionBoard/liveShadow.ts suggestion/app/api/continuation/route.ts suggestion/app/continuationClient.ts suggestion/tests/continuationReadContracts.test.ts suggestion/tests/continuationReadRoute.test.ts suggestion/tests/continuationReadClient.test.ts suggestion/tests/liveWorkBoardShadow.test.ts suggestion/tests/livePreserveIntegratedFixture.test.ts suggestion/tests/semanticValidationHttpIsolation.test.ts)
  prefix=$(git rev-parse --show-prefix)
  { for file in $scope; do if base=$(git rev-parse "HEAD:${prefix}${file}" 2>/dev/null); then :; else base=ABSENT; fi; mode=$(stat -f '%Lp' "$file"); work=$(shasum -a 256 "$file" | awk '{print $1}'); printf '%s\t%s\t%s\t%s\n' "$file" "$base" "$mode" "$work"; done; } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  ```

- **Dataset and baseline decision:** No Golden/Regression/E-001 row, label,
  artifact, version, hash, evaluator or production conversation changed. This
  slice projects an already authenticated R3 decision without changing source
  normalization, identity, candidate admission, evidence, ranking, resolution,
  B1 ordering or existing public Board bytes. A comparable core semantic
  baseline is therefore N/A; strict projection/route/preserve regressions are
  the relevant evidence.
- **Compatibility, risks and rollback:** Exact `coverageCode` is preserved; no
  alias or reinterpretation was added. The new endpoint is default-off and its
  client is not wired to product UI. Preserve mode retains the documented
  same-user exact-ABA limitation and may return unavailable when declared code
  provenance is absent. Manual authenticated browser/privacy smoke, production
  G2/G3, UI/action/public rollout and release approval remain open. Rollback
  removes the new route/client/read schema and private continuation side-channel
  while retaining the unchanged Work Board `.response` path and PR-002 capture.

### U-001 Work Cockpit display-only Work Board — 2026-08-13

- **Status and scope:** Implemented and automatically validated locally as a
  UI-only U-001 milestone. Work Cockpit now presents the existing authenticated
  `/api/work-board` semantic wrapper as its only canonical proposal feed. This
  slice adds no server route, engine/API/schema version, action, CTA, external
  mutation, persistence, telemetry or Continuation/Attention result merge.
- **Owner and authority:** User remains product, copy, privacy and release
  approver. Codex implemented and recorded the bounded client/component/test
  changes. Read-only UI mapping and threat review were advisory AI inputs; an
  independent final AI QA review is recorded after validation. None substitutes
  for human G2/G3, accessibility, privacy or release approval.
- **Versions before and after:** Public Work Suggestion Board v0.1, semantic
  Work Board response/presentation/schema v0.2, `continuation-read-api-v0.1`,
  internal `attention-preserve-capture-v0.1`, SC-001/SC-002 and exact
  S1/R1/R2/R3/B1/E-001 contracts, policies, hashes and datasets are unchanged
  before → after. U-001 adds no persisted or public contract literal.
- **Canonical feed and request lifecycle:** `fetchDisplayOnlyWorkBoard` requests
  only `/api/work-board` with `cache:no-store`. It verifies 2xx status and JSON
  content type before parsing, then validates exact wrapper/base shape, Board
  ordering/dedupe, display-only execution policy, every item as
  `capability=display` and `action=null`, bounded evidence/caveat allowlists and
  exact semantic overlay binding. It never fetches or joins `/api/continuation`.
  `/api/attention` remains a separate diagnostic read. Initial/poll reads may
  start independently in parallel; manual source refresh completes Attention
  refresh before reading Work Board exactly once.
- **Race and failure policy:** A monotonic request token prevents an older
  response from overwriting a later Board. Current-request Board settlement is
  applied independently of a slower Attention read, so network/auth/non-JSON/
  401/403/404/500/503/schema/private/actionful failure immediately clears the
  previous Board and semantic overlay and shows only the bounded message
  `작업 제안을 불러오지 못했습니다.`. Internal exception or response detail is not
  copied to DOM or console. The component suppresses its own synchronous manual
  invalidation callback to avoid a duplicate Board read while later real source
  revision invalidations remain eligible to refresh.
- **Shared public-text policy:** The server public Board schema and browser
  display parser now import the same Node-free locator/credential predicate.
  Moving the existing server regexes into the pure helper does not change the
  accepted server contract set. It removes the browser-only blanket slash
  rejection, so ordinary copy such as `CI/CD 결과 확인` remains valid while
  absolute POSIX/Windows paths, URLs, credentials, hashes and private refs fail
  closed at the browser boundary.
- **Presentation semantics:** `WorkSuggestionBoardPanel` preserves exact
  `[primary, ...alternatives]` contract order, performs no client rank or title/
  WorkContext dedupe, and distributes entries only into fixed
  `attention → continuation → setup` lanes. Headings are exact
  `지금 처리할 일`, `이어서 할 일`, `연결할 일`. A lane without a visible item says
  exact `표시할 제안 없음` regardless of summarized Continuation status, fallback
  mode or whether a Continuation item was displaced by Board top-three
  precedence. Exact itemRef-bound Continuation overlay title takes precedence
  without mutating base Board bytes.
- **Evidence, expiry and privacy:** Evidence bands and caveats map through
  bounded Korean allowlists; raw codes are not rendered. An item is hidden when
  current wall clock is greater than or equal to `expiresAt`; a nearest-expiry
  timer updates the view even when polling fails. The timer uses a maximum
  60-second chunk, updates clock state at each callback and rearms while the
  item remains unexpired, including TTLs longer than the platform timeout
  range. Initial server/hydration output
  waits for a client clock rather than briefly rendering possibly expired data.
  Public opaque itemRef is used only for internal overlay lookup. It is not
  emitted in DOM, accessibility text, data attributes, URL or console; nor are
  WorkContext/action refs, private namespaces, SHA, path/URL, credential or
  target fields. The render boundary revalidates the whole feed and fails it
  closed if any item is actionful or unsafe.
- **Accessibility and responsive boundary:** The proposal panel precedes
  Current Focus and the existing area is explicitly labeled
  `기존 Active Attention 판정` with its own timestamp. Panel structure uses
  semantic h2/h3/h4 plus ol/li and adjacent lane/evidence text. It contains no
  button, link, form, CTA, role-button, click/key navigation or large live
  region. Only a short loading status and bounded error alert are announced.
  It invokes no focus/scroll API. CSS uses three columns on desktop and one
  column at 600px or below, with wrapping titles/evidence. Existing Attention
  Lab SC-001 form and its pre-existing stale-form race remain explicitly out of
  this U-001 slice.
- **Validation evidence:** From `suggestion/`, targeted Vitest passed 14 files
  and 81/81 tests, and the focused mounted Playwright regressions passed 4/4.
  Coverage includes fixed lane/server order, no client dedupe,
  exact overlay/base immutability, Active-no-action-compatible Continuation,
  status/fallback/empty copy, wall-clock expiry, action/private/unknown-caveat
  whole-feed rejection, HTTP status/content-type before JSON, plain-text/HTML/
  invalid JSON/auth/error transport, immediate stale clear, manual request
  sequence, out-of-order token, exact shared server/browser text safety
  (`CI/CD` allowed; POSIX/Windows path, URL, credential/private ref rejected),
  30-day expiry with bounded chunk progression and removal, actual mounted
  WorkCockpit state remaining on the newest Board when an older response
  settles last, mounted current 401/non-JSON/network rejection clearing both
  base and overlay, Work Board-only
  composition, no focus/scroll, semantic markup/no interactive or private DOM,
  and existing Work Board/SC/preserve/core compatibility. `npm run typecheck`,
  full `npm run lint` and
  `git diff --check` passed. The React best-practices review confirmed parallel
  independent initial reads, dependent manual-refresh ordering, stable hook
  dependencies and deterministic pre-hydration expiry handling. Exact command:

  ```text
  npm test -- --run tests/workSuggestionBoardPanel.test.tsx tests/workBoardDisplayClient.test.ts tests/workCockpitBoardIntegration.test.ts tests/attentionLabPresentation.test.tsx tests/semanticContinuationClient.test.ts tests/semanticContinuationOverlay.test.ts tests/workBoardRoute.test.ts tests/workBoardIntentRoute.test.ts tests/liveWorkBoardShadow.test.ts tests/livePreserveIntegratedFixture.test.ts tests/suggestionBoardContracts.test.ts tests/suggestionBoardComposer.test.ts tests/recentWorkPresentation.test.ts tests/semanticValidationHttpIsolation.test.ts
  npm run test:e2e -- e2e/work-board-request-order.spec.ts
  npm run typecheck
  npm run lint
  git diff --check
  ```

  Independent read-only delta QA reviewed the final source, tests and record
  and found no remaining U-001 Medium-or-higher issue. It specifically confirmed
  closure of the slash-policy mismatch, far-future expiry scheduling and mounted
  race/failure-clear coverage gaps. That reviewer did not rerun commands or
  recompute the fingerprint; the executable evidence above is the implementing
  agent's current-tree result and human release gates remain separate.

- **Base revision and scoped patch fingerprint:** Base revision is
  `d620ae9724958efa5a80999c9d127fea34450811`; the shared worktree remains
  uncommitted. Policy `u001-display-board-worktree-sha256-v1` sorts
  `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  records for ten implementation/test paths and hashes them with SHA-256.
  Documentation and unrelated shared dirty files are excluded. Because
  `attentionClient.ts` and `globals.css` also contain compatible prior SC/A-001
  uncommitted work, this is an exact integrated path checkpoint, not attribution
  of every byte to U-001. Fingerprint:
  `514ef0d355a00c6ad58ccc0143c7f90419c1e6cd73bf38560b509eca66496140`.
  Exact command from `apps/blabase/`:

  ```zsh
  scope=(suggestion/app/WorkSuggestionBoardPanel.tsx suggestion/app/WorkCockpit.tsx suggestion/app/attentionClient.ts suggestion/app/globals.css suggestion/src/suggestionBoard/contracts.ts suggestion/src/suggestionBoard/publicTextSafety.ts suggestion/tests/workSuggestionBoardPanel.test.tsx suggestion/tests/workBoardDisplayClient.test.ts suggestion/tests/workCockpitBoardIntegration.test.ts suggestion/e2e/work-board-request-order.spec.ts)
  prefix=$(git rev-parse --show-prefix)
  { for file in $scope; do if base=$(git rev-parse "HEAD:${prefix}${file}" 2>/dev/null); then :; else base=ABSENT; fi; mode=$(stat -f '%Lp' "$file"); work=$(shasum -a 256 "$file" | awk '{print $1}'); printf '%s\t%s\t%s\t%s\n' "$file" "$base" "$mode" "$work"; done; } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  ```

- **Dataset and baseline decision:** No engine input/output, evidence,
  admission, rank, resolver, Board composition/projection, hash, evaluator,
  Golden/Regression/E-001 row or production conversation changed. U-001 only
  validates and renders an existing public display projection, so a comparable
  core baseline is N/A. Component/client/integration regression is the relevant
  automated evidence.
- **Risks, manual gates and rollback:** Manual authenticated default-off/on
  browser smoke, 320px and 200% zoom, keyboard/VoiceOver/Safari, copy/privacy
  review, G2/G3 and release approval remain pending. Work Board summarized
  status deliberately cannot distinguish genuine empty, insufficient evidence,
  unavailable prerequisites or a Continuation candidate displaced from the
  top-three Board; all use non-inferential empty-lane copy. Existing preserve
  same-user exact-ABA and Attention Lab form race limitations remain. Rollback
  removes the new panel/client boundary and WorkCockpit Board state/fetch while
  restoring the unchanged existing Active diagnostic; no data migration or
  server rollback is needed.

### X-001 Setup-only explicit action gateway — 2026-08-13

- **Status and scope:** Implemented and automatically validated locally as the
  first bounded X-001 slice. The only activated capability is a Setup-lane
  `workspace_mapping/open_setup_surface` item, and the only destination is the
  same-origin project-mapping surface `/projects`. This slice does not activate
  the legacy `actionRef` scaffold, `open_source`, mapping save/preselection,
  session selection/resumption, launcher/native open, command/prompt execution,
  automatic retry, telemetry or external mutation.
- **Human authority and owner:** The user explicitly approved this exact slice
  on 2026-08-13: random 256-bit `offerId`, 30-second TTL, expiry-bound 24-hour
  private-event retention window, `project_mappings → /projects`, explicit click,
  fresh action-time revalidation and consume-before-return. The user remains
  product/privacy/release owner. Codex is implementation/record owner; AI QA is
  advisory and does not substitute for G2/G3, manual privacy/accessibility or
  release approval. `open_source`, exact resume and launcher remain unapproved.
- **Versions before and after:** Before this slice there was no implemented
  Continuation action route or local action store. The wire API and action
  policy remain `continuation-setup-action-*-v0.1`; the internal canonical
  authority/schema/policy and current-secret key namespace are v0.1. The
  persisted private offer/event/store/schema plus revalidation and retention
  policy are v0.2 because they replace the initial volatile whole-artifact
  currentness tuple with the separated authority/audit model. Existing Work
  Board public v0.1, semantic
  presentation v0.2, `continuation-read-api-v0.1`, preserve-capture v0.1 and
  S1/R1/R2/R3/B1/E-001 contracts, schemas, hashes, ranking and datasets are
  unchanged. Existing GET responses remain display-only with `action:null`.
- **Issuance and currentness binding:** After an explicit Setup click,
  `POST /api/continuation/offers` acquires the shared action root lock, performs
  exactly one fresh preserve capture inside that lock and correlates the
  supplied public opaque itemRef to the exact visible internal Setup candidate.
  The v0.2 issuance audit retains the capture-volatile candidate/legacy-target,
  R3 decision/result/input, R1/R2/scoring, full registry and source batch/
  snapshot hashes. They prove what was evaluated at issuance but are not used
  for later equality. `continuation-setup-action-authority-v0.1` instead binds
  the current secret's action key namespace, fixed policy/destination, itemRef,
  logical workspace-mapping candidate and observation set, observedAt/expiry,
  Setup reason, action-only stable target, HMAC digests of source identity/R1
  resolution/binding set/relevant mapping state, R1/R2 policy tuple and typed
  clean/declared code provenance. Raw scope/work-context/project/decision IDs
  appear only as digest inputs and are not persisted. Request as-of, run IDs,
  scored candidate hash, legacy private target, full registry SHA and batch/
  result hashes are deliberately audit-only. Thus fresh evaluator entropy does
  not make a logically unchanged Setup action stale, while a logical identity,
  resolution/reason/mapping, observation, expiry, policy/destination or code
  change does.
- **Store and lifecycle:** `.local/continuation-actions` is private 0700 with
  0600 files. A dedicated no-follow, inode-checked root lock serializes the
  capture/correlation and store operation for both issue and open. Each
  installation secret derives its own `authKeyId` directory; routes open only
  that exact namespace and never enumerate, migrate or reuse an older one.
  Secret rotation therefore starts with an empty usable namespace, while an
  old offer remains unreadable and returns 409. Offers use 32 random bytes,
  expire at `min(issuedAt+30s,candidate expiry)`, and one active offer per item
  supersedes the older handle. HMAC-authenticated append events form a hash
  chain. Expired offer bytes have retention deadline `offer.expiresAt+24h`;
  other terminal events use `occurredAt+24h`. There is no background cleanup:
  the next authorized operation in the current namespace removes a fully
  closed prefix whose deadlines passed. The 2,048-event bound reserves one
  terminal slot per active offer, preventing cap exhaustion from blocking an
  already-issued offer's consume/terminalization.
- **Open and race policy:** `POST /api/continuation/open` accepts only
  `{offerId,explicitUserAction:true}`. Inside the same linearized lock it samples
  authoritative wall time, performs one new preserve capture, reconstructs the
  exact stable Setup authority, verifies unused/current/unexpired state and
  durably appends `consumed` before returning exact
  `{status:"opened",destination:"project_mappings",navigateTo:"/projects"}`.
  Parallel consume has one winner. Replay, expiry, supersession, candidate or
  source/code/registry rebound, corrupt/wrong-secret/missing authority all
  become sanitized 409 without retry.
- **HTTP, UI and privacy:** Both POST routes gate local-only, exact same-origin,
  exact default-off `BLABASE_CONTINUATION_SETUP_ACTION_ENABLED`, configured
  Basic auth, valid auth, exact JSON content type, declared/streamed 512-byte
  maximum and strict body schema before capture/store work. Responses use
  no-store, restrictive CSP, no-referrer, nosniff and frame deny. Global Next
  document headers also set `frame-ancestors 'none'` and `X-Frame-Options: DENY`
  so the authenticated CTA and `/projects` surface cannot be framed. The Work
  Cockpit receives only the server-side boolean flag. Only a displayed Setup
  card renders `설정 화면 열기`; no Attention/Continuation CTA is added. The
  client issues and immediately consumes once, keeps offerId in call-local
  memory, accepts exact fixed response keys only and hardcodes `/projects`.
  Offer/private target/candidate/source/hash/secret values are absent from DOM,
  accessibility text, data attributes, URL and console.
- **Validation evidence:** From `suggestion/`, the final targeted command passed
  23 files and 183/183 tests at the current checkpoint. It covers strict
  contracts/HMAC/hash tamper, secret-derived namespace/target verification,
  wrong secret and secret rotation, 30-second/candidate TTL, expiry+24-hour
  anchor compaction, private modes, restart, idempotent issue, supersession,
  corrupt/pending/symlink failure, durable/replay/parallel consume, delayed
  under-lock expiry, terminal-capacity reservation, every approved logical
  authority invalidator versus audit-only drift, shifted-as-of fresh capture,
  one-capture gateway, route gate order/body bounds/503/500/409 privacy,
  end-to-end issue/open, exact client parsing/navigation, Setup-only UI flag,
  global `/` and `/projects` anti-framing headers and existing Work Board/
  Continuation/preserve/core compatibility. `npm run typecheck`, `npm run lint`
  and `git diff --check` passed. Exact targeted command:

  ```text
  npm test -- --run tests/continuationActionContracts.test.ts tests/continuationActionStore.test.ts tests/continuationSetupActionGateway.test.ts tests/continuationSetupActionRoutes.test.ts tests/continuationSetupActionIntegration.test.ts tests/continuationSetupActionClient.test.ts tests/continuationSetupActionUiFlag.test.tsx tests/workSuggestionBoardPanel.test.tsx tests/workCockpitBoardIntegration.test.ts tests/workBoardDisplayClient.test.ts tests/workBoardRoute.test.ts tests/workBoardIntentRoute.test.ts tests/continuationReadRoute.test.ts tests/continuationReadClient.test.ts tests/liveWorkBoardShadow.test.ts tests/livePreserveIntegratedFixture.test.ts tests/preserveCapture.test.ts tests/preserveAuthoritySnapshot.test.ts tests/suggestionBoardContracts.test.ts tests/suggestionBoardComposer.test.ts tests/continuationContracts.test.ts tests/continuationResolver.test.ts tests/semanticValidationHttpIsolation.test.ts
  npm run typecheck
  npm run lint
  git diff --check
  ```

- **Base revision and scoped patch fingerprint:** Base revision is
  `9603843349b3165d2c76150a41d23fd705d88c28`. The shared worktree remains
  uncommitted. Policy `x001-setup-action-worktree-sha256-v2` sorts
  `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  for the exact 28 implementation/test paths: the four Work Cockpit page/
  component/style files; three Setup HTTP route/helper files; browser client;
  `next.config.ts`; all six `src/continuation/actions` files; `liveShadow.ts` and
  `publicProjection.ts`; and tests `continuationActionContracts`,
  `continuationActionStore`, `continuationSetupActionGateway`,
  `continuationSetupActionRoutes`, `continuationSetupActionIntegration`,
  `continuationSetupActionClient`, `continuationSetupActionUiFlag`,
  `workSuggestionBoardPanel`, `workCockpitBoardIntegration`,
  `liveWorkBoardShadow` and `workBoardRoute`. Base blobs use repository paths prefixed with
  `apps/blabase/`; worktree paths and records use the displayed `suggestion/`
  paths, POSIX permission digits from `stat -f '%Lp'`, file bytes use
  `shasum -a 256`, and records use `LC_ALL=C sort | shasum -a 256`. Docs and
  unrelated dirty paths are excluded. Fingerprint at this checkpoint:
  `4280e3dde1f5d9984ab021c50cc3890a111aee3ed98adc9c04fc44a0513c5ce4`.
- **Dataset and baseline decision:** No Golden/Regression/E-001 row, source
  normalization, identity, candidate admission, ranking, resolver, Board order,
  existing public projection or production conversation changed. X-001 only
  authenticates an already-derived Setup descriptor after explicit action, so
  a comparable core semantic baseline is N/A; action lifecycle/security and
  compatibility regression are the relevant evidence.
- **Residual risk, rollback and gates:** The local HMAC store has the existing
  same-user rollback/identical-ABA threat; it is not a remote anti-rollback
  authority, and TTL relies on the trusted system wall clock. Lock acquisition
  is bounded and crash-left locks/temporary files fail closed for manual
  recovery rather than unsafe takeover. Inactive secret namespaces are neither
  enumerated nor automatically cleaned by routes; explicit maintenance is a
  follow-up, while current-namespace retention is enforced on the next
  authorized operation. Manual authenticated browser
  smoke, 320px/200% zoom/keyboard/VoiceOver/Safari, copy/privacy, G2/G3 and
  release approval remain pending. Rollback disables/removes the action flag,
  routes/client/CTA and private store while leaving the unchanged display-only
  Work Board and formal Continuation GET intact.

### L-001 default-off display-only Launcher Work Board — 2026-08-14

- **Status, authority and scope:** Implemented and locally validated as a
  default-off launcher checkpoint under the user's explicit L-001 scope. The
  Node Local Agent adds one strict read method and the new Swift host consumes
  it before bounded legacy fallback. Codex is implementation/record owner; the
  user remains product/privacy/release owner. This record is not launcher
  rollout approval and does not enable the flag in an environment.
- **Versions before and after:** `blabase-launcher-ipc-v1`, existing
  `attention.get`, `blabase-launcher-attention-v2`, execution/status v1,
  runtime-manifest v1, public Work Board v0.1, semantic wrapper/presentation
  v0.2, S1/R1/R2/R3/B1, X-001 and all evaluation/dataset/hash versions are
  unchanged. Before L-001 there was no formal launcher Board method or DTO.
  After L-001 the only new contracts are strict `work-board.get
  {refresh:boolean}` within IPC v1 and
  `blabase-launcher-work-board-v1`. An old Swift host never calls the new
  method; a new host receives `INVALID_REQUEST` from an old/flag-off agent and
  performs one legacy Attention read.
- **Node capture and sync boundary:** Exact
  `BLABASE_LAUNCHER_WORK_BOARD_ENABLED === "true"` is required before sync or
  evaluation. A managed explicit refresh performs the existing source sync
  exactly once and then evaluates the canonical
  `evaluateLiveSemanticWorkSuggestionBoard` once on the same data root.
  Read-only mode never syncs, including `refresh:true`. The Board evaluator's
  existing path forces preserve/no-refresh internally. A successful Full Board
  does not call Attention evaluation, run/failure recording, Work Resumption,
  command or action seams.
- **Projection and privacy:** The server parses the strict semantic Work Board
  wrapper and flattens public primary then alternatives without reordering,
  maximum three. Exact semantic overlay title is correlated by public itemRef
  only inside Node. Output contains only contract, generatedAt, mode,
  prominentLane, continuationStatus and lane/title/evidence/allowlisted
  caveat/expiry/`display`/`null`. It contains no itemRef, work context, source,
  candidate/run/result/proof/hash, private target, URL/path/credential or
  action. Shared public locator/credential safety plus a launcher-specific
  private-ref namespace guard applies to every title; ordinary `CI/CD` copy is
  accepted. Hostile or mixed content rejects the whole projection.
- **Status and time semantics:** Launcher Attention items always project
  `expiresAt:null`, because the source field is Active dueAt, not visibility
  TTL; overdue and future-due Active work therefore remain visible. Only
  Continuation/Setup require non-null expiry strictly after generatedAt and
  native current-time filtering. Status preserves the canonical asymmetric
  Board rule: a visible Continuation/Setup row requires `available`, an empty
  Board cannot be `available`, and an Attention-saturated top three may retain
  `available`. Active-only fallback is Attention-only with unavailable status.
- **Swift fallback and transport currentness:** Full Board, including zero
  items, is terminal. Active-only fallback calls legacy Attention once with
  `refresh:false`. Unsupported/`INVALID_REQUEST` calls it once with the original
  refresh because no Board sync occurred. A completed typed Board run failure
  or strict result-schema rejection calls Attention once with `refresh:false`
  and shows the bounded notice `Work Board를 불러오지 못해 기존 Attention을
  표시합니다`; legacy Active actions remain intact. Timeout, disconnect,
  malformed envelope and protocol corruption never trigger immediate
  same-session fallback. A Board timeout detaches and terminates that process
  generation; a Board cancellation does the same only when it wins removal of
  its pending request, so rapid reload cannot queue behind abandoned work.
  Late bytes are ignored and a later load starts a fresh process. Timeout,
  protocol retirement, configuration stop and app shutdown detach handlers and
  stdin, then use a MainActor-yielding quarantine task for bounded SIGTERM grace,
  SIGKILL and verified child exit. A failed verification retains the quarantined
  process/task and blocks replacement launch with a bounded runtime error.
  Every start captures a lifecycle epoch and retirement token, then rechecks
  cancellation, the current epoch/token and a permanent shutdown gate after
  awaiting exit; concurrent config-root stop or app shutdown therefore cannot
  revive an old-root request. Configuration uses an explicit begin-stop /
  activate-root / complete handshake: the gate remains held after stop returns,
  opens only after the settings store activates the new root, and aborts without
  a process on intermediate failure. Root-change retries always begin-stop based
  on root inequality, never the advisory `isAgentActive` flag, so an old-root
  process restarted after abort cannot bypass retirement. Permanent shutdown
  supersedes the handshake.
  Swift accepts only exact success keys `{contract,requestId,ok,result}`, exact
  failure keys `{contract,requestId,ok,error}`, exact error keys
  `{code,message}`, mutually exclusive result/error and a canonical lowercase
  UUID requestId. Error codes are 1~120 ASCII uppercase/digit/underscore and
  messages are 1~500 control-free UTF-16 units. For IPC-v1 compatibility,
  bounded locator, credential and private-ref-shaped messages preserve their
  error code but are replaced with app-owned generic display text, never raw UI.
- **Native presentation and actions:** Full Board rows are fixed
  Attention/Continuation/Setup lanes with the same bounded Korean lane,
  evidence, caveat and exact `표시할 제안 없음` copy as web. They have no Button,
  Link, Enter shortcut, click/action ref/target, X-001 offer/open or source/
  session navigation. Active-only fallback deliberately returns to the legacy
  Attention presentation and preserves its existing Active actions. Before
  publication Swift removes only expired Continuation/Setup rows, preserving
  order, and rechecks the nearest expiry in at most 60-second chunks. Load,
  config and shutdown generation guards cancel stale timers and prevent an
  older request from publishing or clearing `isRefreshing` over a newer one.
- **Automated validation evidence:** From `suggestion/`, targeted Vitest passed
  7 files and 82/82 tests. The run covers strict projection/order/overlay and
  immutability, dueAt normalization, Attention-saturated status, empty/
  active-only modes, public-text/private/action rejection, exact flag and sync
  order, no legacy mutation seams on Full Board, unchanged Attention v2
  parse/serialization, IPC method/params and canonical live Board compatibility.
  `npm run typecheck` and full `npm run lint` passed. The launcher Agent bundle,
  Swift source build, executable model smoke and signed ad-hoc app build passed.
  Model smoke includes strict IPC/error mutation checks, typed degraded
  fallback, TERM-trapping hung Board timeout/config-stop/shutdown PID exit, and
  cancelled-Board generation retirement followed by a successful request from
  a fresh process. It also proves MainActor heartbeat progress during retirement
  and injected exit-verification failure blocking every replacement launch.
  Held-retirement races also prove a cancelled waiting request cannot launch
  after config stop, a request made after stop but before activation launches no
  process, the first post-complete launch uses only the activated new root, and
  activation failure/abort can restart only the unchanged old root before a retry
  performs a second stop and launches only the committed new root. A permanent
  shutdown admits no later process.
  Exact commands:

  ```text
  npm test -- --run tests/launcherWorkBoardProjection.test.ts tests/launcherService.test.ts tests/launcherJsonl.test.ts tests/launcherProjection.test.ts tests/launcherCli.test.ts tests/liveWorkBoardShadow.test.ts tests/semanticContinuationOverlay.test.ts
  npm run typecheck
  npm run lint
  npm run launcher:agent:bundle
  npm run launcher:swift:smoke
  (cd desktop/macos && swift build)
  npm run launcher:app:build
  git diff --check
  ```

  `swift test` was also attempted but this host's selected Command Line Tools
  Swift SDK has no `XCTest` module, so SwiftPM test discovery stopped before
  executing tests. The new XCTest source remains in-tree and the same critical
  model/transport paths are executable in `launcher:swift:smoke`; a full Xcode
  toolchain XCTest run remains a release gate rather than being claimed pass.
- **Base revision and scoped patch fingerprint:** Base revision is
  `3a727ef37f7a0209132c400acf0b3334af2c4f37`; the shared worktree remains
  uncommitted. Policy `l001-launcher-work-board-worktree-sha256-v1` sorts
  `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  for the exact 25 implementation/test paths below, then hashes the records with
  SHA-256. Documentation and unrelated shared dirty paths are excluded.
  Fingerprint: `41e0be64194b7c9b2ec9951e91d1861a51221cedf37dde4c3e4f52d96f67ead6`.

  ```zsh
  scope=(suggestion/src/launcher/contracts.ts suggestion/src/launcher/index.ts suggestion/src/launcher/service.ts suggestion/src/launcher/workBoardProjection.ts suggestion/src/launcher/workBoardTextSafety.ts suggestion/tests/fixtures/launcherWorkBoardFixture.ts suggestion/tests/launcherWorkBoardProjection.test.ts suggestion/tests/launcherService.test.ts suggestion/tests/launcherJsonl.test.ts suggestion/desktop/macos/Sources/BlabaseLauncher/AppDelegate.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherAgentClient.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherIPC.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherScreenState.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherSettingsStore.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherSettingsView.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherView.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherViewModel.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherWorkBoardPresentation.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherWorkBoardProjection.swift suggestion/desktop/macos/Sources/BlabaseLauncher/LauncherWorkBoardView.swift suggestion/desktop/macos/Tests/Smoke/LauncherModelSmoke.swift suggestion/desktop/macos/scripts/run-model-smoke.sh suggestion/desktop/macos/Tests/BlabaseLauncherTests/LauncherRootContextTests.swift suggestion/desktop/macos/Tests/BlabaseLauncherTests/LauncherSettingsStoreTests.swift suggestion/desktop/macos/Tests/BlabaseLauncherTests/LauncherWorkBoardTests.swift)
  prefix=$(git rev-parse --show-prefix)
  { for file in $scope; do if base=$(git rev-parse "HEAD:${prefix}${file}" 2>/dev/null); then :; else base=ABSENT; fi; mode=$(stat -f '%Lp' "$file"); work=$(shasum -a 256 "$file" | awk '{print $1}'); printf '%s\t%s\t%s\t%s\n' "$file" "$base" "$mode" "$work"; done; } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  ```
- **Baseline decision, residuals and rollback:** This is a strict display-only
  projection and native presentation of existing authenticated output. It does
  not change engine input, admission, evidence, ranking, resolver, Board
  composition/public schema, evaluator, Golden/Regression/E-001 data or
  production conversations; a comparable core baseline is N/A. Underlying
  preserve capture retains its documented same-user exact-ABA/clock limits.
  Manual old-host/new-agent and new-host/old-agent packaged smoke,
  VoiceOver/keyboard/layout/privacy copy, screen-capture policy, full Xcode
  XCTest, G2/G3 and release approval remain pending. Rollback sets/removes the
  launcher flag or removes the additive method/projection/native Board files;
  existing Attention v2 and Active actions require no migration or rollback.

## Engine Change Record — M-001a local Work Board monitoring

- **Date:** 2026-08-14 KST
- **Owner:** Observability + Evaluation implementer (Codex); human product/release
  approval remains pending.
- **Goal:** Add a default-off, local web-only dogfood loop for explicit
  Continuation/Setup usefulness feedback without changing Work Board JSON,
  engine ranking, Gold data, release gates, Launcher or existing Attention feedback.
- **Affected pipeline stages:** Additive final Work Board receipt projection,
  authenticated monitoring API, private event/store/quality replay, Work Cockpit
  controls and aggregate-only CLI. R1/R2/R3/B1, public Board/semantic contracts,
  `/api/attention`, X-001 authority and Launcher projection are unchanged.
- **Behavior before:** Work Board GET returned only the existing semantic wrapper;
  no M-001 receipt, consent, render acknowledgement, Continuation/Setup feedback,
  monitoring aggregate/history or replay CLI existed.
- **Behavior after:** With exact
  `BLABASE_WORK_BOARD_MONITORING_ENABLED === "true"`, authenticated local Work
  Board GET reuses its single preserve evaluation and may add a signed redacted
  receipt header while returning the exact same JSON bytes. After separate explicit
  consent, the browser records `render_confirmed` only after the latest response is
  committed and may submit explicit `useful|not_useful` or reset for current
  Continuation/Setup ordinals. Q-001 hardening makes explicit purge independent of
  current Codex configuration/secret and removes every safe canonical current or
  inactive key namespace under the monitoring root lock. Monitoring failures never
  block Board display or X-001 Setup action.
- **Versions before:** No M-001a receipt/API/event/store/quality/replay contract.
- **Versions after:** `work-board-monitoring-receipt-v0.1`,
  `work-board-monitoring-api-v0.1`, `work-board-monitoring-event-v0.1`,
  `work-board-monitoring-store-v0.1`, `work-board-monitoring-quality-v0.1`,
  `work-board-monitoring-replay-v0.1`, shared schema/receipt/consent/retention/
  idempotency policy v0.1, and sanitized `work-board-monitoring-cli-v0.1`.
  Public Work Board v0.1, semantic presentation v0.2, Continuation read v0.1,
  X-001, Launcher IPC/Attention/Board and core engine versions are unchanged.
- **Code commit:** Base revision `3a727ef37f7a0209132c400acf0b3334af2c4f37`;
  implementation remains an uncommitted scoped worktree patch. Scoped fingerprint
  is recorded below.
- **Evaluation dataset version and SHA-256:** N/A. No frozen or production
  conversation dataset was read or changed.
- **Candidate run ID:** N/A; no production engine replay or semantic evaluation run.
- **Comparison run ID:** N/A; core engine input/output/filter/order/ranking are
  unchanged, so a comparable Golden baseline would not measure this infrastructure/UI
  slice.
- **Commands executed:** From `suggestion/`:

  ```text
  npm test -- --run tests/workBoardMonitoringContracts.test.ts tests/workBoardMonitoringReceipt.test.ts tests/workBoardMonitoringStore.test.ts tests/workBoardMonitoringQuality.test.ts tests/workBoardMonitoringRoute.test.ts tests/workBoardMonitoringClient.test.ts tests/workBoardMonitoringUi.test.tsx tests/workBoardMonitoringCli.test.ts tests/workBoardRoute.test.ts tests/livePreserveIntegratedFixture.test.ts tests/workCockpitBoardIntegration.test.ts tests/workSuggestionBoardPanel.test.tsx tests/liveWorkBoardShadow.test.ts tests/semanticContinuationOverlay.test.ts tests/semanticContinuationClient.test.ts tests/continuationSetupActionIntegration.test.ts tests/continuationSetupActionClient.test.ts tests/continuationSetupActionUiFlag.test.tsx tests/continuationSetupActionRoutes.test.ts tests/continuationActionStore.test.ts tests/launcherService.test.ts tests/launcherWorkBoardProjection.test.ts tests/launcherJsonl.test.ts tests/suggestionBoardContracts.test.ts
  BLABASE_WORK_BOARD_MONITORING_ENABLED=true npx playwright test e2e/work-board-monitoring.spec.ts --reporter=line
  npm run typecheck
  npm run lint
  git diff --check
  ```
- **Metrics changed:** Targeted compatibility regression passed 24 files and
  187/187 tests. Explicit opt-in Playwright passed 1/1. Typecheck, full lint and
  diff-check passed. Quality formulas are exact: eligible distinct rendered
  presentation targets; latest non-reset rated targets; coverage and respondent
  useful share use null at zero denominator; canonical strata are lane/position/
  mode/evidence/surface. Every output retains `reviewState=candidate`,
  `appliedToRanking=false`, `goldEligible=false`, `releaseGateEligible=false`.
- **Reproduced invariants:** Receipt HMAC/tamper/key rotation/TTL/header cap and
  privacy; strict API gate order; pure missing-store read; 0700/0600 nofollow store,
  event/store HMAC chain, concurrent duplicate idempotency, correction/reset,
  Attention feedback rejection, lazy retention, purge, symlink/corrupt fail-close;
  deterministic aggregate replay/mismatch; exact Work Board response bytes and
  non-empty whole-fixture content/metadata preservation; stale Board clearing;
  commit-before-render POST; stable logical-presentation acknowledgement across
  poll receipts; stale monitoring-state response suppression; and no receipt/handle
  in DOM, URL, console or localStorage. Existing X-001 and Launcher compatibility
  tests remain green.
- **Regressions or accepted exceptions:** No known automated regression. This is
  M-001a only: click/dwell/no-click, Attention duplication, Launcher/offline,
  production engine replay, preference/ranking, Gold promotion and release influence
  are deliberately absent.
- **Privacy or retention impact:** Receipt is signed and redacted, not encrypted;
  therefore it contains only bounded enums/version literals and HMAC/SHA digests,
  never title/summary/raw refs/IDs/paths/URLs/prompts/tokens/secrets/action offers.
  Browser keeps receipt in request-local memory only. Normal operations use
  `.local/work-board-monitoring/<authKeyId>/events.json` in the current-secret
  namespace, with 30-day event retention, lazy mutation-time compaction and no
  background cleanup. Consent itself is an event under the same retention policy;
  after its retained prefix expires, recording requires explicit consent again. Pure
  GET/read never creates, cleans, repairs or writes state. Explicit all-data purge is
  the separate complete-deletion path across key rotation and is also required before
  Codex disconnect can delete configuration.
- **Residual risks:** Same-UID authenticated store rollback/exact ABA and secret
  access are outside HMAC recency protection; wall clock is trusted; crash-left
  lock/temp state fails closed and may require manual local recovery; inactive
  old-key namespaces are not background-cleaned but are included in explicit
  all-data purge; OS-managed atime is excluded from no-code-controlled-mutation
  claims. Header metadata remains visible
  to an authenticated local transport/log layer, which is why raw text/refs are
  excluded. Manual privacy/copy/browser/accessibility and G2/G3 review remain pending.
- **Release decision:** Local automated checkpoint only; default-off. No rollout,
  dataset promotion, ranking use, Gold/release eligibility or release approval.
- **Rollback method:** Unset/set the exact monitoring flag to any value other than
  `true`; this removes receipt issuance, API controls and browser POSTs while leaving
  Work Board JSON and all existing engines/actions/Launcher paths unchanged. The
  additive modules/routes/UI/script can then be removed without data migration;
  all safe canonical monitoring namespaces may be purged explicitly first.
- **Follow-up work:** Human privacy/copy review; manual supported-browser and
  accessibility smoke; explicit cleanup/recovery policy before broader retention;
  broader M-001 provenance/error/latency work only under a separate approved slice.
- **Scoped patch fingerprint:** Policy
  `m001a-work-board-monitoring-worktree-sha256-v1` sorts
  `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  for the exact 34 implementation/test paths below and SHA-256 hashes the records.
  Documentation and unrelated shared dirty paths are excluded. Fingerprint:
  `0a5653bd6f2e3f39e8405d0daf8e6b69c4a33c5428c5c5a9d91aa4a3559c0f37`.

  ```zsh
  scope=(suggestion/app/WorkBoardMonitoringControls.tsx suggestion/app/WorkCockpit.tsx suggestion/app/WorkSuggestionBoardPanel.tsx suggestion/app/api/work-board/monitoring/route.ts suggestion/app/api/work-board/route.ts suggestion/app/globals.css suggestion/app/page.tsx suggestion/app/workBoardMonitoringClient.ts suggestion/package.json suggestion/src/suggestionBoard/liveShadow.ts suggestion/src/suggestionBoard/monitoring/contracts.ts suggestion/src/suggestionBoard/monitoring/index.ts suggestion/src/suggestionBoard/monitoring/quality.ts suggestion/src/suggestionBoard/monitoring/receipt.ts suggestion/src/suggestionBoard/monitoring/replay.ts suggestion/src/suggestionBoard/monitoring/store.ts suggestion/src/suggestionBoard/monitoring/versions.ts suggestion/tools/run-work-board-monitoring.ts suggestion/tools/start-isolated-e2e-server.mjs suggestion/e2e/work-board-monitoring.spec.ts suggestion/tests/fixtures/workBoardMonitoringFixture.ts suggestion/tests/livePreserveIntegratedFixture.test.ts suggestion/tests/workBoardMonitoringClient.test.ts suggestion/tests/workBoardMonitoringContracts.test.ts suggestion/tests/workBoardMonitoringQuality.test.ts suggestion/tests/workBoardMonitoringReceipt.test.ts suggestion/tests/workBoardMonitoringRoute.test.ts suggestion/tests/workBoardMonitoringStore.test.ts suggestion/tests/workBoardMonitoringUi.test.tsx suggestion/tests/workBoardMonitoringCli.test.ts suggestion/tests/workBoardRoute.test.ts suggestion/tests/workCockpitBoardIntegration.test.ts suggestion/tests/workSuggestionBoardPanel.test.tsx suggestion/tests/continuationSetupActionUiFlag.test.tsx)
  prefix=$(git rev-parse --show-prefix)
  { for file in $scope; do if base=$(git rev-parse "HEAD:${prefix}${file}" 2>/dev/null); then :; else base=ABSENT; fi; mode=$(stat -f '%Lp' "$file"); work=$(shasum -a 256 "$file" | awk '{print $1}'); printf '%s\t%s\t%s\t%s\n' "$file" "$base" "$mode" "$work"; done; } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  ```

## Engine Change Record — Q-001 integrated automated checkpoint and blocker hardening

- **Date:** 2026-08-14 KST
- **Owner:** Codex is automated implementation/checkpoint evidence owner. The
  independent `qa_reviewer` is advisory only. The user remains product, privacy,
  risk and release approver; human dataset reviewers/adjudicator remain pending.
- **Goal:** Execute the exact integrated local QA matrix at base
  `e2fc9f56066b5d731fddcf9cc1837424a740b450`, preserve every failure as evidence,
  correct only concrete product/test blockers, and produce a reproducible automated
  checkpoint without claiming human review, dataset freeze, rollout or release.
- **Affected pipeline stages:** Additive/tightened boundaries only: M-001a monitoring
  authenticated replay and complete deletion; Codex disconnect deletion transaction;
  Semantic Continuation intent HTTP input, private authority/store and shared lease;
  Attention Lab write capability and form currentness; exact E2E assertions; current
  Launcher smoke fake-process wait; current LikeC4 implementation model. S1/R1/R2/R3/B1 admission, evidence, scoring, resolver,
  Board ordering/public schema, E-001 rows and Launcher Work Board projection meaning
  are unchanged.
- **Behavior before:** Monitoring replay used the normal read path, so an otherwise
  authenticated event chain with a stale authenticated stored aggregate could not be
  recomputed and reported as mismatch. Purge required current configuration/secret and
  deleted only the current namespace; a successful disconnect could therefore leave
  rotated-key namespaces. Semantic intent used a fixed-root v0.1 SHA-only store, shared
  lease bootstrap could recursively traverse unsafe ancestors, intent writes had no
  separate least-privilege flag/body-length enforcement, pure-read orphan-temp handling
  had no exact authorized recovery path, and the browser form could publish a stale
  request completion after target/label change. Some E2E fixtures asserted historical
  copy or counted ordinary background Attention GET polling as source refresh.
- **Behavior after:** Monitoring normal read remains aggregate-strict, while replay
  verifies schema/`authKeyId`, event SHA/HMAC chain and store HMAC before recomputing the
  aggregate; mismatch is a deterministic nonzero replay result. Explicit purge obtains
  the root lock, validates every canonical namespace without following symlinks or
  accepting unexpected entries, and deletes all current/inactive namespaces even when
  Codex config/secret is absent. Codex disconnect purges first and fails closed before
  configuration deletion on purge error. Semantic intent is current-secret-namespaced,
  HMAC-authenticated v0.2 storage; strict body gates and a separate exact write flag run
  before evaluation; fixed lease directories are validated component-by-component;
  pure GET/read does not recover or delete orphan temp state, while only the next
  authorized POST under the shared lease may visit the fixed legacy root and every
  canonical current/inactive `authKeyId` namespace to recover the exact safe regular/
  same-owner/0600 temp pattern. A rotated-key orphan therefore cannot suppress the
  current overlay, while hostile namespace/temp metadata remains fail-closed and is not
  deleted. The form is exact-target-keyed and request/edit generation-bound.
  SC-002 receipt reads likewise remain pure; the next authorized semantic/validation
  mutation under the same lease removes only an exact O_NOFOLLOW, inode-matched,
  same-owner 0600 `receipts.json.<pid>.<16hex>.tmp`, so a crash-left receipt temp cannot
  indefinitely suppress semantic presentation and hostile temp metadata is preserved
  fail-closed.
  E2E assertions now track current product copy and the mutating source-refresh boundary.
  Launcher smoke waits boundedly for its one-shot post-configuration fake to exit before
  shutdown, eliminating a harness scheduling race without changing runtime authority.
- **Versions before:** Semantic public presentation/core decision contracts remain their
  existing v0.1/v0.2 values. Private Semantic Continuation intent store/schema were
  v0.1 fixed-root/SHA-only. M-001a receipt/API/event/store/quality/replay were v0.1.
- **Versions after:** Private intent store/schema are
  `semantic-continuation-intent-store-v0.2` and
  `semantic-continuation-intent-store-schema-v0.2`, with current-secret `authKeyId`,
  canonical SHA and installation-secret HMAC. The exact write capability flag is
  `BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED === "true"`. Public Work Board v0.1,
  semantic presentation/core decision, Continuation read v0.1, X-001, M-001a v0.1,
  Launcher IPC/Attention/Board and S1/R1/R2/R3/B1/E-001 versions are unchanged. The
  monitoring correction changes safe replay/purge behavior without making monitoring
  eligible for ranking, Gold or release.
- **Code commit:** Base revision
  `e2fc9f56066b5d731fddcf9cc1837424a740b450`; implementation remains an uncommitted
  scoped worktree patch. Final exact scope and fingerprint are recorded below.
- **Evaluation dataset version and SHA-256:** Dataset version remains mutable/unfrozen
  `suggestion-continuation-dev-v0.1` revision 3. No frozen `datasetSha256` is assigned;
  its candidate payload SHA-256 at initial checkpoint is
  `98a3c8135b23c6ac2aeddd3c2ada511d3d9a46638fb016d95d86945c8f6d8f31` and exact
  materialized input SHA-256 is
  `de9dd348173cdf5087905a1c7b33e2ee20cd948159280572e8f090b95cdb9da2`.
  These hashes identify a synthetic contract checkpoint and are not Gold/freeze claims.
- **Candidate run ID:** Initial diagnostic run
  `continuation_eval_run_2201e106858331df1982e648f42d01dd`; final confirmation run
  `continuation_eval_run_1a7f8824ffcc442dee45d1a73c8b2988`.
- **Comparison run ID:** N/A for quality improvement. Initial and final runs are
  contract/provenance confirmation on the exact recorded input tuple, not a claimed
  Acceptable@1/3 comparison, and the dataset remains mutable/unreviewed.
- **Commands executed:** Exact matrix from `suggestion/`, except the final architecture
  command from repository app root:

  ```text
  npm test
  npm run typecheck
  npm run lint
  npm run build
  npm run continuation:baseline
  npm run test:e2e
  BLABASE_WORK_BOARD_MONITORING_ENABLED=true npx playwright test e2e/work-board-monitoring.spec.ts --reporter=line
  BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED=true npx playwright test e2e/semantic-continuation-intent-race.spec.ts --reporter=line
  npm run launcher:agent:bundle
  npm run launcher:swift:smoke
  (cd desktop/macos && swift build)
  npm run launcher:app:build
  npm run launcher:package
  npm run launcher:package:verify
  (cd desktop/macos && swift test)
  (cd /Users/joo/BiaDone/apps/blabase && npm run arch:check)
  git diff --check
  ```

  `swift test` was attempted exactly once. It stopped before test execution because the
  selected Command Line Tools SDK has no `XCTest` module and was not rerun.
- **Initial matrix evidence:** Unit passed 158 files/1,312 tests in 18.16s;
  typecheck 9.06s; lint 7.65s; Next.js 15.5.21 build 15.66s; Continuation baseline
  22/22 measured/pass and 0 failed/deferred in 1.11s; monitoring Playwright 1/1 in
  5.74s; Launcher agent bundle 0.50s, Swift smoke 25.42s, Swift build 1.02s, app build
  2.73s, package 16.53s and package verification 4.79s all passed. Full E2E failed
  with 18 passed, 8 failed, 1 skipped and 1 not run in 99.56s. `swift test` failed at
  the toolchain gate in 0.88s. Initial root `arch:check` failed in 3.60s after 12
  dependency warnings/0 errors when the suggestion dependency step reached TS18003/no
  inputs. Initial bundle, executable and DMG SHA-256 were respectively
  `6cae421c560d8e6a9f775ce50b488d92a7b6e22e1d436329461bff6060b83afe`,
  `daa2c3674b043d964359b01ac80ba2f178b1b356a1a24e5ccad7a6b2393860cd`, and
  `d7aab8cc2aabf7b213424d51860c33ed24b5989ba5318107dc6fa217c6b18332`.
- **Final matrix evidence:** `npm test` passed 158 files/1,327 tests in 22.21s;
  typecheck passed in 3.38s; lint passed in 19.16s; Next.js 15.5.21 build passed
  in 18.37s; baseline passed 22/22 measured with 0 failed/deferred in 1.16s; full E2E passed
  27 with 2 skipped in 40.06s; monitoring browser passed 1/1 in 5.29s; semantic
  race browser passed 1/1 in 7.57s. Launcher bundle passed in 0.52s with SHA-256
  `10625b73ce16dec2220f8f3069a12f0c7fae43fb687b997e922b29d48b2760ca`;
  Swift smoke passed in 24.85s after the deterministic fake-exit wait correction;
  Swift build passed in 0.40s; app build passed in 2.72s with executable SHA-256
  `7b587946078ee3f2774ebecbda6187799b85c37f48a4dadce599685a3546fc71`;
  package passed in 16.37s and verification in 2.38s with DMG SHA-256
  `21f44ceb78c4e47e99bc0d9990dfba0c141f646dc86905ad84e224609ccc5b7e`.
  Root `arch:check` passed in 7.39s with dependency warnings only/0 errors and all
  dependency/source/trace/model gates complete. Full `git diff --check` passed in
  0.03s.
- **Final reproducibility tuple:** Candidate payload
  `98a3c8135b23c6ac2aeddd3c2ada511d3d9a46638fb016d95d86945c8f6d8f31`;
  materialized input
  `de9dd348173cdf5087905a1c7b33e2ee20cd948159280572e8f090b95cdb9da2`;
  candidate configuration
  `60ac735cc0d8566772ef7fbf5329f5e626d89c02a8e408d3dafbda28f658221b`;
  deterministic output
  `bd6dfccc525cef2ee1837b08dfb2fa3a88b8776c7283732bb36e4502fd0db4e7`;
  canonical artifact
  `fddf51329caab4e456a62609664628422d3ad805d9449726ecec3c3467af4f24`;
  stored artifact
  `1e9f2555625db60e726d7b973f3ed60fa2fffc1d42dfd888954fea6b4cd8a2a4`.
  Full run artifact remains private under `.local/` with verified mode 0600 and is
  not committed.
- **Metrics changed:** No recommendation-quality metric changed or was measured.
  Contract checkpoint remains 12/12 contract, 9/9 resolver and 1/1 Board.
  Acceptable@1/3, setup quality and human review remain null/not-started;
  `releaseGateApplicable=false`. Monitoring output remains candidate-only and cannot
  affect rank, Gold, evaluation score or release.
- **Capability review:** Formal web read and Launcher Full Board rows are strictly
  `display/action=null`. Setup navigation alone may use explicit click plus candidate
  TTL, source/observation, relevant mapping and typed code provenance to return fixed
  `/projects`; because this Setup candidate has null WorkContext, exact WorkContext or
  session heartbeat is not required. `open_source` is blocked/unimplemented. Exact
  resume is blocked/unimplemented and any future slice requires exact WorkContext/
  session binding, fresh heartbeat, short TTL and action-time revalidation. Launcher
  Active-only fallback preserves only its pre-existing legacy Active actions.
- **Privacy or retention impact:** No production conversation or frozen dataset was
  read/promoted. Semantic v0.2 records stay in current-secret `.local` private storage;
  old fixed-root v0.1 authority is ignored rather than migrated. Monitoring retains the
  approved 30-day mutation-time lazy policy without background cleanup, while explicit
  purge covers every safe canonical namespace across key rotation and config absence.
  Raw titles/identifiers/secrets/private artifacts are not added to public response,
  replay, CLI or Git.
- **Independent QA:** `PASS` — current-head read-only re-review found no confirmed
  Medium+ defect. It specifically verified mutation-only SC-001 cross-namespace and
  SC-002 validation-temp recovery, pure-read non-mutation, no-follow/owner/mode/inode
  guards, hostile-temp non-deletion, separate write authority, all-namespace monitoring
  purge and the documented release blocks. The reviewer did not rerun tests or Git;
  this is advisory AI review, not human approval.
- **Regressions or accepted exceptions:** `swift test` remains an environment/toolchain
  failure before XCTest execution. Same-UID valid-store rollback/exact ABA and trusted
  wall-clock limits remain. There is no background retention worker. Crash-left locks/
  temp files generally fail closed for manual recovery; only the exact safe intent-store
  and validation-receipt mutation recovery cases are automated. Notarization was not
  run.
- **Release decision:** Automated checkpoint `automated_checkpoint_passed` because
  the final exact root `npm run arch:check` passed. Release remains exactly
  `blocked_pending_human_review`. No flag is enabled, no rollout or deployment is
  authorized, and no dataset is frozen/promoted.
- **Rollback method:** Disable exact flags in reverse authority order, beginning with
  `BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED` and monitoring, then Launcher Board,
  Setup action, presentation and resolver. Remove the additive v0.2 intent namespace/
  write/body/race changes and monitoring replay/purge changes if necessary; the legacy
  v0.1 intent file was never migrated or overwritten. Explicit all-data monitoring
  purge remains available even after config/key removal.
- **Follow-up work:** Real unmocked authenticated browser chain; human privacy/copy,
  320px/200% zoom, keyboard/VoiceOver/Safari review; full Xcode XCTest; old-host/
  new-agent and new-host/old-agent packaged compatibility; signed/notarized release;
  HTML nonce CSP review; broader crash recovery/cleanup policy; human dataset
  reviewers/adjudicator, lawful basis/anonymization, immutable freeze, locked holdout,
  75/90 decision, production G2/G3 and explicit release record.
- **Scoped patch fingerprint:** Policy
  `q001-automated-checkpoint-worktree-sha256-v1` sorts
  `relative-path<TAB>base-blob-or-ABSENT<TAB>worktree-mode<TAB>worktree-SHA256`
  for the exact final Q-001 implementation/test paths and hashes the sorted records
  with SHA-256. Documentation, `.local/`, generated build/package output and unrelated
  shared dirty paths are excluded. Scope count `33`; fingerprint
  `dcbb0dc8515fc228da58d27b86b03c63001238631a88368253b95befbeac3627`.

  ```text
  architecture/model.c4
  suggestion/.env.example
  suggestion/app/WorkBoardMonitoringControls.tsx
  suggestion/app/api/connectors/codex/disconnect/route.ts
  suggestion/app/api/work-board/intent/route.ts
  suggestion/app/api/work-board/monitoring/route.ts
  suggestion/app/attention-lab/AttentionLab.tsx
  suggestion/app/attention-lab/page.tsx
  suggestion/desktop/macos/Tests/Smoke/LauncherModelSmoke.swift
  suggestion/e2e/data-pipeline.spec.ts
  suggestion/e2e/managed-codex-progress.spec.ts
  suggestion/e2e/semantic-continuation-intent-race.spec.ts
  suggestion/src/http/boundedJson.ts
  suggestion/src/semanticContinuation/contracts.ts
  suggestion/src/semanticContinuation/localStore.ts
  suggestion/src/semanticContinuation/validation/producer.ts
  suggestion/src/semanticContinuation/validation/store.ts
  suggestion/src/suggestionBoard/liveShadow.ts
  suggestion/src/suggestionBoard/monitoring/store.ts
  suggestion/tests/attentionLabPresentation.test.tsx
  suggestion/tests/codexRoutes.test.ts
  suggestion/tests/semanticContinuationOverlay.test.ts
  suggestion/tests/semanticContinuationStore.test.ts
  suggestion/tests/semanticValidationOverlay.test.ts
  suggestion/tests/semanticValidationProducer.test.ts
  suggestion/tests/semanticValidationStore.test.ts
  suggestion/tests/workBoardIntentRoute.test.ts
  suggestion/tests/workBoardMonitoringCli.test.ts
  suggestion/tests/workBoardMonitoringRoute.test.ts
  suggestion/tests/workBoardMonitoringStore.test.ts
  suggestion/tests/workBoardMonitoringUi.test.tsx
  suggestion/tools/run-work-board-monitoring.ts
  suggestion/tools/start-isolated-e2e-server.mjs
  ```

## SC-001R — linked WorkContext semantic intent currentness correction (2026-08-15 KST)

- **Status:** Implemented and locally validated; default-off/local review scope only.
  Release remains `blocked_pending_human_review`.
- **Owner:** Continuation/Semantic owner with independent security review; user remains
  product and release approver.
- **Trigger:** A valid explicit `blabase QA 진행하기` confirmation disappeared after a
  fresh Codex sync even though registry, WorkContext and candidate expiry were unchanged.
  The linked candidate's `observedAt` and public `itemRef` advanced with the same live
  WorkContext, while SC-001 required exact item/observation equality.
- **Behavior before:** All intent decisions used
  `semantic-continuation-intent-v0.1`, overlay policy v0.1 and private store/schema v0.2.
  Any itemRef or observedAt drift suppressed the presentation. SC-002 exact currentness
  compared the original four target fields but had no versioned kind/evidence binding.
- **Behavior after:** New confirmations use intent/schema v0.2, overlay policy v0.2 and
  private store/schema/hash/HMAC domains v0.3. Candidate kind and evidence band are
  freshly derived server-side and included in the decision and authenticated store.
  Exact match remains first. A fallback display-title rebind is allowed only for one
  strictly newer `linked_workstream + corroborated` Continuation item with the exact
  registry, WorkContext and candidate-expiry anchors, `display/action=null`, no lingering
  old item and valid original TTL. It neither extends TTL nor changes base Board bytes,
  lane, ordering, score, evidence, caveats, capability or action.
- **SC-002 boundary:** Rebound items receive only the SC-001
  `${subjectLabel} QA 진행하기` title. Validation receipt titles, start authority and
  terminal authority remain exact and include kind/evidence for v0.2 decisions. A
  rebound/mismatch exits before provenance, profile or validation subprocess work.
  A fresh second clock prevents mid-preflight expiry, while an acquired abandoned run is
  terminally recovered before mismatch exit.
- **Compatibility and migration:** Legacy intent v0.1 inside authenticated store v0.2 is
  still pure-read and exact-only. GET and source sync never migrate it. The next explicit
  confirmation atomically writes store v0.3 while preserving history and supersession.
  Existing local intent therefore requires one explicit reconfirmation before rebinding.
  An older reader rejects v0.3 and fails closed to the unchanged generic base Board.
- **Version tuple:** Intent contract/schema v0.1 → v0.2; overlay/currentness policy
  v0.1 → v0.2; private intent store/schema and store hash/HMAC domains v0.2 → v0.3.
  Semantic presentation/wrapper remains v0.2. SC-002 receipt/policy, public Work Board
  v0.1, S1/R1/R2/R3/B1 and E-001 versions are unchanged.
- **Code provenance:** Base commit
  `ab24ed84a66b4415b678c377f7712be10c050577`; this record describes an uncommitted
  scoped patch pending explicit commit approval.
- **Evaluation:** No comparison run and no quality-metric claim. Mutable E-001 v0.3
  revision 3 input, candidate admission, rank, hashes and output semantics are unchanged;
  core baseline is N/A for this post-projection display currentness correction.
- **Commands and results:** From `suggestion/`, exact final targeted Vitest command covered
  `semanticContinuationContracts`, `semanticContinuationOverlay`,
  `semanticContinuationStore`, `semanticValidationContracts`,
  `semanticValidationOverlay`, `semanticValidationProducer`,
  `semanticValidationStore`, `workBoardIntentRoute`, `liveWorkBoardShadow` and
  `workBoardRoute`: 10 files/77 tests PASS. `npm run typecheck`, full `npm run lint` and
  `npm run build` PASS on Next.js 15.5.21.
- **Independent QA:** Read-only security review found no remaining Medium+ source/test
  defect after exact kind/evidence checks, no-spawn preflight, fresh-clock expiry,
  abandoned-run recovery and fail-closed regression additions. This is advisory AI QA,
  not human release approval.
- **Privacy and retention:** Two private generic enums are added; no raw summary, prompt,
  source/session/repository identifier, path or credential is added to public DTOs,
  persistence, replay, evaluation or Git. Existing TTL, consent, 0700/0600 storage,
  secret namespace, purge and retention behavior are unchanged.
- **Rollback:** Disable Semantic write/read flags or remove the v0.2 producer/rebinder.
  Do not rewrite v0.3 in place. Old code safely suppresses the unknown store and retains
  the base Board; users may explicitly reconfirm after returning to a compatible version.
- **Residual risk:** Rebinding proves a bounded WorkContext-scoped continuation, not a
  stable raw source lineage. A different linked session inside the same context could
  satisfy the bounded policy before the unchanged expiry; SC-002 remains exact-only to
  prevent carrying validation results across that boundary. Human privacy/copy/G2/G3
  and release approval remain pending.
- **Scoped fingerprint:** `sc001r-semantic-currentness-content-sha256-v1` hashes a sorted
  `relative-path<TAB>worktree-SHA256` manifest for 12 source/test files, excluding docs,
  generated output, `.local/` and unrelated worktree changes:
  `2512d3e568e6ffd364c53b509232dbee0cc6a0b3c4ccaeb13a50080e50f87223`.

## Engine Change Record — L-001 data-root shared environment parity correction

- **Date:** 2026-08-16 KST
- **Owner:** Codex implementation; user remains product, privacy and release approver.
- **Goal:** Make the native Launcher evaluate the same selected data root with the
  same allowlisted local connector configuration as the web surface, without changing
  Board semantics or granting Launcher mutation authority.
- **Affected pipeline stages:** Launcher-agent startup wiring only. Source mode,
  scheduler construction, `LauncherService` evaluation and Companion Codex binary
  resolution now share one data-root-bound environment snapshot. Core Continuation,
  Work Board composition, overlay, filtering, ordering, actions and IPC projections are
  unchanged.
- **Behavior before:** The Launcher parsed an explicit data root but passed ambient
  `process.env` directly to every runtime component. A packaged process whose working
  directory was outside that root could therefore miss the root's `.env.local` pointer
  and its allowlisted GitHub configuration, causing a linked/corroborated semantic
  continuation shown on web to degrade to Codex-only `single_source` in Launcher.
- **Behavior after:** Immediately after parsing `dataRoot`, the agent creates exactly
  one `createSharedLocalEnvSnapshot(process.env, {cwd:dataRoot,mode:"maintain"})` and
  passes that same object to source-mode resolution, the managed coordinator,
  `LauncherService` and Companion `resolveCodexBinary`. Ambient values retain
  precedence when non-empty, while empty allowlisted ambient values retain the existing
  unset/supplement behavior. Only existing allowlisted keys are supplemented; feature
  flags and code provenance remain ambient/default-off. The returned exact snapshot
  object is recorded only in a module-private `WeakSet`, so downstream legacy
  `loadSharedLocalEnv(snapshot)` calls are no-ops and cannot mix in a different current
  working directory's pointer. Read-only mode still performs no source sync; there is
  no per-request env-file read, string marker, path/secret exposure or `process.env`
  mutation.
- **Versions before/after:** Launcher IPC v1, Attention v2, Work Board v1, semantic
  presentation/overlay and every core engine/schema/rule version are unchanged. This is
  runtime configuration parity, not a new recommendation rule.
- **Code commit:** Base commit
  `2e2eedc3da0a5a15176aef843e5416a74cd160c3`; correction is an uncommitted scoped patch
  pending explicit commit approval.
- **Evaluation dataset/run IDs:** N/A. No dataset, evaluator, prompt, evidence rule,
  rank or semantic resolver changed; no quality comparison is claimed.
- **Commands executed:** Final `npx vitest run tests/localEnv.test.ts
  tests/launcherAgentEnvironment.test.ts tests/launcherService.test.ts` passed 3
  files/26 tests, including selected-root isolation, managed same-object propagation
  and read-only no-coordinator regressions. `npm run typecheck` and full
  `npm run lint` passed.
- **Metrics changed:** None measured. The regression fixes cross-surface configuration
  parity and does not claim recommendation-quality improvement.
- **Privacy or retention impact:** No new persistence, logging or retention. Secrets and
  paths remain absent from IPC, public Board data, diagnostics and Git; the in-memory
  snapshot uses the existing allowlist and ambient-precedence policy.
- **Regressions or accepted exceptions:** No automated regression in the focused gate.
  Module-private WeakSet state is exact-object and process-local; legacy callers that
  pass `process.env` or independently constructed objects keep their existing loading
  behavior.
  Packaged-app manual parity, old-agent compatibility and accessibility review remain
  pending; no baseline/build/package/Swift rerun was required for this TypeScript
  startup-wiring correction.
- **Release decision:** Local correction only. Launcher rollout and overall release
  remain blocked pending the existing human review gates.
- **Rollback method:** Revert the launcher-agent snapshot wiring; public contracts and
  stored data require no migration. Disabling the exact Launcher Work Board flag remains
  the immediate flag-first fallback to legacy Active behavior.
- **Follow-up work:** Rebuild/restart the clean packaged Launcher and manually compare a
  single captured web/Launcher Board at the same timestamp; retain the existing human
  privacy, accessibility, compatibility and release approvals.

<!-- engine-change-record-section:ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17:begin -->
## Engine Change Record — DFA-000 Dayflow ablation synthetic scope

- **Record ID:** `ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`
- **Date:** 2026-08-17 KST
- **Status:** Draft. The human-approved synthetic planning scope is recorded; implementation,
  contract freeze, evaluation, live collection, cross-repository work, and release remain
  unapproved or pending as stated below.
- **Owner and approvals:** Documentation/architecture planning under human direction. The
  user's explicit instruction in the 2026-08-17 task thread approves this bounded synthetic
  scope and the pragmatic governance simplification. It is not `H-DFA-CONTRACT`,
  `H-CROSS-REPO`, live-capture, pilot, E2, or release approval.
- **Goal:** Plan and validate a local-only synthetic A0/A1/B/C suggestion ablation without
  creating a parallel machine-approval framework. Preserve the paired B-versus-A1 causal
  comparison, A0 compatibility anchor, independent screen-only C arm, immutable evaluation
  lineage, privacy/retention controls, and later human contract/cross-repository gates.
- **Affected pipeline stages:** DFA-000 documentation scope and DFA-001 planned LikeC4
  validation; DFA-002 synthetic source schemas, fixtures, tests, and contract-freeze
  preparation. No production Attention, Continuation, Work Board, Launcher, route, action,
  store, capture, provider, evaluator, or release behavior changes in this record.
- **Behavior before:** The draft plan introduced six raw-hashed scope manifests, synthetic
  actor DAGs, custom tool/package-tree closures, command receipts, publishers, and chained
  scope approvals. That machinery duplicated repository controls, created review overhead,
  and implied authority that had not been earned by implementation or test evidence.
- **Behavior after:** One human-approved Draft ECR bounds the work. DFA-001 uses the existing
  planned LikeC4 sources, standard repository commands, captured command results, and an
  independent QA review. DFA-002 may then add strict source schemas, synthetic fixtures, and
  tests. A source-hash `ContractFreezeProposal` binds the reviewed diff, source/config/
  fixture hashes, package-lock and relevant tool versions, and exact check results. A
  separate human `H-DFA-CONTRACT` decision may approve that existing proposal; only then is
  an immutable contract freeze published. DFA-003 still requires separate explicit
  `H-CROSS-REPO` approval.
- **Accepted rationale:** Repository-native commands, source hashes, lockfile/tool versions,
  readable diffs, check results, and independent QA provide proportionate reproducibility
  for a synthetic candidate. No claim is made that node_modules or the host is hermetic.
  Removing the provisional manifest/actor/receipt framework reduces circular approval and
  stale-hash risk without weakening the live-data, cross-repository, privacy, or release
  gates.
- **Exact allowed tracked paths:** Only the following tracked paths may change under
  DFA-000–002. Any additional tracked path requires a new human-reviewed ECR scope decision.
  - `suggestion/docs/DAYFLOW_SUGGESTION_ABLATION_PLAN.md`
  - `suggestion/docs/DAYFLOW_SUGGESTION_ABLATION_RUNBOOK.md`
  - `suggestion/docs/ENGINE_CHANGE_RECORD.md`
  - `architecture/planned.c4`
  - `architecture/views.c4` (planned views only)
  - `suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.1.json`
  - `suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.1.json`
  - `suggestion/src/dayflowEvidence/contracts.ts`
  - `suggestion/src/dayflowEvidence/extract.ts`
  - `suggestion/src/dayflowEvidence/normalize.ts`
  - `suggestion/src/evaluation/dayflowAblation/buildDataset.ts`
  - `suggestion/src/evaluation/dayflowAblation/contracts.ts`
  - `suggestion/src/evaluation/dayflowAblation/evaluate.ts`
  - `suggestion/src/evaluation/dayflowAblation/run.ts`
  - `suggestion/tests/dayflowAblationEvaluation.test.ts`
  - `suggestion/tests/dayflowEvidenceContracts.test.ts`
  - `suggestion/tests/dayflowEvidenceExtraction.test.ts`
  - `suggestion/tools/run-dayflow-evidence-ablation.ts`
- **Data and capability boundary:** DFA-000–002 are synthetic-only and local-only. Raw human
  conversations, screenshots, actual Dayflow blobs, production data, credentials, and
  secrets are forbidden. No Dayflow repository write/build/run, database/WAL/screenshot
  read, macOS capture API, network, provider, telemetry, cloud storage, production store/
  route/action, or production integration is authorized. The pinned Dayflow document/source
  hashes remain read-only references. Private generated artifacts stay under ignored
  `.local/` or `artifacts/architecture/` paths and never enter Git.
- **Version tuple:** Planning contract `DFA-000 synthetic scope v1`; proposed export,
  normalized evidence, checkpoint/run, review, dataset, deletion, aggregate, and state
  schemas remain Draft until the DFA-002 source-hash proposal and human
  `H-DFA-CONTRACT`. No runtime schema is frozen by this ECR.
- **Code provenance:** Known base commit
  `92b2ca94fc3e8347261ac6a85a627c8e6c915400`; `codeCommit: null`. The worktree contains
  documentation/planned-architecture work and may be dirty. Exact source hashes are deferred
  to the DFA-002 proposal rather than represented by a synthetic approval chain.
- **Evaluation dataset and run IDs:** Deferred. No dataset, arm run, comparison run, review
  result, metric, baseline, pilot, or release evidence is created or approved here.
- **DFA-001 standard command evidence:** The required repository commands are
  `npm run arch:model:format:check`, `npm run arch:sources:check`,
  `npm run arch:model:check`, and `npm run arch:model:build`, executed from the Blabase
  root against the reviewed planned-source diff. Record exact command text, start/end time,
  exit status, relevant package-lock/tool versions, output location, and readable results.
  Independent QA must confirm Dayflow remains absent from implemented `model.c4` and
  dynamics and that changes are planned-only. These commands were not run by this cleanup.
- **DFA-002 validation evidence:** Exact targeted Vitest commands for the three new test
  files, `npm run typecheck`, `npm run lint`, and `npm run arch:deps:check` when imports
  change must pass. Record exact commands/results and source/config/fixture hashes in the
  proposal. A required failure or omission cannot be waived as passing.
- **Metrics changed:** None. No conformance, quality, baseline, live, release, pilot, or E2
  claim is made.
- **Privacy and retention:** Synthetic fixtures use no real person or workspace data and are
  Git-safe only after review. Private generated outputs use ignored local storage, data
  minimization, bounded retention, deletion verification, and no cloud sync. Live consent,
  encryption, retention, coverage, deletion, and lawful-basis approval remain mandatory
  before any later live pilot and cannot be satisfied by this record.
- **Current task status:** `DFA-000 completed`;
  `DFA-001 implementation_validation_pending` because planned source and standard commands
  exist but command evidence and independent QA are pending; `DFA-002 pending`.
  DFA-003 and later implementation gates remain blocked by their documented dependencies.
- **Release decision:** Planning scope accepted; no implementation, contract, live, pilot,
  production, or release approval. DFA-002 cannot complete before the proposal →
  independent human `H-DFA-CONTRACT` → immutable freeze sequence.
- **Rollback method:** Stop the experiment, leave production paths unchanged, remove or
  revert only the allowed planned/synthetic experiment paths, and discard ignored local
  artifacts. Frozen datasets or approvals, once created, are never rewritten. No production
  data migration is required.
- **Follow-up work:** Complete DFA-001 standard command evidence and independent QA. Then
  implement DFA-002 only within the exact tracked path list, publish the source-hash
  ContractFreezeProposal with readable diff and check evidence, request human
  `H-DFA-CONTRACT`, and freeze the approved contract before seeking H-CROSS-REPO.
<!-- engine-change-record-section:ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17:end -->

<!-- engine-change-record-section:ECR-DFA-001-PLANNED-LIKEC4-VALIDATION-2026-08-17:begin -->
## Engine Change Record Addendum — DFA-001 planned LikeC4 validation

- **Record ID:** `ECR-DFA-001-PLANNED-LIKEC4-VALIDATION-2026-08-17`
- **Parent record:** `ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`.
  This additive section supersedes only that record's DFA-001 evidence/status statement; it
  does not alter its scope, prohibitions, or approval boundaries.
- **Date/status:** 2026-08-17 KST; Draft planning evidence, `DFA-001 completed`.
- **Reviewed source hashes:** `architecture/planned.c4` raw SHA-256
  `56b48e0049220e928398cbae636b46c89a7c9ba03141dc3044bcf186a1ecadfb`;
  `architecture/views.c4` raw SHA-256
  `f92c7e5ec197bc7145901feb3941fc18965c736cc83fbeb7c38d57e5e294b8f4`.
- **Standard command evidence:** `npm run arch:model:format:check` PASS;
  `npm run arch:sources:check` PASS with 49 links; `npm run arch:model:check` PASS with
  5 files; `npm run arch:model:build` PASS. Build output is confined to the ignored
  architecture artifact path.
- **Semantic and independent review:** Semantic `rg` guard PASS with no Dayflow leakage
  into implemented model, dynamics, or production paths. Independent QA PASS with no
  Medium-or-higher findings.
- **Dataset/run/metric impact:** No evaluation dataset or run ID was created. This is a
  planning-only architecture closure with no runtime or engine behavior change; core
  baseline is N/A and no conformance, quality, live, pilot, E2, or release claim is made.
- **Privacy/release:** The parent record's synthetic-only, local-only, no-Dayflow-write,
  no-network/provider/telemetry/production-integration constraints remain unchanged. The
  build produced ignored review output only.
- **Task transition:** `DFA-000 completed`; `DFA-001 completed`; `DFA-002 pending` and is the
  next task. DFA-002 still requires strict source schemas, synthetic fixtures/tests, a
  source-hash `ContractFreezeProposal`, independent human `H-DFA-CONTRACT`, and matching
  immutable freeze before completion. DFA-003 remains blocked on separate
  `H-CROSS-REPO` approval.
- **Rollback:** Remove or revert only the planned LikeC4 additions and discard the ignored
  architecture build artifact. No production state or data migration exists.
<!-- engine-change-record-section:ECR-DFA-001-PLANNED-LIKEC4-VALIDATION-2026-08-17:end -->

<!-- engine-change-record-section:ECR-DFA-002-CONTRACT-CANDIDATE-2026-08-17:begin -->
## Engine Change Record Addendum — DFA-002 contract candidate

- **Record ID:** `ECR-DFA-002-CONTRACT-CANDIDATE-2026-08-17`.
- **Parent records:** `ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`
  and `ECR-DFA-001-PLANNED-LIKEC4-VALIDATION-2026-08-17`. This additive section
  supersedes only their DFA-002 implementation/validation status. It does not modify either
  earlier record or broaden the approved synthetic tracked-path/safety scope.
- **Date/status:** 2026-08-17 KST; closed machine status `DFA-002 pending`.
  The implementation candidate is validated and proposal assembly is pending. Machine status
  may become `in_review` only after proposal publication, readback, and human-review submission.
  Contract-only implementation and automated validation are complete. DFA-002 is not
  approved, frozen, executable, completed, live-enabled, production-enabled, or released;
  `H-DFA-CONTRACT` remains pending.
- **Goal:** Implement and independently review the strict synthetic Dayflow ablation contract
  schemas, registry, deterministic fixtures/loaders, and fail-closed verification behavior
  without connecting a runtime, store, CLI, screen source, live source, or production path.
- **Affected pipeline stages:** Synthetic contract validation, duplicate-aware fixture loading,
  artifact registry/hash domains, source-pin/proposal/decision/freeze validation, arm/run
  serialization, request issuance integrity, checkpoint completion, retention attestations,
  and fail-closed resolver boundaries. No production suggestion pipeline stage is connected.
- **Behavior before:** DFA-002 was an acceptance sketch with no strict TypeScript candidate
  implementation or contract-conformance fixture coverage.
- **Behavior after:** The eight source/config/fixture/test files below form an independently
  reviewed contract candidate. The candidate rejects missing, unresolved, stale, mismatched,
  non-canonical, duplicate-key, cross-lineage, privacy-invalid, or unauthorized inputs. These
  bytes remain non-normative until an exact proposal is approved by `H-DFA-CONTRACT` and the
  matching immutable freeze is published and read back.

### Reviewed DFA-002 source manifest

SHA-256 values are over exact raw file bytes. Byte lengths are canonical decimal counts.

| Role | Repository-relative path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| fixture | `suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.1.json` | 24879 | `aa4958de3255785125bdc20c6982b10074c0242bfa67644498c87560339de951` |
| config | `suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.1.json` | 8572 | `74136e46be65c8f59281358015b851d236e7f0b898c98ecdf09f297ecf323c01` |
| source | `suggestion/src/dayflowEvidence/contracts.ts` | 74166 | `3fec68840edfe5be2bee39a16ba634f91d21e20915a40c2eaab38b9e542279e0` |
| source | `suggestion/src/evaluation/dayflowAblation/buildDataset.ts` | 21256 | `28ecdc71e2a0d8b79806b0bc6994558c9f3218d184d8b172f092628d09ba5ab4` |
| source | `suggestion/src/evaluation/dayflowAblation/contracts.ts` | 251122 | `62ced4da6db62170be493b76d72f887ac502c2050c7540bff935aa45d3dafe59` |
| test | `suggestion/tests/dayflowAblationEvaluation.test.ts` | 173194 | `a28966f39fc008fb9eff1efc9251331baef26a8b79dda756289a40b333925169` |
| test | `suggestion/tests/dayflowEvidenceContracts.test.ts` | 46972 | `b819e97f39e6883b58d03bd4ca1074931babf252fcdad9a0723cc186b53e148e` |
| test | `suggestion/tests/dayflowEvidenceExtraction.test.ts` | 8816 | `92a31f1b9b805374f123a6a579a35053c63815941fb1a79bd48ba042731cde36` |

### Non-exhaustive QA-relevant contract version/domain delta

This table is not the artifact-registry inventory. The canonical complete 32-row inventory,
including storage mode and detached hash field, is the frozen
`DAYFLOW_ABLATION_ARTIFACT_REGISTRY` in
[`contracts.ts`](../src/evaluation/dayflowAblation/contracts.ts); the Plan and Runbook contain
its readable full projection.

| Artifact | Schema version | Hash domain | Detached hash field |
| --- | --- | --- | --- |
| Contract proposal | `dayflow-dfa-contract-freeze-proposal-v0.1` | `blabase.dayflow-dfa.contract-freeze-proposal.v0.1` | `contractFreezeProposalSha256` |
| Contract decision | `dayflow-dfa-contract-decision-v0.1` | `blabase.dayflow-dfa.contract-decision.v0.1` | `contractDecisionSha256` |
| Contract freeze | `dayflow-dfa-contract-freeze-v0.1` | `blabase.dayflow-dfa.contract-freeze.v0.1` | `contractFreezeSha256` |
| A0 arm input | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.a0.v0.4` | `armInputHash` |
| A1 arm input | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.a1.v0.4` | `armInputHash` |
| B arm input | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.b.v0.4` | `armInputHash` |
| C arm input | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.c.v0.4` | `armInputHash` |
| Arm run | `dayflow-ablation-run-v0.4` | `blabase.dayflow-ablation.run.v0.4` | `runSha256` |
| Request-order manifest | `dayflow-ablation-request-order-manifest-v0.1` | `blabase.dayflow-ablation.request-order-manifest.v0.1` | `requestOrderManifestSha256` |
| Request-issuance receipt | `dayflow-ablation-request-issuance-receipt-v0.1` | `blabase.dayflow-ablation.request-issuance-receipt.v0.1` | `requestIssuanceReceiptSha256` |
| Pilot verification attestation | `dayflow-ablation-pilot-verification-attestation-v0.1` | `blabase.dayflow-ablation.pilot-verification-attestation.v0.1` | `pilotVerificationAttestationSha256` |
| Evaluation checkpoint | `dayflow-ablation-checkpoint-v0.2` | `blabase.dayflow-ablation.checkpoint.v0.2` | `checkpointSha256` |
| Checkpoint completion | `dayflow-ablation-checkpoint-completion-v0.1` | `blabase.dayflow-ablation.checkpoint-completion.v0.1` | `checkpointCompletionSha256` |

- **Versions before/after:** The table above records the candidate source contract literals.
  There is no new production engine/prompt/model/provider version. The deterministic
  contract-only generation tuple uses literal provider/model/prompt/template `none`, empty
  generation parameters, and `syntheticOnly: true`.
- **Code provenance:** Known Blabase base
  `92b2ca94fc3e8347261ac6a85a627c8e6c915400` and pinned Dayflow revision
  `df3c367edb7d405a78d1ae76edffe4ba366f57d7`. No new commit or Dayflow repository write is
  claimed by this record. The exact candidate files are bound by the manifest above.
- **Commands/checks executed:** From `suggestion/`,
  `./node_modules/.bin/vitest run tests/dayflowEvidenceContracts.test.ts tests/dayflowEvidenceExtraction.test.ts tests/dayflowAblationEvaluation.test.ts`
  passed all 3 files and `66/66` tests; suggestion `npm run typecheck` passed; full
  `npm run lint` passed. From the Blabase root, `npm run arch:deps:check` exited 0 with the
  existing 12 boundary, 8 coupling, and 2 cycle warnings. No check failure was waived.
- **Independent review:** Independent QA is Green with no Medium-or-higher finding. This is
  review of the contract-only implementation and automated results, not human contract
  approval.
- **Evaluation dataset/version, run IDs, and metrics:** N/A. No Golden, Regression, Rolling,
  or Holdout dataset changed; no candidate/comparison run exists; no quality, conformance,
  pilot, E2, baseline, or release metric is claimed. A Golden baseline is N/A because this
  candidate is contract-only and is not wired into production semantics.
- **Privacy and retention:** Only synthetic fixtures were used. No raw human conversation,
  screenshot, actual Dayflow blob, credential, secret, or production data was read, stored,
  or emitted. The designed raw-artifact maximum retention is 24 hours; normalized metadata
  follows the documented policy. An immutable pre-purge verification attestation contains
  no raw blobs. After raw purge, verification resolves metadata, attestations, and deletion
  receipts rather than deleted content. The attestation schema encodes `verifiedAt` but no
  TTL/expiry/revocation/purge fields; DFA-007 must enforce private-metadata retention from
  `verifiedAt` for audit need only, with a hard 30-day cap and the earliest applicable deletion,
  consent-revocation, authority/contract-invalidation, or rollback trigger. It is excluded from
  backup/export/telemetry and its purge is receipt-covered. These contracts grant no live
  collection authority.
- **Deferred fail-closed boundaries:** DFA-003's trusted external pin resolver and Dayflow
  export boundary implementation are deferred; missing/untrusted pin content or export
  resolution is rejected. DFA-007's authoritative current/historical-as-of resolver and
  attestation lifecycle implementation are deferred. DFA-007 owns immutable create-no-overwrite
  publication, currentness/revocation, private store/read/purge, retention/deletion receipts,
  and corruption/rollback fail-closed tests; missing, stale, unresolved, or hash-mismatched
  authority/attestation input is rejected. No live/runtime/production/store/CLI/screen
  integration was added.
- **Proposal and approval state:** No schema-valid artifact was emitted at
  `suggestion/.local/evaluations/dayflow-ablation/contract-proposals/<proposalId>.json`.
  The pending role assignments are proposer/working owner `colin`, owner reviewer `colin`, and
  independent reviewer `david`; both people will review/confirm, but none of those acts is
  recorded yet. The proposal schema has exactly one proposer and one distinct independent-QA
  reviewer. The decision schema has exactly one approver distinct from the proposer, not a
  2-of-2 vote. It does not require the independent-QA reviewer and decision approver to differ,
  so `david` may fill both roles. `colin`'s owner confirmation is workflow prose rather than a
  second decision field; with these assignments only `david` satisfies independence and may be
  the future `approverPseudonym`. Immutable source-pin, command-result, readable-diff, and
  `david`-attributed independent-QA receipts remain unassembled, so this record does not fabricate
  them. The prose label "implementation candidate validated; proposal assembly pending"
  describes the reviewed implementation candidate only; the closed machine status remains
  `pending`. Existing technical QA evidence does not substitute for either assigned person's
  pending review/confirmation. It is not a
  `ContractFreezeProposal`, human decision, contract freeze, or executable study protocol.
- **Release decision:** Do not execute or release. `H-DFA-CONTRACT` is pending. No decision
  artifact or freeze exists, and DFA-002 is not complete. DFA-003 and DFA-007 implementations
  remain deferred and fail closed; all downstream/live/production gates remain closed.
- **Rollback:** Remove or revert only the eight DFA-002 candidate files within the approved
  scope and this additive recordkeeping update. There is no production migration, stored live
  data, provider state, or frozen dataset to roll back.
- **Follow-up work:** Assemble the exact source-pin artifact, immutable command result bytes
  with timestamps and hashes, readable diff receipt, independent QA receipt, tool-version
  tuple, `colin`'s owner review/confirmation, and `david`'s independent review/confirmation. Then
  publish/read back one schema-valid `ContractFreezeProposal` for the unchanged candidate with
  `proposerPseudonym: colin` and `independentQaRef.reviewerPseudonym: david`. Only after that may
  `david` record the schema's single `H-DFA-CONTRACT: approved | rejected` decision as
  `approverPseudonym`; no decision exists yet. Only an approval of that exact proposal may be
  bound into a matching immutable freeze; any byte/result change requires a new proposal and
  human decision.
<!-- engine-change-record-section:ECR-DFA-002-CONTRACT-CANDIDATE-2026-08-17:end -->

<!-- engine-change-record-section:ECR-DFA-000-TRACKED-PATH-AMENDMENT-DFA002-CONFIGS-2026-08-18:begin -->
## Engine Change Record Addendum — DFA-000 exact two-path scope amendment

- **Record ID:** `ECR-DFA-000-TRACKED-PATH-AMENDMENT-DFA002-CONFIGS-2026-08-18`.
- **Parent record:** `ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`.
  This is an additive human-reviewed scope decision; it does not rewrite the parent record.
- **Date/status and approver:** 2026-08-18 KST; `colin` explicitly approved exactly the two
  tracked-path additions below for DFA-002 contract-only validation configuration:
  - `suggestion/tsconfig.dayflow-dfa002.json`
  - `suggestion/vitest.dayflow-dfa002.config.ts`
- **Exact scope effect:** The parent record's 13 DFA-002 source/config/fixture/test/tool paths
  become 15 only by those two additions. No other tracked path, runtime, store, CLI, screen,
  live input, Dayflow write, provider/network call, production integration, contract approval,
  freeze, pilot, E2, release or deployment authority is added.
- **Rationale:** The two files provide a bounded DFA-002 TypeScript project and Vitest
  configuration that exclude generated/private roots, avoid environment-file loading, and make
  the authoritative scoped commands explicit and reproducible. They are candidate config bytes,
  not an approval artifact or execution grant.
- **Task/gate effect:** `DFA-000 completed` remains unchanged. `DFA-002` remains closed machine
  status `pending`; this scope amendment is not `H-DFA-CONTRACT`, does not satisfy David's
  authenticated review, and cannot create a proposal, decision or freeze.
- **Privacy/data impact:** None. The amendment authorizes only two tracked configuration files
  and preserves the synthetic-only, no-raw-human-data, no-secret, local-only boundary.
- **Rollback:** Remove only these two config additions if the scoped DFA-002 command strategy is
  abandoned. No production state, external repository state or user data requires migration.
<!-- engine-change-record-section:ECR-DFA-000-TRACKED-PATH-AMENDMENT-DFA002-CONFIGS-2026-08-18:end -->

<!-- engine-change-record-section:ECR-DFA-002-CONTRACT-CANDIDATE-V0.3-2026-08-18:begin -->
## Engine Change Record Addendum — DFA-002 final v0.3 contract candidate

- **Record ID:** `ECR-DFA-002-CONTRACT-CANDIDATE-V0.3-2026-08-18`.
- **Parent records:** `ECR-DFA-002-CONTRACT-CANDIDATE-2026-08-17` and
  `ECR-DFA-000-TRACKED-PATH-AMENDMENT-DFA002-CONFIGS-2026-08-18`. This additive record
  explicitly supersedes the older DFA-002 candidate's eight-file hashes, 32-row registry,
  proposal/decision/freeze v0.1 tuple, 66/66 check result, evidence-assembly description and
  rollback count wherever they conflict with this record. The older bytes and statements remain
  historical evidence and were not rewritten. Parent safety and approval boundaries remain.
- **Date/status:** 2026-08-18 KST; closed machine status `DFA-002 pending`. The final
  contract-only implementation candidate, automated validation, compatibility checks and external
  QA are complete; proposal assembly is pending. Status may become `in_review` only after a
  schema-valid proposal is published, read back and submitted for H-DFA review. DFA-002 is not
  approved, frozen, executable, completed, live-enabled, production-enabled or released.
- **Goal and affected boundary:** Finalize strict synthetic source schemas, deterministic
  fixtures/loaders, the 36-row registry, privacy-bounded proposal evidence contracts and
  fail-closed resolver verification. No production suggestion stage, runtime, private-store
  implementation, CLI, screen source, live source, provider or external mutation is connected.
- **Behavior after:** The exact ten candidate files below are the current independently reviewed
  source candidate. Proposal evidence is no longer an opaque prose reference: command receipt
  v0.1, full-content readable diff v0.2, machine-evidence bundle v0.2 and authenticated human-
  review receipt v0.2 are strict standalone artifacts resolved by proposal/decision/freeze v0.3.
  These are source contracts only; no instance was emitted and the candidate remains
  non-normative until the exact human-approved freeze chain completes.

### Current DFA-002 ten-file manifest

SHA-256 values are over exact raw file bytes. Byte lengths are canonical decimal counts.

| Role | Repository-relative path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| fixture | `suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.1.json` | 24879 | `aa4958de3255785125bdc20c6982b10074c0242bfa67644498c87560339de951` |
| config | `suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.1.json` | 9469 | `5bfa4540d93743750a12c0e564852661db6e95d8248a12b1a7ef0044b1143691` |
| source | `suggestion/src/dayflowEvidence/contracts.ts` | 74843 | `fcdea904dad60840d69fa0bf55bd2033fc31b829c045bbbbcb6575421a41afb3` |
| source | `suggestion/src/evaluation/dayflowAblation/buildDataset.ts` | 21256 | `28ecdc71e2a0d8b79806b0bc6994558c9f3218d184d8b172f092628d09ba5ab4` |
| source | `suggestion/src/evaluation/dayflowAblation/contracts.ts` | 301021 | `33dd14115b140f7f21ea4c44a299fdcb2096557c7ffff21264a22159089bd299` |
| test | `suggestion/tests/dayflowAblationEvaluation.test.ts` | 235858 | `1d43477d9b2c1c274cf1132756203d3f49568a1a55471cc9342a0df5620500c9` |
| test | `suggestion/tests/dayflowEvidenceContracts.test.ts` | 47886 | `9112df7720d952bad837a4d95daa007da904b18694715515c3fba16450bbe01d` |
| test | `suggestion/tests/dayflowEvidenceExtraction.test.ts` | 8816 | `92a31f1b9b805374f123a6a579a35053c63815941fb1a79bd48ba042731cde36` |
| config | `suggestion/tsconfig.dayflow-dfa002.json` | 671 | `61fb4436fb370febcb1f829f7d483430092228fd0d030c06828e8559ffba8693` |
| config | `suggestion/vitest.dayflow-dfa002.config.ts` | 396 | `13a55619cdd259acf0199f4dceb74476aede2792bb6686309a5042b5cde893cc` |

The distinct command-defining input inventory is the exact source constant: root
`dependency-cruiser.config.mjs`, `dependency-cruiser.suggestion.config.mjs`, `package-lock.json`
and `package.json`; plus `suggestion/eslint.config.mjs`, both suggestion package files,
`suggestion/tsconfig.dayflow-dfa002.json`, `suggestion/tsconfig.json` and
`suggestion/vitest.dayflow-dfa002.config.ts`. Candidate/input overlap must repeat identical byte
metadata, and `unexpectedTrackedPaths` is exactly empty.

### Current QA-relevant registry delta

This is a non-exhaustive delta. The canonical complete 36-row inventory, storage modes and
detached hash fields are `DAYFLOW_ABLATION_ARTIFACT_REGISTRY` in
[`contracts.ts`](../src/evaluation/dayflowAblation/contracts.ts); the Plan and Runbook contain its
readable full projection.

| Artifact | Schema version | Hash domain | Detached hash field |
| --- | --- | --- | --- |
| Contract proposal | `dayflow-dfa-contract-freeze-proposal-v0.3` | `blabase.dayflow-dfa.contract-freeze-proposal.v0.3` | `contractFreezeProposalSha256` |
| Contract decision | `dayflow-dfa-contract-decision-v0.3` | `blabase.dayflow-dfa.contract-decision.v0.3` | `contractDecisionSha256` |
| Contract freeze | `dayflow-dfa-contract-freeze-v0.3` | `blabase.dayflow-dfa.contract-freeze.v0.3` | `contractFreezeSha256` |
| DFA command receipt | `dayflow-dfa-command-receipt-v0.1` | `blabase.dayflow-dfa.command-receipt.v0.1` | `commandReceiptSha256` |
| DFA readable diff | `dayflow-dfa-readable-diff-v0.2` | `blabase.dayflow-dfa.readable-diff.v0.2` | `readableDiffSha256` |
| DFA machine evidence | `dayflow-dfa-machine-evidence-bundle-v0.2` | `blabase.dayflow-dfa.machine-evidence-bundle.v0.2` | `machineEvidenceBundleSha256` |
| DFA human review | `dayflow-dfa-human-review-receipt-v0.2` | `blabase.dayflow-dfa.human-review-receipt.v0.2` | `humanReviewReceiptSha256` |

- **Authoritative scoped commands:** `dfa002-depcruise` with dependency-cruiser 18.2.0 passed
  over 6 modules/9 dependencies; `dfa002-eslint` with ESLint 9.39.5 passed explicitly;
  `dfa002-tsc` with TypeScript 5.9.3 and `tsconfig.dayflow-dfa002.json` passed; and
  `dfa002-vitest` with Vitest 3.2.7 and `vitest.dayflow-dfa002.config.ts` passed 3 files/73 tests.
  These successful executions are current technical evidence, not fabricated v0.1 receipt
  artifacts; proposal assembly must capture new exact timestamps, stdout/stderr metadata,
  invocation/runtime facts and input-set hash in immutable receipts.
- **Full compatibility checks:** Full suggestion typecheck PASS; full suggestion lint PASS; root
  `arch:deps:check` exited 0 with 0 errors and existing warnings: repository 12, suggestion 8,
  scripts 2. No required failure or omission was waived.
- **External review:** External QA PASS. This verifies the final contract-only candidate and
  automated evidence; it is not David's authenticated human-review receipt and is not
  `H-DFA-CONTRACT` approval.
- **Versions and reproducibility:** Known Blabase base
  `92b2ca94fc3e8347261ac6a85a627c8e6c915400` and pinned Dayflow revision
  `df3c367edb7d405a78d1ae76edffe4ba366f57d7` remain. The deterministic generation tuple uses
  provider/model/prompt/template literal `none`, empty generation parameters and
  `syntheticOnly: true`. There is no production engine/prompt/model/provider version change.
- **Evaluation/baseline:** N/A. No Golden, Regression, Rolling or Holdout dataset changed; no
  evaluation/comparison/pilot run ID or metric exists. A Golden baseline is N/A because the
  candidate is contract-only and has no production semantic effect.
- **Private evidence layout:** Future artifacts remain only under
  `suggestion/.local/evaluations/dayflow-ablation/`: temporary `staging/<sessionId>/`, then
  canonical `pins`, `command-receipts`, `readable-diffs`, `machine-evidence-bundles`,
  `human-review-receipts` and `contract-proposals` paths plus operational `state`.
  `contract-decisions` and `contract-freezes` are ineligible before their human gates.
  Directories are `0700`, files `0600`; immutable publication is no-follow, no-clobber,
  same-root atomic rename and byte/hash readback. No persistent unregistered evidence/report
  subtree is allowed.
- **Privacy and retention:** Only synthetic fixtures/source were used. No raw human
  conversation, screenshot, Dayflow blob, production data, credential or secret was read or
  emitted. Command receipt v0.1 persists raw-output length/hash, bounded sanitized text/hash and
  redaction metadata, not unsanitized output bytes. Readable diff v0.2 holds bounded UTF-8
  before/after source content and rejects private-secret material. Staging is reconciled within
  one hour. A pending evidence chain is private metadata retained at most 30 days from
  `sourcePinSet.createdAt`, with earlier abandonment/rejection/scope-revocation/rollback purge.
  If an approved current freeze references it, the complete chain follows append-only
  source/audit retention until terminal supersession/rollback, then is purged within 30 days.
  Git, backup, export, telemetry and public-report inclusion are forbidden. Live raw artifacts
  remain capped at 24 hours and normalized metadata follows the documented policy; none exists.
- **Human roles and artifact state:** `colin` is working owner/proposer and owner reviewer;
  `david` is the only schema-valid authenticated reviewer and future decision signer. Proposal
  v0.3 requires an `independentHumanReviewReceiptRef` resolving through the trusted channel to
  David's v0.2 receipt with `decision: confirmed`. Decision v0.3 has exactly one literal
  `approverPseudonym: david` and repeats the same receipt ref. Colin's scope approval and owner
  confirmation are not a second contract vote. No source-pin set, command receipt, readable
  diff, machine bundle, David receipt, proposal, decision, approval or freeze was emitted.
- **Deferred fail-closed boundaries:** DFA-003 still owns the trusted external Dayflow pin/export
  implementation; DFA-007 still owns authoritative current/historical-as-of resolution,
  immutable attestation storage/read/purge and deletion-receipt lifecycle. Missing, stale,
  unresolved, corrupt or hash-mismatched authority fails closed. No live/runtime/production/
  store/CLI/screen integration was added.
- **Release decision:** Do not execute or release. `H-DFA-CONTRACT` is pending; DFA-002 remains
  pending and DFA-003+ remain deferred/blocked by their documented gates.
- **Rollback:** Revert only the exact ten current candidate files and these additive
  recordkeeping changes within the approved scope. No production migration, live data, provider
  state, dataset or frozen authority exists.
- **Next human-gated evidence assembly:** After these final docs are stable, create/read back the
  exact source-pin set, capture the four authoritative commands as new v0.1 receipts, publish/read
  back the reconstructed full-content diff v0.2 and machine bundle v0.2, then obtain David's
  authenticated `confirmed` human-review receipt v0.2. Only then may Colin publish/read back and
  submit proposal v0.3. Machine status remains `pending` until that submission; David may then
  record the single v0.3 `approved | rejected` decision. Only `approved` permits a byte-identical
  36-row freeze v0.3. Any source/input/result/review byte change restarts this chain.
<!-- engine-change-record-section:ECR-DFA-002-CONTRACT-CANDIDATE-V0.3-2026-08-18:end -->

<!-- engine-change-record-section:ECR-DFA-002-CONTRACT-CANDIDATE-V0.4-REAL-BASE-2026-08-18:begin -->
## Engine Change Record Addendum — DFA-002 corrected real-base v0.4 candidate

- **Record ID:** `ECR-DFA-002-CONTRACT-CANDIDATE-V0.4-REAL-BASE-2026-08-18`.
- **Parent records:** `ECR-DFA-002-CONTRACT-CANDIDATE-V0.3-2026-08-18` and
  `ECR-DFA-000-TRACKED-PATH-AMENDMENT-DFA002-CONFIGS-2026-08-18`. This additive correction
  preserves both records unchanged. It supersedes the v0.3 record's current-candidate hashes,
  73/73 result, v0.3 proposal/decision/freeze tuple, v0.2 diff/machine/human tuple, base-diff
  interpretation, artifact-state statement and matching rollback/assembly instructions wherever
  they conflict with this record.
- **Date/status:** 2026-08-18 KST; closed machine status `DFA-002 pending`. The corrected
  contract-only implementation candidate, automated checks, compatibility checks and external QA
  passed. Proposal assembly remains pending. Status may become `in_review` only after a new
  schema-valid proposal is published, read back and submitted for H-DFA review. DFA-002 is not
  approved, frozen, executable, completed, live-enabled, production-enabled or released.
- **Scope:** The exact 15-path DFA-000 allowlist remains unchanged, including only Colin's two
  approved configuration-path additions. No broader tracked-path, runtime, store, CLI, screen,
  live, Dayflow-write, provider/network, production, pilot, E2 or release authority is added.

### Corrected current ten-file manifest

SHA-256 values are over exact raw file bytes. Byte lengths are canonical decimal counts.

| Role | Repository-relative path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| fixture | `suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.1.json` | 24879 | `aa4958de3255785125bdc20c6982b10074c0242bfa67644498c87560339de951` |
| config | `suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.1.json` | 9469 | `d1edd75b7749153a0f141bdbde970f819bbaedebadd62b93c26c2a4558e2513f` |
| source | `suggestion/src/dayflowEvidence/contracts.ts` | 74843 | `ede9e8c92041d7f664dcd4f3715a705a93649073e4a044927dbd7e8ddd13a915` |
| source | `suggestion/src/evaluation/dayflowAblation/buildDataset.ts` | 21256 | `28ecdc71e2a0d8b79806b0bc6994558c9f3218d184d8b172f092628d09ba5ab4` |
| source | `suggestion/src/evaluation/dayflowAblation/contracts.ts` | 300715 | `44ccf96590342fe849e2c66345857793d70db7406c1eb8bd778e42abd3e5836d` |
| test | `suggestion/tests/dayflowAblationEvaluation.test.ts` | 238331 | `e1d18d2551373398b0b1627700bf46fe748388e5005b46f0a2f9133ea271547f` |
| test | `suggestion/tests/dayflowEvidenceContracts.test.ts` | 48840 | `3114f71398400d1c0dbd2fe3cc8acb8cfc320b7af7ecb49bc4f27a3945f3331a` |
| test | `suggestion/tests/dayflowEvidenceExtraction.test.ts` | 8816 | `92a31f1b9b805374f123a6a579a35053c63815941fb1a79bd48ba042731cde36` |
| config | `suggestion/tsconfig.dayflow-dfa002.json` | 671 | `61fb4436fb370febcb1f829f7d483430092228fd0d030c06828e8559ffba8693` |
| config | `suggestion/vitest.dayflow-dfa002.config.ts` | 396 | `13a55619cdd259acf0199f4dceb74476aede2792bb6686309a5042b5cde893cc` |

The exact command-defining input inventory remains the ten ordered paths in
`DFA002_COMMAND_DEFINING_INPUTS`; overlap with candidate paths must repeat identical byte
metadata and `unexpectedTrackedPaths` is exactly empty.

### Real-base correction and current schema tuple

- **Fixed base:** Blabase revision
  `92b2ca94fc3e8347261ac6a85a627c8e6c915400` authoritatively contains none of the exact ten
  candidate paths. `DFA002_BASE_ABSENT_SOURCE_PATHS` exactly equals the ordered candidate-path
  inventory. A trusted base resolver must return `{ state: absent }` for every path; present,
  missing/unparseable, throwing, wrong-revision or filesystem-inferred resolution fails closed.
- **Only valid readable diff:** Readable diff v0.3 contains exactly ten sorted `add` operations,
  each with `before: null` and full exact current UTF-8 `after` content. It contains zero
  `modify` and zero `delete` operations. Colin's two-path scope amendment changes only which
  tracked paths are authorized; it does not imply that only two paths are additions relative to
  the fixed base.
- **Registry:** The complete canonical inventory remains 36 standalone rows in
  [`contracts.ts`](../src/evaluation/dayflowAblation/contracts.ts). The current changed rows are:

| Artifact | Schema version | Hash domain | Detached hash field |
| --- | --- | --- | --- |
| Contract proposal | `dayflow-dfa-contract-freeze-proposal-v0.4` | `blabase.dayflow-dfa.contract-freeze-proposal.v0.4` | `contractFreezeProposalSha256` |
| Contract decision | `dayflow-dfa-contract-decision-v0.4` | `blabase.dayflow-dfa.contract-decision.v0.4` | `contractDecisionSha256` |
| Contract freeze | `dayflow-dfa-contract-freeze-v0.4` | `blabase.dayflow-dfa.contract-freeze.v0.4` | `contractFreezeSha256` |
| DFA command receipt | `dayflow-dfa-command-receipt-v0.1` | `blabase.dayflow-dfa.command-receipt.v0.1` | `commandReceiptSha256` |
| DFA readable diff | `dayflow-dfa-readable-diff-v0.3` | `blabase.dayflow-dfa.readable-diff.v0.3` | `readableDiffSha256` |
| DFA machine evidence | `dayflow-dfa-machine-evidence-bundle-v0.3` | `blabase.dayflow-dfa.machine-evidence-bundle.v0.3` | `machineEvidenceBundleSha256` |
| DFA human review | `dayflow-dfa-human-review-receipt-v0.3` | `blabase.dayflow-dfa.human-review-receipt.v0.3` | `humanReviewReceiptSha256` |

### Validation, stale evidence and artifact state

- **Authoritative scoped commands:** `dfa002-depcruise` with dependency-cruiser 18.2.0 passed
  over 6 modules/9 dependencies; explicit `dfa002-eslint` with ESLint 9.39.5 passed;
  `dfa002-tsc` with TypeScript 5.9.3 passed; and `dfa002-vitest` with Vitest 3.2.7 passed
  3 files/75 tests. These current successful results are technical evidence, not newly emitted
  immutable command-receipt instances.
- **Full compatibility checks:** Full suggestion typecheck PASS; full suggestion lint PASS; root
  `arch:deps:check` exited 0 with 0 errors and existing warnings: repository 12, suggestion 8,
  scripts 2. No required failure or omission was waived.
- **External review:** External QA PASS on the corrected real-base candidate. It is not David's
  authenticated human-review receipt and is not H-DFA-CONTRACT approval.
- **Stale/abandoned source pin:**
  `dfa002.source-pin.936ddf31a62727536ff2b01e24f46695`, validation-input-set hash
  `622f5525e5bf167b3f6b3b6046762b784af80fdde11ed2915322cf1426fe85f4`, source-pin
  `createdAt: 2026-08-18T04:26:10.791Z`.
- **Stale/abandoned command receipts:**
  - `dfa002.receipt.dfa002-depcruise.4d7334bf80994292d38ed638a812ccfb`
  - `dfa002.receipt.dfa002-eslint.c2d1862b99b5eae98e9b918cfd13de6f`
  - `dfa002.receipt.dfa002-tsc.5062dce85b75e9b1e4e871236343d567`
  - `dfa002.receipt.dfa002-vitest.b62241f69b04682e2bc3d4092e93f793`
- **Authority rule:** Those five pre-correction private artifacts are stale and abandoned. They
  never became proposal authority, must not be referenced or relabeled as current, and remain
  pending safe purge/replacement. A replacement uses fresh no-clobber IDs and the current exact
  validation-input set; immutable stale bytes are never edited in place.
- **No downstream artifacts:** No readable diff v0.3, machine-evidence bundle v0.3, David
  human-review receipt v0.3, proposal v0.4, decision v0.4, approval or freeze v0.4 exists. No
  current replacement source pin or command receipt exists. The earlier ECR statement that no
  source pin or receipt had been emitted is corrected only by this additive record.

### Privacy, human gate, rollback and follow-up

- **Privacy/retention:** The stale pin and receipts are private source/code governance metadata;
  they contain no raw human conversation, screenshot or Dayflow blob and remain excluded from
  Git, backup, export, telemetry and public reports. The abandonment trigger has fired. They stay
  quarantined only through safe reconciliation/replacement and never beyond the pending-chain
  maximum of 30 days from the stale source pin's `createdAt`; absent an earlier safe purge, the
  absolute cap is `2026-09-17T04:26:10.791Z`. New artifacts use
  `0700` directories, `0600` files, no-follow/no-clobber same-root atomic publication and
  byte/hash readback. Live raw data remains capped at 24 hours; normalized metadata follows the
  documented policy; neither exists here.
- **Evaluation/baseline:** N/A. No Golden, Regression, Rolling or Holdout dataset changed; no
  evaluation, comparison, pilot run or metric exists. The change is contract-only and has no
  production semantic effect.
- **Human roles:** `colin` remains working owner/proposer and owner reviewer. `david` remains the
  only schema-valid authenticated independent reviewer and future decision signer. Proposal
  v0.4 must bind David's `confirmed` v0.3 receipt; decision v0.4 has the single literal approver
  `david` and binds that same receipt. This is not a 2-of-2 rule. No human confirmation or
  approval exists.
- **Deferred fail-closed boundaries:** DFA-003 still owns the trusted real-base/current-candidate
  resolver implementation plus the external Dayflow pin/export boundary. DFA-007 still owns
  authoritative current/historical-as-of authority resolution and immutable attestation
  store/read/purge/deletion-receipt lifecycle. Missing, present-at-the-fixed-base, stale,
  unresolved, corrupt or hash-mismatched authority fails closed. No live/runtime/production/
  store/CLI/screen integration was added.
- **Rollback:** Revert only the exact ten corrected candidate files and these additive
  recordkeeping changes within the approved scope, and safely purge the five abandoned private
  artifacts through the documented retention/reconciliation path. No production migration,
  live data, provider state, dataset or frozen authority exists.
- **Next human-gated evidence assembly:** After final docs stabilize, publish/read back a fresh
  source pin for the corrected bytes and fixed base, run/capture the four authoritative commands
  as fresh v0.1 receipts, reconstruct/publish/read back the exact ten-add diff v0.3 and machine
  bundle v0.3, then obtain David's authenticated `confirmed` human-review receipt v0.3. Only then
  may Colin publish/read back and submit proposal v0.4. Machine status remains `pending` until
  submission; David may then record one v0.4 `approved | rejected` decision. Only `approved`
  permits a byte-identical 36-row freeze v0.4. Any source/input/result/review byte change restarts
  the chain.
<!-- engine-change-record-section:ECR-DFA-002-CONTRACT-CANDIDATE-V0.4-REAL-BASE-2026-08-18:end -->

<!-- engine-change-record-section:ECR-DFA-002A-LOCAL-GOVERNANCE-SCOPE-SEQUENCING-2026-08-18:begin -->
## Engine Change Record Addendum — DFA-002A local governance scope and sequencing

- **Record ID:** `ECR-DFA-002A-LOCAL-GOVERNANCE-SCOPE-SEQUENCING-2026-08-18`.
- **Parent records:** `ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`,
  `ECR-DFA-000-TRACKED-PATH-AMENDMENT-DFA002-CONFIGS-2026-08-18`, and
  `ECR-DFA-002-CONTRACT-CANDIDATE-V0.4-REAL-BASE-2026-08-18`. This is additive and does not
  rewrite the earlier scope, evidence, hashes or historical artifact statements.
- **Human decision:** Immediately after receiving the full bounded DFA-002A recommendation,
  `colin` instructed `다음 작업 진행해`. In that context this is Colin's explicit approval of
  exactly the package recorded below. It is implementation scope/sequencing approval only, not
  H-DFA-CONTRACT, human review, proposal approval, decision, freeze, live or release authority.
- **Date/status:** 2026-08-18 KST. Closed machine task `DFA-002` remains `pending`. Nested
  work-package `DFA-002A` is `in_progress`, meaning its bounded implementation is authorized but
  no completion, test, hash or publication result is claimed. DFA-002A is not a new value in the
  closed `DFA-000..016` machine task enum.

### Exact tracked scope and approved capabilities

- **Tracked-path additions:** The prior 15 DFA-002 source/config/fixture/test/tool paths become
  17 by adding exactly:
  - `suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts`
  - `suggestion/tests/dayflowGovernanceAdapters.test.ts`
- **Candidate/input effect:** Once implemented, the two paths become exact candidate entries,
  expanding the next candidate validation set from 10 to 12. The command-defining input set
  remains exactly 10. This decision records no bytes, byte lengths, hashes, diff operations,
  tool output or test result for the new paths.
- **Approved local Git capability:** Bounded read-only acquisition from the local Blabase Git
  object database for fixed-revision governance verification. Network access, fetch, checkout,
  index/worktree mutation, ref mutation and repository writes are outside scope.
- **Approved private-read capability:** Hardened contained/no-follow reads of registered
  governance artifacts below `suggestion/.local/evaluations/dayflow-ablation`. This does not
  authorize arbitrary `.local` traversal or raw conversation, screenshot, Dayflow blob, secret
  or credential access.
- **Approved proposal-governance capability:** Proposal history resolution, current-head and
  currentness validation, and compare-and-swap fencing for the DFA-002 proposal chain.
- **Approved publisher capability:** Proposal-only hard-link atomic no-clobber publication with
  destination-absent checks and byte/hash readback. It may publish only already schema-valid
  proposal bytes; it cannot construct approval, decision or freeze authority.

### Explicit exclusions and ownership

- **Excluded:** Any Dayflow repository/source access, Dayflow runtime or Swift execution; human
  signing, authentication or trusted-channel issuing; decision/freeze creation; live authority;
  routes, CLI, production integration, provider/network calls, deployment or release.
- **DFA-002A ownership before DFA-002 exit:** Local fixed-base/current-candidate acquisition,
  hardened private governance reads, proposal history/currentness/CAS, and proposal-only
  publication. This removes the prior gate cycle in which a local resolver needed for DFA-002
  exit was deferred behind DFA-003.
- **DFA-003 ownership unchanged:** External Dayflow repository pinning, cross-repository scope,
  Swift exporter/capture-policy work and the Dayflow export boundary remain deferred until
  DFA-002 plus strict H-CROSS-REPO.
- **DFA-007 ownership unchanged:** Live/historical authority, revocation/currentness for live
  governance, immutable pilot-attestation storage/read/purge, retention and deletion-receipt
  lifecycle remain deferred and fail closed.

### Evidence invalidation, sequencing and gates

- **Stale machine evidence:** The machine-evidence bundle that was current immediately before
  this two-file candidate expansion is now stale and abandoned for proposal use. Its exact
  identity/hashes are not invented or inferred in this scope decision. It and any dependent
  ten-candidate validation chain must not be submitted to David or referenced by a proposal.
- **Required replacement:** After the two paths are implemented and independently validated,
  regenerate a fresh exact 12-candidate/10-command-input source pin, four command receipts,
  readable diff and machine-evidence bundle. Record exact bytes, hashes, tool versions, commands,
  timestamps and results only from that future run.
- **Human order:** David's authenticated review occurs only after the fresh 12/10 machine bundle
  resolves and is read back unchanged. Colin may publish/submit a proposal only after David's
  confirmed receipt exists. This scope decision creates neither artifact.
- **Current artifact/authority state:** No DFA-002A implementation result, new source pin,
  replacement receipt/diff/bundle, David receipt, proposal, H-DFA-CONTRACT decision, approval or
  freeze is claimed or created by this record. DFA-002 remains pending and DFA-003+ remain gated.

### Privacy, validation, rollback and follow-up

- **Privacy/data impact:** Approved reads are local source/governance metadata only. Raw human
  conversation, screen frames and Dayflow blobs remain forbidden. Private governance artifacts
  stay under ignored `.local`, use the documented `0700`/`0600`, no-follow/no-clobber policy,
  remain excluded from Git/backup/export/telemetry, and follow pending-chain abandonment/purge
  retention. The stale bundle is never relabeled current.
- **Evaluation/baseline:** N/A for this scope/sequencing decision. It changes no production
  engine semantics, Golden/Regression/Rolling/Holdout dataset, evaluation run or metric.
- **Validation not yet claimed:** No implementation tests, typecheck, lint, dependency check,
  source hash, artifact publication or external QA result is recorded for DFA-002A. Its future
  closure must report the exact two-file manifest, targeted adversarial tests, relevant full
  compatibility checks and independent QA.
- **Rollback:** Remove only the exact two new paths if created, revert this additive scope from
  the active plan through a new human-reviewed decision, restore the preceding 15-path boundary,
  and abandon/purge any private 12/10 evidence assembled from the removed bytes. Never mutate a
  published immutable artifact, Git object, Dayflow repository, production state or human record.
- **Next step:** Implement and validate only the exact two approved paths, then record their
  exact bytes/results and regenerate the fresh 12/10 evidence chain. Stop before David review or
  proposal publication if any capability escapes this record or any required check fails.
<!-- engine-change-record-section:ECR-DFA-002A-LOCAL-GOVERNANCE-SCOPE-SEQUENCING-2026-08-18:end -->
<!-- engine-change-record-section:ECR-DFA-002A-LOCAL-GOVERNANCE-IMPLEMENTED-2026-08-18:begin -->

## Engine Change Record Addendum - DFA-002A local governance implemented

- **Record ID:** `ECR-DFA-002A-LOCAL-GOVERNANCE-IMPLEMENTED-2026-08-18`.
- **Parent records:** `ECR-DFA-002A-LOCAL-GOVERNANCE-SCOPE-SEQUENCING-2026-08-18` and
  `ECR-DFA-002-CONTRACT-CANDIDATE-V0.4-REAL-BASE-2026-08-18`. This addendum supersedes only
  those records' DFA-002A `in_progress`, ten-candidate current manifest, 75-test result and
  no-implementation statements. Historical facts and approval boundaries remain preserved.
- **Date/owner:** 2026-08-18 KST; `colin`.
- **Status:** Nested work package `DFA-002A` is implemented, validated and `completed`.
  Closed parent machine task `DFA-002` remains `pending`; it is not in review, approved, frozen,
  executable, live-enabled, production-enabled or released.
- **Approved scope used:** Only the previously approved local fixed-base/current-candidate
  acquisition, hardened private governance reads, proposal history/currentness/CAS and
  proposal-only publication capabilities were implemented. No scope approval was expanded.
- **Versions:** The 36-row registry and wire contracts remain unchanged: command receipt v0.1;
  readable diff, machine evidence and human review v0.3; proposal, decision and freeze v0.4.

### Exact current 12-file candidate manifest

SHA-256 values are over exact raw bytes. Byte lengths are canonical decimal counts.

| Role | Repository-relative path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| fixture | `suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.1.json` | 24879 | `aa4958de3255785125bdc20c6982b10074c0242bfa67644498c87560339de951` |
| config | `suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.1.json` | 9469 | `d1edd75b7749153a0f141bdbde970f819bbaedebadd62b93c26c2a4558e2513f` |
| source | `suggestion/src/dayflowEvidence/contracts.ts` | 74843 | `ede9e8c92041d7f664dcd4f3715a705a93649073e4a044927dbd7e8ddd13a915` |
| source | `suggestion/src/evaluation/dayflowAblation/buildDataset.ts` | 21256 | `28ecdc71e2a0d8b79806b0bc6994558c9f3218d184d8b172f092628d09ba5ab4` |
| source | `suggestion/src/evaluation/dayflowAblation/contracts.ts` | 302923 | `d15e9d07590d8a1e54a321b6e15b00a3df0d7c420fe21e9ed9f2e0ff4446dc32` |
| source | `suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts` | 78699 | `1a3aa31a4118a28a4754a32f7053687d8e303efc4c48b903a7ec8e022cf88a7c` |
| test | `suggestion/tests/dayflowAblationEvaluation.test.ts` | 239147 | `0ceb6e8b1fccd22a1239c7ff144b095f59d44522429de2b36b151daa85897c0b` |
| test | `suggestion/tests/dayflowEvidenceContracts.test.ts` | 48840 | `3114f71398400d1c0dbd2fe3cc8acb8cfc320b7af7ecb49bc4f27a3945f3331a` |
| test | `suggestion/tests/dayflowEvidenceExtraction.test.ts` | 8816 | `92a31f1b9b805374f123a6a579a35053c63815941fb1a79bd48ba042731cde36` |
| test | `suggestion/tests/dayflowGovernanceAdapters.test.ts` | 65607 | `c0276173b73eae6486b9d5a7fc33da6ba8fc39529d5758697b3ddd3f6b85455f` |
| config | `suggestion/tsconfig.dayflow-dfa002.json` | 778 | `2d9a201cc97bdd59edf876b1ede97905c0cded640fa7b2be73f6cd7fe308dbf5` |
| config | `suggestion/vitest.dayflow-dfa002.config.ts` | 445 | `d92a2bfc339fe5f9a6e32572955e9a699af407dced74ea01b01965ff1dea7049` |

### Exact 10-file command-defining inventory

| Repository-relative path | Bytes | SHA-256 |
| --- | ---: | --- |
| `dependency-cruiser.config.mjs` | 4689 | `f56ac2f65590be043b278050091ff04e067f60de704b6f2d2a03cbb97fa0decc` |
| `dependency-cruiser.suggestion.config.mjs` | 2297 | `4340eeea005e616d4fc16e044ff872e0e60b77e0577785fb32533b56e1f68e4b` |
| `package-lock.json` | 445336 | `48436085530c5aa8ae3a46eecee8f7a2fe0ac84a090787e8e8fb1fc479f46530` |
| `package.json` | 3157 | `8286786774f6ec457dc2651b961ba802ca129f39ef0659debcd7ce43c43ae148` |
| `suggestion/eslint.config.mjs` | 360 | `9e8c0be86a5a4c7ed084578719065ad0d0fcfed51549a5f81b7228a93677fd42` |
| `suggestion/package-lock.json` | 440695 | `5bcee5d14a7b4506d7a85c3cccc30979f8ab159edf75936066ec67ff013ffa5d` |
| `suggestion/package.json` | 3146 | `d44d318026ec8d8313fe507780858195a5883590ccd92123494b6c3423416033` |
| `suggestion/tsconfig.dayflow-dfa002.json` | 778 | `2d9a201cc97bdd59edf876b1ede97905c0cded640fa7b2be73f6cd7fe308dbf5` |
| `suggestion/tsconfig.json` | 639 | `1967571749a826889ce18a315adbb9d99880dc3d96eb93eff3f8860d96d4cd81` |
| `suggestion/vitest.dayflow-dfa002.config.ts` | 445 | `d92a2bfc339fe5f9a6e32572955e9a699af407dced74ea01b01965ff1dea7049` |

The two inventories overlap only at `suggestion/tsconfig.dayflow-dfa002.json` and
`suggestion/vitest.dayflow-dfa002.config.ts`; their byte metadata is identical. The union is
therefore exactly 20 distinct paths. `unexpectedTrackedPaths` remains exactly empty.

### Required 23-pin composition and circularity boundary

The next source pin must contain the exact ordered 23 shapes exported by the contract:

- 13 Blabase `authorized-output-baseline` file pins: `architecture/planned.c4`,
  `architecture/views.c4`, this ECR, and the ten non-tool-config candidate source/fixture/test
  paths represented in the 12-file table above.
- 4 Blabase `immutable-input` pins: this Plan, this Runbook, `suggestion/package-lock.json`, and
  the fixed Blabase repository revision `92b2ca94fc3e8347261ac6a85a627c8e6c915400`.
- 6 Dayflow `immutable-input` pins: `Package.resolved`, `ScreenRecorder.swift`,
  `StorageManager+Screenshots.swift`, `StorageManager.swift`,
  `docs/BLABASE_DAYFLOW_DATA_ARCHITECTURE.md`, and repository revision
  `df3c367edb7d405a78d1ae76edffe4ba366f57d7`.

The current ECR, Plan and Runbook SHA-256 values are intentionally not recorded here: this
addendum changes those bytes. They must be resolved from final readback into the next private
source pin. No future source-pin ID, timestamp, aggregate hash or document hash is invented, so
this record makes no circular current-hash claim.

### Implemented behavior and fail-closed boundaries

- Local Git resolution is fixed-revision, allowlisted and read-only with `GIT_NO_LAZY_FETCH=1`.
  Only authoritative tree traversal proves absence; missing, corrupt, unresolved or promisor
  objects, wrong revision and any fetch requirement fail closed.
- Hardened candidate and machine-evidence resolution verifies physical containment, ownership,
  mode, inode/link stability, registered path and exact canonical bytes rather than trusting a
  path string or parsed value alone.
- Prepublication validation coherently recaptures the whole candidate/input set, machine
  evidence, proposal history/CAS head, canonical stored source-pin artifact, every referenced
  local pin and external fact. Any drift invalidates the entire attempt; results from different
  snapshots cannot be combined.
- Proposal history is deterministic, rejects graph ambiguity and enforces compare-and-swap
  currentness. The human-review channel remains an authenticated injected dependency; this code
  does not issue, sign or impersonate David's receipt.
- Proposal publication accepts only an already schema-valid, prepublication-verified proposal.
  It retains directory/file descriptors and invokes fixed root-owned/non-writable
  `/usr/bin/python3 -I -S` with a fixed environment and bounded execution to perform
  descriptor-relative `linkat`/`unlinkat`. No-clobber publication, directory fsync and exact
  byte/hash readback are mandatory.
- Pre-link failure, `EEXIST`, proven creation and ambiguous termination are distinct outcomes.
  Existing destination bytes are preserved. Ambiguous termination or unprovable rollback keeps
  the staged inode and authenticated lock for manual reconciliation and blocks automatic retry.
- The fixed `/usr/bin/python3` helper is an explicit host requirement and portability risk.
  Absence or failed root-owner/non-writable validation fails closed; there is no weaker fallback.
- No new production dependency, provider/network access, environment-secret behavior, Dayflow
  repository/runtime integration, live authority, route, CLI, human issuer, decision/freeze
  issuer, deployment or production wiring was added.

### Commands and recorded validation

All four authoritative commands ran from `suggestion/` under Node `22.23.2`.

```text
dfa002-depcruise: node ../node_modules/dependency-cruiser/bin/dependency-cruise.mjs --config ../dependency-cruiser.suggestion.config.mjs src/dayflowEvidence/contracts.ts src/evaluation/dayflowAblation/contracts.ts src/evaluation/dayflowAblation/buildDataset.ts src/evaluation/dayflowAblation/governanceAdapters.ts tests/dayflowEvidenceContracts.test.ts tests/dayflowEvidenceExtraction.test.ts tests/dayflowAblationEvaluation.test.ts tests/dayflowGovernanceAdapters.test.ts
dfa002-eslint: node node_modules/eslint/bin/eslint.js src/dayflowEvidence/contracts.ts src/evaluation/dayflowAblation/contracts.ts src/evaluation/dayflowAblation/buildDataset.ts src/evaluation/dayflowAblation/governanceAdapters.ts tests/dayflowEvidenceContracts.test.ts tests/dayflowEvidenceExtraction.test.ts tests/dayflowAblationEvaluation.test.ts tests/dayflowGovernanceAdapters.test.ts vitest.dayflow-dfa002.config.ts
dfa002-tsc: node node_modules/typescript/bin/tsc --noEmit --project tsconfig.dayflow-dfa002.json
dfa002-vitest: node node_modules/vitest/vitest.mjs run --config vitest.dayflow-dfa002.config.ts tests/dayflowEvidenceContracts.test.ts tests/dayflowEvidenceExtraction.test.ts tests/dayflowAblationEvaluation.test.ts tests/dayflowGovernanceAdapters.test.ts
```

- `dfa002-depcruise`, dependency-cruiser `18.2.0`: PASS, 8 modules/14 dependencies/0 violations.
- `dfa002-eslint`, ESLint `9.39.5`: PASS.
- `dfa002-tsc`, TypeScript `5.9.3`: PASS.
- `dfa002-vitest`, Vitest `3.2.7`: PASS, 4 files/93 tests.
- Full suggestion typecheck: PASS.
- Full suggestion lint: PASS.
- Root `arch:deps:check`: exit 0; existing warnings repository 12, suggestion 8, scripts 2.
- Independent current-head QA: Green; Medium-or-higher findings 0.

These outputs are implementation validation evidence only. No current immutable command-receipt
artifact was created by or for this record.

### Stale private chain and current authority state

The exact earlier ten-candidate seven-artifact chain is stale and abandoned because the approved
candidate closure and source/test bytes changed:

| Kind | Immutable artifact ID | Recorded raw/detached SHA-256 where available |
| --- | --- | --- |
| source pin | `dfa002.source-pin.83f77827fe7a36588b809aec2dc91e64` | `e568ae0b1ff24d37c9ab2d374b8ba05b75847ab8e6590e93ab860a0499900d31` / `fde5ba47d6863b8953542894909574601406b28a029979f00ce2e693cbcd5e3b` |
| command receipt | `dfa002.receipt.dfa002-depcruise.2fe93b1de563018664e8df21700fa585` | not relabeled current |
| command receipt | `dfa002.receipt.dfa002-eslint.7da5b371671a9b3bb76a390dfa2e8406` | not relabeled current |
| command receipt | `dfa002.receipt.dfa002-tsc.6b58d0e183f8b7b3c8aa06772f517f87` | not relabeled current |
| command receipt | `dfa002.receipt.dfa002-vitest.8d396978564ff2f9e02cbeddf7531d43` | not relabeled current |
| readable diff | `dfa002.readable-diff.9a7cd02648b4716472c13ccbd603bf1c` | `437f8531fbe0f95c3e64a6e438338cfbbb753464a69d5015c540cc364fbe8e9d` / `92f004b24105fd7fe4d6c3e6a23f8894c21fde01e538ecf792280ed03abbf345` |
| machine bundle | `dfa002.machine-evidence.def902c5f6527ce4205e710d42b41f49` | `81b1ab75b723d1d8070d97d0175116d4f333879d38797d006d2b300cb4caf6c1` / `f444987190a16aa0f5479b8d181ce8a65a9b5c9f5614484b71ead90267d40112` |

Those immutable private bytes remain untouched and excluded from Git, backup, export, telemetry
and public reports. They are pending safe reconciliation/purge and may never be edited,
relabelled current or submitted to David. No current 12-candidate source pin, command receipt,
readable diff, machine bundle, authenticated David receipt, proposal, decision, approval or
freeze exists.

### Evaluation, privacy, rollback and next gate

- **Evaluation/baseline:** N/A. This is governance-only local infrastructure; no production
  semantic behavior, Golden/Regression/Rolling/Holdout dataset, evaluation run or metric changed.
- **Privacy/retention:** Only local source and governance metadata is handled. Raw conversation,
  screenshot, Dayflow blob, credential and secret access remains forbidden. Private artifacts
  remain under ignored `.local` with the existing restrictive ownership/mode and retention rules.
- **Rollback:** Revert only the DFA-002A changes in `contracts.ts`, `governanceAdapters.ts`,
  `dayflowAblationEvaluation.test.ts`, `dayflowGovernanceAdapters.test.ts`, the dedicated tsconfig
  and Vitest config, plus this additive documentation through a new recorded decision. Reconcile
  private staged/locked state before removal; never mutate an immutable published artifact.
- **Next gate:** After final documentation readback, safely purge the exact stale chain, assemble
  and read back a fresh 12/10 source pin plus four receipts, a 12-add readable diff v0.3 and
  machine bundle v0.3. Then obtain David's authenticated confirmed receipt. Only then may Colin
  publish/read back and submit proposal v0.4. David remains the only future decision signer; only
  `approved` permits freeze. Colin's existing implementation-scope approval is unchanged and is
  not H-DFA-CONTRACT.

<!-- engine-change-record-section:ECR-DFA-002A-LOCAL-GOVERNANCE-IMPLEMENTED-2026-08-18:end -->
<!-- engine-change-record-section:ECR-DFA-002A-EXTERNAL-QA-HOLD-2026-08-18:begin -->

## Engine Change Record Addendum - DFA-002A external-QA HOLD

- **Record ID:** `ECR-DFA-002A-EXTERNAL-QA-HOLD-2026-08-18`.
- **Superseded claims:** This addendum supersedes only the preceding DFA-002A implementation
  record's `completed`, `validated`, independent current-head QA Green and Medium-or-higher zero
  claims. It does not erase the recorded implementation bytes, manifests or executed-check facts.
- **Corrected status:** Nested `DFA-002A` is `in_progress` / `HOLD` pending remediation and a new
  independent current-head QA result. Parent `DFA-002` remains `pending` and is not approved,
  frozen, executable, live-enabled, production-enabled or released.
- **Latest external QA authority:** The latest external independent review supersedes the earlier
  Green verdict and reports the following three unresolved boundaries:
  1. Post-final-capture/pre-link and post-link whole-set TOCTOU remains open.
  2. `draftEcrRef` is not resolved and verified during prepublication.
  3. Cleanup has stat/unlink link-count ambiguity, so an unlink outcome can be unprovable.
- **Evidence interpretation:** The four authoritative commands, 4 files/93 passing tests,
  dependency result, scoped/full typecheck and lint, and architecture dependency result remain
  technical evidence for the recorded bytes. They are not completion, human-review, proposal,
  approval, decision, freeze or release authority and do not waive these findings.
- **Required remediation gate:** Correct all three boundaries, update affected source/test bytes
  and manifests only after those changes exist, rerun the relevant validation, and obtain a new
  independent current-head QA verdict. Until then, do not assemble fresh evidence, request David
  review, publish a proposal or advance DFA-002.
- **Private artifact state:** The earlier ten-candidate seven-artifact chain remains stale and
  abandoned, byte-for-byte untouched and pending safe purge. No current source pin, receipt,
  diff, machine bundle, David receipt, proposal, decision or freeze exists.
- **Evaluation/baseline:** Still N/A. This status correction changes no dataset, production
  semantic behavior, evaluation run or metric.

<!-- engine-change-record-section:ECR-DFA-002A-EXTERNAL-QA-HOLD-2026-08-18:end -->
<!-- engine-change-record-section:ECR-DFA-002A-FINAL-EXTERNAL-QA-PASS-2026-08-18:begin -->

## Engine Change Record Addendum - DFA-002A final external-QA PASS

- **Record ID:** `ECR-DFA-002A-FINAL-EXTERNAL-QA-PASS-2026-08-18`.
- **Supersession:** This addendum supersedes the status and open-findings claims in
  `ECR-DFA-002A-EXTERNAL-QA-HOLD-2026-08-18`. It also supersedes the four changed-file byte/hash
  rows and 93-test count in the earlier implementation record. All other historical facts,
  scope boundaries and unchanged manifest rows remain preserved.
- **Final DFA-002A status:** Nested `DFA-002A` is `completed` / `validated`. Latest external
  independent current-head QA is PASS with zero Medium-or-higher findings. Parent `DFA-002`
  remains `pending`; no approval, freeze, execution, live, production or release authority is
  created.

### Exact remediated file bytes

SHA-256 values are over exact current raw bytes. These four rows replace their corresponding rows
in the prior 12-file manifest.

| Role | Repository-relative path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| source | `suggestion/src/evaluation/dayflowAblation/contracts.ts` | 305493 | `10039e0363fda8279a6b99d81a9fc95beda5ff07aca201c57cd79dcf669fd319` |
| source | `suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts` | 92887 | `033b24f9f929f60e21d0505e8990fcee9c25798cf2271721c096dd5baf04c1eb` |
| test | `suggestion/tests/dayflowAblationEvaluation.test.ts` | 245747 | `a97d21f80c13a74b6bbc4e321b7c39a288bc4b2b83ba092a27080a6fb926cfa1` |
| test | `suggestion/tests/dayflowGovernanceAdapters.test.ts` | 87075 | `f2d502275338c80b1e88a52846a9022a712d9588fc97b2e655331a8b96e09801` |

The other eight candidate rows retain exactly the byte lengths and SHA-256 values recorded in
`ECR-DFA-002A-LOCAL-GOVERNANCE-IMPLEMENTED-2026-08-18`. The exact 10-file command-defining
inventory is also unchanged. Candidate/input closure therefore remains 12/10 with 20 distinct
paths, and the required source-pin shape remains 23.

### HOLD finding closure

1. **Prepublication ECR resolution:** `draftEcrRef` is now resolved through a global fatal
   UTF-8 strict ECR marker parser. Invalid UTF-8, malformed/global marker ambiguity, missing
   target, duplicate target or content mismatch fails the whole attempt closed.
2. **Bounded helper seam:** The descriptor helper boundary is explicit and bounded, retains the
   established fixed-environment/execution limits, and has hostile/failure-path coverage.
3. **Whole-set and unlink safety:** Commit/post-link recapture and fencing plus the prior unlink
   cleanup fixes close the post-final-capture/pre/post-link TOCTOU and stat/unlink link-count
   ambiguity. Ambiguous outcomes still require manual reconciliation and never become success.

### Final validation interpretation

- `dfa002-depcruise`: PASS, dependency-cruiser `18.2.0`, 8 modules/14 dependencies/0 violations.
- `dfa002-eslint`: PASS, ESLint `9.39.5`.
- `dfa002-tsc`: PASS, TypeScript `5.9.3`.
- `dfa002-vitest`: PASS, Vitest `3.2.7`, 4 files/103 tests.
- Full suggestion typecheck: PASS.
- Full suggestion lint: PASS.
- Root `arch:deps:check`: exit 0; existing warnings repository 12, suggestion 8, scripts 2.
- Latest independent current-head QA: PASS; Medium-or-higher findings 0.

These are technical completion facts for DFA-002A only. They are not David's review,
H-DFA-CONTRACT, proposal approval, decision, freeze or release authority.

### Artifact state, circularity and next gate

- The exact earlier ten-candidate seven-artifact private chain remains stale/abandoned,
  byte-for-byte untouched and pending safe purge. It cannot be relabeled or submitted.
- No fresh 12-candidate source pin, command receipt, readable diff, machine bundle, authenticated
  David receipt, proposal, decision, approval or freeze exists.
- Current Plan, Runbook and ECR hashes are intentionally not claimed because this addendum changes
  those bytes. The next source pin must resolve their final readback bytes and all other ordered
  pins; no earlier document hash may be reused.
- After final documentation readback, follow the existing order: safely purge/reconcile the stale
  chain, assemble and read back fresh 12/10 machine evidence, obtain David's authenticated review,
  then publish/read back Colin's proposal. Parent `DFA-002` remains pending throughout until its
  documented human decision and freeze gates are actually satisfied.
- Evaluation/baseline remains N/A: no dataset, production semantic behavior, evaluation run or
  metric changed.

<!-- engine-change-record-section:ECR-DFA-002A-FINAL-EXTERNAL-QA-PASS-2026-08-18:end -->

<!-- engine-change-record-section:ECR-DFA-COLIN-ONLY-GOVERNANCE-SIMPLIFICATION-2026-08-19:begin -->

## Engine Change Record Addendum - DFA Colin-only governance simplification

- **Record ID:** `ECR-DFA-COLIN-ONLY-GOVERNANCE-SIMPLIFICATION-2026-08-19`.
- **Date/owner/approver:** 2026-08-19 KST; `colin`.
- **Human decision:** Colin clarified that he is the developer, experiment reviewer and final
  decision authority. David has no required workflow role and will only see results informally if
  Colin chooses. No David-specific artifact, authenticated receipt, review package, approval or
  decision is required.
- **Goal:** Replace the active David-bound DFA contract-governance workflow with the smallest
  reproducible Colin-owned A/B/C experiment workflow. Preserve historical records without using
  them as current execution authority.
- **Affected stages:** DFA planning/runbook governance and future experiment record assembly only.
  Production Attention, Continuation, Work Board, Launcher, action, monitoring, Dayflow capture,
  Golden/Regression/Rolling/Holdout datasets and release behavior are unchanged.
- **Behavior before:** Active Plan/Runbook text required an authenticated David human-review
  receipt, Colin proposal, David H-DFA-CONTRACT decision and immutable freeze. The associated
  source/test contracts include trusted human/decision channels and a complex evidence publisher.
- **Behavior after:** Colin alone freezes the experiment protocol/config/input, reviews blinded
  A/B/C outputs and records the final decision. The minimum evidence set is exactly:
  `experiment-manifest.json`, `run-results.json`, `comparison-report.md`, and
  `colin-decision.md`. Technical QA remains evidence, not decision authority.
- **Supersession:** This record supersedes every active instruction that requires David as
  reviewer, receipt issuer, signer or H-DFA-CONTRACT approver. Earlier ECR sections remain
  immutable historical evidence. Generic blind output review, technical QA, privacy review and
  later production/live safety approvals are not removed merely because their schemas contain a
  reviewer or approver field.
- **Implementation status:** Documentation authority is updated. Source and tests still contain
  the superseded human-review/proposal/decision/freeze contracts; removing or reducing them is a
  separate bounded Task. Until that Task completes, do not execute the regeneration/publisher or
  claim DFA-002 completion.
- **Versions:** No engine, dataset, public API, evaluation wire or production version changes in
  this documentation-only checkpoint.
- **Commands/checks:** No tests, typecheck, lint, build, Git command or private artifact operation
  was run. This checkpoint intentionally changes documentation only.
- **Evaluation/baseline:** N/A. No semantic output, input, filtering, ordering, interpretation,
  dataset or metric changed.
- **Privacy/retention:** The new workflow minimizes private governance data and removes unnecessary
  David-specific artifacts. Raw inputs/results remain ignored under `.local/`; committed documents
  contain only safe summaries. Existing stale private artifacts are retained unchanged for now.
- **Integrity policy:** SHA-256, exact version/command/input identifiers, restrictive local file
  modes and immutable/no-clobber writes are sufficient for Colin's inspection and reproducibility.
  A David-specific HMAC/receipt chain is not required.
- **Release decision:** No release, live collection, cross-repository write, production enablement
  or default-on decision is granted.
- **Rollback:** Preserve this additive record. A future reversal requires a new explicit Colin
  decision; do not rewrite historical ECR sections or silently revive the David-bound chain.
- **Follow-up work:** First simplify the source/test governance contracts. Then define and generate
  the four minimal Colin artifacts. Only after their successful readback may Colin separately
  decide whether to delete the exact stale seven-artifact chain.

<!-- engine-change-record-section:ECR-DFA-COLIN-ONLY-GOVERNANCE-SIMPLIFICATION-2026-08-19:end -->
<!-- engine-change-record-section:ECR-DFA-COLIN-S3-2B-COMPLETE-REMOVAL-2026-08-19:begin -->

## Engine Change Record Addendum - DFA Colin-only S3.2b complete removal

- **Record ID:** `ECR-DFA-COLIN-S3-2B-COMPLETE-REMOVAL-2026-08-19`.
- **Date/owner/decision authority:** 2026-08-19 KST; `colin`.
- **Status:** S1, S2, S3.1, S3.2a, S3.2b, S4 documentation alignment, and the separately approved
  S5 broader compatibility validation are complete. DFA experiment execution, live collection,
  production enablement, and release remain not started or unauthorized.
- **Decision:** Apply the complete-removal option. Retain no compatibility union, remove every
  active source-pin-set literal/contract and all orphan machine-evidence packages, and retain the
  existing private seven-file stale chain unchanged.

### Behavior and contract change

- Active authority now resolves through experiment-manifest v0.2.
- Source provenance is embedded in that manifest and is not a registered standalone artifact.
- Study protocol, evaluation execution freeze, and live collection freeze are v0.3 only.
- Artifact-layout config and registry hash domain are v0.2.
- Synthetic config/cases and fixture-generator/synthetic-cases hash domains are v0.2; the
  evidence-vector domain remains v0.1.
- The standalone `run-results` v0.1 contract was added. It binds terminal arm-run refs and exact
  protocol/manifest/freeze lineage without copying status, output, metrics, or private content.
- The registered standalone artifact inventory is exactly 30 classes.
- The following classes were removed with no compatibility union: `source-pin-set`,
  `dfa-command-receipt`, `dfa-readable-diff`, `dfa-machine-evidence-bundle`,
  `dfa-human-review-receipt`, `contract-freeze-proposal`, `dfa-contract-decision`, and
  `contract-freeze`.

### Files changed by S3.2b

- `suggestion/src/evaluation/dayflowAblation/contracts.ts`
- `suggestion/src/dayflowEvidence/contracts.ts`
- `suggestion/src/evaluation/dayflowAblation/buildDataset.ts`
- `suggestion/tests/dayflowAblationEvaluation.test.ts`
- `suggestion/tests/dayflowEvidenceContracts.test.ts`
- `suggestion/tests/dayflowEvidenceExtraction.test.ts`
- `suggestion/tsconfig.dayflow-dfa002.json`
- removed `suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.1.json`
- removed `suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.1.json`
- added `suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json`
- added `suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.2.json`

### Deterministic fixture hashes

- fixture-generator config: `17477ed54c32296f27bf9f3324b0c6ce673c09b6c964589a1fd2cb608f6f3f3e`
- export manifests: `9119fe0f10f987ea12fd814a8e074687107d8edb339fdc1325f9ecb82cdd37a9`,
  `7ee15e1147aa427723d88bcb9f7739457094aac4ff9adbf2f4bd55416e45b3a4`,
  `a21db1b131f929137261bb549ef2d7ef7ef7fe88b1c1e9b703c15e3490a8a232`
- evidence vectors: `0c3ecf4758edbc82be52e1f5522d3ccc4731add8c93f8f352550b1f628a13dff`,
  `b574e1689f7b190fa34ef0112a346eb5f88dd312045ff123d11548bcbb3f9639`,
  `9801991b632aa08a4b596fb8418ad6bba93c62ffdf17bd849e9f274c9d400bf1`
- matched A1/B arm inputs: `8646b50b582b4a4385714009792345bcb3f00c0c366e4eb8a3f8c5d1b9164f9d`,
  `7199dcd68b7c4308295794b4ed1b5b9c716f59ef10a489037a09ef157f87d02e`
- cases: `76dac78901f410caa001dc04621b3bbaf1d2ff69e98308557649588aa1a4f27f`

### Validation

- First focused run: 3 files, 67 passed and 1 failed because a test-only expected config ID still
  named v0.1.
- Mechanical correction: changed that single expected ID to
  `synthetic.dayflow.dfa002.config.v0.2`.
- Final focused Vitest: 3 files, 68 tests PASS.
- Scoped TypeScript: PASS.
- Scoped ESLint: PASS.
- Full Vitest: 162 files, 1,412 tests PASS.
- Full TypeScript: PASS.
- Full ESLint: PASS.
- Next.js production build: PASS.
- Architecture dependency checks: PASS with zero errors and the existing warning counts of 12
  repository, 8 suggestion, and 2 script warnings.
- The production build reported standard loading of `.env.local`. No value was inspected or
  printed. This non-hermetic build is compatibility evidence only, not DFA experiment evidence.
- No Git command, private-artifact inspection/mutation, provider/network call, or live-data
  operation was performed.

### Evaluation, privacy, compatibility, and rollback

- **Evaluation/baseline:** No production engine selection, filtering, ranking, UI interpretation,
  Golden/Regression/Rolling/Holdout dataset, model invocation, or metric changed. A production
  baseline rerun is not applicable to this contract/governance-only migration.
- **Privacy/retention:** No raw conversation, screenshot, credential, environment secret, live
  Dayflow data, or private evaluation payload was read or written. The existing private seven-file
  stale chain remains untouched and excluded from Git.
- **Compatibility:** Deliberately breaking within the not-yet-executed DFA contract surface. Old,
  mixed, and unknown serialized versions fail closed; no migration union exists.
- **Rollback:** Restore the removed contracts and v0.1 fixtures only through a new explicit Colin
  decision and successor ECR. Do not silently revive historical David authority or relabel the
  private stale chain.
- **Human approval needed next:** The broader validation gate is complete. Colin must separately
  approve the next experiment implementation/execution task. Later deletion of the private
  seven-file chain and any live experiment/capture task each require their own explicit decision.

<!-- engine-change-record-section:ECR-DFA-COLIN-S3-2B-COMPLETE-REMOVAL-2026-08-19:end -->

<!-- engine-change-record-section:ECR-DFA-COLIN-S6-SYNTHETIC-DRY-RUN-COMPLETED-2026-08-19:begin -->

## Engine Change Record Addendum - DFA Colin-only S6 synthetic dry-run completed

- **Record ID:** `ECR-DFA-COLIN-S6-SYNTHETIC-DRY-RUN-COMPLETED-2026-08-19`.
- **Date/owner/decision authority:** 2026-08-19 KST; `colin`.
- **Status:** S6.1 design map, S6.2a deterministic packaging, S6.2b two-stage artifact
  construction, S6.3 generic no-clobber publication/readback, and S6.4 additive documentation are
  complete and focused-green.
- **Decision:** Retain private storage as generic transport outside experiment provenance and keep
  the executable dry-run boundary Colin-only, synthetic, deterministic, and fail-closed.

### Implemented APIs and artifacts

The active S6 APIs are `buildDayflowAblationSyntheticDryRunPackage`,
`verifyDayflowAblationSyntheticDryRunDecisionBinding`,
`parseDayflowAblationSyntheticDryRunPackage`,
`buildDayflowAblationSyntheticExperimentManifest`,
`buildDayflowAblationSyntheticRunResults`,
`publishPrivateEvaluationArtifactSetNoClobber`, and
`verifyPrivateEvaluationArtifactSetReadback`.

The package contains exactly `experiment-manifest.json`, `run-results.json`,
`comparison-report.md`, and `colin-decision.md`. Both Markdown formats are deterministic internal
formats and are not registry classes. The standalone registry remains exactly 30. S6 changes no
schema, serialized version, dependency, public API, or production behavior.

Stage A derives the current experiment manifest v0.2 and typed ref from explicit current v0.2
config/cases bytes, exact source/provenance byte snapshots and facts, explicit tool facts, and an
explicit creation timestamp. Caller-supplied aggregate or detached hashes are not trusted. Stage B
requires the full sealed manifest, study protocol v0.3, evaluation execution freeze v0.3, and
terminal run v0.4 artifacts. It parses and verifies detached hashes and the complete
manifest-to-protocol-to-freeze-to-run lineage before sealing run-results v0.1; bare refs are
insufficient.

Package construction is pure and deterministic with no clock, random, filesystem, environment,
process, network, or provider capability. JSON uses canonical JCS UTF-8 plus one LF. Markdown uses
deterministic LF-only rendering. Timestamps and the Colin decision are explicit caller inputs. The
decision binds the comparison report's raw SHA-256 and byte length. The comparison states
`metricsStatus: not-computed`, and both human-readable outputs state that this is synthetic
contract packaging, unresolved real execution, and not a real experiment approval.

The generic private transport accepts only an explicit root and safe path components. It copies
and preflights all bytes, creates the unique run directory at mode `0700`, creates files at mode
`0600` with no-clobber/no-follow semantics, fsyncs, and verifies exact bytes, length, raw SHA-256,
ownership, type, link count, inode, and path stability. It returns only relative metadata. It does
not list, clean up, overwrite, resume, repair, infer an environment root, or access the existing
private seven. Mid-write partial state is preserved, the label remains unusable, and retry requires
a new label.

### Validation evidence

- S6.2a final: Vitest 1 file / 47 tests PASS; scoped TypeScript PASS; ESLint PASS.
- S6.2b final: Vitest 1 file / 51 tests PASS; scoped TypeScript PASS; ESLint PASS.
- S6.3 final: Vitest 2 files / 62 tests PASS; full TypeScript PASS; ESLint PASS.
- Intermediate failures were confined to tests or TypeScript fixture/tuple typing and were
  corrected without semantic or serialized-byte changes.

No broader full-suite result is claimed by this S6 record. No real `.local` artifact, actual Colin
decision, A/B/C metric, live capture, provider/network/environment read, Git operation, production
behavior, dataset run, or baseline run occurred. The existing private seven were untouched and
uninspected.

### Evaluation, privacy, rollback, and next gate

- **Evaluation/baseline:** N/A. S6 changes evaluation tooling, deterministic serialization, and
  private storage transport only; it does not change engine output, datasets, metrics, or
  production selection/interpretation.
- **Privacy/retention:** Publication is explicit and no-clobber. Partial sets are retained rather
  than silently repaired or deleted. Existing private immutable data is outside the transport
  operation and remains untouched.
- **Next Colin gate:** Real synthetic publication requires a new `runLabel`, explicit Colin
  decision input, and full sealed lineage artifacts. Deleting the private seven and starting live
  Dayflow are separate decisions and are not authorized here.
- **Rollback:** Remove only the S6 source/test additions through a successor record. Never rewrite
  this or earlier historical records, and never mutate historical/private immutable data as part
  of rollback.

<!-- engine-change-record-section:ECR-DFA-COLIN-S6-SYNTHETIC-DRY-RUN-COMPLETED-2026-08-19:end -->

<!-- engine-change-record-section:ECR-DFA-COLIN-E1-DETERMINISTIC-ARM-RUNNER-COMPLETED-2026-08-20:begin -->

## Engine Change Record Addendum - DFA E1 deterministic arm runner completed

- **Record ID:** `ECR-DFA-COLIN-E1-DETERMINISTIC-ARM-RUNNER-COMPLETED-2026-08-20`.
- **Date/owner/decision authority:** 2026-08-20 KST; `colin`.
- **Status:** E1.1 renderer/run policy, E1.2 pure deterministic A1/B/C implementation and
  integration, and E1.3 scoped validation/recordkeeping are complete. Scoped E1 is green.
- **Decision:** Adopt the deterministic local renderer and arm-run builder as the E1 engineering
  boundary. A0 remains outside the runner. Do not add provider, retry, I/O, publication, or live
  behavior.
- **Supersession:** This additive record supersedes active stale wording that requires provider
  execution, David review or approval, a David-bound contract freeze, an unimplemented
  run-results contract, or E1 creation of an evaluation execution freeze. Historical records are
  preserved. Existing evaluation execution freeze v0.3 is caller-resolved lineage, not an artifact
  created by E1, and David has no E1 role.
- **Affected stages:** Synthetic DFA evaluation rendering, deterministic arm-run serialization,
  resolved-execution test integration, and source/provenance/command closure only. Production
  Attention, Continuation, Work Board, Launcher, Dayflow capture, datasets, release, and product
  behavior remain unchanged.
- **Behavior before:** A1/B/C semantic rendering and truthful deterministic v0.4 arm-run creation
  were not implemented as a closed local E1 path.
- **Behavior after:** Strict verified inputs produce deterministic display-only A1/B/C semantic
  results and exactly one sealed terminal arm-run attempt. A1/B causality binds full receipts;
  C remains screen-only; A0 is rejected.

### Versions and compatibility

| Component | Frozen identity |
| --- | --- |
| deterministic runner | `dayflow-e1-deterministic-arm-runner-v0.1` |
| shared A1/B renderer | `dayflow-e1-ab-renderer-v0.1` |
| C renderer | `dayflow-e1-c-renderer-v0.1` |
| screen eligibility | `dayflow-e1-screen-eligibility-v0.1` |
| public-text guard | `dayflow-e1-public-text-guard-v0.1` |
| display presentation | `dayflow-e1-display-only-presentation-v0.1` |
| request preimage | `dayflow-e1-deterministic-request-v0.1` |
| request hash domain | `blabase.dayflow-e1.deterministic-request.v0.1` |

Existing arm input/run v0.4, semantic output v0.1, issuance receipt v0.1, and evaluation execution
freeze v0.3 contracts are reused. There is no schema, registry, config, cases, public API,
production dependency, or production version bump. Closure is 11 source entries, 22 provenance
pin shapes, four commands, and 30 registered artifact classes.

### Behavior, evidence, and deterministic accounting

A1 verifies a sealed Active Attention result and expected hash, preserves top-then-alternatives
order, emits title/explanation-derived public text only, and omits unsafe/overlong candidates.
B starts with those exact semantics and uses only the single-space template
`{A1 summary} 화면 맥락: {normalized screen summary} (화면 표시는 완료·검증 근거가 아닙니다.)`.
Only fully verified `RECENT_FOCUS` or `VISIBLE_TASK_INTENT` claims at >= 8000 basis points are
eligible. Invalid/unavailable/rejected/failure/valid-empty/low-confidence/no-context/unsafe input,
and expiry at `asOf >= expiresAt`, preserve exact A1 object/bytes/hash with sorted diagnostics.

C requires verified, non-conflicted eligible lineage for every title and summary, preserves item
order, and fails the whole output closed on one invalid item. Valid-empty yields `no_suggestion`;
invalid, rejected, expired, unavailable, and failure states yield one typed failure. Its blind
projection strips machine claim IDs.

The builder strictly reparses arm inputs, A1/B receipts, semantic outputs, and exact JCS+LF bytes;
verifies detached hashes and lineage; and derives the request SHA-256 internally over the entire
sealed input plus runner/renderer identity. Successful/no-output response SHA-256 is over the raw
semantic bytes. Attempts have explicit timestamps, derived latency, zero input/output tokens,
zero cost, no retry, and no provider generation ID. C failure has exactly one failure code and no
semantic/output/response. Renderer exceptions propagate rather than fabricating failed runs.

Verification status is fail-closed. Claim confidence is recorded by the normalized evidence and
must meet the 8000-basis-point threshold; conflicted paths are ineligible. B fallback and C failure
codes retain sorted typed diagnostics. No actual evidence capture, model response, experiment run,
latency observation, token consumption, cost, conflict correction, or metric was produced.

### Exact validated file identities

SHA-256 values are over the exact validated raw bytes before this documentation-only append.

| Role | Repository-relative path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| source | `suggestion/src/evaluation/dayflowAblation/runGeneration.ts` | 33122 | `301e5134d18391d1c5485722ceac50a75c96f7c70d327f7cadda571bdcc12d08` |
| source | `suggestion/src/evaluation/dayflowAblation/contracts.ts` | 242781 | `77bd9b5bf33f5c25f69450630d4d20ca01bba95929781f8170331715c3c473cd` |
| config | `suggestion/tsconfig.dayflow-dfa002.json` | 726 | `09a27ed04b2530f0887e9978dc3a3edb379e85ae141e87a2f9619776e25821cb` |
| test | `suggestion/tests/dayflowAblationEvaluation.test.ts` | 230514 | `7b07b741f4cd35d5f871cdd485ba5e400e79b412deb1a75f99863f737b2706c0` |

### Validation evidence and limitation

- Scoped dependency-cruiser: PASS; 115 modules, 443 dependencies, zero errors, eight existing
  warnings.
- Scoped ESLint: PASS.
- Scoped TypeScript: PASS.
- Scoped Vitest: PASS; 3 files / 90 tests.
- Full TypeScript: PASS.
- Full lint: PASS.
- Architecture checks: zero errors; existing warnings repository 12, suggestion 8, scripts 2.
- Full Vitest: 161/162 files and 1,437/1,438 tests completed. The sole failure was the existing
  5-second injected-clock timeout in `continuationEvaluation`, outside E1.
- Isolated `continuationEvaluation`: PASS; 1 file / 22 tests.

The full Vitest invocation is not claimed as PASS. The scoped E1 matrix is green, and the isolated
continuation result records the unrelated timeout limitation without converting it into E1
evidence.

### Evaluation, privacy, release, and rollback

- **Dataset/run/metrics/baseline:** N/A. No Golden, Regression, Rolling, Holdout, or production
  dataset changed; no actual dataset ID, run ID, comparison metric, baseline, or run-results
  artifact exists from E1.
- **Privacy/retention:** No raw OCR/normalized value, private identifier/ref/path/URL/hash,
  credential, Active action/target/source internals, `.local` data, or existing private artifact
  was read, written, published, or retained by this work.
- **Capability boundary:** No filesystem, environment, process, clock, random, network, provider,
  publication, live collection, private-store, or production operation is present. No artifact was
  created.
- **Git identity:** Not inspected. No Git operation was performed.
- **Release decision:** None. E1 does not authorize provider execution, real Dayflow capture,
  publication, live use, production behavior, or release.
- **Rollback:** Through a successor record, remove `runGeneration.ts`, its direct runner/renderer
  tests, and the related source-entry, provenance-pin, command-argv, and scoped-tsconfig closure
  additions. Never rewrite this historical record or mutate private immutable data.
- **Next Colin decision:** Decide whether to start `E2-IO`, limited to the Dayflow
  exporter/importer engineering checkpoint. This is explicitly not authorization for the earlier
  Plan Stage E2 candidate discovery or any execution/publication/live task.

<!-- engine-change-record-section:ECR-DFA-COLIN-E1-DETERMINISTIC-ARM-RUNNER-COMPLETED-2026-08-20:end -->


---

## Engine Change Record: ECR-E2-IO-2A-SYNTHETIC-BUNDLE-IMPORT-2026-08-20

- Date: 2026-08-20
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Goal: Complete the fail-closed synthetic Dayflow evidence-bundle transport
  importer and closed validation harness without live or semantic authority.
- Affected pipeline stages: Offline evaluation transport ingestion only;
  strict JSON, completion/manifest binding, exact object-set and digest
  validation, resource bounds, and replay descriptor creation.
- Behavior before: E2-IO.2A was not recorded as closed by focused validation and
  independent QA.
- Behavior after: Fatal/canonical JSON, completion/manifest binding, unordered
  exact entry bijection, 256-object/10-MiB-object/256-MiB-aggregate pre-copy
  limits, and a frozen primitive hash/count replay descriptor are implemented.
- Versions before: Not applicable; there was no shipped E2-IO.2A importer.
- Versions after: completion schema
  `dayflow-screen-evidence-bundle-completion-v0.1`; completion hash domain
  `blabase.dayflow-screen-evidence-bundle-completion.v0.1`; import schema
  `dayflow-screen-evidence-bundle-import-v0.1`; replay hash domain
  `blabase.dayflow-screen-evidence-bundle-replay.v0.1`.
- Code commit: Not recorded. Git identity was not inspected. The file manifest
  below records the exact implementation identity.
- Evaluation dataset version and SHA-256: Not applicable; synthetic in-memory
  fixtures only, with no frozen dataset change.
- Candidate run ID: Not applicable.
- Comparison run ID: Not applicable.
- Commands executed: From `suggestion/`,
  `node node_modules/typescript/bin/tsc -p tsconfig.dayflow-e2io.json --noEmit`;
  `node node_modules/eslint/bin/eslint.js src/evaluation/dayflowAblation/importEvidenceBundle.ts src/evaluation/dayflowAblation/strictDuplicateAwareJson.ts tests/dayflowEvidenceBundleImport.test.ts vitest.dayflow-e2io.config.ts`;
  `node node_modules/vitest/vitest.mjs run --config vitest.dayflow-e2io.config.ts`.
  From root: `npm run arch:deps:check`.
- Metrics changed: Not applicable. The 1-file, 10/10-test result is regression
  evidence, not a product-quality metric.
- Validation: Node `v22.23.2`; TypeScript `5.9.3` PASS; ESLint `9.39.5` PASS;
  Vitest `3.2.7` PASS; dependency-cruiser `18.2.0` PASS with 0 errors,
  pre-existing warnings repository 12/suggestion 8/scripts 2, and coverage 17
  entries/4 sentinel edges.
- Independent QA: Read-only PASS with no Critical/High/Medium finding; QA did
  not rerun tests.
- Regressions or accepted exceptions: No Medium-or-higher regression. Low
  residuals are SOI/EOI-only JPEG framing, chronology relying on canonical UTC,
  and missing exact-limit success/deep-JSON performance tests. The initial
  one-TypeScript/one-test HOLD is superseded diagnostic history after a narrow
  test-only correction and final 10/10 PASS.
- Privacy or retention impact: None. Synthetic in-memory only; no actual
  Dayflow/private conversation, `.local`, filesystem, network, environment,
  provider, production/publication, raw retention, or manual inspection.
- Model, provider, prompt, token, latency, confidence, evidence, conflict, and
  semantic metrics: Not applicable; no model or semantic execution occurred.
- Baseline decision: Targeted regression recorded. Production baseline is N/A
  because transport-only evaluation tooling does not change semantic output,
  selection, normalization, or production behavior.
- Release decision: E2-IO.2A is complete only for synthetic transport. No
  production release or E2-IO.2B/2.3/2.4, live, retention, exporter, normalized
  evidence, E1 B/C, provider, or publication authority is granted.
- Rollback method: A separately reviewed successor may remove only the five
  E2-IO.2A files below. No migration or data cleanup exists.
- Follow-up work: E2-IO.2B is recommended but not authorized; it requires a
  separate Colin decision.

### Exact implementation identity

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `suggestion/src/evaluation/dayflowAblation/importEvidenceBundle.ts` | `fcd904c09364b61a35b8573edf5fc7980d7c01b52eecfca8a7664beb144dac1e` | 15404 |
| `suggestion/src/evaluation/dayflowAblation/strictDuplicateAwareJson.ts` | `2f52948634b22d4eea0ba767ca7e39c9483449f0907a9e5c435d947a8a58532a` | 5355 |
| `suggestion/tests/dayflowEvidenceBundleImport.test.ts` | `d69e1f652eb36ba2ecaa58a1d4db2a9b532096614a56ddee959a5dcf35bc72bd` | 27354 |
| `suggestion/tsconfig.dayflow-e2io.json` | `a6dce1582de1b5abdad74e7d25f32d5e229138bfc8f14a00b79d2a3ddb56bc65` | 487 |
| `suggestion/vitest.dayflow-e2io.config.ts` | `88d698f44b1502bcb8ccab546bbe7f60532b3ea95a5c305bdb053b96be2dbea4` | 291 |

This record is additive and does not erase earlier plan, author-test, or QA
history.


---

<!-- engine-change-record-section:ECR-E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:begin -->

## Engine Change Record: ECR-E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20

- Date: 2026-08-20
- Owner, human reviewer, and decision authority: Colin
- Required David role, receipt, artifact, or approval: none
- Goal: Correct the active Dayflow/Blabase role authority before further E2 implementation.
- Affected stages: Documentation authority for Dayflow preprocessing, evidence adaptation, and
  A/B/C suggestion generation.
- Behavior before: Current E1 authority permitted B to append a Dayflow semantic summary after A1
  rendering and permitted C to return Dayflow suggestion-shaped semanticOutput through a separate
  renderer and screen_only_generation path.
- Behavior after: Dayflow is limited to capture, storage, OCR, privacy filtering, and neutral
  preprocessing. A/B/C must use one Blabase suggestion-engine entry point with identical model,
  prompt, configuration, ranking, guardrails, validation, post-processing, and output schema. Only
  the evidence set may differ.
- Arm definition: A uses structured evidence; B uses the exact A evidence plus Dayflow
  preprocessed evidence; C uses Dayflow preprocessed evidence only. A0 may remain an external
  compatibility reference.
- Supersession: The earlier E1 renderer implementation and validation records remain immutable
  historical evidence, but their B overlay, separate C renderer, suggestion-shaped normalized
  evidence, and generated results are not authorized for successor comparison, metrics, or freeze.
  Conflicting E2-IO.2B candidate text is superseded before implementation.
- Preserved work: E2-IO.2A transport integrity, manifest/hash/size and replay validation,
  provenance, consent, privacy, retention, deletion, and SQLite/WAL isolation remain valid.
- Versions changed: none. A future evidence-only contract requires a new version and must not
  rewrite historical contracts, fixtures, or hashes.
- Code, schema, fixture, dataset, model, prompt, configuration, or production behavior changed:
  none.
- Tests and checks: none executed; this was a documentation-only authority correction following a
  read-only code and document audit.
- Dataset, run IDs, metrics, latency, tokens, and baseline: not applicable. No evaluation or model
  run occurred, and semantic behavior did not change in this task.
- Privacy and retention impact: none. No private artifact, raw OCR, live capture, filesystem
  evidence bundle, environment, provider, network, or production data was accessed or changed.
- Release decision: none.
- Rollback: Add a successor record and remove only these four additive authority sections. Never
  rewrite historical E1 or E2-IO.2A records.
- Next Colin gate: decide whether to start E2-SCHEMA-1, limited to the new neutral
  Dayflow-preprocessed-evidence contract. That decision does not authorize engine implementation,
  fixture migration, validation, live capture, publication, or cleanup.

<!-- engine-change-record-section:ECR-E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:end -->


---

<!-- engine-change-record-section:ECR-E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:begin -->

## Engine Change Record: ECR-E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20

- Date: 2026-08-20
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Goal: Implement and close the strict synthetic-only neutral Dayflow preprocessed-evidence pure
  core before any bundle adapter or suggestion-engine integration.
- Affected pipeline stages: Isolated evaluation evidence schema validation, sealing,
  canonicalization, detached hashing, parsing, resource enforcement, and immutable result creation
  only.
- Behavior before: The reviewed neutral evidence contract existed, but there was no dedicated
  pure-core schema, sealer, serializer, parser, or synthetic validation closure.
- Behavior after: Strict synthetic neutral OCR evidence can be sealed to and parsed from JCS plus
  one LF with a domain-separated detached hash, exact E2-IO.2A transport fields, closed privacy and
  provenance shapes, resource limits, strict duplicate handling, and deeply frozen results.
  Suggestion-shaped fields and the legacy normalized-evidence shape fail closed.
- Versions before: Not applicable; this is a new sibling contract with no compatibility union.
- Versions after: schema `dayflow-preprocessed-evidence-v0.1`; verifier
  `dayflow-preprocessed-evidence-verifier-v0.1`; detached-hash domain
  `blabase.dayflow-preprocessed-evidence.v0.1`; bound transport import schema
  `dayflow-screen-evidence-bundle-import-v0.1`.
- Code commit: Not recorded. Git identity was not inspected. The exact file identities below bind
  the implementation validated before this documentation-only append.
- Evaluation dataset version and SHA-256: Not applicable. Only fictional synthetic fixtures were
  used; no frozen dataset changed.
- Candidate run ID: Not applicable; no engine or model run occurred.
- Comparison run ID: Not applicable; no engine or model comparison occurred.
- Commands executed: Dedicated schema Vitest config; dedicated schema TypeScript config; targeted
  schema ESLint; E2 importer regression; DFA regression; full suggestion TypeScript; full
  suggestion lint; and root architecture dependency check. Exact command argv was not captured in
  this documentation checkpoint, so this record does not fabricate it.
- Metrics changed: Not applicable. The 29/29 focused result and five-file/129-test compatibility
  result are engineering regression evidence, not product suggestion-quality metrics.
- Regressions or accepted exceptions: Final focused and compatibility checks passed. Independent
  read-only QA passed for final F2a, F2b.1, and F2c.1 with no Medium-or-higher finding in each
  scope. Remaining Low risks are suffix-based numeric-scanner allocation bounded by 512 KiB and
  optional hostile `byteOffset`/`constructor`, exact-subview, and grammar-parity tests.
- Privacy or retention impact: None. The contract is synthetic-only. No real screenshot, OCR,
  conversation, `.local`, private artifact, filesystem bundle, live input, or production data was
  created or inspected by implementation or validation.
- Release decision: `E2-SCHEMA-2A` is implemented, validated, and automated-QA-reviewed only for
  the isolated synthetic pure core. This is not production release, live-data authorization, or a
  human approval inferred from automated QA.
- Rollback method: Add a successor record and remove only the four implementation files listed
  below. No dataset migration, private-data cleanup, or historical-record rewrite is required.
- Follow-up work: `E2-SCHEMA-2B` importer adapter, owned bundle snapshot, and fresh bundle
  re-verification remain pending and not authorized. The common evidence adapter, same Blabase
  engine run generation, live data, and A/B/C execution also remain pending and require separate
  Colin decisions.

### Exact implementation identity

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `suggestion/src/dayflowEvidence/preprocessedEvidenceV0_1.ts` | `b7e375e56f1bdee1c7b6ce1a7565165e768f95029728b332a1ced501d71b1e98` | 35330 |
| `suggestion/tests/dayflowPreprocessedEvidenceV0_1.test.ts` | `67bb0151f6d62f6e649db4094a1d564cc546169b6488bafd91c113f3c95a1b8e` | 21006 |
| `suggestion/tsconfig.dayflow-e2schema.json` | `06da2615887e5d0fb843a6fac742fda5c8a0adffa17a38738efc964e1a5ddadc` | 423 |
| `suggestion/vitest.dayflow-e2schema.config.ts` | `6b2e62ad985510ccbd18fb890acb1fdbdeff0902372c597ad4401a69e1d8f449` | 295 |

### Validation and applicability

- Focused: dedicated Vitest PASS 29/29; dedicated TypeScript PASS; targeted ESLint PASS.
- Compatibility: E2 importer PASS 10/10; DFA regression PASS 90/90; five files and 129 tests total;
  full suggestion TypeScript PASS; full suggestion lint PASS.
- Architecture dependency: PASS with zero errors. Existing warnings remain repository 12,
  suggestion 8, and scripts 2.
- Baseline/Golden: N/A. This isolated unconnected core changes no runtime engine input, output,
  filtering, ordering, ranking, model, prompt, or configuration.
- Component boundary: Dayflow remains capture, storage, OCR, privacy filtering, and neutral
  preprocessing only. A/B/C still require one future Blabase suggestion-engine path with the same
  model, prompt, configuration, ranking, guardrails, validation, post-processing, and output schema.

This record is additive and does not erase the E2-SCHEMA-1 contract-review history, E2-IO.2A
transport record, E1 diagnostic history, or the E2-ROLE-1 authority correction.

<!-- engine-change-record-section:ECR-E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:end -->


---

<!-- engine-change-record-section:ECR-E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:begin -->

## Engine Change Record: ECR-E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21

- Date: 2026-08-21
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Goal: Establish an owned, bounded, synthetic-only snapshot before parsing or resolving neutral
  Dayflow evidence against its source bundle.
- Affected pipeline stages: Evaluation-only input projection, bundle/candidate byte ownership,
  E2-IO.2A transport reimport, and exact imported-descriptor binding.
- Behavior before: E2-SCHEMA-2A could strictly seal and parse candidate evidence bytes, but no
  capability-free boundary atomically owned caller candidate bytes, bundle entries, and the
  expected seven-field transport descriptor before later verification.
- Behavior after: Version `dayflow-preprocessed-evidence-verification-snapshot-v0.1` projects a
  bounded exact enumerable data shape, rejects proxies/accessors/unsafe typed arrays, validates
  path/control/count structure and caps, copies all accepted bytes to fixed owned storage, returns
  fresh copies, immediately reimports the bundle, and compares all seven descriptor fields. The
  opaque handle retains state only through a private `WeakMap`.
- Versions before: No owned verification snapshot version existed.
- Versions after: `dayflow-preprocessed-evidence-verification-snapshot-v0.1`. Existing
  `dayflow-preprocessed-evidence-v0.1`,
  `dayflow-preprocessed-evidence-verifier-v0.1`, and
  `dayflow-screen-evidence-bundle-import-v0.1` APIs and meanings are unchanged.
- Code commit: Not recorded. Git identity was not inspected. Exact validated file identities are
  recorded below.
- Evaluation dataset version and SHA-256: Not applicable. Synthetic fixtures only; no frozen
  dataset changed.
- Candidate run ID: Not applicable; no suggestion engine or model ran.
- Comparison run ID: Not applicable; no suggestion comparison ran.
- Commands executed: From `suggestion/`,
  `./node_modules/.bin/vitest run --config vitest.dayflow-e2schema-resolved.config.ts`;
  `./node_modules/.bin/vitest run --config vitest.dayflow-e2schema.config.ts`;
  `./node_modules/.bin/vitest run --config vitest.dayflow-e2io.config.ts`;
  `./node_modules/.bin/vitest run --config vitest.dayflow-dfa002.config.ts`;
  `npm run typecheck`; `npm run lint`. From the Blabase root,
  `npm run arch:deps:check`. The dedicated snapshot TypeScript and targeted ESLint checks also
  passed; their argv was not supplied to this documentation checkpoint and is not fabricated here.
- Metrics changed: Not applicable. Snapshot 21/21 and compatibility six-file/150-test outcomes are
  regression evidence, not product suggestion-quality metrics.
- Regressions or accepted exceptions: F1, F2a, F2a.1, F2b, F3, R1, and F3.1 are closed. Final
  read-only QA3 passed with no High or Medium finding. Residual Low test gaps are exact 259-entry
  and 257-object issue cases, exact 256-MiB success, explicit cloned/proxied-handle cases, and
  runtime-dependent resizable/growable branches.
- Privacy or retention impact: None. Synthetic-only and ephemeral; no real screenshot, OCR,
  conversation, `.local`, private artifact, live data, filesystem bundle, or production data was
  created, inspected, or persisted.
- Release decision: E2-SCHEMA-2B-1 is implemented, validated, and automated-QA-reviewed only as an
  isolated evaluation snapshot. This is not human approval inferred from QA, production release,
  or authorization for E2-SCHEMA-2B-2 or engine execution.
- Rollback method: Add a successor record and remove only the four 2B-1 files below. No dataset
  migration, private-data cleanup, or historical-record rewrite is required.
- Follow-up work: E2-SCHEMA-2B-2 staged candidate parsing and resolved evidence verification is
  pending, not authorized, and incomplete. Common-engine adaptation, run generation, live data,
  and A/B/C execution remain pending and require separate Colin decisions.

### Exact implementation identity

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `suggestion/src/evaluation/dayflowAblation/preprocessedEvidenceVerificationSnapshotV0_1.ts` | `209e14d71c851dd58a15e7adb20477c9f27d299ee2ac00552bb7a4b83e52fda2` | 23899 |
| `suggestion/tests/dayflowPreprocessedEvidenceBundleVerificationV0_1.test.ts` | `6e24714f4456d8cce96d62f557f4f091d6e9eb466561c037d8b15d44ad41139c` | 42116 |
| `suggestion/tsconfig.dayflow-e2schema-resolved.json` | `40b38c1858e19e14d530cd30de6870e5ecd779e459193a66eb80046432b74104` | 663 |
| `suggestion/vitest.dayflow-e2schema-resolved.config.ts` | `216a7878c3a9033dd92448eac261c139872632488ba7688c72d047cfebbf7168` | 326 |

### Validation and applicability

- Focused: dedicated snapshot Vitest PASS 21/21; dedicated TypeScript PASS; targeted ESLint PASS.
- Compatibility: snapshot 21 + schema 29 + importer 10 + DFA 90, PASS across six test files and
  150 tests.
- Full suggestion: `npm run typecheck` PASS; `npm run lint` PASS.
- Architecture dependencies: PASS with zero errors and valid 17-entry/4-sentinel-edge coverage;
  existing warnings remain repository 12, suggestion 8, scripts 2.
- Golden/baseline: N/A. This unconnected evaluation snapshot changes no runtime engine input,
  output, filtering, ordering, ranking, model, prompt, or configuration.
- LikeC4: N/A for this unconnected evaluation-only capability. Dependency closure was checked.
- Semantic boundary: No candidate semantic parse, resolved evidence verifier, title, summary,
  `semanticOutput`, rank, caveat, availability, engine adapter, runtime path, or live path exists in
  this checkpoint. Dayflow remains neutral capture/storage/OCR/privacy preprocessing only.

This additive record preserves E2-IO.2A and E2-SCHEMA-2A implementation identities and all earlier
historical records.

<!-- engine-change-record-section:ECR-E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:end -->


---

<!-- engine-change-record-section:ECR-E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:begin -->

## Engine Change Record: ECR-E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21

- Date: 2026-08-21
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Goal: Add an internal fail-closed structural inspection stage without changing the existing
  public Dayflow evidence-core contract or prematurely deciding manifest-backed issues.
- Affected pipeline stages: Internal evaluation-only candidate structural parsing, detached root
  hash check, intrinsic issue classification, and future resolved-owner routing.
- Behavior before: The public parser either accepted the full schema or returned one core failure;
  later verification had no internal way to retain a structurally valid candidate while separating
  intrinsic failures from predicates that require the owned manifest and artifact set.
- Behavior after: Internal
  `inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification` applies byte/JSON/caps/
  canonical, structural, root-hash, and collection stages in order. Rejection exposes only status
  and one core code. Structural acceptance returns a deeply frozen candidate and sorted unique
  intrinsic-code and resolved-owner arrays. Unclassified full-semantic invalidity fails closed as
  `SCHEMA_INVALID`.
- Versions before: `dayflow-preprocessed-evidence-v0.1` and
  `dayflow-preprocessed-evidence-verifier-v0.1`.
- Versions after: Unchanged. Public parser/sealer/serializer behavior, issue codes, canonical
  bytes, and hash domain `blabase.dayflow-preprocessed-evidence.v0.1` are preserved. No new public
  or product version is introduced.
- Code commit: Not recorded. No commit or other Git operation was performed. Exact validated file
  identities are recorded below.
- Evaluation dataset version and SHA-256: Not applicable. Synthetic fixtures only; no Golden or
  other frozen dataset changed.
- Candidate run ID: Not applicable; no engine/model run or baseline occurred.
- Comparison run ID: Not applicable; no comparison run occurred.
- Commands executed: Focused dedicated schema Vitest, dedicated TypeScript, and scoped ESLint;
  compatibility through the existing snapshot, schema, importer, and DFA Vitest configurations;
  from `suggestion/`, `npm run typecheck` and `npm run lint`; from the Blabase root,
  `npm run arch:deps:check`. This documentation-only checkpoint did not rerun them.
- Metrics changed: Not applicable. Focused 39/39 and compatibility six-file/160-test results are
  engineering regression evidence, not suggestion-quality metrics.
- Regressions or accepted exceptions: Initial valid sealing failed until the root detached hash
  was excluded from the collector preimage. QA HOLD removed duplicate public refinement. A silent
  full-schema-invalid path was closed with the resolved-owner ledger and fallback. Fixture path,
  ordinal, and truthfulness findings were corrected. Current read-only QA-R2 passed with no finding
  and no Medium-or-higher issue. Optional Low test gaps are owner-helper intrinsic defaults,
  combined all-three-owner ordering, direct public Zod path/message ordering, and redaction-nine.
- Privacy or retention impact: None. Synthetic-only tests; no raw live screenshot, OCR, private
  data, artifact, or log was created, inspected, persisted, or added to retention. Rejected output
  remains redacted, and retention policy is unchanged.
- Release decision: E2-SCHEMA-2B-2A is implemented and validated only as an internal unconnected
  evaluation layer. QA-R2 is automated technical evidence, not human approval. No live, product,
  model, provider, or production release is authorized.
- Rollback method: Through a successor record, revert the three implementation/test deltas below
  together. Leave E2-IO.2A and E2-SCHEMA-2B-1 intact. No private artifact or data cleanup exists.
- Follow-up work: E2-SCHEMA-2B-2B capture-only ordering plus transport/manifest/resolved
  verification remains pending, not authorized, and unimplemented. Common-engine adaptation, run
  generation, live A/B/C, and production work also remain pending.

### Exact implementation identity

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `suggestion/src/dayflowEvidence/preprocessedEvidenceV0_1.ts` | `a9ffcd6743301af2070b8df83424c95b004cd484d3d3b561d1cef47a8d7c5683` | 47698 |
| `suggestion/src/dayflowEvidence/contracts.ts` | `d03ce566686f3dd47498f7fe048af8f360049b61c89ffc3eb556f36ae605c0f7` | 74234 |
| `suggestion/tests/dayflowPreprocessedEvidenceV0_1.test.ts` | `cb4388f21e4a276c3b240a95276038abe2dedb7770122cc53c8da2dfcd75cb2b` | 35416 |

### Intrinsic and resolved ownership closure

The seven intrinsic codes are exactly `CAPTURE_WINDOW_MISMATCH`, `CHRONOLOGY_INVALID`,
`PREPROCESSING_PROVENANCE_INVALID`, `OCR_TEXT_INVALID`, `OCR_TEXT_HASH_MISMATCH`,
`PRIVACY_METADATA_INVALID`, and `RESOURCE_COUNT_MISMATCH`.

The three future resolved owners are exactly `COVERAGE`, `SOURCE_ARTIFACT_BINDING`, and
`SOURCE_ARTIFACT_SET`. They are neither final issue codes nor acceptance. E2-SCHEMA-2B-2B must
resolve them against capture-only owned inputs, transport, manifest, and artifacts.

### Validation and applicability

- Focused: Vitest 39/39 PASS; dedicated TypeScript PASS; scoped ESLint PASS.
- Compatibility: snapshot 21 + schema 39 + importer 10 + DFA 90, six files and 160 tests PASS.
- Full suggestion: typecheck PASS in 3.72 seconds; lint PASS in 10.47 seconds.
- Architecture dependencies: PASS in 6.47 seconds with zero errors and valid 17-entry/
  4-sentinel-edge coverage; existing warnings repository 12, suggestion 8, scripts 2.
- Baseline/Golden: N/A, and no baseline run is claimed. No prompt, model, ranking, output,
  generation, dataset, live authority, or runtime engine behavior is connected.
- LikeC4: No implemented boundary or module connection changed, so no model update is needed.
- Suggestion boundary: OCR data may contain observed suggestion-like words, but suggestion-shaped
  fields remain rejected. Dayflow owns no title, summary, `semanticOutput`, ranking, caveat,
  availability, next action, or output path.

This additive record preserves all prior E2-IO.2A, E2-SCHEMA-2A, and E2-SCHEMA-2B-1 records.

<!-- engine-change-record-section:ECR-E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:end -->

## Engine Change Record: ECR-E2-SCHEMA-2B-STAGE1-9-DIRECT-VERIFIER-COMPLETED-2026-08-21

- Date: 2026-08-21
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Goal: Close the neutral Dayflow evidence verification seam through Stage 9 behind one raw
  three-argument direct-module facade without connecting suggestion generation.
- Affected pipeline stages: Capture-only bounded projection, existing canonical core inspection,
  single-pass detailed bundle import, Stage 7 transport binding, Stage 8 manifest/origin/phase/
  protocol prerequisites, Stage 9 capture-window/coverage/source/intrinsic resolution, and final
  redacted result mapping.
- Behavior before: B1 snapshot ownership and B2-2A structural inspection existed, but current
  authority still left capture-only ordering, resolved manifest checks, Stage 9 resolution, and the
  final three-argument facade unimplemented.
- Behavior after: `verifyDayflowPreprocessedEvidenceV0_1(candidateBytes, originalBundle,
  expectedImportedBundleDescriptor)` captures without import, runs the existing core, performs one
  detailed import over an owned copy, applies Stage 7, Stage 8, and Stage 9 in order, and returns
  only frozen neutral success evidence or a non-empty public issue-code array.
- Versions before: Existing `dayflow-preprocessed-evidence-v0.1`,
  `dayflow-preprocessed-evidence-verifier-v0.1`,
  `dayflow-screen-evidence-bundle-import-v0.1`, and
  `dayflow-preprocessed-evidence-verification-snapshot-v0.1` contracts.
- Versions after: Existing public versions remain compatible. The new Stage 1-9 API is
  direct-module-only and has no barrel, product, release, or freeze version.
- Code commit: Not recorded. No Git operation was performed. Current scoped raw byte identities are
  recorded below.
- Evaluation dataset version and SHA-256: Not applicable. Synthetic tests only; no Golden,
  Regression, Rolling, Holdout, or other frozen dataset changed.
- Candidate run ID: Not applicable; no LLM, suggestion engine, or model run occurred.
- Comparison run ID: Not applicable; no A/B/C or model comparison occurred.
- Commands executed: Latest focused verifier closure, four-file integration closure, full
  suggestion typecheck, full suggestion lint, and root architecture dependency checking were
  executed before this documentation checkpoint. Exact argv was not supplied to this checkpoint
  and is not fabricated. This documentation task reran none of them.
- Metrics changed: Not applicable. Focused 2-file/42-test and integration 4-file/93-test results
  are engineering regression evidence, not suggestion-quality metrics. Earlier focused 29/36
  counts are superseded evidence.
- Regressions or accepted exceptions: B1 projection, B2-1 prerequisites, B2-2A resolution, and
  B2-2B facade are implemented, focused-validated, and independently QA-reviewed with PASS.
  Current-head B2-2A and B2-2B QA reported no Medium-or-higher finding. Known Low test gaps are
  facade post-call mutation, malformed-descriptor versus valid-mismatch contrast, exact importer
  call-count spy, hostile direct `WeakMap.get`/`Reflect.apply`, full-schema fallback,
  field-table coverage, and whole-repository barrel-negative coverage. Static control flow contains
  one detailed-import path; no exact call-count spy is claimed.
- Privacy or retention impact: None. Success returns only validated neutral evidence; failure
  returns only issue codes. No result contains the original bundle, JPEG bytes, filesystem path,
  private snapshot state, mutable caller reference, or underlying exception. No live/user data,
  environment value, private artifact, log, or persistence/retention operation occurred.
- Release decision: Stage 1-9 implementation, focused validation, integration validation, and agent
  QA are complete only as an unconnected evaluation seam. This is not human approval inferred from
  QA, release, or freeze. Colin selected documentation instead of the full Vitest unit suite; that
  suite is deferred and must pass before any release/freeze decision.
- Rollback method: Add a successor record and revert only the final-verifier, detailed-import,
  capture-only, test, and dedicated-config additions. Preserve the existing public E2-IO.2A
  importer, E2-SCHEMA-2A core, and E2-SCHEMA-2B-1 snapshot APIs. Delete only files introduced
  exclusively for this verifier. No private data or artifact cleanup exists.
- Follow-up work: Stage 10, common Blabase engine adaptation and generation, A/B/C execution,
  live/API/persistence, provider, barrel/product exposure, production, release, and freeze remain
  pending and require separate Colin decisions. The same-engine A/B/C direction remains mandatory.

### Current scoped raw byte identity

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `suggestion/src/evaluation/dayflowAblation/verifyPreprocessedEvidenceBundleV0_1.ts` | `18f501dc8968754b6394d956444ce26c8db1eccc1a5ac890aa50b20af603bb5b` | 19495 |
| `suggestion/tests/verifyPreprocessedEvidenceBundleV0_1.test.ts` | `123241df821e3322c2e72f1c9fe88d878df11e65a002cfc62176643ecaa35880` | 39399 |
| `suggestion/src/evaluation/dayflowAblation/importEvidenceBundle.ts` | `dfcd27b368fa715465666375eba461006291cbaa82f9a2a8ce7709e679a240c4` | 18158 |
| `suggestion/tests/dayflowEvidenceBundleImport.test.ts` | `6cda94a2643b249cb4e5338f8bf103dd25b8834f39f200089f6f9fcf30d4321d` | 33035 |
| `suggestion/src/evaluation/dayflowAblation/preprocessedEvidenceVerificationSnapshotV0_1.ts` | `f479f3991020bdc5b2cf8f88629d503c427b148f39408a3f434f20ba9b44eb36` | 25717 |
| `suggestion/tests/dayflowPreprocessedEvidenceBundleVerificationV0_1.test.ts` | `5ae6cdd77289787f6f8224fbd66589ed480f926e0d40407129b9169ead21638e` | 44855 |
| `suggestion/tsconfig.dayflow-e2schema-resolved.json` | `7be141dd6d827b87783ce3bf25f686990bcbf63598c2dbfd8be992f9e9765bc0` | 799 |
| `suggestion/vitest.dayflow-e2schema-resolved.config.ts` | `e17f961b3bb4a8e62c94228b6e0c96290ee6b0b504cfae832743055db03e532d` | 386 |

### Validation and applicability

- Focused: PASS, two files and 42 tests.
- Integration: PASS, four files and 93 tests: core 39 + importer 12 + snapshot/final 42.
- Full suggestion: typecheck PASS; lint PASS.
- Architecture dependencies: PASS, exit zero, no new Dayflow violation, valid 17-entry/
  4-sentinel-edge coverage; existing warnings repository 12, suggestion 8, scripts 2.
- Independent QA: B2-2A current-head PASS and B2-2B current-head PASS, with no Medium-or-higher
  finding.
- Full Vitest unit suite: Deferred by Colin's documentation choice and required before release or
  freeze.
- Baseline/Golden: N/A. No prompt, model, ranking, suggestion output, dataset, or runtime engine
  connection changed.
- LikeC4: No update. No implemented system boundary, container, or runtime flow changed; the planned
  engine connection is still absent.
- Semantic boundary: Dayflow remains capture, storage, OCR, privacy filtering, and neutral
  preprocessing only. No suggestion title, summary, `semanticOutput`, ranking, caveat,
  availability, next action, or output-path field was added.

This additive record preserves all E2-IO.2A, E2-SCHEMA-2A, B1, B2-1, and B2-2A history while
superseding only their active statements that Stage 1-9 final verification or B2-2B remained
unimplemented.

<!-- engine-change-record-section:ECR-E2-SCHEMA-2B-STAGE1-9-DIRECT-VERIFIER-COMPLETED-2026-08-21:end -->

## Validation Addendum: E2-FULL-UNIT-PASSED-2026-08-21

This append-only addendum preserves the preceding Engine Change Record verbatim and supersedes only
its deferred full Vitest unit-suite gate.

- Date: 2026-08-21
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Scope: Full Vitest unit-suite validation for the already implemented E2-SCHEMA-2B Stage 1-9
  direct verifier.
- Command and working directory: `npm test` from `suggestion/`.
- Result: Exit 0; 166 files and 1,531 tests PASS; no failures.
- Timing: Vitest 20.05 seconds; elapsed approximately 20.26 seconds.
- Relationship to prior evidence: Focused two-file/42-test and integration four-file/93-test
  results remain separate and are neither replaced nor summed.
- Documentation action: No source, test, or configuration edit and no validation rerun occurred in
  this documentation checkpoint.
- Dataset and metrics: No baseline, Golden, dataset, LLM, model, prompt, ranking, suggestion-output,
  or A/B/C metric changed.
- Privacy and retention: No live/user data, environment value, private artifact, raw bundle, JPEG,
  path, log, persistence, or retention operation occurred.
- Release decision: The previously deferred full-unit gate is now complete. This is not release or
  freeze approval and does not authorize Stage 10, common-engine adaptation/generation, A/B/C
  execution, live/API/persistence, provider, product, or production work.
- Follow-up: All remaining Stage 10 and product/runtime work requires separate Colin decisions.
  Neutral Dayflow processing, no David gate, and the same future Blabase engine for A/B/C remain
  unchanged.

<!-- engine-change-record-addendum:E2-FULL-UNIT-PASSED-2026-08-21:end -->

---

<!-- engine-change-record-section:ECR-STAGE10-1A-1-COMMON-EVIDENCE-RECORD-SET-COMPLETED-2026-08-21:begin -->

## Engine Change Record: ECR-STAGE10-1A-1-COMMON-EVIDENCE-RECORD-SET-COMPLETED-2026-08-21

- Date: 2026-08-21
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Goal: Add a deterministic, source-neutral, sealed evidence record set for future same-engine
  A/B/C evaluation without connecting suggestion generation.
- Affected pipeline stages: Evaluation-only evidence projection, record/fact identity derivation,
  duplicate and collision handling, deterministic byte-budget selection, canonical sealing,
  sealed-artifact verification, and serialization.
- Behavior before: Stage 1-9 could verify neutral Dayflow preprocessed evidence, but there was no
  shared source-neutral record-set contract for structured and Dayflow evidence. Historical E1
  A/B/C generation remains non-authoritative and uncorrected for execution.
- Behavior after: buildAndSealCommonSuggestionEvidenceRecordSetV0_1 accepts bounded structured and
  Dayflow build records, strips private build identities, derives typed record/fact identities,
  deduplicates, detects global collisions before selection, applies deterministic partition
  budgets, and returns a deeply frozen sealed artifact. A hardened structural facade, authoritative
  sealed-artifact verifier, and strict JCS-plus-LF serializer share private internal validation.
- Versions before: No Stage10 common evidence record-set version.
- Versions after: Schema blabase-common-suggestion-evidence-record-set-v0.1; budget
  common-suggestion-evidence-budget-v0.1; detached-hash domain
  blabase.common-suggestion-evidence-record-set.v0.1.
- Code commit: Not recorded. No Git operation was performed. Current scoped raw byte identities are
  recorded below.
- Evaluation dataset version and SHA-256: Not applicable. Synthetic fictional fixtures only; no
  Golden, Regression, Rolling, Holdout, or other frozen dataset changed.
- Candidate run ID: Not applicable; no suggestion engine, LLM, model, or provider run occurred.
- Comparison run ID: Not applicable; no A/B/C comparison run occurred.
- Commands executed: From suggestion/, npm test with the focused test path, npm run typecheck,
  npm run lint, and npm test. Earlier intermediate focused runs are superseded by the final focused
  13/13 result. This documentation checkpoint reran none of them.
- Metrics changed: Not applicable. Focused 13/13 and full 167-file/1,544-test PASS results are
  engineering regression evidence, not suggestion-quality metrics.
- Regressions or accepted exceptions: An import-time Zod min ordering defect and hostile intrinsic
  dependency reads were corrected during focused validation. Initial independent QA requested four
  Medium fixes: hardened public structural projection, private exported-child-schema isolation,
  checkable truncation/cap invariants, and record-ID grammar. All four were implemented and final
  independent QA returned PASS with no Critical, High, Medium, or blocking Low finding.
  Non-blocking test opportunities remain for stronger shared/oversized-input causal fixtures,
  forced global fact-ID collision, and a dedicated simultaneous record/fact collision precedence
  case.
- Privacy or retention impact: None. No live screenshot, OCR payload, user data, private artifact,
  credential, environment value, log, persistence, deletion, or retention operation occurred.
  Build-only source identities are absent from sealed output.
- Release decision: Stage10-1A.1 implementation, automated validation, and independent technical QA
  are complete only as an unconnected evaluation contract. This is not a production, product,
  provider, API, release, freeze, or A/B/C execution approval. Agent QA is technical evidence and
  does not replace Colin's decision authority.
- Rollback method: Add a successor record, remove the new common-evidence source and focused test,
  and revert only the module-intrinsic capture deltas in canonicalHash.ts and contracts.ts.
  Preserve all Stage 1-9 and E2-IO/E2-SCHEMA history. No private-data cleanup exists.
- Follow-up work: Stage10-1A.2 source-specific coverage/provenance, Stage10-2 structured adapter,
  Stage10-3 Dayflow composition, common prompt/output/verifier/ranking/generator work, offline
  runner, A/B/C execution, and all live/product work remain pending and require separate Colin
  decisions.

### Exact implementation identity

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceV0_1.ts | a58df3c469cc1fb37d4f871cb5ae549cc0e4c42e77e16c0352577d3f0ed4be5b | 57586 |
| suggestion/tests/dayflowCommonSuggestionEvidenceV0_1.test.ts | e8461c3ee160b186b5ae8c487b2f034738139bb88c2322396cd35ade185d8eb8 | 31716 |
| suggestion/src/crossSource/canonicalHash.ts | e921724412876f2956b5a4eef8ba4f4320072c821eba318b0dd865766aca033a | 1647 |
| suggestion/src/dayflowEvidence/contracts.ts | 5480dc170a8ecf22ed8555aaddec337a35c09c55074fdf9d805e7b5e4eef8b7c | 74896 |

### Frozen contract and limits

- Record kinds: github_work_item, github_deadline, github_activity, codex_overview,
  calendar_constraint, notion_resource, and dayflow_frame.
- Sources: github, codex, google_calendar, notion, and dayflow.
- Authorities: primary_task_fact, structured_supporting_context, and screen_observation.
- Record-ID grammar: ^evidence_record_[0-9a-f]{32}$.
- Structured input/byte limits: 2,048 records and 49,152 UTF-8 bytes.
- Dayflow input/byte limits: 256 records and 65,536 UTF-8 bytes.
- Envelope reserve and total: 8,192 and 122,880 UTF-8 bytes.
- Error decision order is staged rather than one global precedence: top-level shape preflight,
  input record caps, record schema and identity derivation, cross-partition record collision,
  cross-partition fact collision, then post-selection budget invariants. Within the collision
  stage, RECORD_ID_COLLISION precedes FACT_ID_COLLISION.
- Serialization: strict validated JCS followed by exactly one LF.
- Dayflow semantic boundary: OCR/privacy-filtered observation facts only. No title, summary,
  semanticOutput, ranking, caveat, availability, next action, or final output path.

### Validation and applicability

- Focused: 13/13 PASS.
- Full Suggestion: typecheck PASS; lint PASS; 167 test files and 1,544 tests PASS.
- Independent final QA: PASS; all four initial Medium findings closed.
- Baseline/Golden: N/A. No evaluation dataset, prompt, model, ranking, generation, or output changed.
- LikeC4: No update. The new module is unconnected and changes no implemented architecture boundary
  or runtime flow.
- Verifier limitation: It validates only invariants reconstructable from the sealed artifact. It
  does not claim to reconstruct omitted record IDs or their original preimage.

This additive record preserves all prior E2-IO, E2-SCHEMA, Stage 1-9, and full-unit addendum history.
It supersedes only statements that Stage10-1A.1 or the common source-neutral record-set contract
remains unimplemented.

<!-- engine-change-record-section:ECR-STAGE10-1A-1-COMMON-EVIDENCE-RECORD-SET-COMPLETED-2026-08-21:end -->

---

<!-- engine-change-record-section:ECR-STAGE10-1A-2B-LINEAGE-STRUCTURAL-ORCHESTRATION-READY-2026-08-22:begin -->

## Engine Change Record: ECR-STAGE10-1A-2B-LINEAGE-STRUCTURAL-ORCHESTRATION-READY-2026-08-22

- Date: 2026-08-22
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Status: Implementation, focused validation, full regression, and bounded technical QA PASS.
  Colin checkpoint acceptance remains pending.
- Goal: Implement the frozen v0.1 lineage receipt and private source-attestation structural and
  orchestration boundary without activating source authority or suggestion generation.
- Frozen prerequisite: `COMMON_SUGGESTION_EVIDENCE_LINEAGE_V0_1_CONTRACT.md`, commit `e1415ad`.
- Affected pipeline stages: Evaluation-only lineage structural parsing, intrinsic receipt
  inspection, source-verification planning, private source-attestation parsing, private scope-token
  and HMAC preimage handling, deterministic failure selection, and shared JCS/domain hashing.
- Behavior before: Stage10-1A.1 supplied a source-neutral sealed suggestion payload, and the frozen
  lineage contract existed as documentation, but no receipt/attestation structural runtime or
  source-verification planner implemented it.
- Behavior after: The public surface can structurally parse, intrinsically inspect, and plan exact
  v0.1 lineage verification. Source attestation remains private. A requested source whose private
  bundle passes bundle preflight reaches `SOURCE_VERIFIER_UNAVAILABLE`; missing, malformed, extra,
  proxy/accessor, or non-requested bundles fail earlier with `INPUT_INVALID` or
  `SOURCE_BINDING_INVALID`. No authoritative receipt success can be built, verified, or serialized.
  The shared JCS/domain helper is stable under post-import intrinsic mutation while preserving exact
  canonical bytes and domain framing.
- Versions before: No implemented Stage10 lineage receipt or source-attestation runtime version.
- Versions after: Receipt schema `blabase-common-suggestion-evidence-lineage-receipt-v0.1`; receipt
  domain `blabase.common-suggestion-evidence-lineage-receipt.v0.1`; source-attestation schema
  `blabase-common-suggestion-source-collection-attestation-v0.1`; source-attestation domain
  `blabase.common-suggestion-source-collection-attestation.v0.1`; record-ID-set domain
  `blabase.common-suggestion-evidence-lineage-record-ids.v0.1`; private HMAC domain
  `blabase.lineage.private-scope.v0.1`; token canonicalization
  `blabase-scope-token-canonicalization-v0.1`; timezone profile
  `blabase-tzdb-profile-2026c-v1`.
- Code commit: Not recorded. Implementation is on branch `feat/common-lineage-v01-verifier`; no
  implementation commit was created by this checkpoint.
- Evaluation dataset version and SHA-256: Not applicable. Fictional synthetic fixtures only; no
  Golden, Regression, Rolling, Holdout, or production dataset changed.
- Candidate run ID: Not applicable. No model, LLM, provider, suggestion, or A/B/C run occurred.
- Comparison run ID: Not applicable. No comparable suggestion outputs were generated.
- Commands executed: From `suggestion/`, focused `npx vitest run` commands for the lineage and
  Dayflow contract tests, followed by full `npx vitest run`. From the application root,
  `npm run typecheck` and focused `npx eslint` over the five affected source/test files. Intermediate
  failing runs were diagnostic and are superseded by the final results below.
- Metrics changed: Not applicable. Test counts are engineering regression evidence, not suggestion
  quality, product, or release metrics.
- Privacy or retention impact: None. No live screenshot, OCR payload, connector response, user data,
  private artifact, key, credential, environment value, log, persistence, deletion, or retention
  operation was used. HMAC keys and registry snapshots remain runtime-private interfaces only.
- Architecture impact: No implemented boundary, container, external integration, or runtime flow
  was connected. No LikeC4 source change is required. Architecture commands were not rerun and no
  architecture PASS is claimed.
- Baseline applicability: N/A. Suggestion engine input/output, dataset, prompt, model, ranking,
  filtering, ordering, guardrail, and result resolution are unchanged.
- Release decision: This checkpoint is evaluation-only and non-authoritative. It does not approve
  source verifiers, live collection, engine connection, A/B/C execution, API, persistence, provider,
  product, release, or production use. Automated QA is technical evidence and does not replace
  Colin's acceptance.
- Rollback method: Through a successor record, remove the three lineage source/test files and revert
  the bounded shared JCS/test hardening only if explicitly included. Preserve Stage10-1A.1 and all
  E2/E1 records. No data migration or private cleanup exists.
- Follow-up work: Colin checkpoint acceptance; then separately decide Stage10-2 authoritative
  source verifiers and private registry/key/profile implementations. Stage10-3 composition, the
  common suggestion engine, offline A/B/C execution, and all live/product work remain unauthorized.

### Public and private authority boundary

Public runtime exports are limited to:

- `commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1`.
- `inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1`.
- `planCommonSuggestionEvidenceLineageSourceVerificationV0_1`.

No public `buildAndSealCommonSuggestionEvidenceLineageReceiptV0_1`,
`verifyCommonSuggestionEvidenceLineageReceiptV0_1`, or
`serializeCommonSuggestionEvidenceLineageReceiptV0_1` API exists. The receipt remains a sidecar and
is never engine/model input. The private attestation requires ordered operation statuses, coverage
consistency, unavailable `completedAt === null`, detached-hash binding, and sanitized failures, but
does not establish upstream truth without a future source verifier.

### Exact implementation identity

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.ts | 68b1902360dfe9c2dc0e15338322f0d57769b970c7d7c50e1613debd14c35d3d | 2,637 |
| suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.internal.ts | affed7355a450f5ef8786ef6731839ab08ea9bc5d0d0d950a0ee43700204a94b | 85,052 |
| suggestion/tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts | 322770ca9f2591c472f5baff4e5ec8217ab94693f5ecf9c2f679f36db4b7ae43 | 70,219 |
| suggestion/src/dayflowEvidence/contracts.ts | 0888c71a796dec77b81f09a02a552c5a5e26e9626d0d0032f6abd00e97ec1ce5 | 77,195 |
| suggestion/tests/dayflowEvidenceContracts.test.ts | 2b242ae5d40fe0608b7b3a554e3d3656d90b05257f1178829940ae25884ae72a | 52,389 |

### Validation and QA evidence

- Stage10 focused Vitest: 24/24 PASS.
- Shared Dayflow contract Vitest: 20/20 PASS.
- Full application TypeScript typecheck: PASS.
- Focused ESLint for the five affected files: PASS.
- Full Suggestion Vitest: 168 files and 1,569 tests PASS, no failures.
- Final bounded technical QA: PASS with no Critical, High, Medium, or Low finding in scope.
- Full application lint, build, architecture commands, Golden baseline, and suggestion-quality
  evaluation were not run and are not claimed.

Confirmed validation and QA findings included Zod v3 union compatibility, mutable intrinsic use in
the lineage runtime, mutable shared JCS operations, missing attestation operation statuses, and an
invalid unavailable timestamp union. All confirmed findings were corrected, regression-tested, and
independently re-reviewed as closed. Nonblocking opportunities remain for positive private
attestation fixtures across every source/mode and exact attestation serialized-byte boundaries.

This additive record preserves Stage10-1A.1 and all E2/E1 history. It supersedes only active
statements that Stage10-1A.2 structural orchestration remains wholly unimplemented or unvalidated.

<!-- engine-change-record-section:ECR-STAGE10-1A-2B-LINEAGE-STRUCTURAL-ORCHESTRATION-READY-2026-08-22:end -->

<!-- engine-change-record-addendum:ECR-STAGE10-1A-2B-COLIN-ACCEPTED-2026-08-22:begin -->

## Acceptance Addendum: ECR-STAGE10-1A-2B-COLIN-ACCEPTED-2026-08-22

- Date: 2026-08-22
- Decision authority: Colin
- Decision: Accept and close the Stage10-1A.2b lineage structural-orchestration checkpoint.
- Accepted evidence: The exact implementation identities and limits in the preceding READY record;
  Stage10 focused 24/24 PASS; shared Dayflow contracts 20/20 PASS; full application typecheck PASS;
  focused five-file ESLint PASS; full Suggestion 168 files/1,569 tests PASS; bounded code QA PASS;
  and documentation QA PASS.
- Scope: Evaluation-only structural and orchestration closure. No authoritative receipt success,
  source verifier, suggestion-engine connection, A/B/C execution, API, persistence, provider,
  release, product, or production authority is granted.
- Human roles: Colin is the sole human reviewer and decision authority. David has no required role,
  receipt, artifact, or approval.
- Commands and code changes: None for this acceptance addendum. Prior evidence is referenced without
  rerunning it.
- Next gate: Stage10-2 remains pending and requires a separate Colin decision.

This addendum supersedes only the pending-Colin-acceptance status in the preceding READY record. It
does not rewrite that record, its hashes, its validation evidence, its privacy boundary, or its
rollback instructions.

<!-- engine-change-record-addendum:ECR-STAGE10-1A-2B-COLIN-ACCEPTED-2026-08-22:end -->

---

<!-- engine-change-record-section:ECR-STAGE10-2A-INTERNAL-AUTHORITATIVE-VERIFICATION-KERNEL-READY-2026-08-22:begin -->

## Engine Change Record: ECR-STAGE10-2A-INTERNAL-AUTHORITATIVE-VERIFICATION-KERNEL-READY-2026-08-22

- Date: 2026-08-22
- Timezone: Asia/Seoul
- Owner: Colin
- Human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Status: Implementation, automated validation, and independent scoped QA PASS. Colin's final human
  acceptance remains pending.
- Goal: Add the private Stage10-2A authoritative-verification kernel scaffold that deterministically
  orchestrates intrinsic receipt, record-set binding, and source-attestation boundaries without
  activating a source verifier or public authority path.
- Affected pipeline stages: Internal evaluation-only lineage receipt inspection, common evidence
  record-set binding, source-attestation bundle-presence inspection, unavailable-only verifier
  registry validation, runtime snapshot validation, deterministic failure selection, bounded
  diagnostics, and result freezing.
- Behavior before: The existing public facade could structurally parse and intrinsically inspect a
  lineage receipt and plan requested source verification, but there was no private execution kernel
  that enforced the complete three-stage order and injected registry/runtime boundary.
- Behavior after: The private kernel executes the frozen order
  `intrinsic_receipt -> record_set_binding -> source_attestation`, returns one deterministic primary
  failure plus bounded internal diagnostics, and fails closed for missing or malformed registry,
  runtime, snapshot, or verifier inputs. A valid empty plan completes only after boundary validation
  and remains `executed: true`, `authoritative: false`. Requested sources return
  `SOURCE_VERIFIER_UNAVAILABLE` because no actual Stage10-2A source verifier exists.
- Versions before: No private Stage10-2A authoritative-verification kernel execution scaffold.
- Versions after: Private implementation marker
  `AUTHORITATIVE_VERIFICATION_KERNEL_VERSION_V0_1`; no public API, schema, serialized protocol,
  suggestion-engine, or authoritative-success version change.
- Code commit: Not recorded. No Git staging or commit was performed by this documentation task, and
  no implementation commit SHA is claimed here.
- Evaluation dataset version and SHA-256: Not applicable. No Golden, Regression, Rolling, Holdout,
  or other evaluation dataset changed, and no dataset run occurred.
- Candidate run ID: Not applicable. No model, LLM, provider, suggestion generation, or A/B/C run
  occurred.
- Comparison run ID: Not applicable. No comparable suggestion outputs were generated.
- Commands executed: Prior to this documentation task, the focused Stage10-2A Vitest, Suggestion
  typecheck, full Suggestion test suite, targeted lint for the two changed files, full
  `npm run arch:check`, and `npm run build` were executed. The first sandboxed build stopped before
  compilation with the environment-only `listen EPERM: operation not permitted 127.0.0.1`; the
  authoritative sandbox-exempt build rerun passed. This documentation task reran none of those
  checks.
- Metrics changed: Not applicable. The test counts below are engineering regression evidence, not
  suggestion-quality, A/B/C, product, or release metrics. Provider timing, token usage, cost, and
  output metrics are not applicable because no provider or evaluation run occurred.
- Regressions or accepted exceptions: The first independent QA found three Medium issues: an
  empty-plan boundary bypass, incomplete runtime-snapshot validation, and hostile intrinsic/proxy
  exception escape. Their remediation passed focused 40/40 and typecheck. Independent re-review
  found three Medium issues: a live `charCodeAt` integrity bypass, canonical year `0000`
  inconsistency, and unbounded array enumeration. QA Fix 2 resolved all three. Final independent
  scoped QA returned PASS with no Critical, High, Medium, or Low finding. No accepted correctness or
  privacy exception remains in the reviewed scope.
- Privacy or retention impact: None. No raw/private receipt, bundle, runtime, screenshot, OCR,
  connector, or user evidence value is emitted or added to Git. Hostile private-marker non-leak
  cases are tested. No persistence, retention, deletion, consent, or credential policy changed.
- Release decision: Not released or accepted by the human reviewer. Implementation, automated
  validation, and independent technical QA have passed, but Colin's final acceptance remains
  pending. This record grants no production-authoritative, source-verifier, A/B/C, API, persistence,
  provider, product, release, or production authority.
- Rollback method: Through a successor record, revert only the scoped private Stage10-2A kernel and
  its focused tests. Preserve the public lineage facade, Stage10-1A records, and E2/E1 history. No
  schema migration, dataset restoration, or private-data cleanup is required.
- Follow-up work: Obtain Colin's final checkpoint decision. Stage10-2B actual source verifiers and
  Stage10-2C authoritative-success path remain deferred, unimplemented, and subject to separate
  Colin decisions. Common suggestion generation, offline A/B/C execution, and all live/product work
  remain separate future gates.

### Changed implementation and test files

- `suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.internal.ts`
- `suggestion/tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts`

The existing public facade, planner signature, planner behavior, and exports are unchanged. No
`authoritative: true` result or authoritative-success variant exists.

### Frozen Stage10-2A execution behavior

1. `intrinsic_receipt` reuses the existing intrinsic receipt inspector and short-circuits according
   to its frozen failure.
2. `record_set_binding` performs structural parsing, detached self-hash validation, reuse of the
   existing public authoritative record-set verifier, and receipt binding for root hash, `asOf`,
   source-record count, and source record-ID-set hash. Frozen failure precedence is preserved.
3. `source_attestation` inspects bundle presence, validates the unavailable-only fixed registry, and
   validates the full runtime snapshot shape and deep-freeze boundary. Requested sources terminate
   with `SOURCE_VERIFIER_UNAVAILABLE` because actual verifiers are deferred.

The fixed source union is GitHub, Codex, Google Calendar, Notion, and Dayflow. Registry and runtime
snapshot boundaries are injected and immutable. Missing or malformed registry/runtime/snapshot/
verifier values fail closed.

### Hardening and privacy properties

- Hostile getters, proxies, and Stage 3 exceptions fail closed.
- `Set`, `Set.prototype.add`, `Array.isArray`, and `String.prototype.charCodeAt` use module-load-safe
  references.
- Canonical timestamp year `0000` is rejected, with Gregorian leap-year semantics.
- Registry length must equal five before key enumeration.
- Runtime and timezone contract arrays are limited to 1,024 entries before enumeration; excess
  input returns `INPUT_INVALID`.
- No receipt, bundle, or private runtime payload is returned, and results are deeply frozen.

### Validation, QA, and evidence limitations

- Focused Stage10-2A Vitest: 46/46 PASS.
- Suggestion TypeScript typecheck: PASS.
- Full Suggestion suite in the current dirty worktree: 168 files and 1,591 tests PASS. This evidence
  is not from a clean committed snapshot.
- Targeted lint for the changed implementation and test files: PASS.
- Full `npm run arch:check`: PASS. Its dependency check reported 0 errors, 12 repository warnings,
  8 suggestion warnings, and 2 scripts warnings; JS/MJS dependency coverage was valid at 17 entries
  and 4 sentinel edges. LikeC4 local source links were valid at 49. AppMap safety configuration was
  valid with 9 exclusions, 3 instrumented paths, and dev trace fail-closed. All 5 LikeC4 files passed
  the format check, and the LikeC4 model was valid across 5 files.
- The first sandboxed `npm run build` stopped before compilation with the environment-only error
  `listen EPERM: operation not permitted 127.0.0.1` while Next.js attempted lockfile patching. This
  was an environment execution failure, not a code or build failure. The authoritative
  sandbox-exempt rerun passed with Next.js 15.5.20: optimized production compilation, linting and
  type-validity checking, static page generation 9/9, build-trace collection, and page-optimization
  finalization all passed.
- The successful build warned that the lockfile was missing SWC dependencies, reported patching it,
  and recommended running `npm install`. The subsequent approved inspection found the current
  `package-lock.json` diff at 1,578 additions and 21 deletions against HEAD. It is broad dependency-
  lock work including `appmap-node` 2.26.1, `dependency-cruiser` 18.2.0, `likec4` 1.59.2, and
  transitive packages; no `@next/swc` lines are present in the current Git diff. Because no
  pre-build snapshot exists, the incremental build-caused portion cannot be isolated. This broad
  diff is not attributed to Stage10 or solely to the build. Colin decided to preserve the lockfile
  as separate, non-Stage10 work and exclude it from the Stage10 commit scope.
- Independent final scoped QA: PASS with no Critical, High, Medium, or Low finding; all three QA Fix
  2 findings were marked resolved.
- Documentation consistency QA: PASS after the exact changed implementation and test paths were
  added.
- Codebase-memory generation `2026-08-20T14:55:09Z` was stale and did not track the two changed code
  files. QA relied on current direct source rather than claiming fresh graph evidence.

### Compatibility and evaluation applicability

This change is private/internal verification infrastructure. It does not alter suggestion-engine
input/output, filtering, ordering, ranking, prompt, model, configuration, guardrail, Golden Dataset,
or A/B/C result semantics. No Golden/baseline rerun applies, and this record claims no experimental
A/B/C result. No LikeC4 update applies because no implemented system boundary, container, external
integration, or connected runtime flow changed.

This additive record preserves all Stage10-1A and E2/E1 history. It supersedes only active statements
that the Stage10-2A internal kernel scaffold remains wholly unimplemented or unvalidated. It does not
mark Stage10-2B or Stage10-2C complete.

<!-- engine-change-record-section:ECR-STAGE10-2A-INTERNAL-AUTHORITATIVE-VERIFICATION-KERNEL-READY-2026-08-22:end -->

<!-- engine-change-record-addendum:ECR-STAGE10-2A-COLIN-ACCEPTED-2026-08-22:begin -->

## Acceptance Addendum: ECR-STAGE10-2A-COLIN-ACCEPTED-2026-08-22

- Date: 2026-08-22
- Timezone: Asia/Seoul
- Decision authority: Colin
- Decision: Accept and close the Stage10-2A internal/private authoritative-verification-kernel
  implementation checkpoint. It is `ACCEPTED` and complete for planning, and Stage10-only
  commit-scope preparation may proceed as a separate task.
- Accepted evidence: The implementation, limitations, and residual risks recorded in the preceding
  READY record; focused Stage10-2A 46/46 PASS; Suggestion typecheck PASS; current dirty-worktree full
  Suggestion suite 168 files/1,591 tests PASS; targeted two-file lint PASS; full
  `npm run arch:check` PASS; sandbox-exempt build PASS after the environment-only sandbox `EPERM`;
  independent final code QA PASS; and documentation consistency QA PASS.
- Evidence limitations preserved: The full-suite evidence remains a dirty-worktree result. The
  sandbox `EPERM`, successful sandbox-exempt rerun, missing-SWC lockfile warning, and unresolved
  incremental lockfile provenance remain as recorded. The broad `package-lock.json` change is
  preserved as separate non-Stage10 work and excluded from the Stage10 commit scope.
- Compatibility and evaluation: No suggestion-engine or A/B/C semantics changed, and no Golden or
  baseline rerun is required. No evaluation run or A/B/C result is accepted by this addendum.
- Explicit exclusions: Stage10-2B/2C actual source verifiers and authoritative-success path remain
  deferred and unimplemented. No public `authoritative: true` result, public API, schema, serialized
  protocol or version change, production release, deployment, commit, push, or merge is approved.
- Code commit: Pending. No implementation commit SHA is fabricated or claimed by this addendum.
- Human roles: Colin is the sole human reviewer and decision authority. David has no reviewer,
  approver, receipt, or artifact role.
- Commands, code, and Git changes: No command was rerun, no code changed, and no staging, commit,
  push, or merge was performed for this acceptance addendum.

This addendum supersedes only the pending-Colin-acceptance and not-released-or-accepted status in the
preceding READY record. It does not rewrite that record or grant production-authoritative, release,
deployment, source-verifier, A/B/C experiment, public-contract, or Git authority.

<!-- engine-change-record-addendum:ECR-STAGE10-2A-COLIN-ACCEPTED-2026-08-22:end -->

<!-- engine-change-record-addendum:ECR-STAGE10-2A-CODE-COMMIT-IDENTITY-2026-08-22:begin -->

## Commit Identity Addendum: ECR-STAGE10-2A-CODE-COMMIT-IDENTITY-2026-08-22

- Date: 2026-08-22
- Timezone: Asia/Seoul
- Code commit SHA: `8d868983cf85f5571abaa48d39765d29498eb04f` (short reference
  `8d86898`).
- Commit subject: `feat(suggestion): add Stage10-2A lineage verification kernel`
- Branch at commit time: `feat/common-lineage-v01-verifier`
- Exact commit scope: The commit contained exactly the following four Stage10 files already
  recorded by this Engine Change Record:
  - `suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.internal.ts`
  - `suggestion/tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts`
  - `suggestion/docs/DAYFLOW_SUGGESTION_ABLATION_PLAN.md`
  - `suggestion/docs/ENGINE_CHANGE_RECORD.md`
- Excluded worktree scope: `package-lock.json` and all unrelated dirty-worktree files were not
  included in the implementation commit. This addendum does not claim that the worktree was clean.
- Binding boundary: This commit identity binds only the previously accepted Stage10-2A
  internal/private technical checkpoint and its recorded implementation, tests, plan, and Engine
  Change Record.
- Explicit exclusions: This identity grants no Stage10-2B or Stage10-2C completion, actual source
  verifier, public authoritative-success or `authoritative: true` path, A/B/C execution or result,
  release, deployment, push, or merge approval.
- Acceptance authority: Colin's acceptance remains the prior recorded decision. This commit-identity
  record does not create a second human approval gate. David has no reviewer, approver, receipt, or
  artifact role.
- Addendum commit identity: The Git SHA of the future documentation commit containing this addendum
  is not yet known and is intentionally not claimed.

This append-only addendum resolves and supersedes only the earlier pending or unrecorded Stage10-2A
implementation commit identity. It does not rewrite the preceding READY or acceptance records,
alter their validation and QA evidence, expand their authority boundary, or approve any excluded
work.

<!-- engine-change-record-addendum:ECR-STAGE10-2A-CODE-COMMIT-IDENTITY-2026-08-22:end -->

---

<!-- engine-change-record-section:ECR-STAGE10-V0-1-RECORD-COUNT-CONTRACT-ALIGNMENT-2026-08-22:begin -->

## Engine Change Record: ECR-STAGE10-V0-1-RECORD-COUNT-CONTRACT-ALIGNMENT-2026-08-22

- Date: 2026-08-22
- Timezone: Asia/Seoul
- Owner: Colin
- Sole human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Status: V0.1 contract-alignment correction implemented and the recorded focused/full validation
  passed. Independent exact code/test QA, the V0.2 contract's independent re-QA, correction commit
  identity, and Colin's remaining review/freeze decisions are pending.
- Classification: Behavior-changing bug correction that restores conformance with the already-frozen
  V0.1 contract. This is not a new semantic rule and does not bump a contract, schema, verifier,
  rule, or public API version. The exact correction commit identity, rather than a reused historical
  identity, must bind the changed implementation bytes.
- Goal: Correct the accepted private V0.1 kernel's one non-conformant per-source `recordCount`
  disagreement branch so it emits the failure code required by the frozen contract, and prevent the
  drift from recurring with one focused synthetic GitHub regression test.
- Affected pipeline stages: Private/internal Stage10-2A `record_set_binding` failure classification
  and its focused regression test only.
- Behavior before: The frozen V0.1 contract assigned an authoritative per-source partition's
  `recordCount` disagreement to `RECORD_ID_SET_MISMATCH`, but the accepted implementation emitted
  `RECORD_SET_BINDING_MISMATCH` for only that count-mismatch branch.
- Behavior after: The branch emits `RECORD_ID_SET_MISMATCH`. The focused GitHub test changes only
  the receipt binding's `recordCount` from zero to one while the authoritative source partition is
  empty and its canonical empty record-ID-set hash remains valid, then asserts the unchanged
  `record_set_binding` stage, `executed: false`, `authoritative: false`, and the bounded diagnostic
  detail `record_count_mismatch` under the corrected code.
- Preserved behavior: Fixed source order; stage order and `record_set_binding` stage; frozen failure
  precedence; public facade and exports; result flags and diagnostic structure; root, `asOf`, fixed
  source presence, partition, same-ID record-content, and provenance behavior; and every branch
  other than this isolated per-source count classification remain unchanged.
- Versions before: Frozen Common Suggestion Evidence Lineage V0.1 contract and accepted private
  Stage10-2A implementation at historical base commit
  `8d868983cf85f5571abaa48d39765d29498eb04f`, with its historical ECR addendum commit
  `7cea8e58e62c7986dd8fd453a81fb12bd0c08225`.
- Versions after: The same frozen V0.1 contract and existing private/public version surfaces, with
  the implementation aligned to that contract. No version bump applies because no frozen semantic
  rule is added or revised. The changed bytes require the separate correction identity below.
- Code commit: `TBD_UNCOMMITTED`. The two historical Stage10-2A SHAs above are base identities, not
  identities for this correction. This placeholder must be replaced with the correction's full Git
  commit SHA before the V0.2 contract can freeze.
- Evaluation dataset version and SHA-256: Not applicable. No Golden, Regression, Rolling, Holdout,
  or formal evaluation dataset was changed or executed; the added fixture is synthetic test data.
- Candidate run ID: Not applicable. No model, provider, suggestion-generation, or evaluation run
  occurred.
- Comparison run ID: Not applicable. No comparable engine or suggestion outputs were generated.
- Commands executed: The following evidence was produced on 2026-08-22 before this ECR task and is
  recorded without rerunning it:
  - `npm test -- tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts`: exit 0; Vitest v3.2.7;
    1/1 test file passed; 47/47 tests passed; 292ms reported total duration.
  - `npm test`: exit 0; Vitest v3.2.7; 168/168 test files passed; 1,592/1,592 tests passed; 20.16s
    reported total duration.
  - `npm run typecheck`: `tsc --noEmit`; exit 0.
  - `npm run lint`: ESLint command completed; exit 0.
  No command, validation, or Git operation was run while appending this record.
- Metrics changed: Not applicable. Test counts and durations are engineering validation evidence,
  not semantic-quality, A/B/C, latency, token, cost, product, or release metrics. Provider latency
  and token usage are not applicable because this deterministic branch invokes no provider.
- Dependencies, data, and architecture: No dependency, schema version, public API, model, prompt,
  ranking, configuration, guardrail, dataset, provider, module/import boundary, system boundary, or
  architecture boundary changed. No production or evaluation data changed.
- Regressions or accepted exceptions: No known regression is accepted. Exact code/test independent
  QA remains pending. Independent re-QA of the corrected V0.2 proposal remains pending. Build and
  architecture commands were not run because no module/import/system/architecture boundary changed;
  build remains a later release/commit-readiness decision and no build or architecture PASS is
  claimed. The correction commit identity, exact proposal freeze identity, and V0.2 freeze decision
  remain pending.
- Privacy or retention impact: None. No raw evidence, conversation, provider payload, user data,
  secret, credential, private artifact, or live source material was added. The focused fixture is
  fictional and synthetic. No collection, consent, persistence, retention, deletion, or private
  artifact policy changed.
- Compatibility: Private/internal implementation behavior only. The public facade, exports, input
  and result schema, result flags, and diagnostic structure are unchanged. Only the failing
  diagnostic code for the previously non-conformant per-source count-mismatch case changes from
  `RECORD_SET_BINDING_MISMATCH` to `RECORD_ID_SET_MISMATCH`.
- Release decision: Not released. This record documents accumulated implementation and validation
  evidence but does not replace Colin's human decision, authorize V0.2 implementation, freeze the
  V0.2 proposal, activate a source verifier, or grant public/production authority. V0.2 freeze is
  blocked until `TBD_UNCOMMITTED` is replaced by the full correction commit SHA and the remaining
  contract/QA/Colin gates pass.
- Rollback method: In a separately approved change, restore only the prior single count-mismatch
  branch and remove only the new focused regression test. That rollback deliberately restores known
  drift from the frozen V0.1 contract and therefore requires an explicit Colin decision. No
  destructive rollback or other action was performed by this ECR task.
- Follow-up work: Complete independent exact code/test QA; complete independent V0.2 contract re-QA;
  create and record the full correction commit SHA; bind an exact proposal identity; and present the
  exact V0.2 freeze decision to Colin. Build remains a separate release/commit-readiness choice.

### Relevant implementation, test, and contract paths

- `suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.internal.ts`
- `suggestion/tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts`
- `suggestion/docs/COMMON_SUGGESTION_EVIDENCE_LINEAGE_V0_1_CONTRACT.md`
- `suggestion/docs/COMMON_SUGGESTION_EVIDENCE_SOURCE_VERIFICATION_V0_2_CONTRACT.md`

### Related V0.2 proposal boundary

The corrected Common Suggestion Evidence Source Verification V0.2 document remains
`FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW`. It is not frozen, accepted, implemented, activated, or
released and grants no implementation authorization. Its proposed text must not be described as
implemented runtime behavior.

Stage10-2B remains private and every success branch remains `authoritative: false`; Stage10-2C alone
may first introduce an `authoritative: true` result or public authority path. The A/B/C same-engine
invariant remains unchanged: all arms use the identical Blabase adapter, suggestion engine, model,
prompt, configuration, ranking, guardrails, and output schema, with only the evidence set differing.
Dayflow remains capture, storage, privacy, OCR, and preprocessing evidence only and cannot supply
structured facts, suggestion-shaped semantics, final output, or engine-control signals.

This additive record preserves the accepted Stage10-2A history and supersedes only any statement
that the V0.1 per-source `recordCount` mismatch branch still conforms without the correction. It does
not rewrite the frozen V0.1 contract or claim that the proposed V0.2 runtime exists.

<!-- engine-change-record-section:ECR-STAGE10-V0-1-RECORD-COUNT-CONTRACT-ALIGNMENT-2026-08-22:end -->

<!-- engine-change-record-section:ECR-STAGE10-V0-1-RECORD-COUNT-QA-CORRECTION-2026-08-22:begin -->

## Engine Change Record Addendum: ECR-STAGE10-V0-1-RECORD-COUNT-QA-CORRECTION-2026-08-22

- Date: 2026-08-22
- Timezone: Asia/Seoul
- Owner: Colin
- Sole human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Parent record: `ECR-STAGE10-V0-1-RECORD-COUNT-CONTRACT-ALIGNMENT-2026-08-22`.
  This addendum preserves that entry as historical evidence for its earlier bytes and records the
  subsequent comprehensive-QA correction and current-byte validation.
- Status: The comprehensive-QA defect is corrected and the recorded current-byte full-suite,
  typecheck, and lint validation passed. A standalone focused command was not rerun for these exact
  bytes. Independent re-QA of the corrected implementation, tests, and V0.2 proposal remains
  pending, as do the correction commit identity and Colin's commit and freeze decisions.
- Classification: Behavior-changing correction that aligns the implementation with the
  already-frozen V0.1 failure-precedence predicate, plus a contract-only V0.2 type/status
  correction. No contract, schema, verifier, rule, public API, or other semantic version bump is
  introduced, and no new production authority is granted.
- Goal: Make combined root or `asOf` disagreement plus per-source count or ID-set disagreement
  resolve deterministically under the frozen V0.1 predicate, strengthen the regression assertions,
  and correct the unfrozen V0.2 proposal's source-specific diagnostic typing and validation-history
  statements without authorizing V0.2 runtime behavior.
- Affected pipeline stages: Private/internal Stage10-2A `record_set_binding` diagnostic precedence
  and focused synthetic tests; contract text and type/status statements in the unfrozen Stage10-2B
  V0.2 proposal. No public or authoritative Stage10-2B path is affected.
- Behavior before: When a root or `asOf` mismatch coexisted with a per-source `recordCount` or
  record-ID-set mismatch, the implementation appended root diagnostics first. The resulting failure
  was therefore `RECORD_SET_BINDING_MISMATCH`, contrary to the frozen V0.1 predicate that gives the
  per-source count/ID-set mismatch the deterministic `RECORD_ID_SET_MISMATCH` outcome.
- Behavior after: The implementation determines whether any per-source count or ID-set mismatch
  exists before adding root or `asOf` diagnostics. When such a mismatch exists, root and `asOf`
  diagnostics are suppressed and the result is deterministically `RECORD_ID_SET_MISMATCH`.
- Test coverage after: The affected tests use exact result-shape assertions and separately cover a
  combined root-plus-count mismatch and a combined root-plus-ID-set mismatch. They assert the
  absence of root diagnostics and downstream Stage 3 fields as well as the required
  `RECORD_ID_SET_MISMATCH` failure shape.
- V0.2 proposal correction: The proposal structurally restricts `TIMEZONE_PROFILE_INVALID` to
  `google_calendar` and distinguishes historical pre-QA-correction validation from current-byte
  validation. This is proposal text only; V0.2 remains unimplemented, unfrozen, and non-authorizing.
- Preserved behavior: The public facade, exports, input/result schema and versions, dependencies,
  model, prompt, configuration, ranking, guardrails, A/B/C same-engine invariance, Dayflow
  evidence-only boundary, privacy and retention behavior, and architecture, module, import, and
  system boundaries are unchanged. Stage10-2B remains private and always returns
  `authoritative: false`.
- Versions before: Frozen Common Suggestion Evidence Lineage V0.1 contract with the earlier
  count-classification correction described by the parent record; unfrozen Common Suggestion
  Evidence Source Verification V0.2 proposal at
  `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW`.
- Versions after: The same frozen V0.1 contract and existing private/public version surfaces, with
  implementation precedence aligned to the already-frozen predicate; the corrected V0.2 proposal
  remains `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW`, unfrozen, unimplemented, and non-authorizing.
  No version bump applies because the runtime correction restores the existing frozen predicate and
  the V0.2 edits correct proposal typing/status truth rather than freeze a new contract.
- Code commit: `TBD_UNCOMMITTED`. No Git identity is inferred or invented for these bytes.
- Exact V0.2 proposal identity: `TBD_AT_FREEZE`. No proposal hash or freeze identity is claimed.
- Evaluation dataset version and SHA-256: Not applicable. No Golden, Regression, Rolling, Holdout,
  or formal evaluation dataset changed or ran; the regression inputs are fictional synthetic tests.
- Candidate run ID: Not applicable. No model, provider, suggestion-generation, or evaluation run
  occurred.
- Comparison run ID: Not applicable. No comparable engine or suggestion outputs were generated.
- Commands executed: Parent-provided current-byte evidence from 2026-08-22 is recorded without
  rerunning any command in this documentation substep. `npm test` completed with exit 0 under
  Vitest v3.2.7: 168/168 test files and 1,593/1,593 tests passed; the
  `tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts` file contributed 48/48 passing tests
  with 102ms file time; reported total duration was 20.26s. `npm run typecheck` ran `tsc --noEmit`
  and completed with exit 0. `npm run lint` completed ESLint with exit 0. A standalone focused test
  command was not rerun for the current bytes. Build and architecture checks were not run, and no
  build or architecture PASS is claimed. No validation command or Git operation was run while
  appending this record.
- Historical validation supersession: The parent record's focused 47/47 and full-suite
  1,592/1,592 results remain truthful historical `PRE-QA-CORRECTION` evidence for the earlier bytes.
  They are superseded by the 1,593-test current-byte result for current readiness and must not be
  reused as validation of this correction.
- Metrics changed: Not applicable. Test counts and durations are engineering validation evidence,
  not semantic-quality, A/B/C, provider-latency, token, cost, product, or release metrics. No model
  or provider ran, so model identity, token usage, latency, and cost metrics are not applicable.
- Dependencies, data, and architecture: No production dependency, configuration, dataset, model,
  prompt, ranking, guardrail, module/import boundary, system boundary, or architecture boundary
  changed. Build and architecture checks were not run because this correction did not change those
  boundaries; their status is unknown rather than passing.
- Regressions or accepted exceptions: No known regression is accepted. The recorded validation
  establishes the stated automated checks for the corrected bytes but does not replace independent
  exact-byte re-QA or Colin's decisions. The absence of a standalone current-byte focused run is
  explicitly recorded; the same file's 48 tests passed within the full suite. Commit identity,
  exact proposal freeze identity, V0.2 freeze, and release authority remain unresolved.
- Privacy or retention impact: None. Only fictional synthetic test inputs were involved. No raw
  evidence, user or provider data, conversation, secret, credential, private artifact, or live
  source material was added or exposed. Collection, consent, storage, retention, and deletion
  behavior are unchanged.
- Compatibility: The public facade and schema/version surfaces are unchanged. The private failure
  selection now matches the existing frozen V0.1 predicate when per-source count/ID-set and
  root/`asOf` mismatches coexist. No V0.2 proposal type is represented as current runtime behavior.
- Release decision: Not released. The V0.2 proposal remains
  `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW`, unfrozen, unimplemented, and non-authorizing. This
  addendum does not authorize implementation, commit, freeze, activation, release, or production
  authority. Stage10-2B remains `authoritative: false`; Colin's explicit decisions remain required.
- Rollback method: Only with Colin's explicit decision, restore the prior diagnostic gating and
  associated tests, and restore the prior V0.2 type/status text. Such a rollback would knowingly
  reintroduce drift from the frozen V0.1 precedence predicate and invalid source scoping for
  `TIMEZONE_PROFILE_INVALID`. No rollback or destructive action was performed here.
- Follow-up work: Complete independent re-QA against these exact implementation, test, and proposal
  bytes; create and record the full correction commit SHA; bind the exact proposal identity at
  freeze; and present the separate commit and V0.2 freeze decisions to Colin. Build and architecture
  checks remain unrun and may be required only by a later, separately approved release-readiness
  scope.

### Relevant implementation, test, proposal, and parent-record paths

- `suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.internal.ts`
- `suggestion/tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts`
- `suggestion/docs/COMMON_SUGGESTION_EVIDENCE_SOURCE_VERIFICATION_V0_2_CONTRACT.md`
- `suggestion/docs/ENGINE_CHANGE_RECORD.md`

The A/B/C invariant continues to require the identical Blabase adapter, suggestion engine, model,
prompt, configuration, ranking, guardrails, and output schema in every arm, with only the evidence
set differing. Dayflow remains capture, storage, privacy, OCR, and preprocessing evidence only and
cannot supply structured facts, suggestion-shaped semantics, final output, or engine-control
signals.

This addendum supersedes the parent record only as evidence of readiness for the current corrected
bytes. It does not rewrite the parent record's historical facts, the frozen V0.1 contract, or any
prior commit identity, and it does not claim that the proposed V0.2 runtime exists.

<!-- engine-change-record-section:ECR-STAGE10-V0-1-RECORD-COUNT-QA-CORRECTION-2026-08-22:end -->

---

<!-- engine-change-record-addendum:ECR-STAGE10-2B1-IDENTITY-AND-QA-RECEIPT-2026-08-22:begin -->

## External Identity and QA Receipt: ECR-STAGE10-2B1-IDENTITY-AND-QA-RECEIPT-2026-08-22

- Date: 2026-08-22
- Timezone: Asia/Seoul
- Owner: Colin
- Sole human reviewer and decision authority: Colin
- Required David review, receipt, artifact, or approval: none
- Parent records:
  `ECR-STAGE10-V0-1-RECORD-COUNT-CONTRACT-ALIGNMENT-2026-08-22` and
  `ECR-STAGE10-V0-1-RECORD-COUNT-QA-CORRECTION-2026-08-22`.
- Status: External identity and QA evidence is bound to the exact parent correction commit and
  proposal blob. This receipt does not freeze or accept the proposal, authorize Stage10-2B
  implementation, activate GitHub or any provider capability, release anything, or produce an
  `authoritative: true` result.

### Bound immutable identities

- Correction/package commit SHA: `ceb8085ecf4f1b87173800041d0f2919a66bf567`
- Correction/package commit subject:
  `fix(suggestion): align Stage10 lineage verification contract`
- Exact proposal Git blob SHA: `0bdb0bc5d57d207ff1ff8b393d83a1d750eb7715`
- Proposal status in the bound blob: `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW`

At commit time, the bound correction/package commit contained exactly this scoped Stage10 package:

- `suggestion/src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.internal.ts`
- `suggestion/tests/dayflowCommonSuggestionEvidenceLineageV0_1.test.ts`
- `suggestion/docs/COMMON_SUGGESTION_EVIDENCE_SOURCE_VERIFICATION_V0_2_CONTRACT.md`
- `suggestion/docs/ENGINE_CHANGE_RECORD.md`

This receipt itself is not contained in that parent commit. It belongs to a later documentation
commit whose identity is intentionally not self-referenced here. If policy requires the receipt
commit identity, it must be recorded or reported after that commit exists.

The historical `TBD_UNCOMMITTED` and `TBD_AT_FREEZE` placeholders remain unchanged in their original
records. For external identity binding, they are resolved by the exact correction commit SHA and
proposal Git blob SHA recorded above. This resolution does not make the proposal frozen or accepted.

### Current-byte automated evidence

- `npm test`: Vitest 3.2.7; exit 0; 168/168 files and 1,593/1,593 tests passed.
- The affected lineage test file contributed 48/48 passing tests within the full suite, with 102ms
  file time.
- Full-suite reported duration: 20.26s.
- `npm run typecheck`: `tsc --noEmit`; exit 0.
- `npm run lint`: ESLint; exit 0.
- A standalone focused test was not rerun for the final bytes.
- Build and architecture checks were not run, and no build or architecture PASS is claimed.

These results are engineering validation evidence already recorded for the current bytes. They are
not semantic-quality, A/B/C, provider-latency, token, cost, product, release, or authority metrics.

### External QA chain

1. Comprehensive exact-source QA reviewed the corrected implementation, test, contract, and ECR
   bytes and found the V0.1 implementation/test closure complete. Its only remaining blocker was
   stale proposal status text. It did not approve freeze.
2. A status-only proposal edit corrected those statements without changing implementation, tests,
   ECR evidence, or technical contract semantics.
3. Fresh final document-only independent QA reviewed the final proposal blob and both Stage10 V0.1
   ECR records and returned `PASS`, with no Critical, High, Medium, or Low findings. The prior
   stale-status blocker was closed.
4. Together, those reviews cover the parent commit's implementation/test bytes and the final proposal
   blob. This receipt records that external chain; the proposal does not attest to itself.

This receipt satisfies the external binding of technical validation and QA to the parent correction
commit and proposal blob. It does not replace Colin's human decision.

### Governance and remaining gates

- The V0.2 proposal remains unfrozen, unaccepted, unimplemented, and non-authorizing.
- Stage10-2B remains private and `authoritative: false`.
- Stage10-2C alone may first activate authority or produce `authoritative: true`.
- No GitHub or other provider capability is activated.
- No implementation, product, production, release, or rollout authority is granted.
- Colin must review and decide every Section 20.1 item.
- Colin must explicitly approve or reject the external status transition and freeze.
- No David gate, review package, receipt, artifact, or approval applies.

### Privacy, retention, data, and execution boundary

Privacy and retention are unchanged. This receipt contains no raw evidence, user data, provider
data, conversation, secret, credential, private artifact, dataset, model, prompt, token record, or
provider call. No source, test, proposal, plan, architecture, package, dependency, schema, public API,
or runtime behavior is changed by this documentation-only receipt.

No test, validation, build, architecture, provider, or Git command was run while preparing or
appending this receipt.

### Release and rollback decision

- Release decision: Not released. The proposal remains
  `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW`.
- Receipt rollback: Revert or void this receipt only by Colin's explicit decision. Doing so removes
  the identity and QA binding recorded here but does not revert the parent correction code.
- Parent code rollback: Remains governed by the earlier Stage10 V0.1 Engine Change Records.

<!-- engine-change-record-addendum:ECR-STAGE10-2B1-IDENTITY-AND-QA-RECEIPT-2026-08-22:end -->
