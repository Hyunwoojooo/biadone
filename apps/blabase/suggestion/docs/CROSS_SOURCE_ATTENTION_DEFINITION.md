# blabase Cross-Source Attention Definition v0.2

> Notion, Google Calendar, GitHub, Codex와 선택적인 대화 신호 중 무엇을
> 단순 현황으로 보여주고, 무엇을 사용자의 다음 개입 후보로 승격할지 정의하는
> Cross-source Observation + Action Layer의 규범 문서

| 항목 | 값 |
|---|---|
| 문서 상태 | Normative definition v0.2 active; implementation synchronized through Phase 4C.2 and Developer Signal Intelligence v0.1 |
| Definition ID | `cross-source-attention-definition-v0.2` |
| 기준일 | 2026-08-05 |
| 적용 대상 | `suggestion/`의 별도 Cross-source 엔진 |
| 기존 엔진 | `suggestion-engine-v0.3`은 별도 경로로 유지 |
| 상위 계획 | `CROSS_SOURCE_SUGGESTION_IMPLEMENTATION_PLAN.md` |
| Developer signal 설계 | `DEVELOPER_SIGNAL_INTELLIGENCE.md` |
| 규범 기록 | `docs/ENGINE_DEVELOPMENT_RECORDS.md` |
| 구현 상태 | Phase 0·1, Phase 2A·2A.1, Phase 2B.0·2B.1·2B.2A, Phase 3A·3B·3C, Phase 4A·4B, Phase 4C·4C.1·4C.2 local beta와 Developer Signal Intelligence v0.1 구현 |

---

## 1. 문서 목적

이 문서는 다음 네 질문에 일관되게 답하기 위한 기준이다.

```text
1. 이 정보는 현황판에 보여줄 관찰 정보인가?
2. 사용자의 실제 개입이 필요한 후보인가?
3. 후보라면 어떤 개입이 필요한가?
4. 후보가 없거나 판단할 수 없을 때 어떤 결과를 반환하는가?
```

이 문서는 Cross-source 엔진의 **추천 대상 정의**를 고정한다. 구현 파일 구조,
정확한 점수 가중치, 시간 threshold 숫자, UI 배치는 별도 정책과 구현 계획에서
다룬다.

이 정의가 필요한 이유는 단순하다.

- 최근 활동이 많다고 중요한 일은 아니다.
- Codex 실행이 진행 중이라고 사용자가 해야 할 일은 아니다.
- Calendar에 일정이 있다고 준비 task가 존재하는 것은 아니다.
- Notion 페이지가 수정됐다고 열린 task인 것은 아니다.
- GitHub PR을 작성했다고 지금 사용자가 개입해야 하는 것은 아니다.

따라서 source record를 한 목록에 넣고 바로 점수화하지 않는다. 먼저 관찰 정보와
개입 후보를 분리하고, 추천하면 안 되는 항목을 제외한 뒤에만 우선순위를
판단한다.

### 1.1 이 문서가 고정하는 것

- `Work Cockpit`과 `Attention Router`의 역할 경계
- `attention`과 `intervention`의 의미
- overview-only 정보와 추천 후보의 구분
- source별 허용 의미와 추론 금지 범위
- hard eligibility와 review-required 조건
- Codex 정상 진행, 정체, 실패, 완료 후 후속조치의 경계
- 결과 상태와 intervention type
- 평가자가 사례를 라벨링하는 순서
- 초기 reason code vocabulary

### 1.2 이 문서가 고정하지 않는 것

- stall threshold의 정확한 시간
- source별 freshness TTL 숫자
- lane 사이의 최종 우선순위
- ranking weight
- Calendar buffer와 first-step 예상 시간
- 사용자별 개인화 계수
- 최종 추천 문구
- connector의 전체 API schema

위 값은 모두 versioned hypothesis다. Dev Dataset과 replay evaluation 결과로
변경할 수 있다.

### 1.3 기존 정의와의 관계

`TASK_DEFINITION.md`는 conversation-only v0.3 경로에 계속 적용한다. 이 문서는
별도 Cross-source 경로의 규범이다.

conversation candidate를 Cross-source 엔진의 WorkSignal로 가져올 때 두 문서가
모두 적용되는 영역에서는 더 엄격한 evidence, owner, state 규칙을 사용한다.
이 문서를 이유로 기존 v0.3의 assistant-only obligation 금지나 exact evidence
계약을 완화하지 않는다.

`BLABASE_SEMANTIC_CORE_V1.md`는 다음 행동 추천을 의도적으로 다루지 않는다.
Semantic Core 타입을 확장하거나 connector record를 가짜 conversation
message로 변환하지 않는다.

### 1.4 초기 제품 적용 범위

첫 release는 GitHub와 Codex를 함께 쓰는 AI-native 1인 개발자, 인디 메이커,
작은 스타트업 개발자에게 적용한다.

- GitHub는 work item과 review 요청을 관찰하는 첫 source다.
- Codex는 execution observability를 제공하는 첫 source다.
- GitHub 또는 Codex를 사용하지 않는 사용자는 초기 release 범위 밖이다.
- Notion과 Google Calendar는 이후 mapped task, project context와 시간
  constraint를 보강한다.

이 문서는 이후 source의 안전 경계도 정의하지만, 문서에 정의됐다는 사실이
첫 release 지원 또는 현재 connector capability를 뜻하지 않는다.

---

## 2. 핵심 제품 계약

Cross-source 제품은 두 기능을 함께 제공한다.

```text
Work Cockpit
→ 기본 화면에서 정상 진행을 포함해 연결된 작업의 현재 상태를 보여준다.

Attention Router
→ Cockpit 위에 그중 사용자가 실제로 개입할 수 있고 개입할 가치가 있는
  “지금 개입할 한 가지”를 보여준다.
```

두 기능을 분리하지 않으면 정상적으로 수행 중인 agent, 최근 수정된 페이지,
곧 시작하지 않는 일정까지 모두 할 일처럼 보이게 된다.

### 2.1 사용자에게 하는 약속

제품이 할 수 있는 약속:

> 연결되고 갱신된 범위에서 현재 확인되는 실행 상태와 열린 루프를 보여주고,
> 사용자의 실제 개입이 필요한 항목이 있으면 근거와 함께 제안한다.

제품이 하면 안 되는 약속:

```text
당신에게 가장 중요한 일을 알고 있습니다.
반드시 지금 이것을 해야 합니다.
연결하지 않은 영역까지 포함해 전체 우선순위를 판단했습니다.
Codex가 멈춘 이유를 원문 없이 정확히 알고 있습니다.
```

### 2.2 두 출력은 독립적이다

- overview item이 있어도 recommendation은 `no_action`일 수 있다.
- 하나의 Codex execution은 overview와 recommendation 양쪽에 나타날 수 있다.
- overview에 표시된 최근 활동은 ranking 점수가 아니다.
- recommendation이 없다고 연결된 작업이 없다는 뜻은 아니다.
- source가 실패해 recommendation을 만들 수 없어도 마지막으로 검증된
  overview를 stale label과 함께 보여줄 수 있다.
- overview 정확성과 recommendation 정확성은 별도 지표와 label로 평가한다.

### 2.3 이 엔진은 Priority Task Scorer가 아니다

이 엔진은 모든 record에 임의의 urgency와 impact 기본점을 주지 않는다.

처리 순서는 다음과 같다.

```text
Source Evidence
→ Observation
→ Candidate Derivation
→ Hard Eligibility
→ Attention Lane
→ Within-lane Ranking
→ Recommendation Decision
```

점수는 eligibility를 만들지 못한다. 추천 대상이 아닌 항목은 높은 점수를 받아도
후보가 될 수 없다.

---

## 3. 핵심 용어

| 용어 | 정의 |
|---|---|
| Source fact | source-native field와 snapshot에서 직접 확인한 값 |
| Observation | source fact 또는 검증된 결정적 파생 상태 |
| WorkSignal | evidence와 시각, source identity가 붙은 정규화된 관찰 단위 |
| Work item | GitHub issue, mapped Notion task처럼 결과나 의무를 나타내는 대상 |
| Execution | Codex session처럼 work item을 수행할 수 있는 실행 과정 |
| Open loop | 아직 닫히지 않은 의무, 협업 요청, 실행 예외 또는 후속조치 |
| Attention | 사용자의 인지나 판단만이 아니라 실제 개입 가능성이 검증된 상태 |
| Intervention | 열린 루프를 진전시키기 위해 사용자가 취할 수 있는 구체 행동 종류 |
| Attention candidate | 공통 resolver와 hard gate로 보낼 가치가 있는 후보 signal |
| AttentionItem | identity, state, owner, evidence, intervention이 해결된 후보 |
| Overview item | 정상 상태를 포함해 현황판에 보여줄 관찰 결과 |
| Decision | suggested, clarification, no-action, insufficient-evidence 중 하나 |

