# Blabase Screen Evidence Ingestion V1

## Goal

Define the additive, Blabase-owned ingestion boundary for privacy-minimized screen
evidence. This boundary lets the A/B/C evaluation vary only the evidence source
while preserving one Blabase suggestion engine and one output contract.

## Status

- Status: the additive private ingestion, immutable store, exporter, and completed
  four-file bundle implementation is **complete, inactive, unfrozen, and
  unwired**. No production activation or runtime caller exists.
- This document is a design and implementation-status contract, not an activation
  record or freeze approval.
- Dayflow is design provenance only. The boundary has no dependency on a Dayflow
  repository, runtime, Xcode project, database, or exporter.
- The private schema, byte validation, qualifier, importer, reader, immutable
  store, exporter, and completed-bundle publication are implemented under
  `suggestion/src/screenEvidence/`.
- The initial additive checkpoint passed focused Vitest 44/44, TypeScript, lint,
  architecture dependency, architecture model, and full architecture checks.
- The authoritative current checkpoint passed focused Vitest 47/47, TypeScript,
  lint, architecture dependency, architecture model, and full architecture
  checks after the bounded-read correction.
- Bounded-read closure QA is **GO**. It found no new Critical, High, or Medium
  finding. This technical result does not wire, activate, freeze, cut over, or
  approve production use.
- The authoritative 47/47 result applies to the ingestion checkpoint only. The
  store/exporter implementation does not inherit that result.
- Before the final selector closure changes, the store/exporter focused baseline
  passed Vitest 70/70, TypeScript, and lint; the dependency check reported zero
  errors and the newly introduced cycle was removed. This is prior baseline
  evidence, not validation of later changes.
- The final closure validation passed focused Vitest 72/72 across two files:
  ingestion 47/47 and Store+Exporter 25/25. TypeScript and lint passed;
  architecture dependency checking passed with zero errors and only pre-existing
  warnings, and the new exporter/internal cycle is absent.
- The selector cumulative 32 MiB exact/one-over recheck and
  `capturedAtEpochMs <= reviewedAtEpochMs <= asOfEpochMs` rule are validated by
  that final closure checkpoint.
- Actual post-link/process-kill disk-crash evidence, hard-link recovery,
  hostile-intrinsic hardening, destructive cleanup, A/B/C wiring, and production
  activation remain pending.
- The production store paths now use the internal
  `accumulatePrivateScreenEvidenceBudgetV1` helper and the private publisher uses
  `publishScreenEvidenceBundleV1Internal` with an ordered publication-event and
  fault seam. The public limits and public publisher input/signature remain
  fixed. The final selector closure is focused-validated as stated above.
- Technical status is **GO** only for trusted-local, Colin-reviewed real
  evaluation Bundle assembly. Production activation and contract freeze remain
  **NO-GO** and require separate gates.
- The Blabase cross-repository runner and package-script cleanup is complete. The
  external Dayflow prototype cleanup remains separate and unapproved.
- This checkpoint provides an inactive private immutable store, pure export
  selection, canonical four-file exporter, preflight/current-reader readback,
  and metadata-only cleanup inventory. The inventory performs no deletion and
  is not cleanup or retention authority.
- This checkpoint does not provide a native capture/OCR/preprocessing producer,
  destructive cleanup or retention authority, authentication, encryption,
  contract freeze, A/B/C engine wiring, or production activation.
- `architecture/model.c4` records the implemented private ingestion, immutable
  store, exporter, and completed-bundle format as inactive, unfrozen, and
  unwired. Future capture/preprocessing, destructive cleanup, protection,
  freeze, A/B/C wiring, and activation remain in `architecture/planned.c4`.
- Historical Dayflow artifacts, identities, hashes, and experiment records remain
  unchanged for reproducibility. They are not aliases for this contract.
- None of this evidence wires, activates, freezes, cuts over, or approves the
  boundary for production use.

## Assumptions

- Blabase will own every production component that captures, stores, preprocesses,
  exports, verifies, or imports screen evidence.
- Capture and storage may reuse architectural ideas learned from Dayflow, but no
  Dayflow implementation is part of the trust or execution boundary.
- Screen evidence is observational input. It must not contain a precomputed
  suggestion or otherwise bypass the shared Blabase engine.

## Fixed identities

The following values are exact and versioned independently:

| Purpose | Identity |
| --- | --- |
| Bundle schema | `blabase.screen-evidence-bundle.v1` |
| Manifest schema | `blabase.screen-evidence-manifest.v1` |
| Producer | `blabase.screen-evidence-producer.v1` |
| Preprocessing | `blabase.screen-evidence-preprocessing.v1` |

