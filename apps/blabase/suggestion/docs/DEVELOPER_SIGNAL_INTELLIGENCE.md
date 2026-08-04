# Developer Signal Intelligence v0.1

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
