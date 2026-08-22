# Common Suggestion Evidence Source Verification V0.2 Contract Freeze Proposal

## 1. Document metadata

| Field | Value |
| --- | --- |
| Contract ID | `blabase-common-suggestion-evidence-source-verification-v0.2` |
| Contract version | `v0.2` private proposal |
| Checkpoint | `Stage10-2B.1 Authority Contract Freeze Proposal` |
| Status | `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW` |
| Date and timezone | 2026-08-22, Asia/Seoul |
| Working owner | Colin |
| Sole human reviewer and decision authority | Colin |
| Required David role | None |
| Base Stage10-2A implementation | `8d868983cf85f5571abaa48d39765d29498eb04f` |
| Stage10-2A ECR addendum commit | `7cea8e58e62c7986dd8fd453a81fb12bd0c08225` |
| V0.1 drift-correction state | `QA_CORRECTED_CODE_VALIDATED_ECR_ADDENDUM_RECORDED_PENDING_IMMUTABLE_IDENTITIES_EXTERNAL_EXACT_BYTE_QA_BINDING_COLIN_DECISION_AND_FREEZE` |
| `V0_1_DRIFT_CORRECTION_COMMIT_SHA` | `TBD_UNCOMMITTED` (full correction commit SHA required before freeze) |
| Exact proposal freeze identity | `TBD_AT_FREEZE` (current proposal bytes are uncommitted; full Git commit/blob SHA or document SHA-256 required) |
| Required status transition on acceptance | `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW` -> `CONTRACT_FROZEN_BY_COLIN` |

Colin approved the high-level Stage10-2B direction on 2026-08-22. He has not approved the detailed
contract text in this proposal. This document is not frozen, accepted, implemented, activated, or
released. It authorizes no implementation. A later freeze requires Colin to approve one exact
document state and record the status transition separately.

Freeze is impossible while the exact proposal freeze identity remains `TBD_AT_FREEZE` or
`V0_1_DRIFT_CORRECTION_COMMIT_SHA` remains `TBD_UNCOMMITTED`. Neither a short commit prefix nor a
path identifies immutable bytes. Independent exact-byte QA is external freeze evidence and cannot
be self-attested inside the proposal it reviews, because editing that assertion would create new
bytes. Its result must later be bound to the immutable correction commit and exact proposal
commit/blob/document identity in the freeze/ECR receipt. No such binding exists yet; a read-only QA
result obtained before those identities exist remains unbound evidence. At freeze, Colin must review
one exact document state, record both immutable identities and the bound external QA result, and
explicitly record the status transition. This proposal does not perform that transition.

The codebase-memory generation available while this proposal was prepared was
`2026-08-20T14:55:09Z`. It reported the relied-on current plan, contract, and implementation paths
as not tracked or metadata-changed and did not contain current Stage10-2A symbols. Therefore the
current direct source was used as ground truth. This caveat prevents graph results from being
treated as proof of current implementation coverage.

## 2. Purpose

This proposal defines the common private contract for Stage10-2B source verification. A conforming
source verifier must prove, offline and deterministically, that a runtime-trusted adapter produced a
sealed collection envelope, that the envelope is bound to the exact authorized evaluation context,
and that replaying the pinned source projection produces exactly the source records already bound in
Stage 2.

Stage10-2B verifies evidence lineage. It does not generate suggestions and does not make a receipt,
record set, source claim, or result publicly authoritative.

## 3. Normative language and definitions

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are normative only
after Colin freezes the contract. Until then, each rule and identity is proposed.

- **V0.1 receipt**: the frozen serialized Common Suggestion Evidence Lineage Receipt v0.1.
- **V0.1 kernel**: the accepted private Stage10-2A implementation at the base commit above.
- **Source partition**: all Common Suggestion Evidence v0.1 records whose `source` equals one fixed
  source, taken from the Stage 2 verified record set.
- **Collection envelope**: private metadata sealed by a runtime-trusted adapter around one bounded
  source collection attempt and its artifact manifest.
- **Collector seal**: a private, purpose-separated MAC over the canonical envelope metadata. A seal
  authenticates the trusted collector boundary; it is not merely a self-hash.
- **Source bundle**: the bounded private evidence required to verify one collection envelope,
  source artifacts, manifests, diagnostics, coverage, and projection replay.
- **Capability metadata**: immutable data describing whether a source verifier is available and
  which exact contract and version it implements. It contains no executable function.
- **Executable table**: a runtime-owned, opaque mapping from approved verifier identity to executable
  verifier capability. A caller cannot construct or inspect it.
- **Atomic runtime snapshot**: one runtime-owned generation binding capability metadata, executable
  capabilities, context registrations, lifecycle state, restricted key handles, and timezone data.
- **Verified source**: a source whose entire Stage 3 proof and exact projection comparison passed.
  In Stage10-2B this state is always private and `authoritative: false`.
- **Requested source**: a V0.1 collection-plan entry whose `requestStatus` is `requested`.
- **Not requested source**: a V0.1 collection-plan entry whose `requestStatus` is `not_requested`.

## 4. Frozen-on-acceptance invariants

If Colin accepts this proposal, the following common invariants become frozen for V0.2:

1. Verification is offline and deterministic. No verifier performs a provider or network call.
2. The source union and execution order are exactly `github`, `codex`, `google_calendar`, `notion`,
   `dayflow`.
3. The stage order remains exactly `intrinsic_receipt`, `record_set_binding`,
   `source_attestation`. There is no fourth stage.
4. V0.1 serialized contracts, facade, exports, and frozen behavior remain unchanged. The only
   implementation alignments recognized by this proposal are the separately documented corrections
   that restore the frozen V0.1 per-source count/ID-set predicates and combined root-mismatch
   precedence; they add no contract behavior.
5. V0.2 is additive, private, and non-authoritative. Every success branch has the literal
   `authoritative: false`.
6. Capability metadata and executable capability are separate. Plain caller-created functions,
   registries, and snapshots cannot establish authority.
7. An adapter-owned sealed collection envelope is the common trust-root concept. Detached hashes
   and self-hashes alone do not establish authenticity.
8. A source verifier reparses frozen evidence, derives coverage and neutral issues, and replays the
   pinned projection. The common kernel alone compares the result with the Stage 2 source partition.
9. Partial activation is allowed. A requested source whose verifier is unimplemented fails closed
   with `SOURCE_VERIFIER_UNAVAILABLE`.
10. Stage10-2B is complete only when all five verifier slices and mixed-source integration satisfy
    their frozen contracts.
11. Stage10-2C alone may introduce a public authority path or any `authoritative: true` result.
12. Dayflow remains capture, storage, privacy processing, OCR, and preprocessing evidence only.
    It cannot output structured facts or suggestion-shaped semantics.
13. Colin is the sole human reviewer and authority. No David artifact or review gate is required.
14. A source callback is blind to Stage 2 expected records, partitions, receipt bindings, and
    receipt-derived comparison values. Only the common kernel may hold and compare those values.
15. Each kernel invocation acquires one fresh, atomic, immutable, single-use runtime snapshot inside
    Stage 3. No caller may supply, retain, replay, or mint that snapshot.

## 5. Explicit non-goals

Stage10-2B.1 and this proposal do not:

- add, change, or activate a public facade, planner, API, serialized schema, or public version;
- edit or reinterpret an accepted V0.1 receipt or record set, except for pinning the separately
  implemented code corrections that restore the already-frozen V0.1 mismatch predicates and
  precedence;
- create a successful `authoritative: true` branch;
- implement any source verifier, source bundle, adapter, fixture, or collector key;
- perform provider calls, live connector integration, persistence, release, or deployment;
- generate, rank, filter, summarize, caveat, or render a suggestion;
- execute A/B/C, change an A/B/C engine input, or produce an experiment result;
- change a Golden, Regression, Rolling, or Holdout dataset;
- change retention or deletion policy;
- add a production dependency; or
- claim that any current provider artifact or synthetic Dayflow path is a live-authoritative trust
  root.

## 6. Compatibility and versioning matrix

| Surface | Current status | V0.2 proposal effect | Activation authority |
| --- | --- | --- | --- |
| Serialized lineage receipt v0.1 | Frozen and unchanged | Read and verified under exact V0.1 semantics | None in 2B |
| Common Evidence record set v0.1 | Frozen and unchanged | Stage 2 input remains exact V0.1 | None in 2B |
| Accepted kernel v0.1 | Private, unavailable-only source registry; the initial correction passed focused/full/static validation on historical bytes, while the current QA-corrected code passed full-suite/typecheck/lint validation and has a recorded ECR addendum; its standalone focused command was not rerun, and immutable identity plus external exact-byte QA binding remain pending | Reused only after the complete correction and external QA evidence are fully identified and pinned | Stage10-2A acceptance plus the correction gate below |
| Private capability metadata v0.2 | Not implemented | Additive exact five-entry snapshot | Colin freeze plus later implementation approval |
| Private executable table v0.2 | Not implemented | Runtime-owned opaque capability | Colin freeze plus later slice approval |
| Private atomic runtime snapshot v0.2 | Not implemented | Additive generation and lifecycle boundary | Colin freeze plus later implementation approval |
| Private source result v0.2 | Not implemented | Sanitized, `authoritative: false` only | Colin freeze plus later implementation approval |
| Existing public facade and planner | Accepted V0.1 behavior | No change and no new export | Not owned by 2B |
| Stage10-2C public authority | Unimplemented | Explicitly excluded | Separate future Colin decision |

No V0.1 artifact is rewritten, rehashed, upgraded, unioned with V0.2 wire data, or interpreted under
V0.2 semantics. V0.2 runtime objects are not accepted by a V0.1 public parser and are not serialized
as V0.1 artifacts.

### 6.1 Frozen V0.1 drift-correction gate

The frozen V0.1 contract requires a per-source `recordCount` or record-ID-set disagreement to map to
`RECORD_ID_SET_MISMATCH`. A root-hash or `asOf` disagreement is eligible for
`RECORD_SET_BINDING_MISMATCH` only when every applicable per-source count and record-ID-set binding
matches. The prior implementation first misclassified an isolated count disagreement, then still
emitted a root mismatch alongside a combined per-source mismatch, allowing the in-stage selector to
choose the inapplicable root code.

The first correction checkpoint created Engine Change Record
`ECR-STAGE10-V0-1-RECORD-COUNT-CONTRACT-ALIGNMENT-2026-08-22`. On the exact historical
pre-QA-correction bytes, the standalone focused lineage command passed 47/47, the full suite passed
168/168 files and 1,592/1,592 tests, and typecheck and lint passed. Those results remain historical
evidence only.