No Dayflow identity is accepted as a compatibility alias.

## Exact four-file envelope

A V1 bundle contains exactly these four relative paths and no others:

1. `payload.json`
2. `manifest.json`
3. `manifest.sha256`
4. `COMPLETE`

`payload.json` and `manifest.json` use canonical JSON bytes with no trailing
newline. The manifest binds the payload and required identities. The hash and
completion files bind publication integrity according to the implemented V1
contract; their exact byte grammar is authoritative in that contract and must be
validated before freeze. Missing, duplicate, renamed, absolute, traversal, or
additional paths make the envelope invalid.

## Evidence contract

### Allowed evidence

The payload may contain only privacy-minimized observations needed by the shared
suggestion engine:

- Stable bundle, capture, capture-revision, record, and preprocessing identifiers.
- Capture instants or bounded capture intervals.
- Normalized app, screen, and activity observations.
- Privacy-minimized OCR text or privacy-minimized text spans.
- Evidence confidence, coverage, and observation quality.
- Provenance and preprocessing-version references.
- Explicit missing-data, conflict, and processing-issue records.

Every exported observation must reference one immutable capture revision. All
referenced identifiers must resolve exactly within the bundle or to an explicitly
allowed external structured-evidence reference. Ambiguous, missing, duplicate, or
unreferenced records fail reference closure.

### Forbidden content

The envelope must not contain:

- Raw screenshots, frame bytes, thumbnails, or unminimized OCR output.
- Credentials, tokens, secrets, usernames, email addresses, private filesystem
  paths, unrelated personal content, or source-database rows.
- Final suggestion titles, summaries, bodies, actions, or output paths.
- `semanticOutput`, `RECENT_FOCUS`, `VISIBLE_TASK_INTENT`, or equivalent semantic
  labels that pre-decide a suggestion.
- Suggestion ranks, final caveats, recommendation scores, or engine decisions.
- Provider prompts, model responses, private reasoning, or downstream output
  schema objects.

Unknown fields are not forward-compatible evidence. They must be rejected or
introduced through a separately reviewed version.

## Integrity and lifecycle rules

- Capture revisions are immutable. Corrections create a new revision and preserve
  provenance to the prior revision.
- `PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.snapshotBytes` is a cumulative snapshot
  byte limit enforced before each record is appended. `inventoryEntries` is one
  global scanned-and-emitted budget for a cleanup inventory operation; it is not
  reset per directory or result page.
- Production snapshot and inventory paths pass their frozen limits into
  `accumulatePrivateScreenEvidenceBudgetV1` from
  `privateScreenEvidenceBudgetsV1.internal.ts`. Limit failures use the internal
  `PrivateScreenEvidenceBudgetErrorV1`; the helper is not a caller-selectable way
  to weaken the public limits.
- Public `selectPrivateScreenEvidenceForExportV1` now cumulatively rechecks the
  selected stored canonical byte lengths through internal `accumulateStoreBudget`
  and `accumulatePrivateScreenEvidenceBudgetV1`, using the frozen
  `PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.snapshotBytes`. A one-over result is
  `PrivateScreenEvidenceStoreErrorV1` with
  `issueCode === "RESOURCE_LIMIT_EXCEEDED"`. Exact 32 MiB and one-over behavior
  are validated by the final focused checkpoint.
- Exact identifier selection and reference closure occur before publication.
- Selection input and output explicitly record `asOfEpochMs`. A
  `delete_after_retention` record is expired when `asOfEpochMs` is equal to or
  greater than its retain-until instant. `retain_under_hold` overrides that
  expiry rule and remains selectable when its other eligibility conditions pass.
- Every otherwise selectable stored revision requires exactly one approved
  `PrivateScreenEvidencePrivacyReviewReceiptV1`. The receipt uses
  `PRIVATE_SCREEN_EVIDENCE_PRIVACY_REVIEW_RECEIPT_SCHEMA_V1` and contains exactly
  `schemaVersion`, `captureId`, `revision`, `storedRawSha256`, the fixed contract
  `privacyProfile`, the `approved` decision, `reviewId`, and
  `reviewedAtEpochMs`. Its capture, revision, and `storedRawSha256` bind it to the
  exact stored raw revision, and `reviewedAtEpochMs` must not be later than
  `asOfEpochMs`.
