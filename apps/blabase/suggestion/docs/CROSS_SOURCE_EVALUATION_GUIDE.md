# Cross-Source Suggestion Evaluation Guide

## 문서 정보

| 항목 | 값 |
|---|---|
| 문서 상태 | Phase 0 dev contract closed, Draft v0.4 |
| 기준일 | 2026-07-26 |
| 평가 schema | `cross-source-evaluation-case-v0.1` |
| reason code | `cross-source-reason-codes-v0.1` |
| Attention 정의 | `cross-source-attention-definition-v0.2` |
| 첫 dataset | `suggestion-cross-source-dev-v0.1` |
| dataset 상태 | Mutable Dev Candidate, revision 2 |
| 입력 경계 | `normalized_work_signals_and_relations` |
| 데이터 출처 | Synthetic only |

관련 파일:

- `suggestion/docs/CROSS_SOURCE_ATTENTION_DEFINITION.md`
- `suggestion/docs/CROSS_SOURCE_SUGGESTION_IMPLEMENTATION_PLAN.md`
- `suggestion/docs/PHASE2_GITHUB_CODEX_OBSERVABILITY_CONTRACT.md`
- `suggestion/src/evaluation/crossSourceDatasetSchema.ts`
- `suggestion/src/evaluation/crossSourceIntegrity.ts`
- `suggestion/src/evaluation/loadCrossSourceEvaluationDataset.ts`
- `suggestion/eval/synthetic/codexDetectorConfig.v0.1.json`
- `suggestion/eval/synthetic/crossSourceDevDataset.ts`
- `suggestion/tests/crossSourceDatasetSchema.test.ts`
- `suggestion/tests/phase2AttentionRouter.test.ts`
- `docs/ENGINE_DEVELOPMENT_RECORDS.md`

---

## 1. 목적

이 가이드는 Cross-source suggestion engine을 사람이 일관되게 평가하기 위한
절차다.

평가 질문은 다음 하나로 요약된다.

> 고정된 시점의 증거만 보았을 때, Work Cockpit에는 무엇을 보여주고 그중 어떤
> 사용자 개입을 지금 한 가지로 제안해도 안전한가?

평가는 Work Cockpit을 기본 화면으로 두고, 그 위에 “지금 개입할 한 가지”를
표시하는 presentation contract를 전제로 한다.

평가자는 개인적인 업무 선호로 바로 top item을 고르지 않는다. 먼저 observation,
candidate, gate, coverage를 판정하고 마지막에 decision을 정한다.

이 문서는 ranking weight나 threshold의 정답을 주장하지 않는다. 변경 가능한
가설을 비교할 수 있도록 입력과 기대 판단을 명시하는 것이 목적이다.

초기 제품 적용 범위는 GitHub와 Codex를 함께 쓰는 AI-native 1인 개발자,
인디 메이커, 작은 스타트업 개발자다. GitHub 또는 Codex를 사용하지 않는
사용자는 첫 release 평가 범위 밖이며, Notion과 Google Calendar 사례는
후속 context/constraint source의 안전 경계를 미리 검증한다.

---

## 2. 이번 평가가 다루는 경계

### 2.1 v0.1의 입력 경계

첫 Dev Dataset은 다음 경계를 평가한다.

```text
Synthetic normalized signal + pre-resolved relation
→ claim resolution
→ overview와 candidate 분리
→ eligibility
→ coverage 판단
→ lane과 selection
→ result status
```

즉, connector native payload를 runtime `WorkSignal`로 변환하는 adapter 정확도와
relation resolver의 정확도는 아직 이 dataset의 평가 범위가 아니다. `relations`
필드에는 `explicit_native`, `user_configured`, `deterministic_policy`로 이미
해결된 relation을 입력한다. v0.1 evaluator가 relation을 발견했다고 해석하지
않는다.

schema의 `workSignals`는 평가 전용 `SyntheticNormalizedSignal`이다. 이름은
fixture 호환성을 위해 유지하지만 runtime `WorkSignal`과 동일한 타입을
주장하지 않는다. Phase 1의
`mapRuntimeBatchToSyntheticEvaluationSignals`가 두 타입 사이의 명시적 mapping
contract와 integration fixture 경계를 제공한다.

