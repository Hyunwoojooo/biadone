# Claim Authority & Conflict Resolution Contract

상태: Phase 3C projection + Phase 4B eligibility integration local beta 통과

## 1. 목적

이 계약은 여러 source가 제공하는 사실을 하나의 범용 상태로 섞지 않고,
각 semantic field에 권위가 있는 source를 판정하며 원본 claim과 충돌을 보존하는
규칙을 정의한다.

Phase 3C의 결과는 Work Cockpit의 보수적인 관찰 정보다. source가 직접
증명하는 값보다 넓게 추론하지 않으며 claim 자체를 Attention 후보나 점수로
바꾸지 않는다. Phase 4A/4B는 동일 request-time evidence graph의 exact dependency
hash와 relevant unresolved conflict만 별도 hard eligibility gate로 소비한다.

## 2. v0.2 실제 평가 범위

현재 live runtime에서 직접 평가할 수 있는 범위는 다음과 같다.

- GitHub normalized snapshot의 exact native work-item identity
- GitHub open work-item state
- GitHub query membership이 직접 말하는 현재 사용자 관계
- GitHub milestone due time
- Blabase가 소유한 managed Codex event stream의 execution state
- 사용자가 직접 확인한 source scope project mapping의 alignment

다음 source는 연결되어 있어도 field conflict 평가 대상이 아니다.

- Codex inventory/history: live execution state가 아니므로 context-only
- Notion snapshot v1: page/data source metadata만 있으며 task state, owner,
  priority와 due property가 없으므로 project-context-only
- Google Calendar adapter: schedule context만 있으며 event와 work item의 exact
  equivalence가 없으므로 schedule-context-only

따라서 현재 제품에서 `GitHub merged ↔ Notion open` 같은 충돌을 생성하지 않는다.
이를 평가하려면 exact same-work-item relation과 Notion task property adapter가 먼저
필요하다.

schema와 synthetic Dev Candidate는 향후 Notion task, Calendar native event,
explicit feedback field를 분리된 semantic domain으로 예약한다. 그러나 live
runtime의 canonical coverage가 `context_only` 또는 `unavailable`로 보고하는
source에서는 authoritative claim을 만들 수 없다. future field의 schema
존재는 live adapter 제공을 뜻하지 않는다.

## 3. Claim 경계

모든 claim은 다음을 보존한다.

- canonical `claimId`, `claimKey`, opaque target ref와 lineage ref
- source와 origin
- source별 semantic field
- bounded enum, timestamp 또는 opaque hash 값
- authority tier, freshness, completeness와 directness
- 관찰 시각과 source update 시각
- opaque evidence refs와 기존 exact relation refs

public projection에는 repository 이름·URL, Notion title/resource ID, Calendar
title/event ID, Codex prompt·답변·command·path, GitHub native object ID와 full commit
OID를 복사하지 않는다.

`state`, `deadline` 같은 범용 field는 금지한다. v0.1 field는 다음처럼 source
semantic domain을 분리한다.

- `github_native_identity`
- `github_work_item_state`
- `github_user_relationship`
- `github_milestone_due_at`
- `managed_codex_execution_state`
- `project_alignment_identity`
- future contract 전용 `notion_task_state`, `notion_internal_priority`
- future contract 전용 `calendar_event_state`, `calendar_event_time`
- future explicit feedback 전용 `user_disposition`

이 분리 때문에 `managed_codex_execution_state=completed`와
`github_work_item_state=open`은 충돌이 아니다.

v0.2의 deduplicate된 projection은 claims, resolutions, conflicts를 각각
최대 `12,000`개까지 보존한다. claim과 conflict의 exact relation reference는
최대 `100`개다. 이는 managed run 저장 상한 `10,000`개와 Phase 3A relation
projection 상한 `100`개를 손실 없이 수용하는 계약이다. raw resolver
input 자체의 상한이 아니며, projection 상한을 넘는 결과를 임의로
잘라 성공으로 표시하지 않고 schema error로 fail closed한다.

## 4. Field authority