### 3.1 Work item과 execution은 다르다

GitHub issue 또는 Notion task는 해야 할 결과를 표현한다. Codex execution은 그
결과를 만들기 위한 실행 과정이다.

```text
GitHub issue #38
└── executes ← Codex execution A
    └── produces → changed artifacts
```

Codex execution이 완료돼도 GitHub issue 또는 Notion task가 자동으로 완료되는
것은 아니다. 반대로 issue가 닫혔다고 과거 execution record를 삭제하지 않는다.

가능한 관계:

```text
executes
produces
related_to
blocks
prepares_for
```

execution과 work item을 같은 identity로 자동 merge하지 않는다.

### 3.2 Open loop의 범위

Open loop에 포함할 수 있는 것:

- 사용자에게 배정된 아직 열린 work item
- 다른 사람이 요청한 현재 유효한 review
- 검증된 임박 마감과 연결된 준비
- 중요한 outcome을 막는 미복구 실행 실패
- 의미 있는 진전 없이 검증된 정체
- 실행 완료 후 명시적으로 예상된 후속조치
- 해결되지 않은 결정 또는 승인 요청

Open loop가 아닌 것:

- 정상적으로 진행 중인 execution
- 완료, 취소 또는 대체된 work item
- assistant만 제안하고 사용자가 수락하지 않은 일
- activity timestamp만 최근인 record
- source에 없는 마감이나 영향
- 다른 사람을 기다리는 것 외에 지금 가능한 행동이 없는 상태

---

## 4. Attention의 규범적 정의

하나의 signal이 추천 가능한 attention이 되려면 다음 조건을 모두 만족해야 한다.

```text
AttentionRequired(signal, asOf) =
  Current
  AND Open
  AND Grounded
  AND UserOrSharedIntervention
  AND Actionable
  AND SafeDestination
  AND NoCriticalConflict
```

이 식은 점수 공식이 아니라 hard gate다.

### 4.1 Current

- 판단 기준 시각 `asOf`에서 여전히 유효하다.
- source snapshot이 정책상 충분히 fresh하다.
- resolved, expired, cancelled 상태가 아니다.
- 일시적 요청이면 동일 request ID의 최신 lifecycle state가 `pending`이다.

### 4.2 Open

- AttentionItem 자체의 상태가 completed, cancelled 또는 replaced가 아니다.
- Codex source execution이 completed인 것은 허용될 수 있다.
- 이 경우 열린 대상은 execution이 아니라 아직 남은 `close_loop` 후속조치다.

### 4.3 Grounded

- 최소 하나의 source evidence가 존재한다.
- 직접 source field 또는 검증된 deterministic derivation이다.
- 파생 상태는 사용한 snapshot window와 policy version으로 재생 가능하다.
- 제목 유사성 또는 LLM 문구만으로 identity나 상태를 확정하지 않는다.

### 4.4 UserOrSharedIntervention

- 사용자가 직접 행동해야 하거나 shared ownership이 명시돼 있다.
- agent가 독립적으로 계속 수행할 수 있으면 후보가 아니다.
- external owner만 행동할 수 있으면 기본적으로 `wait`다.
- 단순히 사용자가 상태를 궁금해할 수 있다는 이유만으로 후보가 되지 않는다.

### 4.5 Actionable

- 지금 또는 현재 planning horizon 안에 가능한 행동이 있다.
- first-step을 source evidence 범위 안에서 만들 수 있다.
- blocked 상태라도 사용자가 block을 해제할 수 있어야 한다.
- 기다리는 것 외에 행동이 없으면 추천하지 않는다.

### 4.6 SafeDestination

- source-native item 또는 privacy-safe open reference가 있다.
- 사용자가 첫 행동을 시작할 위치를 알 수 있다.
- private raw path, token, command 전체를 노출하지 않는다.

### 4.7 NoCriticalConflict

- identity, owner, state, deadline의 critical conflict가 해결됐다.
- 최신 timestamp 하나만으로 모든 conflict를 덮어쓰지 않는다.
- 사용자가 한 질문으로 해결할 수 있으면 `needs_clarification`을 고려한다.
- source refresh가 필요하면 `insufficient_evidence`를 반환한다.

---

## 5. Observation과 candidate의 분류

각 관찰은 `asOf` 기준으로 overview 표시와 candidate 판정을 별도로 갖는다.

```ts
type AttentionDisposition = {
  overview: "include" | "exclude";
  candidate: "eligible_signal" | "review_required" | "excluded";
};
```

| 표현 | Overview | Candidate | 예시 |
|---|---|---|---|
| overview-only | include | excluded | 정상 running Codex execution |
| candidate-only | exclude | eligible signal | GitHub review request |
| overview + candidate | include | eligible signal | 검증된 Codex failure |
| overview + review | include | review required | history가 부족한 stall 의심 |
| review-only | exclude | review required | owner conflict가 있는 hidden item |
| fully excluded | exclude | excluded | resolved approval request |

### 5.1 Overview-only 원칙

다음은 기본적으로 overview-only다.

- 정상적으로 진전 중인 Codex execution
- queued, idle, not-loaded execution
- 추가 workflow가 설정되지 않은 최근 완료 execution
- 중요도 판단에 사용할 수 없는 activity count
- 일반 Notion page의 최근 수정
- Calendar free/busy와 다음 일정
- authored GitHub PR의 단순 open 상태

### 5.2 Overview와 candidate를 동시에 허용하는 경우

Codex exception은 같은 execution을 두 관점으로 보여줄 수 있다.

```text
Overview
→ 결제 API 실행: failed

Attention candidate
→ 결제 API 실패 원인을 확인하고 복구
```

중복 task를 만드는 것이 아니다. overview는 실행 상태이고 AttentionItem은
사용자의 열린 개입이다.

### 5.3 Review-required는 약한 추천이 아니다

`review_required`를 낮은 confidence suggestion으로 노출하지 않는다.
이는 내부 assessment 상태이며 최종 `CrossSourceSuggestionStatus`가 아니다.

가능한 처리:

- 사용자가 답할 수 있는 한 질문으로 해결: `needs_clarification`
- source refresh 또는 추가 필드가 필요: `insufficient_evidence`
- 제품 범위 밖의 불확실성: candidate 제외

---

## 6. Evidence와 source 사용 계약

### 6.1 Evidence 수준

| 수준 | 의미 | Candidate 사용 |
|---|---|---|
| `explicit` | source field가 상태를 직접 표현 | 허용 |
| `accepted_context` | 사용자가 명시적으로 수락한 문맥 | 조건부 허용 |
| `derived` | versioned deterministic rule로 파생 | 원본 signal이 모두 검증된 경우 허용 |
| `inferred` | 의미 종합이나 추측이 필요 | review 전용 |
| `unsupported` | 근거 없음 | 금지 |

LLM이 만든 요약은 evidence가 아니다. LLM 문구는 검증된 field를 설명하는 데만
사용할 수 있다.

### 6.2 Snapshot 계약

- 모든 판단은 하나의 고정된 `asOf`를 사용한다.
- source별 fetched time, scope, status, truncation을 기록한다.
- Codex 정체와 복구는 단일 snapshot이 아니라 ordered snapshot window를 쓴다.
- item이 다음 snapshot에서 사라진 사실만으로 완료 처리하지 않는다.
- partial snapshot이 후보 집합을 바꿀 수 있으면 결과를 안전하게 낮춘다.
- disconnected source가 있으면 recommendation 범위를 사용자에게 명시한다.
- 이미 기록한 source fact를 correction으로 덮어쓰지 않는다. 새 observation과
  별도 user correction signal을 추가한다.

### 6.3 Freshness와 completeness

정확한 TTL은 policy version에서 정한다. 정의 수준에서는 다음을 고정한다.

- stale source의 상태를 현재 사실처럼 표현하지 않는다.
- truncation이 top decision을 바꿀 수 있으면 `insufficient_evidence`다.
- 누락 source가 있어도 남은 fresh source만으로 안전한 판단이 가능하면
  제한된 범위를 밝히고 진행할 수 있다.
- source 하나가 연결됐다는 이유만으로 반드시 suggestion을 만들지 않는다.

