# Common Suggestion Evidence Source Verification V0.3 Full Contract Proposal

## 0. Document metadata

| Field | Value |
| --- | --- |
| Contract ID | blabase-common-suggestion-evidence-source-verification-v0.3 |
| Contract version | v0.3 private proposal |
| Checkpoint | Stage10-2B Common Source Verification correction |
| Status | FULL_CONTRACT_PROPOSAL_READY_FOR_BOUNDED_QA |
| Date and timezone | 2026-08-23, Asia/Seoul |
| Owner | Colin |
| Sole human reviewer and decision authority | Colin |
| Required David role | None |
| Runtime effect | None |
| Public authority | None |
| Stage10-2B authority | Always authoritative: false |

This document is a complete standalone V0.3 contract proposal. It does not depend on either V0.2
contract or the V0.3 correction proposal for normative behavior. The terms MUST, MUST NOT, SHALL,
SHALL NOT, and REQUIRED remain proposed until Colin freezes exact bytes after external exact-byte
review. This proposal is not frozen, implemented, registered, released, or activated. It grants no
implementation, provider, runtime, public API, experiment, or authority permission.

No V0.3 document SHA-256, Git blob, commit, or freeze receipt is assigned in these bytes. Those
identities are external exact-byte evidence created only at the applicable later gate. No adapter
artifact digest is invented here; the concrete adapterArtifactSha256 is bound only at later
implementation acceptance.

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
- change persistence, retention, deletion, consent, or logging policy;
- add a dependency, migration, architecture implementation, ECR, commit, release, or deployment; or
- permit real provider, account, user, repository, conversation, credential, or secret data in Git.

## 3. Compatibility and immutable history

V0.2 artifacts and external receipts are immutable historical evidence. V0.3 has no V0.2/V0.3
union, alias, coercion, wrapper, default, field replacement, migration, fallback, version probing,
or silent overwrite. A V0.2 value is accepted only by V0.2 logic, if retained. A V0.3 parser accepts
only exact V0.3 bytes. Changing a version field does not migrate an artifact.

Common V0.1 remains the exact upstream receipt, record-set, and builder dependency. This contract
imports those frozen V0.1 definitions by identity; it does not copy or widen them. In particular,
the private RECORD_ID_VERSION, FACT_ID_VERSION, record-identity hash domain, fact-value hash domain,
deriveRecordId, and deriveFactId remain private to the existing Common V0.1 builder. No source module
may import private access to, copy, expose, or re-export them.

Rollback of a later V0.3 implementation means publishing a new runtime generation whose affected
capabilities are unavailable, invalidating in-flight handles, and, only under separate approval,
removing private V0.3 implementation code. Rollback never mutates V0.1 or V0.2 bytes.

### 3.1 Historical Common V0.2 lineage identities

These values identify frozen historical Common V0.2 lineage only. They are not a current V0.3
identity, parser alias, compatibility path, migration input, or implementation authority.

| Historical Common V0.2 artifact | Exact identity |
| --- | --- |
| Git blob object ID | 0bdb0bc5d57d207ff1ff8b393d83a1d750eb7715 |
| Freeze receipt | ECR-STAGE10-2B1-COLIN-COMMON-CONTRACT-FREEZE-2026-08-22 |
| Freeze Git commit object ID | 73e458174ac8d0cd1fef9a5bbf89c2a7e58be81b |

No Common V0.2 document SHA-256 is asserted because no such frozen value exists in the source
evidence used for this proposal. The 40-character values above are Git object IDs, not SHA-256.

## 4. Normative representation rules

### 4.1 Primitive and exact-data vocabulary

The following TypeScript-like declarations define private contract shapes. They are not a public API.

~~~ts
type SourceV0_3 =
  | "github"
  | "codex"
  | "google_calendar"
  | "notion"
  | "dayflow";

type Sha256LowerHexV0_3 = string; // exactly /^[0-9a-f]{64}$/
type CanonicalUtcMillisV0_3 = string; // exactly YYYY-MM-DDTHH:mm:ss.SSSZ
type NonNegativeSafeIntegerV0_3 = number;
type PositiveSafeIntegerV0_3 = number;
type NonNegativeDecimalStringV0_3 = string; // exactly /^(0|[1-9][0-9]*)$/
type CanonicalDecimalV0_3 = NonNegativeDecimalStringV0_3;
type SourceCoverageStatusV0_3 = "unknown" | "partial" | "complete";
type ProjectionCompletenessV0_3 = "unknown" | "truncated" | "complete";

type JsonScalarV0_3 = null | boolean | number | string;
type ExactJsonValueV0_3 =
  | JsonScalarV0_3
  | readonly ExactJsonValueV0_3[]
  | Readonly<{ readonly [key: string]: ExactJsonValueV0_3 }>;

type ClosedNumericCapProfileV0_3<K extends string> =
  Readonly<{ readonly [P in K]: NonNegativeSafeIntegerV0_3 }>;

type SourceProjectionPayloadBaseV0_3<
  S extends SourceV0_3,
  PV extends string,
> = Readonly<{
  schemaVersion: PV;
  source: S;
}>;

type ExactSourceBundleBaseV0_3<
  S extends SourceV0_3,
  BV extends string,
> = Readonly<{
  schemaVersion: BV;
  provider: S;
}>;
~~~

NonNegativeSafeIntegerV0_3 requires Number.isSafeInteger(value), value >= 0, value is not negative
zero, and value is finite. PositiveSafeIntegerV0_3 additionally requires value > 0. A source contract
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
and deeply frozen recursively. The private mutable ZeroizationVaultV0_3 is explicitly outside every
accepted immutable graph and is never frozen, serialized, hashed as accepted data, or callback
reachable.

## 5. Parent-owned nominal runtime types

The unique symbols below are declared exactly once by the parent module. A child imports the branded
types and MUST NOT redeclare, emulate, export, or inspect a shared brand.

~~~ts
declare const runtimeCapabilityBrandV0_3: unique symbol;
declare const atomicRuntimeSnapshotBrandV0_3: unique symbol;
declare const sourceBindingProofHandleBrandV0_3: unique symbol;
declare const verifiedSourceMaterialBrandV0_3: unique symbol;
declare const projectionOnlyHandleBrandV0_3: unique symbol;
declare const preparedTerminalBrandV0_3: unique symbol;
declare const isolateInvocationBrandV0_3: unique symbol;
declare const closedSourceCapProfileBrandV0_3: unique symbol;
declare const closedSourceBundleBrandV0_3: unique symbol;
declare const closedSourceProjectionPayloadBrandV0_3: unique symbol;
declare const parentOwnedSourceProofBrandV0_3: unique symbol;
declare const zeroizationVaultHandleBrandV0_3: unique symbol;
declare const sourceBindingVaultDescriptorSetBrandV0_3: unique symbol;

type ClosedSourceCapProfileBaseV0_3<S extends SourceV0_3> = Readonly<{
  readonly [closedSourceCapProfileBrandV0_3]: true;
  source: S;
  keyOrder: readonly string[];
  caps: ExactJsonValueV0_3;
  capsJcsSha256: Sha256LowerHexV0_3;
}>;

type ClosedSourceCapProfileV0_3<
  S extends SourceV0_3,
  K extends string,
  C extends ClosedNumericCapProfileV0_3<K>,
> = Readonly<{
  readonly [closedSourceCapProfileBrandV0_3]: true;
  source: S;
  keyOrder: readonly K[];
  caps: C;
  capsJcsSha256: Sha256LowerHexV0_3;
}>;

type ClosedSourceBundleBaseV0_3<S extends SourceV0_3> = Readonly<{
  readonly [closedSourceBundleBrandV0_3]: true;
  source: S;
  bundleVersion: string;
  bundle: ExactJsonValueV0_3;
}>;

type ClosedSourceBundleV0_3<
  S extends SourceV0_3,
  BV extends string,
  B extends ExactSourceBundleBaseV0_3<S, BV>,
> = Readonly<{
  readonly [closedSourceBundleBrandV0_3]: true;
  source: S;
  bundleVersion: BV;
  bundle: B;
}>;

type ClosedSourceProjectionPayloadBaseV0_3<
  S extends SourceV0_3,
