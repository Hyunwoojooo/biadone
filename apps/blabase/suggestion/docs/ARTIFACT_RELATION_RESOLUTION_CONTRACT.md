# Managed Codex Artifact Relation Resolution Contract

상태: Phase 3B local beta contract
범위: 사용자가 명시적으로 확인한 managed Codex run과 GitHub commit/PR 사이의
`produces` 관계

## 1. 목적과 경계

이 계약은 “Codex에서 활동이 보였다”를 “이 GitHub 결과물을 만들었다”로
추정하지 않는다. 사용자가 특정 managed run에 정확한 GitHub artifact를
연결하거나 해제한 결정만 append-only lineage로 기록하고, 기존 Phase 3A
`executes` 관계와 identity가 모두 일치할 때만 `produces`를 projection한다.

현재 범위에 포함되는 것은 다음뿐이다.

- GitHub commit
- GitHub pull request
- `attach`와 `detach`의 명시적 사용자 결정
- active relation과 superseded lineage의 분리
- local-only 관찰 projection

다음은 포함하지 않는다.

- 사용자 확인 없는 `related_to`
- branch 자체를 artifact로 저장하거나 branch 이름으로 관계를 추정하는 기능
- commit/PR이 task 또는 project를 완료했다는 판정
- managed repository HEAD 전환을 자동으로 hard `produces` 근거로 쓰는 기능
- Attention candidate, ranking, selection 또는 추천 문구 입력

## 2. 유일한 관계 권한

relation의 authority는 `user_configured`이며, 그 근거가 되는 attribution
decision의 source는 반드시 `explicit_user`다. 다음 관찰은 단독 또는 조합으로
관계를 생성할 수 없다.

- `turn_completed`, `item_completed`, `file_change`
- title, branch, project 또는 시간 유사성
- 같은 cwd, repository 이름 또는 URL 문자열 유사성
- LLM 요약·분류·judge 점수
- production 로그나 implicit UI feedback

명시적 결정이 없으면 관계가 없는 것이 아니라 “관계 권한이 제공되지 않음”이다.

## 3. Artifact identity

### 3.1 Commit

commit identity는 다음 tuple이다.

```text
(provider=github, repositoryNativeId, fullCommitOid)
```

- OID는 사용자가 제출한 exact URL의 전체 40자 또는 64자 hex를 소문자로
  정규화해 사용한다.
- v0.1 GitHub adapter는 commit object를 수집하지 않으므로 repository native ID는
  저장된 snapshot과 대조하지만 commit의 실제 존재 여부는 provider-verified가
  아니다. 이 관계는 사용자의 명시적 attribution이며 GitHub의 존재 확인으로
  표시하지 않는다.
- short SHA, non-hex OID, repository native ID가 모호한 입력은 거부한다.
- repository 이름, branch, title과 시간은 identity가 아니다.

### 3.2 Pull request

pull request identity는 다음 tuple이다.

```text
(provider=github, repositoryNativeId, pullRequestNativeObjectId)
```

- PR 번호는 표시와 corroboration metadata로 저장하지만 stable artifact key와
  `artifactId`에서는 제외한다. persisted identity authority는 repository native ID와
  PR native object/database ID다.
- attach 순간에 로컬에 저장된 GitHub snapshot에서 URL이 가리키는 PR과
  repository native ID, PR native object/database ID가 exact match해야 한다.
- attach validation은 snapshot freshness나 completeness를 요구하지 않는다.
  stale/truncated snapshot에서 확인한 명시적 사용자 결정은 그 source limitation을
  보존한다.
- 같은 PR 번호라도 repository native ID가 다르면 서로 다른 artifact다.
- unavailable, stale, not-observed 또는 conflicting observation을 current exact
  identity로 승격하지 않는다.

### 3.3 URL 처리

