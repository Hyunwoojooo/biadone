# Common Suggestion Evidence Source Verification V0.4 Full Standalone Contract Draft

## 0. Document metadata

| Field | Value |
| --- | --- |
| Contract ID | blabase-common-suggestion-evidence-source-verification-v0.4 |
| Contract version | v0.4 private standalone proposal |
| Proposed serialized protocol generation | v0.4 only |
| Proposed freeze-version literal | blabase-common-source-verification-freeze.v0.4 |
| Checkpoint | Stage10-2B Common Source Verification privacy-lifecycle correction |
| Status | FULL_STANDALONE_CONTRACT_CONTENT_APPROVED_PENDING_EXACT_IDENTITY_PREPARATION |
| Date and timezone | 2026-08-24, Asia/Seoul |
| Owner | Colin |
| Sole human reviewer and decision authority | Colin |
| Focused re-QA result | PASS on 2026-08-24 after full-QA corrections |
| Common V0.4 content decision | APPROVED by Colin on 2026-08-24 |
| Required David role | None |
| Runtime effect | None |
| Public authority | None |
| Stage10-2B authority | Always authoritative: false |

This document is the complete standalone Common V0.4 contract draft. It does not depend on the
frozen V0.3 contract or the V0.4 correction proposal for normative behavior. The terms MUST, MUST
NOT, SHALL, SHALL NOT, and REQUIRED remain proposed until full Common V0.4 QA, Colin content review,
external exact-byte identity preparation, and a later separate Colin freeze decision all complete.
This draft is unfrozen, unimplemented, unregistered, unreleased, and inactive. It grants no
implementation, provider, runtime, public API, experiment, release, activation, or authority
permission.

No Common V0.4 document byte length, document SHA-256, Git blob object ID, freeze receipt ID, or
freeze Git commit object ID is assigned inside these bytes. Those values are external exact-byte
evidence created only after QA and Colin content review. No placeholder or future external record
may complete an identity field left inside frozen bytes. No adapter artifact digest is invented
here; a concrete adapterArtifactSha256 can be bound only at a later implementation-acceptance gate.

## 1. Purpose, boundaries, and invariants

The contract defines the private Stage10-2B parent boundary that:

1. verifies the unchanged Common Suggestion Evidence Lineage V0.1 receipt and Stage 2 record set;
2. accepts bounded canonical source submissions through one runtime-owned generation;
3. validates every source trust and source-binding condition before source adapter execution;
4. exposes only a separately materialized projection payload to a disposable adapter isolate;
5. collects sealed prepared source terminals in fixed source order;
6. invokes the existing canonical Common Suggestion Evidence V0.1 builder exactly once when the
   non-empty attempt is fully prepared;
7. compares the one global result with Stage 2; and
8. derives parent-owned lineage coverage, attestation, and sanitized private status.

The following invariants are exact:

- Source order is github, codex, google_calendar, notion, dayflow.
- Stage order is intrinsic_receipt, record_set_binding, source_attestation. There is no fourth stage.
- V0.1 serialized receipts, record sets, builder behavior, private record/fact ID domains, facade,
  exports, and public behavior remain unchanged.
- Stage10-2B is additive, private, and non-authoritative. Every Stage10-2B result branch contains the
  literal authoritative: false.
- Stage10-2C alone may introduce any public authority path or authoritative: true variant.
- Capability metadata cannot grant execution authority. Only a runtime-owned nominal capability
  from the same atomic generation may select an executable artifact.
- A source adapter is blind to full bundles, source proofs, coverage, attestations, envelopes,
  collector seals, expected Stage 2 material, final Common records, other sources, A/B/C identity,
  model state, suggestions, system authority, and every input/output channel not explicitly listed.
- Dayflow remains capture, storage, privacy processing, OCR, and preprocessing evidence only. It
  cannot supply structured facts, suggestion-shaped semantics, or an engine-control signal.
- A, B, and C use the identical Blabase input adapter, suggestion engine, model, prompt,
  configuration, ranking, guardrails, and output schema. Only the evidence set differs. Arm identity
  never enters a source adapter, builder, engine, prompt, flag, branch, filename, or hidden setting.
- Colin is the sole human decision authority. David has no review, receipt, or approval role.

## 2. Non-goals

This proposal does not:

- implement a parser, verifier, adapter, collector, registry, key, capability, fixture, or test;
- define a raw provider API payload or authorize live provider collection;
- add a public API, serializer, failure code, planner behavior, or authoritative result;
- change Common V0.1 IDs, budgets, sorting, filtering, output, or selection;
- generate, rank, filter, summarize, caveat, render, or activate a suggestion;
- execute A/B/C or change an experiment engine, model, prompt, ranking, or guardrail;
- change evidence persistence, consent, or logging policy; the parent-only proof-tombstone rule in
  Section 7 changes only transient replay-classification retention and introduces no arbitrary duration;
- add a dependency, migration, architecture implementation, ECR, commit, release, or deployment; or
- permit real provider, account, user, repository, conversation, credential, or secret data in Git.

## 3. Compatibility and immutable history

V0.2 and V0.3 artifacts and their external receipts are immutable historical evidence. V0.4 has no
V0.3/V0.4 union, alias, coercion, wrapper, default, field replacement, migration, fallback, version
probing, silent overwrite, or parser negotiation. A historical value is accepted only by its exact
historical logic, if retained. A V0.4 parser accepts only exact V0.4 bytes. Changing a version field,
brand spelling, domain, purpose, schema literal, or filename does not migrate an artifact.

Common V0.1 remains the exact upstream receipt, record-set, and builder dependency. This contract
imports those frozen V0.1 definitions by identity; it does not copy or widen them. In particular,
the private RECORD_ID_VERSION, FACT_ID_VERSION, record-identity hash domain, fact-value hash domain,
deriveRecordId, and deriveFactId remain private to the existing Common V0.1 builder. No source
module may import private access to, copy, expose, or re-export them.

Rollback of a later V0.4 implementation means publishing a new runtime generation whose affected
capabilities are unavailable, invalidating in-flight handles, and, only under separate approval,
removing private V0.4 implementation code. Rollback never mutates V0.1, V0.2, or V0.3 bytes.

### 3.1 Historical Common V0.2 lineage identities

These values identify frozen historical Common V0.2 lineage only. They are not a current V0.4
identity, parser alias, compatibility path, migration input, or implementation authority.

| Historical Common V0.2 artifact | Exact identity |
| --- | --- |
| Git blob object ID | 0bdb0bc5d57d207ff1ff8b393d83a1d750eb7715 |
| Freeze receipt | ECR-STAGE10-2B1-COLIN-COMMON-CONTRACT-FREEZE-2026-08-22 |
| Freeze Git commit object ID | 73e458174ac8d0cd1fef9a5bbf89c2a7e58be81b |

No Common V0.2 document SHA-256 is asserted because no such frozen value exists in the source
evidence used for this draft. The 40-character values above are Git object IDs, not SHA-256.

### 3.2 Frozen historical Common V0.3 identity

The following exact values identify the frozen historical predecessor only. They are not V0.4
defaults, aliases, runtime bindings, implementation authority, or identities for this draft.

| Historical Common V0.3 identity field | Exact frozen value |
| --- | --- |
| Contract ID | blabase-common-suggestion-evidence-source-verification-v0.3 |
| Document byte length | 88549 |
| Raw document SHA-256 | 3fa0d5944f3fa6623217d2f73362b7f2347c7a134eb37c7bf4f51e76873e6729 |
| Git-compatible blob SHA-1 | 676f52894a513a2d4b69b2915faf2e993a504213 |
| Freeze receipt | ECR-STAGE10-2B3-COLIN-COMMON-V0-3-CONTRACT-FREEZE-2026-08-24 |
| Freeze Git commit object ID | 12c54437086263525f1f5dcf5785cdd94aa05230 |

Frozen Common V0.3 and its ECR receipt remain unmodified. The historical V0.3 receipt's next-task
wording mentioned document byte length, document SHA-256, and Git blob but omitted the receipt and
freeze commit. That sentence is incomplete and non-normative. This document records the correction
without editing the receipt.

### 3.3 Exact future child-to-parent runtime binding

A future separately versioned child contract may bind a frozen Common V0.4 parent only through this
exact four-field runtime object:

~~~ts
type FrozenParentCommonIdentityV0_4 = Readonly<{
  parentCommonContractDocumentSha256: Sha256LowerHexV0_4;
  parentCommonContractGitBlobObjectId: GitObjectIdSha1LowerHexV0_4;
  parentCommonFreezeReceiptId: string;
  parentCommonFreezeGitCommitObjectId: GitObjectIdSha1LowerHexV0_4;
}>;
~~~

All four values MUST equal external evidence for the same exact frozen parent bytes. Missing,
mismatched, extra, inherited, defaulted, or caller-repaired fields reject. Document byte length is
external exact-byte evidence only. It is never a fifth runtime field, schema field, wire field,
envelope field, manifest field, callback field, registry field, capability field, or equality-table
field.

The current GitHub V0.3 proposal remains unfrozen and blocked. It MUST NOT be rebound, hashed,
frozen, implemented, or activated from this draft. Only after full Common V0.4 QA, Colin content
review, external identity preparation, and a separate Colin freeze decision may a separate task ask
Colin to choose the child version and bind that child to all four exact parent identities. No
unresolved future Common V0.4 self identity is represented by a placeholder in this draft.

## 4. Normative representation rules

### 4.1 Primitive and exact-data vocabulary

The following TypeScript-like declarations define private contract shapes. They are not a public API.

~~~ts
type SourceV0_4 =
  | "github"
  | "codex"
  | "google_calendar"
  | "notion"
  | "dayflow";

type Sha256LowerHexV0_4 = string; // exactly /^[0-9a-f]{64}$/
type GitObjectIdSha1LowerHexV0_4 = string; // exactly /^[0-9a-f]{40}$/
type CanonicalUtcMillisV0_4 = string; // exactly YYYY-MM-DDTHH:mm:ss.SSSZ
type NonNegativeSafeIntegerV0_4 = number;
type PositiveSafeIntegerV0_4 = number;
type NonNegativeDecimalStringV0_4 = string; // exactly /^(0|[1-9][0-9]*)$/
type CanonicalDecimalV0_4 = NonNegativeDecimalStringV0_4;
type SourceCoverageStatusV0_4 = "unknown" | "partial" | "complete";
type ProjectionCompletenessV0_4 = "unknown" | "truncated" | "complete";

type JsonScalarV0_4 = null | boolean | number | string;
type ExactJsonValueV0_4 =
  | JsonScalarV0_4
  | readonly ExactJsonValueV0_4[]
  | Readonly<{ readonly [key: string]: ExactJsonValueV0_4 }>;

type ClosedNumericCapProfileV0_4<K extends string> =
  Readonly<{ readonly [P in K]: NonNegativeSafeIntegerV0_4 }>;

type SourceProjectionPayloadBaseV0_4<
  S extends SourceV0_4,
  PV extends string,
> = Readonly<{
  schemaVersion: PV;
  source: S;
}>;

type ExactSourceBundleBaseV0_4<
  S extends SourceV0_4,
  BV extends string,
> = Readonly<{
  schemaVersion: BV;
  provider: S;
}>;
~~~

NonNegativeSafeIntegerV0_4 requires Number.isSafeInteger(value), value >= 0, value is not negative
zero, and value is finite. PositiveSafeIntegerV0_4 additionally requires value > 0. A source contract
MUST instantiate a finite key union and an exact literal cap object. An open string index signature,
Record<string, number>, optional cap key, inherited key, alias, default, coercion, or extra key is
forbidden on every wire and runtime boundary.

Each source child supplies a complete exact closed bundle type, a complete exact closed projection
payload type, and a complete exact closed caps type. Parent generics preserve those concrete types.
They do not replace them with unknown, inspect a child-owned enum, or permit a structural fallback.
The parent only performs operations declared in this contract and the frozen child contract.

### 4.2 Canonical byte rule

Every wire object arrives as bytes, never as a caller-created object graph. Parent acceptance is:

~~~text
acceptedBytes =
  exact input bytes
  iff strict UTF-8 decode succeeds
  and no BOM exists
  and JSON parsing succeeds without duplicate keys or extensions
  and RFC8785_JCS_UTF8(parsedValue) is byte-for-byte equal to the input
~~~

No newline rewrite, Unicode normalization, property sorting repair, numeric coercion, default,
truncation, or reserialization can make rejected bytes acceptable. All SHA-256 values are lowercase
hex over the specified exact UTF-8/JCS bytes.

### 4.3 Hostile-object and exact-key rule

Before any callback, hash over caller-influenced structured state, or trusted-handle use, the parent
rejects non-ordinary prototypes, accessors, proxies, symbols, cycles, shared aliases, sparse arrays,
duplicate keys, unexpected keys, inherited keys, mutable nested values, invalid UTF-8, non-finite
numbers, negative zero, unsafe integers, invalid lengths, and caps overflow. The parent captures safe
intrinsics at module initialization and uses safe apply semantics. Caller mutation of Object, Array,
String, Reflect, Set, Map, hashing helpers, or prototypes cannot alter validation or ordering.

The parent first checks bounded raw byte lengths, then parses, then checks graph depth/property/array/
string/count caps, then exact keys, then canonical equality and hashes. It never invokes getters to
discover size. Accepted immutable metadata, verified bundle copies, projection input, IPC values,
returned semantic values, and sealed terminals are independently copied into ordinary exact data
and deeply frozen recursively. The private mutable ZeroizationVaultV0_4 is explicitly outside every
accepted immutable graph and is never frozen, serialized, hashed as accepted data, or callback
reachable.

## 5. Parent-owned nominal runtime types

The unique symbols below are declared exactly once by the parent module. A child imports the branded
types and MUST NOT redeclare, emulate, export, or inspect a shared brand.

~~~ts
declare const runtimeCapabilityBrandV0_4: unique symbol;
declare const atomicRuntimeSnapshotBrandV0_4: unique symbol;
declare const transientSourceBindingProofHandleBrandV0_4: unique symbol;
declare const verifiedConsumedSourceBindingProofHandleBrandV0_4: unique symbol;
declare const proofVaultOwnerTokenBrandV0_4: unique symbol;
declare const proofLifecycleCleanupOwnerTokenBrandV0_4: unique symbol;
declare const vaultHmacLeaseBrandV0_4: unique symbol;
declare const vaultDisposalFenceBrandV0_4: unique symbol;
declare const atomicProofLifecycleTerminalizationResultBrandV0_4: unique symbol;
declare const authoritativeGenerationFenceBrandV0_4: unique symbol;
declare const vaultHmacContainmentExecutorBrandV0_4: unique symbol;
declare const readerQuiescenceCertificateBrandV0_4: unique symbol;
declare const atomicSourceBindingProofClaimResultBrandV0_4: unique symbol;
declare const atomicSourceBindingProofTerminalizationResultBrandV0_4: unique symbol;
declare const verifiedSourceMaterialBrandV0_4: unique symbol;
declare const projectionOnlyHandleBrandV0_4: unique symbol;
declare const preparedTerminalBrandV0_4: unique symbol;
declare const isolateInvocationBrandV0_4: unique symbol;
declare const closedSourceCapProfileBrandV0_4: unique symbol;
declare const closedSourceBundleBrandV0_4: unique symbol;
declare const closedSourceProjectionPayloadBrandV0_4: unique symbol;
declare const parentOwnedSourceProofBrandV0_4: unique symbol;
declare const zeroizationVaultHandleBrandV0_4: unique symbol;
declare const sourceBindingVaultDescriptorSetBrandV0_4: unique symbol;
declare const privacyHmacKeyHandleBrandV0_4: unique symbol;
declare const activeSourceBindingProofReferenceBrandV0_4: unique symbol;
declare const sourceBindingProofTombstoneBrandV0_4: unique symbol;
declare const sourceBindingProofLookupResultBrandV0_4: unique symbol;
declare const atomicSourceBindingProofConsumeResultBrandV0_4: unique symbol;

