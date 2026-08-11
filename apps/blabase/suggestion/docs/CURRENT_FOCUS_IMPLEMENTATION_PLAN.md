# Current WorkStream and Current Focus implementation plan

Status: Phase 1 shadow implementation and verification complete  
Target: `suggestion/` Work Cockpit and Attention Lab  
Out of scope: legacy ChatGPT suggestion engine

## 1. Product boundary

Current Focus answers **what the user was most recently working on**. Active
Attention answers **where the user should intervene next**. They are separate
projections and may legitimately disagree. A healthy managed Codex run can be
Current Focus while Active Attention returns no action.

The new path is deterministic and does not use an LLM or add a production
dependency:

```text
GitHub RuntimeWorkSignalBatch + managed Codex direct evidence
  -> Recent Meaningful Event projection
  -> exact-identity WorkStream reconstruction
  -> Current Focus projection
  -> existing claim authority and eligibility
  -> focus-aware Active Attention shadow comparison
  -> Work Cockpit / Attention Lab
```

`ConnectorTimeline` is display-only and is never an engine input. Notion and
Google Calendar remain context-only and cannot create an event, WorkStream,
Focus, blocker, owner, completion state, eligibility decision, lane, or
Attention candidate.

## 2. Evidence boundary

The request-time input is captured at the existing managed authority lease. A
projection must bind the exact:

- `asOf`;
- GitHub source snapshot and normalized batch hashes;
- optional Codex inventory source snapshot and batch hashes;
- managed public revision/generated time and semantic projection hash;
- managed run-start map hash;
- work-relation, artifact-relation, and claim-authority hashes;
- project registry hash when available; and
- schema, normalizer, reconstruction, currentness, selection, and shadow
  ranking policy versions.

Any mismatch rejects that Focus input. The live orchestrator converts this to
a sanitized unavailable/unresolved Focus sidecar and preserves the existing
Active Attention result.

## 3. Recent Meaningful Event rules

Events have a stable opaque ID, source, opaque native subject reference,
`projectId | null`, kind, `occurredAt`, `observedAt`, nullable
`sourceUpdatedAt`, explicit time basis, freshness/completeness, semantic role,
evidence reference, source snapshot/batch hash, and normalizer/rule version.

Ordering is newest `occurredAt` first. Equal times are ordered canonically by
source, kind, then stable event ID. Canonical ordering is used for replay and
hashing; an equal latest time across different eligible WorkStreams causes
abstention rather than an arbitrary semantic winner.

Supported direct GitHub event evidence in v0.1:

- authenticated-user push;
- Issue/PR open, reopen, and close;
- PR merge;
- review performed, including a direct `changes_requested` review state; and
- current authored-PR CI failure, changes-requested, or merge-conflict state
  only when the point-in-time actionability observation is complete. Such a
  state is labelled as a state observation, not a reconstructed transition.

GitHub v6 converts a raw push commit SHA to an opaque artifact ID during
normalization and discards the raw SHA before persistence. Artifact Relation
v0.1 intentionally continues to report commits as `not_observed`; only the
separate Recent Event projection may accept a push after cross-checking the
same v6 batch/repository opaque ID, an active explicit artifact attribution,
and an exact active work relation. This preserves the existing Artifact,
Eligibility, Active Attention, and replay-v2 hash boundary.

The v6 activity contract canonicalizes Issue/PR lifecycle identity to the
same Issues REST object ID used by task bindings. It reuses an exact current
task mapping or performs at most 25 authenticated issue lookups at concurrency
four. A failed or capped lookup marks activity coverage partial/truncated and
omits the event. The raw PullRequestEvent ID is discarded and the canonical ID
is never exposed raw in the Focus API. This keeps the explicit binding,
attributed push, managed execution, and close/merge event in one WorkStream
after an open-only task disappears from the current task list. v5 remains
readable through frozen normalizer v0.5, but its pre-canonical PR event ID is
not trusted as a disappeared-task native bridge.

Supported managed Codex evidence in v0.1:

- explicit managed-run start;
- direct turn start, completion, failure, or interruption;
- direct managed-run failure or close; and
- directly verified waiting-on-approval or waiting-on-user-input state when
  the evidence window is complete, continuous, monotonic, and live.

Managed evidence currently has collector observation time but no native
source timestamp. It therefore uses `occurredAt = observedAt` with an explicit
collector-observed time basis and does not invent `sourceUpdatedAt`.