> = Readonly<{
  readonly [closedSourceProjectionPayloadBrandV0_3]: true;
  source: S;
  projectionInputVersion: string;
  payload: ExactJsonValueV0_3;
}>;

type ClosedSourceProjectionPayloadV0_3<
  S extends SourceV0_3,
  PV extends string,
  P extends SourceProjectionPayloadBaseV0_3<S, PV>,
> = Readonly<{
  readonly [closedSourceProjectionPayloadBrandV0_3]: true;
  source: S;
  projectionInputVersion: PV;
  payload: P;
}>;

type RuntimeCapabilityBaseV0_3<S extends SourceV0_3> = Readonly<{
  readonly [runtimeCapabilityBrandV0_3]: true;
  source: S;
  status: "available" | "unavailable";
  generationId: string;
}>;

type ProjectionOnlyHandleBaseV0_3<S extends SourceV0_3> = Readonly<{
  readonly [projectionOnlyHandleBrandV0_3]: true;
  source: S;
}>;

type VerifiedSourceMaterialBaseV0_3<S extends SourceV0_3> = Readonly<{
  readonly [verifiedSourceMaterialBrandV0_3]: true;
  source: S;
  consumedProofHandle: VerifiedTransientSourceBindingProofHandleV0_3<S>;
}>;

type SourceIdentityAndVersionBindingV0_3 = Readonly<{
  collectorId: string;
  collectorVersion: string;
  adapterId: string;
  adapterVersion: string;
  adapterArtifactSha256: Sha256LowerHexV0_3;
  inputContractVersion: string;
  sourceBundleContractVersion: string;
  verifierId: string;
  verifierVersion: string;
  preprocessingVersion: string | null;
  projectionVersion: string;
  projectionInputVersion: string;
  sourceContractCapProfileVersion: string;
  sourceContractSha256: Sha256LowerHexV0_3;
}>;

type FrozenSourceVerifierContractAndCapsV0_3<
  S extends SourceV0_3,
  CP extends ClosedSourceCapProfileBaseV0_3<S>,
> = Readonly<{
  source: S;
  identity: SourceIdentityAndVersionBindingV0_3;
  capProfileBinding: CP;
  sourceContractCaps: CP["caps"];
  sourceContractCapsJcsSha256: CP["capsJcsSha256"];
}>;

type AvailableRuntimeCapabilityV0_3<
  S extends SourceV0_3,
  CP extends ClosedSourceCapProfileBaseV0_3<S>,
> = Readonly<{
  readonly [runtimeCapabilityBrandV0_3]: true;
  source: S;
  status: "available";
  generationId: string;
  identity: SourceIdentityAndVersionBindingV0_3;
  capProfileBinding: CP;
  sourceContractCaps: CP["caps"];
  sourceContractCapsJcsSha256: CP["capsJcsSha256"];
  issuedAt: CanonicalUtcMillisV0_3;
  expiresAt: CanonicalUtcMillisV0_3;
  revokedAt: CanonicalUtcMillisV0_3 | null;
}>;

type UnavailableRuntimeCapabilityV0_3<S extends SourceV0_3> = Readonly<{
  readonly [runtimeCapabilityBrandV0_3]: true;
  source: S;
  status: "unavailable";
  generationId: string;
  identity: null;
  capProfileBinding: null;
  sourceContractCaps: null;
  sourceContractCapsJcsSha256: null;
  issuedAt: CanonicalUtcMillisV0_3;
  expiresAt: CanonicalUtcMillisV0_3;
  revokedAt: CanonicalUtcMillisV0_3 | null;
}>;

type RuntimeCapabilityV0_3<
  S extends SourceV0_3,
  CP extends ClosedSourceCapProfileBaseV0_3<S>,
> =
  | AvailableRuntimeCapabilityV0_3<S, CP>
  | UnavailableRuntimeCapabilityV0_3<S>;

type RuntimeCapabilityTupleV0_3<
  G extends RuntimeCapabilityBaseV0_3<"github">,
  X extends RuntimeCapabilityBaseV0_3<"codex">,
  C extends RuntimeCapabilityBaseV0_3<"google_calendar">,
  N extends RuntimeCapabilityBaseV0_3<"notion">,
  D extends RuntimeCapabilityBaseV0_3<"dayflow">,
> = readonly [
  G,
  X,
  C,
  N,
  D,
];

type RuntimeCapabilityTupleBaseV0_3 = RuntimeCapabilityTupleV0_3<
  RuntimeCapabilityBaseV0_3<"github">,
  RuntimeCapabilityBaseV0_3<"codex">,
  RuntimeCapabilityBaseV0_3<"google_calendar">,
  RuntimeCapabilityBaseV0_3<"notion">,
  RuntimeCapabilityBaseV0_3<"dayflow">
>;

type AtomicVerificationRuntimeSnapshotV0_3<
  Capabilities extends RuntimeCapabilityTupleBaseV0_3,
> = Readonly<{
  readonly [atomicRuntimeSnapshotBrandV0_3]: true;
  schemaVersion: "blabase-common-source-verification-runtime.v0.3";
  generationId: string;
  verificationInvocationId: string;
  verificationStartedAt: CanonicalUtcMillisV0_3;
  issuedAt: CanonicalUtcMillisV0_3;
  expiresAt: CanonicalUtcMillisV0_3;
  revokedAt: CanonicalUtcMillisV0_3 | null;
  consumedAt: CanonicalUtcMillisV0_3 | null;
  capabilities: Capabilities;
}>;
~~~

A brand-shaped plain object has no authority. The runtime resolves each object by private identity in
one parent-owned table for the exact current generation. The application caller cannot provide a
snapshot, capability, executable, handle, registry, or clock.

## 6. Sealed envelope and source-specific caps binding

~~~ts
type CollectorSealV0_3 = Readonly<{
  algorithm: "HMAC-SHA-256";
  domain: "blabase.lineage.collector-seal.v0.3";
  purpose: "source-collector-seal";
  keyVersion: string;
  hmacSha256: Sha256LowerHexV0_3;
}>;

type SealedCollectionEnvelopeMetadataV0_3<
  S extends SourceV0_3,
  K extends string,
  C extends ClosedNumericCapProfileV0_3<K>,
> = Readonly<{
  schemaVersion: "blabase-source-collection-envelope.v0.3";
  source: S;
  identity: SourceIdentityAndVersionBindingV0_3;
  sourceContractCaps: C;
  sourceContractCapsJcsSha256: Sha256LowerHexV0_3;
  registryGenerationId: string;
  contextId: string;
  frozenEvaluationCaseId: string;
  datasetVersion: string;
  datasetSha256: Sha256LowerHexV0_3;
  comparisonScopeId: string;
  verificationRunId: string;
  accountContextHmacSha256: Sha256LowerHexV0_3;
  requestBindingHmacSha256: Sha256LowerHexV0_3;
  collectionAttemptId: string;
  collectionAttemptBindingHmacSha256: Sha256LowerHexV0_3;
  requestedCollectionMode: string;
  requiredOperations: readonly string[];
  artifactManifestSha256: Sha256LowerHexV0_3;
  sourceArtifactSetSha256: Sha256LowerHexV0_3;
  attemptedAt: CanonicalUtcMillisV0_3;
  startedAt: CanonicalUtcMillisV0_3 | null;
  completedAt: CanonicalUtcMillisV0_3 | null;
  collectedAt: CanonicalUtcMillisV0_3;
  sealedAt: CanonicalUtcMillisV0_3;
  collectorSeal: CollectorSealV0_3;
}>;
~~~

The collector MAC is exact:

~~~text
canonicalMacInput =
  exact envelope with only collectorSeal.hmacSha256 omitted

preimage =
  UTF8("blabase.lineage.collector-seal.v0.3")
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

## 7. Runtime source-binding proof, submission, and snapshot

### 7.1 Registry and transient proof handle

~~~ts
type ZeroizationSlotDescriptorV0_3<
  S extends SourceV0_3,
  K extends string,
> = Readonly<{
  source: S;
  slotId: string;
  slotKind: K;
  setMembership: "requested" | "observed";
  setOrdinal: NonNegativeSafeIntegerV0_3;
  byteLength: NonNegativeSafeIntegerV0_3;
}>;

