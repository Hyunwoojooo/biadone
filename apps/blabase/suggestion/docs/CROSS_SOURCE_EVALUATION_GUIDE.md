# Cross-Source Suggestion Evaluation Guide

## 문서 정보

| 항목 | 값 |
|---|---|
| 문서 상태 | Developer Signal Intelligence v0.1 baselines recorded, Draft v0.7 |
| 기준일 | 2026-08-05 |
| 평가 schema | `cross-source-evaluation-case-v0.1` |
| reason code | `cross-source-reason-codes-v0.1` |
| Attention 정의 | `cross-source-attention-definition-v0.2` |
| 첫 dataset | `suggestion-cross-source-dev-v0.1` |
| dataset 상태 | Mutable Dev Candidate, revision 2 |
| 입력 경계 | `normalized_work_signals_and_relations` |
| 데이터 출처 | Synthetic only |
| Eligibility expectation revision | `suggestion-attention-eligibility-dev-v0.2`, revision 3 |
| Active decision expectation revision | `suggestion-active-attention-dev-v0.2`, revision 3 |

관련 파일:

- `suggestion/docs/CROSS_SOURCE_ATTENTION_DEFINITION.md`
- `suggestion/docs/CROSS_SOURCE_SUGGESTION_IMPLEMENTATION_PLAN.md`
- `suggestion/docs/DEVELOPER_SIGNAL_INTELLIGENCE.md`
- `suggestion/docs/ENGINE_CHANGE_RECORD.md`
- `suggestion/docs/PHASE2_GITHUB_CODEX_OBSERVABILITY_CONTRACT.md`
- `suggestion/src/evaluation/crossSourceDatasetSchema.ts`
- `suggestion/src/evaluation/crossSourceIntegrity.ts`
- `suggestion/src/evaluation/loadCrossSourceEvaluationDataset.ts`
- `suggestion/eval/synthetic/codexDetectorConfig.v0.1.json`
- `suggestion/eval/synthetic/crossSourceDevDataset.ts`
- `suggestion/tests/crossSourceDatasetSchema.test.ts`
- `suggestion/tests/phase2AttentionRouter.test.ts`
- `suggestion/src/evaluation/activeAttentionDecisionEvaluation.ts`
- `suggestion/eval/synthetic/activeAttentionDecisionCases.v0.1.json`
- `suggestion/eval/synthetic/activeAttentionDecisionConfig.v0.2.json`
- `suggestion/eval/synthetic/eligibilityGateExpectations.v0.2.json`
- `suggestion/eval/synthetic/activeAttentionExpectations.v0.2.json`
- `suggestion/tools/run-active-attention-baseline.ts`
- `suggestion/docs/LOCAL_LAUNCHER_CONTRACT.md`
- `suggestion/tests/launcherProjection.test.ts`
- `suggestion/tests/launcherService.test.ts`
- `suggestion/tests/launcherJsonl.test.ts`
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

### 2.3 Core revision 2의 Codex v2 tag와 active runtime 분리

기존 30-case core dataset은 작성 당시의 경계를 재현하기 위해 다음 tag를
그대로 보존한다. 이 이름은 현재 live runtime version을 뜻하지 않는다. 현재
connector는 `codex-snapshot-v3`를 사용한다.

```text
current_codex_v2
future_candidate_capable_codex
```

`current_codex_v2` 사례는 해당 dataset revision이 평가한
`codex-snapshot-v2` metadata-only 범위를 나타낸다. 이 범위는 execution exception에 대해
`overview_only`다.

해당 historical v2 contract의 optional `taskSummary`는 사용자가 표시를 opt-in한 경우 overview
label 단서로만 사용할 수 있고 semantic task/progress 상태는 `unknown`이다.
summary만으로 사용자 obligation이나 completion을 만들지 않는다.
follow-through는 explicit GitHub relation 또는 사용자가 설정한 project
workflow가 있을 때만 검토한다.

따라서 해당 historical v2 contract의 `active`, approval badge, `system_error`만으로 다음을 평가하거나
지원한다고 주장하면 안 된다.

- verified stall
- active failure
- completed follow-through
- scope drift
- 오래 지속된 approval/input escalation
- 전체 Attention에 대한 `no_action`

