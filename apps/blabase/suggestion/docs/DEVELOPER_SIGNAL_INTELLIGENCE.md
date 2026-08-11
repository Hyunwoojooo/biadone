# Developer Signal Intelligence v0.1

## 문서 정보

| 항목 | 값 |
|---|---|
| 상태 | Local developer beta implemented |
| 기준일 | 2026-08-05 |
| 구현 commit | `8e2fe01af08f141ccbb3e424549620543f3c6857` |
| Active Attention | input v0.4 / result v0.5 |
| Evaluation | eligibility v0.2 revision 3, Active v0.2 revision 3 |
| 상세 변경 기록 | `ENGINE_CHANGE_RECORD.md`의 2026-08-05 record |

구현 commit은 검증 후 생성됐다. 이 문서에 기록된 baseline run의 실행 당시
provenance는 `codeCommitSha=null`, `codeState=dirty_worktree`와 fingerprint
`d59d2fdbe5e26ae0d678a3f8ca7e055348647e5c54d86efee3dfdd6c023320d8`이며,
기존 run ID를 위 clean commit에서 재실행한 것으로 소급하지 않는다.

## 목적

GitHub와 Codex에서 수집한 데이터를 곧바로 추천 점수에 넣지 않고, 현재 개발
상태를 설명하는 검증 가능한 중간 표현으로 변환한다. 이 계층의 첫 목표는
1인 개발자와 작은 개발팀에게 유용한 행동 후보를 늘리면서도 과거 대화나 불완전한
snapshot을 현재 사실로 오인하지 않는 것이다.

## 처리 경계

```text
source snapshot
→ RuntimeWorkSignal
→ Developer Work Ledger
→ actionability/open-loop detector
→ evidence verification and currentness check
→ candidate eligibility
→ deterministic ranking
→ one intervention
```

각 단계는 입력 hash, 버전, 판단 이유와 개수를 보존한다. source 원문이나 credential은
이 projection에 포함하지 않는다.

## Developer Work Ledger

ledger는 다음 node를 canonical ID로 보존한다.

- `project`: 사용자가 확인한 GitHub repository와 Codex scope의 작업 단위
- `work_item`: Issue, PR 또는 명시적으로 확인된 사용자 작업
- `execution`: Codex session/run의 관찰 가능한 실행 단위
- `open_loop`: 완료되지 않았을 가능성이 있는 요청, 후속 작업 또는 검증 작업
- `blocker`: CI 실패, changes requested, merge conflict 또는 검증된 실행 실패
- `next_action`: 현재 source로 검증된 사용자의 행동

모든 node에는 source, subject, project, 관찰 시각, 최신성, completeness, evidence
reference와 verification 상태를 기록한다. 원본 값을 수정하지 않고 더 최신 관찰이
이전 해석을 supersede한다.

## GitHub v0.1 판정

명시적인 GitHub 상태는 결정론적으로 판정한다.

| 상태 | authored PR 후보 여부 | 기본 행동 |
|---|---:|---|
| failed check | 후보 | 실패한 check 확인 및 수정 |
| changes requested | 후보 | 요청된 변경 확인 및 반영 |
| merge conflict | 후보 | 충돌 확인 및 해소 |
| draft/open only | 제외 | overview에만 유지 |
| 상태 수집 실패 또는 unknown | 제외 또는 source refresh | 현재 행동이라고 추정하지 않음 |

한 PR에 여러 상태가 있으면 `merge conflict → changes requested → failed check` 순서로
첫 단계를 설명하되 모든 reason을 provenance에 보존한다. 최신 GitHub snapshot만 현재
후보를 만들 수 있다.

## Codex v0.1 판정

Codex inventory/history에서 발견한 내용은 곧바로 Attention 후보가 아니다. 먼저
`OpenLoopClaim`으로 추출하며 다음을 요구한다.