type ZeroizationVaultHandleV0_3<S extends SourceV0_3> = Readonly<{
  readonly [zeroizationVaultHandleBrandV0_3]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultId: string;
}>;

type SourceBindingVaultDescriptorSetBaseV0_3<
  S extends SourceV0_3,
> = Readonly<{
  readonly [sourceBindingVaultDescriptorSetBrandV0_3]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultHandle: ZeroizationVaultHandleV0_3<S>;
  requestedSlotDescriptors:
    readonly ZeroizationSlotDescriptorV0_3<S, string>[];
  observedSlotDescriptors:
    readonly ZeroizationSlotDescriptorV0_3<S, string>[] | null;
}>;

type SourceBindingVaultDescriptorSetV0_3<
  S extends SourceV0_3,
  Slot extends ZeroizationSlotDescriptorV0_3<S, string>,
> = Readonly<{
  readonly [sourceBindingVaultDescriptorSetBrandV0_3]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultHandle: ZeroizationVaultHandleV0_3<S>;
  requestedSlotDescriptors: readonly Slot[];
  observedSlotDescriptors: readonly Slot[] | null;
}>;

type ZeroizationVaultBufferSlotV0_3 = {
  slotId: string;
  bytes: Uint8Array;
  readCount: 0 | 1;
  overwritten: boolean;
};

type ZeroizationVaultV0_3<S extends SourceV0_3> = {
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  vaultId: string;
  state: "active" | "disposing" | "disposed";
  slots: ZeroizationVaultBufferSlotV0_3[];
};

type ZeroizationVaultDisposalRecordV0_3<S extends SourceV0_3> =
  Readonly<{
    source: S;
    vaultId: string;
    status: "disposed";
    slotCount: NonNegativeSafeIntegerV0_3;
    ownedByteCount: NonNegativeSafeIntegerV0_3;
    overwrittenByteCount: NonNegativeSafeIntegerV0_3;
    everyOwnedByteZero: true;
    everySlotReadAtMostOnce: true;
    replayInvalidated: true;
  }>;

type SourceBindingRegistryEntryV0_3<
  S extends SourceV0_3,
  DS extends SourceBindingVaultDescriptorSetBaseV0_3<S>,
  W extends ExactJsonValueV0_3,
> = Readonly<{
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  privacyKeyVersion: string;
  sourceProofVersion: string;
  registeredAt: CanonicalUtcMillisV0_3;
  expiresAt: CanonicalUtcMillisV0_3;
  revokedAt: CanonicalUtcMillisV0_3 | null;
  consumedAt: CanonicalUtcMillisV0_3 | null;
  descriptorSet: DS;
  expectedWireCommitments: W;
}>;

type TransientSourceBindingProofHandleV0_3<S extends SourceV0_3> = Readonly<{
  readonly [sourceBindingProofHandleBrandV0_3]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  privacyKeyVersion: string;
  sourceProofVersion: string;
  nonce: string;
}>;

type VerifiedTransientSourceBindingProofHandleV0_3<
  S extends SourceV0_3,
> = Readonly<{
  readonly [sourceBindingProofHandleBrandV0_3]: true;
  source: S;
  generationId: string;
  contextId: string;
  collectionAttemptId: string;
  privacyKeyVersion: string;
  sourceProofVersion: string;
  nonce: string;
  state: "verified_and_consumed";
}>;

type CollectionSubmissionV0_3<
  S extends SourceV0_3,
> = Readonly<{
  source: S;
  canonicalEnvelopeUtf8: Uint8Array;
  canonicalSourceBundleUtf8: Uint8Array;
  sourceBindingProofHandle: TransientSourceBindingProofHandleV0_3<S>;
}>;

type ParentCollectionSnapshotV0_3<
  S extends SourceV0_3,
  K extends string,
  C extends ClosedNumericCapProfileV0_3<K>,
  BV extends string,
  B extends ExactSourceBundleBaseV0_3<S, BV>,
  CP extends ClosedSourceCapProfileV0_3<S, K, C>,
  SB extends ClosedSourceBundleV0_3<S, BV, B>,
> = Readonly<{
  source: S;
  parentOwnedEnvelopeBytes: Uint8Array;
  parentOwnedBundleBytes: Uint8Array;
  parsedEnvelope: SealedCollectionEnvelopeMetadataV0_3<S, K, C>;
  capProfileBinding: CP;
  parsedSourceBundle: SB;
  sourceBindingProofHandle: TransientSourceBindingProofHandleV0_3<S>;
}>;
~~~

The proof handle is NON-WIRE, runtime-only, unforgeable by private identity, context/generation/
attempt/key/version bound, single-use, never callback-visible, and never serialized, persisted,
returned, logged, or placed in a fixture. Trusted collection creates the source-specific registry
entry and handle before discarding provider identity material.

The frozen registry entry contains exactly one parent-branded descriptorSet for its proof handle.
That set contains only immutable requested/observed ordered slot descriptors and one nominal vault
handle; it never embeds a non-empty Uint8Array. descriptorSet.source, generationId, contextId,
collectionAttemptId, and every corresponding vault-handle field MUST equal the registry entry and
proof handle exactly.

Requested and observed set ordinals are unique dense zero-based sequences. Their exact counts obey
the child contract. observedSlotDescriptors is null iff the child observed scope is null. A slot ID
cannot occur in both sets, be omitted from the vault, appear twice, or map to more than one child
identity/ref. Every descriptor bijects to exactly one same-length vault slot and exactly one later
recomputed source ref; every owned vault slot used for source binding has exactly one descriptor.
The parent-owned NON-WIRE mutable ZeroizationVaultV0_3 alone owns buffers and is resolved only
through the set's unforgeable handle. Preflight reads each slot at most once.

On every terminal path the parent overwrites every byte in every owned slot with zero, records the
closed disposal status and exact slot/byte counts, drops vault-handle and registry references, and
invalidates replay. This guarantees logical invalidation and overwrite of the owned buffers. It
does not claim forensic erasure of unavoidable runtime, OS, allocator, or cryptographic-library
copies. Implementations MUST prohibit avoidable string conversion, logging, persistence, immutable
copies, or duplicate buffers.

A forged or malformed handle is SOURCE_BINDING_INVALID/source_bundle_invalid. A stale, consumed,
replayed, wrong-context, wrong-generation, wrong-attempt, or wrong-version handle is
PRIVACY_SCOPE_CONTEXT_INVALID/context_binding_invalid. A missing, expired, revoked, deleted, or
wrong-purpose privacy key/handle is PRIVACY_SCOPE_KEY_UNAVAILABLE/privacy_scope_key_unavailable.

### 7.2 Lifecycle

For trusted time t = verificationStartedAt, snapshots, capabilities, registrations, and proof
handles are active exactly when:

~~~text
issuedAt <= t
AND t < expiresAt
AND (revokedAt is null OR t < revokedAt)
AND issuedAt < expiresAt
AND generationId is the one current atomic generation
AND consumedAt is null
~~~

A privacy or collector key is active exactly when:

~~~text
issuedAt <= t
AND t < expiresAt
AND (revokedAt is null OR t < revokedAt)
AND (deletedAt is null OR t < deletedAt)
AND issuedAt < expiresAt
~~~

Equality at expiry, revocation, or deletion is invalid; equality at issuance is valid. Every
timestamp is canonical UTC milliseconds and rejects year 0000. One clock sample t is used for every
semantic lifecycle decision. A parent watchdog clock is operational-only and never enters canonical
input, envelope, seal, result, diagnostic, failure precedence, or semantic output.

Envelope chronology is exact:

~~~text
attemptedAt <= collectedAt <= sealedAt <= verificationStartedAt
startedAt is null iff completedAt is null
startedAt is non-null => attemptedAt <= startedAt <= collectedAt
completedAt is non-null => startedAt <= completedAt <= collectedAt
~~~

The runtime checks generation currentness atomically at snapshot acquisition, immediately before
each isolate launch, after each isolate completion, and immediately before aggregate sealing. Any
retry is a fresh invocation, snapshot, attempt authorization, and handle. No snapshot or proof
handle is cached or replayed.

## 8. Parent verified material and projection handle