Comprehensive QA then found the combined Stage 2 precedence defect and the V0.2 Calendar-only type
scope defect. The current QA-corrected code/test bytes completed batched validation: `npm test` ran
Vitest 3.2.7 with exit 0, passing 168/168 files and 1,593/1,593 tests in 20.26s; within that full
suite, the affected lineage file passed 48/48 tests in 102ms. `npm run typecheck` ran
`tsc --noEmit` with exit 0, and `npm run lint` ran ESLint with exit 0. Engine Change Record addendum
`ECR-STAGE10-V0-1-RECORD-COUNT-QA-CORRECTION-2026-08-22` is recorded. The standalone focused
lineage command was not rerun for the current bytes. Build and architecture checks were not run and
are not claimed to have passed; their existing module/import/system-boundary triggers remain
unchanged.

Exact-byte independent QA remains external freeze evidence. This proposal cannot self-attest that
its just-edited bytes passed review. The external QA result must later be bound to the immutable
V0.1 correction commit and exact proposal commit/blob/document identity in the freeze/ECR receipt.
Until those identities, that binding, Colin's Section 20.1 decisions, and the explicit status
transition are recorded, freeze remains blocked.

The historical Stage10-2A implementation SHA `8d868983cf85f5571abaa48d39765d29498eb04f`
and ECR addendum SHA `7cea8e58e62c7986dd8fd453a81fb12bd0c08225` remain accurate historical
identities; neither identifies the complete correction. `V0_1_DRIFT_CORRECTION_COMMIT_SHA` remains
`TBD_UNCOMMITTED`, and the exact proposal freeze identity remains `TBD_AT_FREEZE`. The V0.2 contract
cannot freeze or authorize implementation until both placeholders are replaced, the external QA
result is bound to those immutable identities, and Colin records the remaining decisions and status
transition.

## 7. Common trust model

### 7.1 Trust boundary

The proposed common trust root is an adapter-owned sealed collection envelope produced inside an
approved runtime. The approved adapter receives a restricted collector-seal handle that is not
available to the application caller, source bundle submitter, test object, or serialized input.

The collector seal proves only that the approved adapter sealed the exact envelope metadata under
an active, purpose-restricted runtime key. Provider-specific authenticity, completeness, and
coverage still require a frozen source bundle sub-contract and source-specific proof. No source
bundle sub-contract or operational trust root is claimed to exist by this proposal.

### 7.2 Required authenticated bindings

The sealed envelope preimage MUST bind all of the following:

- fixed source;
- collector and adapter identity and version;
- input contract, source bundle contract, preprocessing, and projection versions, using canonical
  `null` only when the frozen source contract declares preprocessing inapplicable;
- collector registry generation, collector-seal algorithm, domain, purpose, key version, and the
  single allowed operation;
- private account or user context digest;
- private registered context ID;
- frozen evaluation case ID;
- dataset version and dataset SHA-256;
- exact comparison-scope ID and verification run ID;
- request binding digest and collection-attempt binding digest;
- source-specific requested collection mode and required operations;
- artifact-manifest SHA-256 and source-artifact-set SHA-256;
- attempted, started, completed, collected, and runtime-supplied sealed timestamps under the exact
  chronology and null rules in Section 11; and
- every envelope identity and lifecycle field, including schema version.

Every binding must match the atomic runtime snapshot, V0.1 collection plan, V0.1 receipt binding,
and verified source bundle as applicable. A field cannot be inferred later from an unbound filename,
process state, provider response, or caller assertion.

### 7.3 Self-hash is not authenticity

A detached SHA-256 proves that bytes have not changed relative to the supplied digest. Because an
untrusted caller can create both bytes and digest, it does not prove who collected the evidence or
which private runtime context authorized it. The collector seal authenticates the canonical
envelope under a runtime-owned secret; provider-specific validation proves the bounded source chain.
Both are required for a verified source.

### 7.4 Proposed collector-seal mechanism

The recommended common mechanism is:

```text
algorithm = HMAC-SHA-256
domain = "blabase.lineage.collector-seal.v0.2"
purpose = "source-collector-seal"
canonicalMacInput = the exact envelope with only collectorSeal.hmacSha256 omitted
preimage = UTF8(domain) || 0x00 || RFC8785_JCS(canonicalMacInput)
wire result = exactly 64 lowercase hexadecimal characters
```

`canonicalMacInput.collectorSeal` therefore retains and authenticates `algorithm`, `domain`,
`purpose`, and `keyVersion`. Every other envelope field is retained. No other field, container,
default, empty value, or lifecycle value may be omitted, inferred, normalized away, or filled after
the MAC is computed. The trusted seal operation supplies `sealedAt` and the four collector-seal
fields, verifies all registry-bound fields, and rejects rather than signs any conflicting caller or
adapter value.

The preimage is bounded before HMAC and must not exceed the accepted V0.1 maximum private HMAC
preimage size of 1,048,576 bytes. A source bundle sub-contract may freeze a smaller cap.

The algorithm, domain, and purpose literals above are recommended proposal values. They are a
blocking Colin review item and do not exist operationally until separately implemented. The
collector-seal key is distinct from the V0.1 privacy-scope HMAC key by key material, key version,
restricted handle, purpose, domain, and allowed operation. Neither handle may compute the other's
digest. Privacy-scope HMAC hides and compares private scope tokens; collector-seal HMAC authenticates
the adapter-owned envelope.

## 8. Proposed private contracts

These TypeScript-like definitions specify shape and ownership, not a public API or implementation.
All objects and nested collections are exact-key, deeply frozen, dense, ordinary data unless marked
opaque. Unknown fields, accessors, proxies, symbols, cycles, and shared aliases are invalid.

### 8.1 Fixed capability metadata

```ts
type SourceV0_2 =
  | "github"
  | "codex"
  | "google_calendar"
  | "notion"
  | "dayflow";

type UnavailableCapabilityV0_2 = Readonly<{
  source: SourceV0_2;
  status: "unavailable";
  verifierId: null;
  verifierVersion: null;
  sourceBundleContractVersion: null;
  projectionVersion: null;
}>;

type AvailableCapabilityV0_2 = Readonly<{
  source: SourceV0_2;
  status: "available";
  verifierId: string;
  verifierVersion: string;
  sourceBundleContractVersion: string;
  projectionVersion: string;
}>;

type SourceCapabilityMetadataEntryV0_2 =
  | UnavailableCapabilityV0_2
  | AvailableCapabilityV0_2;

type SourceCapabilityMetadataSnapshotV0_2 = Readonly<{
  schemaVersion: "blabase-common-suggestion-source-capabilities-v0.2";
  generationId: string;
  entries: readonly [
    SourceCapabilityMetadataEntryV0_2 & { readonly source: "github" },
    SourceCapabilityMetadataEntryV0_2 & { readonly source: "codex" },
    SourceCapabilityMetadataEntryV0_2 & { readonly source: "google_calendar" },
    SourceCapabilityMetadataEntryV0_2 & { readonly source: "notion" },
    SourceCapabilityMetadataEntryV0_2 & { readonly source: "dayflow" },
  ];
}>;
```

Metadata cannot grant execution authority. `available` is valid only when the same atomic runtime
generation resolves the exact verifier identity and versions in its opaque executable table.

### 8.2 Runtime-owned executable table and atomic snapshot

```ts
declare const ownedVerifierTableBrandV0_2: unique symbol;
declare const atomicRuntimeSnapshotBrandV0_2: unique symbol;
declare const restrictedCollectorSealHandleBrandV0_2: unique symbol;

type OwnedSourceVerifierTableHandleV0_2 = Readonly<{
  readonly [ownedVerifierTableBrandV0_2]: true;
}>;

type CollectorSealAllowedOperationV0_2 = "seal-collection-envelope-v0.2";

type CollectorSealKeyLifecycleRecordV0_2 = Readonly<{
  keyVersion: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  deletedAt: string | null;
}>;

type CollectorSealRegistryTupleV0_2 = Readonly<{
  registryGenerationId: string;
  source: SourceV0_2;
  collectorId: string;
  collectorVersion: string;
  adapterId: string;
  adapterVersion: string;
  inputContractVersion: string;
  sourceBundleContractVersion: string;
  preprocessingVersion: string | null;
  projectionVersion: string;
  algorithm: "HMAC-SHA-256";
  domain: "blabase.lineage.collector-seal.v0.2";
  purpose: "source-collector-seal";
  keyVersion: string;
  allowedOperation: CollectorSealAllowedOperationV0_2;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  deletedAt: string | null;
}>;

type RestrictedCollectorSealHandleV0_2 = Readonly<{
  readonly [restrictedCollectorSealHandleBrandV0_2]: true;
  readonly registryTuple: CollectorSealRegistryTupleV0_2;
}>;

// Acquired only inside Stage 3 from runtime-owned state; never accepted as input.
type AtomicVerificationRuntimeSnapshotV0_2 = Readonly<{
  readonly [atomicRuntimeSnapshotBrandV0_2]: true;
  schemaVersion: "blabase-common-suggestion-verification-runtime-v0.2";
  generationId: string;
  verificationInvocationId: string;
  verificationStartedAt: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  capabilities: SourceCapabilityMetadataSnapshotV0_2;
  executableTable: OwnedSourceVerifierTableHandleV0_2;
  contextRegistrations: readonly PrivateContextRegistrationInternalV0_1[];
  privacyKeyLifecycleRecords: readonly PrivateKeyLifecycleRecordInternalV0_1[];
  collectorSealKeyLifecycleRecords: readonly CollectorSealKeyLifecycleRecordV0_2[];
  collectorSealRegistry: readonly CollectorSealRegistryTupleV0_2[];
  restrictedPrivacyHmacHandles: readonly RestrictedPrivateScopeHmacHandleInternalV0_1[];
  restrictedCollectorSealHandles: readonly RestrictedCollectorSealHandleV0_2[];
  timezoneProfile: FrozenTimezoneProfileSnapshotInternalV0_1 | null;
}>;
```

The kernel accepts neither a snapshot nor a snapshot handle from the public or application caller.
Immediately before Stage 3, it asks the runtime-owned acquisition boundary to create one snapshot
for the current internal invocation. Structural resemblance, `Object.freeze`, a plain function, or
a copied brand property does not establish ownership. The snapshot and every restricted handle are
resolved by private object identity from the same atomic registry generation or the invocation
globally aborts.

