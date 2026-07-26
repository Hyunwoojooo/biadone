# Phase 2 GitHub + Codex Observability Contract

## 문서 정보

| 항목 | 값 |
|---|---|
| 상태 | Phase 2A implemented, Phase 2B deferred |
| 기준일 | 2026-07-26 |
| 입력 계약 | `github-codex-attention-input-v0.1` |
| 결과 계약 | `github-codex-attention-result-v0.1` |
| 정책 | `aggressive-evidence-bound-attention-policy-v0.1` |
| GitHub rule | `github-direct-candidate-rule-v0.1` |
| Codex rule | `codex-current-overview-rule-v0.1` |
| 제품 route | 미연결 |

---

## 1. 목적

Phase 2A는 Phase 1의 integrity-verified runtime `WorkSignalBatch`를 사용해
다음 첫 vertical slice를 만든다.

```text
GitHub current WorkSignalBatch
+ Codex current WorkSignalBatch
+ optional weekly outcome
→ GitHub intervention candidates
+ Codex Work Cockpit overview
→ suggested / scoped no_action / insufficient_evidence
```

LLM은 사용하지 않는다. connector 원본에 없는 deadline, progress, failure,
completion, draft state 또는 obligation을 만들지 않는다.

---

## 2. 적극 추천의 의미

사용자 결정:

> 서비스가 만드는 추천을 먼저 보고 수정할 수 있도록, 근거가 있는 후보가
> 하나라도 있으면 가능한 한 한 가지를 적극적으로 추천한다.

구현 의미:

- minimum score가 없다.
- 같은 lane의 후보가 비슷해도 clarification으로 멈추지 않는다.
- 실제 update time과 stable ID로 결정적인 기본 후보를 고른다.
- 동급 기본 선택은 더 중요하다는 의미가 아니다.
- `CAVEAT_DEFAULT_TIE_BREAK_USED`와 alternatives를 표시한다.
- partial snapshot의 확인된 positive candidate도 provisional로 제안할 수 있다.

변하지 않는 gate:

- stale 또는 invalid source는 현재 후보에 사용하지 않는다.
- source-native safe destination이 없으면 추천하지 않는다.
- native field가 없는 deadline, urgency, impact를 만들지 않는다.
- Codex `active`를 running/progress로, `system_error`를 failure로 바꾸지 않는다.
- approval/input badge를 request lifecycle로 만들지 않는다.

---

## 3. 제품 기본값

```text
recommendation mode       aggressive_evidence_bound
lane order                must_now → unblock → close_loop → focus
due-soon hypothesis       48 hours
alternatives              최대 2개
weekly outcome            선택 입력, 7일 cadence
source action             read-only
Codex metadata retention  향후 store 구현 시 최대 30일
Codex raw content         retention 없음
```

48시간은 versioned hypothesis다. native milestone이 overdue 또는 48시간 안인
경우에만 현재 지원 후보를 `must_now`로 올린다. 이를 GitHub issue 자체의
보장된 deadline이나 business urgency로 표현하지 않는다.

현재 runner는 persistence를 추가하지 않는다. 30일 retention은 Phase 2B의
history store가 생길 때 적용할 제품 계약이다.

---

## 4. 입력 계약

입력은 source별 상태를 명시한다.

```ts
type Phase2SourceInput =
  | {
      status: "available";
      batch: RuntimeWorkSignalBatch;
    }
  | {
      status: "unavailable";
      reason:
        | "CONNECTOR_DISCONNECTED"
        | "COLLECTION_FAILED"
        | "SNAPSHOT_MISSING"
        | "SNAPSHOT_PARSE_FAILED"
        | "SNAPSHOT_SCHEMA_UNSUPPORTED";
    };
```

필수 invariant:

- available batch는 slot source와 일치한다.
- 모든 available batch의 `assessment.asOf`는 decision `asOf`와 같다.
- signal, batch ID/hash integrity가 검증돼야 한다.
- raw provider error, credential, local path는 failure에 넣지 않는다.
- GitHub와 Codex는 source별 latest batch 하나만 받는다.

optional weekly outcome은 원문을 결과에 복사하지 않는다. 현재 Phase 2A에는
explicit project relation이 없으므로 title/repository와 결정적인 token overlap이
있을 때만 같은 lane 안의 약한 preference로 사용한다. 이 match는 eligibility,
lane 또는 deadline을 만들 수 없다. `capturedAt`이 decision `asOf`보다 미래면
`not_yet_active`로 표시하고 ranking에 사용하지 않는다.