~~~ts
type ParentOwnedSourceProofV0_3<
  S extends SourceV0_3,
  PW extends ExactJsonValueV0_3,
> = Readonly<{
  readonly [parentOwnedSourceProofBrandV0_3]: true;
  source: S;
  proofVersion: string;
  verifiedWireCommitments: PW;
  verifiedAt: CanonicalUtcMillisV0_3;
}>;

type VerifiedSourceMaterialV0_3<
  S extends SourceV0_3,
  CP extends ClosedSourceCapProfileBaseV0_3<S>,
  SB extends ClosedSourceBundleBaseV0_3<S>,
  SP extends ParentOwnedSourceProofV0_3<S, ExactJsonValueV0_3>,
  CW extends ExactJsonValueV0_3,
  AW extends ExactJsonValueV0_3,
  PP extends ClosedSourceProjectionPayloadBaseV0_3<S>,
  PH extends VerifiedTransientSourceBindingProofHandleV0_3<S>,
> = Readonly<{
  readonly [verifiedSourceMaterialBrandV0_3]: true;
  source: S;
  capProfileBinding: CP;
  fullVerifiedBundle: SB;
  sourceProof: SP;
  coverageInputs: CW;
  attestationInputs: AW;
  projectionPayload: PP;
  consumedProofHandle: PH;
}>;

type ProjectionOnlyHandleV0_3<
  S extends SourceV0_3,
  PP extends ClosedSourceProjectionPayloadBaseV0_3<S>,