type ClosedSourceCapProfileBaseV0_4<S extends SourceV0_4> = Readonly<{
  readonly [closedSourceCapProfileBrandV0_4]: true;
  source: S;
  keyOrder: readonly string[];
  caps: ExactJsonValueV0_4;
  capsJcsSha256: Sha256LowerHexV0_4;
}>;

type ClosedSourceCapProfileV0_4<
  S extends SourceV0_4,
  K extends string,
  C extends ClosedNumericCapProfileV0_4<K>,
> = Readonly<{
  readonly [closedSourceCapProfileBrandV0_4]: true;
  source: S;
  keyOrder: readonly K[];
  caps: C;
  capsJcsSha256: Sha256LowerHexV0_4;
}>;

type ClosedSourceBundleBaseV0_4<S extends SourceV0_4> = Readonly<{
  readonly [closedSourceBundleBrandV0_4]: true;
  source: S;
  bundleVersion: string;
  bundle: ExactJsonValueV0_4;
}>;

type ClosedSourceBundleV0_4<
  S extends SourceV0_4,
  BV extends string,
  B extends ExactSourceBundleBaseV0_4<S, BV>,
> = Readonly<{
  readonly [closedSourceBundleBrandV0_4]: true;
  source: S;
  bundleVersion: BV;
  bundle: B;
}>;

type ClosedSourceProjectionPayloadBaseV0_4<
  S extends SourceV0_4,
> = Readonly<{
  readonly [closedSourceProjectionPayloadBrandV0_4]: true;
  source: S;
  projectionInputVersion: string;
  payload: ExactJsonValueV0_4;
}>;

type ClosedSourceProjectionPayloadV0_4<
  S extends SourceV0_4,
  PV extends string,
  P extends SourceProjectionPayloadBaseV0_4<S, PV>,
> = Readonly<{
  readonly [closedSourceProjectionPayloadBrandV0_4]: true;
  source: S;
  projectionInputVersion: PV;
  payload: P;
}>;

type RuntimeCapabilityBaseV0_4<S extends SourceV0_4> = Readonly<{
  readonly [runtimeCapabilityBrandV0_4]: true;
  source: S;
  status: "available" | "unavailable";
  generationId: string;
}>;

type ProjectionOnlyHandleBaseV0_4<S extends SourceV0_4> = Readonly<{
  readonly [projectionOnlyHandleBrandV0_4]: true;
  source: S;
}>;

type VerifiedSourceMaterialBaseV0_4<S extends SourceV0_4> = Readonly<{
  readonly [verifiedSourceMaterialBrandV0_4]: true;
  source: S;
  consumedProofHandle: VerifiedTransientSourceBindingProofHandleV0_4<S>;
}>;

type SourceIdentityAndVersionBindingV0_4 = Readonly<{
  collectorId: string;
  collectorVersion: string;
  adapterId: string;
  adapterVersion: string;
  adapterArtifactSha256: Sha256LowerHexV0_4;
  inputContractVersion: string;
  sourceBundleContractVersion: string;
  verifierId: string;
  verifierVersion: string;
  preprocessingVersion: string | null;
  projectionVersion: string;
  projectionInputVersion: string;
  sourceContractCapProfileVersion: string;
  sourceContractSha256: Sha256LowerHexV0_4;
}>;

type FrozenSourceVerifierContractAndCapsV0_4<
  S extends SourceV0_4,
  CP extends ClosedSourceCapProfileBaseV0_4<S>,
> = Readonly<{
  source: S;
  identity: SourceIdentityAndVersionBindingV0_4;
  capProfileBinding: CP;
  sourceContractCaps: CP["caps"];
  sourceContractCapsJcsSha256: CP["capsJcsSha256"];
}>;

type AvailableRuntimeCapabilityV0_4<
  S extends SourceV0_4,
  CP extends ClosedSourceCapProfileBaseV0_4<S>,
> = Readonly<{
  readonly [runtimeCapabilityBrandV0_4]: true;
  source: S;
  status: "available";
  generationId: string;
  identity: SourceIdentityAndVersionBindingV0_4;
  capProfileBinding: CP;
  sourceContractCaps: CP["caps"];
  sourceContractCapsJcsSha256: CP["capsJcsSha256"];
  issuedAt: CanonicalUtcMillisV0_4;
  expiresAt: CanonicalUtcMillisV0_4;
  revokedAt: CanonicalUtcMillisV0_4 | null;
}>;

type UnavailableRuntimeCapabilityV0_4<S extends SourceV0_4> = Readonly<{
  readonly [runtimeCapabilityBrandV0_4]: true;
  source: S;
  status: "unavailable";
  generationId: string;
  identity: null;
  capProfileBinding: null;
  sourceContractCaps: null;
  sourceContractCapsJcsSha256: null;
  issuedAt: CanonicalUtcMillisV0_4;
  expiresAt: CanonicalUtcMillisV0_4;
  revokedAt: CanonicalUtcMillisV0_4 | null;
}>;

type RuntimeCapabilityV0_4<
  S extends SourceV0_4,
  CP extends ClosedSourceCapProfileBaseV0_4<S>,
> =
  | AvailableRuntimeCapabilityV0_4<S, CP>
  | UnavailableRuntimeCapabilityV0_4<S>;

type RuntimeCapabilityTupleV0_4<
  G extends RuntimeCapabilityBaseV0_4<"github">,
  X extends RuntimeCapabilityBaseV0_4<"codex">,
  C extends RuntimeCapabilityBaseV0_4<"google_calendar">,
  N extends RuntimeCapabilityBaseV0_4<"notion">,
  D extends RuntimeCapabilityBaseV0_4<"dayflow">,
> = readonly [
  G,
  X,
  C,
  N,
  D,
];

type RuntimeCapabilityTupleBaseV0_4 = RuntimeCapabilityTupleV0_4<
  RuntimeCapabilityBaseV0_4<"github">,
  RuntimeCapabilityBaseV0_4<"codex">,
  RuntimeCapabilityBaseV0_4<"google_calendar">,
  RuntimeCapabilityBaseV0_4<"notion">,
  RuntimeCapabilityBaseV0_4<"dayflow">
>;

type AtomicVerificationRuntimeSnapshotV0_4<
  Capabilities extends RuntimeCapabilityTupleBaseV0_4,
> = Readonly<{
  readonly [atomicRuntimeSnapshotBrandV0_4]: true;
  schemaVersion: "blabase-common-source-verification-runtime.v0.4";
  generationId: string;
  verificationInvocationId: string;
  verificationStartedAt: CanonicalUtcMillisV0_4;
  issuedAt: CanonicalUtcMillisV0_4;
  expiresAt: CanonicalUtcMillisV0_4;
  revokedAt: CanonicalUtcMillisV0_4 | null;
  consumedAt: CanonicalUtcMillisV0_4 | null;
  capabilities: Capabilities;
}>;
~~~

A brand-shaped plain object has no authority. The runtime resolves each object by private identity in
one parent-owned table for the exact current generation. The application caller cannot provide a
snapshot, capability, executable, handle, registry, or clock.

## 6. Sealed envelope and source-specific caps binding

~~~ts
type CollectorSealV0_4 = Readonly<{
  algorithm: "HMAC-SHA-256";
  domain: "blabase.lineage.collector-seal.v0.4";
  purpose: "source-collector-seal";
  keyVersion: string;
  hmacSha256: Sha256LowerHexV0_4;
}>;

type SealedCollectionEnvelopeMetadataV0_4<
  S extends SourceV0_4,
  K extends string,
  C extends ClosedNumericCapProfileV0_4<K>,
> = Readonly<{
  schemaVersion: "blabase-source-collection-envelope.v0.4";
  source: S;
  identity: SourceIdentityAndVersionBindingV0_4;
  sourceContractCaps: C;
  sourceContractCapsJcsSha256: Sha256LowerHexV0_4;
  registryGenerationId: string;
  contextId: string;
  frozenEvaluationCaseId: string;
  datasetVersion: string;
  datasetSha256: Sha256LowerHexV0_4;
  comparisonScopeId: string;
  verificationRunId: string;
  accountContextHmacSha256: Sha256LowerHexV0_4;
  requestBindingHmacSha256: Sha256LowerHexV0_4;
  collectionAttemptId: string;
  collectionAttemptBindingHmacSha256: Sha256LowerHexV0_4;
  requestedCollectionMode: string;
  requiredOperations: readonly string[];
  artifactManifestSha256: Sha256LowerHexV0_4;
  sourceArtifactSetSha256: Sha256LowerHexV0_4;
  attemptedAt: CanonicalUtcMillisV0_4;
  startedAt: CanonicalUtcMillisV0_4 | null;
  completedAt: CanonicalUtcMillisV0_4 | null;
  collectedAt: CanonicalUtcMillisV0_4;
  sealedAt: CanonicalUtcMillisV0_4;
  collectorSeal: CollectorSealV0_4;
}>;
~~~

The collector MAC is exact:

~~~text
canonicalMacInput =
  exact envelope with only collectorSeal.hmacSha256 omitted

preimage =
  UTF8("blabase.lineage.collector-seal.v0.4")
  || 0x00
  || RFC8785_JCS_UTF8(canonicalMacInput)

wire MAC =
  lowercase_hex(HMAC-SHA-256(KcollectorSeal, preimage))
~~~

The seal operation supplies sealedAt and all collectorSeal fields from the registered handle. It
rejects conflicting supplied values. The collector-seal key is purpose-separated from every
privacy-scope key by material, handle, version, domain, purpose, and allowed operation.

The envelope identity, caps object, caps hash, context, generation, attempt, capability, manifest,
and collection fields MUST equal the runtime snapshot, collection plan, frozen receipt binding,
source contract, source bundle, and source registry entry wherever applicable. No field is inferred
from a filename, process, provider response, default, or callback.

## 7. Runtime source-binding proof, ownership, submission, and snapshot

### 7.1 Parent-only proof, vault, key, lease, and ownership types

~~~ts
type ProofVaultOwnerTokenV0_4<S extends SourceV0_4> = Readonly<{
  readonly [proofVaultOwnerTokenBrandV0_4]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  ownerAttemptId: string;
  ownerTokenId: string;
}>;

type ProofLifecycleCleanupOwnerTokenV0_4<S extends SourceV0_4> =
  Readonly<{
    readonly [proofLifecycleCleanupOwnerTokenBrandV0_4]: true;
    source: S;
    generationId: string;
    contextId: string;
    collectionAttemptId: string;
    cleanupOwnerId: string;
    authority: "zeroize_without_read_or_hmac";
  }>;

type ProofVaultDisposalOwnerV0_4<S extends SourceV0_4> =
  | ProofVaultOwnerTokenV0_4<S>
  | ProofLifecycleCleanupOwnerTokenV0_4<S>;

type AuthoritativeGenerationFenceV0_4 = Readonly<{
  readonly [authoritativeGenerationFenceBrandV0_4]: true;
  invalidatedGenerationId: string;
  successorGenerationId: string;
  invalidatedAt: CanonicalUtcMillisV0_4;
  fenceEpoch: PositiveSafeIntegerV0_4;
  state: "committed";
}>;

type VaultHmacContainmentExecutorV0_4<S extends SourceV0_4> =
  Readonly<{
    readonly [vaultHmacContainmentExecutorBrandV0_4]: true;
    source: S;
    vaultId: string;
    containmentGenerationId: string;
    executorId: string;
    rawAccessBoundary: "containment_only";
  }>;

type VaultHmacReaderRegistrationV0_4<S extends SourceV0_4> =
  Readonly<{
    source: S;
    vaultId: string;
    ownerTokenId: string;
    readerId: string;
    leaseEpoch: PositiveSafeIntegerV0_4;
    containmentGenerationId: string;
    state: "active";
  }>;

type ReaderQuiescenceRetirementReasonV0_4 =
  | "executor_process_exit"
  | "containment_generation_replaced"
  | "raw_mapping_revoked"
  | "operation_channel_closed";

type ReaderQuiescenceCertificateV0_4<S extends SourceV0_4> =
  Readonly<{
    readonly [readerQuiescenceCertificateBrandV0_4]: true;
    source: S;
    vaultId: string;
    ownerTokenId: string;
    readerId: string;
    leaseEpoch: PositiveSafeIntegerV0_4;
    containmentGenerationId: string;
    fenceEpoch: PositiveSafeIntegerV0_4;
    fencePublishedAt: CanonicalUtcMillisV0_4;
    retiredAt: CanonicalUtcMillisV0_4;
    retirementReason: ReaderQuiescenceRetirementReasonV0_4;
    rawAccessRevoked: true;
    liveMappingAbsent: true;
    liveOperationAbsent: true;
    oldOutputPermanentlyInvalid: true;
  }>;

type VaultHmacLeaseV0_4<S extends SourceV0_4> = Readonly<{
  readonly [vaultHmacLeaseBrandV0_4]: true;
  source: S;
  owner: ProofVaultOwnerTokenV0_4<S>;
  vaultId: string;
  leaseEpoch: PositiveSafeIntegerV0_4;
  fenceEpoch: NonNegativeSafeIntegerV0_4;
  containmentExecutor: VaultHmacContainmentExecutorV0_4<S>;
  reader: VaultHmacReaderRegistrationV0_4<S>;
  state: "active";
}>;

type VaultDisposalFenceV0_4<S extends SourceV0_4> = Readonly<{
  readonly [vaultDisposalFenceBrandV0_4]: true;
  source: S;
  vaultId: string;
  disposalOwner: ProofVaultDisposalOwnerV0_4<S>;
  fenceEpoch: PositiveSafeIntegerV0_4;
  fencePublishedAt: CanonicalUtcMillisV0_4;
  containmentGenerationId: string;
  revokedLeaseEpoch: PositiveSafeIntegerV0_4 | null;
  state: "exclusive";
}>;

type VaultHmacPhaseStateV0_4<S extends SourceV0_4> =
  | Readonly<{
      status: "unclaimed_available";
      epoch: NonNegativeSafeIntegerV0_4;
      activeLease: null;
      disposalFence: null;
      activeReaders: readonly [];
      quiescenceCertificates: readonly [];
    }>
  | Readonly<{
      status: "reserved_owner";
      epoch: NonNegativeSafeIntegerV0_4;
      activeLease: null;
      disposalFence: null;
      activeReaders: readonly [];
      quiescenceCertificates: readonly [];
    }>
  | Readonly<{
      status: "hmac_reading";
      epoch: PositiveSafeIntegerV0_4;
      activeLease: VaultHmacLeaseV0_4<S>;
      disposalFence: null;
      activeReaders: readonly VaultHmacReaderRegistrationV0_4<S>[];
      quiescenceCertificates: readonly [];
    }>
  | Readonly<{
      status: "revoking_hmac_lease";
      epoch: PositiveSafeIntegerV0_4;
      activeLease: null;
      disposalFence: VaultDisposalFenceV0_4<S>;
      activeReaders: readonly VaultHmacReaderRegistrationV0_4<S>[];
      quiescenceCertificates:
        readonly ReaderQuiescenceCertificateV0_4<S>[];
    }>
  | Readonly<{
      status: "containment_quarantine";
      epoch: PositiveSafeIntegerV0_4;
      activeLease: null;
      disposalFence: VaultDisposalFenceV0_4<S>;
      activeReaders: readonly VaultHmacReaderRegistrationV0_4<S>[];
      quiescenceCertificates:
        readonly ReaderQuiescenceCertificateV0_4<S>[];
      disposalPermitted: false;
      escalationRequired: true;
    }>
  | Readonly<{
      status: "disposing";
      epoch: PositiveSafeIntegerV0_4;
      activeLease: null;
      disposalFence: VaultDisposalFenceV0_4<S>;
      activeReaders: readonly [];
      quiescenceCertificates:
        readonly ReaderQuiescenceCertificateV0_4<S>[];
    }>
  | Readonly<{
      status: "disposed";
      epoch: PositiveSafeIntegerV0_4;
      activeLease: null;
      disposalFence: VaultDisposalFenceV0_4<S>;
      activeReaders: readonly [];
      quiescenceCertificates:
        readonly ReaderQuiescenceCertificateV0_4<S>[];
    }>;