Phase 1은 native snapshot을 strict runtime artifact와 typed `WorkSignal`로
옮기고, ordered native observation과 history sufficiency를 보존하도록
완료했다.
현재 connector에 없는 의미 상태나 lifecycle을 채우거나 최종 candidate
eligibility를 판정하지 않는다.

이 경계를 먼저 택한 이유는 다음과 같다.

- connector 구현이 다른 세션에서 계속 바뀌어도 Attention 계약을 먼저 검증할 수
  있다.
- source별 raw payload를 Git에 넣지 않고 판단 엔진을 개발할 수 있다.
- connector 오류와 recommendation 오류를 분리할 수 있다.
- 동일한 합성 입력으로 policy 변경을 반복 비교할 수 있다.

### 2.2 아직 다루지 않는 것

- 실제 GitHub, Notion, Calendar, Codex snapshot adapter 정확도
- 운영 사용자 데이터 분포
- production click, dismiss, inactivity를 이용한 자동 학습
- 자연어 explanation의 문체 선호
- 실제 제품 품질 또는 release readiness
- connector별 pagination, OAuth, rate limit의 통합 동작

adapter 평가는 이후 `source_snapshot` 경계의 별도 fixture와 integration test로
추가한다. 두 경계의 지표를 하나로 합쳐 보고하지 않는다.

v0.1 schema는 의도적으로 `dataOrigin = synthetic`,
`containsProductionData = false`만 허용한다. 승인된 익명·최소화 production-derived
평가셋이 필요해지면 이 literal을 완화하지 않고, 적법성 검토와 별도의 schema 및
dataset version을 만든다.

### 2.3 현재 Codex v2와 미래 contract 분리

dataset tag를 반드시 구분한다.

```text
current_codex_v2
future_candidate_capable_codex
```

`current_codex_v2` 사례는 현재 연결된 `codex-snapshot-v2`가 실제로 제공하는
metadata-only 범위를 나타낸다. 이 범위는 execution exception에 대해
`overview_only`다.

현재 v2의 optional `taskSummary`는 사용자가 표시를 opt-in한 경우 overview
label 단서로만 사용할 수 있고 semantic task/progress 상태는 `unknown`이다.
summary만으로 사용자 obligation이나 completion을 만들지 않는다.
follow-through는 explicit GitHub relation 또는 사용자가 설정한 project
workflow가 있을 때만 검토한다.

따라서 현재 v2의 `active`, approval badge, `system_error`만으로 다음을 평가하거나
지원한다고 주장하면 안 된다.

- verified stall
- active failure
- completed follow-through
- scope drift
- 오래 지속된 approval/input escalation
- 전체 Attention에 대한 `no_action`

`future_candidate_capable_codex` 사례는 richer ordered snapshot contract와
detector가 생겼을 때의 정책을 미리 검증하는 합성 사례다. 이 tag가 통과해도 현재
connector가 해당 기능을 제공한다는 뜻은 아니다.

---

## 3. Dataset 종류와 lifecycle

| 종류 | 목적 | 수정 정책 |
|---|---|---|
| Dev Candidate | 정의, schema, policy 개발 | 자유롭게 추가·수정 |
| Golden | 핵심 계약 baseline | freeze 후 불변 |
| Regression | 확인된 오류 재발 방지 | 검토된 새 version으로 추가 |
| Rolling | 최근 사용 분포 확인 | 주기적으로 교체 |
| Locked Holdout | 출시 전 일반화 확인 | routine 개발에서 비공개 |

현재 `suggestion-cross-source-dev-v0.1`은 Dev Candidate다.

```text
lifecycle.state = mutable
datasetSha256 = null
immutableRef = null
frozenAt = null
review.status = draft
```

이 dataset은 Golden이 아니며 제품 품질 baseline도 아니다. 사례의 label과
구조를 변경할 수 있다.

다만 mutable이라는 이유로 한 번 실행한 입력의 재현성을 포기하지 않는다.
material change마다 `datasetRevision`을 증가시키며 revision 번호를 재사용하지
않는다. 평가 run은 `datasetVersion + datasetRevision + materialized dataset
SHA-256`을 함께 기록한다. 실행에 사용한 artifact는 private immutable store에
보존하고, Dev Candidate의 최신 파일과 동일하다고 가정하지 않는다.

현재 materialized revision 기록:

| Revision | SHA-256 | 변경 |
|---:|---|---|
| 1 | `795578a9f907e23ae1e517852292ba69e4d28c21ec50e7d878cd60e8f9e08e21` | Phase 0 최초 30 case |
| 2 | `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df` | 적극 추천 tie policy와 Attention Definition v0.2 반영 |

각 synthetic normalized snapshot에는 canonical SHA-256이 있다. derived Codex
signal은 실제 materialized detector config fixture와 그 hash를 참조한다. frozen
dataset hash는 `lifecycle.datasetSha256` 자체를 제외한 canonical JSON으로
계산한다.

### 3.1 Freeze 금지 조건

다음 중 하나라도 해당하면 Golden으로 freeze하지 않는다.

- definition 해석에 reviewer 불일치가 남음
- source fact 또는 identity가 불명확함
- expected top set과 forbidden set이 합의되지 않음
- 모든 case가 독립 review와 adjudication을 마치지 않음
- canonical JSON artifact와 SHA-256이 없음
- dataset, schema, reason code, policy version이 기록되지 않음
- production-derived data의 적법성, 최소화, 익명화 검토가 없음

frozen dataset을 수정해야 하면 기존 version을 덮어쓰지 않고 새 version과 hash를
만든다.

---

## 4. 평가 case의 구조

### 4.1 판단 시점과 사용자 context

각 case는 다음을 고정한다.

- `decisionAt`
- `timezone`
- optional weekly `primaryOutcome`
- primary outcome의 `capturedAt`, `validUntil`
- active project ID

평가자는 `decisionAt` 이후에 알게 된 사실이나 현재 live source를 보지 않는다.

primary outcome은 ranking context다. 다음을 하지 않는다.

- goal과 연결되지 않은 eligible item을 자동으로 ineligible 처리
- goal 문구에서 deadline 또는 consequence 생성
- 오래된 goal을 현재 goal처럼 사용

제품 입력 cadence는 기본적으로 일주일에 한 번이며 사용자가 직접 변경할 때
즉시 갱신한다. case의 `capturedAt`과 `validUntil`은 이 cadence를 재현해야 한다.

### 4.2 Source snapshot window

각 source window는 다음을 기록한다.

- source
- fresh, stale, partial, failed, disconnected 상태
- `candidate_capable`, `overview_only`, `unsupported` capability
- decision에 material한 source인지 여부
- candidate set이 complete한지 여부
- observation 시작과 종료
- truncation
- 순서가 보존된 snapshot reference
- snapshot SHA-256
- schema와 normalizer version

snapshot은 observation window 안에 있어야 하고 `fetchedAt` 순으로 엄격하게
정렬돼야 한다.

failed 또는 disconnected source에는 성공한 snapshot을 넣지 않는다. truncated,
stale, partial, overview-only source는 complete negative candidate coverage를
주장할 수 없다.

### 4.3 SyntheticNormalizedSignal

평가용 `SyntheticNormalizedSignal`은 source가 증명하거나 versioned
deterministic policy로 파생한 최소 사실이다.

필수 항목:

- stable synthetic `signalId`
- source와 native ID
- subject, subject type과 optional project ID
- signal kind
- observation time
- evidence level과 completeness
- JSON-safe facts
- snapshot evidence reference
- optional safe destination

금지:

- raw prompt, response, command output
- private repository path
- credential, token, email
- LLM이 추측한 deadline, urgency, consequence
- connector native payload 전체
- `undefined`, 함수, class instance와 같은 비-JSON 값

### 4.4 Relation

cross-source relation은 제목 유사성으로 만들지 않는다.

허용 authority:

- `explicit_native`
- `user_configured`
- `deterministic_policy`

모든 relation은 evidence signal을 참조해야 한다.

### 4.5 Annotation

한 annotation은 하나의 평가 대상에 대해 overview와 candidate를 분리한다.

```ts
type AttentionDisposition = {
  overview: "include" | "exclude";
  candidate: "eligible_signal" | "review_required" | "excluded";
};
```

annotation은 다음 label을 각각 보존한다.

- overview 포함 여부와 허용 Codex state
- candidate disposition
- eligibility
- required, acceptable, forbidden intervention
- 허용 rankable lane
- candidate 추천 금지 여부
- overview, candidate, why-now, gate, review reason code
- first-step evidence와 destination 요구

다음 조합만 허용한다.