> = Readonly<{
  readonly [projectionOnlyHandleBrandV0_3]: true;
  source: S;
  projectionInputVersion: PP["projectionInputVersion"];
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  projectionPayloadSha256: Sha256LowerHexV0_3;
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
type ParentPreflightFailureV0_3 =
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

type GlobalParentPreflightFailureV0_3 = Extract<
  ParentPreflightFailureV0_3,
  { readonly failureCode: "RESOURCE_LIMIT_EXCEEDED" | "INPUT_INVALID" }
>;

type CalendarOnlyParentPreflightFailureV0_3 = Extract<
  ParentPreflightFailureV0_3,
  { readonly failureCode: "TIMEZONE_PROFILE_INVALID" }
>;

type SharedSourceLocalParentPreflightFailureV0_3 = Exclude<
  ParentPreflightFailureV0_3,
  GlobalParentPreflightFailureV0_3 | CalendarOnlyParentPreflightFailureV0_3
>;

type ParentPreflightFailureBySourceV0_3 = Readonly<{
  github: SharedSourceLocalParentPreflightFailureV0_3;
  codex: SharedSourceLocalParentPreflightFailureV0_3;
  google_calendar:
    | SharedSourceLocalParentPreflightFailureV0_3
    | CalendarOnlyParentPreflightFailureV0_3;
  notion: SharedSourceLocalParentPreflightFailureV0_3;
  dayflow: SharedSourceLocalParentPreflightFailureV0_3;
}>;

type ParentPreflightFailureForSourceV0_3<S extends SourceV0_3> =
  | GlobalParentPreflightFailureV0_3
  | ParentPreflightFailureBySourceV0_3[S];

type ParentPreflightSuccessV0_3<
  S extends SourceV0_3,
  VM extends VerifiedSourceMaterialBaseV0_3<S>,
  H extends ProjectionOnlyHandleBaseV0_3<S>,
> = Readonly<{
  outcome: "prepared";
  source: S;
  verifiedMaterial: VM;
  projectionHandle: H;
  consumedSourceBindingProof: VM["consumedProofHandle"];
}>;

type ParentPreflightResultV0_3<
  S extends SourceV0_3,
  VM extends VerifiedSourceMaterialBaseV0_3<S>,
  H extends ProjectionOnlyHandleBaseV0_3<S>,
  F extends ParentPreflightFailureForSourceV0_3<S>,
> =
  | ParentPreflightSuccessV0_3<S, VM, H>
  | Readonly<{
      outcome: "rejected";
      source: S;
      failure: F;
    }>;
~~~

TIMEZONE_PROFILE_INVALID is structurally legal only for source google_calendar. Every other source
instantiation resolves that branch to never. Child contracts may further restrict the parent union
but may not add a code or detail.

### 9.2 Exact pre-callback order

For one requested available source, the parent performs exactly:

1. Reserve Common and source caps and copy submitted bytes into bounded parent memory.
2. Acquire and validate the one-shot snapshot, capability, registry generation, and proof handle.
3. Strict-decode, parse, exact-key validate, hostile-object reject, and confirm canonical byte
   equality for envelope and bundle.
4. Validate source, mode, operation, identity, version, caps, contract SHA-256, adapter artifact,
   context, generation, case, dataset, account, comparison scope, run, request, attempt, chronology,
   and capability equality.
5. Verify collector-seal lifecycle and MAC.
6. Verify manifest, component, artifact-set, and all required detached hashes.
7. Recompute every source-specific raw-identity commitment from the registry entry; require exact
   wire relationship and equality; consume the proof handle; zeroize and dispose raw material.
8. Validate privacy key lifecycle, source-specific scope, pagination, coverage, text, forbidden
   fields, and source-specific semantic constraints.
9. Retain full verified material; independently materialize, validate, hash, and deep-freeze the
   projection-only payload.
10. Register one projection handle and prepare the isolate invocation.

No callback starts before all ten steps succeed. Malformed canonical bytes, exact-key errors,
forbidden fields, invalid source or version, identity/caps mismatch, invalid title shape, or any
other structural/source-binding error maps exactly to
SOURCE_BINDING_INVALID/source_bundle_invalid. The callback union cannot return that code.

Caps exceedance has highest precedence. A cap object/value/equality mismatch is source binding
invalid; an otherwise correctly bound input exceeding its cap is resource limit exceeded. After
resource/runtime conditions, source-local candidates use this fixed order:

~~~text
SOURCE_BINDING_INVALID
SOURCE_ATTESTATION_INVALID
HASH_MISMATCH
SOURCE_VERIFIER_UNAVAILABLE
PRIVACY_SCOPE_CONTEXT_INVALID
PRIVACY_SCOPE_KEY_UNAVAILABLE
SCOPE_TOKEN_CANONICALIZATION_INVALID
PRIVACY_SCOPE_DIGEST_INVALID
TIMEZONE_PROFILE_INVALID
SOURCE_ATTESTATION_BINDING_MISMATCH
RECORD_ID_SET_MISMATCH
COVERAGE_INVALID
~~~

Stage 1 intrinsic receipt failures precede Stage 2 record-set failures, and both precede Stage 3.
Within Stage 2, per-source count or record-ID-set mismatch is
RECORD_ID_SET_MISMATCH. Root hash or asOf mismatch is eligible for
RECORD_SET_BINDING_MISMATCH only when every applicable per-source count and ID-set predicate agrees.
Within Stage 3, count and ID-set comparison precede same-ID content/binding comparison. Fixed source
order, then closed diagnostic declaration order, breaks ties. Timing never selects a semantic result.

## 10. Projection completeness conversion

~~~ts
type FrozenTextTruncationAssertionV0_3 = Readonly<{
  wasTruncated: boolean;
}>;

type CompletenessConversionInputV0_3 = Readonly<{
  coverageStatus: SourceCoverageStatusV0_3;
  applicableAllowedTextSpans:
    readonly FrozenTextTruncationAssertionV0_3[];
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
type CallbackOwnedIssueV0_3 = Readonly<{
  code: "PROJECTION_ITEM_OMITTED";
  projectionOrdinal: NonNegativeSafeIntegerV0_3;
}>;

type CallbackOwnedDiagnosticV0_3 = Readonly<{
  code: "BUILD_RECORD_PROJECTION_INVALID";
}>;

type SourceAdapterCallbackSuccessV0_3<
  S extends SourceV0_3,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_3,
> = Readonly<{
  outcome: "built";
  source: S;
  buildRecords: readonly R[];
  issues: readonly I[];
  diagnostics: readonly [];
}>;

type SourceAdapterCallbackRejectionV0_3<
  S extends SourceV0_3,
  D extends CallbackOwnedDiagnosticV0_3,
> = Readonly<{
  outcome: "rejected";
  source: S;
  rejectionReason: "BUILD_RECORD_PROJECTION_INVALID";
  buildRecords: readonly [];
  issues: readonly [];
  diagnostics: readonly [D];
}>;

type SourceAdapterReturnedResultV0_3<
  S extends SourceV0_3,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_3,
  D extends CallbackOwnedDiagnosticV0_3,
> =
  | SourceAdapterCallbackSuccessV0_3<S, R, I>
  | SourceAdapterCallbackRejectionV0_3<S, D>;
~~~

The adapter-authored result is exactly SourceAdapterReturnedResultV0_3 and contains only built or
rejected. Trap, forbidden access, timeout, protocol, containment, and teardown outcomes are authored
only by the parent isolate supervisor. Each child narrows issues and diagnostics. An empty source
issue type produces an exact empty array. Callback-owned issues are bounded projection notes only;
they are not lineage coverage, attestation, source proof, suggestion caveats, or public diagnostics.

### 12.2 Invocation and exact IPC schemas

~~~ts
type SourceAdapterInvocationV0_3<
  S extends SourceV0_3,
  PP extends ClosedSourceProjectionPayloadBaseV0_3<S>,
> = Readonly<{
  readonly [isolateInvocationBrandV0_3]: true;
  source: S;
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  contextBindingSha256: Sha256LowerHexV0_3;
  projectionHandle: ProjectionOnlyHandleV0_3<S, PP>;
  identity: SourceIdentityAndVersionBindingV0_3;
  sourceContractCapsJcsSha256: Sha256LowerHexV0_3;
}>;

type DisposableIsolateIpcInputV0_3<
  S extends SourceV0_3,
  PV extends string,
  P extends SourceProjectionPayloadBaseV0_3<S, PV>,
> = Readonly<{
  schemaVersion: "blabase-source-adapter-isolate-input.v0.3";
  protocolVersion: "blabase-source-adapter-isolate-protocol.v0.3";
  source: S;
  invocationBindingSha256: Sha256LowerHexV0_3;
  contextBindingSha256: Sha256LowerHexV0_3;
  adapterId: string;
  adapterVersion: string;
  adapterArtifactSha256: Sha256LowerHexV0_3;
  projectionVersion: string;
  projectionInputVersion: PV;
  projectionPayloadSha256: Sha256LowerHexV0_3;
  sourceContractCapProfileVersion: string;
  sourceContractCapsJcsSha256: Sha256LowerHexV0_3;
  sourceContractSha256: Sha256LowerHexV0_3;
  projectionPayload: P;
}>;

type DisposableIsolateIpcBuiltResultV0_3<
  S extends SourceV0_3,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_3,
> = Readonly<{
  schemaVersion: "blabase-source-adapter-isolate-result.v0.3";
  protocolVersion: "blabase-source-adapter-isolate-protocol.v0.3";
  source: S;
  invocationBindingSha256: Sha256LowerHexV0_3;
  adapterArtifactSha256: Sha256LowerHexV0_3;
  outcome: "built";
  buildRecords: readonly R[];
  issues: readonly I[];
  diagnostics: readonly [];
}>;

type DisposableIsolateIpcRejectedResultV0_3<
  S extends SourceV0_3,
  D extends CallbackOwnedDiagnosticV0_3,
> = Readonly<{
  schemaVersion: "blabase-source-adapter-isolate-result.v0.3";
  protocolVersion: "blabase-source-adapter-isolate-protocol.v0.3";
  source: S;
  invocationBindingSha256: Sha256LowerHexV0_3;
  adapterArtifactSha256: Sha256LowerHexV0_3;
  outcome: "rejected";
  rejectionReason: "BUILD_RECORD_PROJECTION_INVALID";
  buildRecords: readonly [];
  issues: readonly [];
  diagnostics: readonly [D];
}>;

type DisposableIsolateIpcResultV0_3<
  S extends SourceV0_3,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_3,
  D extends CallbackOwnedDiagnosticV0_3,
> =
  | DisposableIsolateIpcBuiltResultV0_3<S, R, I>
  | DisposableIsolateIpcRejectedResultV0_3<S, D>;
~~~

Input and result are each exactly one RFC 8785 JCS UTF-8 message on the one parent-created channel.
Input maximum is 1,048,576 bytes. Result maximum is 1,048,576 bytes. The input hash, result hash,
invocation binding, context binding, protocol, schemas, source, identity versions, cap-profile
identity, source contract identity, projection identities, and adapterArtifactSha256 are fixed
before launch. The parent sends exactly one input. The isolate may send at most one result. No extra
message, channel, port, stream, descriptor, shared buffer, or side band exists.

### 12.3 Exact completion union

~~~ts
type PreLaunchIsolateFailureV0_3<S extends SourceV0_3> = Readonly<{
  phase: "pre_launch";
  source: S;
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  contextBindingSha256: Sha256LowerHexV0_3;
  failure:
    | "runtime_snapshot_not_current"
    | "capability_unavailable"
    | "adapter_artifact_unavailable"
    | "adapter_artifact_hash_mismatch"
    | "isolate_launch_setup_failed";
  launched: false;
}>;

type PostLaunchIsolateCompletionBaseV0_3<
  S extends SourceV0_3,
> = Readonly<{
  phase: "post_launch";
  source: S;
  generationId: string;
  verificationInvocationId: string;
  collectionAttemptId: string;
  contextBindingSha256: Sha256LowerHexV0_3;
  invocationBindingSha256: Sha256LowerHexV0_3;
  adapterArtifactSha256: Sha256LowerHexV0_3;
  ipcInputSha256: Sha256LowerHexV0_3;
  completionSha256: Sha256LowerHexV0_3;
  launched: true;
}>;

type ForbiddenAdapterCapabilityV0_3 =
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

type DisposableIsolateCompletionV0_3<
  S extends SourceV0_3,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  I extends CallbackOwnedIssueV0_3,
  D extends CallbackOwnedDiagnosticV0_3,
> =
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
      completion: "success";
      result: DisposableIsolateIpcBuiltResultV0_3<S, R, I>;
      adapterReturnedResultSha256: Sha256LowerHexV0_3;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
      completion: "returned_rejection";
      result: DisposableIsolateIpcRejectedResultV0_3<S, D>;
      adapterReturnedResultSha256: Sha256LowerHexV0_3;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
      completion: "trap";
      trapKind: "synchronous_exception";
      containmentConfirmed: true;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
      completion: "forbidden_capability_blocked";
      forbiddenCapability: ForbiddenAdapterCapabilityV0_3;
      containmentConfirmed: true;
      teardownConfirmed: true;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
      completion: "timeout_watchdog";
      lineageResult: null;
      teardownConfirmed: boolean;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
      completion: "protocol_violation";
      violation:
        | "result_schema_or_hash_mismatch"
        | "identity_or_artifact_mismatch"
        | "multiple_results"
        | "missing_result";
      lineageResult: null;
      teardownConfirmed: boolean;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
      completion: "containment_escape";
      violation:
        | "containment_escape"
        | "extra_message_channel_or_port"
        | "supervisor_sandbox_policy_failure";
      lineageResult: null;
      teardownConfirmed: boolean;
    }>)
  | (PostLaunchIsolateCompletionBaseV0_3<S> & Readonly<{
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
blabase.source-adapter-isolate.context-binding.v0.3 and exactly:

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
  schemaVersion: "blabase-source-adapter-context-binding.v0.3",
  source,
  verificationRunId
}
~~~

invocationBindingSha256 uses domain
blabase.source-adapter-isolate.invocation-binding.v0.3 and exactly:

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
  schemaVersion: "blabase-source-adapter-invocation-binding.v0.3",
  source,
  sourceContractCapProfileVersion,
  sourceContractCapsJcsSha256,
  sourceContractSha256,
  verificationInvocationId
}
~~~

ipcInputSha256 uses domain blabase.source-adapter-isolate.ipc-input.v0.3 and the entire exact
DisposableIsolateIpcInputV0_3 object. adapterReturnedResultSha256 uses domain
blabase.source-adapter-isolate.returned-result.v0.3 and the entire exact built or rejected result
object. completionSha256 uses domain blabase.source-adapter-isolate.completion.v0.3 and the entire
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
type PreparedSourceTerminalV0_3<
  S extends SourceV0_3,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S> =
    ClosedSourceTerminalFailureForSourceV0_3<S>,
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