### 6.4 Identity와 ownership

- provider의 stable native ID를 우선한다.
- 사용자 확인 없는 이름 또는 email 유사성으로 actor를 합치지 않는다.
- project mapping은 사용자 확인 또는 explicit native relation을 우선한다.
- 제목 유사성만으로 cross-source item을 merge하지 않는다.
- user/shared/external/agent/unknown owner를 분리한다.

### 6.5 Candidate capability coverage

source가 fresh하다는 사실과 attention을 판정할 필드가 충분하다는 사실을
분리한다.

```ts
type AttentionCapability =
  | "candidate_capable"
  | "overview_only"
  | "unsupported";
```

- `candidate_capable`: 해당 source scope에서 정의된 positive/negative attention을
  판정할 필드가 있음
- `overview_only`: 상태는 보여주지만 exception 부재를 증명할 수 없음
- `unsupported`: 연결 실패 또는 필요한 contract 없음

검증된 positive candidate는 다른 독립 source가 실패해도 suggestion을 만들 수
있다. 반면 `no_action`은 “없음”을 주장하므로 더 강한 negative coverage가
필요하다.

`no_action`을 반환하려면:

- 선언한 decision scope에 candidate-capable source가 하나 이상 있고
- 그 scope의 candidate set이 complete하며
- 결과를 바꿀 material source failure가 없어야 한다.

Calendar-only 또는 현재 `codex-snapshot-v3`의 inventory/historical-context
연결만으로 전체 attention에 대한 `no_action`을 주장하지 않는다. Codex v3가
과거 prompt, answer와 실행 결과의 수집 상태를 제공하더라도 live execution
exception에 대해서는 `overview_only` capability다. 제한된 source만 평가했다면
사용자 문구와 coverage에 정확한 범위를 표시한다.

---

## 7. Eligibility 판정

### 7.1 Eligible

다음을 모두 만족하면 eligible이다.

- source가 충분히 fresh하고 evidence가 complete하다.
- 현재 open 상태다.
- user 또는 shared intervention이 검증됐다.
- 지금 가능한 intervention이 있다.
- source-native destination이 있다.
- critical conflict가 없다.
- Codex exception이면 current window에서도 예외가 유효하다.

### 7.2 Ineligible

다음 중 하나라도 해당하면 ineligible이다.

- AttentionItem이 completed, cancelled 또는 replaced
- 사용자 개입 근거 없음
- agent가 정상적으로 독립 수행 중
- external owner만 행동 가능
- resolved 또는 expired transient request
- escalation threshold 전의 짧은 request
- 근거 없는 deadline, urgency 또는 consequence
- assistant-only obligation
- source evidence 없음
- native item이 archived 또는 cancelled
- 기다리는 것 외에 가능한 행동 없음
- workflow 근거 없이 추정한 commit, PR 또는 review 후속조치

### 7.3 Review required

- state 또는 owner conflict
- stale snapshot
- 결과를 바꿀 수 있는 truncation
- identity 또는 project mapping 불명
- Codex 이전 snapshot window 부족
- scope drift baseline 부족
- failure가 복구됐는지 알 수 없음
- first-step을 evidence 안에서 만들 수 없음
- high-risk domain

### 7.4 판정 순서

```text
1. Source usable?
2. Observation grounded?
3. Identity and relation resolved?
4. State open and current?
5. User/shared intervention?
6. Actionable first-step?
7. Critical conflict absent?
8. Eligible intervention type?
```

이 순서를 통과하기 전에는 lane과 score를 계산하지 않는다.

---

## 8. Intervention type

```ts
type AttentionIntervention =
  | "do"
  | "review"
  | "approve"
  | "decide"
  | "inspect"
  | "resume"
  | "close_loop"
  | "prepare"
  | "follow_up"
  | "clarify"
  | "wait"
  | "none";
```

### 8.1 행동 intervention

| Type | 의미 | 최소 조건 |
|---|---|---|
| `do` | 사용자가 직접 수행 | open work item, user/shared ownership |
| `review` | 변경 또는 산출물 검토 | 유효한 review 요청 또는 검증된 scope 판단 |
| `approve` | 실행 또는 변경 승인 | 동일 request가 오래 미해결이고 현재도 block |
| `decide` | 방향 또는 선택 결정 | 질문과 선택 지점이 source에서 확인됨 |
| `inspect` | 상태 또는 실패 원인 확인 | 검증된 exception과 안전한 destination |
| `resume` | 중단 또는 실패 execution 재개 | 복구 가능성과 현재 block 확인 |
| `close_loop` | 완료 execution의 후속조치 | explicit workflow와 열린 handoff |
| `prepare` | 예정된 commitment 준비 | 다른 source와 Calendar event의 explicit relation |
| `follow_up` | 외부 대기 상태 확인 | 명시적 follow-up 조건 또는 기한 |

### 8.2 제어 및 비행동 type

| Type | 의미 | 사용 위치 |
|---|---|---|
| `clarify` | 판단을 위해 사용자에게 질문 | recommendation decision |
| `wait` | 현재 사용자 행동 없음 | item 또는 no-action explanation |
| `none` | 열린 사용자 개입 없음 | no-action result |

`clarify`, `wait`, `none`은 높은 점수의 action item이 아니다.

### 8.3 Intervention 선택 원칙

- 하나의 AttentionItem에는 primary intervention 하나를 둔다.
- first-step은 intervention보다 더 작고 구체적이어야 한다.
- `inspect`와 `resume`이 모두 가능하면 원인 미확인 상태는 `inspect`를 우선한다.
- `approve`와 `decide`는 request 발생만으로 만들지 않는다.
- `close_loop`는 source execution 상태와 별개의 열린 후속 행동을 나타낸다.

---

## 9. Recommendation 결과 상태

```ts
type CrossSourceSuggestionStatus =
  | "suggested"
  | "needs_clarification"
  | "no_action"
  | "insufficient_evidence";
```

| 상태 | 반환 조건 |
|---|---|
| `suggested` | eligible item이 있고 top 선택 근거가 충분 |
| `needs_clarification` | eligible 또는 reviewable 후보가 있지만 한 질문이 결정을 바꿈 |
| `no_action` | 선언한 candidate-capable 평가 범위가 충분하고 그 범위에 현재 사용자 개입이 필요한 item이 없음 |
| `insufficient_evidence` | freshness, coverage, truncation 또는 conflict 때문에 안전한 판단 불가 |

판정 순서:

```text
관련 usable coverage가 없음
→ insufficient_evidence

eligible 후보가 있고 top이 명확함
→ suggested

eligible 후보가 하나 이상 있고 active recommendation policy가 켜짐
→ 결정적인 기본 후보 하나를 suggested로 반환
→ 동급 후보는 alternatives와 default-pick caveat로 표시

review-required 후보를 사용자 답 하나로 즉시 해결할 수 있음
→ needs_clarification

review-required 후보가 source refresh, history 또는 contract 보강을 필요로 함
→ insufficient_evidence

usable coverage가 있고 eligible 후보가 없음
→ no_action
```

다른 source가 실패해도 fresh source의 후보가 독립적으로 안전하게 검증된다면
제한된 coverage를 밝히고 `suggested`를 반환할 수 있다. 실패한 source가 후보의
state, owner, identity 또는 conflict 해결에 필요할 때만 전체 판단을
`insufficient_evidence`로 낮춘다.

Phase 2A의 적극 추천은 evidence와 eligibility gate를 완화하는 정책이 아니다.
근거 있는 후보 사이에서 minimum score나 preference 동점 때문에 보류하지
않는 정책이다. 현재 확인된 후보가 부분 coverage에서 나온 경우에는
`provisional`과 평가하지 못한 범위를 함께 표시한다.

review-required item이 source refresh나 contract 보강을 요구하더라도 별도의
안전한 positive candidate가 있으면 Phase 2A는 그 후보를 best-observed
기본값으로 제안할 수 있다. 이때 “가장 중요한 일”이라고 표현하지 않고
“현재 확인된 항목 중”이라고 범위를 제한한다.

alternatives에는 hard gate를 통과한 eligible item만 넣는다.
초기 presentation contract는 top suggestion 한 개와 최대 두 개의
alternatives를 사용한다.

### 9.1 `no_action`과 `insufficient_evidence`

두 상태를 합치지 않는다.

```text
no_action
→ 선언한 평가 범위는 알고 있고 그 범위에는 지금 개입할 일이 없음

insufficient_evidence
→ 현재 데이터로는 알 수 없음
```