type ZeroizationSlotDescriptorV0_4<
  S extends SourceV0_4,
  K extends string,
> = Readonly<{
  source: S;
  slotId: string;
  slotKind: K;
  setMembership: "requested" | "observed";
  setOrdinal: NonNegativeSafeIntegerV0_4;
  byteLength: NonNegativeSafeIntegerV0_4;
}>;

type ZeroizationVaultHandleV0_4<S extends SourceV0_4> = Readonly<{
  readonly [zeroizationVaultHandleBrandV0_4]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultId: string;
}>;

type SourceBindingVaultDescriptorSetBaseV0_4<
  S extends SourceV0_4,
> = Readonly<{
  readonly [sourceBindingVaultDescriptorSetBrandV0_4]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultHandle: ZeroizationVaultHandleV0_4<S>;
  requestedSlotDescriptors:
    readonly ZeroizationSlotDescriptorV0_4<S, string>[];
  observedSlotDescriptors:
    readonly ZeroizationSlotDescriptorV0_4<S, string>[] | null;
}>;

type SourceBindingVaultDescriptorSetV0_4<
  S extends SourceV0_4,
  Slot extends ZeroizationSlotDescriptorV0_4<S, string>,
> = Readonly<{
  readonly [sourceBindingVaultDescriptorSetBrandV0_4]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultHandle: ZeroizationVaultHandleV0_4<S>;
  requestedSlotDescriptors: readonly Slot[];
  observedSlotDescriptors: readonly Slot[] | null;
}>;

type ZeroizationVaultBufferSlotV0_4 = {
  slotId: string;
  bytes: Uint8Array;
  readCount: 0 | 1;
  overwritten: boolean;
};

type ZeroizationVaultV0_4<S extends SourceV0_4> = {
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultId: string;
  phase: VaultHmacPhaseStateV0_4<S>;
  slots: ZeroizationVaultBufferSlotV0_4[];
};

type PrivacyHmacKeyHandleV0_4 = Readonly<{
  readonly [privacyHmacKeyHandleBrandV0_4]: true;
  generationId: string;
  privacyKeyHandleId: string;
  privacyKeyVersion: string;
  purpose: "source-binding-privacy-hmac";
}>;

type PrivacyHmacKeyRegistryEntryV0_4 = Readonly<{
  generationId: string;
  privacyKeyId: string;
  privacyKeyHandleId: string;
  privacyKeyVersion: string;
  purpose: "source-binding-privacy-hmac";
  issuedAt: CanonicalUtcMillisV0_4;
  expiresAt: CanonicalUtcMillisV0_4;
  revokedAt: CanonicalUtcMillisV0_4 | null;
  deletedAt: CanonicalUtcMillisV0_4 | null;
  keyHandle: PrivacyHmacKeyHandleV0_4;
}>;

type AvailableSourceBindingProofStateV0_4 = Readonly<{
  status: "available";
  owner: null;
  consumedAt: null;
}>;

type ReservedSourceBindingProofStateV0_4<S extends SourceV0_4> =
  Readonly<{
    status: "reserved";
    owner: ProofVaultOwnerTokenV0_4<S>;
    consumedAt: null;
  }>;

type LiveSourceBindingProofStateV0_4<S extends SourceV0_4> =
  | AvailableSourceBindingProofStateV0_4
  | ReservedSourceBindingProofStateV0_4<S>;

type SourceBindingRegistryEntryV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
  ST extends LiveSourceBindingProofStateV0_4<S> =
    LiveSourceBindingProofStateV0_4<S>,
> = Readonly<{
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  proofTokenDigestSha256: Sha256LowerHexV0_4;
  privacyKeyId: string;
  privacyKeyHandleId: string;
  privacyKeyVersion: string;
  sourceProofVersion: string;
  registeredAt: CanonicalUtcMillisV0_4;
  expiresAt: CanonicalUtcMillisV0_4;
  revokedAt: CanonicalUtcMillisV0_4 | null;
  state: ST;
  descriptorSet: DS;
  expectedWireCommitments: W;
}>;

type TransientSourceBindingProofHandleV0_4<S extends SourceV0_4> =
  Readonly<{
    readonly [transientSourceBindingProofHandleBrandV0_4]: true;
    source: S;
    generationId: string;
    contextId: string;
    collectionAttemptId: string;
    privacyKeyVersion: string;
    sourceProofVersion: string;
    nonce: string;
    state: "transient_unverified";
  }>;

type VerifiedTransientSourceBindingProofHandleV0_4<
  S extends SourceV0_4,
> = Readonly<{
  readonly [verifiedConsumedSourceBindingProofHandleBrandV0_4]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  privacyKeyVersion: string;
  sourceProofVersion: string;
  nonce: string;
  state: "verified_and_consumed";
}>;

type SourceBindingProofTombstoneBaseV0_4<S extends SourceV0_4> =
  Readonly<{
    readonly [sourceBindingProofTombstoneBrandV0_4]: true;
    source: S;
    proofTokenDigestSha256: Sha256LowerHexV0_4;
    generationId: string;
    contextId: string;
    collectionAttemptId: string;
    sourceProofVersion: string;
    privacyKeyVersion: string;
    retentionBoundaryAt: CanonicalUtcMillisV0_4;
  }>;

type StaleSourceBindingProofTombstoneV0_4<S extends SourceV0_4> =
  SourceBindingProofTombstoneBaseV0_4<S> &
  Readonly<{
    terminalState: "stale";
    terminalReason: "generation_stale";
  }>;

type ConsumedSourceBindingProofTombstoneV0_4<S extends SourceV0_4> =
  SourceBindingProofTombstoneBaseV0_4<S> &
  Readonly<{
    terminalState: "consumed";
    terminalReason: "proof_consumed";
  }>;

type SourceBindingRejectionReasonV0_4 =
  | "step3_canonical_input_rejected"
  | "step4_binding_object_rejected"
  | "step5_collector_seal_rejected"
  | "step6_integrity_hash_rejected"
  | "step7_key_lifecycle_rejected";

type RejectedSourceBindingProofTombstoneForReasonV0_4<
  S extends SourceV0_4,
  R extends SourceBindingRejectionReasonV0_4,
> = R extends SourceBindingRejectionReasonV0_4
  ? SourceBindingProofTombstoneBaseV0_4<S> &
      Readonly<{
        terminalState: "rejected";
        terminalReason: R;
      }>
  : never;

type RejectedSourceBindingProofTombstoneV0_4<S extends SourceV0_4> = {
  [R in SourceBindingRejectionReasonV0_4]:
    RejectedSourceBindingProofTombstoneForReasonV0_4<S, R>;
}[SourceBindingRejectionReasonV0_4];

type AbortedSourceBindingProofTombstoneV0_4<S extends SourceV0_4> =
  SourceBindingProofTombstoneBaseV0_4<S> &
  Readonly<{
    terminalState: "aborted";
    terminalReason: "supervisor_abort";
  }>;

type SourceBindingProofTombstoneV0_4<S extends SourceV0_4> =
  | StaleSourceBindingProofTombstoneV0_4<S>
  | ConsumedSourceBindingProofTombstoneV0_4<S>
  | RejectedSourceBindingProofTombstoneV0_4<S>
  | AbortedSourceBindingProofTombstoneV0_4<S>;

type SourceBindingProofLifecycleTerminalRecordBaseV0_4<
  S extends SourceV0_4,
> = Readonly<{
  source: S;
  proofTokenDigestSha256: Sha256LowerHexV0_4;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  sourceProofVersion: string;
  privacyKeyVersion: string;
  deletionBoundaryAt: CanonicalUtcMillisV0_4;
  retainedTombstone: null;
}>;

type ExpiredSourceBindingProofTerminalRecordV0_4<
  S extends SourceV0_4,
> = SourceBindingProofLifecycleTerminalRecordBaseV0_4<S> &
  Readonly<{
    terminalState: "expired";
    terminalReason: "proof_expired";
  }>;

type RevokedSourceBindingProofTerminalRecordV0_4<
  S extends SourceV0_4,
> = SourceBindingProofLifecycleTerminalRecordBaseV0_4<S> &
  Readonly<{
    terminalState: "revoked";
    terminalReason: "proof_revoked";
  }>;

type InvalidIntervalSourceBindingProofTerminalRecordV0_4<
  S extends SourceV0_4,
> = SourceBindingProofLifecycleTerminalRecordBaseV0_4<S> &
  Readonly<{
    terminalState: "invalid";
    terminalReason: "proof_interval_invalid";
  }>;

type GenerationStaleSourceBindingProofTerminalRecordV0_4<
  S extends SourceV0_4,
> = SourceBindingProofLifecycleTerminalRecordBaseV0_4<S> &
  Readonly<{
    terminalState: "generation_stale";
    terminalReason: "proof_generation_stale";
  }>;

type SourceBindingProofLifecycleTerminalRecordV0_4<
  S extends SourceV0_4,
> =
  | ExpiredSourceBindingProofTerminalRecordV0_4<S>
  | RevokedSourceBindingProofTerminalRecordV0_4<S>
  | InvalidIntervalSourceBindingProofTerminalRecordV0_4<S>
  | GenerationStaleSourceBindingProofTerminalRecordV0_4<S>;

type PreClaimDispositionSnapshotV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> = Readonly<{
  decisionAt: CanonicalUtcMillisV0_4;
  authoritativeCurrentGenerationId: string;
  generationFence: AuthoritativeGenerationFenceV0_4 | null;
  proof: AvailableSourceBindingProofReferenceV0_4<S, DS, W>;
}>;

type PreClaimDispositionV0_4 =
  | Readonly<{
      disposition: "terminalize_invalid_interval";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "invalid";
      terminalReason: "proof_interval_invalid";
      deletionBoundaryAtSource: "winning_cas_decision_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "terminalize_generation_stale";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "generation_stale";
      terminalReason: "proof_generation_stale";
      deletionBoundaryAtSource: "authoritative_generation_invalidated_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "terminalize_revoked";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "revoked";
      terminalReason: "proof_revoked";
      deletionBoundaryAtSource: "proof_revoked_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "terminalize_expired";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "expired";
      terminalReason: "proof_expired";
      deletionBoundaryAtSource: "proof_expires_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "reject_future_issued";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: null;
      terminalReason: null;
      deletionBoundaryAtSource: null;
      normalClaimPermitted: false;
      disposalRequired: false;
    }>
  | Readonly<{
      disposition: "eligible";
      failureCode: null;
      failureDetail: null;
      terminalState: null;
      terminalReason: null;
      deletionBoundaryAtSource: null;
      normalClaimPermitted: true;
      disposalRequired: false;
    }>;

type SourceBindingProofTerminalArtifactV0_4<S extends SourceV0_4> =
  | SourceBindingProofTombstoneV0_4<S>
  | SourceBindingProofLifecycleTerminalRecordV0_4<S>;

type SourceBindingProofTerminalReasonV0_4 =
  SourceBindingProofTerminalArtifactV0_4<SourceV0_4>["terminalReason"];

type OwnerPreConsumeTombstoneV0_4<S extends SourceV0_4> =
  | StaleSourceBindingProofTombstoneV0_4<S>
  | RejectedSourceBindingProofTombstoneV0_4<S>
  | AbortedSourceBindingProofTombstoneV0_4<S>;

type DisposalOwnerForTerminalArtifactV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofTerminalArtifactV0_4<S>,
> = T extends SourceBindingProofLifecycleTerminalRecordV0_4<S>
  ? ProofLifecycleCleanupOwnerTokenV0_4<S>
  : ProofVaultOwnerTokenV0_4<S>;

type OwnerDisposedVaultRecordForArtifactV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofTerminalArtifactV0_4<S>,
> = T extends SourceBindingProofTerminalArtifactV0_4<S>
  ? Readonly<{
      source: S;
      outcome: "owner_disposed";
      owner: DisposalOwnerForTerminalArtifactV0_4<S, T>;
      status: "disposed";
      terminalState: T["terminalState"];
      terminalReason: T["terminalReason"];
      terminalArtifact: T;
      vaultId: string;
      slotCount: NonNegativeSafeIntegerV0_4;
      ownedByteCount: NonNegativeSafeIntegerV0_4;
      overwrittenByteCount: NonNegativeSafeIntegerV0_4;
      everyOwnedByteZero: true;
      everySlotReadAtMostOnce: true;
      replayInvalidated: true;
      vaultTouched: true;
    }>
  : never;

type NoOwnerVaultNonDisposalReasonV0_4 =
  | "preclaim_failure"
  | "claim_lost"
  | "consume_lost"
  | "owner_mismatch"
  | "fence_lost"
  | "terminalizer_lost"
  | "lifecycle_terminalizer_lost"
  | "active_hmac_lease"
  | "quiescence_certificate_invalid"
  | "reader_quiescence_unproven"
  | "containment_quarantined"
  | "already_disposed";

type NoOwnerVaultNonDisposalRecordForReasonV0_4<
  S extends SourceV0_4,
  R extends NoOwnerVaultNonDisposalReasonV0_4,
> = R extends NoOwnerVaultNonDisposalReasonV0_4
  ? Readonly<{
      source: S;
      outcome: "no_owner";
      owner: null;
      status: "not_disposed";
      nonDisposalReason: R;
      terminalState: null;
      terminalReason: null;
      terminalArtifact: null;
      vaultId: null;
      slotCount: 0;
      ownedByteCount: 0;
      overwrittenByteCount: 0;
      replayInvalidated: false;
      vaultTouched: false;
    }>
  : never;

type ZeroizationVaultDisposalRecordV0_4<S extends SourceV0_4> =
  | OwnerDisposedVaultRecordForArtifactV0_4<
      S,
      SourceBindingProofTerminalArtifactV0_4<S>
    >
  | {
      [R in NoOwnerVaultNonDisposalReasonV0_4]:
        NoOwnerVaultNonDisposalRecordForReasonV0_4<S, R>;
    }[NoOwnerVaultNonDisposalReasonV0_4];

type ActiveSourceBindingProofReferenceV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
  ST extends LiveSourceBindingProofStateV0_4<S> =
    LiveSourceBindingProofStateV0_4<S>,
> = Readonly<{
  readonly [activeSourceBindingProofReferenceBrandV0_4]: true;
  source: S;
  proofTokenDigestSha256: Sha256LowerHexV0_4;
  record: SourceBindingRegistryEntryV0_4<S, DS, W, ST>;
}>;

type AvailableSourceBindingProofReferenceV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> = ActiveSourceBindingProofReferenceV0_4<
  S,
  DS,
  W,
  AvailableSourceBindingProofStateV0_4
>;

type ReservedSourceBindingProofReferenceV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> = ActiveSourceBindingProofReferenceV0_4<
  S,
  DS,
  W,
  ReservedSourceBindingProofStateV0_4<S>
>;

type SourceBindingProofTableLookupResultV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> =
  | Readonly<{
      readonly [sourceBindingProofLookupResultBrandV0_4]: true;
      outcome: "not_found";
      source: S;
    }>
  | Readonly<{
      readonly [sourceBindingProofLookupResultBrandV0_4]: true;
      outcome: "active";
      source: S;
      activeProofReference: ActiveSourceBindingProofReferenceV0_4<S, DS, W>;
    }>
  | Readonly<{
      readonly [sourceBindingProofLookupResultBrandV0_4]: true;
      outcome: "retained_tombstone";
      source: S;
      tombstone: SourceBindingProofTombstoneV0_4<S>;
    }>;

type CorrelatedLifecycleTerminalizationResultForRecordV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofLifecycleTerminalRecordV0_4<S>,
> = T extends SourceBindingProofLifecycleTerminalRecordV0_4<S>
  ? Readonly<{
      readonly [atomicProofLifecycleTerminalizationResultBrandV0_4]: true;
      outcome: "terminalized";
      source: S;
      reason: T["terminalReason"];
      cleanupOwner: ProofLifecycleCleanupOwnerTokenV0_4<S>;
      liveProof: null;
      retainedTombstone: null;
      terminalRecord: T;
      disposalFence: VaultDisposalFenceV0_4<S>;
    }>
  : never;