type SharedPostPreflightTerminalFailureV0_3 =
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

type ClosedSourceTerminalFailureBySourceV0_3 = Readonly<{
  github:
    | ParentPreflightFailureBySourceV0_3["github"]
    | SharedPostPreflightTerminalFailureV0_3;
  codex:
    | ParentPreflightFailureBySourceV0_3["codex"]
    | SharedPostPreflightTerminalFailureV0_3;
  google_calendar:
    | ParentPreflightFailureBySourceV0_3["google_calendar"]
    | SharedPostPreflightTerminalFailureV0_3;
  notion:
    | ParentPreflightFailureBySourceV0_3["notion"]
    | SharedPostPreflightTerminalFailureV0_3;
  dayflow:
    | ParentPreflightFailureBySourceV0_3["dayflow"]
    | SharedPostPreflightTerminalFailureV0_3;
}>;

type ClosedSourceTerminalFailureForSourceV0_3<
  S extends SourceV0_3,
> = ClosedSourceTerminalFailureBySourceV0_3[S];

type ClosedSourceTerminalFailureV0_3 =
  ClosedSourceTerminalFailureBySourceV0_3[SourceV0_3];

type SealedPreparedSourceTerminalV0_3<
  S extends SourceV0_3,
  R extends CommonSuggestionEvidenceBuildRecordV0_1,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S> =
    ClosedSourceTerminalFailureForSourceV0_3<S>,
> = Readonly<{
  readonly [preparedTerminalBrandV0_3]: true;
  generationId: string;
  verificationInvocationId: string;
  source: S;
  terminalSha256: Sha256LowerHexV0_3;
  terminal: PreparedSourceTerminalV0_3<S, R, F>;
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
type SanitizedFailedSourceResultForPairV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S>,
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
          detail: D;
        }>,
      ];
    }>
  : never;

type SanitizedSourceResultV0_3<S extends SourceV0_3> =
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
      projectedRecordCount: NonNegativeSafeIntegerV0_3;
      failureCode: null;
      failureDetail: null;
      diagnostics: readonly [];
    }>
  | SanitizedFailedSourceResultForPairV0_3<
      S,
      ClosedSourceTerminalFailureForSourceV0_3<S>
    >;

type SanitizedSourceDiagnosticV0_3<S extends SourceV0_3> =
  SanitizedFailedSourceResultForPairV0_3<
    S,
    ClosedSourceTerminalFailureForSourceV0_3<S>
  >["diagnostics"][number];

type SanitizedGlobalDiagnosticV0_3 =
  | Readonly<{
      stage: "source_attestation";
      source: null;
      failureCode: "RESOURCE_LIMIT_EXCEEDED";
      detail: "invocation_resource_limit_exceeded";
    }>
  | Readonly<{
      stage: "source_attestation";
      source: null;
      failureCode: "INPUT_INVALID";
      detail:
        | "runtime_snapshot_invalid"
        | "runtime_snapshot_stale"
        | "runtime_corruption"
        | "capability_correspondence_invalid";
    }>;

type SourceResultTupleV0_3 = readonly [
  SanitizedSourceResultV0_3<"github">,
  SanitizedSourceResultV0_3<"codex">,
  SanitizedSourceResultV0_3<"google_calendar">,
  SanitizedSourceResultV0_3<"notion">,
  SanitizedSourceResultV0_3<"dayflow">,
];

type SuccessfulSanitizedSourceResultV0_3<S extends SourceV0_3> =
  Extract<
    SanitizedSourceResultV0_3<S>,
    { readonly status: "not_requested" | "verified" }
  >;

type NotRequestedSanitizedSourceResultV0_3<S extends SourceV0_3> =
  Extract<SanitizedSourceResultV0_3<S>, { readonly status: "not_requested" }>;

type VerifiedSanitizedSourceResultV0_3<S extends SourceV0_3> =
  Extract<SanitizedSourceResultV0_3<S>, { readonly status: "verified" }>;

type NonEmptySuccessfulSourceResultTupleV0_3 =
  | readonly [
      VerifiedSanitizedSourceResultV0_3<"github">,
      SuccessfulSanitizedSourceResultV0_3<"codex">,
      SuccessfulSanitizedSourceResultV0_3<"google_calendar">,
      SuccessfulSanitizedSourceResultV0_3<"notion">,
      SuccessfulSanitizedSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_3<"github">,
      VerifiedSanitizedSourceResultV0_3<"codex">,
      SuccessfulSanitizedSourceResultV0_3<"google_calendar">,
      SuccessfulSanitizedSourceResultV0_3<"notion">,
      SuccessfulSanitizedSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_3<"github">,
      NotRequestedSanitizedSourceResultV0_3<"codex">,
      VerifiedSanitizedSourceResultV0_3<"google_calendar">,
      SuccessfulSanitizedSourceResultV0_3<"notion">,
      SuccessfulSanitizedSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_3<"github">,
      NotRequestedSanitizedSourceResultV0_3<"codex">,
      NotRequestedSanitizedSourceResultV0_3<"google_calendar">,
      VerifiedSanitizedSourceResultV0_3<"notion">,
      SuccessfulSanitizedSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      NotRequestedSanitizedSourceResultV0_3<"github">,
      NotRequestedSanitizedSourceResultV0_3<"codex">,
      NotRequestedSanitizedSourceResultV0_3<"google_calendar">,
      NotRequestedSanitizedSourceResultV0_3<"notion">,
      VerifiedSanitizedSourceResultV0_3<"dayflow">,
    ];

type EmptyPlanSourceResultTupleV0_3 = readonly [
  NotRequestedSanitizedSourceResultV0_3<"github">,
  NotRequestedSanitizedSourceResultV0_3<"codex">,
  NotRequestedSanitizedSourceResultV0_3<"google_calendar">,
  NotRequestedSanitizedSourceResultV0_3<"notion">,
  NotRequestedSanitizedSourceResultV0_3<"dayflow">,
];

type SealedTerminalSourceResultV0_3<S extends SourceV0_3> =
  Exclude<SanitizedSourceResultV0_3<S>, { readonly status: "aborted" }>;

type UnsealedNonInterruptedSourceResultV0_3<S extends SourceV0_3> =
  Extract<SanitizedSourceResultV0_3<S>, { readonly status: "not_requested" }>;