정상 Codex execution 여러 개가 overview에 있어도 recommendation은
`no_action`일 수 있다.

사용자 문구는 “현재 평가 가능한 범위에서는 사용자가 직접 개입할 항목이
없습니다”로 제한하며, 평가하지 못한 source를 함께 표시한다.

### 9.2 Clarification

Clarification은 다음 조건을 모두 만족해야 한다.

- 질문 하나로 eligibility나 명시적인 실행 결정을 실제로 바꿀 수 있다.
- 사용자가 답할 수 있는 질문이다.
- source refresh로 해결해야 할 문제를 사용자에게 대신 묻지 않는다.
- 단순히 같은 lane의 후보가 비슷하다는 이유만으로 묻지 않는다.

Phase 2A의 적극 정책에서는 동등한 eligible 후보도 stable ID를 마지막
tie-break로 사용해 하나를 고르고, 동급 기본 선택이었다는 caveat와
alternatives를 보여준다. 아래 질문은 후보의 우선순위 선호를 수집하는
선택형 weekly context이지 suggestion을 막는 clarification gate가 아니다.

```text
이번 주에는 결제 출시와 온보딩 개선 중 어느 결과가 더 중요합니까?
```

금지 예:

```text
Codex가 정말 멈춘 것 같나요?
```

후자는 먼저 connector evidence와 detector가 해결해야 할 문제다.

---

## 10. Attention lane

rankable AttentionItem은 네 lane 중 하나를 갖는다.

```ts
type RankableAttentionLane =
  | "must_now"
  | "unblock"
  | "close_loop"
  | "focus";
```

| Rankable lane | 의미 | 필요한 강한 근거 |
|---|---|---|
| `must_now` | 지연하면 즉시 확인 가능한 consequence | 임박한 native deadline, 곧 시작하는 linked commitment |
| `unblock` | 다른 작업이나 사람의 진행을 해제 | review request, verified block, active failure |
| `close_loop` | 완료된 실행의 명시적 handoff를 닫음 | configured workflow, open PR/review handoff |
| `focus` | 지금 시작 가능한 명시적 user/shared work | direct task evidence, owner, ready state. primary outcome relation이 있으면 같은 lane 안에서 우선 |

`clarify`와 `none`은 rankable lane이 아니다.

```text
clarify
→ needs_clarification decision route

none
→ no_action decision route
```

### 10.1 Lane 규범

- `must_now`는 activity나 request age만으로 만들지 않는다.
- 약한 recency 신호 여러 개가 검증된 deadline 하나를 이길 수 없다.
- Codex stall과 failure는 자동으로 `must_now`가 아니다.
- 오래된 approval request도 consequence 근거가 없으면 `must_now`가 아니다.
- Calendar fit은 lane을 만들기보다 first-step 크기를 조정한다.
- primary outcome 입력은 optional ranking context다. 입력이 없거나 다른
  outcome과 연결됐다는 이유만으로 직접 검증된 ready task를 제외하지 않는다.
- primary outcome 질문은 기본적으로 일주일에 한 번만 제시하며 사용자가
  직접 변경하면 즉시 갱신한다.
- score는 같은 lane 안에서 후보를 비교하는 데 우선 사용한다.
- Phase 2A에서는 같은 의미 순위의 후보도 질문으로 멈추지 않고 실제
  `sourceUpdatedAt`과 stable ID로 결정적인 기본값을 고른다.
- 이 기본값은 더 중요하다는 의미가 아니며
  `CAVEAT_DEFAULT_TIE_BREAK_USED`를 함께 반환한다.

초기 policy는 `must_now → unblock → close_loop → focus` 순서를 가설로
검증한다. lane 사이의 정확한 precedence와 tie threshold는 ranking policy의
versioned hypothesis지만, 약한 activity나 recency가 검증된 즉시 consequence를
이기도록 바꿀 수는 없다.

---

## 11. Source별 Attention 정의

### 11.1 GitHub

#### 직접 후보

`assigned_issue`

- open 상태
- user 또는 shared assignee
- 현재 가능한 행동이 있음
- archived, closed, transferred 상태가 아님

`review_requested_pull_request`

- 현재도 user에게 review가 요청됨
- PR이 closed 또는 merged가 아님
- native `isDraft = false`가 확인됨
- review가 취소되지 않음
- source-native destination 존재

현재 connector review signal에는 `isDraft`가 없다. 따라서 Phase 1에서는 review
요청 사실을 WorkSignal로 보존하되 non-draft로 추정하거나 최종 eligible
`review` candidate로 만들지 않는다.

Phase 2A의 적극 정책은 safe GitHub destination이 있는 현재 review request를
`review`가 아니라 provisional `inspect` 후보로 만들 수 있다. 첫 행동은
“PR을 열어 draft 여부와 리뷰 가능 상태 확인”으로 제한하며
`CAVEAT_REVIEW_DRAFT_UNKNOWN`을 표시한다. native `isDraft = false`가 추가된
뒤에만 실제 `review` intervention으로 승격한다.

#### 조건부 후보

`authored_pull_request`는 열린 상태만으로 후보가 아니다.

다음 중 하나가 직접 확인될 때만 후보가 될 수 있다.

- requested changes
- failed checks
- merge conflict
- 명시적인 follow-up obligation

`github-snapshot-v3` connector는 authored PR에 한해 draft, review decision,
check summary와 mergeability/merge-conflict를 privacy-minimized fact로 수집한다.
`checks_failed`, `changes_requested`, `merge_conflict`의 verified positive만 후보로
승격하며, field 누락·partial/unavailable coverage와 단순 open/draft 상태는
행동 필요성으로 추론하지 않는다. 기존 v2 snapshot은 context-only 의미로 읽는다.

#### Context-only

- repository activity
- authored open PR
- label count
- 최근 update time

GitHub는 issue/PR 상태와 review request의 권위자지만 사용자의 전체 목표나
cost of delay의 권위자는 아니다.

### 11.2 Codex

Codex의 기본 역할은 **execution observability**다.

```text
Codex Observation Branch
├─ 정상 상태 → overview
├─ 검증된 exception → overview + candidate signal
└─ 불충분한 상태 → overview with uncertainty 또는 review-required
```

정규화된 overview state:

```ts
type CodexExecutionState =
  | "queued"
  | "running"
  | "waiting"
  | "stalled"
  | "failed"
  | "completed"
  | "cancelled"
  | "idle"
  | "not_loaded"
  | "unknown";
```

Codex adapter는 WorkSignal을 만들고, 공통 resolver와 gate 이전에 직접
AttentionItem을 만들지 않는다.

#### 11.2.1 현재 `codex-snapshot-v3`의 허용 범위

현재 확인 가능한 주요 필드:

- session ID
- project scope와 label
- optional task summary
- created/updated time
- `active`, `idle`, `not_loaded`, `system_error`, `unknown`
- `waiting_on_approval`, `waiting_on_user_input`
- explicit `conversation_and_execution` 동의가 있는 경우 과거 turn의
  prompt/answer/command/file/tool category count와 수집 completeness
- 과거 마지막 turn의 persisted status와 최대 200자의 재정제된 최근
  prompt/answer/execution clue

초기 `taskSummary`의 semantic task/progress 상태는 기본적으로 `unknown`이다.
사용자가 표시를 opt-in한 경우 Work Cockpit의 안전한 execution label을 돕는
단서로만 사용한다. summary가 있더라도 progress, 사용자 task, completion,
obligation 또는 후속조치 근거로 사용하지 않는다. 프로젝트별 workflow를
사용자가 설정했거나 explicit GitHub relation이 있을 때만 별도의
follow-through AttentionItem 생성을 검토한다.

현재 snapshot의 안전한 해석:

| Native state | 현재 처리 | Overview reason |
|---|---|---|
| `active` | activity observed overview. 정상 진전 또는 running으로 확정하지 않음 | `OVERVIEW_CODEX_ACTIVITY_OBSERVED` |
| `idle` | idle overview | `OVERVIEW_CODEX_EXECUTION_IDLE` |
| `not_loaded` | availability 상태 | `OVERVIEW_CODEX_EXECUTION_NOT_LOADED` |
| `system_error` | error badge, 추천 후보 아님 | `OVERVIEW_CODEX_SYSTEM_ERROR_STATUS` |
| `unknown` | 불확실 상태 | `OVERVIEW_CODEX_STATE_UNKNOWN` |
| approval/input attention | 일시 상태 badge, 추천 escalation 비활성화 | `OVERVIEW_CODEX_REQUEST_STATUS_ONLY` |