- Selection now requires
  `stored.record.capture.capturedAtEpochMs <= receipt.reviewedAtEpochMs <= selection.asOfEpochMs`.
  Equality is allowed at both boundaries; a violation is `SELECTION_INVALID`.
  This temporal closure is validated by the final focused checkpoint.
- Approved receipts are preserved in canonical record order inside the private
  selection result. They are selection-authority evidence and are not copied
  into the public four-file Screen Evidence bundle.
- Canonical bytes and cryptographic hashes bind the envelope; decoded-object
  equality alone is insufficient.
- Confidence, coverage, conflicts, omissions, and processing issues remain visible
  to downstream evaluation and must not be silently normalized away.
- Export selection and cleanup inventory are separate authorities. Export includes
  only evidence-eligible revisions; cleanup still covers the complete safe
  persisted inventory subject to retention policy.
- The implemented cleanup inventory is a read-only metadata enumeration. It does
  not decide retention, establish deletion eligibility, delete files, or issue
  deletion evidence; those destructive capabilities remain planned.
- Cleanup inventory content remains private and must not be logged or exposed.
  Redaction and logging-boundary evidence are pending, so no downstream consumer
  may treat inventory metadata as safe telemetry.
- An ordinary safe project root is allowed when it is a canonical, non-symlink
  directory owned by the current user and is not group- or world-writable;
  ordinary `0755` and private `0700` roots are both valid. `.local` and every
  descendant directory remain private `0700`, store files remain `0600`, and
  creation of each child directory fsyncs its parent.
- `COMPLETE` is the final publication boundary. It is staged through the same
  immutable-directory temporary-file discipline, fsynced, read back, and then
  atomically published last with a no-clobber hard link.
- `publishScreenEvidenceBundleV1.internal.ts` provides the private
  `publishScreenEvidenceBundleV1Internal` seam. Its ordered event kinds cover
  `DIRECTORY_CREATED`, `PAYLOAD_COMMITTED`, `MANIFEST_COMMITTED`,
  `MANIFEST_MARKER_COMMITTED`, `BEFORE_COMPLETE`, `COMPLETE_COMMIT_STARTED`,
  `COMPLETE_COMMITTED`, and `BEFORE_FINAL_READBACK`. The private event sink,
  options, and `PrivateScreenEvidencePublicationFaultV1` exist only for bounded
  internal fault evidence and do not expand the public publisher input.
- These names represent trusted in-process ordered boundary events, not proof
  that an operating-system process was killed or that a disk commit completed at
  the corresponding label. In particular, `COMPLETE_COMMIT_STARTED` is not an
  actual-crash durability oracle.
- A failure before `COMPLETE_COMMITTED` is a pre-commit failure: no valid
  completion may be reported and readers/importers must reject the partial
  publication. A failure after `COMPLETE_COMMITTED` is a post-commit failure:
  the committed bundle must not be rolled back or overwritten, and the public
  publisher reports `POST_COMPLETE_FAILURE` so a fresh reader can determine the
  committed state.
- Canonical record order and exported conflict/issue order are locale independent.
  The implementation compares code units with `<` and `>` rather than
  `localeCompare`.
- Bundle deletion does not by itself prove source-capture deletion. Each storage
  layer requires its own retention and deletion evidence.

## Shared-engine A/B/C rule

| Arm | Evidence input |
| --- | --- |
| A | Structured evidence only |
| B | Structured evidence plus Screen Evidence V1 |
| C | Screen Evidence V1 only |

After evidence assembly, all arms must use the same Blabase input adapter, model,
prompt, configuration, ranking, guardrails, suggestion engine, and output schema.
There is no B post-generation string merge and no C-specific generator or
renderer.

## Technical approach

1. Keep the V1 schema, byte validation, qualifier, importer, reader, immutable
   store, exporter, and completed-bundle publication inside
   `suggestion/src/screenEvidence/` as an implemented private, additive boundary
   that remains inactive, unfrozen, and unwired.
2. Validate the new store/exporter checkpoint with synthetic, privacy-safe
   fixtures without treating the earlier ingestion 47/47 result as coverage.
3. Keep exercising the entire boundary only with synthetic, privacy-safe fixtures until Colin
   separately approves a freeze and any later activation or wiring gate.
4. Implement the Blabase-owned native capture/OCR/preprocessing producer,
   destructive cleanup and retention authority, authentication, encryption,
   freeze, and activation only in later, separately approved checkpoints.
5. Keep the pure exporter selection limited to evidence-eligible exact immutable
   snapshots while the read-only metadata inventory covers all safely persisted
   revisions independently of export eligibility.