---

## 5. GitHub candidate rule

### 5.1 Assigned issue

다음을 만족하면 confirmed `do` 후보다.

- current fresh GitHub batch
- `assigned_issue`
- open state와 query membership evidence
- direct work item
- safe GitHub destination

기본 lane은 `focus`다. native milestone이 overdue 또는 48시간 안이면
`must_now`다. 현재 state는 `not_started`나 `in_progress`로 추론하지 않고
`unclear`로 유지한다.

### 5.2 Review request with unknown draft state

현재 contract에는 `isDraft`가 없다.

금지:

```text
review request observed
→ isDraft=false 추론
→ 실제 review 행동 추천
```

Phase 2A 허용:

```text
review request observed + safe destination
→ provisional inspect
→ “PR을 열어 draft 여부와 리뷰 가능 상태 확인”
```

기본 lane은 `unblock`이며 `CAVEAT_REVIEW_DRAFT_UNKNOWN`을 표시한다.
Phase 2B에서 native `isDraft=false`가 추가된 뒤에만 confirmed `review`로
승격한다.

### 5.3 Excluded

- authored open PR
- activity-only signal
- stale/invalid source의 work item
- unsafe destination
- source evidence가 없는 deadline

---

## 6. Codex overview rule

current `codex-snapshot-v2`는 모두 overview-only다.

| Native | Semantic output |
|---|---|
| `active` | activity observed, semantic `unknown` |
| `idle` | `idle` |
| `not_loaded` | `not_loaded` |
| `system_error` | system-error status, semantic `unknown` |
| `unknown` | `unknown` |
| approval/input badge | `overview_badge_only` |

opt-in task summary는 `display_only_unknown`으로 표시할 수 있다. Codex execution은
모두 `forbiddenAsAttentionCandidate=true`다. invalid batch는 overview를 만들지
않고 `SOURCE_CODEX_STALE_OR_INVALID` coverage reason을 남긴다.

---

## 7. Coverage와 결정

### Suggested

- confirmed 또는 safe provisional candidate가 하나 이상
- lane, deadline hypothesis, weekly token match, update time, stable ID 순으로
  결정적인 top 선택
- partial candidate set이면 `provisional`과 caveat 표시

### Scoped no-action

다음을 모두 만족해야 한다.

- GitHub snapshot이 fresh
- GitHub candidate set이 complete
- material invalid/conflicting/unsafe direct record 없음
- candidate 없음

사용자 문구:

> 현재 평가 가능한 GitHub 작업 범위에서는 사용자가 직접 개입할 항목이
> 없습니다. Codex는 실행 현황만 평가했고 Notion과 Google Calendar는 이번
> 판단에서 평가하지 않았습니다.

### Insufficient evidence

- GitHub disconnected, failed, stale 또는 invalid
- GitHub candidate set이 partial이고 확인된 positive candidate가 없음
- unsafe destination 때문에 현재 행동을 시작할 수 없음
- Codex overview-only만 있고 candidate-capable source가 없음

`needs_clarification` 상태는 계약에 남지만 Phase 2A에서는 preference tie 때문에
사용하지 않는다. 사용자 답이 eligibility나 명시적인 실행 결정을 바꿀 수 있는
case를 추가한 뒤 활성화한다.

---

## 8. 결정성, 무결성, 개인정보

결과는 다음을 기록한다.

- input SHA-256
- stable result ID
- result SHA-256
- input/result/policy/rule version
- candidate source signal IDs
- coverage, gate, candidate, why-now, caveat, decision reason code

같은 canonical input과 policy에서는 top, alternatives, overview order와 hash가
같아야 한다. hash 이후 결과를 바꾸면 integrity verification이 실패한다.

사용자 화면용 결과에는 권한 범위의 GitHub title, safe URL, opt-in Codex
summary가 포함될 수 있다. engine error와 integrity failure에는 해당 원문,
token, private path 또는 provider detail을 넣지 않는다.

---

## 9. Phase 2B 진입 조건

다음은 현재 구현하지 않는다.

- confirmed non-draft review
- Codex meaningful progress, stall, failure, recovery, completion
- stable approval/input request lifecycle와 escalation
- completed execution의 configured follow-through
- Codex safe destination
- explicit Codex↔GitHub relation
- GitHub checks, requested changes, merge conflict
- 실제 30일 metadata history persistence

Phase 2B connector 계약이 위 native evidence를 제공한 뒤 별도 schema/rule
version과 regression case를 추가한다.