type CorrelatedLifecycleTerminalizationLossForRecordV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofLifecycleTerminalRecordV0_4<S>,
> = T extends SourceBindingProofLifecycleTerminalRecordV0_4<S>
  ? Readonly<{
      readonly [atomicProofLifecycleTerminalizationResultBrandV0_4]: true;
      outcome: "lost_terminalized";
      source: S;
      reason: T["terminalReason"];
      cleanupOwner: null;
      liveProof: null;
      retainedTombstone: null;
      terminalRecord: T;
      disposalFence: null;
    }>
  : never;

type AtomicAvailableProofLifecycleTerminalizationResultV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> =
  | CorrelatedLifecycleTerminalizationResultForRecordV0_4<
      S,
      SourceBindingProofLifecycleTerminalRecordV0_4<S>
    >
  | CorrelatedLifecycleTerminalizationLossForRecordV0_4<
      S,
      SourceBindingProofLifecycleTerminalRecordV0_4<S>
    >
  | Readonly<{
      readonly [atomicProofLifecycleTerminalizationResultBrandV0_4]: true;
      outcome: "lost_reserved";
      source: S;
      reason: "normal_owner_reserved";
      cleanupOwner: null;
      liveProof: ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
      retainedTombstone: null;
      terminalRecord: null;
      disposalFence: null;
    }>
  | Readonly<{
      readonly [atomicProofLifecycleTerminalizationResultBrandV0_4]: true;
      outcome: "lost_record_replaced";
      source: S;
      reason: "record_replaced";
      cleanupOwner: null;
      liveProof: null;
      retainedTombstone: null;
      terminalRecord: null;
      disposalFence: null;
    }>;

type CorrelatedClaimTerminalizedResultV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofTombstoneV0_4<S>,
> = T extends SourceBindingProofTombstoneV0_4<S>
  ? Readonly<{
      readonly [atomicSourceBindingProofClaimResultBrandV0_4]: true;
      outcome: "lost_terminalized";
      source: S;
      reason: T["terminalReason"];
      owner: null;
      liveProof: null;
      tombstone: T;
      lifecycleTerminalRecord: null;
    }>
  : never;

type CorrelatedClaimLifecycleLossV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofLifecycleTerminalRecordV0_4<S>,
> = T extends SourceBindingProofLifecycleTerminalRecordV0_4<S>
  ? Readonly<{
      readonly [atomicSourceBindingProofClaimResultBrandV0_4]: true;
      outcome: "lost_lifecycle_terminalized";
      source: S;
      reason: T["terminalReason"];
      owner: null;
      liveProof: null;
      tombstone: null;
      lifecycleTerminalRecord: T;
    }>
  : never;

type AtomicSourceBindingProofClaimResultV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> =
  | Readonly<{
      readonly [atomicSourceBindingProofClaimResultBrandV0_4]: true;
      outcome: "reserved";
      source: S;
      owner: ProofVaultOwnerTokenV0_4<S>;
      liveProof: ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
      tombstone: null;
      lifecycleTerminalRecord: null;
    }>
  | Readonly<{
      readonly [atomicSourceBindingProofClaimResultBrandV0_4]: true;
      outcome: "lost_reserved";
      source: S;
      reason: "already_reserved";
      owner: null;
      liveProof: ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
      tombstone: null;
      lifecycleTerminalRecord: null;
    }>
  | Readonly<{
      readonly [atomicSourceBindingProofClaimResultBrandV0_4]: true;
      outcome: "lost_record_replaced";
      source: S;
      reason: "record_replaced";
      owner: null;
      liveProof: null;
      tombstone: null;
      lifecycleTerminalRecord: null;
    }>
  | CorrelatedClaimTerminalizedResultV0_4<
      S,
      SourceBindingProofTombstoneV0_4<S>
    >
  | CorrelatedClaimLifecycleLossV0_4<
      S,
      SourceBindingProofLifecycleTerminalRecordV0_4<S>
    >;

type CorrelatedConsumeTerminalizedResultV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofTombstoneV0_4<S>,
> = T extends SourceBindingProofTombstoneV0_4<S>
  ? Readonly<{
      readonly [atomicSourceBindingProofConsumeResultBrandV0_4]: true;
      outcome: "lost_terminalized";
      source: S;
      reason: T["terminalReason"];
      owner: null;
      liveProof: null;
      tombstone: T;
      hmacLease: null;
    }>
  : never;

type AtomicSourceBindingProofConsumeResultV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> =
  | Readonly<{
      readonly [atomicSourceBindingProofConsumeResultBrandV0_4]: true;
      outcome: "consumed_with_hmac_lease";
      source: S;
      owner: ProofVaultOwnerTokenV0_4<S>;
      consumedProofHandle: VerifiedTransientSourceBindingProofHandleV0_4<S>;
      liveProof: null;
      tombstone: ConsumedSourceBindingProofTombstoneV0_4<S>;
      hmacLease: VaultHmacLeaseV0_4<S>;
    }>
  | Readonly<{
      readonly [atomicSourceBindingProofConsumeResultBrandV0_4]: true;
      outcome: "lost_owner_mismatch";
      source: S;
      reason: "owner_token_mismatch";
      owner: null;
      liveProof: ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
      tombstone: null;
      hmacLease: null;
    }>
  | Readonly<{
      readonly [atomicSourceBindingProofConsumeResultBrandV0_4]: true;
      outcome: "lost_fence";
      source: S;
      reason: "vault_fence_lost";
      owner: null;
      liveProof: ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
      tombstone: null;
      hmacLease: null;
    }>
  | Readonly<{
      readonly [atomicSourceBindingProofConsumeResultBrandV0_4]: true;
      outcome: "lost_record_replaced";
      source: S;
      reason: "record_replaced";
      owner: null;
      liveProof: null;
      tombstone: null;
      hmacLease: null;
    }>
  | CorrelatedConsumeTerminalizedResultV0_4<
      S,
      SourceBindingProofTombstoneV0_4<S>
    >;

type CorrelatedOwnerTerminalizationSuccessV0_4<
  S extends SourceV0_4,
  T extends OwnerPreConsumeTombstoneV0_4<S>,
> = T extends OwnerPreConsumeTombstoneV0_4<S>
  ? Readonly<{
      readonly [atomicSourceBindingProofTerminalizationResultBrandV0_4]: true;
      outcome: "terminalized";
      source: S;
      reason: T["terminalReason"];
      disposalOwner: ProofVaultOwnerTokenV0_4<S>;
      liveProof: null;
      tombstone: T;
    }>
  : never;

type CorrelatedOwnerTerminalizationLossV0_4<
  S extends SourceV0_4,
  T extends SourceBindingProofTombstoneV0_4<S>,
> = T extends SourceBindingProofTombstoneV0_4<S>
  ? Readonly<{
      readonly [atomicSourceBindingProofTerminalizationResultBrandV0_4]: true;
      outcome: "lost_terminalized";
      source: S;
      reason: T["terminalReason"];
      disposalOwner: null;
      liveProof: null;
      tombstone: T;
    }>
  : never;

type AtomicSourceBindingProofTerminalizationResultV0_4<
  S extends SourceV0_4,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> =
  | CorrelatedOwnerTerminalizationSuccessV0_4<
      S,
      OwnerPreConsumeTombstoneV0_4<S>
    >
  | Readonly<{
      readonly [atomicSourceBindingProofTerminalizationResultBrandV0_4]: true;
      outcome: "lost_owner_mismatch";
      source: S;
      reason: "owner_token_mismatch";
      disposalOwner: null;
      liveProof: ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
      tombstone: null;
    }>
  | Readonly<{
      readonly [atomicSourceBindingProofTerminalizationResultBrandV0_4]: true;
      outcome: "lost_fence";
      source: S;
      reason: "vault_fence_lost";
      disposalOwner: null;
      liveProof: ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
      tombstone: null;
    }>
  | Readonly<{
      readonly [atomicSourceBindingProofTerminalizationResultBrandV0_4]: true;
      outcome: "lost_record_replaced";
      source: S;
      reason: "record_replaced";
      disposalOwner: null;
      liveProof: null;
      tombstone: null;
    }>
  | CorrelatedOwnerTerminalizationLossV0_4<
      S,
      SourceBindingProofTombstoneV0_4<S>
    >;

type CollectionSubmissionV0_4<
  S extends SourceV0_4,
> = Readonly<{
  source: S;
  canonicalEnvelopeUtf8: Uint8Array;
  canonicalSourceBundleUtf8: Uint8Array;
  sourceBindingProofHandle: TransientSourceBindingProofHandleV0_4<S>;
}>;

type ParentCollectionSnapshotV0_4<
  S extends SourceV0_4,
  K extends string,
  C extends ClosedNumericCapProfileV0_4<K>,
  BV extends string,
  B extends ExactSourceBundleBaseV0_4<S, BV>,
  CP extends ClosedSourceCapProfileV0_4<S, K, C>,
  SB extends ClosedSourceBundleV0_4<S, BV, B>,
  DS extends SourceBindingVaultDescriptorSetBaseV0_4<S>,
  W extends ExactJsonValueV0_4,
> = Readonly<{
  source: S;
  parentOwnedEnvelopeBytes: Uint8Array;
  parentOwnedBundleBytes: Uint8Array;
  parsedEnvelope: SealedCollectionEnvelopeMetadataV0_4<S, K, C>;
  capProfileBinding: CP;
  parsedSourceBundle: SB;
  sourceBindingProofHandle: TransientSourceBindingProofHandleV0_4<S>;
  proofOwner: ProofVaultOwnerTokenV0_4<S>;
  reservedProofReference:
    ReservedSourceBindingProofReferenceV0_4<S, DS, W>;
}>;
~~~

All proof-table, key-registry, owner-token, lifecycle-cleanup, lease, fence, active-reference,
terminal artifact, claim, consume, terminalization, mutable-vault, and verified-consumed values are
parent-only and NON-WIRE. They are never accepted from JSON, serialized, persisted as source
evidence, callback-visible, adapter-visible, logged, returned, or placed in non-fictional fixtures.
A brand-shaped plain object has no authority. Transient and verified-consumed handles retain
distinct brands and mutually exclusive state literals.

### 7.2 Total pre-claim disposition and generation-fenced ownership

The submitted transient handle is exact-shaped, then the parent performs one lookup. The closed
lookup remains not_found, active or retained_tombstone. A retained consumed tombstone is interpreted
as replay failure without mutation.

The synchronous verifier and sweeper evaluate the same immutable
PreClaimDispositionSnapshotV0_4 using this total precedence:

| Priority | Exact predicate | Disposition | deletionBoundaryAt |
| --- | --- | --- | --- |
| 1 | registeredAt >= expiresAt, or revokedAt is non-null and registeredAt >= revokedAt | terminalize_invalid_interval | decisionAt captured by the winning lifecycle CAS |
| 2 | proof generation differs from authoritativeCurrentGenerationId and the committed generation fence invalidates that proof generation | terminalize_generation_stale | generationFence.invalidatedAt |
| 3 | revokedAt is non-null and revokedAt <= decisionAt | terminalize_revoked | revokedAt |
| 4 | expiresAt <= decisionAt | terminalize_expired | expiresAt |
| 5 | decisionAt < registeredAt | reject_future_issued | null |
| 6 | otherwise | eligible | null |

This order is normative for every multi-fault combination. Invalid interval beats every other
condition. Generation stale beats revoked, expired and future-issued. Revoked beats expired even
when revokedAt equals expiresAt. Expired beats future-issued. Equality is handled by the applicable
higher-priority terminal branch. Equivalent trusted snapshots produce the same classification and
boundary in verifier and sweeper.

Only future-issued by itself is non-disposing. Every higher-priority disposition atomically
terminalizes the unclaimed available proof and disposes its vault. The cleanup owner has
zeroize-only authority and never receives raw-read, HMAC or normal claim authority.

Generation rollover commits an AuthoritativeGenerationFenceV0_4 containing the invalidated
generation and exact invalidatedAt. Normal available-to-reserved claim CAS and
available-to-generation-stale lifecycle CAS compare the same authoritative fence epoch and are
mutually exclusive:

- If normal claim commits against the still-current fence before rollover, the proof becomes
  reserved and the reserved-owner/supervisor generation-stale path owns later terminalization and
  disposal.
- If rollover fence commits first, normal claim fails. Exactly one lifecycle cleanup owner then
  transitions available to the immediate-delete generation-stale terminal record and zeroizes once.
- Every loser performs zero disposal. The generation sweeper enumerates every still-available proof
  from the invalidated generation under existing caps and drives the same CAS, so no stale-generation
  available raw vault is orphaned.

Invalid interval uses the winning CAS decisionAt, generation stale uses authoritative invalidatedAt,
revoked uses revokedAt and expired uses expiresAt. Those values are derived, never caller supplied.
Future-issued has no terminal artifact and no deletion boundary.

### 7.3 Contained HMAC execution and certified reader quiescence

Steps 3 through 6 run only for the normal reserved owner. Step 7 validates the key/handle, then
atomically couples proof consumed state with one VaultHmacLeaseV0_4. Raw vault bytes never map into
the worker. The worker submits canonical HMAC operations to the nominal
VaultHmacContainmentExecutorV0_4 and receives only bounded HMAC results.

Each live operation is represented by one exact VaultHmacReaderRegistrationV0_4 bound to vaultId,
ownerTokenId, readerId, leaseEpoch and containmentGenerationId. Fence publication revokes the old
lease epoch, blocks new containment operations and permanently invalidates old outputs. A normal
executor exit retires its registration atomically inside the containment authority.

A crashed or unreachable reader is never assumed to decrement. It may be retired only after the
trusted containment authority issues one nominal ReaderQuiescenceCertificateV0_4 proving all of:

- exact vault, owner, reader, lease epoch, containment generation and published fence epoch match;
- retiredAt is not before fencePublishedAt;
- raw access and every live mapping are revoked;
- no live operation can still touch the vault;
- output from the old epoch is permanently invalid.

Forged, stale, wrong-vault, wrong-owner, wrong-reader, wrong-epoch, wrong-containment-generation or
pre-fence certificates fail closed. They do not change the reader set and cannot authorize
disposal. Each certificate retires exactly one matching reader once.

Dead-reader recovery is bounded by one trusted containment-generation replacement sequence:
publish the fence, close operation admission, revoke the old raw mapping, terminate the old
containment generation, start an isolated successor generation, and attest absence of the old
mapping/operation. If that sequence proves quiescence, it emits the certificate and disposal
continues. If it cannot prove quiescence, the vault enters containment_quarantine, emits a private
incident escalation and forbids disposal. It never performs unsafe zeroization. An actually dead
contained executor can therefore be retired without relying on its process finally block.

Disposal begins only when activeReaders is exactly empty through normal containment retirement or
validated certificates. Supervisor and worker use the same fence. There is no simultaneous raw
read and zeroization, including true process-death overlap. Cleanup remains irreversible and
idempotent.

### 7.4 Exact terminal, result, disposal, and closed-world correlation

Rejected tombstones remain the exact mapped distribution by rejection reason. Lifecycle terminal
records are the exact invalid, generation_stale, revoked and expired union. Every lifecycle
terminalization result derives reason and deletionBoundaryAt from its exact member.

OwnerDisposedVaultRecordForArtifactV0_4 automatically correlates generation-stale lifecycle cleanup
with ProofLifecycleCleanupOwnerTokenV0_4. That owner may zeroize without reading. The reserved-owner
stale tombstone remains a separate branch for a claim that committed before rollover. Consumed,
rejected, aborted and reserved-stale artifacts require the normal proof owner.

No-owner non-disposal outcomes include lifecycle terminalizer loss and every quiescence
certificate/quarantine failure. Only a winning lifecycle/owner terminalizer or consumed owner after
certified quiescence can report replayInvalidated:true and disposed. Every cross owner, state,
reason, boundary, reader certificate or disposal combination is forbidden.

### 7.5 Retention, deletion, privacy, chronology, and generation boundaries