사용자가 입력한 exact GitHub URL은 attach 요청에서만 parse·검증하는 transient
input이다. raw URL, owner/repository 문자열과 query/fragment는 attribution store,
relation projection, evaluation record에 저장하지 않는다.

## 4. Run과 Phase 3A relation 검증

`produces`를 resolve하려면 다음 값이 모두 exact match해야 한다.

1. attribution의 `managedRunId`가 Phase 3A projection에 존재
2. attribution의 `bindingId`가 run resolution과 일치
3. attribution의 `executionId`가 `executes` relation의 Codex endpoint와 일치
4. run resolution이 실제 resolved `executes` relation을 참조
5. attribution이 참조한 executes relation identity가 projection과 일치

v0.1 projection은 attribution별 resolution enum이나 conflict code를 만들지
않는다. 위 exact join을 통과한 attach만 relation으로 내보내고, 통과하지 못한
attach는 삭제하지 않은 채 `unresolvedAttributionCount`에 집계한다. GitHub
observation의 conflict는 relation의 `githubObservation.status=conflict`로
보존한다.

## 5. Decision lineage와 결정성

- attribution store는 retained window 안에서 append-only인 attach/detach decision
  ledger다.
- exact active identity의 중복 attach는 current relation을 중복 생성하지 않는다.
- detach는 과거 attach를 삭제하지 않고 current 사용만 종료한다.
- detach 뒤 reattach는 새 결정으로 기록하며 과거 lineage를 보존한다.
- append-only ledger는 exact artifact마다 하나의 current producer만 허용한다.
- 한 run은 여러 artifact를 가질 수 있고 여러 run은 서로 독립된 artifact를
  가질 수 있다.
- canonical output은 입력 배열 순서와 무관하게 stable identity로 정렬한다.
- integrity hash가 일치하지 않는 store는 fail closed한다.
- 물리 store는 30일 cutoff와 최대 1,000 decision cap을 적용한다. 삭제된 content를
  무기한 보존하지 않으며 lifetime `revision`과 `prunedDecisionCount`만 누적해
  retained count와 hash의 정합성을 검증한다.

## 6. API/UI와 Attention 격리

artifact relation API는 loopback local-only, `Cache-Control: no-store` 경계다.
UI는 exact `managedRunId`·`bindingId`·`executionId`로만 managed run과 join한다.
polling revision이 엇갈리면 과거 relation을 다른 current run에 붙이지 않는다.
GitHub source가 unavailable이어도 exact Phase 3A join과 explicit attribution은
`produces` lineage로 남고 observation만 `unavailable`이다. 이를 GitHub current
확인이나 Attention eligibility로 승격하지 않는다.

artifact projection의 `destinationUrl`은 observation 상태와 무관하게 항상
`null`이다. repository 이름을 포함한 raw/safe URL을 API output에 복제하지 않는다.

모든 projection과 relation은 다음 불변식을 가진다.

```text
attentionDisposition = not_connected
forbiddenAsAttentionCandidate = true
```

Phase 3B는 Cross-source Attention input/result, replay/monitor hash, filtering,
ordering, candidate, ranking과 selection을 바꾸지 않는다.

## 7. Privacy와 retention

- attribution metadata는 사용자의 local private store에만 둔다.
- retention cutoff는 30일이며 다음 store read에서 cutoff를 넘은 decision을
  prune한다. production mutation은 write 전에 이 read를 수행한다. 로컬 앱이
  실행되지 않거나 store에 접근하지 않는 동안에는 파일을
  만질 수 없으므로, 물리적 삭제는 다음 접근 또는 source lifecycle purge에서
  수행된다.
- atomic write 도중 중단되어 남은 strict-name temporary file은 다음
  read/write와 source lifecycle purge에서 제거하며, 패턴이 다른 sibling file은
  건드리지 않는다.
- integrity/schema가 invalid인 store는 relation read를 fail closed한다. invalid
  file의 mtime이 30일 cutoff를 넘었으면 같은 read에서 삭제하되, 그 요청 자체는
  성공으로 가장하지 않는다.
