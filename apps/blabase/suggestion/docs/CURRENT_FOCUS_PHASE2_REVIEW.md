# Current Focus Phase 2 Human Review

Status: Draft - AI proposal, not human approval or a Golden decision  
Review run: `current_focus_run_8e99c6863bb089999ffd4b57eb85bc2b`  
Dataset: `suggestion-current-focus-dev-v0.2`, revision 1, mutable  
Automatic result: 13/13 passed, one counterfactual switch, zero actual selection changes  
Limitation: the recorded run used a dirty worktree and is not a formal release baseline

## Case review

| Case | Scenario | Recorded Focus result | Expected shadow switch | Safety assertion | AI-proposed verdict |
|---|---|---|---|---|---|
| `FOCUS-DEV-001` | `codex_push_ci_failure` | Selected; CI failure, `ci_failed`, one WorkStream | No | Combine only exact Codex, opaque push, and current CI evidence without changing candidate eligibility | Accept |
| `FOCUS-DEV-002` | `push_then_pr_merged` | Selected; merged PR, completed | No | Historical push cannot resurrect a terminal PR as an active candidate | Accept |
| `FOCUS-DEV-003` | `many_old_one_new` | Selected; latest reopened issue | No | Select the latest direct event rather than summing historical event volume | Accept |
| `FOCUS-DEV-004` | `heartbeat_after_meaningful` | Selected; managed Codex turn started | No | Heartbeat and stream noise cannot become meaningful events | Accept |
| `FOCUS-DEV-005` | `same_title_distinct_identity` | Selected; two WorkStreams, latest reopened issue | Yes; the only intended switch | Do not merge identical titles; move the exact identity only within the same safety tier | Conditional; human sign-off required |
| `FOCUS-DEV-006` | `healthy_managed_run` | Selected; healthy managed run | No | Healthy execution may be Focus but cannot create an Attention candidate | Accept |
| `FOCUS-DEV-007` | `stale_partial_source` | Unresolved; `FOCUS_SOURCE_PARTIAL` | No | Abstain on partial evidence rather than falling back to an older event | Accept |
| `FOCUS-DEV-008` | `out_of_order_duplicate_equal_time` | Selected; deterministic | No | Input order and duplicates cannot change WorkStreams, Focus, or hashes | Accept |
| `FOCUS-DEV-009` | `context_only_sources_recent` | Unresolved; `FOCUS_INSUFFICIENT_IDENTITY` | No | Notion, Calendar, and Codex inventory cannot create Focus or Attention | Defer; label adjudication required |
| `FOCUS-DEV-010` | `focus_cannot_override_gates` | Selected; open PR Focus | No | Focus cannot bypass terminal, owner, conflict, or eligibility gates | Accept |
| `FOCUS-DEV-011` | `input_permutation` | Selected; same top | No | Input permutation must preserve Focus, shadow top, and hashes | Accept |
| `FOCUS-DEV-012` | `dependency_hash_tamper` | Rejected | No | Dependency tampering must fail closed | Accept |
| `FOCUS-DEV-013` | `public_projection_privacy` | Selected; managed Codex turn started | No | Tokens, thread IDs, commands, paths, and commit SHAs cannot enter public output | Accept |

## FOCUS-DEV-009 adjudication

The dataset label is `expectedFocus="unavailable"`, but the recorded result is
`unresolved` with `FOCUS_INSUFFICIENT_IDENTITY`. The current evaluator treats
both as non-selection and therefore hides this semantic mismatch.

- [ ] Confirm `unresolved`: observations exist, but exact Focus identity is insufficient.
- [ ] Confirm `unavailable`: no Focus-capable direct input exists.
- [ ] Narrow the evaluator so only the approved expected status passes.
- [ ] Do not freeze this case until the decision is recorded.

AI recommendation: confirm `unresolved`, which matches the existing reason code
and distinguishes insufficient identity from absence of all usable input.

## FOCUS-DEV-005 human sign-off

- [ ] Reviewer A independently confirms that the identical-title issues are separate WorkStreams.
- [ ] Reviewer B independently reaches the same judgment without seeing Reviewer A's label.
- [ ] The newer exact issue identity is the appropriate Current Focus.
- [ ] The existing-top to focused-top switch is useful and not a false positive.
- [ ] The switch stays within the same lane, deadline, blocker, trigger, and certainty safety tier.
- [ ] Candidate universe change is false.
- [ ] Eligibility diff is zero.
- [ ] Phase 1 actual selection change is zero.
- [ ] Applying this switch under an explicit Phase 2 flag is approved.

```text
Reviewer A:
Decision: accept / reject / defer
Date:
Rationale:

Reviewer B:
Decision: accept / reject / defer
Date:
Rationale:

Adjudicator:
Final decision:
Date:
Adjudication reference:
```