`future_candidate_capable_codex` 사례는 richer ordered snapshot contract와
detector 정책을 미리 검증한 합성 사례다. Phase 4B는 이 중 Blabase-owned managed
run의 direct failure와 configured completion follow-through만 별도 exact active
evaluator로 승격했다. verified stall, scope drift와 approval/input escalation은
여전히 active 범위가 아니다. 기존 tag 통과를 현재 connector 능력 주장으로
사용하지 않는다.

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
- historical `current_codex_v2` tag와 future contract가 구분됐는가?

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
| fresh complete source 사이의 relevant critical conflict를 사용자만 해결 가능 | `needs_clarification` |
| stale/history/source refresh로 해결해야 하는 relevant critical conflict | `insufficient_evidence` |

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

Calendar-only 또는 historical `current_codex_v2` activity-only로 전체 Attention에 대한
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
identity, deadline 같은 critical claim이 충돌하면 해당 후보는 ranking에서
제외한다. 전체 unresolved conflict count가 아니라 후보의 exact target 또는
relation에 연결된 conflict만 material하다.

```text
coverage = insufficient
uncertaintyBasis = critical_conflict
materialUncertaintySources = [충돌 source]
candidate = review_required
```

후속 route는 conflict의 해결 주체에 따라 나눈다.

```text
nextAction = user_review
→ eligible 후보가 없을 때 needs_clarification

nextAction = refresh_sources 또는 history_gap
→ insufficient_evidence
```

다른 exact target의 unresolved conflict는 정상 후보를 막지 않는다. authority나
freshness로 이미 해결된 conflict도 hard block이 아니다. terminal 후보는 다른
field conflict가 있더라도 불필요한 clarification을 만들지 않고 `ineligible`이
우선한다.

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
| historical `current_codex_v2` | 3 | activity, request badge, system error의 overview-only 경계 |
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
request, clarification으로 eligibility가 바뀌는 사례, historical `current_codex_v2`의
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
- historical `current_codex_v2`와 future contract 분리
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
- historical Codex v2와 future contract case가 분리됨
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

[Phase 2B·3·4B 완료 범위]
managed direct-fact history
→ exact relation / claim / conflict
→ current eligibility
→ active candidate / lane / ranking / decision
→ replay v2 / monitor v0.4

[Phase 4C local beta 완료 범위]
local supervisor
→ 단축키 launcher
→ Work Cockpit 즉시 실행/관찰

[Developer Signal Intelligence v0.1 완료]
GitHub snapshot v3 authored-PR actionability
+ Codex OpenLoopClaim ledger-only extraction
→ Developer Work Ledger
→ Candidate Funnel
→ Eligibility v0.2
→ Active Attention v0.5
→ live/monitor v0.5
→ aggregate public summary

