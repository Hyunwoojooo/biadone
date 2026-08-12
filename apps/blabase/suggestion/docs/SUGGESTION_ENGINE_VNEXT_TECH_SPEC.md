# Suggestion Engine vNext Technical Specification

| 항목 | 값 |
| --- | --- |
| Status | **Draft — planning only; AI proposal, not human approval** |
| Date | 2026-08-12 |
| Owner | User (product decision and release approver); Codex (AI implementation executor and record author) |
| Scope | Suggestion Engine vNext의 Attention, Continuation, Setup 및 Proposal Router 계약 |

> 이 문서는 구현 승인, 데이터셋 동결, 배포 승인 또는 릴리스 준비 완료를 의미하지 않는다. Section 8의 MVP 제품 정책은 2026-08-12에 사람이 승인했지만, 숫자형 품질 기준은 실제 human-reviewed frozen evaluation 결과로 다시 승인 또는 조정해야 한다.

## 1. 규범 문서 우선순위

충돌이 있을 때 다음 순서로 해석한다.

1. `/Users/joo/BiaDone/apps/blabase/docs/ENGINE_DEVELOPMENT_RECORDS.md`
2. `CROSS_SOURCE_ATTENTION_DEFINITION.md`
3. 이 문서 `SUGGESTION_ENGINE_VNEXT_TECH_SPEC.md`
4. `SUGGESTION_ENGINE_VNEXT_IMPLEMENTATION_PLAN.md`

`RECENT_WORK_CONTINUATION_IMPLEMENTATION_PLAN.md`는 historical exact-push/exact-resumption proposal이다. 이 문서가 정의하는 vNext 범위에서는 해당 계획을 supersede하지만, 기록 보존을 위해 삭제하거나 변경하지 않는다. 기존 Active Attention의 사실 판정과 안전 규칙은 이 문서가 대체하지 않는다.

## 2. 최상위 invariant

> **Continuation은 제안 가능성을 넓힐 수 있지만, Attention의 사실 판정, 후보 집합, eligibility, ranking, result hash 또는 실행 권한을 넓히거나 변경해서는 안 된다.**

따라서 다음 조건을 항상 지킨다.

- Attention과 Continuation은 독립된 입력 계약, resolver, version, result hash를 갖는다.
- Continuation 데이터는 Attention candidate admission 또는 eligibility에 들어가지 않는다.
- Board composer는 이미 확정된 lane 결과를 배치할 뿐, lane 내부 판정을 재계산하지 않는다.
- Continuation의 점수는 Attention 후보와 비교하지 않는다.
- `Attention.no_action`은 "검증된 즉시 개입 없음"만 의미하며 "제안할 작업 없음"을 의미하지 않는다.
- Continuation이 활성화되더라도 기존 `/api/attention`의 의미와 Active Attention 결과는 바뀌지 않는다.

## 3. 문제 정의

### 3.1 Before

현재 시스템은 검증된 의무, 차단, 실패처럼 엄격한 Attention 후보를 찾도록 설계되었다. 그러나 UI는 사용자가 최근 작업을 이어갈 항목까지 추천받을 것으로 기대하게 만든다.

현재 동작의 결과는 다음과 같다.

- 최근 GitHub push 또는 Codex 세션이 있어도 Attention 조건을 만족하지 않으면 전체 추천 실패처럼 보인다.
- 부분 coverage나 매핑 부재가 source-local 최근 활동까지 숨긴다.
- push 자체만 알면서 미완료 여부나 중요도를 주장할 수 없기 때문에 resolver가 지나치게 보수적으로 보인다.
- 저장소, 로컬 workspace, Codex session이 하나의 사용자 작업 흐름으로 연결되지 않는다.

### 3.2 After

vNext는 세 가지 lane을 독립적으로 판단하고 Proposal Router가 하나의 보드로 합성한다.

- **Attention:** 지금 처리해야 하는 것으로 검증된 개입
- **Continuation:** 최근 증거를 바탕으로 자연스럽게 이어갈 수 있는 작업
- **Setup:** 더 정확한 제안이나 안전한 실행을 가능하게 하는 연결 또는 선택 작업

### 3.3 Job to be Done

> 검증된 개입이 필요하면 먼저 알려주고, 그렇지 않으면 최근 작업을 바탕으로 가장 이어가기 쉬운 항목을 근거와 함께 제안한다. 실제 실행은 사용자가 확인한 뒤에만 한다.

vNext가 최적화하는 것은 보편적인 "중요도"가 아니라 다음 두 항목이다.

- 놓치면 안 되는 검증된 개입의 누락 감소
- 최근 작업으로 돌아갈 때 발생하는 재진입 비용 감소

## 4. 범위

### 4.1 포함 범위