| Field | authoritative source | 제한 |
|---|---|---|
| GitHub native identity | GitHub exact repository scope + native object | 번호·title·URL만으로 join 금지 |
| GitHub work-item state | GitHub exact object field | 현재 collector는 `open`만 직접 증명 |
| GitHub user relationship | GitHub query membership | 전체 owner 목록 또는 중요도를 뜻하지 않음 |
| GitHub milestone | GitHub milestone field | Calendar event나 일반 task deadline으로 변환 금지 |
| managed Codex execution | Blabase-owned managed event stream | linked work/project 완료를 뜻하지 않음 |
| Codex inventory execution | context-only | live managed claim을 이길 수 없음 |
| project alignment | explicit-user source-scope mappings 두 개 | 같은 project만으로 item identity 생성 금지 |
| Notion task state | future configured Notion task DB adapter | 일반 page metadata 사용 금지 |
| Notion internal priority | future configured Notion task DB 또는 explicit user | 외부 deadline·urgency 생성 금지 |
| Calendar event state/time | future native Calendar event adapter | task state·deadline으로 변환 금지 |
| user disposition | future explicit feedback | native source 원본을 덮어쓰지 않음 |

지원하지 않는 source-origin-field-target 조합은 fail closed한다. resolver는
source coverage의 status와 `claimFields`가 claim authority/freshness와 일치하는지도
확인한다. 중복 source coverage, context-only source의 authoritative claim,
stale coverage의 current claim은 거부한다.

## 5. Exact grouping과 lineage

claim은 exact opaque target ref와 semantic field가 모두 같을 때만 비교한다.

- GitHub target은 repository native scope와 object native ID에서 hash한다.
- managed Codex target은 managed run ID, binding ID와 execution ID에서 hash한다.
  실행 ID를 재사용해도 이전 run의 terminal state와 새 run의 current state를
  한 target으로 충돌시키지 않는다.
- project alignment target은 기존 exact `executes` relation ID에서 hash한다.
- `executes`, `produces`, 같은 project, title/path/time 유사성은 field equivalence가
  아니다.
- superseded binding과 artifact attribution은 current claim authority가 아니다.
- GitHub commit attribution은 provider-verified existence/state claim을 만들지
  않는다.

lineage ref는 같은 source object의 시간순 관찰만 묶는다. 최신 timestamp는 같은
lineage 안에서만 이전 값을 supersede할 수 있다. 서로 다른 source scope나 서로
다른 explicit mapping lineage는 시각만으로 덮어쓰지 않는다.

## 6. Resolver 규칙

1. schema, source-origin-field-target matrix, coverage, hash, timestamp와 dependency
   projection을 검증한다.
2. provider timestamp는 upstream freshness policy와 같은 최대 `60,000ms` future clock
   skew만 허용한다. managed projection generation time은 `asOf`보다 느슨할
   수 없다.
3. byte-identical claim만 deduplicate하고 원본 개수를 기록한다. resolver
   input hash는 deduplicate 전 canonical claim ID multiset과 원본 개수를 포함해
   입력 multiplicity를 보존한다.
4. claim key별로 current authoritative claim을 찾는다.
5. 같은 lineage에서는 strictly newer direct observation만 이전 값을 대체한다.
6. 서로 다른 authoritative lineage가 다른 값을 말하면 winner 없이
   `review_required`로 둔다.
7. stale authoritative claim 또는 context-only claim만 있으면
   `insufficient_evidence`다.
8. project alignment는 서로 다른 두 explicit mapping lineage가 같은 값을 말할
   때만 resolved다.
9. 낮은 authority, stale authority 또는 오래된 lineage의 다른 값은
   삭제하지 않고 resolved conflict record로 보존한다.
10. snapshot absence, GitHub activity-only record와 unknown 값은 현재 state claim을
    생성하지 않는다.
11. resolution은 해당 claim key의 모든 claim을 exact partition으로 포함하고,
    다른 value가 있는 key는 정확히 하나의 conflict를 가진다. stable ID,
    winner, reason, next action과 relation refs가 그래프와 일치하지 않으면
    projection 전체를 거부한다.
12. 같은 입력, `asOf`와 version에서는 같은 claim/resolution/conflict ID와 hash를
    생성한다.
13. 같은 native pull request가 authored query와 review-requested query에 동시에
    나타나는 것은 서로 양립 가능한 사용자 역할이다. source scope, subject,
    object type, number, destination과 project identity가 모두 같을 때만
    action-driving direct role인 review request를 단일 relationship claim으로
    선택한다. native identity가 하나라도 다르면 합치지 않고 기존 fail-closed
    conflict 경계를 유지한다.

## 7. Conflict record

서로 다른 값이 존재할 때 conflict는 다음 상태 중 하나다.

- `resolved_by_authority`: current authoritative source가 lower authority claim을
  이김
- `resolved_by_freshness`: 동일 exact lineage의 strictly newer observation 또는
  current authoritative evidence와 다른 stale authoritative evidence를 분리
- `review_required`: 동등한 authoritative 값이 다르거나 current authority가 없음