| Candidate disposition | Eligibility |
|---|---|
| `eligible_signal` | `eligible` |
| `review_required` | `review_required` |
| `excluded` | `ineligible` |

eligible annotation만 `must_now`, `unblock`, `close_loop`, `focus` lane을 가질 수
있다.

### 4.6 Decision

전체 case decision은 다음을 기록한다.

- expected status
- 허용 가능한 top item 집합
- 절대 추천 금지 item 집합
- decision reason code
- optional clarification question intent

단일 `topItemId`만 정답으로 두지 않는다. 같은 계약에서 여러 top이 허용되면
`acceptableTopItemIds`에 함께 기록한다.

### 4.7 Pairwise preference

pairwise preference는 모든 가능한 ranking을 완전 순서로 만들기 위한 장치가
아니다. 강한 근거가 있는 비교만 기록한다.

예:

```text
이번 주 primary outcome과 직접 연결된 GitHub issue
>
연결되지 않은 open Notion task

reason = WHY_NOW_PRIMARY_OUTCOME_ALIGNED
```

자기 자신과의 비교와 preference cycle은 schema가 거부한다.

---

## 5. 평가 순서

각 reviewer는 다음 순서를 지킨다.

### Step 1. 입력 admissibility

- snapshot이 `decisionAt` 이전인가?
- window 안에 있고 순서가 보존됐는가?
- source status와 truncation이 드러나는가?
- signal이 같은 source snapshot을 참조하는가?
- current Codex v2와 future contract가 구분됐는가?

입력 자체가 재현 불가능하면 ranking을 평가하지 않는다.

### Step 2. Overview

- Work Cockpit에 보여야 하는 observation인가?
- Codex state의 허용 집합은 무엇인가?
- activity를 progress, stall, failure로 과장하지 않았는가?
- resolved transient request가 overview에 남지 않았는가?

overview 정확도와 recommendation 정확도는 별도다.

### Step 3. Candidate disposition

다음 순서로 확인한다.

```text
Source usable?
→ Grounded?
→ Identity/relation resolved?
→ Current and open?
→ User/shared intervention?
→ Actionable first step?
→ Safe destination?
→ No critical conflict?
```

통과 전에는 lane이나 score를 계산하지 않는다.

### Step 4. Intervention과 lane

- primary intervention이 evidence에서 직접 가능한가?
- first-step이 intervention보다 작고 구체적인가?
- lane에 필요한 강한 근거가 있는가?
- activity, recency, request age가 lane을 부당하게 높이지 않았는가?

### Step 5. Coverage

다음을 구분한다.

```text
complete
limited_but_sufficient
insufficient
```

coverage 판단은 source 연결 개수가 아니라 현재 decision에 필요한 claim이
검증됐는지를 기준으로 한다.

### Step 6. Decision status

eligible set, review-required set, coverage를 본 뒤에만 전체 status를 정한다.

### Step 7. Explanation과 first-step

- why-now code가 실제 evidence와 일치하는가?
- native destination이 있는가?
- source에 없는 날짜, urgency, consequence를 만들지 않았는가?
- partial coverage를 숨기지 않았는가?

### Step 8. Hard failure

hard failure가 하나라도 있으면 top ranking이 우연히 맞아도 전체 case를
정답으로 보지 않는다.

---

## 6. Coverage와 status 결정표

| 상황 | Expected status |
|---|---|
| complete coverage, 명확한 eligible top | `suggested` |
| limited source가 있지만 독립적으로 완결된 positive candidate | `suggested` |
| eligible 후보가 동등하고 preference만 불명확 | 결정적 기본 후보를 `suggested`, 동급 caveat와 alternatives 표시 |
| review-required 후보를 사용자 답 하나로 해결 가능 | `needs_clarification` |
| source refresh, history, baseline 보강이 필요 | `insufficient_evidence` |
| overview-only source만 있고 positive candidate 없음 | `insufficient_evidence` |
| truncation이나 stale source가 candidate set을 바꿀 수 있음 | `insufficient_evidence` |
| complete candidate-capable coverage이며 열린 개입 없음 | `no_action` |
| 평가 범위와 독립적인 source만 실패했고, 선언한 범위에는 열린 개입 없음 | scoped `no_action` |
| fresh complete source 사이의 critical conflict가 해결되지 않음 | `insufficient_evidence` |

### 6.1 `no_action` 필수 조건

다음을 모두 만족해야 한다.