[다음]
GitHub App 권한 승인과 actionability coverage 확인
→ run별 funnel summary 영속화
→ Codex OpenLoop currentness 검증
→ dashboard/root identity handshake
→ full Xcode·Developer ID·notarization
→ Calendar fit / Notion task mapping
→ human-reviewed Developer Attention Dataset
```

처음부터 ranking weight를 세밀하게 튜닝하지 않는다. 30개 Dev Case에서 hard
failure와 label 불일치를 먼저 줄인 뒤, reviewer agreement가 안정되면 첫
Golden 후보를 만든다. human review와 adjudication은 Phase 6, Golden freeze와
release decision은 Phase 7의 후속 작업이다. Phase 4B active evaluator와 제품
route는 연결됐지만 frozen Cross-source Golden과 locked holdout은 아직 없다.

---

## 16. Phase 4B active Attention baseline

Phase 4B는 기존 30-case core dataset을 active runtime 품질 주장으로 재사용하지
않고, exact replayable evidence envelope를 입력으로 받는 별도 deterministic
evaluator를 추가했다. 이 절의 v0.4/revision 2 값은 Developer Signal Intelligence
이전의 historical baseline이며 최신 revision 3 baseline은 18절에 기록한다.

### 16.1 버전과 범위

- input/result: `cross-source-active-attention-input-v0.4` /
  `cross-source-active-attention-result-v0.4`
- policy: `aggressive-evidence-bound-attention-policy-v0.3`
- candidate rule: `github-managed-codex-active-candidate-rule-v0.1`
- lane/ID: `active-attention-lane-policy-v0.1` /
  `active-attention-id-v0.1`
- ranking/resolver: `active-attention-ranking-policy-v0.2` /
  `active-attention-decision-resolver-v0.3`
- live/monitor/replay: `attention-live-orchestrator-v0.4` /
  `attention-monitor-run-v0.4` / `attention-replay-input-v2`

평가 범위는 GitHub direct-work, managed Codex direct failure, configured completion
follow-through, four-lane ordering, weekly focus inheritance, relevant conflict,
source refresh와 user-review 분기, scoped no-action, deduplication, recovery,
workflow timing/closure/artifact/action-target compatibility, archived project
exclusion, `request_review` authored-PR relationship, inactive link, coverage,
privacy와 determinism이다. verified stall, scope drift, stable request
escalation, Calendar fit과 Notion task 후보는 포함하지 않는다.

### 16.2 재현 기록

- dataset: `suggestion-active-attention-dev-v0.1`, revision `2`, mutable synthetic
  Dev Candidate, `44` cases
- dataset canonical SHA-256:
  `e10bf1fa0415e39003f5d03d760feb75dbe13dac1e606253e78ebb1ab9f0f290`
- materialized input SHA-256:
  `b1b467a42f1de6564e1a2d08a48b3823c74077fe87c9eb8af4318112480e1c58`
- config version/ref: `active-attention-decision-config-v0.2` /
  `eval/synthetic/activeAttentionDecisionConfig.v0.2.json`
- config SHA-256:
  `f8da1f5c0b8f55aaa6acffbd6885bdf4a1a759ca0c0f3cf61d84dcb35b6df30b`
- code fingerprint SHA-256:
  `71b0319dfc2e53866081c6b9b73f0ed1815c1fb5204a2a3b75edeae7d32e72a3`
- deterministic output SHA-256:
  `1be64deabff76cc625de4e7ac8dd292fe5d403380cbdf9308cb6108dbaa3a276`
- run ID: `active_attention_eval_run_1a661f6515069b5721c9bbce775677d2`
- canonical record payload SHA-256:
  `f8c9311a46f2893225f0c378cd24ad410877573ad4c5a49daea81efaba6f3f80`
- record artifact SHA-256:
  `c4606ff0d7db7e20dfc7d6b60bda863c8bd619457df0a1a616b468bd7bca80d7`
- exact result: cases `44/44`, assessments `80/80`, latency `609ms`, 모든 release
  guardrail `0`

revision 1의 `active_attention_eval_run_325d24b34e38226344b2adbc11f1648f`
(`42/42`, `76/76`)은 archived-project와 authored-PR audit gate 추가 전
pre-audit candidate history로 보존한다. 입력 dataset과 resolver version이 달라
revision 2의 직접 comparison baseline으로 사용하지 않는다.

artifact는 `.local/evaluations/active-attention`의 mode `0600` local private
record다. production data, raw prompt/answer, command/output, diff/path/thread를
포함하지 않는다.

### 16.3 Dependency compatibility

같은 Phase 4B 작업 계열에서 dependency behavior 변경을 별도 mutable revision으로
재평가했다. active final baseline과 dependency run의 dirty-worktree fingerprint는
서로 다르며, frozen dataset은 수정하지 않았다.

- Claim Authority revision 2:
  `claim_authority_run_0079980ec2ea503ca9718bc48f8846e6`, cases `40/40`,
  resolutions `42/42`, conflicts `9/9`, dataset SHA-256
  `809e459b2e27e26791ce20ba4599450818425b48603ba76cb2a8cad45544fe4d`
- Eligibility revision 2:
  `attention_eligibility_run_acaa74c69c3f8fa721eeb253d9916400`, cases `26/26`,
  assessments `24/24`, dataset SHA-256
  `7e53abbdf7ccf64ec30152c3fdd0c08161db10f5e2b191286745cbe729bb0343`

전체 회귀는 Vitest `79` files / `670` tests, typecheck, lint와 production build를
통과했다. 신규 unit regression은 archived-project workflow 제외,
review-requested 다른 사용자의 PR 제외와 client partial expected identity의 local
fail-closed, 명시적으로 전달된 빈 identity pair의 server 검증을 포함한다. Work
Resumption browser E2E는 exact managed binding open, identity mismatch fail-closed를
포함해 Chromium `3/3`을 통과했다.

### 16.4 해석 제한

이 baseline은 human review를 거치지 않은 mutable synthetic development contract다.
따라서 실제 사용자 유용성, production 분포의 precision/recall 또는 정식 release
readiness를 주장하지 않는다. production conversation이나 implicit feedback을
Golden으로 자동 승격하지 않으며, 첫 Golden은 독립 review와 adjudication 후 새
version/hash로 freeze한다.

같은 target의 managed run이 동일 millisecond `startedAt`을 가지면 authoritative
newer ordering을 증명하지 못하므로 오래된 failure supersession이 지연될 수 있다.
임의 ID tie-break를 최신성 근거로 쓰지 않으며 후속 monotonic run-start sequence
계약이 필요하다.

또한 이 baseline 이전의 resolver v0.2로 기록된 monitor v0.4/failure v0.3 local
record는 현재 v0.3 semantic replay와 직접 동등하지 않다. 현재 local monitor
store에는 해당 record가 없지만 formal release 전 versioned migration 또는 안전한
invalidation 계약을 추가해야 한다.

---

## 17. Phase 4C launcher compatibility 검증

Phase 4C는 Active Attention의 input, candidate, eligibility, lane, ranking,
selection과 explanation을 변경하지 않는다. 기존 Phase 4B 결과를 초기
`blabase-launcher-attention-v1`, 현재 `blabase-launcher-attention-v2` public
projection으로 축소하고 명시적
`focus_or_resume`를 기존 Work Resumption queue에 전달하는 transport/OS integration
변경이다. 따라서 frozen Golden이나 active decision baseline은 재실행하지 않았다.

v2는 제안이 없을 때 일반 문구만 보이던 문제를 수정하기 위해 기존
decision reason code, candidate counts와 source monitor 요약을 추가한다. 런처는
이 값으로 GitHub·Codex의 연결, freshness, signal count, candidate coverage를
설명하고 둘 중 하나라도 복구가 필요할 때 root ownership에 맞는 복구 동작을
제공한다. 단, Swift가
후보를 새로 생성·제외·재정렬하지 않는다. v2 regression은 상태/reason,
decision/count, canonical source 순서와 candidate completeness 불일치를 TypeScript과
Swift decoder 모두에서 fail closed하는지 검증한다.

자동 검증 결과:

- launcher/provenance TypeScript targeted regression: `5` files, `41/41` tests
- 전체 Vitest regression: `83` files, `702/702` tests
- TypeScript typecheck, ESLint와 Next.js production build 통과
- Swift debug와 release executable build 통과
- XCTest 비의존 Swift model smoke 통과: request ID, projection invariant, exact URL
  allowlist, child environment injection 제거, runtime provenance와 bounded supervisor
  restart
- bundled Node/Agent JSONL process smoke와 종료 후 Companion heartbeat 정리 통과
- split oversized JSONL frame의 64 KiB bounded recovery, data-root physical symlink
  검증, 5분 recommendation TTL과 read-only shared-root source writer gate 통과
- `.app` nested ad-hoc signature, build source provenance, 실제 bundled Agent SHA-256,
  runtime manifest, Node/Agent syntax, license/notice와 private artifact 부재 검증 통과
- DMG SHA-256 sidecar, ad-hoc signature, read-only mount, mounted `.app` 재검증과
  `/Applications` shortcut 통과. exact checksum은 Git 밖의 생성된
  `Blabase-dev-beta.dmg.sha256`에 기록

실제 앱을 기존 local data root로 실행한 수동 UI 검증에서는 메뉴바 host와 Local
Agent child가 함께 실행됐고, 당시 기본값인 `⌥ Space` 등록 성공 상태가 footer에
표시됐다. 이후 기본 단축키를 `⇧ Space`로 변경했으며 Swift build와 model smoke로
등록 상수·표시값 일치를 검증했다. 현재 평가 결과의 `insufficient_evidence`, scope
statement와 `미평가: GitHub`가 손실 없이
렌더링됐으며 source refresh 완료와 `Esc` panel close를 확인했다. 추천 실행 버튼은
실제 외부 동작을 만들지 않기 위해 수동 검증에서 누르지 않았고, stale/current
identity와 중복 실행 방지는 unit regression으로 검증했다.

현재 Command Line Tools 설치에는 XCTest module과 full Xcode가 없어 authored Swift
XCTest suite는 이 머신에서 실행하지 못했다. 동일 source의 debug/release build와
독립 model smoke, 실제 app integration으로 보완했지만 external beta CI에서는 full
Xcode로 `swift test`를 추가 실행해야 한다. 현재 DMG는 ad-hoc 서명된 local
development beta이며 Developer ID notarized release나 production 품질 주장이 아니다.

---

## 18. Developer Signal Intelligence v0.1 baseline

Developer Signal Intelligence v0.1은 GitHub authored PR actionability를 실제 후보로
연결하고, Codex historical content에서 추출한 OpenLoopClaim을 currentness 검증
전까지 ledger-only로 제한한다. 기존 mutable v0.1 revision 2 case source와 기대값을
덮어쓰지 않고 eligibility와 Active 각각의 v0.2 revision 3 expectation artifact를
추가했다. frozen Golden/Regression dataset은 변경하지 않았다.

### 18.1 현재 버전과 범위

- GitHub snapshot/actionability normalizer:
  `github-snapshot-v3` / `github-pr-actionability-normalizer-v0.3`
- eligibility projection/policy/evidence/resolver:
  `attention-eligibility-shadow-projection-v0.1` /
  `hard-attention-eligibility-policy-v0.2` /
  `attention-eligibility-evidence-v0.2` /
  `attention-eligibility-resolver-v0.2`
- Active input/result/policy/candidate/ranking/resolver:
  `v0.4 / v0.5 / v0.4 / v0.2 / v0.3 / v0.4`
- live orchestrator/monitor/failure/replay:
  `v0.6 / v0.6 / v0.5 / v3`
- Work Ledger, Candidate Funnel과 runtime projection: v0.1
- Codex OpenLoop schema/rule/evidence/expiry: v1

revision 3 baseline은 기존 26개 eligibility case와 44개 Active case의 입력 source를
바꾸지 않고 새 version tuple의 deterministic output expectation을 별도 artifact로
검증한다. authored PR의 세 actionability 상태, 단순 open·draft·unknown 제외, v2
snapshot compatibility, partial coverage positive 보존, Codex historical claim의
currentness fail-closed, ledger/funnel determinism과 public aggregate privacy는 별도
bounded synthetic Vitest regression으로 검증했다. 이 unit regression을 baseline case나
human-approved Gold로 계산하지 않는다.

GitHub unresolved review thread, Project priority/dependency, Codex current open-loop
lifecycle과 실제 사용자 유용성은 이번 baseline과 bounded regression 범위에 포함하지
않는다.

### 18.2 재현 기록

Eligibility revision:

- dataset: `suggestion-attention-eligibility-dev-v0.2`, revision `3`
- dataset SHA-256:
  `3bb839262a78095b5a54a4e73c105802c41f276fe19a5743fadd50c20bd235d4`
- materialized input SHA-256:
  `1d1a2ab3fd41cc53a2437e74b874b988fdeb5d7794fd105f2a401da75745f034`
- config SHA-256:
  `33c2719e45d6d3715053c44e87f5d5e36317f0457e3ee939ca76aa36c53a2e57`
- deterministic output SHA-256:
  `00e1008c24b1c57a66c626a2db8fc78ab74c6c28499919fe79ea6297916ed703`
- run ID: `attention_eligibility_run_cecf4c97681437b38b3857ddd6cfccfc`
- result: cases `26/26`, assessments `24/24`

Active revision:

- dataset: `suggestion-active-attention-dev-v0.2`, revision `3`
- dataset SHA-256:
  `fc8be53b229f4c685591e34b005a4e99fbf49eb7722cc86cd4aeab97f04c8a26`
- materialized input SHA-256:
  `baa7a6ec69173b4207e4409b900519c3148ad06995726aad78f9e2d6ef79f940`
- config SHA-256:
  `f8da1f5c0b8f55aaa6acffbd6885bdf4a1a759ca0c0f3cf61d84dcb35b6df30b`
- deterministic output SHA-256:
  `6ce881d595ab1476e95f33710c5ee7c6cd9be412d492b2b79daa26faf71c0d55`
- record payload SHA-256:
  `9bffa9f0bf7b6010c96528d3d3b51b1b2ed35cca841765e2d31ce3055a47f099`
- run ID: `active_attention_eval_run_056c3ce2e6084663841f28a20d408088`
- result: cases `44/44`, assessments `80/80`

두 run의 evaluation-time code provenance는 `codeCommitSha=null`,
`codeState=dirty_worktree`와 fingerprint
`d59d2fdbe5e26ae0d678a3f8ca7e055348647e5c54d86efee3dfdd6c023320d8`다.
이 구현은 이후 commit `8e2fe01af08f141ccbb3e424549620543f3c6857`로 materialize됐지만,
기존 run ID를 그 clean commit에서 재실행한 것으로 소급하지 않는다.

### 18.3 검증과 해석 제한

- full Vitest: `87/87` files, `732/732` tests passed
- suggestion typecheck, ESLint와 production build: passed
- eligibility와 Active deterministic baseline: passed
- provider/model/prompt/token usage: `not_applicable`
- public Developer Signal summary는 hash/count만 포함하고 원문, URL, local path와
  credential을 strict schema에서 거부

이 baseline은 human review를 거치지 않은 mutable synthetic development contract다.
실제 precision/recall, 사용자 만족도나 external release readiness를 주장하지 않는다.
production conversation, implicit feedback과 LLM judge score는 자동으로 Gold가 되지
않으며, Developer Attention Golden Dataset은 별도 privacy review, human review와
adjudication 후 새 version/hash로 freeze해야 한다.
