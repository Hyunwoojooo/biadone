# Attention Eligibility Shadow Contract

상태: Phase 4A current-only shadow candidate

## 1. 목적

Phase 4A는 후보를 ranking에 넣기 전에 다음 질문에 결정론적으로 답한다.

```text
이 후보는 현재 근거만으로 사용자에게 보여도 되는가?
```

결과는 후보별 `eligible`, `review_required`, `ineligible` 중 하나다. 이
projection은 현재 Work Cockpit의 Phase 2 추천, lane, ordering, selection,
replay 또는 monitor hash를 변경하지 않는다.

```text
attentionSelectionEffect = none
attentionDisposition = shadow_only
forbiddenAsAttentionCandidate = true
```

## 2. 현재 평가 범위

Phase 4A의 candidate universe는 normalized GitHub work item이다.

- 사용자에게 직접 할당된 열린 issue
- 사용자에게 review가 요청된 열린 PR의 상태 확인
- authored PR은 context-only negative로 관찰

Codex managed failure, verified stall, scope drift와 configured completion
follow-through는 Phase 4B에서 별도 candidate seed로 추가한다. 현재
projection은 이를 평가했다고 주장하지 않는다.

```text
candidateUniverse = github_work_items_only
codexManagedEligibility = not_evaluated_phase_4a
```

## 3. Exact evidence graph

한 projection은 하나의 `asOf`와 다음 exact dependency를 공유한다.

```text
GitHub normalized batch
→ Phase 3A work relation projection
→ Phase 3B artifact relation projection
→ Phase 3C claim authority projection
→ Phase 4A eligibility shadow projection
```

다음 식별자가 하나라도 다르면 fail closed한다.

- work relation projection SHA-256
- artifact relation projection SHA-256
- claim authority projection SHA-256
- GitHub batch와 source snapshot SHA-256
- managed source revision과 generated time
- managed semantic projection SHA-256
- context registry SHA-256
- exact `asOf`

candidate target은 제목, URL, repository 이름이 아니라
`sourceScopeId + subjectId`로 만든 opaque claim target ref다. relation conflict를
검사할 때도 후보의 exact relation ref만 사용한다.

## 4. Gate 순서

판정은 다음 순서를 지킨다.

1. context-only 또는 지원하지 않는 source kind 제외
2. source-native destination이 없는 후보 제외
3. current-candidate capability가 없는 후보 제외
4. stale source 또는 material truncation은 source refresh로 보류
5. authoritative GitHub work-item state 확인
6. terminal state면 다른 conflict 질문보다 먼저 제외
7. authoritative user relationship 확인
8. 후보 target 또는 exact relation에 연결된 unresolved critical conflict 확인
9. 남은 후보만 eligible

terminal 후보에 다른 field conflict도 있으면 사용자가 불필요한 질문을 받지
않도록 `ineligible`이 우선한다.

## 5. Conflict 범위와 route

전역 `unresolvedCriticalConflictCount > 0`는 gate 조건이 아니다. 프로젝트 A의
충돌이 프로젝트 B 후보를 막으면 안 된다.

후보와 관련된 conflict는 다음 중 하나를 만족한다.

- conflict target ref가 candidate target ref와 같음
- conflict relation refs와 candidate exact relation refs의 교집합이 있음

처리는 다음과 같다.

| Conflict 상태 | Candidate 결과 | 후속 route |
|---|---|---|
| `review_required`, `nextAction=user_review` | `review_required` | `user_review` |
| `review_required`, `nextAction=refresh_sources` | `review_required` | `refresh_sources` |
| `resolved_by_authority` | hard block 아님 | `none` |
| `resolved_by_freshness` | hard block 아님 | `none` |
| 다른 exact target의 unresolved conflict | 후보에 영향 없음 | `none` |

Phase 4A는 전체 Attention decision을 만들지 않는다. Phase 4B selection에서
eligible 후보가 하나라도 있으면 그 후보를 계속 고려하고, eligible 후보가 없을
때만 `user_review`를 `needs_clarification`, `refresh_sources`를
`insufficient_evidence`로 변환한다.

## 6. GitHub review request 경계

현재 GitHub contract는 PR의 draft state를 직접 제공하지 않는다. 따라서 Phase
4A가 허용하는 것은 실제 review intervention이 아니라 다음 inspection이다.

```text
GitHub PR을 열어 draft 여부와 리뷰 가능 상태 확인
```

이 후보는 `actionKind=inspect`이고, draft가 아니라고 추정하거나 실제 review를
완료하라고 주장하지 않는다.

## 7. Coverage

`partial` candidate coverage가 모든 positive candidate를 자동으로 막지는 않는다.
후보 자체의 state, user relationship, destination과 direct evidence가 완결되고
unknown source가 그 후보의 eligibility와 독립적이면 eligible일 수 있다. 이 경우
`ELIGIBLE_WITH_LIMITED_SOURCE_COVERAGE`를 보존한다.

반대로 후보 자체 signal이나 winning claim이 partial, stale 또는 unresolved이면
`review_required/refresh_sources`다.

## 8. Version과 integrity

- projection: `attention-eligibility-shadow-projection-v0.1`
- candidate seed: `attention-candidate-seed-v0.1`
- policy: `hard-attention-eligibility-policy-v0.1`
- evidence: `attention-eligibility-evidence-v0.1`
- resolver: `attention-eligibility-resolver-v0.1`
- ID policy: `attention-eligibility-id-v0.1`

candidate seed ID, assessment ID, input SHA-256와 projection SHA-256는 canonical
input과 version으로 계산한다. assessments, reason codes와 refs는 canonical order와
unique constraint를 통과해야 한다.

## 9. API와 UI

local-only `GET /api/attention/eligibility`가 current projection을 제공한다.

- remote request와 unsafe origin 차단
- `Cache-Control: no-store`
- server에서 authoritative Zod schema와 hash 재검증
- browser에서 strict field/count/version guard 적용
- 내부 오류는 sanitized code만 반환

Attention Lab은 `Shadow · 현재 추천에는 미반영`을 표시하고 후보별 통과, 검토
필요, 제외와 reason code를 보여준다. current-only projection은 Attention history에
저장하지 않는다.

## 10. Privacy와 retention

새 production store나 retention window를 만들지 않는다. projection에는 다음을
넣지 않는다.

- repository 이름, title, native URL 또는 native object ID
- Codex prompt, answer, reasoning
- command, output, diff, file path 또는 tool payload
- credential, token 또는 private source error

별도 synthetic Dev Candidate는 production data와 사용자 conversation을 포함하지
않는다. explicit production feedback도 human review 없이 Golden label로 승격하지
않는다.

## 11. Phase 4B 활성화 전 조건

Phase 4A shadow가 보인다는 사실만으로 active recommendation gate를 release하지
않는다. 다음이 별도로 필요하다.

- managed Codex current failure와 recovery를 exact run identity로 평가
- configured follow-through workflow store
- eligibility를 lane/selection과 한 server-side evidence graph에서 결합
- `needs_clarification`, `insufficient_evidence`, scoped `no_action` decision route
- human-reviewed Golden/holdout 또는 명시적으로 승인된 local-only rollout gate
- 기존 Phase 2 result/replay compatibility와 rollback 검증