- coverage가 `complete`, 또는 실패 source가 명시적으로 non-material인
  `limited_but_sufficient`
- `negativeCandidateCoverageComplete = true`
- fresh, non-truncated, candidate-capable source가 하나 이상
- 선언한 decision 범위의 candidate set complete
- material uncertainty source 없음
- eligible item 없음
- review-required item 없음

Calendar-only 또는 현재 Codex v2 activity-only로 전체 Attention에 대한
`no_action`을 라벨링하지 않는다.

scoped `no_action`은 “모든 연결 도구에 할 일이 없다”가 아니다. 사용자 문구는
“현재 평가 가능한 범위에서 개입할 일이 없음”으로 제한하고 평가하지 못한
source를 함께 표시한다.

### 6.2 Partial coverage의 positive candidate

Notion fetch가 실패해도 fresh GitHub review request의 다음 field가 완결돼 있으면
제한된 suggestion이 가능하다.

- current open state
- user reviewer
- non-draft
- native destination
- Notion 상태와 무관한 identity

위 조건은 synthetic fixture나 future native contract처럼 `isDraft = false`를
직접 제공하는 입력에만 적용한다. 현재 connector review signal은 `isDraft`가
없으므로 Phase 1 normalization만으로 non-draft를 추정하거나 최종 eligible
review candidate를 만들지 않는다. Phase 2A는 safe destination이 있으면
별도의 provisional `inspect` 후보로 “draft 여부와 리뷰 가능 상태 확인”까지만
허용하며 실제 `review` intervention과 구분한다.

이때:

```text
coverage = limited_but_sufficient
positiveCandidateIndependentOfUnknowns = true
status = suggested
```

사용자 문구에는 Notion을 평가하지 못했음을 표시한다.

### 6.3 Complete source conflict

두 source가 모두 fresh이고 candidate set도 complete하더라도 owner, state,
identity, deadline 같은 critical claim이 충돌하면 coverage는 충분하지 않다.

```text
coverage = insufficient
uncertaintyBasis = critical_conflict
materialUncertaintySources = [충돌 source]
status = insufficient_evidence
```

### 6.4 Clarification과 refresh

사용자에게 묻는 질문:

```text
이 작업은 지금 사용자가 맡아야 합니까, 아니면 agent가 계속 진행해야 합니까?
```

source가 해결해야 하는 질문:

```text
Codex가 정말 멈췄습니까?
GitHub snapshot에 누락 item이 있습니까?
```

두 번째 종류는 사용자 clarification으로 넘기지 않고
`insufficient_evidence`와 source refresh/history 보강으로 처리한다.

---

## 7. Reason code label

v0.1은 68개의 정확한 reason code를 enum으로 고정한다.

| Bucket | 개수 | 책임 |
|---|---:|---|
| Overview | 16 | Cockpit에 보여주는 관찰 |
| Candidate | 12 | 후보가 존재하는 근거 |
| Why-now | 6 | 지금 선택하는 강한 근거 |
| Gate | 16 | candidate 제외 근거 |
| Review | 11 | 추가 확인이 필요한 근거 |
| Decision | 7 | 전체 결과 상태와 선택 |

code를 다른 bucket에 넣거나 정의되지 않은 문자열을 추가하면 schema validation이
실패한다.

LLM은 reason code를 추가, 삭제, 변경하지 않는다. explanation은 code와 검증된
field를 읽기 쉽게 표현할 뿐이다.

reason code의 의미를 바꾸면 다음을 수행한다.

- reason-code version 증가
- mutable Dev Case label 갱신
- frozen dataset은 새 version 생성
- 동일 frozen input으로 targeted regression
- semantic behavior가 바뀌면 Engine Change Record

---

## 8. Codex 평가 기준

### 8.1 Meaningful progress

허용:

- phase transition
- privacy-safe artifact state 변경
- test/build 결과 변경
- failure clear
- explicit completion

금지:

- heartbeat
- timestamp refresh
- polling
- 같은 로그 또는 오류 반복
- session이 열려 있다는 사실

### 8.2 Verified stall

다음이 모두 있어야 한다.

- stable execution identity
- ordered fresh window
- 실행 지속 예상
- phase별 threshold 초과
- meaningful progress 없음
- 정상 장기 phase나 expected-next-event가 아님
- 최신 snapshot에서도 미해결
- 안전한 inspect/resume destination