과거 마지막 turn의 `completed`, `failed`, `interrupted`, `in_progress`는
`thread/read` 시점에 저장된 history일 뿐 현재 process 상태가 아니다. 현재
connector에는 stable current request ID, live progress marker, failure
lifecycle, completion과 handoff 정보가 부족하다. 따라서 현재 값만으로 stall,
active failure, completed-unclosed 또는 오래 지속된 request를 추천하지 않는다.

#### 11.2.2 정상 진행

다음은 overview-only다.

- 최근 의미 있는 progress가 확인되는 running execution
- expected-next-event를 정상적으로 기다리는 execution
- queued, idle, not-loaded execution
- workflow 후속조치가 설정되지 않은 completed execution

정상 execution 수, 최근 activity 양, token 사용량은 중요도 신호가 아니다.

#### 11.2.3 Meaningful progress

Meaningful progress는 단순 activity가 아니라 execution 결과나 상태가 앞으로
변한 관찰이다.

초기 progress marker 후보:

- execution phase 전환
- 새로운 privacy-safe artifact 또는 artifact state 변경
- test/build 단계 또는 결과 변경
- 이전 failure가 clear됨
- 명시적인 completion
- linked issue/PR 상태와 연결된 산출물 생성

Meaningful progress가 아닌 것:

- heartbeat
- 동일 로그 반복
- polling
- timestamp update만 발생
- 같은 오류의 동일 retry
- session을 열거나 조회한 사실

정확한 marker allowlist는 `meaningfulProgressPolicyVersion`에 기록하고 Dev
Dataset으로 검증한다.

#### 11.2.4 Verified stall

`execution_stalled`를 만들려면 다음이 모두 필요하다.

```text
fresh ordered snapshot window
+ stable execution ID
+ execution이 계속 진행될 것으로 예상됨
+ phase별 threshold 초과
+ threshold 동안 meaningful progress 없음
+ 정상 장기 phase 또는 expected-next-event가 아님
+ completed/cancelled 아님
+ 사용자가 확인하거나 재개할 수 있음
```

session inactivity 하나만으로 stall을 만들지 않는다.

verified stall state와 Attention candidate를 분리한다.

- 중요한 downstream block 또는 사람이 기다리는 근거가 있으면 `unblock`
- explicit primary outcome과 연결되고 사용자가 재개할 수 있으면 `focus`
- verified deadline과 즉시 consequence까지 있으면 조건부 `must_now`
- goal, block, obligation 근거가 없으면 `overview_only`이며 candidate가 아님

즉, stall duration 자체는 candidate 또는 lane을 만들지 못한다.

허용 intervention:

```text
inspect
resume
```

#### 11.2.5 Active failure

`execution_failed` 후보의 최소 조건:

- failure가 source evidence로 확인됨
- 최신 window에서도 active이며 recovered가 아님
- user가 안전하게 상태를 열고 확인할 수 있음
- 중요한 outcome 또는 downstream block과 연결됨
- first-step을 근거 안에서 만들 수 있음

`system_error` 문자열 하나만으로 failure candidate를 만들지 않는다.

복구된 failure는 과거 이력과 overview에는 남길 수 있지만 현재 attention에서는
제외한다.

허용 intervention:

```text
inspect
resume
```

#### 11.2.6 Completed but follow-through open

Codex execution 완료는 work item 완료가 아니다.

`completed_follow_through_pending`의 최소 조건:

- execution completion이 확인됨
- project workflow 또는 explicit GitHub relation이 후속조치를 정의함
- configured grace period가 지남
- expected handoff가 아직 open
- user가 후속조치를 수행할 수 있음

근거 없이 다음 행동을 생성하지 않는다.

```text
commit 하세요.
PR을 만드세요.
리뷰를 요청하세요.
```

위 행동은 해당 project workflow에 명시됐을 때만 허용한다.

파생된 AttentionItem:

```text
sourceExecutionState = completed
AttentionItem.state = not_started | blocked | waiting
intervention = close_loop
```

#### 11.2.7 Scope drift

`scope_drift_detected`의 최소 조건:

- expected scope baseline 존재
- observed scope summary 존재
- 두 scope가 같은 단위로 비교 가능
- drift rule이 versioned deterministic policy
- 예상된 범위 확장으로 확인되지 않음
- 사용자 판단이 실제로 필요

baseline이 없으면 drift를 추론하지 않는다.

초기 vertical slice에서는 baseline schema와 synthetic evaluation case가
준비될 때까지 scope-drift candidate 생성을 기본 비활성화한다. UI에 단순 변경
범위를 보여주는 것과 drift라고 판정하는 것을 구분한다.

허용 action intervention:

```text
review
```

사용자의 scope 확인 한 가지가 candidate 여부를 바꾸면 rankable intervention을
`clarify`로 만들지 않고 `needs_clarification` decision route를 사용한다.

#### 11.2.8 Approval과 user input

일시 request가 후보가 되려면 다음이 모두 필요하다.

- stable request ID
- lifecycle state가 현재 `pending`
- `requestedAt` 존재
- `resolvedAt`, `expiredAt` 없음
- configured escalation threshold 초과
- request가 execution을 실제로 block
- 현재도 안전한 destination 존재

request age는 candidate gate에만 사용한다. age 자체를 urgency로 사용하지 않는다.

현재 `codex-snapshot-v3`에도 live request lifecycle 필드가 없으므로 escalation은
비활성화한다.

허용 intervention:

```text
approve
decide
```

### 11.3 Google Calendar

Calendar는 기본적으로 task source가 아니라 시간 constraint다.

허용:

- event start/end/cancel 상태
- free block
- next commitment
- timezone과 overlap
- selected first-step이 가능한 시간인지 판단

금지:

- event title만으로 중요 task 생성
- 회의가 있다는 이유로 준비 task 생성
- Calendar activity로 project priority 판단
- 짧은 free block 때문에 더 중요한 task를 버리고 사소한 task 선택

회의 준비는 다른 source의 AttentionItem과 event가 명시적으로 연결됐을 때만
`prepare` 후보가 된다.

### 11.4 Notion

일반 page/data-source title과 edited time은 context-only다.

직접 후보가 되려면 사용자가 선택한 task database에서 다음 property가 매핑돼야
한다.

```text
title
status
assignee
due
priority
project
```

최소 후보 조건:

- mapped task DB
- open state
- user/shared owner
- title 존재
- fresh, not-truncated snapshot

Notion priority는 내부 planning claim이다. 외부 deadline 또는 GitHub 상태를
덮어쓰지 않는다.

### 11.5 Conversation

기존 conversation candidate는 optional WorkSignal producer로 사용할 수 있다.

- explicit user commitment
- user request 중 사용자 행동 부분
- assistant 제안을 사용자가 명시적으로 수락
- verified owner/state/evidence

assistant-only 제안, 예시, 코드, 인용문은 후보가 아니다. 기존
`TASK_DEFINITION.md`의 엄격한 evidence 원칙을 유지하지만 connector record를
conversation message로 위장하지 않는다.

---

## 12. Claim authority와 conflict

| Claim | 기본 권위 | 권위가 없는 영역 |
|---|---|---|
| GitHub issue/PR state | GitHub | 전체 business priority |
| GitHub review request | GitHub | 실제 cost of delay |
| Notion mapped task state | Notion task DB | GitHub merge state |
| Notion internal priority | Notion 또는 사용자 | 외부 deadline 사실성 |
| Calendar event time/cancel | Calendar | task 완료와 중요도 |
| Codex execution state | Codex | linked work item 완료와 중요도 |
| 사용자 correction | explicit feedback | native source 원본 변경 |

### 12.1 Conflict 처리

- 원본 claim을 덮어쓰지 않는다.
- field별 authority를 사용한다.
- 최신 timestamp 하나로 모든 field를 해결하지 않는다.
- unresolved critical conflict는 top suggestion에서 제외한다.
- 사용자가 해결 가능한 conflict는 clarification 후보가 될 수 있다.
- source refresh가 필요한 conflict는 insufficient-evidence다.

예:

```text
GitHub PR = merged
Notion mapped task = open

→ PR state는 GitHub 기준 completed
→ Notion open claim은 stale 또는 broader task인지 검토
→ PR 자체는 추천하지 않음
→ Notion 원본은 수정하지 않음
```

---

## 13. 초기 reason code

reason code는 추천 문구보다 먼저 결정한다. LLM이 reason code를 만들거나 바꾸지
않는다. 한 code는 한 의미만 가지며 prefix로 책임 영역을 구분한다.