- claim kind: `remaining_work`, `blocker`, `verification_needed`, `follow_through`
- exact session/signal evidence reference
- source updated time과 expiry
- confidence와 verification status
- partial/truncated content 여부
- 더 최신 turn 또는 GitHub 상태에 의한 supersession 정보

v0.1의 deterministic extractor는 명시적인 미완료·실패·검증·후속 작업 표현만
탐지한다. LLM extractor가 추가되더라도 LLM은 claim을 제안할 뿐 추천 순위를 직접
결정하지 않는다. 외부 model에 prompt/answer를 보내려면 별도 동의가 필요하다.

Codex open loop가 실제 후보가 되려면 다음 release에서 최소 하나를 더 만족해야 한다.

- Blabase가 관찰하는 current managed run의 직접 상태
- 사용자가 확인한 GitHub–Codex binding과 GitHub current-state 검증
- 사용자가 해당 open loop를 현재 작업으로 명시적으로 확인

## Candidate Funnel

각 source item은 다음 단계 중 마지막으로 도달한 위치와 reason을 남긴다.

1. `collected`
2. `normalized`
3. `interpreted`
4. `verified`
5. `eligible`, `review_required` 또는 `ineligible`
6. `selected`

연결 실패, snapshot stale, 의미 부족, currentness 미검증, 정책 제외와 ranking 탈락을
서로 다른 reason으로 집계한다. funnel count는 원본 item count와 candidate count를
혼동하지 않게 source별로 분리한다.

## 초기 품질 기준

- 검증되지 않은 authored PR과 Codex history가 추천으로 새지 않아야 한다.
- 검증된 CI 실패, changes requested와 merge conflict는 각각 합성 회귀 사례에서
  eligible 후보가 되어야 한다.
- 모든 후보는 source evidence와 최신 snapshot으로 재현 가능해야 한다.
- 입력 순서가 달라도 ledger, funnel과 top recommendation hash가 같아야 한다.
- 사용자 대화 원문, repository URL, local path와 credential이 committed fixture나
  public monitoring projection에 포함되지 않아야 한다.

## v0.1 구현 상태

- GitHub collector는 `github-snapshot-v3`에서 authored PR의 check 결과,
  changes requested와 merge conflict를 bounded aggregate로 수집한다. 기존
  `github-snapshot-v2`는 기존 normalizer 의미와 hash를 그대로 유지한다.
- Work Ledger, Codex OpenLoop extractor와 Candidate Funnel은 Active Attention과
  같은 `runId`, `analysisId`, `asOf` 및 source batch hash를 사용한다.
- `/api/attention`은 private ledger 자체가 아니라 ledger/funnel hash, entity·claim
  count와 단계별 집계만 `developer-runtime-public-summary-v0.1`로 반환한다.
- Attention Lab의 `작업 장부와 후보 funnel` 패널에서 현재 실행의 단계별 진입,
  제외와 미도달 개수를 확인할 수 있다. v0.1 sidecar는 과거 run별 상세 funnel을
  아직 영속화하지 않는다.
- authored PR의 세 actionability 상태는 Active Attention 후보로 연결된다. Codex
  history claim은 ledger에만 남고 `verified: rejected`에서 멈춘다.

## GitHub 운영 권한

v3 actionability 수집에는 GitHub App repository 권한
`Pull requests: Read-only`, `Checks: Read-only`, `Commit statuses: Read-only`가
필요하다. 하나의 보조 endpoint가 거부되더라도 snapshot 전체를 폐기하지 않고
`actionabilityCoverage=partial`로 기록한다. 이미 확인된 positive 상태는 유지하지만,
unknown을 행동으로 추정하지 않는다. check 이름·출력, reviewer identity, commit SHA와
branch는 snapshot에 저장하지 않는다.

## 후속 범위

1. GitHub unresolved review thread, Project priority, dependency와 linked issue
2. Codex current open-loop lifecycle과 completion/verification detector
3. explicit project identity를 통한 GitHub–Codex temporal join
4. 사용자 feedback(`맞음`, `이미 함`, `중요하지 않음`, `나중에`, `잘못 연결됨`)
5. human-reviewed Developer Attention Golden Dataset

