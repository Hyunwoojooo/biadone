# Common Suggestion Evidence Source Verification V0.4 Correction Proposal

| Field | Value |
| --- | --- |
| Proposal ID | `blabase-common-suggestion-evidence-source-verification-v0.4-correction-proposal` |
| Target future contract | `blabase-common-suggestion-evidence-source-verification-v0.4` |
| Historical predecessor | `blabase-common-suggestion-evidence-source-verification-v0.3` |
| Date and timezone | 2026-08-24, Asia/Seoul |
| Owner | Colin |
| Sole human reviewer and decision authority | Colin |
| Required David role | None |
| Status | `CORRECTED_PROPOSAL_PENDING_BOUNDED_RE_QA` |
| Runtime effect | None |
| Implementation approval | Not granted |
| Freeze approval | Not granted |

## 1. Decision boundary

This document proposes exactly two corrections:

1. Validate the privacy key and purpose-restricted privacy handle lifecycle before invoking any
   per-reference HMAC or requested/observed set-HMAC operation.
2. Clarify that a child runtime parent binding contains exactly four identity fields, while parent
   document byte length is external exact-byte evidence only.

This document is not a full Common V0.4 contract. It does not freeze bytes, approve implementation,
change runtime behavior, authorize GitHub, calculate a GitHub contract identity, or modify any
frozen V0.2 or V0.3 artifact.

### 1.1 Recorded Colin correction decision

After the initial bounded proposal QA reported two Medium findings, Colin explicitly selected the
recommended option on 2026-08-24. That decision approves the failure-category distinctions and
atomic proof-handle consumption sequence recorded in this corrected proposal. It authorizes this
proposal edit only. It does not approve re-QA, the future full Common V0.4 contract, identity,
freeze, implementation, GitHub correction, activation, or release.

After bounded re-QA found ambiguity in the V0.3 replacement delta and proof-table `not_found`
mapping, Colin again explicitly selected the recommended bounded correction on 2026-08-24. That
decision approves the step-by-step replacement and lookup-result distinctions below for proposal
correction only; it does not widen any later gate.

The current GitHub V0.3 proposal remains unfrozen and blocked from identity calculation, review,
freeze, implementation, or activation until a corrected Common parent completes its own proposal,
QA, Colin review, exact-identity, and freeze lifecycle.

## 2. Immutable historical evidence

The following Common V0.3 identities remain immutable historical evidence:

| Identity | Frozen value |
| --- | --- |
| Contract ID | `blabase-common-suggestion-evidence-source-verification-v0.3` |
| Document byte length | `88549` |
| Raw document SHA-256 | `3fa0d5944f3fa6623217d2f73362b7f2347c7a134eb37c7bf4f51e76873e6729` |
| Git-compatible blob SHA-1 | `676f52894a513a2d4b69b2915faf2e993a504213` |
| Freeze receipt | `ECR-STAGE10-2B3-COLIN-COMMON-V0-3-CONTRACT-FREEZE-2026-08-24` |
| Freeze commit | `12c54437086263525f1f5dcf5785cdd94aa05230` |

Common V0.3 and its external freeze receipt MUST NOT be edited. This proposal records a new-version
correction rather than silently changing the frozen contract or its audit history.

## 3. Confirmed V0.3 finding

### 3.1 Conflicting exact order

Common V0.3 defines lifecycle validity and expiry, revocation, and deletion boundaries for the
privacy key and handle. Its exact pre-callback sequence nevertheless places raw-identity commitment
and HMAC recomputation before privacy-key lifecycle validation.

The GitHub V0.3 proposal follows that sequence for per-reference and requested/observed set-HMAC
recomputation. A conforming implementation could therefore invoke a cryptographic operation with an
expired, revoked, deleted, missing, or wrong-purpose key and reject it only afterward.

An implementation that silently performs lifecycle validation inside the HMAC helper would avoid
that behavior but would add an unrecorded ordering rule outside the frozen exact sequence. The
contract must make the security boundary explicit instead.