### 13.1 Candidate fact

```text
CANDIDATE_USER_INTERVENTION_EXPLICIT
CANDIDATE_SHARED_INTERVENTION_EXPLICIT
CANDIDATE_GITHUB_ISSUE_ASSIGNED
CANDIDATE_GITHUB_REVIEW_REQUESTED
CANDIDATE_NOTION_MAPPED_TASK_OPEN
CANDIDATE_CALENDAR_LINKED_PREPARATION
CANDIDATE_CONVERSATION_USER_COMMITMENT
CANDIDATE_CODEX_STALL_VERIFIED
CANDIDATE_CODEX_FAILURE_ACTIVE
CANDIDATE_CODEX_FOLLOW_THROUGH_OPEN
CANDIDATE_CODEX_SCOPE_DRIFT_VERIFIED
CANDIDATE_CODEX_REQUEST_ESCALATED
```

### 13.2 Why-now

```text
WHY_NOW_VERIFIED_DEADLINE
WHY_NOW_EXPLICIT_BLOCKER
WHY_NOW_PERSON_WAITING
WHY_NOW_PRIMARY_OUTCOME_ALIGNED
WHY_NOW_CONFIGURED_LOOP_OPEN
WHY_NOW_LINKED_COMMITMENT_IMMINENT
```

### 13.3 Overview-only

```text
OVERVIEW_CODEX_EXECUTION_HEALTHY
OVERVIEW_CODEX_ACTIVITY_OBSERVED
OVERVIEW_CODEX_EXECUTION_RECENT_PROGRESS
OVERVIEW_CODEX_EXECUTION_IDLE
OVERVIEW_CODEX_EXECUTION_NOT_LOADED
OVERVIEW_CODEX_SYSTEM_ERROR_STATUS
OVERVIEW_CODEX_STATE_UNKNOWN
OVERVIEW_CODEX_EXECUTION_COMPLETED
OVERVIEW_CODEX_FAILURE_RECOVERED
OVERVIEW_CODEX_FAILURE_ACTIVE
OVERVIEW_CODEX_EXECUTION_STALLED
OVERVIEW_CODEX_STALL_NO_MATERIAL_LINK
OVERVIEW_CODEX_REQUEST_BELOW_THRESHOLD
OVERVIEW_CODEX_REQUEST_STATUS_ONLY
OVERVIEW_CALENDAR_CONSTRAINT
OVERVIEW_SOURCE_CONTEXT_ONLY
```

### 13.4 Gate

```text
GATE_FINAL_STATE
GATE_NO_USER_INTERVENTION
GATE_OWNER_NOT_USER_OR_SHARED
GATE_HEALTHY_CODEX_EXECUTION
GATE_CODEX_EXCEPTION_UNVERIFIED
GATE_FAILURE_RECOVERED
GATE_TRANSIENT_REQUEST_NOT_ESCALATED
GATE_TRANSIENT_REQUEST_ID_MISSING
GATE_TRANSIENT_REQUEST_RESOLVED
GATE_TRANSIENT_REQUEST_EXPIRED
GATE_FOLLOW_THROUGH_NOT_CONFIGURED
GATE_DIRECT_EVIDENCE_MISSING
GATE_NATIVE_DESTINATION_MISSING
GATE_WAIT_ONLY
GATE_UNSUPPORTED_DEADLINE
GATE_UNSUPPORTED_CONSEQUENCE
```

### 13.5 Review

```text
REVIEW_SOURCE_STALE
REVIEW_SOURCE_PARTIAL
REVIEW_SOURCE_TRUNCATED
REVIEW_CODEX_HISTORY_INSUFFICIENT
REVIEW_FAILURE_LIFECYCLE_UNKNOWN
REVIEW_SCOPE_BASELINE_MISSING
REVIEW_IDENTITY_UNRESOLVED
REVIEW_STATE_CONFLICT
REVIEW_OWNER_CONFLICT
REVIEW_DEADLINE_CONFLICT
REVIEW_CRITICAL_CONFLICT_UNRESOLVED
```

### 13.6 Decision

```text
DECISION_TOP_ITEM_SELECTED
DECISION_TOP_CANDIDATES_EQUIVALENT
DECISION_USER_PRIORITY_REQUIRED
DECISION_NO_ELIGIBLE_INTERVENTION
DECISION_ALL_OBSERVED_WORK_HEALTHY
DECISION_RELEVANT_COVERAGE_INSUFFICIENT
DECISION_SOURCE_REFRESH_REQUIRED
```

reason code 추가, 삭제, 의미 변경은 reason-code version을 증가시키고 평가
fixture를 갱신한다. frozen dataset의 기대 code를 조용히 덮어쓰지 않는다.
사용자 설명은 code와 검증된 field를 deterministic template에 매핑해 만든다.

---

## 14. 설명과 first-step 계약

### 14.1 Suggested 설명

suggested 결과는 항상 다음을 포함한다.

- 사용자가 할 개입
- why-now reason code 1~2개
- 근거 source와 native 상태
- 마지막 갱신 시각과 coverage
- user, agent, shared 중 실행 주체
- evidence 안에서 시작 가능한 first-step
- 안전한 source-native destination
- stale, partial 또는 unresolved uncertainty

Codex-derived suggestion은 추가로 다음을 보여준다.

- 마지막 meaningful progress 시각
- verified exception 종류
- expected-next-event 또는 configured follow-through
- 연결된 work item과 `executes`, `produces`, `related_to` 관계

### 14.2 설명 금지

- reason code에 없는 urgency 표현
- source에 없는 deadline
- 검증되지 않은 business impact
- “가장 중요한 일”과 같은 범위 밖 주장
- normal activity를 stall 또는 blocker로 표현
- confidence 숫자를 외부 사실의 확률처럼 표시

LLM은 검증된 field를 읽기 쉽게 다듬을 수 있지만 reason code, priority, deadline,
intervention을 추가하거나 변경할 수 없다.

### 14.3 First-step

first-step은 다음 조건을 만족한다.

- 보통 2~15분 안에 시작 가능
- 전체 task 완료가 아니라 첫 진전
- source-native destination 존재
- user action과 agent preparation 구분
- evidence에 없는 날짜, 범위, 명령을 만들지 않음
- 예상 시간을 모르면 `null`

예:

```text
Codex failure
→ 마지막 성공 phase와 현재 failure 상태 열기

GitHub review request
→ requested changes 또는 diff summary 확인

close_loop
→ configured workflow와 연결된 PR 상태 확인
```

LLM 문구 생성이 실패하면 intervention별 deterministic template을 사용한다.

### 14.4 No-action과 insufficient-evidence 설명

`no_action`은 확인된 정상 상태를 설명한다.

```text
현재 평가 가능한 범위에서는 사용자가 직접 개입할 항목이 없습니다.
GitHub 리뷰 요청과 assigned issue는 확인되지 않았습니다.
Notion과 Google Calendar는 이번 판단에서 평가하지 못했습니다.
```

`insufficient_evidence`는 어떤 source 또는 field가 판단을 막는지 설명한다.

```text
GitHub 상태가 오래되어 review 요청이 아직 유효한지 확인할 수 없습니다.
새로고침 후 다시 판단해야 합니다.
```

---

## 15. Canonical 판정 사례

아래 사례는 정의를 설명하는 mutable 예시다. 아직 Golden Dataset이 아니다.

### 15.1 Codex