## Current WorkStream / Focus sidecar v0.1

Developer Signal Intelligence의 ledger/funnel과 별도로, Work Cockpit은 같은 request-time
evidence graph에서 Recent Meaningful Event → Current WorkStream → Current Focus를
결정적으로 계산한다. 이 sidecar는 현재 작업 맥락을 설명하지만 기존 candidate funnel의
collected/verified/eligible/selected 수나 Active Attention result를 변경하지 않는다.

v0.1에서 Focus를 선택할 수 있는 근거는 GitHub의 직접 user activity와 complete한
authored-PR actionability state observation, 그리고 Blabase가 직접 소유·검증한 managed
Codex lifecycle/semantic event다. 일반 Codex inventory와 과거 conversation은
historical-context-only다. Notion과 Calendar는 이 projection에 입력되지 않는다.

동일 native identity, explicit user binding/work relation, verified artifact relation만
exact WorkStream을 결합한다. project mapping만 있으면 project-level WorkStream이며,
title·문장·prompt·timestamp 유사도는 결합 근거가 아니다. 최신 direct evidence가 stale,
partial 또는 conflict이면 older healthy event로 fallback하지 않고 Focus를 보류한다.

Phase 1은 `focus-aware-attention-shadow-v0.1`으로 기존 top과 같은 safety tier에서 계산한
counterfactual top을 함께 기록한다. `candidateUniverseChanged=false`,
`eligibilityDiffCount=0`, `attentionSelectionEffect="none"`이 강제된다. Phase 2 활성화는
별도 versioned flag, targeted baseline과 사람 검토 전에는 허용하지 않는다.

GitHub v6 push evidence는 raw commit SHA를 저장하지 않고 normalization 시점에
opaque artifact ID로 바꾼다. Artifact Relation v0.1의 commit `not_observed`
결과는 바꾸지 않고, Recent Event projection에서만 같은 batch/repository의
opaque push, active explicit artifact attribution, exact active work relation을 모두
확인한다. 이 별도 join으로 기존 ledger/funnel, eligibility, Active Attention,
replay v2 해시를 유지한다.

v6 lifecycle activity는 current task mapping 또는 bounded authenticated Issues REST
lookup으로 canonical Issue/PR object ID를 확인한 뒤 internal identity edge로만 사용한다.
lookup failure/limit은 partial/truncated로 fail closed한다. open-only task가 현재 목록에서
제거된 후에도 terminal event를 기존 explicit binding·artifact attribution·managed run과
exact join하며 public projection에 raw object ID를 내보내지 않는다. v5/v0.5와 v4/v0.4는
read compatibility를 유지하되 pre-canonical v5 raw PR ID는 exact native bridge로 쓰지 않는다.

현재 내부 버전은 GitHub snapshot/native activity v6/v0.6, Recent Event
schema/rule/ID v0.2/v0.5/v0.2, WorkStream reconstruction/ID v0.5/v0.5,
Focus selection v0.2, shadow schema/resolver
v0.2/v0.2다. live/monitor/replay는 v0.6/v0.6/v3이며 replay v2는 Active-only
호환 경로로 보존한다. 반복 managed failure는 동일 privacy-safe
fingerprint가 60초·sequence gap 3 경계 안에서 반복될 때만 제외한다.
Recent Event/diagnostic/shadow detail은 각각 1,000/2,000/100개로 bounded하며
초과분을 omitted count로 노출한다. Issue/PR lifecycle은 native anchor를
사용해 terminal transition 전후 WorkStream identity를 안정적으로 유지한다.

현재 connector가 transition timestamp를 증명하지 못하는 review-request 변화, CI 복구,
merge-conflict 복구, command/test outcome은 v0.1 event로 추론하지 않는다. source 계약이
확장되기 전까지 Attention Lab의 제외/coverage 진단으로 남긴다.