모든 v0.1 conflict는 보수적으로 critical이다. `review_required` conflict에는
winner가 없으며 `refresh_sources` 또는 `user_review` next action만 제공한다.
resolver가 source를 수정하거나 사용자 대신 충돌을 해결하지 않는다.

## 8. Projection과 API

`claim-authority-projection-v0.1`은 기존 local-only
`GET /api/work-relations` 응답의 `claims` 필드에 중첩한다.

현재 버전 세트는 다음과 같다.

- claim schema: `work-claim-schema-v0.1`
- conflict schema: `claim-conflict-schema-v0.1`
- resolver: `cross-source-claim-resolver-v0.2`
- field authority policy: `field-claim-authority-policy-v0.1`
- evidence policy: `direct-source-claim-evidence-v0.1`

projection은 다음 dependency hash를 exact하게 보존한다.

- Phase 3A work relation projection SHA-256
- Phase 3B artifact relation projection SHA-256
- GitHub normalized batch/snapshot SHA-256 또는 unavailable
- managed Codex source revision과 generated time
- managed Codex semantic projection SHA-256
- project context registry SHA-256 또는 unavailable

API는 동일 Work Resumption/managed authority lease와 동일 `asOf`에서 Phase 3A,
Phase 3B, Phase 3C를 생성한다. nested hash나 relation ref가 다르면 fail closed한다.
managed Codex claim은 public latest state만으로 생성하지 않고, 동일 revision의
semantic evidence ID, sequence, event, window/detector/projection SHA를 exact evidence ref에
포함한다. 상태와 일치하는 direct semantic evidence가 없으면 claim을 만들지
않는다.

server는 canonical Zod contract와 SHA-256를 검증한 뒤 응답한다. browser client는
Node crypto를 재실행하지 않지만 version, dependency, bounded field, ID/ref,
resolution/conflict graph와 Attention 격리 필드를 다시 검증하고 잘못된
ready/non-ready response를 UI에 전달하지 않는다.

## 9. Source coverage와 UI

projection은 GitHub, managed Codex, Codex inventory, Notion, Google Calendar와
explicit-user mapping의 coverage를 항상 각각 기록한다.
여섯 source는 중복 없이 정확히 한 번씩 등장해야 하며, coverage와 다른
authority/freshness의 claim은 projection에 들어가지 못한다.

Work Cockpit은 다음을 구분한다.

- 충분히 평가했고 충돌 없음
- 비교 가능한 claim이 없어 판정하지 않음
- stale/partial/unavailable
- context-only라 field를 평가하지 못함
- resolved conflict
- unresolved critical conflict

UI는 `claim과 충돌 자체는 후보가 아님`을 표시하고, relevant conflict가 실제
후보 eligibility에 미친 영향은 active Attention 결과에서 별도로 설명한다. 사용자
correction 저장 계약이 생기기 전에는 conflict 해결 버튼을 제공하지 않는다.

## 10. Attention 격리

projection, resolution과 conflict는 모두 다음을 강제한다.

- `attentionDisposition = not_connected`
- `forbiddenAsAttentionCandidate = true`

Phase 3C projection 자체는 candidate filtering, ordering, ranking 또는 selection을
수행하지 않는다. Phase 4A/4B가 별도 evaluation과 version change를 거쳐
`NoCriticalConflict` eligibility gate를 구현했다. active input/result v0.4는
사용한 eligibility projection과 claim dependency hash를 private replay v2 및
monitor v0.4 provenance에 포함한다. unresolved conflict 전체 개수가 아니라 exact
candidate target 또는 relation에 relevant한 conflict만 차단한다.

## 11. 평가와 데이터

평가는 `suggestion-claim-authority-dev-v0.1` revision `2` mutable synthetic
Dev Candidate `40`건을 사용한다. 각 case는 expected semantic summary와 exact
projection SHA-256를 함께 고정하며 expected rejection case는 `null` projection을
검증한다.

- production conversation, prompt, answer, implicit feedback 사용 금지
- 기존 frozen Golden과 Phase 3A/3B dataset 수정 금지
- direct source authority, stale, completeness, lineage, conflict,
  cross-domain non-conflation, determinism, tamper와 privacy를 검증
- GitHub activity/absence를 current completion으로 승격하는 경우 release 실패
- Notion/Calendar context-only metadata에서 task state를 만드는 경우 release 실패
- Attention leakage가 하나라도 있으면 release 실패
- resolution/conflict precision·recall은 모두 `1.0`, exact case/projection은
  `40/40`, Phase 3A/3B/Cross-source dependency dataset hash mismatch과 authority,
  stale/context winner, cross-domain conflation, false/missed conflict, timestamp-only
  override, future evidence, privacy, determinism guardrail은 모두 `0`이어야 함