- Attention, Continuation, Setup lane의 명시적 의미 분리
- 최근 GitHub push 및 최근 Codex session 기반 Continuation 후보
- WorkContext와 source identity의 one-to-many 매핑
- 결정론적 Continuation 순위, 중복 제거, 다양성 제한
- source-local 후보와 exact-resumption 후보의 분리
- Proposal Router와 WorkSuggestionBoard 계약
- display 및 link-only action에서 시작하는 점진적 실행 capability
- shadow evaluation, 회귀 데이터셋, 버전 및 provenance 계약
- 웹 UI와 향후 macOS launcher가 공유할 projection

### 4.2 비목표

- GitHub push만으로 미완료, 긴급, 중요 상태를 추론하는 것
- LLM을 이용한 비결정적 ranking
- 사용자의 확인 없는 WorkContext 영구 매핑
- MVP에서 prompt draft 자동 입력, 자동 전송, command, retry, push, merge, issue/PR 변경
- post-MVP reviewable prompt draft auto-fill을 자동 전송 또는 실행과 같은 권한으로 취급하는 것
- 외부 source mutation
- MVP에서 commit subject, commit body, diff 또는 변경 파일 내용 수집
- 기존 Active Attention 의미, 결과, hash 또는 API 계약 변경
- production click 또는 implicit behavior를 human-approved Gold로 승격

## 5. 상위 아키텍처

```text
GitHub / Codex / Local Git / Explicit User Mapping
                       │
                       ▼
             Versioned Observations
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
 Strict Attention   Continuation      Setup
 verified action    recent context    value-unlocking action
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                Proposal Router
                       ▼
       WorkSuggestionBoard: primary 1 + alternatives ≤ 2
```

Attention resolver는 기존 경로를 유지한다. Continuation resolver와 Setup derivation은 별도 모듈로 추가한다. Proposal Router는 lane별 결정이 끝난 후에만 실행된다.

## 6. 핵심 도메인 모델

### 6.1 WorkContext

Repository는 Project와 동일하지 않다. `WorkContext`는 사용자가 인식하는 하나의 작업 흐름이며 여러 source identity를 가질 수 있다.

```ts
type WorkContextV1 = {
  schemaVersion: "work-context-v1";
  workContextId: string;               // opaque, stable within installation
  localAlias: string;                  // user-controlled default label
  links: ContextLinkV1[];
  preference: {
    pinned: boolean;
    snoozedUntil: string | null;
    hidden: boolean;
  };
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
```

`localAlias`가 기본 표시 이름이다. repository 이름은 sensitive metadata로 취급하며 사용자가 노출을 허용하거나 source-local 화면에서 필요한 경우에만 제한적으로 표시한다.

### 6.2 ContextLink

```ts
type ContextLinkV1 = {
  schemaVersion: "context-link-v1";
  contextLinkId: string;
  workContextId: string;
  source: "github" | "codex" | "local_git";
  sourceIdentityRef: string;            // opaque reference, not raw URL/path
  linkMethod: "user_confirmed" | "exact_remote_proposed";
  status: "proposed" | "confirmed" | "conflict" | "deleted";
  proposedAt: string | null;
  confirmedAt: string | null;
  deletedAt: string | null;
};
```

Exact git remote 일치는 `exact_remote_proposed` 링크를 만들 수 있지만 자동으로 `confirmed`가 되지 않는다. 영구 매핑에는 명시적 사용자 확인이 필요하다.

### 6.3 Observation

Observation은 source가 직접 제공한 사실이다. 해석된 중요도나 미완료 상태를 포함하지 않는다.

```ts
type ContinuationObservationV1 = {
  schemaVersion: "continuation-observation-v1";
  observationId: string;
  source: "github" | "codex" | "local_git";
  sourceIdentityRef: string;
  workContextId: string | null;
  kind: "github_push" | "codex_session_activity" | "local_git_state";
  observedAt: string;
  snapshotCapturedAt: string;
  snapshotFreshnessVersion: string;
  activityWindowVersion: "activity-window-v1";
  evidenceRefs: string[];
  sourceCoverage: "complete" | "partial" | "unknown";
  terminalState: "active" | "terminal" | "unknown";
  conflictCodes: string[];
  metadata: Record<string, string | number | boolean | null>;
};
```

### 6.4 Candidate

```ts
type ContinuationCandidateV1 = {
  schemaVersion: "continuation-candidate-v1";
  candidateId: string;
  candidateKind:
    | "recent_github_push"
    | "recent_codex_session"
    | "local_worktree"
    | "linked_workstream"
    | "workspace_mapping";
  workContextId: string | null;
  sourceObservationIds: string[];
  displayLabel: string;
  observedAt: string;
  expiresAt: string;
  evidenceBand: "exact" | "corroborated" | "single_source" | "setup";
  capability:
    | "display"
    | "open_source"
    | "open_setup_surface"
    | "map_or_select"
    | "resume_exact_session";
  availability: "ready" | "setup_required";
  continuityScore: number;
  scoreBreakdown: {
    recency: number;
    exactCorroboration: number;
    resumability: number;
    localContinuity: number;
    explicitPreference: number;
  };
  reasonCodes: string[];
  caveatCodes: string[];
  action: ContinuationActionOfferV1 | null;
  candidateSha256: string;
};
```