Retained tombstones remain stale, consumed, rejected or aborted. Replay remains observation of a
consumed tombstone only. Their retention boundary remains min(expiresAt, revokedAt when non-null),
with deletion at equality.

Lifecycle invalid, generation-stale, revoked and expired records are immediate-delete terminal
records. Their exact deletionBoundaryAt is respectively winning lifecycle-CAS decisionAt,
authoritative generationFence.invalidatedAt, revokedAt and expiresAt. The lifecycle result may carry
the private terminal record as transition evidence, but proof-table lookup never exposes it as a
retained tombstone.

The authoritative generation invalidation timestamp is written once by the committed generation
fence and cannot be inferred from verifier/sweeper observation time. Tie and multi-fault behavior
always follows Section 7.2. No new retention duration or grace period exists.

Terminal evidence and quiescence certificates are parent-only, privacy-minimized and non-loggable.
They contain no raw repository identity, evidence content, key material, HMAC preimage, suggestion
semantics or raw vault bytes.

Envelope chronology and single semantic time remain unchanged. Generation currentness and fence
epoch are checked at snapshot acquisition, pre-claim disposition, claim/lifecycle CAS, isolate
boundaries and aggregate sealing. Retry uses a new snapshot and current generation fence.

## 8. Parent verified material and projection handle

~~~ts
type ParentOwnedSourceProofV0_4<
  S extends SourceV0_4,
  PW extends ExactJsonValueV0_4,
> = Readonly<{
  readonly [parentOwnedSourceProofBrandV0_4]: true;
  source: S;
  proofVersion: string;
  verifiedWireCommitments: PW;
  verifiedAt: CanonicalUtcMillisV0_4;
}>;

type VerifiedSourceMaterialV0_4<
  S extends SourceV0_4,
  CP extends ClosedSourceCapProfileBaseV0_4<S>,
  SB extends ClosedSourceBundleBaseV0_4<S>,
  SP extends ParentOwnedSourceProofV0_4<S, ExactJsonValueV0_4>,
  CW extends ExactJsonValueV0_4,
  AW extends ExactJsonValueV0_4,
  PP extends ClosedSourceProjectionPayloadBaseV0_4<S>,
  PH extends VerifiedTransientSourceBindingProofHandleV0_4<S>,
> = Readonly<{
  readonly [verifiedSourceMaterialBrandV0_4]: true;
  source: S;
  capProfileBinding: CP;
  fullVerifiedBundle: SB;
  sourceProof: SP;
  coverageInputs: CW;
  attestationInputs: AW;
  projectionPayload: PP;
  consumedProofHandle: PH;
}>;

type ProjectionOnlyHandleV0_4<
  S extends SourceV0_4,
  PP extends ClosedSourceProjectionPayloadBaseV0_4<S>,
> = Readonly<{
  readonly [projectionOnlyHandleBrandV0_4]: true;
  source: S;
  projectionInputVersion: PP["projectionInputVersion"];
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  projectionPayloadSha256: Sha256LowerHexV0_4;
  projectionPayload: PP;
  state: "single_use_unconsumed";
}>;
~~~

The parent retains the complete verified bundle, envelope, seal, proof, coverage inputs, and
attestation inputs. It creates projectionPayload by allocating a fresh graph and copying only fields
explicitly allowlisted by the child contract. The graph shares no object, array, backing buffer, or
reference with the full bundle or registry. The parent recursively verifies forbidden-field absence,
canonicalizes and hashes the exact payload, deeply freezes it, and registers one projection handle.

The callback reaches only the projection payload serialized by the isolate protocol. It never
receives the handle object itself. It cannot reach the full bundle, raw identity material, proof,
coverage, attestation, envelope, seal, manifest integrity fields, final Common records, expected
Stage 2 values, other source material, A/B/C, model/suggestion state, system authority, I/O, or a
clock.

## 9. Parent preflight contract and precedence

### 9.1 Exact failure union

~~~ts
type ParentPreflightFailureV0_4 =
  | Readonly<{
      failureCode: "RESOURCE_LIMIT_EXCEEDED";
      failureDetail: "invocation_resource_limit_exceeded";
    }>
  | Readonly<{
      failureCode: "INPUT_INVALID";
      failureDetail:
        | "runtime_snapshot_invalid"
        | "runtime_snapshot_stale"
        | "runtime_corruption"
        | "capability_correspondence_invalid";
    }>
  | Readonly<{
      failureCode: "SOURCE_BINDING_INVALID";
      failureDetail: "source_bundle_invalid";
    }>
  | Readonly<{
      failureCode: "SOURCE_ATTESTATION_INVALID";
      failureDetail: "collector_seal_invalid";
    }>
  | Readonly<{
      failureCode: "HASH_MISMATCH";
      failureDetail: "artifact_hash_mismatch";
    }>
  | Readonly<{
      failureCode: "SOURCE_VERIFIER_UNAVAILABLE";
      failureDetail: "source_verifier_unavailable";
    }>
  | Readonly<{
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
    }>
  | Readonly<{
      failureCode: "PRIVACY_SCOPE_KEY_UNAVAILABLE";
      failureDetail: "privacy_scope_key_unavailable";
    }>
  | Readonly<{
      failureCode: "SCOPE_TOKEN_CANONICALIZATION_INVALID";
      failureDetail: "scope_token_canonicalization_invalid";
    }>
  | Readonly<{
      failureCode: "PRIVACY_SCOPE_DIGEST_INVALID";
      failureDetail: "privacy_scope_digest_invalid";
    }>
  | Readonly<{
      failureCode: "TIMEZONE_PROFILE_INVALID";
      failureDetail: "timezone_profile_invalid";
    }>
  | Readonly<{
      failureCode: "COVERAGE_INVALID";
      failureDetail: "coverage_invalid";
    }>;

type GlobalParentPreflightFailureV0_4 = Extract<
  ParentPreflightFailureV0_4,
  { readonly failureCode: "RESOURCE_LIMIT_EXCEEDED" | "INPUT_INVALID" }
>;

type CalendarOnlyParentPreflightFailureV0_4 = Extract<
  ParentPreflightFailureV0_4,
  { readonly failureCode: "TIMEZONE_PROFILE_INVALID" }
>;

type SharedSourceLocalParentPreflightFailureV0_4 = Exclude<
  ParentPreflightFailureV0_4,
  GlobalParentPreflightFailureV0_4 | CalendarOnlyParentPreflightFailureV0_4
>;

type ParentPreflightFailureBySourceV0_4 = Readonly<{
  github: SharedSourceLocalParentPreflightFailureV0_4;
  codex: SharedSourceLocalParentPreflightFailureV0_4;
  google_calendar:
    | SharedSourceLocalParentPreflightFailureV0_4
    | CalendarOnlyParentPreflightFailureV0_4;
  notion: SharedSourceLocalParentPreflightFailureV0_4;
  dayflow: SharedSourceLocalParentPreflightFailureV0_4;
}>;

type ParentPreflightFailureForSourceV0_4<S extends SourceV0_4> =
  | GlobalParentPreflightFailureV0_4
  | ParentPreflightFailureBySourceV0_4[S];

type ParentPreflightSuccessV0_4<
  S extends SourceV0_4,
  VM extends VerifiedSourceMaterialBaseV0_4<S>,
  H extends ProjectionOnlyHandleBaseV0_4<S>,
> = Readonly<{
  outcome: "prepared";
  source: S;
  verifiedMaterial: VM;
  projectionHandle: H;
  consumedSourceBindingProof: VM["consumedProofHandle"];
}>;

type ParentPreflightResultV0_4<
  S extends SourceV0_4,
  VM extends VerifiedSourceMaterialBaseV0_4<S>,
  H extends ProjectionOnlyHandleBaseV0_4<S>,
  F extends ParentPreflightFailureForSourceV0_4<S>,
> =
  | ParentPreflightSuccessV0_4<S, VM, H>
  | Readonly<{
      outcome: "rejected";
      source: S;
      failure: F;
    }>;
~~~

TIMEZONE_PROFILE_INVALID is structurally legal only for source google_calendar. Every other source
instantiation resolves that branch to never. Child contracts may further restrict the parent union
but may not add a code or detail.

### 9.2 Native V0.4 exact pre-callback order

This section is standalone and normative.

| Step | Native responsibility |
| --- | --- |
| 1 | Reserve caps and bounded-copy input; no proof/vault ownership. |
| 2 | Acquire one immutable trusted snapshot; exact-shape token; perform one lookup; evaluate the total disposition table in Section 7.2. Higher-priority cleanup dispositions use the shared lifecycle CAS. Only eligible may use the authoritative generation-fenced normal claim CAS. |
| 3 | Reserved owner validates canonical envelope/bundle input. |
| 4 | Reserved owner validates submitted binding objects without proof relookup. |
| 5 | Reserved owner validates collector seal. |
| 6 | Reserved owner validates manifest/component/artifact/detached hashes. |
| 7 | Reserved owner validates key lifecycle; atomically consumes with contained HMAC lease; executes HMAC inside containment; establishes certified quiescence; fences and zeroizes. |
| 8 | Validate source scope/coverage/semantics and prepare projection/isolate input without repeating ownership or lifecycle work. |

Pre-claim disposition precedence is exactly:

~~~text
invalid interval
-> generation stale
-> revoked
-> expired
-> future-issued
-> eligible
~~~

Every cleanup branch is context invalid. Only future-issued alone does not dispose. Claim and
rollover cleanup compare the same authoritative generation fence. HMAC disposal requires an empty
reader set established by normal containment retirement or exact quiescence certificates. Invalid
certificate or unproven quiescence quarantines and cannot dispose.

All existing source/stage failure precedence, neutral evidence, builder, coverage, authority and
fixed source-order rules remain unchanged.

## 10. Projection completeness conversion

~~~ts
type FrozenTextTruncationAssertionV0_4 = Readonly<{
  wasTruncated: boolean;
}>;

type CompletenessConversionInputV0_4 = Readonly<{
  coverageStatus: SourceCoverageStatusV0_4;
  applicableAllowedTextSpans:
    readonly FrozenTextTruncationAssertionV0_4[];
}>;
~~~

The parent conversion is exact:

| Source coverage | Applicable allowed text assertion | Projection completeness |
| --- | --- | --- |
| unknown | any | unknown |
| partial | any | truncated |
| complete | at least one wasTruncated: true | truncated |
| complete | every applicable span false, including empty list | complete |

The child contract defines which allowed spans are applicable to each record. Raw partial never
enters the projection completeness union. No other status, fallback, title synthesis, or callback
reinterpretation is allowed.

## 11. Neutral Common build-record boundary and authority

The callback returns only exact variants of the unchanged
CommonSuggestionEvidenceBuildRecordV0_1 type. Each child defines a closed source/kind/role table
whose rows select an exact Common variant and its only legal record-level authority literal. The
parent reparses each returned canonical IPC result against both the Common V0.1 type and that child
table.

Record-level authority is evidence classification only. It is legal only as the authority key
inside an exact Common build-record variant. An invalid role/classification pair, an authority key
outside such a record, or an authority key in issues, diagnostics, arrays, projection input, handle,
IPC wrapper, terminal, aggregate, result, or system state is rejected. Every authoritative key is
rejected throughout callback input and output. Stage10-2B result objects use the parent-owned literal
authoritative: false and are never callback-authored.

Callbacks cannot return final Common records, recordId, factIds, record-set hashes, private Common
ID domains, coverage, attestation, envelope/seal material, expected Stage 2 data, or authority claims.

## 12. Callback result and disposable-isolate protocol

### 12.1 Callback boundary types

~~~ts
type CallbackOwnedIssueV0_4 = Readonly<{
  code: "PROJECTION_ITEM_OMITTED";
  projectionOrdinal: NonNegativeSafeIntegerV0_4;
}>;

type CallbackOwnedDiagnosticV0_4 = Readonly<{
  code: "BUILD_RECORD_PROJECTION_INVALID";
}>;

type SourceAdapterCallbackSuccessV0_4<
  S extends SourceV0_4,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_4,
> = Readonly<{
  outcome: "built";
  source: S;
  buildRecords: readonly R[];
  issues: readonly I[];
  diagnostics: readonly [];
}>;

type SourceAdapterCallbackRejectionV0_4<
  S extends SourceV0_4,
  D extends CallbackOwnedDiagnosticV0_4,
> = Readonly<{
  outcome: "rejected";
  source: S;
  rejectionReason: "BUILD_RECORD_PROJECTION_INVALID";
  buildRecords: readonly [];
  issues: readonly [];
  diagnostics: readonly [D];
}>;

type SourceAdapterReturnedResultV0_4<
  S extends SourceV0_4,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_4,
  D extends CallbackOwnedDiagnosticV0_4,
> =
  | SourceAdapterCallbackSuccessV0_4<S, R, I>
  | SourceAdapterCallbackRejectionV0_4<S, D>;
~~~

The adapter-authored result is exactly SourceAdapterReturnedResultV0_4 and contains only built or
rejected. Trap, forbidden access, timeout, protocol, containment, and teardown outcomes are authored
only by the parent isolate supervisor. Each child narrows issues and diagnostics. An empty source
issue type produces an exact empty array. Callback-owned issues are bounded projection notes only;
they are not lineage coverage, attestation, source proof, suggestion caveats, or public diagnostics.

### 12.2 Invocation and exact IPC schemas

~~~ts
type SourceAdapterInvocationV0_4<
  S extends SourceV0_4,
  PP extends ClosedSourceProjectionPayloadBaseV0_4<S>,
> = Readonly<{
  readonly [isolateInvocationBrandV0_4]: true;
  source: S;
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  contextBindingSha256: Sha256LowerHexV0_4;
  projectionHandle: ProjectionOnlyHandleV0_4<S, PP>;
  identity: SourceIdentityAndVersionBindingV0_4;
  sourceContractCapsJcsSha256: Sha256LowerHexV0_4;
}>;

type DisposableIsolateIpcInputV0_4<
  S extends SourceV0_4,
  PV extends string,
  P extends SourceProjectionPayloadBaseV0_4<S, PV>,
> = Readonly<{
  schemaVersion: "blabase-source-adapter-isolate-input.v0.4";
  protocolVersion: "blabase-source-adapter-isolate-protocol.v0.4";
  source: S;
  invocationBindingSha256: Sha256LowerHexV0_4;
  contextBindingSha256: Sha256LowerHexV0_4;
  adapterId: string;
  adapterVersion: string;
  adapterArtifactSha256: Sha256LowerHexV0_4;
  projectionVersion: string;
  projectionInputVersion: PV;
  projectionPayloadSha256: Sha256LowerHexV0_4;
  sourceContractCapProfileVersion: string;
  sourceContractCapsJcsSha256: Sha256LowerHexV0_4;
  sourceContractSha256: Sha256LowerHexV0_4;
  projectionPayload: P;
}>;

type DisposableIsolateIpcBuiltResultV0_4<
  S extends SourceV0_4,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_4,
> = Readonly<{
  schemaVersion: "blabase-source-adapter-isolate-result.v0.4";
  protocolVersion: "blabase-source-adapter-isolate-protocol.v0.4";
  source: S;
  invocationBindingSha256: Sha256LowerHexV0_4;
  adapterArtifactSha256: Sha256LowerHexV0_4;
  outcome: "built";
  buildRecords: readonly R[];
  issues: readonly I[];
  diagnostics: readonly [];
}>;

type DisposableIsolateIpcRejectedResultV0_4<
  S extends SourceV0_4,
  D extends CallbackOwnedDiagnosticV0_4,
> = Readonly<{
  schemaVersion: "blabase-source-adapter-isolate-result.v0.4";
  protocolVersion: "blabase-source-adapter-isolate-protocol.v0.4";
  source: S;
  invocationBindingSha256: Sha256LowerHexV0_4;
  adapterArtifactSha256: Sha256LowerHexV0_4;
  outcome: "rejected";
  rejectionReason: "BUILD_RECORD_PROJECTION_INVALID";
  buildRecords: readonly [];
  issues: readonly [];
  diagnostics: readonly [D];
}>;