The collector-seal registry tuple is normative and exact. The restricted handle authorizes only its
single `allowedOperation` over the exact bound source, collector, adapter, input contract, source
bundle contract, preprocessing, projection, registry generation, algorithm, domain, purpose, and
key version. The seal operation supplies those fields and `sealedAt`; it does not trust them from the
holder. A holder bound to one source or adapter cannot claim or seal another source or adapter, even
if every other byte is identical. Both the handle registration and key lifecycle record must be
active at sealing and verification. A registry tuple, brand-shaped object, or envelope self-hash is
integrity metadata only and never authority without the runtime-owned handle and valid MAC.

### 8.3 Common sealed collection envelope

```ts
type SealedCollectionEnvelopeMetadataV0_2 = Readonly<{
  schemaVersion: "blabase-source-collection-envelope-v0.2";
  source: SourceV0_2;
  collectorId: string;
  collectorVersion: string;
  adapterId: string;
  adapterVersion: string;
  inputContractVersion: string;
  sourceBundleContractVersion: string;
  preprocessingVersion: string | null;
  projectionVersion: string;
  registryGenerationId: string;
  contextId: string;
  frozenEvaluationCaseId: string;
  datasetVersion: string;
  datasetSha256: string;
  comparisonScopeId: string;
  verificationRunId: string;
  accountContextHmacSha256: string;
  requestBindingHmacSha256: string;
  collectionAttemptBindingHmacSha256: string;
  requestedCollectionMode: string;
  requiredOperations: readonly string[];
  artifactManifestSha256: string;
  sourceArtifactSetSha256: string;
  attemptedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  collectedAt: string;
  sealedAt: string;
  collectorSeal: Readonly<{
    algorithm: "HMAC-SHA-256";
    domain: "blabase.lineage.collector-seal.v0.2";
    purpose: "source-collector-seal";
    keyVersion: string;
    hmacSha256: string;
  }>;
}>;
```

The envelope is private input. Its presence is not proof until the runtime verifies the exact seal,
key lifecycle, context binding, manifest, and source-specific chain.

### 8.4 Verifier invocation and transient result

```ts
declare const restrictedVerifierRuntimeContextBrandV0_2: unique symbol;

type RestrictedSourceVerifierRuntimeContextV0_2 = Readonly<{
  readonly [restrictedVerifierRuntimeContextBrandV0_2]: true;
  source: SourceV0_2;
  generationId: string;
  verificationInvocationId: string;
  verificationStartedAt: string;
  capability: AvailableCapabilityV0_2;
}>;

type FrozenSourceVerifierContractAndCapsV0_2 = Readonly<{
  source: SourceV0_2;
  verifierId: string;
  verifierVersion: string;
  sourceBundleContractVersion: string;
  preprocessingVersion: string | null;
  projectionVersion: string;
  contractSha256: string;
  caps: Readonly<Record<string, number>>;
}>;

type SourceVerifierInvocationV0_2 = Readonly<{
  trustedRuntimeContext: RestrictedSourceVerifierRuntimeContextV0_2;
  sealedEnvelope: SealedCollectionEnvelopeMetadataV0_2;
  frozenSourceBundle: unknown;
  frozenSourceContractAndCaps: FrozenSourceVerifierContractAndCapsV0_2;
}>;

type TransientVerifiedSourceProofV0_2<S extends SourceV0_2> = Readonly<{
  outcome: "verified";
  source: S;
  replayedProjection: readonly CommonSuggestionEvidenceRecordV0_1[];
  derivedAttestation: unknown;
  derivedCoverage: unknown;
  derivedIssueCodes: readonly string[];
}>;

type SourceVerifierExecutionResultV0_2<S extends SourceV0_2> =
  | TransientVerifiedSourceProofV0_2<S>
  | Readonly<{
      outcome: "rejected";
      source: S;
      failureCode: SourceVerifierReturnedRejectionCodeV0_2<S>;
    }>;
```

Only a runtime-owned executable receives these four exact inputs. It never receives the Stage 2
partition, expected records, expected record count or ID set, V0.1 source binding, receipt, or a value
derived from any of those expected values. A returned `outcome: "verified"` is only a claim. The
common kernel alone retains Stage 2 expected material, reparses the callback result, and performs the
count, ID-set, same-ID content, provenance, coverage, and binding comparisons before it can mark a
source verified. This blind replay boundary prevents a callback from echoing expected output.

### 8.5 Sanitized aggregate result

```ts
type SourceVerificationStage3FailureCodeV0_2 =
  | "RESOURCE_LIMIT_EXCEEDED"
  | "INPUT_INVALID"
  | "SOURCE_BINDING_INVALID"
  | "SOURCE_ATTESTATION_INVALID"
  | "HASH_MISMATCH"
  | "SOURCE_VERIFIER_UNAVAILABLE"
  | "PRIVACY_SCOPE_CONTEXT_INVALID"
  | "PRIVACY_SCOPE_KEY_UNAVAILABLE"
  | "SCOPE_TOKEN_CANONICALIZATION_INVALID"
  | "PRIVACY_SCOPE_DIGEST_INVALID"
  | "TIMEZONE_PROFILE_INVALID"
  | "SOURCE_ATTESTATION_BINDING_MISMATCH"
  | "RECORD_ID_SET_MISMATCH"
  | "COVERAGE_INVALID";

type SourceVerifierReturnedRejectionCodeV0_2<S extends SourceV0_2> =
  | "SOURCE_ATTESTATION_INVALID"
  | "HASH_MISMATCH"
  | "SCOPE_TOKEN_CANONICALIZATION_INVALID"
  | "PRIVACY_SCOPE_DIGEST_INVALID"
  | ([S] extends ["google_calendar"] ? "TIMEZONE_PROFILE_INVALID" : never)
  | "COVERAGE_INVALID";

type SanitizedGlobalDiagnosticV0_2 =
  | Readonly<{
      stage: "source_attestation";
      failureCode: "RESOURCE_LIMIT_EXCEEDED";
      source: null;
      detail: "invocation_resource_limit_exceeded";
    }>
  | Readonly<{
      stage: "source_attestation";
      failureCode: "INPUT_INVALID";
      source: null;
      detail:
        | "runtime_snapshot_invalid"
        | "runtime_snapshot_stale"
        | "runtime_corruption"
        | "capability_correspondence_invalid";
    }>;

type SanitizedSourceDiagnosticV0_2 =
  | Readonly<{ stage: "source_attestation"; failureCode: "INPUT_INVALID"; source: SourceV0_2; detail: "source_verifier_trapped" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "SOURCE_BINDING_INVALID"; source: SourceV0_2; detail: "source_bundle_invalid" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "SOURCE_ATTESTATION_INVALID"; source: SourceV0_2; detail: "collector_seal_invalid" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "SOURCE_ATTESTATION_INVALID"; source: SourceV0_2; detail: "source_verifier_rejected" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "HASH_MISMATCH"; source: SourceV0_2; detail: "artifact_hash_mismatch" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "SOURCE_VERIFIER_UNAVAILABLE"; source: SourceV0_2; detail: "source_verifier_unavailable" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID"; source: SourceV0_2; detail: "context_binding_invalid" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "PRIVACY_SCOPE_KEY_UNAVAILABLE"; source: SourceV0_2; detail: "privacy_scope_key_unavailable" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "SCOPE_TOKEN_CANONICALIZATION_INVALID"; source: SourceV0_2; detail: "scope_token_canonicalization_invalid" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "PRIVACY_SCOPE_DIGEST_INVALID"; source: SourceV0_2; detail: "privacy_scope_digest_invalid" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "TIMEZONE_PROFILE_INVALID"; source: "google_calendar"; detail: "timezone_profile_invalid" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "SOURCE_ATTESTATION_BINDING_MISMATCH"; source: SourceV0_2; detail: "source_attestation_binding_mismatch" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "RECORD_ID_SET_MISMATCH"; source: SourceV0_2; detail: "record_id_set_mismatch" }>
  | Readonly<{ stage: "source_attestation"; failureCode: "COVERAGE_INVALID"; source: SourceV0_2; detail: "coverage_invalid" }>;

type SanitizedDiagnosticV0_2 =
  | SanitizedGlobalDiagnosticV0_2
  | SanitizedSourceDiagnosticV0_2;

declare const COMMON_MAX_PROJECTED_RECORDS_PER_INVOCATION_V0_2: 50_000_000;
type ProjectedRecordCountV0_2 = number;

type RejectedSourceStatusForPairV0_2<
  S extends SourceV0_2,
  C extends SourceVerificationStage3FailureCodeV0_2,
  D extends string,
> = Readonly<{
  source: S;
  status: "rejected";
  requested: true;
  verified: false;
  authoritative: false;
  verifierId: string;
  verifierVersion: string;
  projectedRecordCount: null;
  failureCode: C;
  failureDetail: D;
  diagnostics: readonly [
    Readonly<
      Omit<
        Extract<SanitizedSourceDiagnosticV0_2, { failureCode: C; detail: D }>,
        "source"
      > & { readonly source: S }
    >,
  ];
}>;

type CalendarTimezoneRejectedSourceStatusV0_2<S extends SourceV0_2> =
  [S] extends ["google_calendar"]
    ? RejectedSourceStatusForPairV0_2<
        S,
        "TIMEZONE_PROFILE_INVALID",
        "timezone_profile_invalid"
      >
    : never;

type SanitizedRejectedSourceStatusV0_2<S extends SourceV0_2> =
  | RejectedSourceStatusForPairV0_2<S, "INPUT_INVALID", "source_verifier_trapped">
  | RejectedSourceStatusForPairV0_2<S, "SOURCE_BINDING_INVALID", "source_bundle_invalid">
  | RejectedSourceStatusForPairV0_2<S, "SOURCE_ATTESTATION_INVALID", "collector_seal_invalid">
  | RejectedSourceStatusForPairV0_2<S, "SOURCE_ATTESTATION_INVALID", "source_verifier_rejected">
  | RejectedSourceStatusForPairV0_2<S, "HASH_MISMATCH", "artifact_hash_mismatch">
  | RejectedSourceStatusForPairV0_2<S, "PRIVACY_SCOPE_CONTEXT_INVALID", "context_binding_invalid">
  | RejectedSourceStatusForPairV0_2<S, "PRIVACY_SCOPE_KEY_UNAVAILABLE", "privacy_scope_key_unavailable">
  | RejectedSourceStatusForPairV0_2<S, "SCOPE_TOKEN_CANONICALIZATION_INVALID", "scope_token_canonicalization_invalid">
  | RejectedSourceStatusForPairV0_2<S, "PRIVACY_SCOPE_DIGEST_INVALID", "privacy_scope_digest_invalid">
  | CalendarTimezoneRejectedSourceStatusV0_2<S>
  | RejectedSourceStatusForPairV0_2<S, "SOURCE_ATTESTATION_BINDING_MISMATCH", "source_attestation_binding_mismatch">
  | RejectedSourceStatusForPairV0_2<S, "RECORD_ID_SET_MISMATCH", "record_id_set_mismatch">
  | RejectedSourceStatusForPairV0_2<S, "COVERAGE_INVALID", "coverage_invalid">;

type SanitizedSourceStatusV0_2<S extends SourceV0_2> =
  | Readonly<{
      source: S;
      status: "not_requested";
      requested: false;
      verified: false;
      authoritative: false;
      verifierId: null;
      verifierVersion: null;
      projectedRecordCount: null;
      failureCode: null;
      failureDetail: null;
      diagnostics: readonly [];
    }>
  | Readonly<{
      source: S;
      status: "unavailable";
      requested: true;
      verified: false;
      authoritative: false;
      verifierId: null;
      verifierVersion: null;
      projectedRecordCount: null;
      failureCode: "SOURCE_VERIFIER_UNAVAILABLE";
      failureDetail: "source_verifier_unavailable";
      diagnostics: readonly [
        Readonly<{
          stage: "source_attestation";
          failureCode: "SOURCE_VERIFIER_UNAVAILABLE";
          source: S;
          detail: "source_verifier_unavailable";
        }>,
      ];
    }>
  | SanitizedRejectedSourceStatusV0_2<S>
  | Readonly<{
      source: S;
      status: "aborted";
      requested: true;
      verified: false;
      authoritative: false;
      verifierId: null;
      verifierVersion: null;
      projectedRecordCount: null;
      failureCode: null;
      failureDetail: null;
      diagnostics: readonly [];
    }>
  | Readonly<{
      source: S;
      status: "verified";
      requested: true;
      verified: true;
      authoritative: false;
      verifierId: string;
      verifierVersion: string;
      projectedRecordCount: ProjectedRecordCountV0_2;
      failureCode: null;
      failureDetail: null;
      diagnostics: readonly [];
    }>;

type SanitizedSourceStatusesV0_2 = readonly [
  SanitizedSourceStatusV0_2<"github">,
  SanitizedSourceStatusV0_2<"codex">,
  SanitizedSourceStatusV0_2<"google_calendar">,
  SanitizedSourceStatusV0_2<"notion">,
  SanitizedSourceStatusV0_2<"dayflow">,
];

type SuccessfulSanitizedSourceStatusesV0_2 = readonly [
  Extract<SanitizedSourceStatusV0_2<"github">, { status: "not_requested" | "verified" }>,
  Extract<SanitizedSourceStatusV0_2<"codex">, { status: "not_requested" | "verified" }>,
  Extract<SanitizedSourceStatusV0_2<"google_calendar">, { status: "not_requested" | "verified" }>,
  Extract<SanitizedSourceStatusV0_2<"notion">, { status: "not_requested" | "verified" }>,
  Extract<SanitizedSourceStatusV0_2<"dayflow">, { status: "not_requested" | "verified" }>,
];

type ExactV0_1PreflightFailureV0_2 = Extract<
  ExecuteAuthoritativeVerificationKernelInternalResultV0_1,
  { readonly executed: false }
>;

type ExactV0_1EmptyPlanCompletionV0_2 = Extract<
  ExecuteAuthoritativeVerificationKernelInternalResultV0_1,
  { readonly executed: true }
>;

type SourceVerificationStage3ResultV0_2 =
  | Readonly<{
      executed: false;
      authoritative: false;
      failedStage: "source_attestation";
      failureCode: SourceVerificationStage3FailureCodeV0_2;
      diagnostics: readonly [SanitizedDiagnosticV0_2, ...SanitizedDiagnosticV0_2[]];
      sources: SanitizedSourceStatusesV0_2;
    }>
  | Readonly<{
      executed: true;
      verified: true;
      authoritative: false;
      failureCode: null;
      stageOrder: readonly [
        "intrinsic_receipt",
        "record_set_binding",
        "source_attestation",
      ];
      stageStatus: Readonly<{
        intrinsicReceipt: "verified";
        recordSetBinding: "verified";
        sourceAttestation: "verified";
      }>;
      sources: SuccessfulSanitizedSourceStatusesV0_2;
      diagnostics: readonly [];
    }>;

type ExecuteSourceVerificationKernelResultV0_2 =
  | ExactV0_1PreflightFailureV0_2
  | ExactV0_1EmptyPlanCompletionV0_2
  | SourceVerificationStage3ResultV0_2;
```