| Case | 입력 요약 | Disposition | 결과 |
|---|---|---|---|
| `AD-CX-001` | 최근 progress marker가 있는 running execution | overview-only | `OVERVIEW_CODEX_EXECUTION_RECENT_PROGRESS` |
| `AD-CX-002` | heartbeat만 반복되지만 이전 window 없음 | overview + review | `OVERVIEW_CODEX_ACTIVITY_OBSERVED`, `REVIEW_CODEX_HISTORY_INSUFFICIENT` |
| `AD-CX-003` | threshold 초과, progress 없음, important issue block | overview + candidate | `inspect`, `CANDIDATE_CODEX_STALL_VERIFIED` |
| `AD-CX-004` | 정상 장기 build phase, expected-next-event 존재 | overview-only | `OVERVIEW_CODEX_EXECUTION_HEALTHY` |
| `AD-CX-005` | failure 후 다음 snapshot에서 recovered | overview-only | `OVERVIEW_CODEX_FAILURE_RECOVERED`, `GATE_FAILURE_RECOVERED` |
| `AD-CX-006` | active failure, linked release block, safe destination | overview + candidate | `inspect`, `CANDIDATE_CODEX_FAILURE_ACTIVE` |
| `AD-CX-007` | completed, expected workflow 없음 | overview-only | `OVERVIEW_CODEX_EXECUTION_COMPLETED`, `GATE_FOLLOW_THROUGH_NOT_CONFIGURED` |
| `AD-CX-008` | completed, configured PR handoff가 grace period 후에도 open | overview + candidate | `close_loop`, `CANDIDATE_CODEX_FOLLOW_THROUGH_OPEN` |
| `AD-CX-009` | changed files 증가, scope baseline 없음 | overview + review | `OVERVIEW_SOURCE_CONTEXT_ONLY`, `REVIEW_SCOPE_BASELINE_MISSING` |
| `AD-CX-010` | approval request가 threshold 전 | overview-only | `OVERVIEW_CODEX_REQUEST_BELOW_THRESHOLD` |
| `AD-CX-011` | approval request가 resolved | excluded | `GATE_TRANSIENT_REQUEST_RESOLVED` |
| `AD-CX-012` | stable request ID 없이 여러 snapshot에서 approval 표시 | overview-only | `OVERVIEW_CODEX_REQUEST_STATUS_ONLY`, `GATE_TRANSIENT_REQUEST_ID_MISSING` |
| `AD-CX-013` | stable pending request가 threshold를 넘고 execution block | candidate | `approve`, `CANDIDATE_CODEX_REQUEST_ESCALATED` |
| `AD-CX-014` | stall은 검증됐지만 goal, block, obligation 연결 없음 | overview-only | `OVERVIEW_CODEX_STALL_NO_MATERIAL_LINK` |

### 15.2 GitHub, Calendar, Notion

| Case | 입력 요약 | Disposition | 결과 |
|---|---|---|---|
| `AD-GH-001` | fresh open issue, user assigned, ready | candidate | `do`, `CANDIDATE_GITHUB_ISSUE_ASSIGNED` |
| `AD-GH-002` | fresh non-draft PR review request | candidate | `review`, `CANDIDATE_GITHUB_REVIEW_REQUESTED` |
| `AD-GH-003` | authored open PR, 행동 필요 field 없음 | overview-only | `OVERVIEW_SOURCE_CONTEXT_ONLY` |
| `AD-GH-004` | merged PR | excluded | `GATE_FINAL_STATE` |
| `AD-GH-005` | authored PR, failed check verified | candidate | `do`, `CANDIDATE_GITHUB_AUTHORED_PR_CHECKS_FAILED` |
| `AD-GH-006` | authored PR, changes requested verified | candidate | `do`, `CANDIDATE_GITHUB_AUTHORED_PR_CHANGES_REQUESTED` |
| `AD-GH-007` | authored PR, merge conflict verified | candidate | `do`, `CANDIDATE_GITHUB_AUTHORED_PR_MERGE_CONFLICT` |
| `AD-CA-001` | 다음 일정까지 20분, 연결 task 없음 | overview-only | `OVERVIEW_CALENDAR_CONSTRAINT` |
| `AD-CA-002` | event와 explicit linked review prep | candidate | `prepare`, `CANDIDATE_CALENDAR_LINKED_PREPARATION` |
| `AD-NO-001` | 일반 page가 최근 수정됨 | overview-only | `OVERVIEW_SOURCE_CONTEXT_ONLY` |
| `AD-NO-002` | mapped task, open, user assigned | candidate | `do`, `CANDIDATE_NOTION_MAPPED_TASK_OPEN` |
| `AD-NO-003` | mapped task가 completed | excluded | `GATE_FINAL_STATE` |

### 15.3 Decision

| Case | 전체 상태 | Expected status | Decision reason |
|---|---|---|---|
| `AD-DS-001` | future Codex contract에서 execution 모두 healthy + GitHub complete negative coverage | `no_action` | `DECISION_ALL_OBSERVED_WORK_HEALTHY` |
| `AD-DS-002` | 두 primary goal의 eligible item이 비슷하고 목표 없음 | `suggested` + 동급 caveat/alternative | `DECISION_TOP_ITEM_SELECTED` |
| `AD-DS-003` | GitHub snapshot이 stale하고 top을 바꿀 수 있음 | `insufficient_evidence` | `DECISION_RELEVANT_COVERAGE_INSUFFICIENT` |
| `AD-DS-004` | verified deadline item 하나가 명확히 우선 | `suggested` | `DECISION_TOP_ITEM_SELECTED` |

---

## 16. 평가자 판정 rubric

평가자는 “내가 보기에 중요해 보인다”로 바로 top item을 고르지 않는다.
case의 `decisionAt`과 frozen snapshot window만 사용한다. 현재 live 상태,
평가자의 개인 업무 선호, 나중에 알게 된 결과를 참조하지 않는다.

Cockpit label과 recommendation label은 별도로 기록한다. overview가 맞고
recommendation이 틀릴 수도 있으며 그 반대도 가능하다.

### 16.1 단일 observation 판정

각 observation에 다음 순서로 답한다.

1. source와 snapshot이 usable한가?
2. 주장하는 상태가 evidence로 확인되는가?
3. work item과 execution identity가 분리됐는가?
4. 현재 open 상태인가?
5. user 또는 shared intervention이 필요한가?
6. 사용자가 지금 가능한 first-step이 있는가?
7. overview에도 보여야 하는가?
8. candidate로 허용되는가?
9. 허용 intervention은 무엇인가?
10. 금지 reason code는 무엇인가?

권장 annotation 형태:

```ts
type AttentionAnnotation = {
  disposition: AttentionDisposition;
  acceptableOverviewStates: CodexExecutionState[];
  eligibility: "eligible" | "review_required" | "ineligible";
  interventions: {
    required: AttentionIntervention[];
    acceptable: AttentionIntervention[];
    forbidden: AttentionIntervention[];
  };
  forbiddenAsCandidate: boolean;
  reasonCodes: {
    overview: string[];
    candidate: string[];
    gate: string[];
    review: string[];
  };
  notes: string;
};
```

전체 case의 `decision` reason code는 observation annotation과 별도로 기록한다.
overview 출력이 맞지만 candidate gate가 틀린 경우를 하나의 code 목록으로
뭉개지 않는다.

### 16.2 전체 case 판정

1. usable source coverage를 확인한다.
2. overview item의 누락과 잘못된 exception을 확인한다.
3. forbidden candidate를 먼저 표시한다.
4. eligible set을 만든다.
5. lane을 분류한다.
6. 허용 가능한 top set을 기록한다.
7. eligibility 또는 명시적인 실행 결정의 conflict를 사용자만 해결할 수 있으면 clarification 가능성을 본다.
8. 후보가 없으면 no-action과 insufficient-evidence를 구분한다.
9. explanation과 first-step이 evidence 안에 있는지 확인한다.

ranking 차이는 선택 결과가 `acceptableTopItemIds` 안에 있으면 오류로 보지
않는다. 평가 질문은 “내가 개인적으로 무엇을 먼저 할까?”가 아니라 “이 계약에서
이 선택이 허용되는가?”다.

### 16.3 Hard failure

다음은 preference 차이가 아니라 계약 위반이다.

- forbidden item 추천
- 정상 Codex execution 추천
- 해결 또는 만료된 request 추천
- 근거 없는 deadline, consequence, urgency
- stale 또는 partial 상태 은폐
- completed, cancelled, replaced AttentionItem 추천
- raw private content, token, private path 노출
- evidence 없는 first-step
- stable ID 기본 선택을 더 중요하다는 근거처럼 표현하거나 caveat 없이 숨김

### 16.4 의견 불일치

- reviewer 의견을 평균 내서 하나의 label로 만들지 않는다.
- 각 reviewer의 원래 판단과 reason을 보존한다.
- 정의 해석 차이인지, source fact 차이인지, preference 차이인지 분류한다.
- adjudication 후에도 original labels를 보존한다.
- 합의되지 않은 사례는 Golden으로 freeze하지 않는다.
- Dev Case는 작성자와 별도 reviewer 한 명으로 시작할 수 있다.
- 첫 Golden freeze에는 두 명의 독립 review와 불일치 adjudication을 권장한다.

---

## 17. 고정 계약과 실험 가설

### 17.1 Definition v0.2에서 고정