### 6.5 Decision

```ts
type ContinuationDecisionV1 = {
  schemaVersion: "continuation-decision-v1";
  status:
    | "offers_available"
    | "setup_required"
    | "no_recent_context"
    | "insufficient_evidence";
  primary: ContinuationCandidateV1 | null;
  alternatives: ContinuationCandidateV1[]; // max 2
  coverageStatement: string;
  reasonCodes: string[];
  run: EngineRunMetadataV1;
  resultSha256: string;
};
```

### 6.6 WorkSuggestionBoard

```ts
type WorkSuggestionBoardV1 = {
  schemaVersion: "work-suggestion-board-v1";
  attention: ActiveAttentionResultV05;
  continuation: ContinuationDecisionV1;
  setup: SetupDecisionV1;
  prominentLane: "attention" | "continuation" | "setup" | "none";
  primary: BoardItemV1 | null;
  alternatives: BoardItemV1[];           // max 2
  executionPolicy: {
    automaticExecutionAllowed: false;
    explicitUserActionRequired: true;
    externalMutationAllowed: false;
  };
  run: BoardRunMetadataV1;
  resultSha256: string;
};
```

### 6.7 Run 및 evidence metadata

```ts
type EngineRunMetadataV1 = {
  runId: string;
  startedAt: string;
  completedAt: string;
  datasetVersion: string | null;
  datasetSha256: string | null;
  codeVersion: string;
  schemaVersion: string;
  ruleVersion: string;
  scoreVersion: string;
  identityPolicyVersion: string;
  freshnessPolicyVersion: string;
  actionPolicyVersion: string;
  configSha256: string;
  inputSha256: string;
  errors: EngineErrorV1[];
  latencyMs: number;
  tokenUsage: null;                      // deterministic v1 does not call a model
};

type EvidenceMetadataV1 = {
  evidenceRef: string;
  source: "github" | "codex" | "local_git";
  observedAt: string;
  snapshotCapturedAt: string;
  verificationStatus: "verified" | "partial" | "unverified" | "conflict";
  confidenceBand: "exact" | "corroborated" | "single_source" | "setup";
  conflictCodes: string[];
  errorCodes: string[];
};
```

모든 ID는 API와 UI에 raw native identifier를 노출하지 않는 opaque identifier여야 한다. Hash는 canonicalized, versioned input으로 계산하며 비밀값, raw path, raw URL, session content를 포함하지 않는다.

## 7. Lane 의미와 Router 규칙

### 7.1 Attention

- 검증된 의무, 실패, 차단 또는 사용자 개입이 필요한 항목만 포함한다.
- 기존 candidate admission, eligibility, ranking, result resolution을 그대로 사용한다.
- 기존 Attention이 `suggested` 또는 clarification을 요구하면 prominent lane이 된다.

### 7.2 Continuation

- 최근 활동을 기반으로 사용자가 다시 들어가기 쉬운 작업을 제안한다.
- 최근 활동은 중요도, 미완료, 긴급성 또는 의무의 증거가 아니다.
- 신선한 단일 source 직접 증거만으로 후보가 될 수 있다.
- 매핑 부재는 후보 제외가 아니라 `setup_required`와 bounded action의 원인이다.

### 7.3 Setup

- source 연결, workspace 매핑, session 선택, 새로고침처럼 추가 가치를 열어주는 작업이다.
- 최근 증거는 있지만 안전한 동작에 필요한 identity가 부족할 때 생성한다.
- 외부 mutation이나 자동 설정 변경을 포함하지 않는다.

### 7.4 Proposal Router precedence

```text
1. valid Active Attention 존재 → Attention prominent
2. 그렇지 않고 Continuation primary 존재 → Continuation prominent
3. 그렇지 않고 안전한 Setup action 존재 → Setup prominent
4. 모두 없음 → none
```

Router는 다음 규칙을 지킨다.

- 동일한 exact workstream이 Attention과 Continuation에 모두 있으면 Attention만 board item으로 유지하고 Continuation 근거를 보조 context로 연결한다.
- Attention과 Continuation의 numeric score를 비교하지 않는다.
- board에는 primary 1개와 alternative 최대 2개만 둔다.
- source identity 또는 WorkContext conflict가 있으면 자동 dedupe하지 않고 conflict candidate를 제외한다.
- setup-only item은 검증된 Attention보다 앞설 수 없다.

## 8. v0.1 승인 정책

다음 MVP 제품 정책은 2026-08-12에 Human product owner가 대화에서 승인했다. 이 승인은 정책 방향에만 적용되며 구현, ECR 완료, dataset freeze, presentation, action 또는 release 승인을 의미하지 않는다.