stall state가 확인돼도 goal, obligation, downstream block 연결이 없으면
overview-only다.

### 8.3 Active failure

- failure가 직접 또는 deterministic rule로 확인됨
- 최신 window에서도 active
- recovered가 아님
- 중요한 outcome이나 downstream block과 연결
- 사용자가 열 수 있는 destination과 first-step 존재

`system_error` badge 하나는 active failure가 아니다.

### 8.4 Follow-through

- execution completion 확인
- user-configured workflow 또는 explicit relation
- grace period 경과
- handoff가 아직 open
- 사용자가 수행 가능한 후속조치

workflow가 없으면 commit, PR, review를 추정하지 않는다.

### 8.5 Scope drift

Dev Case `AD-DEV-CX-011`은 다음이 모두 있는 평가 전용 사례다.

- expected baseline
- observed scope
- deterministic versioned rule
- policy enabled
- user intervention과 destination

이 사례는 현재 production scope-drift 기능을 켠다는 의미가 아니다.

### 8.6 Approval과 input

- stable request ID
- pending lifecycle
- `requestedAt`
- unresolved, unexpired
- threshold 초과
- execution을 실제로 block
- safe destination

request age는 urgency 또는 `must_now`의 근거가 아니다.

---

## 9. 오류 taxonomy와 hard failure

오류는 먼저 pipeline stage로 분류한다.

### 9.1 Candidate와 identity

```text
missing_candidate
false_candidate
wrong_identity_merge
missed_identity_merge
wrong_state
wrong_owner
wrong_dependency
```

### 9.2 근거와 priority

```text
false_deadline
false_urgency
wrong_lane
wrong_ranking
unsafe_first_step
stale_source_used
privacy_scope_violation
```

### 9.3 Codex execution

```text
wrong_execution_state
missing_execution_overview_item
false_stall
missed_stall
false_failure
missed_failure
false_follow_through
missed_follow_through
false_scope_drift
missed_scope_drift
transient_request_escalated_too_early
stale_ephemeral_attention
healthy_execution_recommended
unsupported_progress_summary
```

### 9.4 Decision

```text
missed_clarification
unnecessary_clarification
missed_no_action
false_no_action
```

다음은 preference 차이가 아니라 hard failure다.

- forbidden item 추천
- completed, cancelled, replaced item 추천
- 정상 Codex execution 추천
- current v2 activity를 verified exception으로 해석
- recovered failure 추천
- resolved 또는 expired request 추천
- workflow 없는 follow-through 생성
- baseline 없는 scope drift 생성
- 근거 없는 deadline, urgency, consequence
- stale, partial, truncated 상태 은폐
- evidence 없는 first-step
- raw private content 노출
- stable ID 기본 선택을 더 중요하다는 근거처럼 표현하거나 caveat 없이 숨김

---

## 10. Metric 계산 원칙

### 10.1 명확한 계약 지표

- candidate recall
- state와 owner accuracy
- evidence와 deadline precision
- conflict detection
- false merge rate
- completed/cancelled recommendation rate
- unsupported urgency rate
- stale/truncated source misuse rate
- Codex execution-state accuracy
- Codex overview coverage
- false-stall rate
- execution exception precision/recall
- configured follow-through precision
- resolved/expired transient request leakage

### 10.2 선택 지표

- Acceptable@1
- pairwise preference accuracy
- clarification precision/recall
- no-action accuracy
- abstention precision
- first-step actionability

### 10.3 Draft Dataset에서 하지 않을 주장

현재 30개 case가 모두 통과해도 다음을 말하지 않는다.

- 실제 사용자에게 85% 이상 유용하다.
- production distribution을 대표한다.
- release gate를 통과했다.
- current Codex connector가 future exception 기능을 지원한다.
- human-approved Gold가 준비됐다.

초기 metric은 schema, rubric, pipeline의 빈틈을 찾기 위한 진단 값이다.

---

## 11. Reviewer와 adjudication

### 11.1 Dev Candidate

Dev Case는 다음으로 시작할 수 있다.

- 작성자 1명
- 별도 reviewer 1명
- 수정 가능한 `draft` 또는 `reviewed` 상태

현재 30개 사례는 모두 `draft`다.

### 11.2 첫 Golden 권장 조건