Codex inventory/history can contribute only bounded project-level historical
context. It cannot select Current Focus, prove live execution or blockers, or
create an Attention candidate.

Excluded or downgraded observations include polling, heartbeat/stream noise,
page or list loading, repository `updatedAt`, generic task `updatedAt`, repeated
identical errors, managed item activity without an outcome, and unsupported
state transitions.

Repeated managed failure observations are deduplicated only when their
privacy-safe failure fingerprint is identical, their sequence gap is at most
three, and they occur within 60 seconds. The projection retains the newest
1,000 meaningful events and 2,000 diagnostics and reports explicit omitted
counts instead of failing implicitly at the retention boundary.

The current connector contracts do not provide a trustworthy transition time
for review-request changes, CI recovery, merge-conflict recovery, or
command/test outcomes. v0.1 records these limitations and never infers them
from titles, command text, disappearance from a snapshot, or time proximity.

## 4. WorkStream reconstruction

Task-level grouping is allowed only through:

- the same native GitHub object identity;
- the same managed execution identity;
- an active explicit-user Codex-GitHub work relation;
- an active explicit-user binding; or
- a verified artifact relation.

Project mapping alone creates only a project-level WorkStream. It is not an
edge between distinct task identities. Title, sentence, path, repository
label, prompt similarity, and timestamp proximity are never grouping inputs.

A WorkStream exposes a stable opaque ID, project ID, opaque related identity
references, latest meaningful event, bounded historical event references,
authoritative state, blocker, owner, completion, currentness/completeness,
relation evidence, confidence, reason codes, and a projection SHA-256. Claim
authority remains authoritative for current state; historical events cannot
reopen a merged, closed, cancelled, or otherwise ineligible item.

GitHub Issue/PR lifecycle events use a canonical repository/type/number subject
anchor before transient open-state claims. The WorkStream ID therefore remains
stable across open → close/merge and an unexpired explicit Focus confirmation
continues to resolve after that lifecycle transition.

Selection is lexicographic by the latest qualified event. Historical event
scores are never added, so many old observations cannot outrank one newer
qualified event.

## 5. Current Focus policy

Phase 1 uses the following order:

1. an unexpired explicit confirmed Focus input, when supplied;
2. otherwise the WorkStream with the uniquely latest fresh, complete, direct,
   identity-safe event;
3. abstain on stale/partial evidence, identity or authority conflict, source
   gaps/clock regression, or an unresolved latest-time tie; and
4. return project-level Focus only when the evidence proves a project but not
   a task.

A terminal latest event may still describe what the user just finished, but
the WorkStream retains its authoritative completed/cancelled state. Focus can
never reopen it or return it to the Attention candidate universe.

The initial recent window is a versioned seven-day hypothesis. It is not a
sum-based decay score. Project-level Focus is displayed and can be measured in
shadow diagnostics; exact task match remains the stronger ranking signal.

If Focus is unavailable or unresolved, existing Active Attention is preserved.

## 6. Shadow ranking

Phase 1 never changes `ActiveAttentionInput`, the Active Attention candidate
universe, gate results, lane, selected result, or result hash. It records:

- the existing top candidate;
- the counterfactual top candidate;
- exact/project/no-match classification for existing eligible candidates;
- total and omitted match counts when detailed diagnostics exceed 100 rows;
- whether the counterfactual would switch the top; and
- `attentionSelectionEffect = "none"`.

Only candidates already present in `ActiveAttentionResult.rankedCandidates`
are considered. Focus cannot create or restore a candidate. Reordering is
confined to the same existing safety tier so Focus cannot cross lane, native
deadline, or direct-blocker/specificity boundaries. Within that tier the
order is exact WorkStream match, project match, no match, then the original
stable Active Attention order.

Phase 2 may activate this ordering behind a versioned feature flag only after
targeted baseline and human review. Rolling back disables the Focus sidecar
and ranking policy while leaving the existing Active Attention path intact.
GitHub v6/v5/v4 snapshot readers remain enabled so rollback never strands an
already persisted connector snapshot.

## 7. Public projection and retention

The public/API/monitor projection must not contain credentials or tokens,
absolute local paths, raw Codex thread IDs, raw command/prompt/conversation
content, private evidence payloads, or commit SHAs. Public identities are
opaque stable references. The Phase 1 projection is computed from already
retained local metadata and adds no source retention or remote telemetry.

Synthetic evaluation artifacts are stored only under `.local/evaluations/`
and contain no production conversation. Existing frozen datasets remain
immutable; Current Focus uses a separate mutable Dev Candidate version.

