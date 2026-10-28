# Suggestion Engine vNext Technical Specification

| 항목 | 값 |
| --- | --- |
| Status | **Implemented local checkpoint — Q-001 `automated_checkpoint_passed`; release `blocked_pending_human_review`** |
| Date | 2026-08-14 |
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
type WorkSuggestionBoardInputV03 = {
  contract: "work-suggestion-board-input-v0.3";
  schemaVersion: "work-suggestion-board-schema-v0.3";
  asOf: string;
  composerVersion: "work-suggestion-board-composer-v0.1";
  precedencePolicyVersion: "attention-continuation-setup-precedence-v0.1";
  idPolicyVersion: "work-suggestion-board-id-policy-v0.1";
  active: ActiveAttentionResultV05;                 // exact sealed artifact
  continuation: ContinuationResolvedDecisionV01;   // exact outer R-003 artifact
  inputSha256: string;
};

type WorkSuggestionBoardResultV03 = {
  contract: "work-suggestion-board-result-v0.3";
  schemaVersion: "work-suggestion-board-schema-v0.3";
  boardId: string;
  asOf: string;
  composerVersion: "work-suggestion-board-composer-v0.1";
  precedencePolicyVersion: "attention-continuation-setup-precedence-v0.1";
  idPolicyVersion: "work-suggestion-board-id-policy-v0.1";
  input: WorkSuggestionBoardInputV03;
  dependencies: {
    inputSha256: string;
    activeResultSha256: string;
    continuationResolvedResultSha256: string;
    continuationResultSha256: string;
    continuationSemanticResultSha256: string;
  };
  prominentLane: "attention" | "continuation" | "setup" | "none";
  primary: InternalBoardItemV01 | null;
  alternatives: InternalBoardItemV01[];   // exact expected sequence, max 2
  executionPolicy: {
    automaticExecutionAllowed: false;
    explicitUserActionRequired: true;
    externalMutationAllowed: false;
  };
  semanticResultSha256: string;
  resultSha256: string;
};

