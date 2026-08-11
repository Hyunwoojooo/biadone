# Recent Work Continuation technical specification and implementation plan

Status: Draft — planning only; AI proposal, not human approval  
Target: `suggestion/` Work Cockpit, local launcher, and evaluation tooling  
Relationship: additive to `CURRENT_FOCUS_IMPLEMENTATION_PLAN.md`; it does not
replace or activate Current Focus Phase 2

Current implementation checkpoint (2026-08-10): the shipped code is only the
additive `recent-work-projection-v0.1` repository-scope, display-only sidecar.
It correlates one confirmed repository-scope link, a Current Focus GitHub push,
and Local Git v1 state, with `shadow` as the default and optional `present`.
It does not implement the actor/origin, exact-commit, observation/context/offer,
heartbeat/resume, four-mode rollout, applied-selection, monitor v0.7, or replay
v4 contracts proposed below. Those remain planning scope, not compatibility or
release claims for the current projection.

## 1. Outcome and safety boundary

Recent Work Continuation answers **which recent GitHub push and managed Codex
session can be safely offered as work to continue**. It is not evidence that the
user should intervene, and it must not turn a normal Codex session into an
Active Attention candidate.

The feature has three deliberately separate layers:

1. **push-only observation** — a recent, privacy-safe GitHub push fact;
2. **Current Focus context** — an exact push, artifact, binding, execution, and
   WorkStream correlation attached to an existing Current Focus projection; and
3. **actionable escalation** — either an explicit resume offer outside Active
   Attention or, after separate human approval, a tie-break among candidates
   that were already eligible for Active Attention.

The initial implementation is deterministic and adds no production dependency
or LLM. It must never:

- join work by title, prompt, repository label, path, branch, or time proximity;
- create an Attention candidate from a push, generic Codex inventory, healthy
  managed run, project mapping, or Focus alone;
- bypass owner, terminal, source-coverage, conflict, eligibility, lane,
  certainty, blocker, deadline, or review-status gates;
- add to continuation retention or publicly project raw commit SHAs, GitHub
  login names, branch names, prompts, commands, thread IDs, conversation text,
  or absolute local paths; or
- activate Current Focus Phase 2 ranking before its human-review gate closes.

When Current Focus is selected but Active Attention is `no_action` or
`insufficient_evidence`, presentation may state that recent work was identified
but no separate intervention candidate was confirmed. Candidate counts,
eligibility, ranking, and execution inputs remain unchanged.

## 2. Architecture and contracts

```text
GitHub snapshot + normalized batch          managed Codex direct projection
                  |                           |
                  +-- explicit work/artifact relation --+
                                                        |
  RecentWorkPushObservation                  WorkSessionBinding
                  |                           |
                  +-> RecentWorkContinuationContext <- Current Focus
                                      |
                         RecentWorkContinuationOffer
                                      |
                        explicit user resume action

Existing Active Attention -------------------------------------- unchanged
                                      |
       optional human-approved applied-selection sidecar --------+
```

Every contract is strict, versioned, canonically hashed, and bounded. Unknown
versions and dependency mismatches fail closed without changing the baseline
Active Attention result.

### 2.1 `RecentWorkPushObservationV1`

Required public-safe fields:

```ts
type RecentWorkPushObservationV1 = {
  contract: "recent-work-push-observation-v0.1";
  schemaVersion: "recent-work-push-observation-schema-v0.1";
  policyVersion: "recent-work-push-policy-v0.1";
  idPolicyVersion: "recent-work-push-id-v0.1";
  observationId: string;
  repositoryScopeId: string; // opaque
  artifactId: string; // opaque; raw SHA is already discarded
  occurredAt: string;
  expiresAt: string;
  actorClass: "user" | "bot" | "unknown";
  originClass: "direct" | "merge_generated" | "unknown";
  evidenceState: "complete" | "partial_positive";
  disposition: "observed" | "excluded" | "expired" | "unresolved";
  reasonCodes: string[];
  sourceSnapshotSha256: string;
  sourceBatchSha256: string;
  observationSha256: string;
};
```