type UnsealedInterruptedSourceResultV0_3<S extends SourceV0_3> = Readonly<{
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

type UnsealedInterruptedControlSourceResultV0_3<S extends SourceV0_3> =
  | UnsealedNonInterruptedSourceResultV0_3<S>
  | UnsealedInterruptedSourceResultV0_3<S>;

type UnsealedNonInterruptedControlSourceResultTupleV0_3 = readonly [
  UnsealedNonInterruptedSourceResultV0_3<"github">,
  UnsealedNonInterruptedSourceResultV0_3<"codex">,
  UnsealedNonInterruptedSourceResultV0_3<"google_calendar">,
  UnsealedNonInterruptedSourceResultV0_3<"notion">,
  UnsealedNonInterruptedSourceResultV0_3<"dayflow">,
];

type UnsealedInterruptedControlSourceResultTupleV0_3 =
  | readonly [
      UnsealedInterruptedSourceResultV0_3<"github">,
      UnsealedInterruptedControlSourceResultV0_3<"codex">,
      UnsealedInterruptedControlSourceResultV0_3<"google_calendar">,
      UnsealedInterruptedControlSourceResultV0_3<"notion">,
      UnsealedInterruptedControlSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_3<"github">,
      UnsealedInterruptedSourceResultV0_3<"codex">,
      UnsealedInterruptedControlSourceResultV0_3<"google_calendar">,
      UnsealedInterruptedControlSourceResultV0_3<"notion">,
      UnsealedInterruptedControlSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_3<"github">,
      UnsealedNonInterruptedSourceResultV0_3<"codex">,
      UnsealedInterruptedSourceResultV0_3<"google_calendar">,
      UnsealedInterruptedControlSourceResultV0_3<"notion">,
      UnsealedInterruptedControlSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_3<"github">,
      UnsealedNonInterruptedSourceResultV0_3<"codex">,
      UnsealedNonInterruptedSourceResultV0_3<"google_calendar">,
      UnsealedInterruptedSourceResultV0_3<"notion">,
      UnsealedInterruptedControlSourceResultV0_3<"dayflow">,
    ]
  | readonly [
      UnsealedNonInterruptedSourceResultV0_3<"github">,
      UnsealedNonInterruptedSourceResultV0_3<"codex">,
      UnsealedNonInterruptedSourceResultV0_3<"google_calendar">,
      UnsealedNonInterruptedSourceResultV0_3<"notion">,
      UnsealedInterruptedSourceResultV0_3<"dayflow">,
    ];

type ExactV0_1PreflightFailureV0_3 = Extract<
  ExecuteAuthoritativeVerificationKernelInternalResultV0_1,
  { readonly executed: false }
>;

type ExactV0_1EmptyPlanCompletionV0_3 = Extract<
  ExecuteAuthoritativeVerificationKernelInternalResultV0_1,
  { readonly executed: true }
>;

type FailedSanitizedSourceResultV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S> =
    ClosedSourceTerminalFailureForSourceV0_3<S>,
> = F extends Readonly<{
  code: infer C extends string;
  detail: infer D extends string;
}>
  ? Extract<
      SanitizedSourceResultV0_3<S>,
      Readonly<{
        source: S;
        status: "failed";
        failureCode: C;
        failureDetail: D;
      }>
    >
  : never;

type NonFailedSealedSourceResultV0_3<S extends SourceV0_3> =
  Extract<
    SanitizedSourceResultV0_3<S>,
    { readonly status: "not_requested" | "verified" }
  >;

type DistributeTupleV0_3<T extends readonly unknown[]> =
  T extends readonly [infer Head, ...infer Tail]
    ? Head extends unknown
      ? DistributeTupleV0_3<Tail> extends infer DistributedTail
        ? DistributedTail extends readonly unknown[]
          ? readonly [Head, ...DistributedTail]
          : never
        : never
      : never
    : readonly [];

type SealedNonAbortedSourceResultV0_3<S extends SourceV0_3> =
  | NonFailedSealedSourceResultV0_3<S>
  | FailedSanitizedSourceResultV0_3<
      S,
      ClosedSourceTerminalFailureForSourceV0_3<S>
    >;

type SealedFailureSourceResultTupleTemplateV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S>,
> =
  S extends "github" ? readonly [
    FailedSanitizedSourceResultV0_3<S, F>,
    SealedNonAbortedSourceResultV0_3<"codex">,
    SealedNonAbortedSourceResultV0_3<"google_calendar">,
    SealedNonAbortedSourceResultV0_3<"notion">,
    SealedNonAbortedSourceResultV0_3<"dayflow">,
  ]
  : S extends "codex" ? readonly [
    NonFailedSealedSourceResultV0_3<"github">,
    FailedSanitizedSourceResultV0_3<S, F>,
    SealedNonAbortedSourceResultV0_3<"google_calendar">,
    SealedNonAbortedSourceResultV0_3<"notion">,
    SealedNonAbortedSourceResultV0_3<"dayflow">,
  ]
  : S extends "google_calendar" ? readonly [
    NonFailedSealedSourceResultV0_3<"github">,
    NonFailedSealedSourceResultV0_3<"codex">,
    FailedSanitizedSourceResultV0_3<S, F>,
    SealedNonAbortedSourceResultV0_3<"notion">,
    SealedNonAbortedSourceResultV0_3<"dayflow">,
  ]
  : S extends "notion" ? readonly [
    NonFailedSealedSourceResultV0_3<"github">,
    NonFailedSealedSourceResultV0_3<"codex">,
    NonFailedSealedSourceResultV0_3<"google_calendar">,
    FailedSanitizedSourceResultV0_3<S, F>,
    SealedNonAbortedSourceResultV0_3<"dayflow">,
  ]
  : S extends "dayflow" ? readonly [
    NonFailedSealedSourceResultV0_3<"github">,
    NonFailedSealedSourceResultV0_3<"codex">,
    NonFailedSealedSourceResultV0_3<"google_calendar">,
    NonFailedSealedSourceResultV0_3<"notion">,
    FailedSanitizedSourceResultV0_3<S, F>,
  ]
  : never;

type SealedFailureSourceResultTupleForPrimaryV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S>,
> = F extends ClosedSourceTerminalFailureForSourceV0_3<S>
  ? DistributeTupleV0_3<
      SealedFailureSourceResultTupleTemplateV0_3<S, F>
    >
  : never;

type SealedFailureSourceResultTupleV0_3 = {
  [S in SourceV0_3]: ClosedSourceTerminalFailureForSourceV0_3<S> extends infer F
    ? F extends ClosedSourceTerminalFailureForSourceV0_3<S>
      ? SealedFailureSourceResultTupleForPrimaryV0_3<S, F>
      : never
    : never;
}[SourceV0_3];

type DiagnosticTupleForSourceResultV0_3<R> =
  R extends Readonly<{
    source: infer S extends SourceV0_3;
    status: "failed";
    failureCode: infer C extends string;
    failureDetail: infer D extends string;
  }>
    ? readonly [Readonly<{
        stage: "source_attestation";
        source: S;
        failureCode: C;
        detail: D;
      }>]
    : readonly [];

type DiagnosticsForFailedTupleV0_3<T extends readonly unknown[]> =
  T extends readonly [infer Head, ...infer Tail]
    ? Head extends { readonly status: "aborted" }
      ? never
      : readonly [
          ...DiagnosticTupleForSourceResultV0_3<Head>,
          ...DiagnosticsForFailedTupleV0_3<Tail>,
        ]
    : readonly [];

type CanonicalDiagnosticsForFailureTupleV0_3<
  T extends SealedFailureSourceResultTupleV0_3,
> = DiagnosticsForFailedTupleV0_3<T>;

type DiagnosticForFailureV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S>,
> = F extends Readonly<{
  code: infer C extends string;
  detail: infer D extends string;
}>
  ? Readonly<{
      stage: "source_attestation";
      source: S;
      failureCode: C;
      detail: D;
    }>
  : never;

type PrimaryDiagnosticForExactTupleV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S>,
  T extends readonly unknown[],
> = DiagnosticsForFailedTupleV0_3<T> extends readonly [
  infer Primary,
  ...infer _Tail,
]
  ? Primary extends DiagnosticForFailureV0_3<S, F>
    ? Primary
    : never
  : never;

type SealedAggregateFailureForExactTupleV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S>,
  T extends readonly unknown[],
> = T extends SealedFailureSourceResultTupleForPrimaryV0_3<S, F>
  ? Readonly<{
      executed: false;
      verified: false;
      authoritative: false;
      failedStage: "source_attestation";
      failureCode: F["code"];
      failureDetail: F["detail"];
      primaryDiagnostic:
        PrimaryDiagnosticForExactTupleV0_3<S, F, T> &
        DiagnosticsForFailedTupleV0_3<T>[0] &
        DiagnosticForFailureV0_3<S, F>;
      aggregateSealState: "sealed";
      builderInvocationCount: 1;
      sources: T;
      diagnostics: DiagnosticsForFailedTupleV0_3<T>;
    }>
  : never;

type SealedAggregateFailureForPrimaryV0_3<
  S extends SourceV0_3,
  F extends ClosedSourceTerminalFailureForSourceV0_3<S>,
> = F extends ClosedSourceTerminalFailureForSourceV0_3<S>
  ? SealedAggregateFailureForExactTupleV0_3<
      S,
      F,
      SealedFailureSourceResultTupleForPrimaryV0_3<S, F>
    >
  : never;

type SealedAggregateFailureV0_3 = {
  [S in SourceV0_3]: ClosedSourceTerminalFailureForSourceV0_3<S> extends infer F
    ? F extends ClosedSourceTerminalFailureForSourceV0_3<S>
      ? SealedAggregateFailureForPrimaryV0_3<S, F>
      : never
    : never;
}[SourceV0_3];

type UnsealedGlobalAggregateFailureForPairV0_3<
  F extends GlobalParentPreflightFailureV0_3,
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
      primaryDiagnostic: Readonly<{
        stage: "source_attestation";
        source: null;
        failureCode: C;
        detail: D;
      }>;
      aggregateSealState: "unsealed";
      builderInvocationCount: 0;
      sources: UnsealedNonInterruptedControlSourceResultTupleV0_3;
      diagnostics: readonly [
        Readonly<{
          stage: "source_attestation";
          source: null;
          failureCode: C;
          detail: D;
        }>,
      ];
    }>
  : never;