### 3.2 Impact boundary

- This is a contract-ordering defect.
- No Common V0.3 or GitHub V0.3 implementation has been approved from these proposal artifacts.
- No current runtime vulnerability was established by the document QA.
- GitHub V0.3 parent identity binding is exact, but it binds to the affected frozen parent and
  therefore cannot progress to child identity or freeze.

## 4. Proposed normative V0.4 correction

### 4.1 No-HMAC-before-lifecycle invariant

Before invoking any per-reference HMAC or requested/observed set-HMAC operation, the parent MUST
validate the exact privacy key and purpose-restricted privacy handle against the single trusted
`verificationStartedAt` sample.

Validation MUST establish all of the following before the first privacy HMAC invocation:

- the submitted proof-handle representation is present, has the exact required shape, and is not
  malformed or forged;
- that structurally valid representation resolves through the parent-owned opaque runtime table;
- the resolved proof handle has the expected context, generation, attempt, `sourceProofVersion`,
  and `privacyKeyVersion`;
- the resolved proof handle is not stale, consumed, or replayed;
- the referenced privacy key and purpose-restricted key-handle entry are present in the trusted
  runtime registry;
- the resolved key entry has the required privacy-HMAC purpose and the exact version named by the
  proof handle;
- the lifecycle interval is internally valid;
- `issuedAt <= verificationStartedAt`;
- expiry has not occurred at or before the trusted sample;
- revocation has not occurred at or before the trusted sample;
- deletion has not occurred at or before the trusted sample.

The parent MUST NOT resample time between lifecycle validation and the HMAC operations governed by
that validation. Equality at expiry, revocation, or deletion is invalid, preserving the existing
boundary semantics.

### 4.2 Exact corrected privacy sequence

The future full Common V0.4 contract MUST encode this exact step replacement. A condition assigned
to one step MUST NOT be resolved or revalidated in another step.

| Frozen V0.3 step | V0.4 treatment | Exact rule |
| --- | --- | --- |
| 1 | Preserve unchanged | Reserve Common/source caps and copy submitted bytes into bounded parent memory. |
| 2 | Replace the broad proof-handle clause | Acquire and validate the one-shot snapshot, capability, and registry generation; capture exactly one trusted `verificationStartedAt`; validate submitted proof-token presence and exact shape; resolve the token exactly once through the parent proof table; validate the resolved proof record's context, generation, attempt, `sourceProofVersion`, `privacyKeyVersion`, stale, consumed, and replay state. Do not consume the proof and do not invoke HMAC. |
| 3 | Preserve unchanged | Strict-decode and parse; enforce exact keys, hostile-object rejection, and canonical-byte equality for envelope and bundle. |
| 4 | Preserve only binding-object checks | Validate source, mode, operation, identity, versions, caps, contract SHA-256, adapter artifact, context, generation, case, dataset, account, comparison scope, run, request, attempt, chronology, and capability equality on the submitted envelope, bundle, manifest, invocation, and capability binding objects. Step 4 MUST NOT resolve, reread, or revalidate proof-table state; its context/generation/attempt checks concern submitted binding objects, while step 2 concerns the resolved proof record. |
| 5 | Preserve unchanged | Verify collector-seal lifecycle and MAC. |
| 6 | Preserve unchanged | Verify manifest, component, artifact-set, and required detached hashes. |
| 7 | Replace the privacy sub-sequence | Use the proof record resolved in step 2 without another table lookup; resolve its referenced privacy key and purpose-restricted key-handle entry from the already validated registry generation; validate key availability, purpose, runtime version, interval validity, issuance, expiry, revocation, and deletion against the one trusted sample; atomically consume the proof; only the winner may recompute per-reference and set HMACs, enforce wire relationships, and compare commitments; then zeroize and dispose raw material without restoring the proof. |
| 8 | Remove only the privacy-key lifecycle clause | Preserve source-specific scope, pagination, coverage, text, forbidden-field, and semantic checks in their existing order. Step 8 MUST NOT repeat key lifecycle or proof validation. |