`actorClass` and `originClass` must be source-derived classifications. The
existing private connector snapshot may retain account metadata under its
existing policy, and raw SHA may be used transiently while normalizing an
authenticated API response; neither enters the continuation observation. A
merge classification must use native evidence when available. Absence of a PR
event or a one-parent commit is not by itself proof that a push was directly
authored. Existing v4–v6 snapshots normalize both classifications to `unknown`.

Only `user + direct` is eligible for correlation. `bot`, `merge_generated`, and
either `unknown` value are retained only as bounded diagnostics and cannot
create a user-facing continuation claim.

### 2.2 `RecentWorkContinuationContextV1`

```ts
type RecentWorkContinuationContextV1 = {
  contract: "recent-work-continuation-context-v0.1";
  schemaVersion: "recent-work-continuation-context-schema-v0.1";
  resolverVersion: "exact-recent-work-continuation-resolver-v0.1";
  identityPolicyVersion: "recent-work-continuation-id-v0.1";
  contextId: string;
  status: "matched" | "unresolved" | "terminal" | "expired";
  correlation: "exact_verified" | "project_only" | "none";
  observationId: string | null;
  workstreamId: string | null;
  currentFocusProjectionSha256: string;
  bindingId: string | null;
  executionId: string | null;
  artifactId: string | null;
  completionState: string | null;
  attentionSelectionEffect: "none";
  reasonCodes: string[];
  dependencies: ContinuationDependencyHashesV1;
  contextSha256: string;
};

type ContinuationDependencyHashesV1 = {
  asOf: string;
  githubSourceSnapshotSha256: string;
  githubBatchSha256: string;
  managedPublicProjectionSha256: string;
  managedSemanticProjectionSha256: string;
  managedRunStartedAtByIdSha256: string;
  workRelationProjectionSha256: string;
  artifactRelationProjectionSha256: string;
  claimAuthorityProjectionSha256: string;
  bindingStoreSha256: string;
  currentWorkstreamProjectionSha256: string;
  currentFocusProjectionSha256: string;
  rolloutSha256: string;
};
```

`exact_verified` requires all of the following at the same `asOf` boundary:

- a current explicit-user `WorkSessionBinding`;
- an exact managed Codex execution and managed-run relation;
- an active explicit artifact attribution;
- the same repository scope and opaque artifact ID in the GitHub batch;
- a selected exact Current Focus WorkStream with matching relation identities;
- current claim authority, no conflict, and a nonterminal lifecycle for resume;
- fresh, complete material GitHub and Codex evidence; and
- matching dependency hashes.

Project mapping alone produces at most `project_only`. It may be displayed as
context but cannot produce an offer, Focus switch, or Attention effect.

### 2.3 `RecentWorkContinuationOfferV1`

```ts
type RecentWorkContinuationOfferV1 = {
  contract: "recent-work-continuation-offer-v0.1";
  schemaVersion: "recent-work-continuation-offer-schema-v0.1";
  policyVersion: "explicit-recent-work-resume-policy-v0.1";
  contextId: string;
  status: "observe_only" | "resume_available" | "blocked" | "expired";
  expectedBindingId: string | null;
  expectedExecutionId: string | null;
  safeDisplayLabel: string | null;
  expiresAt: string;
  explicitUserActionRequired: true;
  attentionCandidateCreated: false;
  offerSha256: string;
};
```

`resume_available` reuses the existing `work-resumption-schema-v1` open command,
including exact expected binding/execution IDs and explicit user action. The
existing 30-second command TTL is not extended. The offer is presentation and
resumption capability, not an Active Attention candidate.

### 2.4 Optional applied-selection sidecar

If humans later approve Current Focus Phase 2, use a new
`current-focus-applied-selection-v0.1` input/result sidecar. It seals:

- Current Focus and exact continuation context hashes;
- rollout/config version;
- baseline Active Attention result hash;
- candidate IDs before and after the permitted reorder;
- the complete safety tuple;
- sanitized fallback reason; and
- applied-result hash.

It may reorder only candidates already present and eligible in the baseline,
within the same lane, exact deadline, trigger, blocker class, certainty, and
review-status tier. It cannot change the candidate universe or turn a baseline
`no_action`/`insufficient_evidence` result into `suggested`.

## 3. Identity, recency, and deterministic resolution

### 3.1 Identity

Use existing opaque IDs and domain-separated canonical hashing:

```text
observationId = stableId(
  "recent-work-push-v0.1",
  repositoryScopeId,
  artifactId,
  occurredAt
)

contextId = stableId(
  "recent-work-continuation-v0.1",
  observationId,
  workstreamId,
  bindingId,
  executionId,
  artifactId
)
```

Snapshot IDs do not belong in logical identity; they belong in dependency
hashes. If an opaque artifact ID is not stable across snapshots, the resolver
must abstain rather than use a heuristic fallback.

### 3.2 Recency and expiry

Proposed defaults, pending human approval:

- push and managed meaningful-activity TTL: fixed 24 hours;
- Current Focus seven-day evidence window: unchanged and not reused as the
  continuation TTL;
- maximum future clock skew: 60 seconds;
- source freshness: reuse the existing source-specific snapshot policies;
- context expiry: the earliest push/activity expiry, binding invalidation, or
  source freshness failure;
- immediate invalidation: unbind/rebind, superseding artifact attribution,
  terminal transition, claim conflict, or dependency-hash mismatch; and
- action-time validation: recompute current binding, terminal state, heartbeat,
  and destination before issuing the existing 30-second command.

An expired confirmation is never silently renewed by polling or another
unrelated push. The approved fallback must be either recomputation from fresh,
direct, complete evidence or explicit reconfirmation.

### 3.3 Deterministic resolution

Hard exclusions run before ordering. Remaining observations use this
lexicographic tuple:

1. exact artifact + binding + execution identity;
2. direct complete evidence over direct partial-positive evidence;
3. latest meaningful `occurredAt`; and
4. canonical ID order for serialization only.

Different WorkStreams tied on all semantic fields produce `unresolved`; a
stable ID must not become an arbitrary semantic winner. Event counts, commit
counts, and historical scores are never summed.

## 4. Source coverage, terminality, and privacy

### 4.1 Partial-source positive evidence

| Evidence state | Push observation | Focus context | Resume offer / Attention effect |
|---|---|---|---|
| exact push fact complete, full snapshot partial | internal `partial_positive` | unresolved | forbidden |
| actor/origin provenance missing | bounded diagnostic only | forbidden | forbidden |
| unrelated source partial; GitHub/Codex dependencies complete | allowed | exact match allowed | revalidate before offer |
| material GitHub or Codex stale/partial | expired/unresolved | unresolved | forbidden |
| terminal event absence in partial input | never infer nonterminal | unresolved | forbidden |

Positive evidence proves only the observed fact. Partial coverage cannot prove
that no newer, competing, terminal, bot, or merge event exists.

### 4.2 Exclusion and terminal precedence

Exclude or abstain on bot, merge-generated, unknown provenance, stale source,
TTL expiry, unbound/rebound execution, superseded attribution, source gaps,
clock regression, dependency tampering, identity conflict, or equal latest-time
competition.

A later merge, close, cancellation, completion, or managed-run close wins over
an earlier push. A terminal WorkStream may remain read-only recent history but
cannot expose `resume_available`, re-enter eligibility, or promote a related
project candidate. A post-terminal push starts a new continuation only through
a new explicit binding and exact artifact relation.

### 4.3 Public projection and retention