## 8. Required verification

The targeted suite covers:

1. recent Codex work, exact GitHub push relation, and current CI failure;
2. push followed by merged terminal state;
3. many old events versus one newer event;
4. heartbeat/polling exclusion;
5. same-title distinct identities without an exact relation;
6. healthy active managed run shown as Focus without a new candidate;
7. stale/truncated/partial abstention;
8. out-of-order, duplicate, and equal timestamp determinism;
9. Notion/Calendar context-only leakage zero;
10. completion, owner, authority conflict, and eligibility gates preserved;
11. input permutation invariance;
12. dependency-hash tamper rejection; and
13. public API/monitor privacy sentinels.

Evaluation records Current Focus precision, abstention accuracy,
context-only leakage, eligibility diff, stale/currentness violations,
top-switch precision, deterministic replay/hash, and privacy sentinel counts.
The acceptance target for all safety leakage/diff counters is zero.

## 9. Verification result

The final contract/rule ledger is:

- GitHub snapshot/native-activity normalizer: v6/v0.6; v5/v0.5 and v4/v0.4
  remain readable;
- Artifact Relation schema/resolver/evidence: v0.1/v0.1/v0.1 (unchanged);
- Recent Event schema/rule/ID: v0.2/v0.5/v0.2;
- WorkStream schema/reconstruction/currentness/ID: v0.1/v0.5/v0.1/v0.5;
- Focus schema/selection/ID: v0.1/v0.2/v0.1;
- shadow schema/ranking/resolver/rollout: v0.2/v0.1/v0.2/v0.1; and
- live orchestrator/monitor/failure/replay: v0.6/v0.6/v0.5/v3, with released
  replay v2 retained as an Active-only compatibility path.

The mutable synthetic Dev Candidate contains 13 bounded scenarios and no
production data. Its dataset SHA-256 is
`f595b6985ce0c5c957898f4cdaa536dca151f07a15f6cbb3c476f93f7a207277`;
the evaluation config SHA-256 is
`7bac6d17d0d786d025b50f65936d85a31d08b152ac6cd8edf2140b54722add89`.

Two independent deterministic runs passed 13/13 with identical dataset,
config, code fingerprint, per-case input hashes, projections, decisions, and
metrics:

- `current_focus_run_7dd3b05598a2190390e83c83baa1a114`;
- `current_focus_run_8e99c6863bb089999ffd4b57eb85bc2b`.

Their evaluation-time dirty-worktree code fingerprint was
`baf18ac4689c56ff2e7b6226d19f8b9ff7c6c0f6f8ef32be84dd207a69ee277c`.

Their stable payload—dataset, config, versions, code provenance, counts,
metrics, cases, privacy, comparison, review status, and limitations—is
identical with SHA-256
`ef8262628bf998cc773d15c43d0490d37097635c29f030332abd399c809144ab`.

Current Focus precision, abstention accuracy, and top-switch precision were
all `1.0`. Context-only leakage, eligibility diff, stale/currentness
violations, deterministic-hash failures, privacy sentinel leakage, and
accepted dependency tampering were all `0`. One of 13 cases produced an
intentional counterfactual top switch; actual Active Attention selection
changes remained `0`, with `attentionSelectionEffect = "none"`.

The unchanged Active Attention Dev Candidate baseline
`active_attention_eval_run_7eabf55c31cf3c97297da53002636f2b` passed 44/44,
and its materialized input/output hashes remain
`baa7a6ec69173b4207e4409b900519c3148ad06995726aad78f9e2d6ef79f940` /
`6ce881d595ab1476e95f33710c5ee7c6cd9be412d492b2b79daa26faf71c0d55`.
The unchanged Eligibility baseline
`attention_eligibility_run_9923b28ff65ce26ae897d598a11f77aa` passed 26/26
with zero projection-hash mismatches. Focused engine/monitor/evaluation
regressions passed 161/161, typecheck, lint, production
build, and the Work Cockpit browser E2E passed. The full Vitest run passed
853/854; its sole failure is an unrelated existing Codex conversation test
whose fixed 2026-07-29 fixture expired under the real-clock seven-day
retention policy on 2026-08-06.

## 10. Human decisions after Phase 1

No choice blocks the shadow implementation. Human approval is required before:

- enabling Focus-aware selection in Phase 2;
- freezing a Current Focus dataset;
- choosing the persistent create/change/clear UX and expiry policy for
  user-confirmed Focus; or
- extending source collectors to claim currently unsupported transitions.
