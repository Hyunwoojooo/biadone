# Managed Codex Work Relation Resolution Contract

## 문서 정보

| 항목 | 값 |
|---|---|
| 상태 | Phase 3A local beta · 관계 확인 전용 |
| 기준일 | 2026-08-01 |
| projection | `managed-codex-work-relation-projection-v0.1` |
| schema | `work-relation-schema-v0.1` |
| resolver | `managed-codex-explicit-binding-resolver-v0.1` |
| evidence policy | `explicit-binding-native-id-evidence-v0.1` |
| Attention 사용 | 금지 |

## 1. 목적

Phase 3A는 Blabase가 관리하는 Codex 실행이 **어떤 실제 사용자 작업을
수행하는지**를 설명하는 첫 relation projection을 만든다. 현재 범위는 사용자가
직접 확인한 GitHub 작업과 Codex 실행 사이의 `executes` 관계다.

```text
managed Codex run
+ append-only WorkSessionBinding decision
+ exact GitHub native object observation
+ current explicit project mappings
→ versioned executes relation
→ Work Cockpit relation inspection
```

이 projection은 관계를 관찰하고 검토하기 위한 것이다. 실패·완료·정체를 추천
후보로 승격하거나 ranking에 반영하지 않는다.

## 2. 권위와 입력

### 2.1 관계 권위

`executes`를 만드는 유일한 권위는 기존 append-only `WorkSessionBinding`
ledger의 `action=bind`, `decisionSource=explicit_user` 결정이다.

- 사용자가 Work Cockpit에서 GitHub 작업과 Codex execution을 직접 연결해야 한다.
- managed run의 `bindingId`와 `executionId`가 bind 결정과 정확히 일치해야 한다.
- project co-membership, 제목, repository 이름, local path와 prompt 유사도는
  `executes` 근거가 아니다.
- 별도 relation mutation store를 만들지 않는다. 동일 사용자 결정을 두 store에
  중복 기록하지 않는다.

### 2.2 GitHub identity

GitHub 작업은 `github:object:<native id>`를 exact native identity로 사용한다.
현재 normalized GitHub work signal에서 동일 subject를 찾았을 때만 object type,
number, destination과 source freshness를 보강한다.

- 동일 native ID의 중복 observation은 identity 하나로 정규화한다.
- 서로 다른 native ID는 제목과 project가 같아도 merge하지 않는다.
- 같은 native ID가 서로 양립할 수 없는 object claim을 가지면 conflict다.
- snapshot에서 보이지 않는 것은 `not_observed`이며 `completed`가 아니다.
- stale/truncated snapshot은 해당 상태를 그대로 보존한다.

### 2.3 Project alignment

Project alignment는 current explicit mapping decision만 사용한다.

- Codex 쪽: bind 결정에 보존된 private scope의 confirmed project
- GitHub 쪽: exact work signal repository scope의 confirmed project
- 두 project가 같은 경우 `aligned`
- 둘 다 존재하고 다른 경우 `conflict`
- 한쪽 또는 양쪽 mapping이 없으면 `unmapped`
- registry가 없거나 invalid하면 `unavailable`

같은 project에 속한다는 사실만으로 item-level `executes`, `related_to` 또는
`produces` 관계를 생성하지 않는다. private Codex scope는 public projection에
노출하지 않는다.

## 3. Binding lifecycle

managed projection에 남아 있는 run은 자신이 시작될 때 사용한 exact bind
decision으로 resolve한다. 이후 사용자가 연결을 바꾸거나 해제해도 과거 run의
lineage를 지우지 않는다.

| 상태 | 의미 | 현재 연결로 사용 |
|---|---|---|
| `active` | 해당 bind 결정이 task의 현재 결정 | 예, 단 Attention에는 미연결 |
| `superseded_by_rebind` | 같은 task가 다른 execution으로 다시 연결됨 | 아니요 |
| `superseded_by_unbind` | 사용자가 연결을 해제함 | 아니요 |

과거 관계는 explainability용이다. superseded relation을 live task state나 현재
safe destination으로 취급하지 않는다.

## 4. 출력과 fail-closed 규칙

projection은 source별 독립 revision/hash를 기록한다. managed events,
WorkSessionBinding, GitHub snapshot과 context registry가 하나의 원자적 source라고
표현하지 않는다.

각 relation은 최소한 다음을 포함한다.

- canonical `relationId`
- `managedRunId`, `bindingId`, opaque `executionId`
- `type=executes`, `authority=user_configured`
- GitHub work identity와 exact observation 상태
- binding lifecycle
- project alignment와 conflict code
- evidence/reference lineage
- `attentionDisposition=not_connected`
- `forbiddenAsAttentionCandidate=true`