Public fields are limited to status, bounded safe label, opaque context ID,
event age/expiry, completion state, reason codes, and whether resume is
available. The public/API/monitor/launcher projections exclude credentials,
raw GitHub/Codex identities, repository URL, branch, SHA, prompt, command,
conversation content, evidence payload, and local path.

The feature reuses existing local metadata, the 30-day artifact-attribution
retention, and the seven-day resumption-command retention. It adds no raw source
retention or remote telemetry. Synthetic evaluation artifacts stay in
`.local/evaluations/`; production observations never become Gold automatically.

## 5. Version and compatibility ledger

| Contract | Current | Planned | Rule |
|---|---|---|---|
| GitHub snapshot | v6 | v7 | Add required privacy-safe actor/origin provenance; keep v4–v6 readers |
| GitHub native activity normalizer | v0.6 | v0.7 | v4–v6 map new provenance to `unknown` |
| Runtime work signal/batch | v0.3 | v0.4 | Required if provenance enters normalized facts; retain a v0.3 compatibility parser |
| Recent Meaningful Event projection/schema/rule | v0.1/v0.2/v0.6 | v0.2/v0.3/v0.7 | Carry bounded provenance and exclusion reasons; keep ID v0.2 if ID inputs do not change |
| Current WorkStream | schema v0.1, reconstruction v0.5 | unchanged | Continuation does not add grouping edges |
| Current Focus | schema v0.1, selection v0.2 | unchanged in shadow | No selection semantics change before human approval |
| Focus-aware shadow | schema v0.2, resolver v0.2 | unchanged | Still `attentionSelectionEffect=none` |
| Current repository-scope Recent Work | projection/schema/resolver v0.1/v0.1/v0.1 | unchanged | Implemented display-only capability; default remains shadow and no present rollout is approved |
| Recent Work projection evaluation | dataset/config v0.1/v0.1; run/policy v0.2/v0.2 | mutable checkpoint | Synthetic Dev Candidate only; no frozen hash, run, approval, or release claim |
| Push observation/context/offer | none | v0.1 each | New additive sidecars |
| Work resumption | schema/protocol v1 | unchanged | Reuse explicit-user open command and 30-second TTL |
| Active Attention | result v0.5, ranking v0.3, resolver v0.4 | unchanged | Continuation never creates or restores candidates |
| Applied Focus selection | none | v0.1, human-gated | Separate baseline/applied result; no mutation of v0.5 result |
| Launcher attention | v2 | v2 initially; v3 only if a new continuation field is required | Reuse existing optional Current Focus summary first; a v3 decoder must accept v2 during migration |
| Monitor/replay | monitor v0.6, replay v3 | monitor v0.7, replay v4 | Record flags, context hashes, baseline/applied results, and sanitized fallback |
| Continuation evaluation/config | none | v0.1/v0.1 | New mutable synthetic Dev Candidate |

Do not reuse a version string for changed behavior. A version bump is required
for schema fields, acceptance policy, resolver behavior, ID inputs, or applied
ranking. Formatting-only presentation copy may keep semantic engine versions.

## 6. Rollout configuration and gates

Use independent versioned controls, not a single feature flag:

```ts
type RecentWorkContinuationRolloutV1 = {
  contract: "recent-work-continuation-rollout-v0.1";
  observationMode: "off" | "shadow" | "present";
  focusBridgeMode: "off" | "shadow" | "present";
  resumeOfferMode: "off" | "shadow" | "present";
  attentionEffectMode: "off" | "shadow" | "apply";
  approvedDatasetVersion: string | null;
  approvedDatasetSha256: string | null;
  humanApprovalRef: string | null;
};
```

Initial defaults are `shadow/off/off/off`. Unknown or inconsistent values fail
closed to a byte-equivalent baseline Active Attention result.

Dependencies are monotonic:

```text
focusBridge present
  requires observation present + reviewed continuation dataset

resumeOffer present
  requires focusBridge present + exact/current destination + approved UX/TTL

attentionEffect apply
  requires Current Focus Phase 2 approval + applied-selection v0.1
  + same-hash baseline comparison + separate release approval
```

Each run records effective non-secret configuration, rule versions, dataset
version/hash, baseline and comparison run IDs, code provenance, dependency
hashes, and rollout result. Rollback turns the four controls off in reverse
order; legacy GitHub readers and baseline Active Attention remain available.

## 7. Seven-stage implementation plan

### Stage 1 — Decision and contract freeze

- Finalize 24-hour TTL, confirmation scope, terminal behavior, expiry fallback,
  retention, and whether the initial UI includes push-only observations.
- Approve the three-layer product boundary and the prohibition on candidate
  creation.
- Add the proposed v0.1 schemas, reason-code registry, dependency set, canonical
  ID/hash fixtures, and rollout config with all effects disabled.
- Draft the Engine Change Record before source behavior changes.

Done when schemas reject unknown/raw fields, flag-off output is baseline
equivalent, and unresolved product choices have named human owners.

### Stage 2 — GitHub provenance and push observation

- Add GitHub snapshot v7 actor/origin classification while retaining v4–v6
  readers.
- Normalize only privacy-safe classifications; discard raw actor/SHA/branch.
- Project the 24-hour push observation with bot, merge, unknown, stale, partial,
  duplicate, and future-clock exclusions.
- Keep rollout at `observationMode=shadow`.

Done when only complete `user + direct` evidence can be correlation-capable and
legacy snapshots remain readable but non-actionable.

### Stage 3 — Exact Codex correlation

- Resolve the exact observation → artifact attribution → work relation →
  binding → execution → WorkStream chain.
- Seal GitHub batch/snapshot, managed public/semantic, work relation, artifact
  relation, claim authority, binding store, WorkStream, Current Focus, and
  rollout hashes.
- Return `project_only` or `unresolved` rather than using heuristic fallback.

Done when tampering, rebind, supersession, partial material evidence, or an
identity tie deterministically abstains and candidate/eligibility diffs stay
zero.

### Stage 4 — Current Focus shadow bridge

- Attach only exact matched context to the existing Current Focus projection.
- Keep Current Focus schema/selection and Active Attention unchanged.
- Record counterfactual applied-selection input/result in shadow, preserving the
  full safety tuple and `attentionSelectionEffect=none`.
- Never promote a terminal Focus through project fallback.

Done when baseline Active Attention result/hash is unchanged for every case and
the shadow record explains every match, omission, and fallback.

### Stage 5 — Presentation and explicit resume offer

- Add optional/default-null bounded web/API projection; reuse the existing
  launcher Current Focus summary before introducing a launcher v3 field.
- Distinguish push-only, exact Focus context, terminal history, and unavailable
  resume copy.
- Issue an existing work-resumption open command only after explicit user action
  and action-time binding/execution/heartbeat validation.
- Show recent work separately when Active Attention has no eligible intervention
  candidate; do not change its title, counts, status, or primary action.

Done when older consumers decode omitted fields, privacy sentinels stay absent,
and every stale/terminal/raced click fails safely without opening the wrong
session.

### Stage 6 — Evaluation, replay, and human review

Current projection-only checkpoint: a separate mutable
`suggestion-recent-work-projection-dev-v0.1` Dev Candidate uses
`RW-PROJ-DEV-*` IDs so it cannot be confused with the 23 full-continuation
cases below. Its 23 bounded synthetic case records cover 28 current-contract
runtime variants: `shadow|present`, the five public Local Git tracking states,
exact focus/Local Git TTL and future-skew edges, currentness, repository-link
resolution, public timestamp canonicalization, privacy, deterministic replay,
and unchanged Active input/candidates/eligibility/selection/result hashes. The
removed/archived cases are explicitly marked as upstream-filtered absence at
the confirmed-link boundary. This checkpoint adds an evaluator and private
baseline runner only; it does not satisfy `RWC-008`, freeze a Regression
Dataset, or add monitor v0.7/replay v4.