- Work Cockpit과 Attention Router 분리
- 정상 Codex execution은 overview-only
- 검증된 Codex exception만 candidate signal
- adapter와 detector가 AttentionItem을 직접 만들지 않음
- execution state와 AttentionItem state 분리
- evidence 없는 deadline, urgency, consequence 금지
- resolved/expired request 추천 금지
- stable request ID 없는 escalation 금지
- workflow 없는 follow-through 생성 금지
- scope baseline 없는 drift 생성 금지
- baseline schema와 evaluation 전까지 scope-drift candidate 기본 비활성화
- Calendar는 기본적으로 시간 constraint
- 일반 Notion page는 context-only
- rankable lane은 `must_now`, `unblock`, `close_loop`, `focus`
- `clarify`와 `none`은 lane이 아니라 decision route
- alternatives에는 eligible item만 포함
- partial coverage는 decision에 필요한 claim과의 관련성으로 판단
- `suggested`, `needs_clarification`, `no_action`,
  `insufficient_evidence` 분리
- evidence-backed 후보가 있으면 minimum score나 preference 동점만으로
  보류하지 않는 적극 추천
- 동급 후보의 결정적 기본 선택과 caveat/alternatives 표시
- draft 여부가 없는 GitHub review 요청은 `review`가 아닌 provisional
  `inspect`로만 허용

### 17.2 평가로 변경 가능한 가설

- source freshness TTL
- native milestone을 `must_now`로 보는 due-soon window
- progress marker allowlist
- execution phase별 stall threshold
- failure recovery observation window
- follow-through grace period
- transient request escalation threshold
- scope drift tolerance
- attention lane precedence
- ranking weights와 tie margin
- first-step 예상 시간
- 사용자별 preference adjustment

가설 변경은 config 또는 policy version을 증가시키고 동일 frozen input에서 비교한다.

---

## 18. 개인정보와 안전

- connector는 read-only가 기본이다.
- 추천과 외부 쓰기 권한을 분리한다.
- Work Resumption은 사용자가 명시적으로 연결하고 실행한 local
  `focus_or_resume` safe destination만 허용한다. 이는 source mutation 권한이
  아니며 prompt 전송, 승인 처리, 자동 retry와 arbitrary shell을 포함하지
  않는다.
- Codex raw prompt, response, command, output 전체를 기본 저장하지 않는다.
  `metadata_only`가 기본이며 기존 task-summary consent를 raw consent로
  자동 승격하지 않는다.
- 사용자가 `codex-conversation-content-consent-v1`에 명시적으로 동의하고
  `conversation_and_execution`을 선택한 프로젝트만 source cap 안의 과거
  prompt/answer/plan/command output·exit/file diff/tool result를 connector
  전용 `.local` private artifact에 최대 7일 저장한다. 내부 reasoning은
  수집하지 않는다.
- opt-out, scope 변경과 disconnect는 raw consent를 먼저 비활성화하고 raw
  artifact를 삭제한다. expiry read도 만료 artifact를 삭제한다.
- Phase 2 metadata retention은 최대 30일이다. raw content는 snapshot,
  WorkSignal/Attention input·result, immutable replay, monitor, sync audit,
  제품 API, Git과 평가 dataset에 넣지 않는다. 제품 화면에는 별도 재정제를
  거친 최대 200자 clue와 count/completeness만 허용한다.
- Phase 2A pure runner는 persistence를 만들지 않는다. local product
  orchestrator의 metadata-only monitor store는 30일 정책을 적용하며 title,
  URL, task summary와 raw content는 저장하지 않는다.
- 이 monitor store는 richer Codex 의미 판정을 위한 ordered execution
  history가 아니다.
- progress summary는 로컬에서 최소화하고 evidence signal로 역추적 가능해야 한다.
- private path 대신 safe open reference 또는 hash를 사용한다.
- Calendar는 free/busy를 기본으로 한다.
- Notion body와 GitHub code/comment 전체를 기본 수집하지 않는다.
- 여러 source의 raw content를 하나의 외부 LLM prompt에 보내지 않는다.
- high-risk task는 자동 실행하지 않는다.
- production 반응, 클릭, 무반응은 human-approved Gold가 아니다.

---

## 19. 버전과 변경 규칙

초기 definition version:

```text
cross-source-attention-definition-v0.2
```

다음 변경은 definition 또는 관련 policy version 증가를 검토한다.

- attention 포함·제외 의미 변경
- source 역할 변경
- Codex exception 조건 변경
- intervention type 추가 또는 의미 변경
- result status 의미 변경
- reason code 의미 변경
- evidence 또는 conflict gate 변경

구현 동작을 바꾸는 변경은 다음을 따른다.

- relevant unit/integration test
- 동일 frozen dataset targeted regression 또는 baseline
- run version 기록
- Engine Change Record
- privacy와 retention 영향 검토

v0.2는 active recommendation tie 처리와 draft-unknown review의 provisional
inspection 동작을 변경하므로 policy version, dataset revision, test와
Engine Change Record를 함께 갱신한다.

---

## 20. Definition 완료 조건

Phase 0에서 이 정의가 충분하다고 보려면 다음을 만족해야 한다.

- 두 reviewer가 명확한 사례의 overview/candidate 구분에 합의할 수 있다.
- 정상 Codex execution을 candidate로 만들지 않는다.
- verified stall과 단순 inactivity를 구분할 수 있다.
- recovered failure와 active failure를 구분할 수 있다.
- execution completion과 open follow-through를 분리할 수 있다.
- current connector로 판단할 수 없는 상태를 명시적으로 보류한다.
- no-action과 insufficient-evidence를 일관되게 구분한다.
- forbidden candidate를 평가 case에 기록할 수 있다.
- 모든 positive candidate에 source evidence와 intervention이 있다.
- exact threshold가 없어도 합성 Dev Case 작성을 시작할 수 있다.

위 조건을 표현하는 evaluation schema와 30개 mutable synthetic Dev Case가
존재하므로 Phase 0 dev definition contract는 종료한다. human review와
adjudication은 Phase 6, Golden freeze와 release decision은 Phase 7에서
진행한다.

Phase 1은 connector native snapshot을 strict runtime artifact와 typed
WorkSignal로 변환하고 native observation 순서와 history sufficiency를
보존하는 pure contract로 완료했다. 현재 Codex v3의 activity, `taskSummary`,
request badge로 progress, stall, failure 또는 lifecycle을 추론하지 않는다.

Phase 2A는 current GitHub WorkSignal에서 assigned issue와 provisional review
inspection 후보를 만들고, current Codex v3를 Work Cockpit overview로 유지하며,
적극적 best-observed selection과 scoped no-action/insufficient-evidence를
결정하는 pure runner로 완료했다. local-only API, Work Cockpit, 30일
metadata-only run history와 Attention Lab도 연결했다. richer contract와
충분한 ordered history를 이용한 Codex exception detector, confirmed review와
follow-through는 Phase 2B 범위다.

Phase 2A.1은 네 source의 수집을 서버 `SourceSyncCoordinator`로 통합하고,
latest/history 분리 저장, retry·disconnect 복구, snapshot revision 기반 UI
갱신, explicit project identity, global/project weekly outcome과
Calendar/Notion context-only input을 local product에 연결해 완료했다. 외부
Codex 세션은 계속 inventory-only `unknown`이며 live managed execution
관찰은 blabase가 App Server lifecycle을 소유하는 후속 범위다.
`conversation_and_execution`은 이 경계를 바꾸지 않고 과거 기록을
historical-context-only로 추가한다. 이 확장의 runtime WorkSignal/Attention
schema와 Codex normalizer/overview rule은 v0.3이다.

이후 Phase 2B.0·2B.1·2B.2A, Phase 3A·3B·3C와 Phase 4A·4B를 구현했다.
Blabase-owned managed run의 exact direct failure와 configured completion
follow-through만 Codex active candidate가 될 수 있으며, verified stall,
scope drift와 stable approval/input escalation은 richer evidence가 필요한 후속
범위다. Phase 4C·4C.1·4C.2 launcher는 이 결정을 다시 계산하지 않고 현재 결과를
native macOS surface로 투영한다.

현재 Active Attention은 input v0.4, result v0.5다. Developer Signal Intelligence
v0.1은 GitHub/Codex normalized signal을 Developer Work Ledger와 Candidate Funnel로
추적한다. GitHub authored PR은 `github-snapshot-v3`의 verified actionability가 있을
때만 후보가 되며, Codex historical OpenLoopClaim은 currentness가 검증되기 전까지
private Developer Work Ledger에만 남고 funnel의 verified 단계에서 rejected되어 추천
후보가 되지 않는다. underlying Codex observation만 기존 overview 경계를 유지한다.