## Confirmation UX and expiry policy

These are proposed defaults, not approved product decisions.

### Confirmation scope

- [ ] Exact WorkStream only (recommended)
- [ ] Project-level Focus
- [ ] Separate exact and project-level actions

### Default TTL

- [ ] Fixed 24 hours with no automatic renewal (recommended)
- [ ] Until the end of the local day
- [ ] Seven days
- [ ] Until explicitly cleared
- [ ] User-selected duration

### Terminal transition

- [ ] Keep the confirmation until TTL while showing completed/cancelled state (recommended)
- [ ] Clear immediately on completion or cancellation
- [ ] Ask the user whether to retain it

No option may resurrect a terminal WorkStream as an Attention candidate.

### Expiry fallback

- [ ] Recompute from current, direct, complete evidence (recommended)
- [ ] Stay unresolved until the user confirms again
- [ ] Show the expired confirmation as read-only history

### Required controls

- [ ] Focus this WorkStream
- [ ] Change Focus
- [ ] Clear Focus
- [ ] Display expiry time
- [ ] Visually distinguish explicit confirmation from inferred Focus

### Storage and audit

- [ ] Record confirmation create/change/clear as append-only decisions.
- [ ] Store only `workstreamId`, `confirmedAt`, `validUntil`, and integrity hashes.
- [ ] Exclude raw titles, URLs, prompts, commands, and local paths.
- [ ] Keep this contract separate from the seven-day Weekly Focus store.
- [ ] Decide retention for expired and cleared confirmations.

## Technical activation blockers

Phase 2 implementation must resolve these before activation:

1. Create a versioned applied-selection input/result. Seal the Current Focus
   hash, rollout mode, baseline result hash, reordered candidates, decision,
   alternatives, and result hash without mutating the Phase 1 result contract.
2. Reject Focus application when the artifact-relation dependency hash differs
   from the Active Attention evidence graph.
3. Prevent a terminal exact-task Focus from promoting an unrelated same-project
   candidate through project-level fallback.
4. Expand the safety tuple beyond lane, exact deadline, and trigger to preserve
   blocker class, certainty, and review status.
5. Add a new monitor/replay generation that records the flag, explicit
   confirmation, baseline result, applied result, and sanitized fallback reason.
6. Default the versioned rollout flag to shadow and fail closed to the
   byte-equivalent baseline on invalid configuration or dependency mismatch.
7. Materialize all 13 inputs before freezing so builder changes cannot alter
   evaluation inputs under an unchanged dataset hash.

## Recent Work projection v0.1 evaluation checkpoint

This is a separate review boundary from Current Focus Phase 2. The mutable
`suggestion-recent-work-projection-dev-v0.1` candidate contains 23 bounded
synthetic case records for the current repository-scope/display-only sidecar.
Its lifecycle fields remain `datasetSha256=null`, `immutableRef=null`, and
`frozenAt=null`. Mutable candidate run
`recent_work_run_9b9150ff2629744a1070846834df2cd5` recorded dirty-worktree
provenance, passed typecheck and the targeted 14-file/104-test suite, and passed
23/23 cases with 28/28 measured variants, zero failure/diff/privacy/effect
metrics, and all eight automatic gates true. The private artifact is recorded
under `.local/evaluations/recent-work-projection/`. Human review remains
`not_started`; there is no frozen dataset, formal comparison, improvement
claim, present rollout, Attention effect, or release approval.

- [x] Run targeted tests, typecheck, and `npm run recent-work:baseline` and
  record the mutable candidate result.
- [ ] Run lint or a clean-provenance evaluation if the eventual release review
  requires it; do not rewrite the historical dirty-worktree run.
- [ ] Review the 23 case definitions and the explicit upstream-filtered status
  of removed/archived mappings.
- [ ] Confirm project-level correlation is acceptable only as repository-scope,
  display-only context with all Attention and execution effects fixed to none.
- [ ] Review public timestamp canonicalization and privacy sentinel results.
- [x] Record code provenance and the generated private artifact; do not invent
  a frozen dataset SHA or comparison run.
- [ ] Keep default rollout at shadow. Present-mode approval, dataset freeze,
  and every full-continuation mode require separate human decisions.

This checkpoint does not provide actor/origin provenance, exact commit
equality, continuation observation/context/offer contracts, heartbeat or resume
actions, four independent rollout modes, applied selection, monitor v0.7, or
replay v4.

## Final human decision

```text
13-case review: approved / changes_required / rejected
FOCUS-DEV-009 label:
FOCUS-DEV-005 switch:
Confirmation scope:
Default TTL:
Terminal behavior:
Expiry fallback:
Retention:
Approver:
Approved at:
Notes:
```

Do not freeze the dataset or activate Phase 2 ranking until this review and the
required independent/adjudicated labels are complete.