Historical projection-only evidence now includes mutable candidate run
`recent_work_run_9b9150ff2629744a1070846834df2cd5`: typecheck passed, the
targeted suite passed 14 files/104 tests, and the private baseline runner passed
23/23 cases with 28/28 measured variants, zero recorded failure/diff/privacy/
effect metrics, and all eight automatic gates true. The exact input, config,
code-provenance, record, and file hashes are retained in the Engine Change
Record. The dataset remains mutable and unfrozen, human review remains
`not_started`, there is no formal same-frozen-input comparison or improvement
claim, and shadow remains the default.

Create mutable `suggestion-recent-work-continuation-dev-v0.1` with materialized
synthetic inputs. Minimum cases:

1. direct user push only;
2. exact push + artifact + binding + managed execution;
3. same title, distinct identities;
4. close timestamps without a relation;
5. bot push;
6. unknown actor;
7. merge-generated push;
8. push followed by PR merge;
9. terminal followed by a new explicit binding;
10. stale GitHub and fresh Codex;
11. fresh GitHub and stale Codex;
12. partial-positive push with missing competing coverage;
13. unrelated source partial while material dependencies are complete;
14. unbind/rebind and superseded attribution;
15. missing or stale resume heartbeat;
16. many old pushes versus one new event, with no score accumulation;
17. duplicates, input permutation, equal-time tie, and deterministic hashes;
18. healthy managed run remains ineligible for Attention;
19. dependency-hash tamper rejection;
20. raw SHA/login/branch/prompt/path privacy sentinels;
21. rollout-off baseline byte equivalence;
22. Current Focus `FOCUS-DEV-005` exact-identity top-switch bridge; and
23. `FOCUS-DEV-009` context-only insufficient-identity adjudication.

Acceptance requires zero candidate-universe changes, eligibility diffs,
context-only leakage, bot/merge leakage, stale/terminal resurrection,
dependency-tamper acceptance, deterministic-hash failures, and privacy
sentinel leakage. Before any applied mode, run baseline and candidate against
the same frozen input and record both run IDs.

Done when all case inputs are materialized, reviewer decisions are stored
separately from automatic verdicts, and a new dataset version/hash is frozen
without overwriting the mutable Dev Candidate.

### Stage 7 — Human-gated rollout and optional Attention effect

- Complete independent review of all 13 Current Focus cases.
- Require two independent reviewers and adjudication for `FOCUS-DEV-005`.
- Resolve the exact expected status for `FOCUS-DEV-009` and narrow its evaluator.
- Approve confirmation scope, TTL, terminal behavior, expiry fallback, and
  retention.
- Complete an Engine Change Record and Release Decision Record with code
  provenance, frozen dataset hash, baseline/comparison run IDs, metrics,
  privacy impact, rollout, rollback, and human approver/time.
- Roll out `shadow → observation present → Focus context present → resume offer`
  independently.
- Keep `attentionEffectMode=off` unless a separate release decision approves
  applied-selection v0.1. Even then it may reorder only already eligible,
  same-safety-tier candidates.

Done when every enabled mode has its own kill switch and monitored rollback,
and no human gate is represented by an AI verdict or implicit production
feedback.

## 8. Task breakdown