- raw URL은 transient parse-only이며 저장하지 않는다.
- raw prompt/answer/reasoning, command/output, diff, file path, tool payload,
  native Codex thread/turn/item ID를 복제하지 않는다.
- synthetic evaluation artifact에는 production conversation이나 production
  attribution을 넣지 않는다.
- production relation, implicit feedback과 LLM judge score는 Gold가 아니다.

GitHub disconnect·OAuth connection replacement·installation replacement와 Codex
disconnect·Work Resumption clear는 attribution store도 함께 제거한다. GitHub
snapshot read/URL validation과 connection mutation은 같은 Work Resumption state
lease 순서를 사용하므로, 완료된 source purge 뒤 old snapshot 기반 attach가 ledger를
되살릴 수 없다. retention 연장이나 production 데이터의 Golden/Regression
승격에는 별도 lawful-basis, 최소화, 익명화와 human review가 필요하다.

attach·detach·read는 Work Resumption shared state lease를 획득한 뒤 단일 clock으로
`asOf` 또는 decision time을 생성한다. 잠금 대기 전에 만든 오래된 시각으로
freshness나 retained-window append-only decision을 판정하지 않는다. store는
decision-time regression을 거부하고 resolver는 `asOf`보다 미래인 attribution
evidence를 fail closed한다. 첫 attachment 전 empty ledger는 고정 epoch를 사용해
poll마다 hash가 흔들리지 않는다.

artifact store는 별도 nested lock을 획득하지 않고 위 shared state lease를 유일한
mutation ownership 경계로 사용한다. filesystem lease는 5초마다 mtime을 갱신하고
token·device·inode·owner PID를 검증한다. stale cleanup은 두 번 재검증하며 살아 있는
local owner PID의 lock은 제거하지 않는다. renewal 또는 종료 시 ownership이 바뀌면
fail closed한다. 이는 단일 local filesystem의 beta 경계이며 distributed/device 간
fencing을 제공하지 않는다. Phase 3B critical section은 local bounded
read/normalize/write만 수행하고 provider/network 요청을 포함하지 않는다.

## 8. Evaluation gate

별도의 mutable synthetic Dev Candidate
`suggestion-artifact-relation-dev-v0.1` revision `1`을 사용한다. 기존 Phase 3A
dataset은 수정하지 않으며 그 canonical SHA-256
`b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002`를 회귀
gate로 고정한다.

Phase 3B의 최소 release gate는 다음과 같다.

- 32개 synthetic case exact match
- false positive/false negative `0`
- implicit-signal 및 similarity hard-negative leakage `0`
- invalid/ambiguous identity와 run-binding-execution mismatch leakage `0`
- unavailable/stale/not-observed/conflict의 current observation-claim leakage `0`
- privacy sentinel·raw URL persistence `0`
- Attention leakage `0`
- permutation determinism failure `0`
- provider/model/prompt/token usage `not_applicable`

이 평가는 rule-only resolver의 개발 gate이며 human-reviewed Golden이나 제품
추천 품질을 의미하지 않는다. 실제 hash, run ID와 검증 명령은 해당 Engine
Change Record에 기록한다.

## 9. 후속 사용자 결정

Phase 3B 이후 작업은 이 결정을 기다리지 않는다. 다만 향후 “managed repository의
HEAD가 자동으로 전환된 사실”을 hard `produces` 근거로 쓰는 범위를 시작하려면
먼저 사용자 결정을 받아야 한다. 현재 기본값은 인정하지 않는 것이며, 결정 전에는
HEAD transition을 artifact attribution으로 자동 적용하지 않는다.

그 밖의 후속 범위는 user-confirmed `related_to`, field-level claim authority,
materiality gate, artifact evidence를 이용한 failure/stall intervention과
configured workflow follow-through다.