type DisposableIsolateIpcResultV0_4<
  S extends SourceV0_4,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_4,
  D extends CallbackOwnedDiagnosticV0_4,
> =
  | DisposableIsolateIpcBuiltResultV0_4<S, R, I>
  | DisposableIsolateIpcRejectedResultV0_4<S, D>;
~~~

Input and result are each exactly one RFC 8785 JCS UTF-8 message on the one parent-created channel.
Input maximum is 1,048,576 bytes. Result maximum is 1,048,576 bytes. The input hash, result hash,
invocation binding, context binding, protocol, schemas, source, identity versions, cap-profile
identity, source contract identity, projection identities, and adapterArtifactSha256 are fixed
before launch. The parent sends exactly one input. The isolate may send at most one result. No extra
message, channel, port, stream, descriptor, shared buffer, or side band exists.

### 12.3 Exact completion union

~~~ts
type PreLaunchIsolateFailureV0_4<S extends SourceV0_4> = Readonly<{
  phase: "pre_launch";
  source: S;
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  contextBindingSha256: Sha256LowerHexV0_4;
  failure:
    | "runtime_snapshot_not_current"
    | "capability_unavailable"
    | "adapter_artifact_unavailable"
    | "adapter_artifact_hash_mismatch"
    | "isolate_launch_setup_failed";
  launched: false;
}>;

type PostLaunchIsolateCompletionBaseV0_4<
  S extends SourceV0_4,
> = Readonly<{
  phase: "post_launch";
  source: S;
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  contextBindingSha256: Sha256LowerHexV0_4;
  invocationBindingSha256: Sha256LowerHexV0_4;
  adapterArtifactSha256: Sha256LowerHexV0_4;
  ipcInputSha256: Sha256LowerHexV0_4;
  completionSha256: Sha256LowerHexV0_4;
  launched: true;
}>;

type ForbiddenAdapterCapabilityV0_4 =
  | "network"
  | "filesystem"
  | "environment"
  | "process"
  | "module_loading"
  | "eval_or_function"
  | "timer_or_clock"
  | "randomness_or_crypto"
  | "worker_or_shared_memory"
  | "model_channel"
  | "other_source_channel"
  | "undeclared_io";

type DisposableIsolateCompletionV0_4<
  S extends SourceV0_4,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_4,
  D extends CallbackOwnedDiagnosticV0_4,
> =
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "success";
      result: DisposableIsolateIpcBuiltResultV0_4<S, R, I>;
      adapterReturnedResultSha256: Sha256LowerHexV0_4;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "returned_rejection";
      result: DisposableIsolateIpcRejectedResultV0_4<S, D>;
      adapterReturnedResultSha256: Sha256LowerHexV0_4;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "trap";
      trapKind: "synchronous_exception";
      containmentConfirmed: true;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "forbidden_capability_blocked";
      forbiddenCapability: ForbiddenAdapterCapabilityV0_4;
      containmentConfirmed: true;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "timeout_watchdog";
      lineageResult: null;
      teardownConfirmed: boolean;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "protocol_violation";
      violation:
        | "result_schema_or_hash_mismatch"
        | "identity_or_artifact_mismatch"
        | "multiple_results"
        | "missing_result";
      lineageResult: null;
      teardownConfirmed: boolean;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "containment_escape";
      violation:
        | "containment_escape"
        | "extra_message_channel_or_port"
        | "supervisor_sandbox_policy_failure";
      lineageResult: null;
      teardownConfirmed: boolean;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_4<S> & Readonly<{
      completion: "teardown_failure";
      lineageResult: null;
      teardownConfirmed: false;
    }>);
~~~

Success and returned rejection are accepted only after teardownConfirmed is true. A contained
synchronous trap or blocked forbidden-capability access maps source-locally to
INPUT_INVALID/source_verifier_trapped only after containment and teardown are confirmed. A blocked
access is not a containment escape. Timeout/watchdog, protocol violation, containment escape, extra
channel, supervisor sandbox-policy failure, teardown failure, process/worker loss, memory
termination, missing result boundary, or unprovable containment makes the whole attempt
operationally incomplete and unsealed. It returns no competing lineage failure and invokes the
Common builder zero times.

### 12.4 Exact binding and hash formulas

All five values below use unkeyed SHA-256 with key: none. H_D(domain, object) means:

~~~text
lowercase_hex(SHA-256(
  UTF8(domain)
  || 0x00
  || RFC8785_JCS_UTF8(object)
))
~~~

No HMAC is used for these five protocol hashes. Nullable fields are present and encoded as the JSON
literal null. An absent nullable key is invalid.

contextBindingSha256 uses domain
blabase.source-adapter-isolate.context-binding.v0.4 and exactly:

~~~text
{
  accountContextHmacSha256,
  collectionAttemptBindingHmacSha256,
  collectionAttemptId,
  comparisonScopeId,
  contextId,
  datasetSha256,
  datasetVersion,
  frozenEvaluationCaseId,
  generationId,
  requestBindingHmacSha256,
  schemaVersion: "blabase-source-adapter-context-binding.v0.4",
  source,
  verificationRunId
}
~~~

invocationBindingSha256 uses domain
blabase.source-adapter-isolate.invocation-binding.v0.4 and exactly:

~~~text
{
  adapterArtifactSha256,
  adapterId,
  adapterVersion,
  collectionAttemptId,
  contextBindingSha256,
  generationId,
  preprocessingVersion,
  projectionInputVersion,
  projectionPayloadSha256,
  projectionVersion,
  schemaVersion: "blabase-source-adapter-invocation-binding.v0.4",
  source,
  sourceContractCapProfileVersion,
  sourceContractCapsJcsSha256,
  sourceContractSha256,
  verificationInvocationId
}
~~~

ipcInputSha256 uses domain blabase.source-adapter-isolate.ipc-input.v0.4 and the entire exact
DisposableIsolateIpcInputV0_4 object. adapterReturnedResultSha256 uses domain
blabase.source-adapter-isolate.returned-result.v0.4 and the entire exact built or rejected result
object. completionSha256 uses domain blabase.source-adapter-isolate.completion.v0.4 and the entire
exact post-launch completion object with only completionSha256 omitted.

The context hash equals the envelope/snapshot registration and invocation. The invocation hash
equals the parent invocation, IPC input, supervisor launch record, and every post-launch completion.
ipcInputSha256 equals the supervisor's pre-send and completion copies.
adapterReturnedResultSha256 equals the received canonical bytes and the success/rejection
completion. completionSha256 equals the sealed terminal completion record. Every formula requires a
fixed golden vector covering ASCII, non-ASCII UTF-8, null, empty arrays, key order, and one-bit
mutation before implementation acceptance.

### 12.5 Isolation

The parent process never imports, evaluates, links, or calls an adapter artifact in its own realm.
The supervisor starts exactly one fresh, non-reused disposable isolate per callback. A trusted
launcher loads the exact artifact whose bytes hash to adapterArtifactSha256 before adapter code
runs. The callback cannot dynamic-import or replace it.

Before adapter code loads, the supervisor constructs and recursively freezes this exact membrane.
Every listed descriptor is non-enumerable, non-configurable, and non-writable. Every listed function
and prototype object is frozen. Constructor prototype properties not listed are absent.

| Binding | Allowed member/value | Descriptor and callable behavior |
| --- | --- | --- |
| globalThis | exact self reference | frozen; contains only bindings in this table |
| undefined | ECMAScript undefined | immutable data value |
| Object | pinned intrinsic constructor | frozen; construction and call allowed |
| Object.freeze | pinned intrinsic | pure call allowed |
| Object.isFrozen | pinned intrinsic | pure call allowed |
| Object.prototype | frozen ordinary prototype | no callable members; constructor absent |
| Array | pinned intrinsic constructor | frozen; construction and call allowed |
| Array.isArray | pinned intrinsic | pure call allowed |
| Array.prototype | frozen array prototype | only length, map, concat below |
| Array.prototype.length | 0 | immutable data value |
| Array.prototype.map | pinned intrinsic | safe-apply to dense arrays only |
| Array.prototype.concat | pinned intrinsic | safe-apply to dense arrays only |
| Number | pinned intrinsic constructor | frozen; deterministic conversion only |
| Number.isFinite | pinned intrinsic | pure call allowed |
| Number.isInteger | pinned intrinsic | pure call allowed |
| Number.isSafeInteger | pinned intrinsic | pure call allowed |
| Number.prototype | frozen number prototype | no callable members; constructor absent |
| String | pinned intrinsic constructor | frozen; deterministic conversion only |
| String.prototype | frozen string prototype | only length below |
| String.prototype.length | 0 | immutable data value |

The only additional language operations are literal object/array creation, exact own-property read,
local lexical binding, strict equality, boolean conditionals, numeric comparison, and return.
Anything absent from the table is forbidden. The supervisor-owned UTF-8/JCS parser, serializer, and
hash implementation remain outside callback reach.

The isolate forbids network, filesystem, environment, process, require, dynamic import, eval,
Function, WebAssembly compilation, timers, clock, performance, randomness, crypto, subprocesses,
workers, shared memory, Atomics, native extensions, model channels, suggestion channels, other-source
channels, clipboard, UI, and every undeclared I/O. Attempted access is a closed sandbox rejection.

The callback may retain references during invocation, and the projection input is treated as
retained until teardown. No callback realm, closure, module cache, object, reference, buffer, port,
or finalizer survives disposal. Parent registry invalidation is not a substitute for isolate
teardown or memory disposal.

## 13. Source terminal, aggregate replay, and results

### 13.1 Sealed prepared terminals

~~~ts
type PreparedSourceTerminalV0_4<
  S extends SourceV0_4,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S> =
    ClosedSourceTerminalFailureForSourceV0_4<S>,
> =
  | Readonly<{
      source: S;
      requested: false;
      terminal: "not_requested";
      buildRecords: readonly [];
      sourceFailure: null;
    }>
  | Readonly<{
      source: S;
      requested: true;
      terminal: "prepared";
      buildRecords: readonly R[];
      sourceFailure: null;
    }>
  | Readonly<{
      source: S;
      requested: true;
      terminal: "source_local_failure";
      buildRecords: readonly [];
      sourceFailure: F;
    }>;

type SharedPostPreflightTerminalFailureV0_4 =
  | Readonly<{
      failureCode: "INPUT_INVALID";
      failureDetail: "source_verifier_trapped";
    }>
  | Readonly<{
      failureCode: "SOURCE_ATTESTATION_INVALID";
      failureDetail: "source_verifier_rejected";
    }>
  | Readonly<{
      failureCode: "SOURCE_ATTESTATION_BINDING_MISMATCH";
      failureDetail: "source_attestation_binding_mismatch";
    }>
  | Readonly<{
      failureCode: "RECORD_ID_SET_MISMATCH";
      failureDetail: "record_id_set_mismatch";
    }>
  | Readonly<{
      failureCode: "COVERAGE_INVALID";
      failureDetail: "coverage_invalid";
    }>;

type ClosedSourceTerminalFailureBySourceV0_4 = Readonly<{
  github:
    | ParentPreflightFailureBySourceV0_4["github"]
    | SharedPostPreflightTerminalFailureV0_4;
  codex:
    | ParentPreflightFailureBySourceV0_4["codex"]
    | SharedPostPreflightTerminalFailureV0_4;
  google_calendar:
    | ParentPreflightFailureBySourceV0_4["google_calendar"]
    | SharedPostPreflightTerminalFailureV0_4;
  notion:
    | ParentPreflightFailureBySourceV0_4["notion"]
    | SharedPostPreflightTerminalFailureV0_4;
  dayflow:
    | ParentPreflightFailureBySourceV0_4["dayflow"]
    | SharedPostPreflightTerminalFailureV0_4;
}>;

type ClosedSourceTerminalFailureForSourceV0_4<
  S extends SourceV0_4,
> = ClosedSourceTerminalFailureBySourceV0_4[S];

type ClosedSourceTerminalFailureV0_4 =
  ClosedSourceTerminalFailureBySourceV0_4[SourceV0_4];

type SealedPreparedSourceTerminalV0_4<
  S extends SourceV0_4,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S> =
    ClosedSourceTerminalFailureForSourceV0_4<S>,
> = Readonly<{
  readonly [preparedTerminalBrandV0_4]: true;
  generationId: string;
  verificationInvocationId: string;
  source: S;
  terminalSha256: Sha256LowerHexV0_4;
  terminal: PreparedSourceTerminalV0_4<S, R, F>;
}>;
~~~

A requested available source that succeeds contributes its neutral records. A bounded source-local
failure, including explicit unavailable capability, callback rejection, or contained trap,
contributes exactly zero records and does not stop later source processing. Every requested source
must reach one sealed terminal. Fixed processing and sealing order is github, codex,
google_calendar, notion, dayflow.

### 13.2 One global Common V0.1 builder call

For a non-empty requested plan, once every requested source has a sealed prepared terminal and no
global/operational failure occurred, the parent:

1. validates terminal identity, generation, source order, exact keys, hash, and deep freeze;
2. concatenates neutral records in fixed source order, with failed sources contributing zero;
3. separates structured and Dayflow arrays exactly as the existing Common V0.1 builder requires;
4. seals the aggregate neutral input;
5. calls buildAndSealCommonSuggestionEvidenceRecordSetV0_1 exactly once;
6. compares the one complete canonical result with the Stage 2 verified record set; and
7. only then derives parent-owned lineage coverage, attestation, and sanitized status.

The parent never calls a per-source builder and never copies private ID derivation. A source-local
failure remains the source's primary failure; a derivative missing-record mismatch for that same
failed source is not added as a competing candidate. Successful sources still undergo exact global
count, ID-set, same-ID content, provenance, coverage, and receipt-binding comparison after the one
builder call.

Builder invocation count is exact:

| Attempt | Builder calls |
| --- | ---: |
| Empty requested plan | 0 |
| Non-empty and all sources prepared successfully | 1 |
| Non-empty with one or more bounded source-local terminal failures and all sources sealed | 1 |
| Interrupted, unsealed, timeout, protocol violation, teardown failure, or global failure | 0 |

### 13.3 Sanitized source and aggregate results

~~~ts
type SanitizedFailedSourceResultForPairV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S>,
> = F extends Readonly<{
  failureCode: infer C extends string;
  failureDetail: infer D extends string;
}>
  ? Readonly<{
      source: S;
      status: "failed";
      requested: true;
      verified: false;
      authoritative: false;
      verifierId: string | null;
      verifierVersion: string | null;
      projectedRecordCount: null;
      failureCode: C;
      failureDetail: D;
      diagnostics: readonly [
        Readonly<{
          stage: "source_attestation";
          source: S;
          failureCode: C;
          failureDetail: D;
          detail: D;
        }>,
      ];
    }>
  : never;

type SanitizedSourceResultV0_4<S extends SourceV0_4> =
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
      status: "verified";
      requested: true;
      verified: true;
      authoritative: false;
      verifierId: string;
      verifierVersion: string;
      projectedRecordCount: NonNegativeSafeIntegerV0_4;
      failureCode: null;
      failureDetail: null;
      diagnostics: readonly [];
    }>
  | SanitizedFailedSourceResultForPairV0_4<
      S,
      ClosedSourceTerminalFailureForSourceV0_4<S>
    >;

type SanitizedSourceDiagnosticV0_4<S extends SourceV0_4> =
  SanitizedFailedSourceResultForPairV0_4<
    S,
    ClosedSourceTerminalFailureForSourceV0_4<S>
  >["diagnostics"][number];

type ExactFailurePairV0_4 = Readonly<{
  failureCode: string;
  failureDetail: string;
}>;

type ExactCorrelatedFailureDiagnosticV0_4<
  S extends SourceV0_4 | null,
  F extends ExactFailurePairV0_4,
> = F extends Readonly<{
  failureCode: infer C extends string;
  failureDetail: infer D extends string;
}>
  ? Readonly<{
      stage: "source_attestation";
      source: S;
      failureCode: C;
      failureDetail: D;
      detail: D;
    }>
  : never;