| ID | Owner suggestion | Task | Depends on | Risk | Required validation |
|---|---|---|---|---|---|
| `RWC-001` | planner/product | Decide TTL, UX, terminal, retention, and escalation boundary | none | high | Signed decision record |
| `RWC-002` | implementer | Add v0.1 contracts, canonical IDs/hashes, and rollout parser | `RWC-001` | medium | Schema, hash, flag-off tests |
| `RWC-003` | implementer | Add GitHub v7 and provenance normalizer with legacy readers | `RWC-002` | high | Connector/privacy/compatibility tests |
| `RWC-004` | implementer | Build push observation projector and exclusions | `RWC-003` | high | TTL, partial, bot, merge, determinism tests |
| `RWC-005` | implementer | Build exact continuation resolver and dependency sealing | `RWC-004` | high | Identity, tamper, rebind, terminal tests |
| `RWC-006` | implementer | Add Current Focus and applied-selection shadow sidecars | `RWC-005` | high | Candidate/eligibility/result-hash invariants |
| `RWC-007` | implementer | Add optional public projections and explicit resume offer | `RWC-005` | medium | TS/Swift decode, race, privacy tests |
| `RWC-008` | implementer | Add materialized Dev Candidate, evaluator, monitor v0.7, replay v4 | `RWC-006`, `RWC-007` | high | Same-input replay and metrics |
| `RWC-009` | qa_reviewer | Review safety, privacy, compatibility, and rollback | `RWC-008` | high | QA report with no open blocker |
| `RWC-010` | human reviewers | Review/freeze datasets and approve staged rollout | `RWC-009` | critical | Approval record and frozen hash |
| `RWC-011` | implementer | Apply only the specifically approved modes | `RWC-010` | critical | Targeted baseline, typecheck, lint, build, UI tests |

No task may skip directly to `RWC-011`. Production observations, automatic
scores, and this document are not human approval.

## 9. Expected file map

- Versions and normalized source contracts:
  `src/crossSource/versions.ts`, `src/crossSource/schema.ts`,
  `src/connectors/github/types.ts`, `src/connectors/github/githubApi.ts`,
  `src/connectors/github/toWorkSignals.ts`
- New sidecars:
  `src/recentWorkContinuation/contracts.ts`,
  `src/recentWorkContinuation/projectPushObservations.ts`,
  `src/recentWorkContinuation/resolveContinuationContexts.ts`,
  `src/recentWorkContinuation/resolveContinuationOffers.ts`
- Existing exact identity and authority inputs:
  `src/recentEvents/projectRecentMeaningfulEvents.ts`,
  `src/resumption/contracts.ts`, `src/relations/contracts.ts`,
  `src/artifacts/contracts.ts`, `src/claims/contracts.ts`,
  `src/currentFocus/*`
- Public surfaces:
  Work Cockpit response projection, `src/launcher/*`, and macOS launcher models
  and presentation
- Evaluation:
  `eval/synthetic/recentWorkContinuationCases.v0.1.json`, a fully materialized
  fixture set, `src/evaluation/recentWorkContinuationEvaluation.ts`, targeted
  TypeScript/Swift tests, and private `.local/evaluations/` run artifacts
- Records:
  `docs/CURRENT_FOCUS_PHASE2_REVIEW.md`, `docs/ENGINE_CHANGE_RECORD.md`, and the
  root `docs/ENGINE_DEVELOPMENT_RECORDS.md`

## 10. Release gate checklist

- [ ] GitHub provenance is source-native or `unknown`; no heuristic human/merge claim.
- [ ] All exact identity and dependency hashes are sealed.
- [ ] Partial evidence never proves absence or nonterminal state.
- [ ] General/healthy Codex sessions remain outside the candidate universe.
- [ ] Flag-off Active Attention input/result/hash is unchanged.
- [ ] Public/API/monitor/launcher privacy sentinels are zero.
- [ ] New synthetic inputs are materialized before dataset freeze.
- [ ] Baseline and candidate use the same frozen dataset SHA-256.
- [ ] `FOCUS-DEV-005` and `FOCUS-DEV-009` have required human decisions.
- [ ] UX, 24-hour TTL, terminal, expiry, and retention policies are approved.
- [ ] Engine Change and Release Decision Records are complete.
- [ ] Each enabled layer has an independent rollback control.

Until every applicable item is complete, the maximum permitted state is
shadow observation with no Focus, resumption, ranking, or Attention effect.