- 두 명의 독립 reviewer
- 서로의 label을 보기 전 독립 판정
- overview와 candidate label 별도
- acceptable top set과 forbidden set 별도
- 불일치 원본 label 보존
- adjudicator가 차이를 분류하고 결정
- 모든 case가 `frozen`
- canonical JSON, immutable reference, dataset SHA-256

### 11.3 불일치 분류

| 종류 | 예 |
|---|---|
| Source fact 차이 | PR이 실제로 merged인지에 대한 해석 |
| Definition 차이 | stall에 material link가 필요한지 |
| Identity 차이 | Codex execution과 GitHub issue가 같은 work인지 |
| Preference 차이 | 두 eligible focus item 중 허용 top |
| Schema 결함 | 필요한 label을 현재 field가 표현하지 못함 |

평균이나 다수결만으로 원래 판단을 삭제하지 않는다.

---

## 12. 재현성과 version 기록

평가 run은 최소 다음을 기록한다.

- run ID
- `asOf`
- dataset version, revision과 실행 시 materialized hash
- code commit SHA
- schema, reason code, definition version
- source normalizer version
- detector config immutable ref와 SHA-256
- identity, claim, eligibility, lane, ranking policy version
- snapshot 순서와 hash
- output hash
- reason code
- error taxonomy
- latency, error, token usage가 생기면 해당 값

loader는 다음을 하지 않는다.

- 현재 시각 읽기
- snapshot 정렬
- 누락 label 생성
- reason code 보정
- default status 추론
- hash를 frozen hash처럼 승격

`loadCrossSourceEvaluationDataset()`은 전달받은 artifact를 그대로 Zod parse한다.

parse 성공은 hash 검증 성공을 뜻하지 않는다. 평가 runner는 parse 직후
`verifyCrossSourceEvaluationDatasetIntegrity()`를 호출해 다음을 별도로
검증한다.

- snapshot envelope와 materialized signal의 canonical hash
- referenced detector config artifact의 canonical hash
- frozen dataset canonical hash

hash가 하나라도 맞지 않거나 config artifact를 resolve하지 못하면 해당 run을
평가 지표에 포함하지 않는다.

평가 실행의 기본 entrypoint는 parse와 검증을 묶은
`loadVerifiedCrossSourceEvaluationDataset()`이다. parse-only loader는 schema
오류를 따로 진단하는 도구로만 사용한다.

---

## 13. 첫 Dev Dataset 구성

총 30개 synthetic case다.

| 그룹 | 개수 | 핵심 범위 |
|---|---:|---|
| 현재 Codex v2 | 3 | activity, request badge, system error의 overview-only 경계 |
| Future Codex contract | 14 | progress, stall, failure, follow-through, scope, request lifecycle |
| GitHub | 3 | assigned issue, review request, authored PR context |
| Calendar | 2 | constraint-only, explicit linked preparation |
| Notion | 3 | 일반 page, mapped open task, completed task |
| Cross-source decision | 5 | goal ranking, tie, partial positive, truncation, no-action |

결과 상태 분포:

| Status | 개수 |
|---|---:|
| `suggested` | 12 |
| `needs_clarification` | 0 |
| `no_action` | 10 |
| `insufficient_evidence` | 8 |

중요 case:

| Case | 검증 계약 |
|---|---|
| `AD-DEV-CV2-001` | current active를 candidate 또는 no-action 근거로 쓰지 않음 |
| `AD-DEV-CX-003` | material block과 연결된 verified stall |
| `AD-DEV-CX-004` | unlinked stall은 overview-only |
| `AD-DEV-CX-007` | recovered failure 누출 금지 |
| `AD-DEV-CX-008` | workflow 없는 follow-through 금지 |
| `AD-DEV-CX-009` | configured open handoff만 close-loop |
| `AD-DEV-CX-013` | resolved request 제거 |
| `AD-DEV-CX-014` | ordered stable request history와 실제 block이 있을 때만 escalation |
| `AD-DEV-GH-003` | non-material Notion 실패를 표시한 scoped no-action |
| `AD-DEV-CA-001` | Calendar-only로 task/no-action 생성 금지 |
| `AD-DEV-DS-002` | 동급 후보도 적극적으로 하나를 선택하되 허용 top set과 default-pick 성격을 보존 |
| `AD-DEV-DS-003` | 독립 positive candidate는 partial coverage에서도 허용 |
| `AD-DEV-DS-004` | truncation 상태에서 no-action 금지 |
| `AD-DEV-DS-005` | complete negative coverage에서 no-action 허용 |