type DistributeCorrelatedFailureDiagnosticV0_4<
  S extends SourceV0_4 | null,
  F extends ExactFailurePairV0_4,
> = F extends ExactFailurePairV0_4
  ? ExactCorrelatedFailureDiagnosticV0_4<S, F>
  : never;

type SanitizedGlobalDiagnosticV0_4 =
  | {
      [S in SourceV0_4]:
        DistributeCorrelatedFailureDiagnosticV0_4<
          S,
          ClosedSourceTerminalFailureForSourceV0_4<S>
        >;
    }[SourceV0_4]
  | DistributeCorrelatedFailureDiagnosticV0_4<
      null,
      GlobalParentPreflightFailureV0_4
    >;

type SourceResultTupleV0_4 = readonly [
  SanitizedSourceResultV0_4<"github">,
  SanitizedSourceResultV0_4<"codex">,
  SanitizedSourceResultV0_4<"google_calendar">,
  SanitizedSourceResultV0_4<"notion">,
  SanitizedSourceResultV0_4<"dayflow">,
];

type SuccessfulSanitizedSourceResultV0_4<S extends SourceV0_4> =
  Extract<
    SanitizedSourceResultV0_4<S>,
    { readonly status: "not_requested" | "verified" }
  >;

type NotRequestedSanitizedSourceResultV0_4<S extends SourceV0_4> =
  Extract<SanitizedSourceResultV0_4<S>, { readonly status: "not_requested" }>;

type VerifiedSanitizedSourceResultV0_4<S extends SourceV0_4> =
  Extract<SanitizedSourceResultV0_4<S>, { readonly status: "verified" }>;

type NonEmptySuccessfulSourceResultTupleV0_4 =
  | readonly [
      VerifiedSanitizedSourceResultV0_4<"github">,
      SuccessfulSanitizedSourceResultV0_4<"codex">,
      SuccessfulSanitizedSourceResultV0_4<"google_calendar">,
      SuccessfulSanitizedSourceResultV0_4<"notion">,
      SuccessfulSanitizedSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_4<"github">,
      VerifiedSanitizedSourceResultV0_4<"codex">,
      SuccessfulSanitizedSourceResultV0_4<"google_calendar">,
      SuccessfulSanitizedSourceResultV0_4<"notion">,
      SuccessfulSanitizedSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_4<"github">,
      NotRequestedSanitizedSourceResultV0_4<"codex">,
      VerifiedSanitizedSourceResultV0_4<"google_calendar">,
      SuccessfulSanitizedSourceResultV0_4<"notion">,
      SuccessfulSanitizedSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_4<"github">,
      NotRequestedSanitizedSourceResultV0_4<"codex">,
      NotRequestedSanitizedSourceResultV0_4<"google_calendar">,
      VerifiedSanitizedSourceResultV0_4<"notion">,
      SuccessfulSanitizedSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_4<"github">,
      NotRequestedSanitizedSourceResultV0_4<"codex">,
      NotRequestedSanitizedSourceResultV0_4<"google_calendar">,
      NotRequestedSanitizedSourceResultV0_4<"notion">,
      VerifiedSanitizedSourceResultV0_4<"dayflow">,
    ];

type EmptyPlanSourceResultTupleV0_4 = readonly [
  NotRequestedSanitizedSourceResultV0_4<"github">,
  NotRequestedSanitizedSourceResultV0_4<"codex">,
  NotRequestedSanitizedSourceResultV0_4<"google_calendar">,
  NotRequestedSanitizedSourceResultV0_4<"notion">,
  NotRequestedSanitizedSourceResultV0_4<"dayflow">,
];

type SealedTerminalSourceResultV0_4<S extends SourceV0_4> =
  Exclude<SanitizedSourceResultV0_4<S>, { readonly status: "aborted" }>;

type UnsealedNonInterruptedSourceResultV0_4<S extends SourceV0_4> =
  Extract<SanitizedSourceResultV0_4<S>, { readonly status: "not_requested" }>;

type UnsealedInterruptedSourceResultV0_4<S extends SourceV0_4> = Readonly<{
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
}>;

type UnsealedInterruptedControlSourceResultV0_4<S extends SourceV0_4> =
  | UnsealedNonInterruptedSourceResultV0_4<S>
  | UnsealedInterruptedSourceResultV0_4<S>;

type UnsealedNonInterruptedControlSourceResultTupleV0_4 = readonly [
  UnsealedNonInterruptedSourceResultV0_4<"github">,
  UnsealedNonInterruptedSourceResultV0_4<"codex">,
  UnsealedNonInterruptedSourceResultV0_4<"google_calendar">,
  UnsealedNonInterruptedSourceResultV0_4<"notion">,
  UnsealedNonInterruptedSourceResultV0_4<"dayflow">,
];

type UnsealedInterruptedControlSourceResultTupleV0_4 =
  | readonly [
      UnsealedInterruptedSourceResultV0_4<"github">,
      UnsealedInterruptedControlSourceResultV0_4<"codex">,
      UnsealedInterruptedControlSourceResultV0_4<"google_calendar">,
      UnsealedInterruptedControlSourceResultV0_4<"notion">,
      UnsealedInterruptedControlSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_4<"github">,
      UnsealedInterruptedSourceResultV0_4<"codex">,
      UnsealedInterruptedControlSourceResultV0_4<"google_calendar">,
      UnsealedInterruptedControlSourceResultV0_4<"notion">,
      UnsealedInterruptedControlSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_4<"github">,
      UnsealedNonInterruptedSourceResultV0_4<"codex">,
      UnsealedInterruptedSourceResultV0_4<"google_calendar">,
      UnsealedInterruptedControlSourceResultV0_4<"notion">,
      UnsealedInterruptedControlSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_4<"github">,
      UnsealedNonInterruptedSourceResultV0_4<"codex">,
      UnsealedNonInterruptedSourceResultV0_4<"google_calendar">,
      UnsealedInterruptedSourceResultV0_4<"notion">,
      UnsealedInterruptedControlSourceResultV0_4<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_4<"github">,
      UnsealedNonInterruptedSourceResultV0_4<"codex">,
      UnsealedNonInterruptedSourceResultV0_4<"google_calendar">,
      UnsealedNonInterruptedSourceResultV0_4<"notion">,
      UnsealedInterruptedSourceResultV0_4<"dayflow">,
    ];

type ExactV0_1PreflightFailureV0_4 = Extract<
  ExecuteAuthoritativeVerificationKernelInternalResultV0_1,
  { readonly executed: false }
>;

type ExactV0_1EmptyPlanCompletionV0_4 = Extract<
  ExecuteAuthoritativeVerificationKernelInternalResultV0_1,
  { readonly executed: true }
>;

type FailedSanitizedSourceResultV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S> =
    ClosedSourceTerminalFailureForSourceV0_4<S>,
> = F extends Readonly<{
  failureCode: infer C extends string;
  failureDetail: infer D extends string;
}>
  ? Extract<
      SanitizedSourceResultV0_4<S>,
      Readonly<{
        source: S;
        status: "failed";
        failureCode: C;
        failureDetail: D;
      }>
    >
  : never;

type NonFailedSealedSourceResultV0_4<S extends SourceV0_4> =
  Extract<
    SanitizedSourceResultV0_4<S>,
    { readonly status: "not_requested" | "verified" }
  >;

type DistributeTupleV0_4<T extends readonly unknown[]> =
  T extends readonly [infer Head, ...infer Tail]
    ? Head extends unknown
      ? DistributeTupleV0_4<Tail> extends infer DistributedTail
        ? DistributedTail extends readonly unknown[]
          ? readonly [Head, ...DistributedTail]
          : never
        : never
      : never
    : readonly [];

type SealedNonAbortedSourceResultV0_4<S extends SourceV0_4> =
  | NonFailedSealedSourceResultV0_4<S>
  | FailedSanitizedSourceResultV0_4<
      S,
      ClosedSourceTerminalFailureForSourceV0_4<S>
    >;

type SealedFailureSourceResultTupleTemplateV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S>,
> =
  S extends "github" ? readonly [
    FailedSanitizedSourceResultV0_4<S, F>,
    SealedNonAbortedSourceResultV0_4<"codex">,
    SealedNonAbortedSourceResultV0_4<"google_calendar">,
    SealedNonAbortedSourceResultV0_4<"notion">,
    SealedNonAbortedSourceResultV0_4<"dayflow">,
  ]
  : S extends "codex" ? readonly [
    NonFailedSealedSourceResultV0_4<"github">,
    FailedSanitizedSourceResultV0_4<S, F>,
    SealedNonAbortedSourceResultV0_4<"google_calendar">,
    SealedNonAbortedSourceResultV0_4<"notion">,
    SealedNonAbortedSourceResultV0_4<"dayflow">,
  ]
  : S extends "google_calendar" ? readonly [
    NonFailedSealedSourceResultV0_4<"github">,
    NonFailedSealedSourceResultV0_4<"codex">,
    FailedSanitizedSourceResultV0_4<S, F>,
    SealedNonAbortedSourceResultV0_4<"notion">,
    SealedNonAbortedSourceResultV0_4<"dayflow">,
  ]
  : S extends "notion" ? readonly [
    NonFailedSealedSourceResultV0_4<"github">,
    NonFailedSealedSourceResultV0_4<"codex">,
    NonFailedSealedSourceResultV0_4<"google_calendar">,
    FailedSanitizedSourceResultV0_4<S, F>,
    SealedNonAbortedSourceResultV0_4<"dayflow">,
  ]
  : S extends "dayflow" ? readonly [
    NonFailedSealedSourceResultV0_4<"github">,
    NonFailedSealedSourceResultV0_4<"codex">,
    NonFailedSealedSourceResultV0_4<"google_calendar">,
    NonFailedSealedSourceResultV0_4<"notion">,
    FailedSanitizedSourceResultV0_4<S, F>,
  ]
  : never;

type SealedFailureSourceResultTupleForPrimaryV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S>,
> = F extends ClosedSourceTerminalFailureForSourceV0_4<S>
  ? DistributeTupleV0_4<
      SealedFailureSourceResultTupleTemplateV0_4<S, F>
    >
  : never;

type SealedFailureSourceResultTupleV0_4 = {
  [S in SourceV0_4]: ClosedSourceTerminalFailureForSourceV0_4<S> extends infer F
    ? F extends ClosedSourceTerminalFailureForSourceV0_4<S>
      ? SealedFailureSourceResultTupleForPrimaryV0_4<S, F>
      : never
    : never;
}[SourceV0_4];

type DiagnosticTupleForSourceResultV0_4<R> =
  R extends Readonly<{
    source: infer S extends SourceV0_4;
    status: "failed";
    failureCode: infer C extends string;
    failureDetail: infer D extends string;
  }>
    ? readonly [
        ExactCorrelatedFailureDiagnosticV0_4<
          S,
          Readonly<{
            failureCode: C;
            failureDetail: D;
          }>
        >,
      ]
    : readonly [];

type DiagnosticsForFailedTupleV0_4<T extends readonly unknown[]> =
  T extends readonly [infer Head, ...infer Tail]
    ? Head extends { readonly status: "aborted" }
      ? never
      : readonly [
          ...DiagnosticTupleForSourceResultV0_4<Head>,
          ...DiagnosticsForFailedTupleV0_4<Tail>,
        ]
    : readonly [];

type CanonicalDiagnosticsForFailureTupleV0_4<
  T extends SealedFailureSourceResultTupleV0_4,
> = DiagnosticsForFailedTupleV0_4<T>;

type DiagnosticForFailureV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S>,
> = DistributeCorrelatedFailureDiagnosticV0_4<S, F>;

type PrimaryDiagnosticForExactTupleV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S>,
  T extends readonly unknown[],
> = DiagnosticsForFailedTupleV0_4<T> extends readonly [
  infer Primary,
  ...infer _Tail,
]
  ? Primary extends DiagnosticForFailureV0_4<S, F>
    ? Primary
    : never
  : never;

type SealedAggregateFailureForExactTupleV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S>,
  T extends readonly unknown[],
> = T extends SealedFailureSourceResultTupleForPrimaryV0_4<S, F>
  ? Readonly<{
      executed: false;
      verified: false;
      authoritative: false;
      failedStage: "source_attestation";
      failureCode: F["failureCode"];
      failureDetail: F["failureDetail"];
      primaryDiagnostic:
        PrimaryDiagnosticForExactTupleV0_4<S, F, T> &
        DiagnosticsForFailedTupleV0_4<T>[0] &
        DiagnosticForFailureV0_4<S, F>;
      aggregateSealState: "sealed";
      builderInvocationCount: 1;
      sources: T;
      diagnostics: DiagnosticsForFailedTupleV0_4<T>;
    }>
  : never;

type SealedAggregateFailureForPrimaryV0_4<
  S extends SourceV0_4,
  F extends ClosedSourceTerminalFailureForSourceV0_4<S>,
> = F extends ClosedSourceTerminalFailureForSourceV0_4<S>
  ? SealedAggregateFailureForExactTupleV0_4<
      S,
      F,
      SealedFailureSourceResultTupleForPrimaryV0_4<S, F>
    >
  : never;

type SealedAggregateFailureV0_4 = {
  [S in SourceV0_4]: ClosedSourceTerminalFailureForSourceV0_4<S> extends infer F
    ? F extends ClosedSourceTerminalFailureForSourceV0_4<S>
      ? SealedAggregateFailureForPrimaryV0_4<S, F>
      : never
    : never;
}[SourceV0_4];

type UnsealedGlobalAggregateFailureForPairV0_4<
  F extends GlobalParentPreflightFailureV0_4,
> = F extends Readonly<{
  failureCode: infer C extends "RESOURCE_LIMIT_EXCEEDED" | "INPUT_INVALID";
  failureDetail: infer D extends string;
}>
  ? Readonly<{
      executed: false;
      verified: false;
      authoritative: false;
      failedStage: "source_attestation";
      failureCode: C;
      failureDetail: D;
      primaryDiagnostic:
        ExactCorrelatedFailureDiagnosticV0_4<
          null,
          Readonly<{
            failureCode: C;
            failureDetail: D;
          }>
        >;
      aggregateSealState: "unsealed";
      builderInvocationCount: 0;
      sources: UnsealedNonInterruptedControlSourceResultTupleV0_4;
      diagnostics: readonly [
        ExactCorrelatedFailureDiagnosticV0_4<
          null,
          Readonly<{
            failureCode: C;
            failureDetail: D;
          }>
        >,
      ];
    }>
  : never;

type AggregateSourceVerificationResultV0_4 =
  | Readonly<{
      outcome: "v0_1_preflight_failure";
      authoritative: false;
      v0_1Result: ExactV0_1PreflightFailureV0_4;
      aggregateSealState: "unsealed";
      builderInvocationCount: 0;
      sources: UnsealedNonInterruptedControlSourceResultTupleV0_4;
    }>
  | Readonly<{
      outcome: "empty_plan";
      authoritative: false;
      v0_1Result: ExactV0_1EmptyPlanCompletionV0_4;
      aggregateSealState: "not_required";
      builderInvocationCount: 0;
      sources: EmptyPlanSourceResultTupleV0_4;
    }>
  | Readonly<{
      executed: true;
      verified: true;
      authoritative: false;
      failureCode: null;
      failureDetail: null;
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
      aggregateSealState: "sealed";
      builderInvocationCount: 1;
      sources: NonEmptySuccessfulSourceResultTupleV0_4;
      diagnostics: readonly [];
    }>
  | SealedAggregateFailureV0_4
  | UnsealedGlobalAggregateFailureForPairV0_4<
      GlobalParentPreflightFailureV0_4
    >
  | Readonly<{
      executed: false;
      verified: false;
      authoritative: false;
      operationallyIncomplete: true;
      lineageResult: null;
      failureCode: null;
      failureDetail: null;
      aggregateSealState: "unsealed";
      builderInvocationCount: 0;
      sources: UnsealedInterruptedControlSourceResultTupleV0_4;
      diagnostics: readonly [];
    }>;
~~~

Diagnostics are closed code/detail/source triples, deduplicated, bounded, and ordered by
global-first, fixed source order, then declaration order. They contain no payload, identifier, text,
hash preimage, path, exception, timing, proof, record, or authority value.

