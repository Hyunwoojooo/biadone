# Project Workflow Follow-through Contract v0.1

상태: Phase 4B local subsystem 구현. 이 문서는 프로젝트별 완료 후속 작업
설정과 명시적 closure 기록의 경계를 정의한다.

## 1. 제품 결정

- 기본값은 `unknown`이다. 설정이 없으면 Codex 실행 완료만으로 commit, PR,
  review 후속 작업을 추정하지 않는다.
- 사용자가 프로젝트별로 직접 선택할 수 있는 값은 다음 네 가지뿐이다.
  `review_changes`, `commit_changes`, `create_pull_request`, `request_review`.
- 설정, 변경, 해제는 모두 사용자가 UI에서 명시적으로 반영한 경우에만
  append-only decision으로 기록한다.
- 같은 값을 다시 저장하거나 이미 해제된 값을 다시 해제하는 요청은 새
  decision을 만들지 않는 idempotent no-op이다.

## 2. 저장 계약

로컬 저장 위치는 `.local/context/project-workflows.json`이다. directory는
`0700`, file은 `0600`으로 고정하고 temporary file을 같은 directory에 쓴 뒤
atomic rename한다.

저장소는 다음 두 event 계열을 보존한다.

1. `configure | clear` decision
2. managed run별 `completed | skipped` closure

event는 전역 연속 sequence, canonical UTC timestamp, stable ID, 명시적 이전
decision reference를 가진다. 배열을 덮어쓰거나 과거 결정을 수정하지 않는다.
내용 전체의 canonical SHA-256이 맞지 않거나 unknown field, 순서 역행, 중복
ID, 잘못된 supersession/closure identity가 있으면 저장소 전체를 invalid로
처리한다.

계약 버전은 다음과 같다.

- store: `project-workflow-store-v0.1`
- schema: `project-workflow-schema-v0.1`
- policy: `project-workflow-follow-through-policy-v0.1`
- projection: `project-workflow-projection-v0.1`
- ID policy: `project-workflow-id-v0.1`

store에는 title, repository name, prompt, answer, command, output, diff, path 또는
다른 원문을 저장하지 않는다. opaque project/run/binding/execution ID와 제한된
enum, timestamp만 저장한다.

## 3. 현재 projection

현재 projection은 다음 필드만 반환한다.

- contract/schema/policy version
- `asOf`, `revision`, `storeSha256`, `projectionSha256`
- 프로젝트별 최신 configure decision인 `activeWorkflows`
- append-only `closures`

`activeWorkflows`는 `projectId:workflowDecisionId`, `closures`는 `closureId`
기준으로 정렬하고 모든 identity를 unique하게 검증한다. clear된 값과 이전
configure decision은 active projection에서 빠지지만 store audit history에는
남는다.

## 4. 적용 시간과 closure

- grace period는 policy v0.1에서 정확히 `120000ms`다.
- workflow는 해당 `configuredAt`과 같거나 나중에 시작한 managed run에만
  적용한다. 과거 run에 소급하지 않는다.
- follow-through 평가는 managed run의 completion 뒤 2분이 지난 이후에만
  가능하다.
- `create_pull_request`는 연결된 현재 GitHub 대상이 issue일 때만,
  `request_review`는 사용자가 작성한 pull request일 때만 후보가 된다. review가
  요청된 다른 사용자의 PR이나 대상 종류·사용자 관계가 맞지 않으면 다른 작업으로
  추정하거나 자동 연결하지 않고 해당 follow-through를
  `INELIGIBLE_WORKFLOW_ACTION_TARGET_INCOMPATIBLE`로 제외한다.
- 후속 작업이 끝났거나 사용자가 하지 않기로 한 경우 각각 `completed` 또는
  `skipped`를 명시적으로 기록한다.
- 같은 `managedRunId + workflowDecisionId`는 한 번만 닫을 수 있다. 동일한
  retry는 기존 closure를 반환하고, outcome이나 binding/execution identity가
  달라진 retry는 거부한다.

## 5. API와 UI

`GET|POST /api/context/project-workflows`는 development localhost에서만
제공한다. GET은 safe-origin, POST는 exact same-origin과
`explicitUserConfirmation: true`를 요구하며 모든 응답은 `no-store`다. 서버
오류는 원문 없이 제한된 code/message로 반환한다.

Work Cockpit의 프로젝트 연결 설정 안에서 프로젝트별 select를 제공한다.
초기 표시는 `설정 안 함 (unknown)`이고 사용자가 별도 반영 버튼을 눌러야
변경된다. 설정 변경 뒤 Attention invalidation을 발생시켜 같은 로컬 화면이 새
revision을 다시 평가할 수 있게 한다.

## 6. 호환성과 제한

- 이 subsystem 자체는 Attention 후보, lane, ranking 또는 selection을 만들지
  않는다. active resolver는 versioned projection과 시간 helper를 입력으로
  사용해야 한다.
- managed run, binding, execution이 실제로 서로 연결됐는지는 authoritative
  managed/binding evidence를 가진 consumer가 확인해야 한다. workflow store는
  opaque ID를 새 관계 근거로 승격하지 않는다.
- 프로젝트가 나중에 archive된 경우 active resolver는 current context registry로
  applicability를 다시 검사해 follow-through 후보에서 제외해야 한다. 과거
  explicit decision은 자동 삭제하거나 암묵적으로 clear하지 않는다.
- mutation serialization은 현재 Node process 안에서만 보장한다. 여러 process가
  같은 local file을 쓰는 배포 전에는 별도 lock 또는 durable transactional store가
  필요하다.
- append-only 보존 상한은 decision 10,000개, closure 50,000개다. v0.1은 과거
  event를 자동 prune하지 않으며 상한 도달 전 versioned migration이 필요하다.
- production conversation과 implicit feedback을 이 저장소나 Golden Dataset으로
  자동 승격하지 않는다.
- managed failure 제안에서 세션을 여는 동작은 해결 또는 snooze 기록이 아니다.
  더 최신 managed run이나 직접 검증된 상태 변경이 생기기 전에는 같은 실패가
  다시 제안될 수 있다. 별도 snooze/acknowledgement 정책은 후속 단계 범위다.