The exact V0.1 failure branch is returned unchanged, with no V0.2 fields added. The exact V0.1 empty
plan completion branch is also returned unchanged after the fresh V0.2 runtime boundary passes; it
retains `sourceAttestation: "not_required"`, empty diagnostics and requirements, has no `verified`
field, and remains `authoritative: false`. The V0.2 Stage 3 branch is used only when at least one
source was requested. Its source tuple always has exactly five entries in fixed source order.

The Stage 3 failure-code union above is exact. Stage 1/2-only V0.1 codes may appear only inside an
unchanged `ExactV0_1PreflightFailureV0_2`; they are not legal in a V0.2 Stage 3 result. The diagnostic
union is a closed union of legal code/detail/source-scope triples, not a cross product. Each failed
source exposes exactly one source diagnostic selected from its internally collected candidates by
the Section 10 precedence and detail order. Aggregate diagnostics are the exact deduplicated list of
those source diagnostics plus any global diagnostic, ordered global first and then fixed source
order. A Stage 3 failure has 1 through 32 diagnostics; success has exactly zero.

`TIMEZONE_PROFILE_INVALID` / `timezone_profile_invalid` is the one source-restricted pair. Its
diagnostic source is the literal `google_calendar`; its returned-rejection code and rejected-status
variant exist only when the source type parameter is exactly `google_calendar`. For `github`,
`codex`, `notion`, and `dayflow`, the conditional variant resolves to `never`, so none of those
source result, diagnostic, or status types can carry the pair.

Blocking type-contract acceptance MUST include one positive fixture for the exact Google Calendar
rejected result, diagnostic, and status, plus separate negative compile-time fixtures proving the
same code/detail pair is rejected for GitHub, Codex, Notion, and Dayflow. A broad-source fixture or
runtime-only prose check cannot satisfy this gate.

Every status is exact-key and the five discriminants above are exhaustive. `not_requested` and
`aborted` forbid verifier identity, failure, projected count, and diagnostics by requiring literal
`null`/empty values. `unavailable` requires null verifier identity and its one exact unavailable
failure. `rejected` requires the exact available capability identity and one closed source-local
code/detail diagnostic. `verified` requires the exact available capability identity, no failure or
diagnostic, and the projected count. No status admits record IDs, record hashes, record-set
fingerprints, artifact hashes, scope digests, payloads, or any other count or flag. Unknown keys are
rejected, so combinations such as `not_requested` plus `HASH_MISMATCH` are structurally impossible.

`projectedRecordCount` is accepted only when `Number.isSafeInteger(value)`, `0 <= value`, the value
is not negative zero, and `value <= COMMON_MAX_PROJECTED_RECORDS_PER_INVOCATION_V0_2` (50,000,000).
The sum across verified statuses is also at most that common deterministic projected-record cap.
`NaN`, infinities, negative values, fractions, unsafe integers, and larger values are invalid.

`SanitizedDiagnosticV0_2` has exactly the four shown keys. Diagnostics are deduplicated and ordered
by global (`source: null`) first, then fixed source order, then their union declaration order.
Each diagnostic's RFC 8785 JCS encoding is at most 256 UTF-8 bytes and the aggregate diagnostics
encoding is at most 8,192 bytes. Crossing either cap yields one global
`RESOURCE_LIMIT_EXCEEDED`/`invocation_resource_limit_exceeded` diagnostic and aborts remaining work.

No success branch has an `authoritative: true` variant. Raw evidence, account identifiers, scope
tokens, keys, key handles, bundles, envelopes, attestations, coverage payloads, replayed projections,
and underlying exceptions are transient and MUST NOT be returned. Diagnostics use bounded enums and
never contain source payload text. Arbitrary callback strings and exception messages are discarded
without transformation and are never returned or logged.

## 9. Execution algorithm within the existing three stages

### 9.1 V0.2 wrapper strategy

The recommended implementation is a new private V0.2 wrapper. It does not edit, replace, widen, or
reinterpret V0.1. It uses the accepted V0.1 kernel as an exact preflight:

1. The trusted runtime constructs canonical module-owned V0.1 unavailable-only registry and
   structurally valid runtime inputs solely for preflight.
2. The wrapper invokes `executeAuthoritativeVerificationKernelInternalV0_1` with the original
   receipt, record set, and source bundle presence map.
3. Any V0.1 failure other than the exact unavailable-only continuation sentinel below is returned
   unchanged and immediately short-circuits. No V0.2 snapshot is acquired and no source executable
   is invoked. Arbitrary V0.1 failure output is never reinterpreted as preflight success.
4. The requested-source continuation sentinel must be a deeply frozen exact-key V0.1 failure with
   `executed: false`, `authoritative: false`, `failedStage: "source_attestation"`, primary
   `failureCode: "SOURCE_VERIFIER_UNAVAILABLE"`, `requiredSourceVerifications` equal to the exact
   dense requested entries in fixed five-source order, and `diagnostics` containing exactly one
   entry per requested source in that same order. Every diagnostic must have only
   `{ stage: "source_attestation", failureCode: "SOURCE_VERIFIER_UNAVAILABLE", source,
   detail: "source_verifier_unavailable" }`. There are no duplicate, missing, extra, reordered, or
   additional fields or diagnostics.
5. The empty-plan sentinel must be the deeply frozen exact-key V0.1 completion:
   `executed: true`, `authoritative: false`, `failureCode: null`, exact three-element `stageOrder`,
   exact `stageStatus` values `verified`, `verified`, and `not_required`, `diagnostics: []`, and
   `requiredSourceVerifications: []`, with no extra fields.