다음 경우 관계를 추정하지 않고 resolution conflict 또는 unsupported 상태를
기록한다.

- bind 결정이 없거나 action이 bind가 아님
- run과 bind 결정의 execution identity 불일치
- task source가 현재 Phase 3A 범위인 GitHub가 아님
- GitHub subject 형식이 exact native identity가 아님
- 중복 native observation이 서로 충돌함

## 5. Phase 3A projection이 생성하지 않는 관계

Phase 3A work relation projection은 다음 관계를 생성하지 않는다.

- `produces`: Phase 3B의 별도 explicit-user artifact attribution 계약과
  projection에서만 생성
- `related_to`: 별도의 user-confirmed work-to-work link가 필요
- `same_work_item`: provider-native 동일 객체 또는 사용자 확인이 필요

Codex `turn_completed`, `file_change`, command activity, 같은 project, 비슷한
title만으로 위 관계를 생성해서는 안 된다.

## 6. API와 UI

relation projection은 managed event API와 별도의 local-only, read-only GET으로
제공한다.

- managed event/semantic projection의 2초 polling과 relation polling을 분리
- `Cache-Control: no-store`
- safe local read origin 검증
- relation은 exact `managedRunId → run resolution → relationId`로 UI와 join하며
  binding/execution identity도 projection schema에서 일치해야 함
- managed polling과 relation polling revision이 엇갈리면 같은 binding의 과거
  relation을 새 run에 붙이지 않고 미확인으로 표시
- API unavailable은 `연결 근거 확인 불가`로 표시하고 `연결 없음`으로 단정하지
  않음
- stale/not-observed/superseded/project-conflict 상태를 사용자에게 구분해 표시

## 7. Privacy와 retention

- 새 production relation store를 만들지 않고 현재 source ledger에서 projection을
  계산한다.
- raw prompt/answer/reasoning, command/output, diff/path, tool payload, native Codex
  thread/turn/item ID와 private scope를 입력·API·UI에 복제하지 않는다.
- GitHub title과 repository name은 identity resolution 근거로 사용하지 않는다.
- exact observation이 제공하는 safe GitHub destination URL은 local-only,
  `no-store` 응답에서만 노출하고 별도 relation store에는 보존하지 않는다.
- public output은 bounded하고 canonical hash로 integrity를 검증한다.
- relation lifetime은 참조하는 managed run과 source ledger의 기존 retention을
  넘겨 별도 연장하지 않는다.
- production relation과 implicit UI feedback은 Gold가 아니다.

## 8. Evaluation gate

별도 mutable synthetic Dev Candidate를 사용한다.

- dataset: `suggestion-work-relation-dev-v0.1`, revision `1`
- case count: `28`
- dataset canonical SHA-256:
  `b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002`
- materialized input SHA-256:
  `7d43dd080f3730cf45557448ba57728632def4fabf30683c8729caf314d8424f`
- resolver config SHA-256:
  `f75d01cb54b58f8d76ba4174662df481b5637bae6824b40fd6d07be55987ecee`
- input boundary: `work_relation_resolution_inputs`
- provider/model/prompt/token usage: `not_applicable`
- exact case match: `28/28`
- expected/observed relation: `24/24`
- relation/identity precision·recall: `1.0/1.0`
- false identity merge, title-only relation, project-only relation,
  lifecycle-only `produces`, superseded-as-current leakage: 각각 `0`
- conflict의 Attention leakage: `0`
- privacy sentinel와 permutation determinism failure: `0`
- deterministic output SHA-256:
  `bbf9d6a97090b44a464d362fee24cceb97b89b7a265baa2d8be30c454b1776a4`
- candidate run ID: `relation_run_2fce51ef1e1447638f1d9ab1b79623b7`

이 dataset은 synthetic mutable 개발 gate다. human-reviewed Golden이나 실제 제품
추천 품질을 의미하지 않는다.

## 9. 다음 단계

Phase 3A 이후 계약의 현재 상태는 다음과 같다.

1. `[Phase 3B 완료]` privacy-safe explicit-user artifact identity와 `produces`.
   `ARTIFACT_RELATION_RESOLUTION_CONTRACT.md`를 따름
2. `[후속]` user-confirmed work-to-work `related_to`
3. `[후속]` field-level claim authority와 GitHub/Notion conflict record
4. `[후속]` relation과 materiality를 요구하는 Codex failure intervention gate
5. `[후속]` configured project workflow 기반 completed follow-through

위 단계가 완료되기 전에는 relation projection을 Attention input, replay hash,
candidate, ranking 또는 selection에 연결하지 않는다.