The wrapper retains the unchanged accepted V0.1 result under v0_1Result; it does not add fields to
that exact object. Empty plan has the exact all-not-requested tuple, zero callbacks, and builder
count 0. Non-empty success is the exact first-verified five-way union and builder count 1; the
all-not-requested tuple cannot overlap it. Stage 1/2 failure and every global/interrupted/unsealed
branch have builder count 0. A fully prepared non-empty attempt, including a sealed source-local
terminal failure, has builder count 1.

For a sealed source-local failure, the first failed source in fixed tuple order mechanically owns
the primary code and primaryDiagnostic source/code/detail. diagnostics is exactly the tuple-derived
non-empty list: diagnostics[0] is deep/canonical equal to primaryDiagnostic, and each remaining
entry corresponds one-to-one to another failed source, uses that exact source-legal pair, and occurs
in fixed source order. Verified/not-requested sources emit no diagnostic; aborted is illegal in a
sealed failure tuple. Duplicate, unrelated, reordered, missing, or extra diagnostics are invalid.
Unsealed global failures instead use the closed source-null global diagnostic and builder count 0.

Aborted is exclusively an unsealed operational interruption. It occurs only in
UnsealedInterruptedSourceResultV0_4 and the exact first-aborted
UnsealedInterruptedControlSourceResultTupleV0_4 used by the operationallyIncomplete branch. That
branch has builder count 0, no aggregate seal, no semantic primary failure, and no primary or
trailing semantic diagnostic. Registry/vault cleanup and bounded operational diagnostics remain
separate control records. Preflight-success prepared terminals, sealed prepared tuples, successful
tuples, sealed aggregate failures, and every builder-one result reject aborted. Runtime construction
must use the same frozen primaryDiagnostic object as diagnostics[0], or establish exact canonical
deep equality before accepting the sealed aggregate.

DistributeTupleV0_4 distributes both each Head union member and every recursively distributed tail
union member before aggregate construction. The fixed template binds the selected primary slot
directly to the exact naked F branch; each later source is then expanded into exact non-aborted
choices. SealedAggregateFailureForExactTupleV0_4 tests naked T, so each fully distributed tuple
constructs its own aggregate member and sources, failureCode, failureDetail, primaryDiagnostic, and
diagnostics cannot widen independently.

## 14. Common cumulative caps and deterministic accounting

The exact parent caps are:

| Resource | Maximum |
| --- | ---: |
| Source callback invocations | 5 |
| Validated canonical private bytes | 5,242,880 UTF-8 bytes |
| Projected records | 50,000,000 |
| Verifier work units | 50,000,000 |
| Sanitized diagnostics | 32 |
| One diagnostic JCS bytes | 256 |
| Aggregate diagnostics JCS bytes | 8,192 |
| Input graph depth | 32 |
| Enumerable own properties | 16,384 |
| Runtime contract array length | 1,024 |
| Private HMAC preimage | 1,048,576 bytes |
| Coverage intervals per binding | 1,024 |
| Neutral issue codes per binding | 32 |

For canonical input I and frozen contract C:

~~~text
WU(I, C) =
  callbackInvocations
  + visitedOwnProperties
  + visitedArrayElements
  + manifestEntries
  + evidenceItems
  + coverageIntervals
  + projectedRecords
  + canonicalizationUtf8Bytes
  + sha256InputBytes
  + hmacInputBytes
  + isolateIpcInputUtf8Bytes
  + isolateIpcResultUtf8Bytes
~~~

Every term is a non-negative safe integer determined only from bounded canonical input and required
operations; every coefficient is one. Work is reserved before the operation, never priced by time,
CPU, scheduling, allocation, or callback order, and never refunded for early return. A source cap is
min(Common cap, exact child cap). No child can raise a parent maximum.

## 15. Privacy, logging, retention, deletion, and expiry

- Raw evidence, identity, keys, HMAC preimages and vault bytes remain private transient material.
- Total pre-claim disposition is identical for verifier and sweeper. Invalid interval, generation
  stale, revoked and expired available proofs have exactly one zeroize-only lifecycle disposer.
- Future-issued alone is non-disposing. Normal claim and generation-rollover cleanup are mutually
  exclusive on the authoritative generation fence. No available stale-generation vault is orphaned.
- Raw HMAC access exists only inside the trusted containment executor. Workers receive HMAC results,
  not raw bytes.
- Dead readers retire only through exact nominal quiescence certificates after fence publication and
  containment proof. Invalid certificates fail closed.
- Unproven quiescence quarantines rather than zeroizes. The one bounded containment-generation
  replacement path recovers actually dead executors without an unsafe timeout assumption.
- Disposal starts only with no live reader/mapping/operation. Read and zeroization never overlap.
- Lifecycle deletion boundaries are exact: CAS decisionAt, generation invalidatedAt, revokedAt or
  expiresAt according to the total precedence table.
- Retained consumed tombstone observation remains replay failure without rewrite. No replay
  tombstone exists.
- No new retention duration, public field, wire field, callback field or logging permission is
  introduced.

## 16. Exact fictional test matrix

All future fixtures are synthetic and visibly fictional. Required tests include:

### 16.1 Shared types and canonical input

- A compile fixture imports one parent-owned brand/type declaration and creates the exact GitHub
  generic instantiations without redeclaring a unique symbol.
- Compile-negative fixtures reject a child redeclaration of every shared primitive, enum, brand,
  preflight result, returned-result union, and completion union, plus every unconstrained/free
  runtime tuple, snapshot, verified-material, bundle, cap-profile, proof-handle, or projection
  generic.
- Strict UTF-8, BOM, duplicate/unknown/missing keys, hostile prototypes, accessors, proxies, symbols,
  cycles, shared aliases, sparse arrays, unsafe numbers, canonical JCS equality, exact hashes,
  counts, sorting, and deterministic replay.
- Every Common and source cap boundary and one-over boundary; no open cap key.
- Every identity/version/caps/hash mismatch owned by runtime capability.

### 16.2 Proof, generation rollover, certified quiescence, and projection

All fixtures are synthetic and instrument snapshot, disposition, generation fence, claim/lifecycle
CAS, containment operations, certificate validation, HMAC and disposal.

- Compile/parser/runtime fixtures cover the total disposition table and exact boundary source for
  every branch.
- Combined faults cover future-issued plus invalid interval, generation stale plus revoked/expired,
  revoked plus expired, and every exact equality. Expected precedence is invalid interval,
  generation stale, revoked, expired, future-issued, eligible.
- Exact deletionBoundaryAt fixtures require decisionAt for invalid interval,
  generationFence.invalidatedAt for generation stale, revokedAt for revoked and expiresAt for
  expired. Any observation-time substitution or cross-branch boundary fails.
- A true claim-versus-rollover race proves: claim-before-fence produces reserved-owner stale cleanup;
  fence-before-claim rejects normal claim and yields exactly one available generation-stale
  lifecycle disposer.
- Verifier and sweeper genuinely overlap on one stale-generation available proof. They use the same
  CAS/fence; one cleanup owner zeroizes once and every loser disposes zero times.
- Generation sweeper fixtures account for every available entry in an invalidated generation; none
  remains with an orphaned raw vault.
- Generation lifecycle record/cleanup-owner/disposal correlation is compile/parser exact. Cleanup
  owner cannot obtain raw-read, HMAC or normal-owner authority.
- HMAC executor fixture proves raw vault bytes remain containment-only and worker receives only
  bounded HMAC output.
- True dead-reader takeover kills the executor inside a reader section. Supervisor fences the epoch,
  replaces the containment generation, validates one exact quiescence certificate, retires that
  reader and only then zeroizes once.
- Negative certificates cover forged brand, stale certificate, wrong vault, owner, reader, lease
  epoch, containment generation, fence epoch, pre-fence retiredAt, live mapping, live operation and
  valid old output. Each leaves the reader active and disposal forbidden.
- Duplicate certificate retirement is rejected. One certificate can retire only its exact reader.
- Live-reader overlap continues to block disposal. Fence publication blocks new reads, and
  zeroization waits for normal retirement or certificate-proven quiescence.
- Unproven quiescence enters containment_quarantine with no disposal. The bounded single-generation
  containment recovery path either produces proof or escalates safely.
- Existing exact V0.4 positive flow, mixed-version rejection, distinct handle brands, distributed
  rejection reasons, disposal/diagnostic correlation, four-field parent binding, coupled
  consume-plus-lease, replay-as-consumed observation and projection isolation remain required.

### 16.3 Authority and isolation

- Valid record-level authority for every source role.
- Invalid role/classification, misplaced authority, result authority, and every authoritative key.
- Closure retention attempt, retained projection refs until teardown, and proof that no realm or
  reference survives disposal.
- Forbidden globals, I/O, clock, randomness, crypto, worker/shared memory, model, and other-source
  access.
- Golden vectors for contextBindingSha256, invocationBindingSha256, ipcInputSha256,
  adapterReturnedResultSha256, and completionSha256, including null and non-ASCII UTF-8.
- Every post-launch branch carries and matches adapterArtifactSha256; every pre-launch branch omits
  it and cannot claim post-launch equality.
- Extra IPC message/channel/port, multiple results, artifact mismatch, synchronous trap, blocked
  forbidden access, timeout, protocol violation, containment escape, supervisor sandbox-policy
  failure, and teardown failure.
- Success is unavailable before teardown confirmation.

### 16.4 Coverage, issues, and global replay

- unknown maps to unknown.
- partial maps to truncated.
- complete plus applicable frozen truncation assertion maps to truncated.
- complete with no applicable truncation maps to complete.
- Every child issue code condition and precedence.
- observedAt equality positive and negative fixtures where a child requires it.
- Builder call counts: empty 0, all verified 1, mixed source-local terminal failure 1,
  interrupted/unsealed/global failure 0.
- Compile/runtime fixtures reject a success tuple containing failed and reject every
  mismatched primary failure/code/detail/diagnostic/status/seal-state/builder-count combination.
- Positive success fixtures cover each of the five possible first-verified positions. Negative
  fixtures reject all-not-requested with builder 1, every failed success position, and every aborted
  value in preflight-success prepared terminals, sealed source tuples, sealed aggregate failures,
  successful tuples, or any builder-one result.
- Failure negatives cover a different primary source, diagnostics[0] unequal to primaryDiagnostic,
  wrong source-legal code/detail, unrelated/duplicate/out-of-order/missing/extra diagnostic tails,
  and any diagnostic emitted for a verified or not-requested source.
- Compile-negative and parser-negative fixtures reject cross-source, cross-code, cross-detail,
  cross-primary-diagnostic, and diagnostics[0] assignments; both layers reject unrelated,
  duplicate, omitted, or out-of-order tails. A positive interruption fixture requires at least one
  aborted source, builder count 0, unsealed aggregate state, null semantic failure, and no semantic
  diagnostics.
- Compile-positive witnesses cover every legal S,F pair, prove each distributed branch is
  inhabitable and not never, and include an exact tuple with multiple later failures whose sources
  and derived diagnostics remain correlated. A dedicated negative pairs one later source failure
  with another later source's diagnostic and must fail at both compile and parser boundaries.
- Compile/runtime-contract fixtures prove TIMEZONE_PROFILE_INVALID is accepted only for
  google_calendar and rejected for GitHub, Codex, Notion, and Dayflow at preflight, prepared
  terminal, sealed terminal, sanitized result, diagnostic tuple, and aggregate result layers.
- Count/ID-set mismatch precedes same-ID content; source-local failure remains primary for its source.
- Parent-only post-builder coverage, attestation, lineage, and status derivation.

- Compile-positive witnesses prove every legal selected terminal failure uses
  failureCode/failureDetail and every distributed selected-source/tuple/diagnostic/aggregate branch
  remains inhabitable. Compile negatives reject legacy code/detail constraints or indexes.
- SanitizedGlobalDiagnosticV0_4, tuple diagnostics, primaryDiagnostic, diagnostics[0], selected
  failure and aggregate top-level fields share one exact failureCode/failureDetail pair. Any
  cross-pair, detail alias mismatch, missing field or extra diagnostic field fails compile/parser
  validation.

## 17. Cross-contract drafting, identity, and freeze lifecycle

The required order is exact:

1. Draft the full standalone Common V0.4 contract.
2. Perform renewed bounded/full Common V0.4 contract QA.
3. Colin separately reviews Common V0.4 content and decides revise, hold or proceed.
4. Prepare external Common V0.4 exact-byte identity evidence.
5. Colin separately decides whether to freeze one exact Common V0.4 state.
6. After parent freeze, Colin selects the child version and authorizes child correction plus exact
   four-field parent binding.
7. Perform renewed child/Common cross-contract QA.
8. Colin separately reviews child content and decides revise, hold or proceed.
9. Prepare external child exact-byte identity evidence.
10. Colin separately decides whether to freeze one exact child state.
11. Colin separately approves or declines bounded offline implementation.
12. Implement one bounded private slice.
13. Run validation and record reproducibility evidence.
14. Perform independent implementation QA.
15. Colin separately accepts, revises or rejects the offline implementation.
16. Colin separately decides operational activation and release after operational review.
17. Stage10-2C remains a separate future public-authority decision.

The current GitHub V0.3 proposal stays unfrozen and blocked until its later separately authorized
child task. No active V0.4 self identity or placeholder exists in this draft. Byte length remains
external-only. Passing one gate never authorizes the next. David has no role.

Steps 1 through 3 completed on 2026-08-24: the full standalone draft was produced, full-QA
corrections were followed by focused re-QA PASS, and Colin, the sole human decision authority,
APPROVED the Common V0.4 contract content. Step 4, external exact-byte identity preparation, is the
next pending step. This approval does not complete or authorize Step 4 or any later step.

## 18. Separate Colin gates

Each row maps literally one-to-one to the numbered Section 17 lifecycle.

| Step | Gate | Result or Colin decision |
| --- | --- | --- |
| 1 | Full standalone Common draft | Completed on 2026-08-24; unfrozen draft only |
| 2 | Renewed Common full QA | Full-QA corrections completed; focused re-QA PASS on 2026-08-24 |
| 3 | Colin Common content review | APPROVED by Colin on 2026-08-24 |
| 4 | Common identity preparation | Next pending step; external exact-byte evidence only |
| 5 | Separate Colin Common freeze | Freeze or decline exact parent |
| 6 | Child correction and binding | Colin selects child version and exact four-field binding |
| 7 | Child/Common cross-contract QA | Technical findings/verdict only |
| 8 | Colin child content review | Revise, hold or proceed |
| 9 | Child identity preparation | External exact-byte evidence only |
| 10 | Separate Colin child freeze | Freeze or decline exact child |
| 11 | Offline implementation approval | Approve or decline bounded code scope |
| 12 | Bounded implementation | Produce approved private slice |
| 13 | Validation | Tests/compile/reproducibility evidence |
| 14 | Independent implementation QA | Separate technical review |
| 15 | Colin offline acceptance | Accept, revise or reject implementation |
| 16 | Operational activation and release | Separately activate/release or decline |
| 17 | Stage10-2C authority | Separate future public-authority decision |

No automated result, silence, file presence or later step substitutes for Colin at a human gate.
David has no required role.

## 19. Draft disposition

Full-QA corrections and focused re-QA PASS completed before Colin, the sole human decision
authority, APPROVED the Common V0.4 contract content on 2026-08-24. Status is
FULL_STANDALONE_CONTRACT_CONTENT_APPROVED_PENDING_EXACT_IDENTITY_PREPARATION. The only next action
authorized by this document state is external exact-byte identity preparation under Section 17
Step 4.

This content approval is not a freeze or implementation approval. The proposal remains UNFROZEN,
INACTIVE and UNIMPLEMENTED and does not claim exact-byte identity, a freeze receipt or commit,
child correction, implementation approval, implementation, fixture execution, compilation,
runtime behavior, provider activation, release, public behavior, engine change or authoritative
result. No later gate is inferred from the QA result, content approval, file presence, silence or
identity preparation.