현재 targeted test의 deterministic record는 resolution `42/42`, conflict `9/9`,
exact case `40/40`과 모든 zero guardrail 통과를 검증한다. dataset canonical
SHA-256은
`809e459b2e27e26791ce20ba4599450818425b48603ba76cb2a8cad45544fe4d`,
materialized input SHA-256은
`12f1eb24d6522170e828bfbf406b324d8d2d600b7a9013016d6c6adf95d5f8f1`,
deterministic output SHA-256은
`34e560c4894f1b84c66348779a804fb014fdd01f28d70088c49a9163ce0a654a`다.

평가 dependency는 다음 canonical SHA-256를 고정한다.

- Phase 3A work relation:
  `b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002`
- Phase 3B artifact relation:
  `fdc9112a5164c63619489304ec8af398cae498597631303ffe6e3cda51f8a2c8`
- Cross-source Dev Candidate revision 2:
  `d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df`
- resolver config:
  `98ddd2fd399286a89f23737ab7a3fa76cd16e2317150ca78800edcd2bfe63db0`

synthetic baseline은 실제 cross-source recommendation 품질이나 human-approved Gold를
뜻하지 않는다. final candidate run은
`claim_authority_run_0079980ec2ea503ca9718bc48f8846e6`, code fingerprint는
`6ec1896adacc92f474b9894a903095cf74667dcd680922c4eb542e6dee6cc0d5`이며
exact case `40/40`, resolution `42/42`, conflict `9/9`과 모든 zero guardrail을
통과했다. artifact SHA-256은
`0d2c04922a4746113fea55f33f3fe683466ae8188205c1b08d174f1cef5cf452`다.
revision 2는 같은 native PR의 compatible multi-role false conflict를 수정한 mutable
Dev Candidate 변경이다. frozen dataset은 수정하지 않았고 revision 1 run은 기존
Engine Change Record와 private artifact에 보존한다.

## 12. Privacy와 retention

- claim authority를 위한 새 production store를 만들지 않는다. projection은
  기존 GitHub snapshot, context registry, managed semantic evidence와 Phase 3A/3B
  projection에서 request-time에 계산한다.
- source store의 기존 retention을 연장하지 않고, claim/conflict를 새로
  persistence하지 않는다.
- public API/UI는 bounded enum, timestamp, opaque hash/ID와 reason code만 표시한다.
  raw prompt/answer/reasoning, command/output, diff/path, tool payload, repository
  name/title/URL, Notion/Calendar title/native ID를 복사하지 않는다.
- evaluation data는 committed synthetic sanitized metadata만 사용하며 production
  conversation, implicit feedback과 projection을 Gold로 자동 승격하지 않는다.

## 13. Compatibility와 rollback

Phase 3C는 local-only `GET /api/work-relations`에 `claims`를 추가한 additive
nested contract다. resolver v0.2는 projection schema를 바꾸지 않고 compatible
same-PR roles의 false conflict만 교정한다. 현재 internal client와 Phase 4B active
engine은 resolver v0.2를 strict하게 요구하므로 서버, browser client와 active
Attention을 함께 배포해야 한다. dependency가 엇갈리는 이전/partial runtime은
거짓 ready나 suggestion을 보여주지 않고 fail closed한다.

rollback은 Phase 4B active Attention과 함께 resolver/client expectation을 v0.1로
복귀하거나, Work Cockpit의 claim/conflict UI와 `/api/work-relations`의 `claims`
nested projection, `src/claims`를 제거해 Phase 3B API/UI로 복귀한다. 신규
production store나 migration이 없으므로 data migration/cleanup은 필요 없다.

## 14. 사용자 판단 필요 여부

현재 Phase 4B local beta를 완료하는 데 추가 사용자 판단은 필요하지 않다.
이미 확정한 exact identity, relevant conflict fail-closed와 적극 추천 원칙 안에서
구현했고 외부 source를 수정하지 않는다. Notion/Calendar의 authoritative adapter,
same-work-item equivalence와 conflict correction은 후속 phase의 별도 제품 판단이다.

## 15. 후속 범위

- exact bound GitHub object의 closed/merged current-state adapter
- configured Notion task DB property mapping
- user-confirmed same-work-item/equivalent-field relation
- Calendar event와 work item의 explicit relation
- explicit feedback/correction ledger
- human-reviewed Cross-source Golden/locked holdout
- production distribution에서 compatible-role false conflict와 clarification 품질 검증