The resulting invariant order is:

~~~text
caps and bounded copy
-> one proof-table lookup and proof-record validation
-> canonical and submitted binding-object validation
-> collector seal
-> detached hashes
-> referenced key lifecycle
-> atomic proof consumption
-> per-reference and set HMAC
-> commitment equality and zeroization
-> remaining scope and semantic checks
~~~

No source adapter, callback, child bundle, or HMAC helper may reorder, bypass, defer, or hide these
checks.

#### 4.2.1 Single proof-table resolution

After exact representation validation, the parent proof-table lookup MUST occur exactly once at the
registry generation validated in step 2. It returns one member of this closed result:

| Lookup result | Meaning | Required handling |
| --- | --- | --- |
| `not_found` | No matching live or retained tombstoned proof record exists. | Treat the exact-shaped token as forged for this contract and return `SOURCE_BINDING_INVALID / source_bundle_invalid`. Do not query the privacy-key registry. |
| `active` | One live proof record exists. | Retain one parent-owned reference to that record for step 7; validate its bindings and state exactly once. |
| `retained_tombstone` | A formerly registered proof record is retained with stale, consumed, or replay state and sufficient non-secret binding metadata. | Return `PRIVACY_SCOPE_CONTEXT_INVALID / context_binding_invalid`; do not query the privacy-key registry. |

A `not_found` proof-table result is never privacy-key unavailability. Only an `active` proof record
may name a privacy key or purpose-restricted key-handle entry whose later registry lookup can return
key unavailability. The future full contract MUST define the privacy-minimized tombstone retention
rule; no tombstone may contain raw repository identity, key material, or HMAC preimage bytes.

#### 4.2.2 Atomic single-use transition

The `unconsumed` to `consumed` transition is the linearization point for one attempt's exclusive
right to use the proof handle. It MUST be one atomic compare-and-transition operation in the
parent-owned runtime table, not a read followed by a later write.

- Exactly one concurrent attempt may win the transition for one single-use handle.
- A losing attempt maps to `PRIVACY_SCOPE_CONTEXT_INVALID / context_binding_invalid`.
- A losing attempt invokes zero per-reference HMACs, zero set-HMACs, zero callbacks, and zero
  adapters.
- A successful transition is irreversible for that handle. A later HMAC mismatch, source-binding
  failure, global failure, abort, or cleanup never restores `unconsumed`.
- Cleanup is idempotent and MUST NOT attempt a second consume transition.

### 4.3 Preserved failure taxonomy

The correction changes ordering, not failure meaning. The future full Common V0.4 contract MUST
preserve these distinct mappings:

| Condition | Failure code | Failure detail |
| --- | --- | --- |
| Submitted proof-token field absent, malformed, or wrong exact shape; or an exact-shaped token produces proof-table `not_found` | `SOURCE_BINDING_INVALID` | `source_bundle_invalid` |
| Proof-table `retained_tombstone`; active proof has wrong context, generation, attempt, `sourceProofVersion`, or `privacyKeyVersion`; active proof is stale, already consumed, or replayed; or the attempt loses the atomic consume transition | `PRIVACY_SCOPE_CONTEXT_INVALID` | `context_binding_invalid` |
| Successfully resolved active proof references an unavailable privacy key or purpose-restricted key-handle registry entry; or that entry has wrong purpose, wrong runtime key version, an invalid lifecycle interval, `verificationStartedAt < issuedAt`, expiry, revocation, or deletion | `PRIVACY_SCOPE_KEY_UNAVAILABLE` | `privacy_scope_key_unavailable` |