| 항목 | v0.1 기본값 |
| --- | --- |
| Router precedence | 모든 valid Active Attention이 primary 우선; Attention이 없을 때 Continuation primary. Continuation은 별도 lane에 계속 표시 가능 |
| Activity window | 최근 7일 |
| Snapshot freshness | activity window와 분리하고 source별 versioned policy 사용 |
| Exact remote mapping | 자동 확정 금지, proposal 생성 후 사용자 확인 |
| Single-source primary | Attention이 없을 때 허용, bounded copy/action 적용 |
| Repository/project label | verified 이름은 local web/macOS에 표시; external telemetry, monitor, replay, evaluation artifact에는 raw 이름 제외; alias/hide 지원 |
| Ranking learning | explicit feedback만 허용 |
| Implicit click | analytics만 허용, Gold 또는 rank 학습에 사용하지 않음 |
| External mutation | 금지 |
| Ranking method | deterministic rules only |
| Commit subject/diff | MVP에서 수집하지 않음 |
| MVP action | `display | open_source | open_setup_surface`; navigation만 허용하고 mapping 저장, confirmed selection, resume, prompt 입력 및 mutation은 금지 |
| Provisional release gate | human-reviewed frozen input에서 critical error 0, Acceptable@1 >= 75%, Acceptable@3 >= 90%; 각 rollout 단계는 별도 승인 필요 |

## 9. Evidence band와 capability ladder

### 9.1 Evidence band

숫자 확률을 표시하거나 저장하지 않는다. v0.1은 다음 명목형 band만 사용한다.

| Band | 의미 |
| --- | --- |
| `exact` | 확인된 WorkContext에서 exact cross-source identity와 exact action target이 있음 |
| `corroborated` | 두 개 이상 source가 같은 작업 흐름을 독립적으로 지지하지만 exact resume target은 없을 수 있음 |
| `single_source` | 신선한 source-native 직접 증거 하나가 있음 |
| `setup` | 최근 증거는 있으나 연결 또는 선택이 필요함 |

Band는 중요도 또는 완료 가능성의 확률이 아니다.

### 9.2 Capability ladder

```text
display
  < open_source
  < open_setup_surface
  < map_or_select
  < resume_exact_session
  < external_mutation
```

- `display`: 신선한 직접 증거와 안전한 copy가 필요하다.
- `open_source`: allowlisted native destination과 action-time validation이 필요하다.
- `open_setup_surface`: 설정 또는 선택 화면을 열기만 하며 registry 저장, mapping confirmation, confirmed session selection 또는 resume을 수행하지 않는다.
- `map_or_select`: 사용자의 명시적 확인이 필요하다.
- `resume_exact_session`: exact session identity, fresh heartbeat, 짧은 TTL, 클릭 시점 재검증이 필요하다.
- `external_mutation`: v1에서 항상 금지한다.

MVP가 지원하는 capability는 `display | open_source | open_setup_surface`뿐이다. `map_or_select` completion, persistent mapping, correction/removal, confirmed session selection은 post-MVP Phase 7의 별도 human gate 이후에만 활성화할 수 있다.

## 10. 결정론적 Continuity score

Continuity score는 Continuation lane 안에서만 순서를 정하며 중요도를 나타내지 않는다.

| 구성 요소 | 최대 점수 |
| --- | ---: |
| Recency | 35 |
| Exact corroboration | 25 |
| Resumability | 20 |
| Local continuity | 10 |
| Explicit preference | 10 |
| 합계 | 100 |

세부 규칙은 versioned score policy에 기록한다.

- Recency는 2시간, 8시간, 24시간, 3일, 7일 bucket으로 계산하는 것을 초기안으로 한다.
- 하나의 WorkContext에서는 최신 meaningful signal 하나만 recency 기여로 사용한다.
- 이벤트 수가 많다는 이유로 점수가 중복 가산되지 않는다.
- 결과 상위 3개에 동일 WorkContext가 두 번 이상 들어가지 않는 diversity cap을 기본으로 한다.
- identity conflict는 candidate exclusion 사유다.
- mapping absence는 exclusion이 아니라 Setup 상태와 capability 제한 사유다.
- score가 같고 의미 있는 차이가 없으면 사용자가 선택하도록 alternative로 노출한다.
- 그래도 순서가 필요하면 stable `candidateId` lexical order를 최종 deterministic tiebreak로 사용한다.

## 11. Source 계약

### 11.1 GitHub push

MVP는 현재 GitHub v6 snapshot에 이미 존재하는 source-native metadata를 재사용한다.

- repository identity reference
- push 또는 ref activity kind
- observed time
- snapshot captured time
- 기존 evidence reference

GitHub push는 `recent_github_push` 후보를 만들 수 있지만 다음 상태를 증명하지 않는다.

- 작업이 미완료임
- 사용자가 지금 처리해야 함
- 가장 중요한 작업임
- 로컬 workspace 또는 Codex session과 동일함

### 11.2 Codex session

MVP는 현재 Codex v3 metadata를 재사용한다.

- opaque session identity
- project label 또는 local alias candidate
- updated time
- bounded activity counters
- 이미 허용된 bounded summary metadata