6. Any structural deviation in either sentinel stops the wrapper and cannot authorize Stage 3.
7. Only after one exact sentinel is recognized does the runtime acquire a fresh V0.2 snapshot
   inside the invocation immediately before the Stage 3 boundary. Acquisition atomically checks the
   current registry generation and all lifecycle material. The runtime checks current generation
   again immediately before either the first callback or the unchanged empty-plan return. An empty
   plan bypasses no snapshot validity, lifecycle, capability-correspondence, or current-generation
   check. After those exact boundaries pass, it returns the unchanged V0.1 completion. With
   requested sources, V0.2 performs its separate Stage 3 proof and returns only its Stage 3 branch.

This strategy preserves exact accepted V0.1 Stage 1 and Stage 2 behavior without copying their
logic or modifying the accepted file. Colin must approve this wrapper strategy before implementation.

### 9.2 Stage 1: intrinsic receipt

- Execute exact V0.1 intrinsic receipt behavior.
- Preserve its input hardening, caps, detached-hash semantics, failure code, and short-circuit.
- Do not inspect or invoke a V0.2 source verifier after failure.

### 9.3 Stage 2: record-set binding

- Execute exact V0.1 record-set structural parsing, detached self-hash verification, authoritative
  record-set verification, root-hash and `asOf` binding, per-source count, and record-ID-set hash.
- Preserve the frozen V0.1 mapping in which a per-source `recordCount` or record-ID-set disagreement
  is `RECORD_ID_SET_MISMATCH`; root-hash and `asOf` diagnostics are not evaluated or emitted while
  either per-source predicate applies, so `RECORD_SET_BINDING_MISMATCH` is not legal for a combined
  mismatch.
- Preserve V0.1 primary failure selection and short-circuit.
- Retain the verified record set only transiently so Stage 3 can construct exact source partitions.

### 9.4 Stage 3: source attestation

After V0.1 preflight proves Stage 1 and Stage 2 passed:

1. Acquire exactly one fresh runtime-owned atomic snapshot inside the invocation immediately before
   Stage 3 for the current internal `verificationInvocationId`. The trusted runtime samples
   `issuedAt` at snapshot creation and `verificationStartedAt` from the same clock immediately after
   creation, enforcing `issuedAt <= verificationStartedAt < expiresAt`. Atomically check current
   registry generation at acquisition and again immediately before the first callback. Reject a
   stale, missing, consumed, caller-mintable, forged, lifecycle-invalid, or generation-mismatched
   snapshot before any source callback.
2. Validate common caps, capability metadata, executable-table correspondence, context and key
   lifecycle, timezone snapshot when required, bundle presence, and envelope shape before any
   enumeration, hashing, or callback that depends on those values.
3. Keep the Stage 2 expected partition and receipt binding solely in common-kernel private state.
   Process source entries serially in fixed order: GitHub, Codex, Google Calendar, Notion, Dayflow.
4. For `not_requested`, require no bundle or envelope and emit sanitized `not_requested` status.
5. For requested `unavailable`, require the capability entry to be explicitly unavailable, invoke
   no executable, add `SOURCE_VERIFIER_UNAVAILABLE`, and continue collecting bounded deterministic
   statuses for later sources.
6. For requested `available`, require an exact executable-table match and then:
   - validate the collector seal and all account, context, request, attempt, manifest, lifecycle,
     and capability-version bindings;
   - reparse the source bundle and frozen evidence under its exact source bundle contract;
   - verify manifest and artifact-set hashes and the source-specific collection proof;
   - derive participation, operation statuses, canonical coverage, and the exact neutral issue set;
   - replay the pinned Common Evidence projection from the verified frozen evidence without
     receiving any expected Stage 2 value;
   - let the common kernel compare record count and the canonical record-ID set first;
   - only when IDs agree, let the common kernel compare each same-ID canonical record, provenance,
     source binding, and canonical projected content exactly with the Stage 2 source partition;
   - compare source artifact schema and hash, adapter identity and version, input contract,
     projection version, `collectedAt`, required operations, provenance, coverage, attestation, and
     issue codes with the V0.1 receipt binding; and
   - mark the source `verified: true, authoritative: false` only when every comparison passes.
7. Apply the global-abort/source-local-continuation matrix in Section 10.1. A mechanically proven
   isolated local
   rejection does not change later source order. A global failure aborts every remaining callback.
   No aggregate success exists unless every requested source is verified and every not-requested
   source is cleanly absent. An empty requested plan uses the exact V0.1 completion branch instead.
8. Destroy or release transient bundle, attestation, projection, digest preimage, and key-handle
   references before returning the sanitized deeply frozen result.

Source executables must be deterministic and side-effect free. They cannot perform I/O, mutate
runtime state, choose a model, or call another source.

## 10. Deterministic failure mapping and precedence

No new public failure code is introduced. Stage 1 and Stage 2 use the exact V0.1 mapping and
precedence, including per-source count/ID-set mismatch -> `RECORD_ID_SET_MISMATCH` and suppression
of inapplicable root/`asOf` diagnostics in combined mismatches. Stage 3 accepts only
`SourceVerificationStage3FailureCodeV0_2` and selects the primary code using
the accepted `selectLineageFailureCodeInternalV0_1("source_attestation", candidates)` order:

1. `RESOURCE_LIMIT_EXCEEDED`
2. `INPUT_INVALID`
3. `SOURCE_BINDING_INVALID`
4. `SOURCE_ATTESTATION_INVALID`
5. `HASH_MISMATCH`
6. `SOURCE_VERIFIER_UNAVAILABLE`
7. `PRIVACY_SCOPE_CONTEXT_INVALID`
8. `PRIVACY_SCOPE_KEY_UNAVAILABLE`
9. `SCOPE_TOKEN_CANONICALIZATION_INVALID`
10. `PRIVACY_SCOPE_DIGEST_INVALID`
11. `TIMEZONE_PROFILE_INVALID`
12. `SOURCE_ATTESTATION_BINDING_MISMATCH`
13. `RECORD_ID_SET_MISMATCH`
14. `COVERAGE_INVALID`

The legal Stage 3 mapping is exact and closed:

| Mechanically observed condition | Existing failure code | Sanitized detail | Scope and handling |
| --- | --- | --- | --- |
| Deterministic callback/count/byte/work/diagnostic cap reservation or charge would exceed its maximum | `RESOURCE_LIMIT_EXCEEDED` | `invocation_resource_limit_exceeded` | Global; abort remaining callbacks |
| Snapshot malformed, forged, or not atomically acquired | `INPUT_INVALID` | `runtime_snapshot_invalid` | Global before callbacks |
| Snapshot stale under Section 11 | `INPUT_INVALID` | `runtime_snapshot_stale` | Global before callback or empty-plan return |
| Runtime integrity or deterministic counter corruption is detected while the sanitized return boundary remains intact | `INPUT_INVALID` | `runtime_corruption` | Global; abort remaining callbacks |
| Capability metadata/executable-table correspondence differs | `INPUT_INVALID` | `capability_correspondence_invalid` | Global; abort remaining callbacks |
| Caught source-local synchronous exception or declared sandbox rejection satisfies every Section 10.1 containment predicate | `INPUT_INVALID` | `source_verifier_trapped` | Source-local; discard executor data and continue |
| Missing, extra, wrong-source, or mode-incompatible bundle | `SOURCE_BINDING_INVALID` | `source_bundle_invalid` | Source-local; no affected callback |
| Collector seal, envelope, attestation, or verifier return invalid; or an allowed callback rejection maps to this code | `SOURCE_ATTESTATION_INVALID` | `collector_seal_invalid` or `source_verifier_rejected` as applicable | Source-local; never partial coverage |
| Detached manifest or artifact self-hash mismatch | `HASH_MISMATCH` | `artifact_hash_mismatch` | Source-local; distinct from authenticity |
| Requested source has explicit unavailable capability | `SOURCE_VERIFIER_UNAVAILABLE` | `source_verifier_unavailable` | Source-local; no executable invocation |
| Context, case, dataset, account/user, comparison scope, run, request, attempt, or lifecycle binding invalid | `PRIVACY_SCOPE_CONTEXT_INVALID` | `context_binding_invalid` | Source-local; cross-scope replay rejected |
| Privacy-scope HMAC key or restricted handle unavailable or lifecycle-invalid | `PRIVACY_SCOPE_KEY_UNAVAILABLE` | `privacy_scope_key_unavailable` | Source-local; collector-seal keys do not use this code |
| Scope token uses wrong canonicalization | `SCOPE_TOKEN_CANONICALIZATION_INVALID` | `scope_token_canonicalization_invalid` | Source-local; no fallback normalization |
| Privacy-scope digest mismatch | `PRIVACY_SCOPE_DIGEST_INVALID` | `privacy_scope_digest_invalid` | Source-local; compared tokens remain private |
| Calendar timezone profile missing, mismatched, or unpinned | `TIMEZONE_PROFILE_INVALID` | `timezone_profile_invalid` | Google Calendar only; source must be the literal `google_calendar`; no host fallback; structurally forbidden for GitHub, Codex, Notion, and Dayflow |
| Replayed projected record count or canonical record-ID set differs | `RECORD_ID_SET_MISMATCH` | `record_id_set_mismatch` | Source-local; not content mismatch |
| IDs agree but canonical same-ID content, provenance, source, envelope, or receipt binding differs | `SOURCE_ATTESTATION_BINDING_MISMATCH` | `source_attestation_binding_mismatch` | Source-local; exact same-ID comparison |
| Derived operation status, coverage, or issue set is unsupported or mismatched | `COVERAGE_INVALID` | `coverage_invalid` | Source-local; integrity failure is not partial coverage |

An internal diagnostic may identify the source and a bounded enum detail. It must not contain raw
exception messages, paths, provider payloads, identifiers, tokens, or evidence text. All candidate
failures for safe-to-process sources are collected in fixed source order before the existing Stage
3 selector chooses one primary code.

The Calendar row is not reusable source-local vocabulary. The parser and type contract MUST accept
its exact pair for `google_calendar` and MUST reject that pair for each of `github`, `codex`,
`notion`, and `dayflow` before aggregate status construction.

The failure order is always structural/intrinsic receipt, then record-set binding, then source
attestation. Within Stage 3, source processing is serial in the fixed five-source order, record count
and ID-set comparison precedes same-ID content/binding comparison, and the frozen V0.1 Stage 3 code
precedence above selects the primary failure. Within one code, fixed source order and then the closed
diagnostic-union declaration order select the primary detail. Elapsed completion timing, callback
completion timing, diagnostic insertion timing, scheduling, or host enumeration order never selects
or replaces the primary failure.

### 10.1 Global abort and source-local continuation matrix