A submitted field that is absent or fails exact representation validation is not a missing runtime
key/handle entry. An exact-shaped token with proof-table `not_found` is forged for this contract and
is not key unavailability. Only after proof-table `active` resolution can an unavailable referenced
privacy key or purpose-restricted key-handle entry map to key unavailability. A proof
context/version/replay failure cannot be collapsed into key unavailability. A key registry version
that fails to equal the already validated proof `privacyKeyVersion` is key unavailability; the
proof's own wrong version claim is context invalid.

### 4.4 Terminal cleanup remains mandatory

Failure before HMAC does not waive cleanup. Every terminal path MUST still perform the cleanup
already required by the parent contract, including as applicable:

- zeroization of parent-owned raw-identifier vault buffers;
- logical invalidation of the single-use vault;
- disposal of transient key references;
- idempotent invalidation required to prevent replay without a second consume transition;
- prevention of callback launch and adapter invocation;
- sanitized diagnostic construction without raw repository identity or key material.

Cleanup MUST NOT invoke a privacy HMAC merely to complete or classify the failure.
Cleanup MUST NOT restore a successfully consumed handle to `unconsumed`.

## 5. Parent identity binding clarification

### 5.1 Exact runtime fields

A child runtime parent binding consists of exactly these four fields:

~~~text
parentCommonContractDocumentSha256
parentCommonContractGitBlobObjectId
parentCommonFreezeReceiptId
parentCommonFreezeGitCommitObjectId
~~~

The current GitHub V0.3 proposal correctly carries all four fields. This proposal does not add,
remove, or rename a child binding field.

### 5.2 Byte length is external evidence only

The frozen Common V0.3 byte length `88549` is exact-byte identity evidence. It is not:

- a `FrozenParentCommonIdentity` field;
- a wire, envelope, manifest, or callback field;
- a runtime registration or capability-binding field;
- an equality-table field;
- a fifth child parent-identity field.

The earlier V0.3 freeze receipt's next-task sentence mentioning byte length, SHA-256, and blob was
incomplete and non-normative because it omitted the receipt and freeze commit. The receipt remains
immutable. A future V0.4 freeze receipt, if Colin later approves one, MUST state that the four-field
binding above is normative and that byte length remains external evidence only.

## 6. Version and compatibility effect

- The corrected future contract requires a new Common V0.4 contract ID, serialized protocol
  version, freeze version, exact byte length, SHA-256, Git-compatible blob identity, receipt, and
  commit.
- Frozen Common V0.3 remains immutable historical evidence and is not reclassified as valid for
  implementation.
- No V0.3/V0.4 union, alias, coercion, wrapper, default, fallback, migration, version probing, or
  silent overwrite is permitted.
- No child may accept either parent version through a compatibility branch.
- The child contract version and replacement/rebinding mechanics are a separate Colin decision and
  are not invented by this proposal.

## 7. GitHub child effect

- The current GitHub V0.3 proposal remains proposal-only and unfrozen.
- Its current four-field Common V0.3 identity binding remains historically accurate but cannot
  authorize hashing, freeze, implementation, or activation.
- The GitHub proposal MUST NOT be edited to guess a Common V0.4 identity before Common V0.4 freezes.
- After Common V0.4 freezes, a separate child correction task must select the child version, bind
  the exact new four-field parent identity, and complete renewed cross-contract QA before any child
  identity calculation.
- GitHub remains private, offline, and always `authoritative: false` throughout this work.

## 8. Required future contract and implementation tests

The future Common V0.4 full contract MUST require at least these fixtures. This proposal does not
implement or execute them.

### 8.1 No-HMAC negative fixtures

For each condition below, a cryptographic-operation spy MUST observe zero per-reference HMAC calls
and zero requested/observed set-HMAC calls:

- missing privacy key or handle;
- expired key or handle;
- revoked key or handle;
- deleted key or handle;
- wrong-purpose key or handle;
- not-yet-issued key or handle;
- invalid lifecycle interval;
- stale proof handle;
- consumed proof handle;
- replayed proof handle;
- wrong context, generation, or attempt;
- wrong `sourceProofVersion`;
- wrong proof `privacyKeyVersion`;
- resolved registry key version that does not equal the proof `privacyKeyVersion`;
- submitted proof-handle field absence;
- exact-shaped proof token with proof-table `not_found`;
- retained proof tombstone marked stale, consumed, or replayed;
- structurally valid proof whose runtime key or purpose-restricted handle entry is unavailable;
- forged or malformed proof handle.

Each fixture MUST assert the exact failure code/detail pair from Section 4.3 and required cleanup.

### 8.2 Boundary fixtures

- `issuedAt <= verificationStartedAt < expiresAt` may proceed when all other checks pass.
- `verificationStartedAt < issuedAt` rejects as
  `PRIVACY_SCOPE_KEY_UNAVAILABLE / privacy_scope_key_unavailable` before HMAC.
- `verificationStartedAt === expiresAt` rejects before HMAC.
- Revocation equality rejects before HMAC.
- Deletion equality rejects before HMAC.
- No second time sample may turn one attempt from invalid to valid or from valid to invalid between
  lifecycle validation and HMAC recomputation.

### 8.3 Atomic-consumption and concurrency fixtures

- Two genuinely concurrent attempts using one single-use proof handle produce exactly one atomic
  transition winner.
- Only the winner may invoke the required HMAC operations.
- Every loser returns `PRIVACY_SCOPE_CONTEXT_INVALID / context_binding_invalid` with zero HMAC,
  callback, and adapter invocations.
- A lifecycle-valid attempt whose atomic transition fails still performs terminal cleanup without
  a second consume attempt.
- A winner that later encounters HMAC mismatch or another terminal failure leaves the handle
  consumed and cannot be replayed.
- Instrumentation proves the proof-table lookup, proof binding/state checks, and consume transition
  each occur exactly once per attempt.
- Repeated cleanup invocation remains idempotent and never performs a second consume transition.

### 8.4 Precedence fixture

- V0.3 steps 1, 3, 5, and 6 retain their existing relative order and failure precedence.
- V0.4 step 2 validates the resolved proof record exactly once.
- V0.4 step 4 validates submitted binding objects without proof-table lookup or proof-state
  revalidation.
- V0.4 step 7 uses the retained active proof reference without a second lookup.
- V0.4 step 8 performs no proof or key-lifecycle validation.

### 8.5 Positive operation fixture

A fully valid key, handle, context, lifecycle, vault, and source binding MUST invoke exactly the
required per-reference HMAC operations and exactly the required requested/observed set-HMAC
operations, with no extra helper invocation.

### 8.6 Identity fixtures

- A child parent identity object with exactly the four Section 5.1 fields is accepted when all
  values equal the frozen parent identities.
- Missing or mismatched receipt or commit is rejected.
- An added byte-length field is rejected by exact-key validation.
- V0.3 and V0.4 values cannot be mixed.

## 9. Preserved architecture and authority invariants

This proposal does not alter the following requirements:

- Common owns preflight, source combination, Common builder invocation, and aggregate result
  construction.
- Source adapters return neutral evidence records only.
- Raw repository identities and privacy keys remain parent-only and non-wire.
- The callback receives a deeply frozen projection-only graph.
- Disposable isolation, closed globals and intrinsics, canonical IPC, and adapter-artifact digest
  binding remain mandatory.
- Evidence authority remains record-local; GitHub remains `authoritative: false`.
- A/B/C use the same Blabase adapter, suggestion engine, model, prompt, configuration, ranking,
  guardrails, and output schema. Only the evidence set differs.
- Dayflow provides capture, storage, OCR, privacy minimization, and preprocessing evidence only. It
  does not provide suggestion semantics or a separate suggestion path.

No LikeC4 update is required for this proposal-only correction because no implemented system
boundary, container, component, integration, or runtime flow changes in this checkpoint.

## 10. Required lifecycle and gates

The permitted order is:

1. Write this bounded Common V0.4 correction proposal.
2. Run bounded proposal QA.
3. Colin reviews and either approves, revises, or rejects the correction direction.
4. Draft the full standalone Common V0.4 contract.
5. Run full Common V0.4 contract QA, including the ordering, failure, cleanup, exact-type, security,
   and privacy obligations.
6. Colin reviews the full contract.
7. Prepare external exact Common V0.4 identities.
8. Colin separately decides whether to freeze Common V0.4.
9. Only after parent freeze, create the separately versioned GitHub correction and exact parent
   binding.
10. Run renewed child cross-contract QA.
11. Colin separately reviews and may later freeze the child contract.
12. Implementation approval remains a later separate decision.

Passing proposal QA does not approve the full contract. Passing full-contract QA does not approve
freeze. Freeze does not approve implementation, activation, release, or authority.

Current lifecycle state: initial bounded proposal QA returned `FAIL / OPEN` with two Medium
findings; Colin approved the bounded taxonomy and atomic-consumption correction; this corrected
proposal now awaits bounded re-QA.

## 11. Explicit non-authorizations

This proposal does not authorize:

- editing or replacing frozen Common V0.2 or V0.3 bytes;
- editing or replacing a frozen receipt;
- treating the current GitHub V0.3 proposal as implementation-ready;
- generating GitHub V0.3 exact identities;
- implementation, fixtures, tests, compilation, runtime execution, provider access, or key use;
- new credentials, keys, secrets, user data, provider data, or raw repository identifiers;
- `authoritative: true`, public API exposure, release, rollout, or production activation;
- a David review, gate, package, artifact, receipt, or approval.

## 12. Colin decision state and remaining gate

Colin explicitly approved the failure mapping and atomic-consumption correction used in this
proposal on 2026-08-24. That decision is recorded as a drafting correction only.

Bounded re-QA must provide technical evidence before Colin separately decides whether to accept the
corrected proposal direction and authorize a full Common V0.4 contract draft. That later review
must confirm the following:

1. Whether every privacy key/handle lifecycle check must complete before every privacy HMAC.
2. Whether the exact failure taxonomy in Section 4.3 is complete without collapsing categories.
3. Whether the atomic single-use transition, terminal cleanup, and zeroization remain mandatory
   when HMAC invocation count is zero.
4. Whether the runtime parent binding remains exactly four fields and byte length remains external
   evidence only.
5. Whether Common V0.4 remains incompatible with V0.3 and requires a separately versioned child
   correction after parent freeze.

No full-contract, identity, freeze, implementation, or child decision is inferred from the drafting
approval.

## 13. Proposal acceptance criteria

This proposal is ready for Colin review only when bounded QA confirms all of the following:

- no normative path permits a privacy HMAC before lifecycle validation;
- the failure-code/detail taxonomy is complete and non-overlapping for the stated conditions;
- submitted-handle absence, runtime-entry absence, proof/key version mismatch, not-yet-issued state,
  and invalid lifecycle interval each have exactly one failure pair;
- an exact-shaped proof-table `not_found` token maps only to source-binding invalid, while only a
  resolved active proof may produce referenced-key unavailability;
- proof-table lookup and proof-record binding/state validation each occur exactly once, and step 4
  does not duplicate them;
- one atomic `unconsumed` to `consumed` transition occurs before HMAC and has exactly one winner;
- a losing transition performs zero HMAC, callback, and adapter invocations;
- no terminal path restores a successfully consumed handle;
- every pre-HMAC failure retains mandatory cleanup and zeroization;
- exactly four runtime parent-binding fields are specified;
- byte length is never promoted to a schema, wire, manifest, equality, or runtime-binding field;
- frozen V0.3 bytes and receipts remain immutable historical evidence;
- GitHub remains unfrozen and blocked from identity or implementation;
- the proposal does not claim implementation, test execution, QA passage, freeze, release, or
  authority.