일반 Codex session은 Continuation 후보가 될 수 있지만, exact heartbeat와 scope가 없으면 `resume_exact_session` capability를 받을 수 없다. session activity만으로 미완료를 주장하지 않는다.

### 11.3 Local Git

Local Git v2는 MVP 이후 단계다. 수집할 수 있는 범위는 다음처럼 제한한다.

- dirty, staged, unstaged, untracked count
- ahead, behind, diverged 상태
- last commit time
- sanitized branch category

Local Git은 raw file content, diff, command output 또는 전체 path를 public projection에 포함하지 않는다.

### 11.4 MVP 제외 metadata

다음 항목은 별도 privacy 및 product 승인이 있을 때까지 수집하지 않는다.

- commit subject와 commit body
- changed file names와 full path
- patch 또는 diff
- raw Codex prompt, answer, reasoning
- terminal command 또는 output

## 12. Freshness, partial, conflict, terminal

### 12.1 Freshness

- Activity window는 기본 7일이며 `activity-window-v1`로 version한다.
- Snapshot freshness는 source별 SLA와 connector 특성을 반영한 별도 versioned policy다.
- 활동 시각이 최근이어도 snapshot이 stale이면 current-state copy를 제한한다.
- future timestamp, clock skew 또는 parse error는 명시적 error code로 기록하고 점수에서 제외한다.

### 12.2 Partial coverage

- Continuation은 전역 complete coverage를 요구하지 않는다.
- 신선한 positive source-local evidence가 있으면 후보를 만들 수 있다.
- 다른 source의 partial 또는 missing 상태는 caveat와 evidence band에 반영한다.
- source-local 사실을 다른 source의 사실로 확장하지 않는다.

### 12.3 Conflict

- 서로 다른 native identity가 같은 WorkContext라고 추론되면 자동 병합하지 않는다.
- confirmed link 간 충돌은 candidate를 제외하고 Setup clarification을 만든다.
- 이름 문자열 유사성만으로 exact identity를 결정하지 않는다.

### 12.4 Terminal evidence

- 명시적 terminal evidence가 있으면 해당 observation을 Continuation 후보로 사용하지 않는다.
- terminal 상태가 unknown이면 "미완료" copy를 사용하지 않는다.
- source가 terminal state를 제공하지 않는다는 이유만으로 active 상태를 추론하지 않는다.

## 13. Privacy, retention, deletion, correction

### 13.1 Privacy 원칙

- data minimization을 적용한다.
- public API projection에는 사용자 행동에 필요한 최소 정보만 넣는다.
- action destination은 private action store에서 `offerId`로 조회한다.
- raw native identifiers를 client-visible candidate ID로 사용하지 않는다.
- repository 이름은 sensitive metadata이며 local alias를 기본으로 한다.

### 13.2 Public projection 금지 필드

- raw SHA 또는 full git ref
- full repository clone URL
- local absolute path
- native session ID
- raw issue, PR, commit 또는 workspace URL
- commit body, diff, file content
- raw Codex prompt, answer, reasoning, command 또는 output
- token, credential, secret 또는 environment value

### 13.3 Retention 및 deletion

- Observation retention은 source connector 정책과 별도 versioned retention policy에 따른다.
- 사용자가 WorkContext를 삭제하면 context link, preference 및 action target reference를 함께 tombstone 처리한다.
- expired action offer는 즉시 실행 불가 상태가 되어야 하며 bounded 기간 후 삭제한다.
- evaluation artifact는 production raw data와 분리하고 `.local/` 또는 승인된 private store에 둔다.

### 13.4 Correction

- 잘못된 매핑 correction은 원래 값을 덮어쓰지 않고 reviewed change로 기록한다.
- 새 confirmed link를 만들기 전 이전 link는 tombstone 또는 conflict 상태로 남긴다.
- correction history를 frozen dataset에 조용히 반영하지 않는다. 수정은 새 dataset version으로만 반영한다.

## 14. Action 계약

```ts
type ContinuationActionOfferV1 = {
  schemaVersion: "continuation-action-offer-v1";
  offerId: string;
  kind:
    | "open_source"
    | "open_setup_surface"
    | "map_workspace"
    | "select_session"
    | "resume_exact_session";
  capability:
    | "open_source"
    | "open_setup_surface"
    | "map_or_select"
    | "resume_exact_session";
  issuedAt: string;
  expiresAt: string;
  explicitUserActionRequired: true;
  automaticExecutionAllowed: false;
  externalMutationAllowed: false;
  revalidationPolicyVersion: string;
};
```

Action 규칙은 다음과 같다.