type AggregateSourceVerificationResultV0_3 =
  | Readonly<{
      outcome: "v0_1_preflight_failure";
      authoritative: false;
      v0_1Result: ExactV0_1PreflightFailureV0_3;
      aggregateSealState: "unsealed";
      builderInvocationCount: 0;
      sources: UnsealedNonInterruptedControlSourceResultTupleV0_3;
    }>
  | Readonly<{
      outcome: "empty_plan";
      authoritative: false;
      v0_1Result: ExactV0_1EmptyPlanCompletionV0_3;
      aggregateSealState: "not_required";
      builderInvocationCount: 0;
      sources: EmptyPlanSourceResultTupleV0_3;
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
      aggregateSealState: "sealed";
      builderInvocationCount: 1;
      sources: NonEmptySuccessfulSourceResultTupleV0_3;
      diagnostics: readonly [];
    }>
  | SealedAggregateFailureV0_3
  | UnsealedGlobalAggregateFailureForPairV0_3<
      GlobalParentPreflightFailureV0_3
    >
  | Readonly<{
      executed: false;
      verified: false;
      authoritative: false;
      operationallyIncomplete: true;
      lineageResult: null;
      failureCode: null;
      aggregateSealState: "unsealed";
      builderInvocationCount: 0;
      sources: UnsealedInterruptedControlSourceResultTupleV0_3;
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
UnsealedInterruptedSourceResultV0_3 and the exact first-aborted
UnsealedInterruptedControlSourceResultTupleV0_3 used by the operationallyIncomplete branch. That
branch has builder count 0, no aggregate seal, no semantic primary failure, and no primary or
trailing semantic diagnostic. Registry/vault cleanup and bounded operational diagnostics remain
separate control records. Preflight-success prepared terminals, sealed prepared tuples, successful
tuples, sealed aggregate failures, and every builder-one result reject aborted. Runtime construction
must use the same frozen primaryDiagnostic object as diagnostics[0], or establish exact canonical
deep equality before accepting the sealed aggregate.

DistributeTupleV0_3 distributes both each Head union member and every recursively distributed tail
union member before aggregate construction. The fixed template binds the selected primary slot
directly to the exact naked F branch; each later source is then expanded into exact non-aborted
choices. SealedAggregateFailureForExactTupleV0_3 tests naked T, so each fully distributed tuple
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

- Raw source evidence, private identifiers, canonical tokens, HMAC preimages, key material, bundles,
  envelopes, proofs, manifests, projections, build records, and callback IPC remain approved private
  transient material.
- Non-fictional bundles and outputs stay in .local or another approved private store and never Git.
- No raw evidence is promoted to Golden or Regression data without lawful basis, minimization,
  anonymization, human review, a new immutable dataset version, and a recorded hash.
- Logs contain only bounded non-secret versions, opaque approved run references, cap names, and
  closed sanitized codes. They never contain scope HMACs, evidence text, provider errors, exception
  strings, handles, IDs, paths, raw IPC, or timing used as semantic evidence.
- Disposal is mandatory on success, failure, cancellation, trap, forbidden-access block, timeout,
  protocol violation, containment escape, teardown failure, expiry, revocation, deletion, and
  shutdown. The mutable vault overwrites every owned buffer and records exact disposal counts;
  immutable references and isolate realms are released. This is logical invalidation plus overwrite
  of owned buffers, not a forensic-erasure claim for runtime/OS/library copies.
- Expiry or deletion invalidates every derived projection, terminal, cache, receipt reference, and
  handle. This proposal adds no retention duration and does not extend retention because material is
  hashed, sealed, or privacy-minimized.

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

### 16.2 Proof, privacy, and projection

- Correct set HMAC paired with mismatched opaque refs fails.
- Stale, replayed, consumed, wrong-context, wrong-generation, wrong-attempt, wrong-key, and
  wrong-version proof handles fail with the exact mapping.
- Null observed proof relation, trustworthy empty observed set, and non-null relation.
- Mutable buffers never enter a frozen accepted graph; descriptor-to-vault-slot-to-ref cardinality,
  order, byte length, set membership, and bijection are exact.
- Compile-positive fixture proves one source-specific descriptor set satisfies
  SourceBindingVaultDescriptorSetV0_3 and SourceBindingRegistryEntryV0_3.
- Compile/runtime negative fixtures reject a single slot passed as the registry descriptor generic,
  a wrong-source set, source/context/generation/attempt/vault-handle mismatch, observed-null mismatch,
  duplicate or cross-set slot, missing/extra slot, non-dense ordinal, count mismatch, and broken
  descriptor-to-vault-slot-to-ref bijection.
- Every slot is read at most once, every owned byte is overwritten on every terminal path, disposal
  counts match descriptors, replay is invalidated, and tests make no forensic-erasure claim.
- Recursive callback-reachable graph absence for full bundle, source proof, scope refs/HMACs,
  coverage, attestation, envelope, seal, manifest integrity, final records, Stage 2, other source,
  A/B/C, model, suggestion, system authority, I/O, and clock.
- Deep freeze and mutation attempts for payload root, every nested object/array, callback output,
  terminal, and parent material.

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

## 17. Cross-contract drafting and freeze lifecycle

The required order is exact:

1. Draft this full Common V0.3 proposal.
2. Perform bounded independent Common contract/security/privacy QA.
3. Colin reviews exact Common draft bytes and decides revise, hold, or proceed.
4. External tooling records exact Common document SHA-256, Git blob, commit, and freeze receipt.
5. Colin freezes that exact Common byte state.
6. Edit the still-unfrozen preliminary GitHub V0.3 proposal to replace every parent identity
   placeholder with the exact Common blob, SHA-256, receipt, and commit.
7. Perform renewed cross-contract QA on both exact identities and generic instantiations.
8. External tooling records the exact GitHub document identity.
9. Colin separately freezes exact GitHub bytes.
10. Colin separately approves or declines implementation.
11. Implement one bounded private slice.
12. Run validation and record actual reproducibility evidence.
13. Perform independent implementation QA.
14. Colin separately accepts or rejects the offline implementation.
15. Colin separately decides operational activation after provenance, authentication, permissions,
    key lifecycle, observability, deletion, incident response, and rollback review.

Preliminary GitHub drafting and preliminary QA may occur before Common freeze, but they cannot bind
final parent identity or freeze GitHub. A placeholder can exist only in unfrozen preliminary GitHub
bytes. It must be replaced before GitHub hash/blob calculation. No external receipt may satisfy a
placeholder inside frozen bytes, and frozen bytes are never mutated.

## 18. Separate Colin gates

| Gate | Colin decision | Does not authorize |
| --- | --- | --- |
| Common proposal QA | Accept findings or request revision | Freeze or implementation |
| Common exact-byte freeze | Freeze one externally identified state | GitHub freeze or implementation |
| GitHub exact-byte freeze | Freeze separately after parent binding QA | Implementation |
| Offline implementation approval | Permit bounded code work | Acceptance or activation |
| Validation and independent QA | Evidence for Colin | Human acceptance |
| Offline acceptance | Accept private deterministic slice | Operational provider |
| Operational activation | Enable proven private provider capability | Stage10-2C public authority |
| Stage10-2C | Separate future authority decision | Any unstated scope |

Silence, an automated test, QA, implementation, later gate, UI status, or file presence cannot
substitute for Colin's explicit decision.

## 19. Proposal disposition

The only next action authorized by this document state is bounded read-only QA for Colin. Until an
external identity is produced and Colin explicitly freezes exact bytes, status remains
FULL_CONTRACT_PROPOSAL_READY_FOR_BOUNDED_QA. No implementation, test, provider activation, release,
public behavior, engine change, or authoritative result is claimed.