6. Allow ingestion to consume only a completed four-file bundle. It must not read
   the source capture store directly.
7. Wire qualified evidence into the common A/B/C input adapter only after the
   ingestion and producer boundaries are validated.
8. Preserve old Dayflow-named identities, hashes, and records as historical
   evidence. External Dayflow prototype cleanup requires separate approval.

## Task breakdown and gates

These gates are separate and none authorizes the next:

1. **Implementation — complete:** the private V1 contract and synthetic fixtures
   exist, but are not wired or active.
2. **Initial validation — complete:** focused Vitest passed 44/44; TypeScript,
   lint, architecture dependency, architecture model, and full architecture
   checks passed.
3. **Bounded-read correction and closure QA — complete:** focused Vitest passed
   47/47; TypeScript, lint, architecture dependency, architecture model, and full
   architecture checks passed; closure QA is GO with no new Critical, High, or
   Medium finding.
4. **Private store and exporter implementation — complete, validation pending:**
   immutable exact revision write/read/snapshot, pure export selection,
   metadata-only cleanup inventory, canonical four-file publication, and
   preflight/current-reader readback are implemented. The production-used budget
   helper and private ordered publication fault seam are also implemented. The
   pre-closure baseline passed focused Vitest 70/70, TypeScript, lint, and the
   dependency gate. All remain inactive, unfrozen, and unwired.
5. **Final closure validation — complete:** focused Vitest passed 72/72 across
   ingestion 47/47 and Store+Exporter 25/25; TypeScript and lint passed; the
   dependency check passed with zero errors, only pre-existing warnings, and no
   new exporter/internal cycle. The cumulative 32 MiB selector recheck,
   capture/review/as-of temporal closure, genuine child-process contention,
   loser-temp absence, unmixed winner, fresh-process readback, and ordered
   boundary-event `COMPLETE` evidence are validated.
6. **Producer and lifecycle authorities — planned:** implement Blabase-owned
   native capture/OCR/preprocessing, destructive cleanup and retention,
   authentication, encryption, contract freeze, and production activation.
7. **A/B/C wiring — planned:** connect qualified ingestion output to the common
   input assembler without changing the shared engine.
8. **Cross-repository cleanup — partial:** the Blabase runner and package script
   are removed; external Dayflow prototype cleanup is separate and unapproved.
9. **Colin approval:** decide whether to freeze, activate, revise, or roll back.

## Files likely to change in later checkpoints

- `suggestion/src/screenEvidence/` now also contains the private store contract,
  filesystem boundary, immutable store operations, read-only cleanup inventory,
  exporter, and completed-bundle publication.
- `suggestion/tests/` for synthetic contract, hostile-input, reference-closure,
  privacy, bounded-read, and shared-engine tests.
- Blabase-owned native capture/OCR/preprocessing, destructive cleanup and
  retention authority, authentication, encryption, freeze, and activation
  modules in separately approved implementation checkpoints.
- A/B/C input assembly files only during the separately approved wiring gate.
- `architecture/model.c4` records the implemented private ingestion, store,
  exporter, and completed-bundle format even while they remain inactive,
  unfrozen, and unwired. `architecture/planned.c4` remains authoritative for the
  unimplemented producer and lifecycle authorities and future wiring.

No existing Dayflow document, source file, or historical hash is rewritten by
this checkpoint.

## Testing strategy

The initial additive checkpoint passed focused Vitest 44/44. After the
bounded-read correction, the authoritative current checkpoint passed focused
Vitest 47/47, TypeScript, lint, architecture dependency, architecture model, and
full architecture checks. Bounded-read closure QA is GO with no new Critical,
High, or Medium finding. A later store/exporter baseline passed focused Vitest
70/70, TypeScript, lint, and dependency checking with zero errors and removal of
the new dependency cycle. The final closure command
`npm test -- tests/screenEvidenceBundleV1.test.ts tests/screenEvidenceStoreExporterV1.test.ts`
then passed two files and 72/72 tests: ingestion 47/47 and Store+Exporter 25/25.
`npm run typecheck` and `npm run lint` passed. `npm run arch:deps:check` passed
with zero errors and only pre-existing warnings; the new exporter/internal cycle
is absent. Before freeze, the complete validation evidence must continue to
cover:

- The exact four-file envelope and fixed identities.
- Canonical no-newline JSON, manifest/hash binding, and completion semantics.
- Missing, additional, duplicate, traversal, malformed, and noncanonical files.
- Immutable revision and exact reference-closure failures.
- Allowed-field exactness and forbidden suggestion-bearing/private fields.
- Confidence, coverage, conflict, omission, and issue preservation.
- Separation of export selection from cleanup inventory.
- Immutable exact revision write/read/snapshot behavior, collision rejection,
  metadata-only inventory semantics, pure selection, atomic publication, and
  preflight/current-reader readback.
- Aggregate snapshot and inventory resource limits, explicit selection time,
  equality expiry with hold precedence, and exact raw-hash privacy-review receipt
  binding.
- Direct small-trusted-limit tests of
  `accumulatePrivateScreenEvidenceBudgetV1`: zero, exact, and one-over limits;
  negative deltas and unsafe arithmetic; cumulative snapshot bytes; one global
  scanned-plus-emitted inventory budget; and typed
  `RESOURCE_LIMIT_EXCEEDED` results. Public limit values must remain unchanged.
- Safe ordinary project roots versus strict `.local` privacy modes, last-file
  `COMPLETE` publication, and locale-independent ordering.
- Genuine child-process store and exporter contention using different canonical
  contents for the same revision or export run ID: one typed loser, one
  byte-exact winner, no mixed entries, and readback in a fresh process.
- An ordered boundary-event `COMPLETE` fault matrix at directory creation, after
  each of the first three committed files, at `BEFORE_COMPLETE`, at
  `COMPLETE_COMMIT_STARTED`, and after `COMPLETE_COMMITTED` but before final
  readback. This in-process event evidence must distinguish pre-commit rejection
  and absent `COMPLETE` from post-commit behavior while preserving an existing
  winner byte-for-byte; it must not be described as an actual process-kill or
  disk-commit test.
- The genuine operating-system child-process Store/Export contention fixtures
  passed with different contents, typed loser behavior, loser temporary-entry
  absence, one unmixed winner, and fresh-process readback.
- The ordered boundary-event `COMPLETE` matrix passed. It is trusted in-process
  event evidence only and is not actual process-kill or disk-crash evidence.
- Actual post-link/process-kill crash evidence and a public-path
  `POST_COMPLETE_FAILURE` test remain pending.
- Hard-link recovery and hostile replacement of platform intrinsics remain
  pending even after the bounded helper, child-process, and fault-matrix tests.
- A/B/C input differences with identical downstream engine configuration and
  output schema.

Passing those checks does not wire, activate, freeze, cut over, or approve
production use. Technical evidence informs Colin's decision but does not replace
it.

## Privacy and retention impact

- The boundary reduces exposure by accepting minimized observations rather than
  raw captures, but OCR text remains potentially sensitive.
- Capture consent, minimization policy, local encryption, access control,
  retention duration, deletion receipts, and lawful-use records remain required
  before real-user data is permitted.
- The implemented store and exporter do not make encryption, authentication,
  retention decisions, destructive deletion, or production access controls
  complete; those authorities remain planned.
- Raw captures and source-store cleanup must be governed outside the exported
  evidence bundle. No production conversation or capture becomes Gold evidence
  without explicit review and anonymization.

## Risks

- A producer could satisfy file integrity while leaking private text unless field
  minimization and hostile-input validation are enforced independently.
- Historical Dayflow terminology may be mistaken for a runtime dependency until
  all inactive legacy experiments and separately approved external prototypes are
  clearly distinguished from the Blabase-owned runtime boundary.
- Divergent B or C generation paths would invalidate the comparison even if the
  ingestion contract is correct.
- Premature compatibility aliases would preserve the dependency this boundary is
  intended to remove.

## Open questions and follow-ups

- Validate and conduct bounded QA on the new private store and exporter.
- Add cross-process, crash fault-injection, hard-link recovery, and
  hostile-intrinsic hardening evidence before any freeze decision.
- Validate cleanup-inventory redaction and logging boundaries while keeping the
  inventory private.
- Implement destructive cleanup and retention authority independently from the
  implemented metadata-only inventory and pure export selection.
- Select the native capture platform and determine whether that Blabase-owned
  component requires Xcode.
- Freeze concrete resource limits and the exact `manifest.sha256` and `COMPLETE`
  byte grammar through a separately approved freeze checkpoint.
- Define consent, retention duration, deletion receipts, and operator controls.
- Implement shared input assembly, then seal one evaluation bundle and run A/B/C.
- Generate the comparison report for Colin; do not treat automated QA as Colin's
  approval.