- 모든 action은 explicit user gesture 이후에만 실행한다.
- action 시점에 offer TTL, source binding, WorkContext link, session heartbeat를 재검증한다.
- exact resume offer의 권장 TTL은 30초이며 사람 승인 후 확정한다.
- 검증 실패, scope 변경, session 삭제 또는 heartbeat 만료 시 `409 Conflict`로 중단한다.
- action failure를 자동 retry하지 않는다.
- MVP action 과정에서는 prompt를 생성하거나 입력하지 않는다.
- command 실행 또는 source mutation을 수행하지 않는다.
- MVP action은 `open_source`와 `open_setup_surface`의 display/link-only 범위로 제한한다.
- MVP의 mapping/session CTA는 설정 또는 선택 화면으로 navigation만 수행한다. registry 저장, mapping confirmation, session selection persist 또는 resume 실행을 하지 않는다.
- Persistent mapping, correction/removal 및 confirmed session selection은 post-MVP Phase 7 human gate 이후에만 허용한다.

Post-MVP 목표에는 exact target을 대상으로 bounded template prompt 초안을 reviewable composer에 자동 입력하는 기능이 포함된다. 이 capability는 visible preview, explicit user confirmation, action-time target revalidation, 별도 schema/version/ECR/security review를 요구한다. 자동 전송, 자동 승인, command 실행 또는 외부 mutation은 이번 human approval에 포함되지 않으며 별도 human gate 없이는 구현하거나 활성화할 수 없다.

## 15. API 계약

### 15.1 유지 API

- `GET /api/attention`
- 기존 response schema, 의미, ordering, hash를 변경하지 않는다.

### 15.2 신규 API

| Method | Path | 역할 |
| --- | --- | --- |
| `GET` | `/api/continuation` | `ContinuationDecisionV1` 조회 |
| `GET` | `/api/work-board` | `WorkSuggestionBoardV1` 조회 |
| `POST` | `/api/continuation/open` | 명시적 offer action 요청 및 재검증 |

`/api/work-board`는 동일한 versioned evidence envelope에서 이미 계산된 lane 결과를 합성해야 한다. Attention을 다시 해석하거나 Continuation 데이터를 Attention에 주입하지 않는다.

`POST /api/continuation/open`은 client가 native path, URL 또는 session ID를 전달하지 않도록 `offerId`만 받는 구조를 기본으로 한다. same-origin 및 local-only 정책을 적용하고 실패 시 명시적 error code를 반환한다.

## 16. Feedback와 Gold 승격

### 16.1 Explicit feedback taxonomy

- `helpful_resumed`
- `already_done`
- `not_mine`
- `wrong_link`
- `not_now`
- `snooze`
- `insufficient_context`
- `alternative_selected`

명시적 feedback만 bounded preference 또는 rank weight 조정에 사용할 수 있다. 조정 폭은 기본 가중치의 최대 5~10% 범위를 제안하며 사람 검토 전 확정하지 않는다.

다음 항목은 feedback으로 변경할 수 없다.

- safety gate
- identity verification
- Attention eligibility
- deadline 또는 obligation 사실
- action capability
- external mutation policy

### 16.2 Gold promotion

- production click, dwell time, no-click, dismissal은 analytics이며 Gold가 아니다.
- LLM judge score는 human-approved Gold가 아니다.
- production conversation을 dataset으로 승격하려면 lawful basis, 최소화, anonymization, review decision이 필요하다.
- correction은 원본과 분리된 reviewed change로 보존한 뒤 새 dataset version을 freeze한다.

## 17. 평가 데이터셋과 품질 gate

### 17.1 Dataset 계층

| Dataset | 상태 | 목적 |
| --- | --- | --- |
| `suggestion-continuation-dev-v0.1` | Mutable | 계약과 resolver 개발, freeze 금지 |
| `suggestion-continuation-regression-v1.0` | Human-reviewed frozen 이후 사용 | Continuation 회귀 |
| `suggestion-board-regression-v1.0` | Human-reviewed frozen 이후 사용 | lane precedence, dedupe, board projection 회귀 |
| Dogfood set | Private, mutable | 실제 사용성 탐색, Gold 아님 |
| Locked holdout | Private, 접근 제한 | 최종 승인 평가, tuning 금지 |

현재 이 문서는 어떤 dataset도 frozen이라고 주장하지 않는다. dataset version과 hash는 사람이 검토하고 freeze한 뒤에만 기록한다.

### 17.2 비교 원칙

- engine version 비교는 동일한 frozen input을 사용한다.
- 서로 다른 dataset에서 나온 metrics를 직접 비교하지 않는다.
- dataset, code, schema, rule, score, identity, freshness, action policy, config version을 run과 함께 기록한다.
- 비교 run ID와 hash는 실제 run 이후에만 기록한다.

### 17.3 필수 평가 사례

#### 17.3.1 MVP-required

- metadata-only Codex session
- opt-in bounded task summary가 있는 Codex session
- 완료된 historical session을 미완료로 표시하지 않는 사례
- GitHub push가 있고 mapping이 없는 사례
- 같은 이름이지만 identity가 다른 사례
- mapping/session CTA가 setup surface만 열고 상태를 저장하지 않는 사례
- stale, partial, future timestamp
- 중복 observation과 input permutation
- Attention과 Continuation 동시 존재
- Attention이 없고 recent activity가 있는 사례
- cross-lane dedupe
- offer expiry, rebind, session deletion, heartbeat race
- privacy sentinel
- flag-off byte equivalence와 older decoder compatibility
- 변경이 기존 Local Git v1 경로에 닿는 경우 Local Git v1 compatibility 및 privacy regression