type WorkSuggestionBoardPublicV01 = {
  contract: "work-suggestion-board-public-v0.1";
  schemaVersion: "work-suggestion-board-schema-v0.1";
  generatedAt: string;
  prominentLane: "attention" | "continuation" | "setup" | "none";
  primary: PublicBoardItemV01 | null;
  alternatives: PublicBoardItemV01[];     // max 2
  continuationStatus: "available" | "empty" | "unavailable";
  executionPolicy: WorkSuggestionBoardResultV03["executionPolicy"];
};
```

Internal v0.3 composer boundary는 strict bundle object로 exact Active v0.5와 complete original R-001/R-002/R-003 inputs/artifacts를 받고 trusted resolver options를 별도로 받는다. `verifyContinuationDecisionAgainstInput`으로 outer `ContinuationResolvedDecision v0.1` 전체 chain을 인증하기 전에는 nested `.decision`을 읽지 않는다. Bare base Decision, legacy/mixed tuple, forged 또는 locally rehashed outer artifact, wrong secret/registry/code/dataset/asOf/version은 typed input rejection으로 fail closed하며 Board를 만들지 않는다. Local Board schema/hash success는 integrity만 증명하고 authenticity를 증명하지 않으므로 provenance-sensitive consumer는 full input-bound `verifyWorkSuggestionBoardResultAgainstInput` recomposition과 canonical exact comparison을 사용한다.

Composer는 Active object/reference, canonical bytes와 `resultSha256`, outer R-003 artifact를 재실행·재구축·mutation 없이 exact 보존하고 Board input hash로 그 exact artifacts를 묶는다. Active `suggested` 또는 `needs_clarification` sequence가 먼저 오고 이후 Continuation/Setup order를 보존한다. Cross-lane numeric score는 비교하지 않는다. Exact non-null WorkContext만 dedupe하며 Active가 이기고, 동일 label/다른 WorkContext는 유지하며 null-WorkContext Setup은 자동 dedupe하지 않는다. Result는 이 exact sequence의 처음 3개와 정확히 일치해야 한다.

Internal Board는 established source capability와 exact private action target을 그대로 보존할 수 있지만 권한을 올리거나 실행하지 않는다. Public v0.1 projection은 별도 계약이며 public Attention item은 항상 `capability=display`, `action=null`이다. 어떤 Board path도 automatic execution, persistence 또는 external mutation을 허용하지 않는다.

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

현재 R-003 v0.1 score는 shadow/dev 검증을 위한 **provisional ordering hypothesis**다. Continuation lane 내부 순서에만 사용하며 중요도, 완료 가능성, 확률 또는 release threshold를 나타내지 않는다.

| 구성 요소 | 현재 점수 |
| --- | ---: |
| Recency | 35, 28, 21, 14 또는 7 |
| Exact corroboration | 조건 충족 시 25, 그 외 0 |
| Resumability | 0 |
| Local continuity | 0 |
| Explicit preference | 0 |
| 현재 최대 합계 | 60 |

R-003 v0.1의 epoch-millisecond half-open recency bucket은 정확히 다음과 같다.

- `[0, 2h) = 35`
- `[2h, 8h) = 28`
- `[8h, 24h) = 21`
- `[24h, 72h) = 14`
- `[72h, 168h) = 7`
- future activity와 age `>= 168h`는 scoring input으로 허용하지 않는다.

Exact corroboration 25점은 input-bound 검증된 `linked_workstream`, `evidenceBand=corroborated`, exact 두 source observation일 때만 부여한다. Setup candidate도 recency만 계산하지만 ready pool과 분리된다. Ready candidate가 하나라도 있으면 Setup은 선택 대상이 아니며, 그렇지 않을 때만 Setup pool을 사용한다. 각 pool은 score 내림차순, stable `candidateId` lexical 오름차순으로 정렬한다. Non-null WorkContext는 하나당 최대 한 후보만 선택하고 null-WorkContext Setup 후보는 자동 dedupe하지 않으며, 최종 선택은 primary 포함 최대 3개다.

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
- R-003의 decision coverage는 candidate evidence band와 분리해 authenticated GitHub/Codex batch source assessment에서 계산한다.
- 두 required source가 exact resolver `asOf`에서 모두 available, complete, fresh이고 quality exclusion이 없을 때만 offer가 `COMPLETE`다. 별도 invalid/future/conflict/error exclusion이 있으면 valid offer를 유지할 수 있지만 coverage는 `SOURCE_LOCAL_PARTIAL`로 낮춘다.
- 정상 empty/outside-window 결과는 동일한 complete/fresh 및 quality gate를 통과할 때만 `no_recent_context/COMPLETE`다. 빈 candidate 목록만으로 no-recent를 주장하지 않는다.
- `setup_required`는 source collection이 complete여도 identity/actionability가 미완성이므로 항상 `SOURCE_LOCAL_PARTIAL`이다.
- Candidate가 없고 safety/quality proof가 부족하면 `insufficient_evidence/INSUFFICIENT`, 두 required source가 unavailable이면 `unavailable/UNAVAILABLE`이다.

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
- X-001 Setup surface offer TTL은 30초로 확정한다. Exact resume TTL은 별도 사람 승인 전까지 미확정이다.
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
| `GET` | `/api/continuation` | 구현됨: strict display-only `continuation-read-api-v0.1` 조회 |
| `GET` | `/api/work-board` | 구현됨: local Work Suggestion Board/semantic presentation 조회 |
| `POST` | `/api/continuation/offers` | 구현됨(X-001 Setup-only): wire API v0.1, explicit Setup click의 current public itemRef로 30초 offer 발급 |
| `POST` | `/api/continuation/open` | 구현됨(X-001 Setup-only): internal authority/store v0.2 재검증, random offerId 선소비 후 fixed `/projects` 응답 |

`/api/work-board`는 동일한 versioned evidence envelope에서 이미 계산된 lane 결과를 합성해야 한다. Attention을 다시 해석하거나 Continuation 데이터를 Attention에 주입하지 않는다.

두 POST는 local-only → exact same-origin → exact default-off flag → configured Basic auth → valid auth → bounded JSON → strict schema 순서를 적용한다. Issue는 `{itemRef,explicitUserAction:true}`, open은 `{offerId,explicitUserAction:true}`만 받으며 native path, URL, session ID 또는 private target은 받지 않는다. Offer expiry는 `min(issuedAt+30초,candidate expiry)`다. 발급 당시의 scored candidate hash, legacy private target, generatedAt, R1/R2/R3/input/result hash, full registry SHA와 source batch/snapshot hash는 v0.2 issuance audit에 보존하지만 currentness equality에는 사용하지 않는다. Fresh capture마다 바뀌는 request asOf/run artifact가 정상 offer를 무효화하지 않도록, 별도 `continuation-setup-action-authority-v0.1`은 current secret의 action-specific HMAC namespace에서 fixed destination policy, itemRef, workspace-mapping candidate ID/kind/null-context, logical source-observation set와 observedAt/expiry, Setup reason, stable action target, source identity·R1 resolution·binding set, relevant mapping state, R1/R2 contract/policy tuple, typed clean/declared code provenance만 canonical하게 묶는다. Raw scope/work-context/project/decision ID는 persisted projection에 저장하지 않고 digest input으로만 사용하며, unrelated registry edit는 relevant mapping digest를 바꾸지 않는다.

Issue와 Open은 `.local/continuation-actions`의 같은 cross-process root lock 안에서 각각 정확히 한 번 fresh preserve capture를 수행한다. Store는 current installation secret에서 파생한 `authKeyId` namespace만 직접 열며 다른 namespace를 enumerate, migrate 또는 reuse하지 않는다. Secret rotation은 새 empty namespace에서 새 offer를 허용하고 old offer는 409로 fail closed한다. Open은 fresh authority equality와 live candidate를 확인한 뒤 durable consume하고 exact `{destination:"project_mappings",navigateTo:"/projects"}`만 반환한다. Replay/expired/superseded/rebound/corrupt/wrong-secret/missing은 sanitized 409이며 자동 retry하지 않는다. Expired offer의 retention deadline은 offer expiry+24시간이고, consumed/superseded/revalidation-failed는 terminal time+24시간이다. Background cleanup은 없으며 다음 authorized current-namespace operation에서 deadline이 지난 closed prefix를 제거한다. Event cap은 active offer마다 terminal slot을 예약해 이미 발급된 offer의 consume/terminalization을 막지 않는다.

### 15.1 A-001 action-disabled local shadow monitoring slice (implemented 2026-08-13)

- 첫 A-001 slice는 full Continuation/action API가 아니라 action-disabled local Work Board shadow monitoring boundary다. 한 request의 단일 bounded live capture를 실제 `S1 → R1 → R2 → R3 → B1` chain에 전달하고, authenticated result의 public Work Suggestion Board v0.1 display-only projection만 additive wrapper contract로 반환한다.
- `GET /api/work-board`는 exact `BLABASE_WORK_BOARD_SHADOW_READ_ENABLED` flag 뒤에 있고 default-off다. Local-only 및 safe-origin 경계를 적용하며 response는 `Cache-Control: no-store`다.
- Attention Lab panel은 이 public projection만 표시한다. Shadow Board를 안전하게 만들 수 없으면 bounded Active-only fallback을 유지하고 Continuation의 현재성, 긴급성 또는 action authority를 추론하지 않는다.
- 이 historical Work Board slice 자체는 action/offer 실행, source refresh, Board/result persistence, external mutation, telemetry, WorkCockpit integration 또는 Continuation endpoint를 포함하지 않았다. 이후 PR-002에서 coherent preserve capture를 연결했고, 15.1.5에서 같은 capture/R3 결과를 재사용하는 별도 display-only `GET /api/continuation`을 추가했다. X-001은 그 GET/public projection을 바꾸지 않고 별도 Setup-only POST issue/open과 private action store를 추가했다. Preserve read는 code-controlled lease, recovery, temporary-file cleanup 또는 disk retention maintenance를 수행하지 않으며 OS-managed `atime` access accounting은 invariant 밖이다.
- New `publicTextSafety.ts`는 public contracts/projection의 fail-closed boundary다. Credential-shaped public text가 감지되면 public Board wrapper를 반환하지 않는다. Private target, native identifier, raw source data와 credential-shaped text는 public wrapper 밖에 남는다.
- Public Board contract/schema는 v0.1 그대로다. Core engine input, admission, ranking, resolution, output semantics와 hashes, E-001 v0.3 revision 3 dataset/config/evaluator tuple은 변경되지 않는다.
- PR-001 preserve-only store API는 PR-002에서 Work Board의 live capture에 연결됐다. 기존 `/api/attention`과 caller는 default `maintain`을 유지하며, Work Board만 `preserve`를 내부 강제한다. Production G2/G3는 automated preserve wiring만으로 열리지 않으며 manual authenticated browser/privacy review와 human approval까지 blocked다.

### 15.1.1 Semantic Continuation local title overlay and v0.2 intent authority

- 기존 public projection 이후에만 적용되는 별도 local display-copy layer다.
  Core S1/R1/R2/R3/B1 input, result, ordering, hash와 public Board의 key 및
  contract/schema literal은 바꾸지 않는다.
- `GET /api/work-board`의 additive v0.1 response는 strict-validated 기존
  `WorkBoardApiResponse`를 `base`에 byte-identical하게 보존하고, nullable
  `semanticPresentation`에 별도 versioned `{itemRef, displayTitle}` overlay만
  둔다. UI는 이를 render-time에만 사용하며 base `title===summary` invariant를
  깨지 않는다.
- 입력은 명시적으로 확인된
  `{intent:"QA_RUN", subjectLabel, itemRef, workContextRef,
  explicitUserConfirmation:true}` 하나뿐이다. 서버는 local, exact
  same-origin, configured Basic auth, default-off Board read flag와 별도 exact
  default-off `BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED === "true"`를 확인한 뒤
  freshly evaluated unoverlaid `ready/full` Board에서 mapped Continuation,
  `capability=display`, `action=null`, unexpired target을 다시 확인한다.
- Confirmed label을 읽는 GET도 configured Basic auth를 직접 요구하고 auth
  검증 전에는 live evaluation이나 private semantic store read를 수행하지
  않는다. Development middleware bypass만으로 label을 읽을 수 없다.
- Private intent store/schema는 SC-001R에서
  `semantic-continuation-intent-store-v0.3` /
  `semantic-continuation-intent-store-schema-v0.3`로 올라갔다. 신규 decision은
  `semantic-continuation-intent-v0.2`와 overlay policy v0.2를 사용하고 freshly
  evaluated target의 `candidateKind`와 `evidenceBand`를 decision ID/SHA 및 store
  SHA/HMAC에 포함한다. Opaque public
  refs, registry SHA-256, observation/candidate expiry, confirmation/effective
  expiry와 supersession 외에 `authKeyId`, canonical SHA-256 및
  installation-secret-derived HMAC을 묶는다. Current secret은 exact
  `.local/semantic-continuation/<authKeyId>/intent-store.json`만 직접 열며
  fixed-root legacy v0.1을 enumerate, migrate 또는 reuse하지 않는다. Effective
  TTL은 `min(24h, candidate expiry)`이며 read는 missing/corrupt/stale state를
  수정하지 않는 pure read다.
- Store는 fixed root와 namespace chain을 component-by-component로 검증하고
  0700 directory, 0600 no-follow/inode-checked file, same-directory atomic rename을
  사용한다. Pure GET/read가 exact current/legacy orphan temp sentinel을 보면
  삭제하지 않고 fail closed한다. 다음 authorized intent POST만 shared semantic/
  validation cross-process lease 아래 fixed legacy root와 every canonical
  current/inactive `authKeyId` namespace를 검증한 뒤 exact
  `intent-store.json.<pid>.<16hex>.tmp` regular same-owner 0600 file을 복구할 수
  있다. 따라서 rotated-key safe orphan은 current overlay를 계속 막지 않는다.
  Symlink, wrong mode/type/owner 또는 unexpected entry는 그대로 두고 fail closed한다.
  Shared lease bootstrap도 unsafe `.local`/`work-resumption` ancestor를 따라가지
  않는다.
- Legacy intent v0.1/store v0.2는 separate strict schema와 legacy hash/HMAC domain으로
  pure-read하며 exact item/context/observedAt/expiry match만 허용한다. GET/sync는 이를
  rewrite하거나 승격하지 않는다. 다음 explicit confirmation만 history와 supersession
  chain을 보존한 채 current v0.3 store로 atomic upgrade한다. 구버전 reader가 v0.3을
  이해하지 못하면 semantic overlay만 fail closed하고 byte-identical base Board는 유지된다.
- Intent POST body는 exact JSON content type, required `Content-Length`, 8,192-byte
  declared/streamed cap, fatal UTF-8, declared/actual equality와 strict schema를
  semantic evaluation 전에 통과해야 한다. Server page는 write flag 결과만
  boolean capability로 전달하고 UI는 권한이 없으면 form을 숨긴다.
- 표시 결과는 정확히 `${subjectLabel} QA 진행하기`이며 별도
  `displayTitle`에만 존재한다. Base title/summary, lane/order,
  evidence/caveats, capability/action, execution policy와 core artifacts는
  그대로 보존한다. State가 없거나 invalid/stale/mismatched이면
  `semanticPresentation=null`과 byte-identical generic base를 반환한다.
- QA 결과 반영, pass/fail/completion claim, execution, rank/score/dedupe,
  action authority, source refresh와 telemetry는 포함하지 않는다. Public
  text는 control/path separator/traversal/URL, known internal/public ref,
  hash, credential 및 pass/fail/completion/result/apply 의미 토큰을 fail
  closed한다. 의미 토큰 검사는 NFKC 정규화와 구분자 제거 뒤에도 적용되어
  camelCase/concatenated claim smuggling을 허용하지 않는다.
- Overlay resolver는 exact target을 항상 우선한다. Rebinding은 신규 v0.2 decision에만,
  stored/current candidate가 모두 `linked_workstream`, evidence가 모두
  `corroborated`, registry/context/candidate expiry가 같고 current observedAt만 엄격히
  최신인 display/action-null 후보가 정확히 하나일 때 허용한다. Original intent/candidate
  TTL은 연장하지 않으며 old itemRef가 아직 있거나 kind/evidence가 바뀌거나 후보가
  ambiguous하면 generic base copy로 fail closed한다. Rebound는 SC-001 제목만 표시한다.
  SC-002 receipt title과 validation start/terminal currentness는 kind/evidence를 포함한
  exact target만 인정하며 rebound 상태에서는 provenance/profile/subprocess 전에 종료한다.
  Stale abandoned validation receipt recovery와 fresh-clock second authority check는 이
  early exit보다 우선해 dangling receipt 또는 중간 TTL 만료 실행을 만들지 않는다.
- Targeted regression은 8 files/35 tests, typecheck와 lint를 통과했다.
  Core evaluator input/output semantics와 E-001 v0.3 dataset이 불변이므로
  baseline은 N/A다. Production exposure와 release 승인은 여전히 pending이다.
- Q-001 browser currentness correction은 form을 exact
  `itemRef+workContextRef+baseGeneratedAt`으로 remount하고 request generation으로
  late completion/refresh를 버린다. Label edit도 generation과 confirmed state를
  즉시 reset하므로 이전 target 또는 이전 label의 완료 copy가 남지 않는다.
- SC-001R targeted regression은 10 files/77 tests, typecheck, full lint와 production
  build를 통과했다. Core S1/R1/R2/R3/B1 admission/rank/hash, public Board/wrapper wire,
  E-001 v0.3 revision 3 dataset은 불변이므로 baseline은 N/A다.

### 15.1.2 SC-002 explicit local Semantic Validation receipts (implemented 2026-08-13)

- **Invocation boundary:** 실행 producer의 public entry는 zero-input local
  CLI뿐이다. `npm run semantic-validation`에 argument가 있으면 실행하지
  않고 fail closed한다. Work Board GET, intent POST, client와 Attention Lab은
  SC-002 producer/runner 또는 validation `node:child_process` path를 import하지
  않으며 receipt upload/poll-triggered validation endpoint도 없다. 단,
  reused A-001 live capture에는 기존의 read-only Git code-provenance
  `execFile` probe가 있다. 따라서 이 경계는 HTTP-triggered validation
  subprocess 0건을 보장하며 inherited route graph 전체의 zero-child-process
  claim은 하지 않는다.
- **Root/profile boundary:** Root는 module 위치에서 계산하고 realpath로
  검증한 fixed `suggestion/` directory다. Label, item/context ref, request 또는
  environment가 cwd를 결정하지 않는다. Profile v0.1은 package의 exact
  `typecheck`, `lint`, `test` script 문자열을 drift guard로 확인한 뒤,
  resolved `process.execPath`와 `node_modules` 아래 fixed TypeScript, ESLint,
  Vitest entrypoint를 직접 호출한다. Exact step order는
  `typecheck`, `lint`, `unit_test`; `shell:false`, fixed argv/cwd/env/timeout,
  ignored stdin/stdout/stderr다. npm/npx/shell/arbitrary command를 subprocess로
  실행하지 않는다.
- **Authority and concurrency:** Validation start는 별도 renewable 0600
  `run.lock`의 exclusive ownership을 먼저 얻는다. Loser는 intent/receipt/
  Board/code authority를 읽지 않고 validation process도 spawn하지 않는다.
  SC-001 confirmation과
  SC-002 start mutation은 existing Work Resumption filesystem lease를 semantic
  authority lock으로 공유한다. Start는 그 lock 아래 authenticated receipt
  store 및 exact current unsuperseded SC-001 intent를 다시 읽는다. Terminal
  append 전에도 run lease ownership, end provenance, freshly evaluated Board와
  exact intent currentness를 재검증한다. Stale dead-process lock은 이전
  matching running receipt를 `RUN_ABANDONED/inconclusive`로 닫은 후에만 새
  running event를 추가한다.
- **Receipt/store contract:** Receipt/store/schema/profile/receipt-policy/
  24-hour TTL policy는 각각 private v0.1이다. Running 및 terminal receipt는
  intent decision ID/hash, public opaque item/context refs, registry SHA-256,
  observed/candidate expiry, intent confirmation/expiry, typed start/end code
  provenance, exact ordered step tuple 및 bounded statuses를 묶는다. Effective
  expiry는 `min(start+24h, intent expiry, candidate expiry)`다. Receipt SHA-256,
  installation-secret-derived HMAC, previous-receipt SHA와 revision으로 strict
  chronological append chain을 만들며 store HMAC과 current run/receipt pointer를
  별도로 검증한다. Invalid tail은 전체 store reject이고 prefix salvage,
  repair 또는 stale-result resurrection을 하지 않는다.
- **Provenance policy:** v0.1에서 subprocess 실행 권한은 current local
  `clean_commit` provenance에만 있다. Dirty worktree, declared commit 또는
  unavailable provenance는 exact three-slot `not_run` inconclusive receipt를
  만들며 process를 spawn하지 않는다. Start/end provenance가 달라지거나
  current intent/Board binding 또는 TTL이 바뀌면 successful step array가
  있어도 terminal result는 inconclusive다.
- **Persistence/privacy:** Store는
  `.local/semantic-continuation/validation/receipts.json`, directory 0700/file
  0600, atomic replace와 bounded 512 receipts를 사용한다. Installation secret은
  HMAC authority로 closure 안에서만 사용하며 receipt/API/presentation/CLI
  summary에 넣지 않는다. Raw stdout/stderr, command/executable/cwd path,
  repository/session ID, URL, prompt, credential도 보존하거나 반환하지 않는다.
  Pure GET/preserve는 orphan temp를 정리하지 않는다. 다음 authorized semantic/
  validation mutation만 shared cross-process lease 아래 exact
  `receipts.json.<pid>.<16hex>.tmp` regular same-owner 0600 file을 O_NOFOLLOW로
  열고 path/handle inode를 재검증한 뒤 제거한다. Symlink/wrong mode/type/owner는
  삭제하지 않고 fail closed한다.
- **Presentation contract:** Base `WorkBoardApiResponse`는 strict reparse되고
  byte-identical하게 유지된다. Separate semantic presentation/response/schema
  envelope만 v0.2로 bump한다. Current run은 older pass보다 항상 우선한다.
  Verified running/failed/passed receipt는 exact fixed display title
  `QA 진행 상태 확인하기` / `QA 실패 항목 검토하기` /
  `QA 통과 결과 확인하기`를 낸다. Inconclusive/invalid/stale/code drift/
  binding mismatch는 existing SC-001 `${subjectLabel} QA 진행하기`로 fallback한다.
  Base title/summary, lane/order, evidence/caveats, capability/action, execution
  policy와 core artifacts는 변경하지 않는다. Structured finding adapter와
  results-review/result-apply/`반영` branch는 구현하지 않는다.
- **Integrity limits:** HMAC/chain은 accidental corruption과 secret이 없는
  tamper를 fail closed하지만, 동일 OS user가 private state와 installation
  secret authority를 모두 교체하는 위협 또는 이전의 완전 유효한 store
  rollback을 external monotonic anchor 없이 탐지하지 못한다. Distributed/
  cross-host execution은 지원하지 않는다. 512-receipt retention/compaction과
  manual CLI/browser smoke는 follow-up이다.
- **Validation:** Targeted Vitest 13 files/56 tests, `npm run typecheck`와
  `npm run lint`가 통과했다. Actual production CLI는 explicit user invocation
  전용이라 이 구현 turn에서 실행하지 않았다. Core Continuation/Board/E-001
  input, semantics, hashes와 dataset이 불변이므로 baseline은 N/A다.

### 15.1.3 A-001 PR-001 preserve-only local read boundaries (implemented foundation)

- Shared `LocalReadMode`는 `maintain | preserve`이고 default는 기존 동작과
  동일한 `maintain`이다. GitHub token/snapshot, Codex config/snapshot/local-Git/
  observation/conversation, Google Calendar token/snapshot, Notion token/snapshot
  reader가 optional mode를 받는다.
- Connector `preserve` read는 stale-temp cleanup과 Codex conversation purge를
  수행하지 않는다. Owned non-symlink 0700 directory 및 regular 0600 file만
  `O_NOFOLLOW`로 열고 controlled ancestor chain과 handle/path inode, size,
  mode, mtime, ctime을 재확인한다. Existing/dangling ancestor symlink도 missing
  state로 취급하지 않고 fail closed한다.
  Legacy schema migration은 memory 안에서만 수행하고 corrupt/expired/
  consent-mismatched conversation state는 unavailable이며 original bytes는
  유지한다.
- `readManagedCodexObservabilityPreservingState`는 process queue나 filesystem
  lease를 획득하지 않고 settlement recovery, temp cleanup, permission repair,
  history prune write 또는 expired-run deletion을 수행하지 않는다. Settlement,
  state lock, recognized temp, partial/corrupt store, exact history-set mismatch,
  symlink/unsafe mode 또는 unstable fingerprint는 current authority로 사용하지
  않고 fail closed한다. Valid retention 결과는 returned projection에만 적용한다.
- `readWorkArtifactAttributionStorePreservingState`도 shared Work Resumption
  lock을 획득하지 않고 temp cleanup, expired-invalid deletion 또는 retained
  ledger rewrite를 수행하지 않는다. Pending lock/temp, corrupt/unsafe/unstable
  state는 fail closed하고 valid retention은 in-memory view에만 적용한다.
- PR-001 자체는 store/read boundary만 제공했으며 PR-002가 아래 15.1.4의
  coherent preserve capture와 Work Board wiring을 추가했다. 기존 live Attention
  caller는 계속 default-maintain 호환이고 Work Board만 preserve를 강제한다.
- `atime`은 OS access accounting이며 successful read/readdir가 macOS에서
  갱신할 수 있으므로 preserve invariant에서 제외한다. Contract는 content,
  mode, mtime, inode와 listing을 보존하고 code-controlled mkdir/write/rename/
  unlink/chmod/utimes/lease/recovery/cleanup/disk-prune가 없음을 보장한다.
- Targeted Vitest 11 files/128 tests, `npm run typecheck`, `npm run lint`와
  `git diff --check`가 통과했다. Filesystem evidence는 before/after content,
  mode, mtime, inode와 listing, missing-state no-mkdir, pending/temp/lock/history
  보존, independent settlement/temp/lock cases, deterministic shared/managed/
  attribution inode replacement와 directory-chain identity change,
  in-memory retention, corrupt/partial/symlink/unsafe-mode fail-closed 및
  default-maintain compatibility를 포함한다.
- Core Continuation/R1/R2/R3/B1 contract, hash, evidence, ranking, Board bytes,
  E-001 dataset/evaluator와 public API는 변경하지 않는다. 따라서 core baseline은
  N/A이고 production G2/G3 및 release는 blocked다.

### 15.1.4 A-001 PR-002 coherent live preserve capture (implemented 2026-08-13)

- `LiveReadMode = maintain | preserve`는 additive internal input이며 default는
  `maintain`이다. `/api/attention`은 기존 default를 유지한다. Work Board base는
  항상 `readMode=preserve`, `refreshSources=false`를 전달하고 preserve와 source
  refresh의 조합은 env, source 또는 store를 읽기 전에 거부한다.
- Internal `attention-preserve-capture-v0.1`은 trusted cwd 아래 base scope
  `.local/connectors`, `.local/context`, `.local/work-resumption`과 semantic scope
  `.local/semantic-continuation`을 분리한다. 각 scoped tree를 O_NOFOLLOW로 열고
  sorted manifest에 content/listing SHA-256, type, mode, uid, gid, device, inode,
  link count, size, mtime, ctime을 기록한다. Shared cwd/`.local` ancestor는
  symlink/mode/owner/device/inode trust identity와 scope-filtered listing hash만
  비교해 다른 scope 생성/삭제가 현재 scope를 불안정하게 만들지 않는다.
- Manifest는 read callback 전후에 exact 비교된다. Inode/content/directory
  generation이 바뀌면 한 번만 재시도하고 두 번째 변화는 typed unstable이다.
  Unsafe final/ancestor symlink, ownership/mode, recognized temp/partial,
  Work Resumption/managed/artifact lock 또는 managed settlement는 recovery하지
  않고 fail closed한다. Generic programming/evaluator error는 typed capture로
  숨기지 않으며 known preserve store error만 READ_FAILED로 normalize한다.
- Work Resumption preserve snapshot은 process queue/filesystem lease를 사용하지
  않는다. Caller가 이미 preserve-read한 Codex config와 한 개의 cloned Date를
  받고 bindings/heartbeat를 stable-read한 뒤 callback 후 exact content와
  fingerprint를 다시 확인한다. Connection generation, owner, binding store와
  one-asOf가 managed observability, work relations, artifact relations와 claim
  authority까지 재사용된다. Managed/artifact reads는 PR-001 preserve APIs다.
- Context registry, weekly outcome와 workflow는 preserve mode로 한 번 읽고 pure
  resolver에 전달한다. GitHub/Codex/Calendar/Notion source reads, Codex config,
  local Git snapshot과 nested conversation expiry도 같은 fixed request time과
  mode를 받는다. Preserve path의 startedAt/completedAt/latency와 evidence asOf는
  같은 시각이며 preserve reader 내부에서 ambient `Date.now()`를 사용하지 않는다.
- Preserve env snapshot은 proxy/accessor/symbol/non-enumerable/non-string 또는
  inherited enumerable state를 fail closed하고 caller/process env를 수정하지
  않는다. `.env.local`, shared env file과 module cache도 읽거나 변경하지 않는다.
  Preserve provenance는 declared commit/fingerprint만 허용해 Git/worktree 또는
  child process를 실행하지 않는다. 선언이 없으면 provenance unavailable이고
  Continuation은 bounded Active-only fallback으로 내려간다. Maintain Git probe는
  `/usr/bin/git`, sanitized environment, `GIT_OPTIONAL_LOCKS=0`, system/global config
  차단, fixed timeout과 `shell:false`를 사용한다.
- Base capture typed failure는 authenticated GET/intent POST에서 private detail이
  없는 503으로 투영된다. Semantic intent/receipt는 별도 semantic capture에서
  읽고, missing/corrupt/unstable 상태는 strict-valid base response를 바꾸지 않은
  채 `semanticPresentation=null`로 fallback한다. Semantic live read는 base capture의
  Codex installation-secret authority를 request closure에서 재사용하며 config를
  다시 읽지 않는다. Secret은 response/summary/manifest에 포함되지 않는다.
- Preserve invariant는 OS-managed `atime`을 제외한다. Automated evidence는 전체
  fixture의 content/type/mode/uid/gid/dev/ino/nlink/size/mtime/ctime/hash와 listing이
  read 전후 동일하고 code-controlled mkdir/write/rename/unlink/chmod/utimes,
  lease/recovery/cleanup/disk-prune 호출이 없음을 검증한다. Stable maintain/preserve
  semantics, missing state, critical sentinels, corrupt/replacement, one retry,
  scope isolation, fixed asOf, route 503 및 semantic-null fallback도 포함한다.
- 2026-08-13 KST validation은 targeted Vitest 21 files/150 tests,
  `npm run typecheck`, `npm run lint`, `git diff --check`를 통과했다. Public
  Work Board/semantic presentation, S1/R1/R2/R3/B1와 E-001 계약·schema·hash·dataset은
  변경되지 않아 core baseline은 N/A다. Manual authenticated browser/privacy smoke,
  production G2/G3, public/action rollout과 release approval은 pending이다.

### 15.1.5 A-001 formal display-only Continuation read API (implemented 2026-08-13)

- `GET /api/continuation`은 exact default-off flag
  `BLABASE_CONTINUATION_READ_ENABLED`, local-only, safe-origin, configured Basic
  auth와 `Cache-Control: no-store` 뒤에서만 동작한다. Handler는 이 gate를 평가기
  호출보다 먼저 확인한다. POST/open/action endpoint는 추가하지 않았다.
- 새 strict DTO의 exact contract는 `continuation-read-api-v0.1`이다. Response는
  R3 base decision의 `generatedAt`, `status`, exact `coverageCode`와 최대 3개의
  `{title, summary, caveats, capability:"display", action:null}`만 포함한다.
  `offers_available`과 `setup_required`만 item을 가지며 setup도 display-only다.
  Internal candidate/project/WorkContext/source/run/proof/hash/ref와 private target은
  DTO에 존재하지 않는다.
- Formal evaluator는 public Work Board를 다시 필터링하지 않는다. Work Board는
  Attention precedence 뒤 3개로 잘릴 수 있으므로, 같은 request의 단일 preserve
  capture에서 full S1/R1/R2/R3/B1 검증까지 성공한 exact R3 resolved decision을
  private seam으로 함께 반환하고 그 decision을 직접 안전 투영한다. 기존
  `/api/work-board`, Semantic Continuation wrapper와 UI 응답은 이 seam의 기존
  `response`만 사용하므로 byte/schema/version이 바뀌지 않는다.
- Authenticated R3 decision의 normal empty/insufficient/unavailable tuple은
  `no_recent_context/COMPLETE`, `insufficient_evidence/INSUFFICIENT`,
  `unavailable/UNAVAILABLE`로 그대로 유지한다. Stable pre-R3 prerequisite 실패는
  기존 authenticated stage result만으로 bounded unavailable 또는 insufficient를
  선택하고 상세 reason은 공개하지 않는다. Typed preserve capture failure는
  private detail 없는 503, unexpected evaluator/schema failure는 sanitized 500이다.
- Public text는 control, path/URL, credential, SHA와 known internal identifier/ref
  형태를 fail closed한다. Server boundary는 descriptor-only JSON data와 strict
  schema를 요구하고, browser client도 Node crypto import 없이 exact-key/status/
  coverage/display-only parser로 다시 검증한다. Response에는 store read, source
  refresh, persistence, action, telemetry 또는 second capture가 없다.
- 이 API는 pure projection과 새 transport contract만 추가한다. S1/R1/R2/R3/B1,
  public Work Board/SC wrapper, evaluator/dataset/hash/rank/evidence semantics는
  변경하지 않아 core baseline은 N/A다. Automated validation의 exact command와
  scoped patch fingerprint는 ECR에 기록하며 manual authenticated browser/privacy
  smoke, G2/G3, UI/action/public rollout 및 release approval은 pending이다.

### 15.1.6 U-001 Work Cockpit display-only Board (implemented 2026-08-13)

- Work Cockpit의 canonical proposal feed는 authenticated
  `/api/work-board` semantic wrapper 하나다. `/api/attention`은 기존 Active
  diagnostic에만 사용하고 `/api/continuation` 결과와 concatenate, join, index/title
  matching하지 않는다. Initial/poll은 두 독립 read를 병렬로 시작하고 manual source
  refresh는 Attention refresh가 끝난 뒤 Work Board를 정확히 한 번 읽는다.
- Browser boundary는 HTTP 2xx와 JSON content type을 먼저 확인한 뒤 strict wrapper,
  base Board, server lane/order/dedupe, `display/action=null`, execution policy,
  evidence/caveat allowlist와 semantic overlay binding을 검증한다. Plain text/HTML
  auth error, non-JSON, 401/403/404/500/503, network/schema/private/actionful input은
  bounded failure이고 이전 Board와 overlay를 즉시 제거한다. Server와 browser는
  Node import가 없는 동일 pure public-text locator/credential policy를 사용하므로
  `CI/CD 결과 확인`은 허용하지만 `/Users/...`, `C:\...`, URL, credential 및 private
  ref는 fail closed한다.
- Panel은 primary와 alternatives의 계약 순서를 바꾸지 않고 fixed
  `attention → continuation → setup` column으로만 분배한다. 각 lane heading은
  `지금 처리할 일`, `이어서 할 일`, `연결할 일`이고 visible item이 없으면 status
  원인을 추론하지 않고 exact `표시할 제안 없음`만 쓴다. Exact itemRef-bound overlay
  title은 Continuation base title보다 우선하지만 base object를 수정하지 않는다.
- Evidence band와 caveat code는 좁은 한국어 allowlist copy로만 표시한다. Item이
  current wall clock에서 만료됐으면 polling 성공 여부와 무관하게 숨기고 nearest
  expiry timer로 view를 갱신한다. Timer는 최대 60초 chunk마다 clock state를
  갱신하고 아직 만료 전이면 다시 예약해 긴 TTL도 platform timeout 범위를 넘지
  않는다. Public opaque itemRef는 React 내부 lookup에만
  쓰며 DOM/accessibility/data/URL/console에는 출력하지 않는다. Private namespaces,
  action refs/targets와 raw codes도 출력하지 않는다.
- Panel markup은 semantic h2/h3/h4와 ol/li를 사용하고 정상 feed에는 button, link,
  form, CTA, click/keyboard navigation 또는 large aria-live region이 없다. Desktop은
  3-column, 600px 이하에서는 1-column이며 title/evidence는 줄바꿈한다. Initial,
  polling 및 expiry update는 focus/scroll을 변경하지 않는다. 기존 Attention Lab
  SC-001 form은 Q-001에서 exact target remount, request-generation suppression과
  edit-time state reset을 추가해 stale completion이 새 target에 남는 race를 닫았다.
- Monotonic request token은 late response가 current Board를 덮지 못하게 한다.
  Board 실패는 Attention diagnostic success와 독립적으로 feed/overlay를 clear한다.
  Mounted browser regression은 A start → B start → B success → A success에서도 B만
  유지하며, 기존 Board 뒤 current 401/non-JSON/network rejection은 base/overlay를
  모두 제거함을 고정한다.
  Existing Active 영역은 `기존 Active Attention 판정` label과 별도 timestamp를 유지해
  canonical proposal feed와 구분한다.
- Public Work Board v0.1, semantic wrapper/presentation v0.2,
  `continuation-read-api-v0.1`, S1/R1/R2/R3/B1와 evaluator/dataset/hash는 unchanged다.
  UI-only presentation이므로 core baseline은 N/A다. Exact automated evidence와 patch
  fingerprint는 ECR에 기록하며 manual responsive/accessibility/privacy/copy review와
  G2/G3/release approval은 pending이다.

### 15.1.7 L-001 default-off Launcher Work Board (implemented 2026-08-14)

- Local Agent IPC envelope는 `blabase-launcher-ipc-v1`, 기존 method는
  `attention.get`, 기존 projection은 `blabase-launcher-attention-v2`를 그대로
  유지한다. 새 strict method `work-board.get {refresh:boolean}`과 별도
  `blabase-launcher-work-board-v1`만 additive하다. Exact
  `BLABASE_LAUNCHER_WORK_BOARD_ENABLED === "true"`가 아니면 evaluation/sync 전에
  `INVALID_REQUEST`다.
- Managed explicit refresh만 existing source sync를 한 번 수행한다. Read-only는
  refresh 요청에도 sync하지 않는다. 이후 Node는 같은 data root에서 canonical
  `evaluateLiveSemanticWorkSuggestionBoard`를 한 번 호출하며, 별도 Attention/
  Continuation merge나 second Board capture를 만들지 않는다.
- Projection은 ready Board primary+alternatives의 계약 순서 최대 3개만 평탄화한다.
  Exact semantic overlay는 server-side itemRef로만 title에 적용하며 itemRef 자체,
  internal/private ref, hash, URL/path/credential과 action은 버린다. Strict output은
  generatedAt/mode/prominentLane/continuationStatus 및 lane/title/evidence/canonical
  caveat/expiry/`display`/`null`만 포함한다. Public text safety는 web의 locator/
  credential guard와 launcher private namespace guard를 모두 적용한다.
- Continuation/Setup은 generatedAt 뒤의 non-null visibility expiry를 요구한다.
  Attention의 Board expiresAt은 dueAt이며 TTL이 아니므로 launcher에서 항상 null이다.
  Full top-three가 Attention으로 채워졌다면 Continuation status가 available이어도
  유효하고, empty total Board만 available을 금지한다. Active-only fallback은
  Attention-only/unavailable만 허용한다.
- Swift는 Full Board를 항목 0개여도 terminal로 표시한다. Unsupported method/
  `INVALID_REQUEST`만 original refresh로 Attention을 한 번 호출하고, completed Board
  active-only/run/schema fallback은 `refresh:false`로 한 번만 호출한다. Typed run/
  schema degradation에는 exact
  `Work Board를 불러오지 못해 기존 Attention을 표시합니다` 안내를 보여준다.
  Timeout/disconnect/malformed envelope/protocol corruption은 같은 session에서
  fallback하지 않는다. Board timeout 또는 pending을 선점한 Board cancellation은 process
  generation을 retire하고 late bytes를 무시한다. Config/data-root stop과 app shutdown도
  handler/stdin detach 뒤 async quarantine에서 bounded SIGTERM grace, 필요 시 SIGKILL로
  child PID 종료를 확인하며 미확인 process는 replacement launch를 차단한다. Start는
  lifecycle epoch와 retirement token을 캡처하고 await 후 cancellation/current epoch/token/
  permanent shutdown gate를 재검증해 old-root 또는 post-shutdown launch를 금지한다.
  Settings transaction은 begin-stop gate를 root activation까지 보유하고 activation 직후
  complete로 새 epoch를 열며, 중간 실패/cancellation은 abort로 process 없이 복귀한다.
  Root가 다른 retry는 activity flag와 무관하게 begin-stop을 반드시 다시 수행한다.
- Swift IPC decoder는 success exact keys `{contract,requestId,ok,result}`, failure
  exact keys `{contract,requestId,ok,error}`, error exact keys `{code,message}`와
  1~120 ASCII uppercase code, 1~500 control-free message, canonical lowercase UUID requestId를
  요구한다. Bounded locator/credential/private-shaped IPC v1 message는 code를 유지한 채
  app-owned generic display text로 sanitize한다. Full Board row는 noninteractive이고
  Setup/Continuation/X-001 action을 연결하지 않는다. Active-only 뒤 legacy Attention의
  기존 Active action은 유지한다.
- Native publish 전에 Continuation/Setup expiry를 원래 순서로 필터링하며 nearest
  expiry를 최대 60초 chunk로 재확인한다. Timer/request는 load/config/shutdown
  generation에 묶여 stale completion이 최신 state나 refreshing 상태를 덮지 못한다.
  Core S1/R1/R2/R3/B1, public Work Board/semantic wrapper, evaluator/dataset와 existing
  Attention contract가 불변이므로 baseline은 N/A다.

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
| Work Suggestion Board | public v0.1 유지; unwired internal input/result/schema/hash v0.3 checkpoint |
| Continuation Setup action | wire `continuation-setup-action-api-v0.1`, action policy v0.1 유지; internal authority/schema/policy/namespace v0.1; private offer/event/store/schema와 revalidation/retention v0.2; 30초 TTL, expiry 기준 최대 24시간 lazy retention |
| Work resumption protocol | exact resume 단계에서 v2 제안, v1 reader compatibility 유지 |
| Monitor | two-lane 지원 버전 신규 |
| Replay | two-lane provenance 지원 버전 신규 |
| Launcher Attention projection | 기존 v2 및 `attention.get` byte/behavior 유지 |
| Launcher Work Board projection | `blabase-launcher-work-board-v1` 신규, IPC envelope v1 유지, default-off |
| Work Board monitoring receipt/API/event/store/quality/replay | M-001a `v0.1` 신규; web-only, default-off, HMAC/redacted, ranking/Gold/release 영향 없음 |
| Semantic Continuation intent store | store/schema v0.2; current-secret `authKeyId` namespace, canonical SHA/HMAC, legacy fixed-root v0.1 no-migration, exact safe POST-only orphan-temp recovery |
| Semantic Continuation intent write capability | separate exact default-off `BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED`; Board read flag만으로 write authority를 부여하지 않음 |

### 18.1.1 구현된 private R-003/B-001 checkpoint tuple

2026-08-13의 unwired internal checkpoint는 다음 exact tuple을 사용한다. 이 표는 public release 또는 dataset freeze를 뜻하지 않는다.

| 구성 요소 | Exact internal version |
| --- | --- |
| Private source adapter batch contract/schema/hash | v0.4; canonical whole-content HMAC, source assessment, all-status `evaluatedAsOf` |
| R-001 identity input/result/schema/hash | v0.4; registry authority HMAC와 mandatory trusted `expectedRegistrySha256` |
| R-002 derivation envelope/result/schema/hash | v0.3 |
| R-002 derivation rule/config | v0.2 |
| R-003 scoring result/schema, resolver, scoring policy | v0.1 |
| R-003 resolution envelope/schema | v0.1 |
| R-003 resolved-decision artifact/schema/hash | v0.1 |
| Nested base Continuation Decision | 기존 v0.2; R-003 authenticity marker가 아니며 단독 소비 금지 |
| B-001 Board input/result contract, schema, input/result/semantic hash | v0.3 |
| B-001 Board composer/precedence/ID policy | v0.1; semantics unchanged |
| Public Work Suggestion Board contract/schema | v0.1 unchanged; public Attention is display-only/actionless |

R-003 producer는 serialized artifacts만 받지 않는다. Original authenticated `ContinuationIdentityInput`, claimed R-001 result, R-002 envelope/result, explicit resolution envelope와 serialized artifact 밖의 installation secret을 요구한다. R-001을 재실행해 claimed result와 canonical-exact 비교하고 R-002 input-bound verifier를 실행한 뒤 전체 chain으로 decision을 만든다. Consumer의 `verifyContinuationDecisionAgainstInput`도 같은 chain을 재실행해 exact output을 비교한다. Installation secret은 저장·hash·출력하지 않는다. Current registry SHA, code commit SHA와 nullable dataset version/SHA pair는 caller artifact와 분리된 trusted expectations로 전달하며 exact 일치가 필요하다. 모든 source batch의 HMAC-bound `evaluatedAsOf`는 R-002/R-003/Board `asOf`와 같아야 한다. Base Decision v0.2가 nested body로 존재해도 distinct R-003 v0.1 resolved artifact와 input-bound verification 없이는 authentic resolver output으로 취급하지 않는다. B-001도 exact original bundle과 trusted options로 이 verifier를 먼저 실행하며, Board dependencies는 input SHA, Active result SHA, outer resolved SHA, nested base artifact SHA와 nested semantic SHA를 별도로 보존한다.

### 18.1.2 M-001a local web monitoring tuple

M-001a는 기존 public Work Board/semantic response의 JSON schema와 bytes를 바꾸지 않는다.
`GET /api/work-board`가 이미 수행한 동일 request-local preserve evaluation의 최종 semantic
response와 private authority만 재사용해 다음 header를 선택적으로 만든다.

| 구성 요소 | Exact version / policy |
| --- | --- |
| Receipt | `work-board-monitoring-receipt-v0.1`, schema/policy v0.1, `X-Blabase-Work-Board-Monitoring-Receipt`, 최대 6,144 ASCII bytes |
| API | `work-board-monitoring-api-v0.1`, local/same-origin/default-off/configured Basic auth, strict JSON/8,192-byte POST |
| Event/store | `work-board-monitoring-event-v0.1`, `work-board-monitoring-store-v0.1`, schema/consent/retention/idempotency v0.1 |
| Quality/replay | `work-board-monitoring-quality-v0.1`, `work-board-monitoring-replay-v0.1`; stored aggregate 재계산만 허용 |
| Surface/flag | `web`; `BLABASE_WORK_BOARD_MONITORING_ENABLED === "true"` only |
| Lifetime | receipt 최대 5분이며 visible Continuation/Setup item expiry보다 늦을 수 없음; Attention `dueAt`은 TTL로 해석하지 않음 |
| Retention/deletion | current installation-key namespace에서 event `occurredAt + 30일`까지 보존하고 다음 명시적 mutation 때 lazy prefix compaction; background cleanup 없음. Explicit purge는 current config/secret 없이도 root lock 아래 모든 safe canonical current/inactive namespace를 삭제 |

Receipt는 signed compact base64url payload다. 암호화 envelope가 아니므로 title, summary,
raw `itemRef`/`workContextRef`, candidate/run/session/native ID, path, URL, prompt, token,
secret, action offer/target를 넣지 않는다. Capture ID, ordinal handle, presentation target,
source/private provenance와 copy는 domain-separated HMAC digest만 남긴다.
Lane/position/kind/evidence/caveat/mode/fallback/source availability와 version은 bounded enum이다.
Attention row의 receipt expiry는 항상 null이며 Continuation/Setup만 visibility expiry를 가진다.

Browser는 latest successful Board response와 receipt의 generatedAt/mode/status/order/lane/kind/
evidence/caveat/expiry를 strict하게 correlate한다. Consent가 있고 receipt가 아직 current일 때
React commit 이후 `render_confirmed`를 보낸다. StrictMode/poll 중복은 같은 consent
epoch의 stable logical presentation target 기준으로 idempotent하다. Explicit
`useful|not_useful`와 allowlisted optional reason, 별도 reset은
Continuation/Setup ordinal에만 허용하고 서버가 signed receipt에서 identity/metadata를
복원한다. Rating click은 consent를 만들지 않는다. Purge는 current config/secret을 먼저
요구하지 않고 root lock 아래 모든 safe canonical current/inactive key namespace를 삭제한다.
Unexpected/symlink/wrong-type entry는 follow/skip하지 않고 fail closed하며, Codex
disconnect도 config 삭제 전에 같은 all-data purge가 성공해야 한다. Receipt/handle은 DOM,
URL, console, localStorage에 두지 않는다.

Quality는 distinct rendered `presentationTargetHmac`를 denominator로 하고 latest non-reset
feedback만 numerator로 쓴다. Coverage와 respondent useful share의 zero denominator는 null이며
lane/position/mode/evidence/surface strata를 canonical order로 낸다. 모든 event와 aggregate는
항상 candidate-only이고 ranking/Gold/release gate에는 반영되지 않는다. CLI의 `aggregate`와
`replay`는 이 authenticated store aggregate만 읽으며 production engine을 실행하지 않는다.

Store는 `.local/work-board-monitoring/<authKeyId>/events.json`을 0700/0600 경계,
domain-separated HMAC event/store chain, shared cross-process root lock, atomic temp+rename,
current-secret namespace와 bounded event/reserve 정책으로 관리한다. Pure GET/read는 mkdir,
cleanup, repair, compaction write를 하지 않는다. Corrupt/unsafe/pending state는 salvage하지 않고
fail closed한다. Normal read는 authenticated stored aggregate mismatch도 reject한다. Replay read는
schema/`authKeyId`/event SHA-HMAC chain/store HMAC을 먼저 검증한 뒤 aggregate를 재계산해
mismatch를 deterministic failure로 보고한다. Same-UID authenticated rollback/exact ABA,
trusted wall clock, crash-left lock/temp의 manual recovery와 background cleanup 부재는 local
dogfood residual이다. Inactive namespace는 background-cleaned되지 않지만 explicit all-data
purge 범위에는 포함된다.

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

Launcher Work Board는 별도 exact default-off
`BLABASE_LAUNCHER_WORK_BOARD_ENABLED`로 rollback한다. Flag를 끄거나 old agent의
unsupported response를 받으면 새 Swift host는 legacy Attention을 최대 한 번 읽고,
old Swift host는 새 method를 호출하지 않는다.

Web Work Board monitoring은 별도 exact default-off
`BLABASE_WORK_BOARD_MONITORING_ENABLED`로 rollback한다. Flag off에서는 receipt header,
monitoring controls와 POST가 없고 기존 Work Board response body는 동일하다. Rollback은
flag를 끈 뒤 additive receipt/API/store/UI/CLI를 제거하며 public Board, Continuation,
Launcher, X-001 action과 core engine version migration은 필요 없다.

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

## 22. 현재 구현 경계 (2026-08-14)

이 문서는 canonical 정책과 contract 경계를 유지한다. 현재 A-001 상태는 다음의 좁은 local monitoring checkpoint로 제한된다.

- Action-disabled local Work Board shadow slice는 구현됐고 2026-08-13 KST current-head validation에서 `npm run typecheck`, targeted Vitest 5 files/52 tests (`liveWorkBoardShadow`, `workBoardRoute`, `suggestionBoardContracts`, `continuationContracts`, `continuationResolver`)와 `npm run lint`가 모두 pass했다. 이 run은 `publicTextSafety.ts`와 명시된 local-side-effect boundary를 포함한다.
- Baseline은 N/A다. 이 slice는 core engine ranking/input/output semantics를 바꾸지 않았고 E-001 v0.3 revision 3 dataset도 변경하지 않았다.
- 새 Board/result persistence, telemetry, source refresh 또는 production-conversation promotion은 없다. PR-002 coherent preserve capture가 Work Board base evaluation에 연결되어 code-controlled lease/recovery/temp cleanup/retention write는 없으며 OS-managed atime만 invariant에서 제외된다. `/api/attention`은 default maintain 호환이다.
- Automated PR-002 gate는 targeted 21 files/150 tests, typecheck, lint와 diff-check를 통과했다. Base instability/recovery-needed state는 sanitized 503, optional semantic instability는 base unchanged/overlay null이고 one-asOf 및 before/after filesystem manifest가 검증됐다. 실제 non-empty Codex/context/workflow/binding/heartbeat/managed/artifact fixture도 `ready/full` Board와 전체 cwd 불변을 증명한다. Core semantics/dataset 불변으로 baseline은 N/A다.
- G2 privacy와 G3 production shadow/dual-lane gate는 manual default-off/on authenticated local API·Attention Lab/Work Cockpit smoke, safe-origin/no-store/credential-shaped public-text rejection, Active-only fallback 및 human review 전까지 blocked다. Formal display-only Continuation GET과 U-001 Work Cockpit Board는 구현됐지만 full action/open API, public rollout, dataset freeze, release 또는 release readiness는 완료·승인됐다고 주장하지 않는다.
- M-001a는 이 Work Board의 JSON을 바꾸지 않는 header/API/UI-only local dogfood
  monitoring checkpoint다. 명시적 consent와 render acknowledgement 뒤 Continuation/Setup
  rating만 30일 lazy-retained private HMAC store에 남기며, Attention/Launcher/implicit
  signal/engine replay/ranking/Gold/release에는 연결하지 않는다. Broader M-001와 human
  privacy/copy/release 검토는 여전히 pending이다.

## 23. Q-001 integrated automated checkpoint (2026-08-14)

Q-001은 base `e2fc9f56066b5d731fddcf9cc1837424a740b450`의 implemented
scope에 대해 unit/typecheck/lint/build, mutable Continuation baseline, full/opt-in
Playwright, Launcher bundle/Swift smoke/build/app/package verification과 root architecture
check를 실행한다. Exact initial/final command, duration, run/artifact hashes, blocker correction,
fingerprint와 manual residual은 `SUGGESTION_ENGINE_VNEXT_QA_REPORT.md` 및 Q-001 Engine
Change Record가 authoritative하다. 최종 architecture check가 pass이면 checkpoint literal은
`automated_checkpoint_passed`, 아니면 `automated_checkpoint_failed`다. Final exact root
`npm run arch:check`는 dependency warnings only/0 errors로 7.39s에 pass했으므로 현재
checkpoint는 `automated_checkpoint_passed`다. Release는 결과와 무관하게
`blocked_pending_human_review`다.

Capability의 실제 구현/승인 경계는 다음과 같다.

| Capability/surface | Current authority |
| --- | --- |
| Formal web display | Public item은 오직 `display/action=null`; 실행 authority 없음 |
| Setup navigation | Explicit click, candidate TTL/source/relevant mapping/code provenance를 재검증하고 fixed same-origin `/projects`만 반환. Null-context Setup이므로 exact WorkContext/session heartbeat는 요구하지 않음 |
| `open_source` | 구현·승인되지 않음; blocked |
| `resume_exact_session` | 구현·승인되지 않음; future exact WorkContext/session binding, fresh heartbeat, short TTL과 action-time revalidation 필요 |
| Launcher Full Board | display-only; Continuation/Setup action 없음 |
| Launcher Active-only fallback | 기존 legacy Active action만 유지; 새 capability 없음 |
| Monitoring | web-only candidate feedback/replay; ranking/Gold/evaluation/release에 영향 없음 |

E-001의 22/22 결과는 mutable/unfrozen synthetic contract checkpoint다. Human-reviewed
Gold, Acceptable@1/3, setup quality, locked holdout 또는 release evidence로 해석하지 않는다.
Real unmocked authenticated browser chain, human privacy/copy/accessibility, full Xcode XCTest,
old/new Launcher packaged compatibility, notarization, HTML nonce CSP, crash-left manual
recovery, dataset governance/freeze/holdout, G2/G3와 explicit release record는 남아 있다.