A callback outcome is source-local only when every following fact is mechanically observed:

1. Control returns through the registered invocation frame while its process or worker remains live.
2. The outcome is either a normally returned, exact-key `outcome: "rejected"` value with one allowed
   rejection code, a synchronously caught exception, or the sandbox's closed
   `sandbox_policy_rejection` status. No arbitrary error text participates.
3. The snapshot object identity, invocation ID, current generation, executable-table identity, and
   immutable registry references remain equal to their pre-callback values.
4. Every deterministic counter is readable as a non-negative safe integer, never decreased, and is
   within both its pre-reserved callback budget and cumulative common cap.
5. The sandbox completion record proves no I/O, authority escape, mutable alias escape, or mutation
   of runtime-owned state. Absence of that exact completion record is not proof of containment.

The exact matrix is:

| Mechanically observed event | Scope | Contract outcome |
| --- | --- | --- |
| Normal exact returned rejection with all five predicates true | Source-local | Map its allowed code to the closed detail, discard all other executor data, continue in fixed order |
| Caught synchronous exception or closed `sandbox_policy_rejection` with all five predicates true | Source-local | `INPUT_INVALID` / `source_verifier_trapped`; continue in fixed order |
| Invalid/stale/forged/replayed/consumed snapshot or metadata/table mismatch | Global | Closed global `INPUT_INVALID`; no remaining callback |
| Deterministic cap exhaustion with counters still trustworthy | Global | Closed global `RESOURCE_LIMIT_EXCEEDED`; no remaining callback |
| Counter corruption/unavailability, executable-table corruption, snapshot corruption, or any state in which containment cannot be proven | Global | Closed global `INPUT_INVALID` only if the runtime can still prove the sanitized return boundary; otherwise operationally incomplete/unsealed |
| Process or worker loss, elapsed-time timeout/watchdog kill, host memory/resource termination, or loss of the return boundary | Global | Operationally incomplete/unsealed; return no lineage contract result or competing failure |

Callbacks are never raced or executed in parallel. The kernel establishes all five
`not_requested` statuses from the validated plan before invoking anything, so they remain
`not_requested` on either global-abort path. The requested source active at a global abort and every
later requested source are `aborted`; their status carries no local diagnostic or verifier identity.
Source-local continuation exists only for the exact predicates above. Fixed source order and the
Section 10 precedence select every returned primary failure; elapsed completion timing never does.

## 11. Runtime ownership and lifecycle

### 11.1 Snapshot issuance and one verification time

After the exact V0.1 sentinel and inside the same invocation immediately before Stage 3, the runtime
atomically reads the current registry generation and creates the immutable one-shot snapshot. Its
`issuedAt` is the trusted runtime snapshot-creation time, sampled by the same canonical UTC
millisecond clock that then samples `t = verificationStartedAt` immediately after creation. The
runtime rejects clock output or snapshot data unless
`issuedAt <= verificationStartedAt < expiresAt`.

Every context, key, handle, capability, envelope, and timezone lifecycle check uses exactly `t`.
Caller clocks, provider timestamps, repeated wall-clock `now()` calls, monotonic elapsed time, and
host timezone conversions cannot replace it. The acquisition boundary checks generation currentness
atomically with creation. The kernel checks that same generation again immediately before either
the first callback or, for an empty plan, the unchanged V0.1 return.

The snapshot is single-use and is consumed on any completed success, failure, or caught abort. It is
stale on both callback and empty-plan paths if it was not created for the current invocation ID, was
already consumed, is not the current atomic generation at acquisition or at the second boundary,
or any snapshot lifecycle condition is invalid at `t`. A watchdog/process-loss attempt is
operationally incomplete/unsealed and invalidates the snapshot before any retry. A snapshot cannot
be cached, supplied, retained, or replayed by a caller or callback.

### 11.2 Exact inequalities

A runtime snapshot or context registration is active exactly when:

```text
issuedAt <= t (= verificationStartedAt)
AND t < expiresAt
AND (revokedAt is null OR t < revokedAt)
AND issuedAt < expiresAt
```

A privacy or collector-seal key is active exactly when:

```text
issuedAt <= t
AND t < expiresAt
AND (revokedAt is null OR t < revokedAt)
AND (deletedAt is null OR t < deletedAt)
AND issuedAt < expiresAt
```

Equality at `expiresAt`, `revokedAt`, or `deletedAt` is invalid. Equality at `issuedAt` is valid.
All timestamps must satisfy the accepted V0.1 canonical timestamp rules, including rejection of year
`0000`. For the snapshot, `issuedAt` is specifically its trusted runtime creation time, not registry
publication time, invocation-request time, or a caller field. A malformed or internally
contradictory lifecycle fails closed.

The exact envelope chronology is:

```text
attemptedAt <= collectedAt <= sealedAt <= verificationStartedAt
startedAt is null => completedAt is null
startedAt is non-null => attemptedAt <= startedAt <= collectedAt
completedAt is non-null => startedAt is non-null AND startedAt <= completedAt <= collectedAt
```

No other null combination is valid. The trusted seal operation, not its caller, supplies `sealedAt`.
The exact restricted collector-seal handle registration and its exact key lifecycle record must both
be active under the key inequality above at `sealedAt` and again at `verificationStartedAt`; equality
with expiry, revocation, or deletion at either check fails closed.

### 11.3 Exact scope binding

The envelope and runtime registration must agree exactly on:

- context ID;
- frozen evaluation case ID;
- dataset version and SHA-256;
- private account or user scope digest;
- comparison-scope ID;
- verification run ID;
- request binding digest; and
- collection-attempt binding digest.

The comparison-scope ID must be an exact member of the registered immutable authorized scope.
`verificationRunId` is the stable evaluation/collection run identity and may be reverified only in
the same bound case, dataset, account/user, comparison scope, request, and collection attempt while
all lifecycle material remains active. Every reverification is a fresh kernel invocation with a
distinct internal `verificationInvocationId` and freshly acquired one-shot snapshot. That invocation
ID is never serialized, returned, logged, or accepted as authority. Reuse across another case,
dataset, account/user, comparison scope, run, request, or attempt is rejected. Re-signing expired or
revoked material is a new collection operation, not replay.

### 11.4 Key and purpose separation

Key versions are explicit, immutable identifiers. A key version is resolved only within the same
atomic runtime generation. Privacy-scope and collector-seal handles expose different operations and
purposes and must be backed by different key material. A handle or version mismatch fails closed.
No raw key byte enters a bundle, envelope, result, diagnostic, log, fixture, or Git artifact.

## 12. Privacy, retention, and leakage

- V0.2 adds no persistence and changes no retention or deletion policy.
- Raw provider evidence, screenshots, OCR text, conversation content, resource IDs, account IDs,
  source tokens, manifests, bundles, envelopes, transient projections, and keys remain in approved
  private transient storage only.
- Git-tracked documentation and tests contain fictional values only. Production evidence cannot be
  promoted to a fixture or evaluation dataset without the existing lawful-basis, minimization,
  anonymization, review, version, and hash process.
- Sanitized results contain only the exact bounded status and diagnostic contracts in Section 8.5,
  including optional verified record count. They contain no record ID, record-set fingerprint,
  title, summary, ranking, caveat, evidence excerpt, path, URL, account identity, provider error text,
  or private diagnostic.
- Operational logging records only bounded codes and non-secret versions required for
  reproducibility. It never records HMAC preimages, key material, private identifiers, transient
  bundles, projections, attestations, envelopes, exception strings, private diagnostics, or payloads.
- Failure, throw, timeout simulation, and hostile input must not widen result or log content.
- If an internal comparison fingerprint is necessary, it must use the privacy HMAC, be domain-bound
  to the exact case and stable verification run, remain invocation-private, and never be returned or
  logged. A stable cross-run unsalted record-set fingerprint is forbidden.

## 13. Resource, DoS, and hostile-JavaScript requirements

Common validation reuses accepted V0.1 limits where applicable:

| Existing V0.1 limit | V0.2 use |
| --- | --- |
| Maximum canonical receipt bytes: 262,144 | V0.1 preflight unchanged |
| Maximum canonical source-attestation bytes: 131,072 | Recomputed V0.1 attestation unchanged |
| Maximum private HMAC preimage bytes: 1,048,576 | Upper bound for privacy and proposed collector-seal preimages |
| Maximum source bindings: 5 | Exact fixed source set |
| Maximum coverage intervals per binding: 1,024 | Source coverage replay |
| Maximum neutral issue codes per binding: 32 | Exact derived issue set |
| Maximum input graph depth: 32 | Common untrusted graph traversal |
| Maximum enumerable own properties: 16,384 | Common untrusted artifact traversal |
| Maximum runtime contract array length: 1,024 | Private runtime arrays |

Each source slice MUST freeze source-bundle byte, item, page, manifest-entry, string, and projection
caps before implementation. Those values are source bundle sub-contract prerequisites and are not
invented by this common proposal.

The common cumulative per-invocation caps proposed for freeze are exact:

| Deterministic V0.2 cumulative cap | Exact maximum and accounting rule |
| --- | --- |
| Source callback invocations | 5, each charged once before serial invocation in fixed source order |
| Validated canonical private bytes | 5,242,880 UTF-8 bytes total across envelopes, frozen contracts/caps, bundles, manifests, artifacts, and callback results; each canonical byte is charged once to this byte cap |
| Projected records | 50,000,000 total across all callbacks; each projected record is also one verifier-work unit |
| Verifier work | 50,000,000 units total under the exact formula below |
| Sanitized diagnostics | 32 entries, 256 JCS bytes each, and 8,192 JCS bytes in aggregate |

For canonical validated input `I` and one exact frozen verifier contract `C`, verifier work is:

```text
WU(I, C) = callbackInvocations
         + visitedOwnProperties
         + visitedArrayElements
         + manifestEntries
         + evidenceItems
         + coverageIntervals
         + projectedRecords
         + canonicalizationUtf8Bytes
         + sha256InputBytes
         + hmacInputBytes
```

Every term is a non-negative safe-integer count determined solely from bounded canonical `I` and the
operations required by `C`; every coefficient is exactly one. A value that appears in two named
operations is charged once for each operation, while no operation may charge based on CPU time,
wall time, scheduling, allocation speed, callback completion order, or host load. Each later source
contract must freeze its own equal-or-lower byte/count caps and the exact required operation list; it
cannot raise common totals or introduce time-priced work.