#### 17.3.2 Post-MVP 또는 contract fixture-only

- GitHub, Codex, Local Git exact three-source join
- ambiguous mapping의 select, remember, remove
- Local Git v2 dirty, ahead, behind, diverged
- confirmed session selection과 persistent mapping correction/removal

이 사례들은 future contract를 검증하는 합성 fixture로 미리 둘 수 있지만 Local Git v2 또는 persistent mapping이 구현되기 전에는 MVP release blocker가 아니다. 단, 구현 변경이 기존 Local Git v1에 영향을 주면 해당 v1 compatibility 및 privacy regression은 MVP에서도 필수다.

### 17.4 Metrics

- Attention safety regression count
- Continuation Acceptable@1
- Continuation Acceptable@3 또는 Coverage@3
- setup route accuracy
- wrong identity count
- stale-current-claim count
- unsafe target count
- automatic execution 또는 mutation count
- privacy leak count
- deterministic replay mismatch count
- time-to-open 또는 time-to-resume

### 17.5 제안 품질 gate

다음 숫자는 **provisional hypothesis**이며 human approval 전에는 release gate가 아니다.

- Human-reviewed Acceptable@1: 75% 이상
- Human-reviewed Acceptable@3: 90% 이상
- Setup route accuracy: 100%
- Attention safety error: 0
- Wrong identity: 0
- Stale 또는 expired current claim: 0
- Unsafe action target: 0
- MVP prompt draft 입력, automatic prompt send, execution, retry 또는 external mutation: 0
- Privacy leak: 0
- Deterministic replay mismatch: 0

Dataset 크기, annotator 수, disagreement 처리, confidence interval 및 실제 release threshold는 별도 사람 결정이 필요하다.

## 18. Version ledger와 bump 규칙

### 18.1 제안 ledger

| 구성 요소 | 상태 또는 신규 버전 |
| --- | --- |
| Active Attention | 기존 버전 및 hash 유지 |
| Recent Work | v0.2 유지, 한 릴리스 동안 compatibility adapter 후보 |
| GitHub snapshot | 기존 v6 metadata 재사용 |
| Codex snapshot | 기존 v3 metadata 재사용 |
| Local Git | MVP 이후 v2 제안 |
| Continuation observation | v1 신규 |
| Continuation candidate | v1 신규 |
| Continuation rule | v1 신규 |
| Continuation score | v1 신규 |
| Continuation identity policy | v1 신규 |
| Continuation action policy | v1 신규 |
| Work Suggestion Board | v1 신규 |
| Work resumption protocol | exact resume 단계에서 v2 제안, v1 reader compatibility 유지 |
| Monitor | two-lane 지원 버전 신규 |
| Replay | two-lane provenance 지원 버전 신규 |
| Launcher projection | v3 제안, older decoder compatibility 유지 |

### 18.2 Bump 규칙

- Field를 추가하되 old reader가 무시할 수 있으면 additive minor-compatible change로 기록한다.
- Field 의미, admission, ranking, evidence band, freshness, action capability가 바뀌면 해당 rule/schema/policy version을 bump한다.
- Candidate identity 또는 canonical hash input이 바뀌면 ID policy와 schema version을 함께 검토한다.
- Dataset item이나 label correction은 새 dataset version과 hash를 만든다.
- Unknown version 또는 이해할 수 없는 mixed version은 fail closed한다.
- Board composer는 서로 호환되는 명시적 lane version 조합만 허용한다.

## 19. Feature flags와 rollback

```text
continuationResolution: off -> shadow -> active
continuationPresentation: off -> attention_lab -> web -> launcher
continuationAction: disabled -> link_only -> explicit_resume
boardComposer: legacy -> dual_lane
```

Rollout은 resolver shadow, presentation, link-only action, exact resume 순서로 진행한다. Rollback은 역순으로 수행한다.

1. `continuationAction`을 `disabled`로 전환한다.
2. `continuationPresentation`을 이전 단계 또는 `off`로 전환한다.
3. `boardComposer`를 `legacy`로 전환한다.
4. `continuationResolution`을 `shadow` 또는 `off`로 전환한다.

Rollback 중에도 `/api/attention`과 Active Attention 경로는 변경하지 않는다. Unknown mixed version이 관찰되면 Continuation/Board만 fail closed하고 Attention은 기존 독립 경로를 유지한다.

## 20. Acceptance criteria

구현 완료 판단에는 최소 다음 조건이 필요하다.