Golden 후보 전에는 stale source, complete-source critical conflict, expired
request, clarification으로 eligibility가 바뀌는 사례, current Codex v2의
`idle`/`not_loaded`/`unknown`, 그리고 “task summary 기본 unknown + workflow
미설정 시 follow-through 금지” 사례를 추가한다.

revision 2는 사용자의 적극 추천 결정을 반영해 `AD-DEV-DS-002`를
`needs_clarification`에서 `suggested`로 변경했다. 두 review item은 여전히
모두 acceptable top이며, runtime policy는 deterministic default 한 개와
alternative를 반환한다. revision 1의 materialized hash와 변경 전 label은
Engine Change Record에 보존한다.

---

## 14. Validation

현재 schema test가 검증하는 핵심:

- mutable synthetic dataset parse
- 30개 case와 네 결과 상태별 분포 검증(현재 `needs_clarification`은 0개)
- current Codex v2와 future contract 분리
- 68개 reason code의 유일성
- snapshot, materialized detector config, frozen dataset canonical hash 검증
- hash 계산 후 signal을 바꾼 artifact 거부
- 중복 case ID 거부
- 잘못된 snapshot evidence reference 거부
- reason bucket 오배치 거부
- candidate-capable coverage 없는 no-action 거부
- 실패 source를 숨긴 complete coverage label 거부
- non-material 실패 source가 있는 scoped no-action 허용
- complete source 사이 critical conflict가 실제 두 source subject와 conflict
  review label을 참조하는지 검증
- 독립성이 없는 partial suggestion 거부
- immutable detector config 없는 derived Codex signal 거부
- 서로 다른 ordered snapshot의 stable history가 없는 request escalation 거부
- Codex execution/request subject type 오표기 거부
- request reason을 request subject와 lifecycle evidence 없이 execution에 붙인 label 거부
- resolved/expired request의 overview 또는 candidate 잔존 거부
- complete evidence와 native destination 없는 first-step 거부
- unrelated subject의 first-step evidence 거부
- dataset class/version과 decision status/reason 불일치 거부
- `decisionAt` 이후 evidence와 작성자를 reviewer로 센 기록 거부
- draft case를 frozen Golden이라고 주장하는 lifecycle 거부
- obvious secret과 raw private path 부재

실행:

```bash
cd suggestion
npm test -- tests/crossSourceDatasetSchema.test.ts
npm run typecheck
npm run lint
```

---

## 15. 현재 완료 기준과 다음 단계

이 단계는 다음을 만족해 Phase 0 dev evaluation contract를 종료한다.

- 평가 경계가 `normalized_work_signals_and_relations`로 명확함
- Zod schema가 strict validation을 수행함
- reason code bucket이 분리됨
- no-action과 partial coverage invariant가 code로 검증됨
- current Codex v2와 future contract case가 분리됨
- synthetic Dev Case가 20~30개 존재함
- dataset revision 규칙이 있고 mutable artifact가 frozen hash를 주장하지 않음
- parse와 integrity verification이 분리돼 둘 다 검증됨
- test, typecheck, lint가 통과함

다음 구현 단계:

```text
[Phase 1 완료]
native snapshot
→ strict runtime envelope
→ source별 typed WorkSignal normalizer
→ ordered native observation + history sufficiency

[Phase 2A 완료]
current GitHub direct/provisional candidate
+ current Codex overview
→ aggressive evidence-bound selection
→ scoped no-action / insufficient-evidence
→ deterministic result integrity

[다음: Phase 2B]
richer connector contract와 충분한 history
→ progress / exception / lifecycle detector
→ claim / relation resolver
→ evaluation runner
```

처음부터 ranking weight를 세밀하게 튜닝하지 않는다. 30개 Dev Case에서 hard
failure와 label 불일치를 먼저 줄인 뒤, reviewer agreement가 안정되면 첫
Golden 후보를 만든다. human review와 adjudication은 Phase 6, Golden freeze와
release decision은 Phase 7의 후속 작업이다. Phase 2A targeted runtime
decision tests는 추가됐지만 frozen Cross-source Golden과 full synthetic
decision evaluator는 아직 없으며 제품 route에도 연결하지 않았다.