Before an operation or callback, the kernel charges or reserves its entire deterministic cost. A
callback reservation is not refunded based on early return or speed. If a callback/count/byte/work/
diagnostic reservation or charge would exceed a common total, the exact outcome is the global
`RESOURCE_LIMIT_EXCEEDED` / `invocation_resource_limit_exceeded` failure, which has highest Stage 3
precedence and aborts every remaining callback. These common totals are runtime safety limits, not
fabricated provider bundle identities, versions, hashes, or claims of operational capacity.

An implementation may additionally use a wall-clock or monotonic elapsed-time watchdog solely as
an operational kill switch. Its duration is not frozen here and it is not a result-producing cap,
canonical input, snapshot field, envelope field, seal preimage, diagnostic, primary-failure input,
or sealed/evaluated result. If it interrupts execution, the whole verification attempt is
operationally incomplete/unsealed and returns no competing lineage failure; it does not alter an
already sealed collection envelope. Retrying requires a fresh invocation and snapshot. Therefore
identical canonical inputs, runtime generation, and frozen contracts yield the same completed
contract result independent of wall time.

Validation order is mandatory:

1. Reject non-ordinary prototypes, accessors, proxies, symbols, cycles, shared aliases, sparse
   arrays, unexpected keys, and mutable nested values.
2. Read bounded scalar lengths before `ownKeys`, full enumeration, canonicalization, hashing, or
   callback.
3. Enforce graph depth, total own-property, array, byte, string, and source-specific item caps.
4. Materialize validated plain data without invoking caller getters.
5. Canonicalize and hash only after caps pass.
6. Resolve and invoke a runtime-owned verifier only after every common pre-callback boundary passes.

Safe references to required intrinsics must be captured at module initialization and invoked with
safe apply semantics. Post-import mutation of `Array`, `Set`, `String`, `Object`, `Reflect`, hashing
helpers, prototypes, or collection methods must not bypass checks or change deterministic output.
Callback input is deeply frozen private material. A callback cannot retain authority after the
atomic generation ends. Any attempted mutation, alias escape, or malformed callback result fails
closed and is sanitized.

## 14. Five-source proof matrix

The table defines common proof obligations and known sub-contract prerequisites. It does not assert
that any provider trust root or bundle contract currently exists.

| Source and mode | Trusted private inputs required | Proof required | Unresolved source bundle sub-contract |
| --- | --- | --- | --- |
| GitHub `repository_scope` | Sealed authorized repository scope, account/context digest, request and attempt binding, repository manifest, pinned adapter/projection versions | Reparse repository identity evidence; recompute privacy scope digest; prove exact requested/observed repository set; replay exact repository-scope records | Manifest schema and caps; repository token canonicalization inputs; collector identity and key provisioning; exact projection version |
| GitHub `repository_activity` | All repository-scope inputs plus requested UTC activity window, ordered page/artifact manifest, pagination and continuation evidence, bounded diagnostics | Verify page chain and artifact hashes; derive pagination and canonical covered intervals; replay activity records; compare exact content/count/IDs/provenance/coverage | Page and continuation proof schema; event canonicalization; duplicate/order rules; exact time and item caps |
| Codex project and conversation windows | Sealed project scope, private conversation manifest, requested conversation window, collection accounting and bounded diagnostic evidence | Verify project binding and conversation artifact chain; derive covered intervals and collection status; replay exact neutral Common Evidence records | Origin/authenticity model for local conversation artifacts; manifest schema; conversation normalization and projection versions; caps |
| Notion `resource_scope` and `resource_collection` | Explicit authorized resource-set tokens/digest, resource artifact manifest, pagination evidence, request and attempt binding | Compare exact requested and observed resource sets; verify pagination and resource artifacts; replay scoped records; never infer workspace coverage | Resource token canonicalization inputs; collection/page manifest; pagination proof; projection version and caps |
| Google Calendar pinned timezone/window | Requested UTC window, event artifact manifest, sealed timezone evidence or bounded unknown diagnostic, frozen approved timezone profile | Verify event chain; validate exact pinned release/profile; normalize only through frozen profile; derive interval coverage; replay exact records | Approved profile artifact and exact profile SHA-256; event manifest and normalization contract; recurrence and cancellation rules; caps |
| Dayflow capture and preprocessing chain | Capture artifact manifest, capture window/accounting, preprocessing manifest, privacy/OCR preprocessing versions, neutral evidence artifact set, bounded diagnostics | Verify capture-to-preprocessing input/output hash chain; derive independent capture and preprocessing coverage; replay evidence-only Common Evidence records | Capture authenticity and manifest contract; preprocessing manifest schema; neutral OCR/span contract; projection version and caps |

Dayflow output is limited to privacy-minimized OCR text or spans, app/screen/activity observations,
capture time range, confidence, coverage, provenance, preprocessing version, conflicts, omissions, and
errors. It must not produce structured source facts, suggestion titles, summaries, rankings,
caveats, `semanticOutput`, `RECENT_FOCUS`, `VISIBLE_TASK_INTENT`, or final output paths.

Before a Dayflow verifier slice can freeze, its source contract must define a positive, exact-key
allowlist of neutral record types and fields for those evidence categories. An absent allowlist is a
blocking prerequisite, not an implementation choice. Unknown fields and any renamed, nested,
encoded, aliased, or otherwise disguised suggestion-shaped title, summary, ranking, caveat,
recommendation, intent, semantic output, or final-output field fail closed.

Notion proof is limited to explicitly registered resources and collections. It cannot make a
workspace-wide coverage claim. GitHub proof remains private and non-authoritative in 2B even when a
repository slice passes.

## 15. Stage10-2B.2 GitHub-first vertical slice

GitHub is the first selected source. Notion-first was considered but not selected. The GitHub slice
does not begin implementation until Colin separately freezes its source bundle sub-contract.
Stage10-2B.2 remains one GitHub-first vertical slice; this proposal does not create another top-level
stage. Its first implementation subtask is the private common V0.2 wrapper, runtime-owned snapshot,
collector-seal boundary, blind callback boundary, cumulative caps, and sanitized result kernel needed
by GitHub. That common-runtime subtask requires its own Engine Change Record section, focused and
hostile-input tests, rollback evidence, and Colin checkpoint before GitHub verifier work continues.

### 15.1 Freeze prerequisites

The GitHub slice contract must freeze:

- bundle schema and version;
- collector, adapter, input-contract, verifier, and projection identities and versions;
- the common collector-seal algorithm, domain, purpose, preimage, wire encoding, and lifecycle;
- repository-scope token inputs and privacy HMAC binding;
- artifact manifest, page order, continuation, pagination, duplicate, and ordering rules;
- requested and covered activity-window derivation;
- repository and activity projection canonicalization;
- exact byte, item, page, manifest, string, graph, and execution caps;
- exact failure mappings and bounded diagnostics; and
- fictional positive, partial, unavailable, mismatch, replay, lifecycle-boundary, hostile-input,
  and resource-limit cases.

All provider bundle versions, concrete caps, adapter/projection versions, and provider artifact
hashes remain explicit later GitHub slice prerequisites. This common proposal freezes no invented
value for them.

### 15.2 Later implementation acceptance gates

A GitHub implementation is acceptable only after separate checkpoints show:

- no live provider call and no caller-owned executable path;
- exact sealed envelope and lifecycle verification;
- deterministic repository-scope and activity-window proof;
- exact Stage 2 content, count, ID, provenance, and coverage comparison;
- all success branches `authoritative: false`;
- focused and relevant integration tests, full typecheck, applicable full-project lint, and
  dependency/architecture checks under the existing module/import/system-boundary triggers;
- independent correctness, security, privacy, and contract QA;
- an Engine Change Record with actual code commit and executed commands, plus demonstrated rollback
  to unavailable-only V0.1-compatible behavior; and
- Colin's explicit human acceptance.

Passing fictional offline fixtures accepts only the private deterministic slice. It does not activate
operational GitHub capability. Operational capability remains unavailable until a separate Colin
decision after trusted adapter provenance, collector identity, collector-seal key provisioning and
lifecycle, and provider artifact origin have been proven. No live API call is allowed in this slice.

### 15.3 Out of scope for the GitHub slice

The slice does not add a live GitHub connector, fetch data, persist provider artifacts, activate a
public primary-task claim, change suggestion behavior, execute A/B/C, or implement another source.

## 16. Mixed available and unavailable behavior

The metadata snapshot always contains exactly five entries in fixed order. Availability may differ
by source during incremental implementation.

- A not-requested source must have no source bundle and is not invoked regardless of capability.
- A requested available source is invoked only through the matching runtime-owned executable.
- A requested unavailable source is not invoked and contributes
  `SOURCE_VERIFIER_UNAVAILABLE`.
- Available sources may still be verified in fixed order when another requested source is
  unavailable, producing useful private per-source status. The aggregate remains failed and
  non-authoritative.
- A metadata/table mismatch is `INPUT_INVALID`, not unavailable.
- An empty requested plan may complete only after snapshot acquisition validates lifecycle and
  current generation atomically and the second current-generation check immediately before return
  passes, together with the exact five-entry capability boundary. A generation change, expiry,
  revocation, consumption, or invocation mismatch is stale exactly as on the callback path. After
  those boundaries pass, the unchanged accepted V0.1 empty-plan result is returned and remains
  non-authoritative.

Stage10-2B overall is complete only when GitHub, Codex, Google Calendar, Notion, and Dayflow each
have a frozen source bundle contract and accepted verifier implementation, and a mixed-source
integration proves fixed ordering, partial activation behavior, exact partition comparison,
failure precedence, privacy non-leakage, and deterministic replay. Completion does not activate
public authority.

## 17. Stage10-2C boundary

Stage10-2C exclusively owns:

- the first possible `authoritative: true` result variant;
- public builder, verifier, serializer, facade, or planner activation;
- final all-source authority composition and public error exposure decisions;
- migration, compatibility, release, rollout, and rollback of an authority-bearing surface; and
- any decision to let verified lineage influence production suggestion behavior.

Stage10-2B result types cannot be cast, serialized, or wrapped into public authority. A 2B source
success is evidence for later 2C design only. It does not authorize 2C.

## 18. Validation, QA, recordkeeping, and architecture gates

These gates remain separate. The initial V0.1 correction completed its ECR and focused/full/static
checks on the historical pre-QA-correction bytes recorded in Section 6.1. The current QA-corrected
code/test bytes passed the recorded full-suite, typecheck, and lint validation, and the correction
ECR addendum is recorded. The standalone focused command was not rerun for the current bytes. Build
and architecture checks were not run and are not claimed to have passed; their existing triggers
remain unchanged. Exact-byte independent QA is external freeze evidence and is not yet bound to an
immutable correction commit and exact proposal identity. No V0.2 source-verifier implementation,
proposal freeze, or activation result is claimed.