- 기존 Active Attention candidate, eligibility, ranking, result hash가 변경되지 않는다.
- `Attention.no_action`과 Continuation offer가 한 board에 모순 없이 함께 표시된다.
- 최근 GitHub push 또는 Codex session의 single-source 후보가 bounded copy로 표시된다.
- 매핑 부재는 Setup CTA가 되며 exact resume으로 승격되지 않는다.
- primary는 1개, alternatives는 최대 2개다.
- 동일 WorkContext의 과다 노출이 diversity cap으로 방지된다.
- conflict, stale, terminal, future timestamp가 명시적 reason/error code로 처리된다.
- 모든 ranking과 tiebreak가 동일 input에서 결정론적이다.
- action은 명시적 사용자 입력, TTL 및 action-time revalidation을 요구한다.
- MVP에는 prompt draft 입력, 자동 전송, retry, command 또는 external mutation이 없다.
- raw sensitive fields가 public projection에 나타나지 않는다.
- versioned run/evidence metadata와 reproducible provenance가 기록된다.
- 관련 unit, integration, regression, typecheck, lint가 승인된 구현 단계에서 통과한다.
- behavior-changing implementation 전에 Engine Change Record가 작성되고 사람 검토를 받는다.

## 21. Human decision record

### 21.1 Resolved for MVP on 2026-08-12

| 결정 | 승인 내용 |
| --- | --- |
| Product policy owner | Human product owner, conversation approval |
| Router precedence | 모든 valid Attention 우선; 없을 때 Continuation primary |
| Single-source primary | bounded non-urgent copy/action 조건으로 허용 |
| Activity window | 최근 7일과 versioned decay; snapshot freshness는 별도 |
| Exact remote mapping | proposal/prefill만 자동; persistent mapping은 explicit confirmation 필요 |
| Repository/project 이름 | verified 이름을 local web/macOS에 표시; raw 이름은 external telemetry/monitor/replay/evaluation에서 제외; alias/hide 지원 |
| MVP action | source/setup/session-selection surface navigation만 허용 |
| Feedback | explicit feedback만 bounded Continuation ranking에 사용; click/no-response는 analytics-only |
| Provisional rollout gate | critical error 0, Acceptable@1 >= 75%, Acceptable@3 >= 90%, human-reviewed frozen input, staged rollout |
| Future prompt direction | reviewable composer의 prompt draft auto-fill은 post-MVP 목표; 자동 전송/실행은 승인되지 않음 |

### 21.2 Responsibility assignment

| 역할 | 담당 | 권한과 제한 |
| --- | --- | --- |
| Product decision owner | User | 제품 의미, 범위, precedence와 human gate를 결정한다. |
| Implementation executor and record author | Codex (AI) | 승인된 범위의 구현, 테스트, 평가 및 기록 초안을 수행한다. 자신의 결과를 제품 승인, 위험 수용 또는 release 승인할 수 없다. |
| Technical QA reviewer | `qa_reviewer` agent (AI, advisory) | 정확성, 안전, privacy, 회귀와 유지보수성을 검토한다. 인간 독립 검토, Gold adjudication 또는 release 승인을 대신하지 않는다. |
| Human dataset reviewers/adjudicator | Pending | Regression freeze 전에 별도 지정한다. |
| Release approver | User | 실제 구현·검증·평가 증거를 검토한 뒤 대상 version, scope, mode를 별도로 승인한다. 현재 release decision은 pending이다. |

`D-001`은 MVP product policy, responsibility assignment와 Draft ECR 문서화 기준으로 완료됐다. 이는 `C-001` 계약 작업 시작을 허용하지만 구현 결과, evaluation run, dataset freeze, rollout 또는 release가 승인됐다는 의미는 아니다.

### 21.3 Open post-MVP or release gates

| 결정 | 남은 human gate |
| --- | --- |
| Strict `focus`/`close_loop` future precedence | MVP의 모든 valid Attention 우선 정책을 변경할지 별도 승인 |
| Source snapshot freshness | GitHub, Codex, Local Git의 정확한 TTL과 failure policy |
| Retention | observation, alias, feedback, action offer의 정확한 보존 기간 |
| Exact resume binding | same-session resume에 요구할 binding, heartbeat 및 TTL 정책 |
| Prompt automation | draft template/source/privacy 규칙과 자동 전송·실행 허용 여부를 각각 별도 승인 |
| Dataset governance | reviewer 수, disagreement 처리, holdout 규모 및 lawful basis |
| Release governance | privacy/security 검토 범위와 human dataset reviewers/adjudicator 지정 |
| Threshold promotion | 실제 frozen evaluation 결과로 75/90 가설을 유지·조정할지 결정 |
| Commit subject 수집 | MVP 이후 별도 privacy 및 retention 검토 |

## 22. Planning-only 확인

이 문서는 canonical proposal 초안이다. 아직 다음 상태를 주장하지 않는다.

- 구현, dataset freeze, rollout 또는 release 승인
- Engine Change Record 승인
- dataset freeze 또는 hash 확정
- evaluator 실행 또는 baseline 결과
- run ID 생성
- 구현 완료
- 테스트 통과
- rollout 또는 release readiness