### 18.1 Contract gate

- Independent read-only documentation and contract QA.
- Verify consistency with frozen V0.1, accepted Stage10-2A, engine records, and Dayflow evidence-only
  boundaries.
- Resolve every blocking Colin review item.
- Bind the external exact-byte QA result to the immutable correction commit and exact proposal
  identity in the freeze/ECR receipt.
- Record Colin's exact freeze decision and frozen document state.

### 18.2 Per-source implementation gate

- Implement one source slice at a time after its source bundle sub-contract freezes.
- Add focused unit, negative, hostile-input, resource, lifecycle-boundary, replay, and privacy tests.
- Run focused tests and typecheck before broader checks.
- Do not combine another source or 2C activation into the slice.

### 18.3 Integration gate

- Run all relevant unit and integration tests.
- Test all five sources, mixed available/unavailable states, empty plan, fixed ordering, multiple
  simultaneous failures, exact primary precedence, and deterministic same-scope replay.
- Add blocking type-contract cases that accept the exact
  `google_calendar`/`TIMEZONE_PROFILE_INVALID`/`timezone_profile_invalid` rejected pair and reject
  that pair separately for GitHub, Codex, Notion, and Dayflow in returned results, diagnostics, and
  source statuses.
- Test cross-case, dataset, account/user, comparison-scope, run, request, and attempt rejection.
- Verify no source payload or transient proof leaks through results, logs, errors, or snapshots.
- A semantic baseline is not required unless a later change alters engine input, output, filtering,
  ordering, prompt, ranking, guardrail, or interpretation. Record the reason when deferred.

### 18.4 Technical QA gate

- Independent read-only review for correctness, crypto purpose separation, hostile JavaScript,
  DoS, lifecycle boundaries, determinism, privacy, and public API non-expansion.
- Treat exact-byte independent QA as external freeze evidence: the proposal cannot self-attest its
  own post-edit review result. Bind that result later to the immutable correction commit and exact
  proposal identity in the freeze/ECR receipt; prior findings and prior-byte passes do not satisfy
  this gate.
- QA evidence does not replace Colin's acceptance.

### 18.5 Recordkeeping gate

- Add an Engine Change Record for each behavior-changing verifier slice.
- Preserve the completed initial V0.1 ECR, prior-byte validation history, and recorded correction
  addendum `ECR-STAGE10-V0-1-RECORD-COUNT-QA-CORRECTION-2026-08-22`.
- Record the complete correction under one full commit identity, record the exact proposal
  commit/blob/document identity, and bind the external exact-byte QA result to both before contract
  freeze.
- Record exact code commit, verifier and contract versions, executed commands, privacy impact,
  deferred evaluation, risks, and rollback.
- Do not fabricate dataset hashes, run IDs, provider identities, metrics, timing, token usage, keys,
  artifacts, or commits.

### 18.6 Architecture gate

- Run the dependency architecture check after module or import changes.
- Update implemented LikeC4 only when implementation creates an actual system boundary or flow;
  keep unimplemented design in planned architecture if an architecture artifact is approved.
- Run full architecture checks before completing architecture-affecting implementation.
- Build an architecture review artifact only when it helps Colin review; no David artifact is
  required.

## 19. Rollback strategy

V0.2 must remain additive and private so rollback does not migrate or rewrite V0.1 artifacts.

1. Mark affected capability metadata entries `unavailable` in a new runtime generation.
2. Stop resolving the affected runtime-owned executable identities.
3. Reject in-flight or stale generations through lifecycle and generation checks.
4. Retain V0.1 unavailable-only behavior and public facade unchanged, including the complete
   contract-alignment correction only after its completed validation and recorded ECR addendum plus
   the remaining immutable-identity, external exact-byte QA binding, and Colin decision gates pass.
5. Remove or revert the private V0.2 module and slice-specific code in a separately approved Git
   action if Colin chooses full rollback.
6. Preserve required ECR and QA history; do not rewrite frozen contracts or evaluation records.

Because 2B adds no persistence or public authority, rollback requires no serialized data migration,
provider cleanup, or public compatibility union.

## 20. Colin review checklist

The high-level choices are already approved. The following checklist reviews the implementable
details rather than reopening the overall direction.

### 20.1 Blocking contract decisions

- [ ] Yes / No: Freeze contract ID `blabase-common-suggestion-evidence-source-verification-v0.2`.
- [ ] Yes / No: Replace `TBD_AT_FREEZE` with the exact full Git commit/blob SHA or document SHA-256
  for the reviewed bytes and record the explicit proposal-to-frozen status transition.
- [ ] Yes / No: Accept the deterministic common callback/count/byte/work-unit cap table and exact
  canonical-input work formula in Section 13, independently of later provider-specific caps.
- [ ] Yes / No: Accept that any wall/monotonic watchdog is operational-only, cannot select a
  lineage result, and makes an interrupted attempt operationally incomplete/unsealed.
- [ ] Yes / No: Accept the mechanically observable source-local/global trap and isolation matrix,
  including global handling for process/worker loss, memory/resource termination, corruption, or
  unprovable containment.
- [ ] Yes / No: Accept the exact Stage 3 failure-code union, closed code/detail mapping, five
  discriminated exact-key source-status variants, and Calendar-only timezone rejection pair with
  positive Calendar and negative four-source type-contract tests.
- [ ] Yes / No: Accept `projectedRecordCount` as a non-negative safe integer no greater than the
  common deterministic 50,000,000 projected-record cap, with all non-finite/fractional/unsafe forms
  rejected.
- [ ] Yes / No: Accept trusted snapshot-creation `issuedAt`, the exact
  `issuedAt <= verificationStartedAt < expiresAt` relation, both current-generation checks, and
  identical stale/empty-plan lifecycle semantics.
- [ ] Yes / No: Replace `V0_1_DRIFT_CORRECTION_COMMIT_SHA: TBD_UNCOMMITTED` with the full commit SHA,
  bind the external exact-byte QA result to that SHA and the exact proposal identity in the
  freeze/ECR receipt, and confirm the historical Stage10-2A SHAs are not that identity. Current
  batched validation and the correction ECR addendum are complete; immutable identity and external
  QA binding remain pending.
- [ ] Yes / No: Accept the private schema identities shown in the proposed type definitions.
- [ ] Yes / No: Accept HMAC-SHA-256, domain
  `blabase.lineage.collector-seal.v0.2`, purpose `source-collector-seal`, and the exact canonical
  preimage formula as the collector-seal default.
- [ ] Yes / No: Require collector-seal and privacy-scope HMAC to use separate key material,
  versions, handles, domains, and purposes.
- [ ] Yes / No: Accept the V0.2 wrapper strategy that uses the unchanged V0.1 kernel result as the
  exact Stage 1 and Stage 2 preflight.
- [ ] Yes / No: Accept the runtime-owned opaque table and atomic generation model; reject all
  caller-mintable plain snapshots and functions.
- [ ] Yes / No: Accept the exact lifecycle inequalities, including invalidity at expiry,
  revocation, and deletion equality.
- [ ] Yes / No: Accept exact context, case, dataset, account/user, comparison-scope, run, request,
  and attempt binding for replay.
- [ ] Yes / No: Accept fixed source execution order and continued bounded processing of later
  available sources after a per-source failure.
- [ ] Yes / No: Accept the existing-code failure mapping and frozen V0.1 Stage 3 precedence.
- [ ] Yes / No: Accept that `verified: true` in 2B is private and always
  `authoritative: false`.
- [ ] Yes / No: Accept GitHub as the first vertical slice.
- [ ] Yes / No: Accept that each source bundle's concrete caps and wire contract are prerequisites
  frozen in that source slice rather than invented in this common contract.

Recommended default: Yes to every item above. If any answer is No, the relevant identity or rule
must be revised in a new proposal state before freeze. Silence, implementation, tests, or agent QA
cannot substitute for a Yes decision.

### 20.2 Later decisions, not part of this freeze

- Freeze the exact GitHub source bundle sub-contract and its provider-specific equal-or-lower
  resource caps; these are separate from the common deterministic cap decision above.
- Approve implementation of the GitHub private verifier slice.
- Repeat source-contract and implementation approval for Codex, Notion, Calendar, and Dayflow.
- Approve mixed-source integration after all five slices.
- Decide whether to begin Stage10-2C. No 2C decision is implied here.

### 20.3 Remaining blocking questions

Every checklist selection in 20.1 blocks common-contract freeze. This is the complete current
common-contract blocking set; no earlier shorter checklist is the only blocker. Freeze is impossible
while any item is unanswered, the proposal identity is `TBD_AT_FREEZE`,
`V0_1_DRIFT_CORRECTION_COMMIT_SHA` is `TBD_UNCOMMITTED`, or the external exact-byte QA result is not
bound to both immutable identities in the freeze/ECR receipt. Provider-specific manifest
schemas, projection versions, exact artifact identities, approved Calendar profile SHA-256,
collector key provisioning, and source-bundle caps intentionally remain unresolved slice-contract
prerequisites. They must not be fabricated or treated as implemented by this common proposal.

## 21. Experiment and engine invariance statement

The frozen experiment invariant is exact:

- A = structured evidence only.
- B = the same structured evidence plus neutral Dayflow evidence.
- C = neutral Dayflow evidence only.
- All three arms use the identical Blabase input adapter, suggestion engine, model, prompt,
  configuration, ranking, guardrails, and output schema.
- Arm identity never enters the adapter or engine through a field, prompt, flag, branch, filename,
  metadata value, or hidden configuration. Only the evidence set differs.

Dayflow remains capture, storage, privacy, OCR, and preprocessing evidence only. It cannot supply a
title, summary, ranking, caveat, recommendation, suggestion semantic, final output, or engine-control
signal. The positive neutral record allowlist required by Section 14 is a blocking Dayflow-slice
prerequisite, and renamed or disguised suggestion-shaped fields fail closed.

This proposal does not execute A/B/C, generate a suggestion, or produce an experiment run, metric,
comparison, or result. Apart from the separately gated V0.1 failure-classification alignment, it
does not modify engine input, output, filtering, ordering, prompt, ranking, guardrails, or suggestion
interpretation. Any later experiment must prove the exact invariant above before its results can be
interpreted as a same-engine ablation.
