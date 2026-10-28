# Common Suggestion Evidence GitHub Source Bundle V0.3 Full Contract Proposal

## 0. Document metadata

| Field | Value |
| --- | --- |
| Contract ID | COMMON-SUGGESTION-EVIDENCE-GITHUB-SOURCE-BUNDLE-V0.3 |
| GitHub bundle schema | github.source-bundle.v0.3 |
| Parent protocol | blabase-common-suggestion-evidence-source-verification-v0.4 |
| Checkpoint | Stage10-2B6A GitHub child correction and parent rebinding |
| Status | PROJECTION_MAPPING_CORRECTED_PENDING_FOCUSED_RE_QA |
| Lifecycle | UNFROZEN / INACTIVE / UNIMPLEMENTED |
| Date and timezone | 2026-08-25, Asia/Seoul |
| Owner | Colin |
| Sole human reviewer and decision authority | Colin |
| Required David role | None |
| Runtime effect | None |
| Stage10-2B authority | Always authoritative: false |
| Child exact-byte identity | Unprepared |
| Next gate | Focused cross-contract re-QA |

This is the complete standalone GitHub V0.3 child contract proposal rebound to the frozen Common
V0.4 parent. GitHub wire, schema, cap, projection, adapter and bundle identities remain V0.3.
Envelope, runtime snapshot, proof ownership, lifecycle, isolate protocol, terminal, aggregate and
diagnostic behavior are the Common V0.4 family.

The terms MUST, MUST NOT, SHALL, SHALL NOT and REQUIRED remain proposed for this unfrozen child.
This correction does not create a GitHub document hash, Git blob, freeze receipt, implementation
approval, provider capability, activation, release or authority. The child is UNFROZEN, INACTIVE
and UNIMPLEMENTED. Focused cross-contract re-QA is pending.

## 1. Parent authority and exact V0.4 imports

The frozen Common V0.4 contract prevails for canonical parsing, hostile-object rejection, immutable
snapshot acquisition, total pre-claim disposition, authoritative generation fencing, proof claim,
proof consume plus HMAC lease, containment, reader quiescence, vault disposal, collector seal,
detached hashes, projection handles, isolate IPC, callback parsing, terminal correlation, aggregate
diagnostics, global Common V0.1 replay, coverage, attestation and authority.

The GitHub child owns only the exact github.source-bundle.v0.3 wire schema, GitHub-specific caps,
repository proof descriptors and commitments, neutral projection payload, Common V0.1 GitHub build
record mapping, and fictional GitHub fixtures. It declares no parent-owned brand or shared unique
symbol.

~~~ts
import type {
  AtomicSourceBindingProofClaimResultV0_4,
  AtomicSourceBindingProofConsumeResultV0_4,
  AtomicAvailableProofLifecycleTerminalizationResultV0_4,
  AtomicSourceBindingProofTerminalizationResultV0_4,
  AuthoritativeGenerationFenceV0_4,
  AvailableRuntimeCapabilityV0_4,
  AvailableSourceBindingProofReferenceV0_4,
  AvailableSourceBindingProofStateV0_4,
  CallbackOwnedDiagnosticV0_4,
  CanonicalUtcMillisV0_4,
  ClosedNumericCapProfileV0_4,
  ClosedSourceBundleV0_4,
  ClosedSourceCapProfileV0_4,
  ClosedSourceProjectionPayloadV0_4,
  ClosedSourceTerminalFailureForSourceV0_4,
  CollectionSubmissionV0_4,
  DisposableIsolateCompletionV0_4,
  DisposableIsolateIpcInputV0_4,
  DisposableIsolateIpcResultV0_4,
  ExactJsonValueV0_4,
  ExactSourceBundleBaseV0_4,
  FrozenParentCommonIdentityV0_4,
  FrozenSourceVerifierContractAndCapsV0_4,
  GitObjectIdSha1LowerHexV0_4,
  NonNegativeDecimalStringV0_4,
  NonNegativeSafeIntegerV0_4,
  PositiveSafeIntegerV0_4,
  ParentCollectionSnapshotV0_4,
  ParentPreflightFailureForSourceV0_4,
  ParentPreflightResultV0_4,
  PreClaimDispositionSnapshotV0_4,
  PreClaimDispositionV0_4,
  PreparedSourceTerminalV0_4,
  ProjectionCompletenessV0_4,
  ProjectionOnlyHandleV0_4,
  ProofLifecycleCleanupOwnerTokenV0_4,
  ZeroizationVaultDisposalRecordV0_4,
  ProofVaultOwnerTokenV0_4,
  ReaderQuiescenceCertificateV0_4,
  ReservedSourceBindingProofReferenceV0_4,
  ReservedSourceBindingProofStateV0_4,
  RuntimeCapabilityV0_4,
  SanitizedSourceResultV0_4,
  SealedAggregateFailureForPrimaryV0_4,
  SealedPreparedSourceTerminalV0_4,
  Sha256LowerHexV0_4,
  SourceAdapterInvocationV0_4,
  SourceAdapterReturnedResultV0_4,
  SourceBindingProofLifecycleTerminalRecordV0_4,
  SourceBindingProofTableLookupResultV0_4,
  SourceBindingProofTombstoneV0_4,
  SourceBindingRegistryEntryV0_4,
  SourceBindingVaultDescriptorSetBaseV0_4,
  SourceBindingVaultDescriptorSetV0_4,
  SourceCoverageStatusV0_4,
  SourceIdentityAndVersionBindingV0_4,
  SourceProjectionPayloadBaseV0_4,
  TransientSourceBindingProofHandleV0_4,
  VaultHmacContainmentExecutorV0_4,
  VaultHmacLeaseV0_4,
  VerifiedSourceMaterialV0_4,
  ZeroizationSlotDescriptorV0_4,
  ZeroizationVaultHandleV0_4,
} from "./COMMON_SUGGESTION_EVIDENCE_SOURCE_VERIFICATION_V0_4_CONTRACT";
~~~

Every GitHub alias retains a V0_3 suffix because it is a child contract alias, but its parent
generic is V0_4. Compile fixtures MUST prove nominal identity with the one Common V0.4 declaration.

## 2. Scope and non-goals

The contract covers a private offline GitHub task/activity source bundle and conversion from a
parent-verified projection payload to neutral CommonSuggestionEvidenceBuildRecordV0_1 inputs.

It does not:

- define a GitHub REST, GraphQL, webhook, export, or provider-to-bundle collector payload;
- authorize a live API call, OAuth, GitHub App, PAT, credential, provider origin, rate-limit policy,
  or operational collection;
- implement a collector, parser, parent preflight, adapter, isolate, registry, key, or capability;
- expose a full bundle or unknown wire value to the adapter;
- add a public facade, public failure, authoritative result, or Stage10-2C behavior;
- copy Common private record/fact ID versions, domains, derivation, budgets, or sorting;
- generate suggestion text, summary, rank, caveat, recommendation, action, or intent;
- pass A/B/C arm identity, model output, prompts, or engine configuration;
- change retention, deletion, consent, logging, datasets, architecture, dependencies, or migrations;
  or
- use real provider, account, user, organization, repository, credential, cursor, URL, or source
  evidence in a committed fixture.

The adapter means only verified GitHub projection payload to exact neutral Common V0.1 build records.
Raw provider-to-bundle collection and live collection remain separately scoped future work.

## 3. Version isolation, immutable history and frozen parent binding

### 3.1 Historical identities only

GitHub V0.2 remains immutable historical evidence:

| Artifact | Historical identity |
| --- | --- |
| GitHub V0.2 document SHA-256 | 9e7351ba3ef89aa3dfb8c57a050cdb973257d2bad37684b37c16e148d2b1d757 |
| GitHub V0.2 Git blob | 410fedb66a47d472de0281a4467f79f446f811df |
| GitHub V0.2 freeze receipt | ECR-STAGE10-2B2-COLIN-GITHUB-SOURCE-BUNDLE-CONTRACT-FREEZE-2026-08-23 |

Common V0.2 and Common V0.3 identities and receipts are historical/rejection evidence only. They
supply no active alias, parser fallback, runtime binding or migration. GitHub V0.2 with any parent,
GitHub V0.3 with Common V0.2, and GitHub V0.3 with Common V0.3 all reject.

There is no V0.2/V0.3 child union and no Common V0.3/V0.4 parent union, alias, wrapper, coercion,
default, migration, version probing, field replacement or silent overwrite.

### 3.2 Active frozen Common V0.4 parent binding

The sole positive active pair is GitHub V0.3 child plus Common V0.4 parent:

~~~ts
const FROZEN_PARENT_COMMON_V0_4_BINDING: FrozenParentCommonIdentityV0_4 = {
  parentCommonContractDocumentSha256:
    "5bbf7f5904913680f63eff2a12574bf98114fc55487349baa7a971d78f083909",
  parentCommonContractGitBlobObjectId:
    "ff093b3387111f91a4cbd2c244c8bbe133e575ea",
  parentCommonFreezeReceiptId:
    "ECR-STAGE10-2B5-COLIN-COMMON-V0-4-CONTRACT-FREEZE-2026-08-25",
  parentCommonFreezeGitCommitObjectId:
    "8ae36eead887490ec4aa674f46f2eccb1b6919d4",
} as const;
~~~

FrozenParentCommonIdentityV0_4 has exactly these four runtime fields. Missing, extra, inherited,
defaulted, repaired or mismatched fields reject. In particular, documentByteLength, contract source
commit, contract ID and any fifth field reject from the runtime object.

External evidence only, never runtime fields: parent byte length 126060 and parent contract source
commit f1d0900ea815a3f430b445be92145a1a2e2ee3d6. The freeze receipt identifier is already the exact
third field, never an additional field.

### 3.3 Child state

The Common V0.4 content, QA, identity and freeze gates are complete. This GitHub V0.3 child has been
corrected and rebound but remains UNFROZEN, INACTIVE and UNIMPLEMENTED. No child byte length,
SHA-256, Git blob, commit, receipt, adapter artifact digest or freeze identity is prepared. The next
gate is renewed cross-contract QA on these exact draft bytes.

## 4. Active child V0.3 identity and exact equality

### 4.1 GitHub child identity literals

All GitHub-owned active literals remain V0.3:

~~~ts
const GITHUB_SOURCE_BUNDLE_V0_3_IDENTITIES = {
  source: "github",
  collectorId: "blabase.github.offline-collector",
  collectorVersion: "github-offline-collector-v0.3.0",
  adapterId: "blabase.github.offline-adapter",
  adapterVersion: "github-offline-adapter-v0.3.0",
  inputContractVersion: "github-offline-input-v0.3.0",
  sourceBundleContractVersion: "github.source-bundle.v0.3",
  verifierId: "blabase.github.source-verifier",
  verifierVersion: "github-source-verifier-v0.3.0",
  preprocessingVersion: "github-neutral-text-normalization-v0.3.0",
  projectionVersion: "github-common-evidence-projection-v0.3.0",
  projectionInputVersion: "github.common-build-projection-input.v0.3",
  sourceContractCapProfileVersion: "github.source-caps.v0.3",
  canonicalizationVersion: "rfc8785-jcs-v1",
  privacyPolicyVersion: "github-neutral-evidence-privacy-v0.3.0",
} as const;
~~~

The Common-owned envelope, proof, snapshot, state-machine and isolate protocol literals are V0.4.
A V0.3 parent protocol literal is never accepted merely because the child bundle is V0.3.

### 4.2 Equality boundaries

The parent rejects before callback any mismatch among capability, frozen contract/caps, envelope,
manifest, bundle, supervisor invocation and IPC for source, collector, adapter, artifact,
input-contract, bundle-contract, verifier, preprocessing, projection, cap-profile, caps, caps hash,
source contract hash and the exact four-field Common V0.4 parent identity.

The adapter sees only the serialized V0.4 isolate input and output equality fields. It never owns
parent binding, capability, proof, seal, scope, coverage or attestation equality. A binding mismatch
is SOURCE_BINDING_INVALID / source_bundle_invalid. A correctly bound cap exceedance is
RESOURCE_LIMIT_EXCEEDED / invocation_resource_limit_exceeded.

## 5. Exact closed GitHub cap profile

The 18 keys and numeric values exactly preserve the frozen V0.2 Section 12 bounds while giving V0.3
a closed vocabulary.

~~~ts
type GitHubSourceCapsV0_3 = Readonly<{
  maximumCallbackInvocations: 1;
  maximumCanonicalFrozenBundleUtf8Bytes: 1_048_576;
  maximumRequestedRepositories: 8;
  maximumObservedRepositories: 8;
  maximumRequestedIntervalDays: 30;
  maximumTaskRecords: 128;
  maximumActivityRecords: 128;
  maximumTotalRecords: 256;
  maximumPagesPerRepositoryPerOperation: 3;
  maximumTextSpansPerRecord: 4;
  maximumTotalTextSpans: 256;
  maximumVisibleUnicodeScalarsPerSpan: 240;
  maximumVisibleUtf8BytesPerSpan: 2_048;
  maximumPreNormalizationUnicodeScalarsPerField: 65_536;
  maximumPreNormalizationUtf8BytesPerField: 262_144;
  maximumAggregateVisibleTextUtf8Bytes: 131_072;
  maximumInputGraphDepth: 12;
  maximumEnumerableOwnProperties: 4_096;
}>;

type GitHubCapKeyV0_3 = keyof GitHubSourceCapsV0_3 & string;

type ParentValidatedGitHubCapProfileV0_3 =
  ClosedSourceCapProfileV0_4<
    "github",
    GitHubCapKeyV0_3,
    GitHubSourceCapsV0_3
  >;

const FROZEN_GITHUB_SOURCE_CAPS_V0_3: GitHubSourceCapsV0_3 = {
  maximumCallbackInvocations: 1,
  maximumCanonicalFrozenBundleUtf8Bytes: 1_048_576,
  maximumRequestedRepositories: 8,
  maximumObservedRepositories: 8,
  maximumRequestedIntervalDays: 30,
  maximumTaskRecords: 128,
  maximumActivityRecords: 128,
  maximumTotalRecords: 256,
  maximumPagesPerRepositoryPerOperation: 3,
  maximumTextSpansPerRecord: 4,
  maximumTotalTextSpans: 256,
  maximumVisibleUnicodeScalarsPerSpan: 240,
  maximumVisibleUtf8BytesPerSpan: 2_048,
  maximumPreNormalizationUnicodeScalarsPerField: 65_536,
  maximumPreNormalizationUtf8BytesPerField: 262_144,
  maximumAggregateVisibleTextUtf8Bytes: 131_072,
  maximumInputGraphDepth: 12,
  maximumEnumerableOwnProperties: 4_096,
} as const;
~~~

The object contains each of the 18 declared keys exactly once. The type, initializer, and table are
the same normative value:

| Exact key | Exact value |
| --- | ---: |
| maximumCallbackInvocations | 1 |
| maximumCanonicalFrozenBundleUtf8Bytes | 1,048,576 |
| maximumRequestedRepositories | 8 |
| maximumObservedRepositories | 8 |
| maximumRequestedIntervalDays | 30 |
| maximumTaskRecords | 128 |
| maximumActivityRecords | 128 |
| maximumTotalRecords | 256 |
| maximumPagesPerRepositoryPerOperation | 3 |
| maximumTextSpansPerRecord | 4 |
| maximumTotalTextSpans | 256 |
| maximumVisibleUnicodeScalarsPerSpan | 240 |
| maximumVisibleUtf8BytesPerSpan | 2,048 |
| maximumPreNormalizationUnicodeScalarsPerField | 65,536 |
| maximumPreNormalizationUtf8BytesPerField | 262,144 |
| maximumAggregateVisibleTextUtf8Bytes | 131,072 |
| maximumInputGraphDepth | 12 |
| maximumEnumerableOwnProperties | 4,096 |

maximumObservedRepositories is numeric. observedScope.repositoryRefs remains null or a zero-through-
eight array; nullability is schema, not a cap value. Effective caps are min(parent Common cap,
GitHub cap). Unknown, missing, duplicate, optional, inherited, aliased, coerced, fractional,
non-finite, unsafe, or changed cap keys/values fail closed.

## 6. Exact primitives, repository identity, and source proof

### 6.1 Primitives and opaque wire refs

~~~ts
type GitObjectIdV0_3 = string; // exactly 40 or 64 lowercase hexadecimal

type TransientGitHubRepositoryIdentifierV0_3 = Readonly<{
  host: "github.com";
  repositoryDatabaseId: string; // exactly /^[1-9][0-9]{0,19}$/
}>;

type GitHubRepositoryRefV0_3 = Readonly<{
  repositoryIdentityHmacSha256: Sha256LowerHexV0_4;
}>;
~~~

TransientGitHubRepositoryIdentifierV0_3 is NON-WIRE. Owner, name, full name, URL, login, node ID,
branch, and display text are not identity fallbacks.

### 6.2 Canonical token and HMAC domains

Repository identifier JCS is exactly:

~~~text
{"host":"github.com","repositoryDatabaseId":"<canonical positive decimal>"}
~~~

Its canonical token is unpadded RFC 4648 base64url of RFC 8785 JCS UTF-8. Tokens match
^[A-Za-z0-9_-]+$, are unique, and are sorted by runtime ASCII for set-HMAC calculation. No standard
base64, padding, whitespace, sign, leading zero, exponent, Unicode digit normalization, or number
coercion is accepted.

Per-repository wire ref uses:

~~~text
repositoryIdentityHmacSha256 =
  lowercase_hex(HMAC-SHA-256(Kprivacy, RFC8785_JCS_UTF8({
    domain: "blabase.github.source-bundle.v0.3.repository-identity",
    repositoryIdentifier
  })))
~~~

Requested and observed set HMACs use the exact frozen Common Lineage V0.1 canonical token-set HMAC
operations, domains, preimage, restricted privacy-scope key handle, and key lifecycle. V0.3 does not
copy or reinterpret that implementation:

~~~text
requestedRepositoryScopeHmacSha256 =
  computeRequestedScopeHmacInternalV0_1(
    RestrictedPrivateScopeHmacHandleInternalV0_1,
    requested canonical tokens in runtime ASCII order
  )

observedRepositoryScopeHmacSha256 =
  null, iff observed raw scope is null
  otherwise computeObservedScopeHmacInternalV0_1(
    the same exact bound restricted handle,
    observed canonical tokens in runtime ASCII order
  )
~~~

The handle is context/generation/attempt/key/version bound and purpose-restricted. Collector-seal
and privacy-scope keys use different material, handles, versions, domains, purposes, and operations.

### 6.3 Common V0.4 proof ownership, lifecycle and vault aliases

~~~ts
type GitHubRepositoryVaultSlotDescriptorV0_3 =
  ZeroizationSlotDescriptorV0_4<
    "github",
    "repository_identity_and_token_framed_utf8"
  > & Readonly<{
    repositoryOrdinal: NonNegativeSafeIntegerV0_4;
    requestedRepositoryOrdinal: NonNegativeSafeIntegerV0_4;
    wireRefOrdinal: NonNegativeSafeIntegerV0_4;
  }>;

type GitHubRepositoryVaultDescriptorV0_3 =
  SourceBindingVaultDescriptorSetV0_4<
    "github",
    GitHubRepositoryVaultSlotDescriptorV0_3
  >;

type GitHubSourceProofWireCommitmentsV0_3 = Readonly<{
  requestedRepositoryRefs: readonly GitHubRepositoryRefV0_3[];
  observedRepositoryRefs: readonly GitHubRepositoryRefV0_3[] | null;
  requestedRepositoryScopeHmacSha256: Sha256LowerHexV0_4;
  observedRepositoryScopeHmacSha256: Sha256LowerHexV0_4 | null;
}>;

type GitHubAvailableProofReferenceV0_3 =
  AvailableSourceBindingProofReferenceV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;

type GitHubReservedProofReferenceV0_3 =
  ReservedSourceBindingProofReferenceV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;

type GitHubPreClaimSnapshotV0_3 =
  PreClaimDispositionSnapshotV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;

type GitHubPreClaimDispositionV0_3 = PreClaimDispositionV0_4;
type GitHubGenerationFenceV0_3 = AuthoritativeGenerationFenceV0_4;
type GitHubProofOwnerTokenV0_3 = ProofVaultOwnerTokenV0_4<"github">;
type GitHubLifecycleCleanupOwnerV0_3 =
  ProofLifecycleCleanupOwnerTokenV0_4<"github">;
type GitHubContainmentExecutorV0_3 =
  VaultHmacContainmentExecutorV0_4<"github">;
type GitHubVaultHmacLeaseV0_3 = VaultHmacLeaseV0_4<"github">;
type GitHubReaderQuiescenceCertificateV0_3 =
  ReaderQuiescenceCertificateV0_4<"github">;
type GitHubProofLookupResultV0_3 =
  SourceBindingProofTableLookupResultV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;
type GitHubProofTombstoneV0_3 =
  SourceBindingProofTombstoneV0_4<"github">;
type GitHubProofLifecycleTerminalRecordV0_3 =
  SourceBindingProofLifecycleTerminalRecordV0_4<"github">;
type GitHubZeroizationVaultHandleV0_3 =
  ZeroizationVaultHandleV0_4<"github">;
type GitHubTransientProofHandleV0_3 =
  TransientSourceBindingProofHandleV0_4<"github">;

type GitHubAtomicProofClaimResultV0_3 =
  AtomicSourceBindingProofClaimResultV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;

type GitHubAtomicProofConsumeResultV0_3 =
  AtomicSourceBindingProofConsumeResultV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;

type GitHubAtomicAvailableLifecycleTerminalizationResultV0_3 =
  AtomicAvailableProofLifecycleTerminalizationResultV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;

type GitHubAtomicOwnerTerminalizationResultV0_3 =
  AtomicSourceBindingProofTerminalizationResultV0_4<
    "github",
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;

type GitHubZeroizationVaultDisposalRecordV0_3 =
  ZeroizationVaultDisposalRecordV0_4<"github">;
~~~

The child imports rather than redeclares the Common V0.4 atomic claim, consume,
owner-terminalization, lifecycle-terminalization and disposal result families. Their exact
transition/tombstone/owner correlation cannot be widened by a GitHub alias.

The exact flow is:

1. Step 2 performs one proof-table lookup and evaluates one immutable total pre-claim snapshot with
   precedence invalid interval, generation stale, revoked, expired, future-issued, eligible.
2. Only eligible may win the authoritative generation-fenced available-to-reserved claim. Claim
   losers own no vault and perform zero read, HMAC, callback, adapter or disposal.
3. Only the reserved owner performs canonical input, binding-object, collector-seal and detached
   hash Steps 3 through 6. Every owner failure terminalizes exactly once and the winning owner alone
   disposes.
4. Step 7 validates the referenced key lifecycle, atomically consumes the reserved proof together
   with one HMAC lease, and permits only the consume winner to issue contained HMAC operations.
5. Raw repository bytes never map to the worker. The nominal containment executor returns only
   bounded HMAC results. Reader retirement is normal containment retirement or one exact correlated
   ReaderQuiescenceCertificateV0_4 after a published fence.
6. Forged, stale, wrong-vault, wrong-reader, wrong-owner, wrong-epoch or pre-fence certificates
   reject. If quiescence cannot be proven, the vault is quarantined fail-closed and is not zeroized.
7. After certified quiescence the exact disposal winner zeroizes each owned slot once and never
   restores proof or vault state.
8. Step 8 alone performs remaining scope, pagination, coverage, title, forbidden-field and semantic
   validation and prepares the projection.

A retained consumed tombstone observation returns replay failure without rewriting the tombstone.
An available proof made stale by generation rollover uses the zeroize-only lifecycle cleanup owner.
A proof already reserved before rollover uses the reserved-owner or supervisor stale
terminalization path. Both paths compare the same authoritative generation fence and are mutually
exclusive. No available stale-generation vault may be orphaned.

Repository ordering, descriptor framing, per-ref and set-HMAC domains, bijections and null rules are
unchanged. HMAC count is zero before key lifecycle and consume-plus-lease success.

## 7. Exact closed wire schema

### 7.1 Exact four-field Common V0.4 parent identity and source binding

The manifest source binding uses the exact frozen object from Section 3.2:

~~~ts
type GitHubRepositorySourceBindingV0_3 = Readonly<{
  parentCommonIdentity: FrozenParentCommonIdentityV0_4;
  sourceContractSha256: Sha256LowerHexV0_4;
  adapterArtifactSha256: Sha256LowerHexV0_4;
  privacyScopeHmacKeyVersion: string;
  privacyScopeHmacContextId: string;
  privacyScopeTokenCanonicalizationVersion:
    typeof SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1;
  requestedRepositoryScopeHmacSha256: Sha256LowerHexV0_4;
  observedRepositoryScopeHmacSha256: Sha256LowerHexV0_4 | null;
  sourceContractCaps: GitHubSourceCapsV0_3;
  sourceContractCapsJcsSha256: Sha256LowerHexV0_4;
}>;
~~~

parentCommonIdentity has exactly four keys. documentByteLength, contractSourceCommit,
contractId, a duplicate receipt field and every fifth key reject. The byte length and contract
source commit remain external audit evidence only.

The requested and observed set HMAC fields occur once in this closed object. They remain private
pseudonymous evidence, never adapter input or model input. Observed HMAC is null exactly when the
observed ref array is null; a trustworthy empty set has a non-null empty-set HMAC.

### 7.2 Manifest and top level

~~~ts
type GitHubBundleManifestV0_3 = Readonly<{
  sourceKind: "offline_export";
  collectorId: "blabase.github.offline-collector";
  collectorVersion: "github-offline-collector-v0.3.0";
  adapterId: "blabase.github.offline-adapter";
  adapterVersion: "github-offline-adapter-v0.3.0";
  adapterArtifactSha256: Sha256LowerHexV0_4;
  inputContractVersion: "github-offline-input-v0.3.0";
  sourceBundleContractVersion: "github.source-bundle.v0.3";
  verifierId: "blabase.github.source-verifier";
  verifierVersion: "github-source-verifier-v0.3.0";
  normalizationVersion: "github-neutral-text-normalization-v0.3.0";
  projectionVersion: "github-common-evidence-projection-v0.3.0";
  projectionInputVersion: "github.common-build-projection-input.v0.3";
  sourceContractCapProfileVersion: "github.source-caps.v0.3";
  canonicalizationVersion: "rfc8785-jcs-v1";
  privacyPolicyVersion: "github-neutral-evidence-privacy-v0.3.0";
  sourceBinding: GitHubRepositorySourceBindingV0_3;
  requestedScopeSha256: Sha256LowerHexV0_4;
  observedScopeSha256: Sha256LowerHexV0_4;
  pagesSha256: Sha256LowerHexV0_4;
  tasksSha256: Sha256LowerHexV0_4;
  activitiesSha256: Sha256LowerHexV0_4;
  sourceBindingSha256: Sha256LowerHexV0_4;
  sourceArtifactSetSha256: Sha256LowerHexV0_4;
  requestedRepositoryCount: NonNegativeDecimalStringV0_4;
  observedRepositoryCount: NonNegativeDecimalStringV0_4 | null;
  pageCount: NonNegativeDecimalStringV0_4;
  taskCount: NonNegativeDecimalStringV0_4;
  activityCount: NonNegativeDecimalStringV0_4;
  textSpanCount: NonNegativeDecimalStringV0_4;
  aggregateVisibleTextUtf8Bytes: NonNegativeDecimalStringV0_4;
}>;

type FrozenGitHubSourceBundleV0_3 = Readonly<{
  schemaVersion: "github.source-bundle.v0.3";
  provider: "github";
  manifest: GitHubBundleManifestV0_3;
  requestedScope: GitHubRequestedScopeV0_3;
  observedScope: GitHubObservedScopeV0_3;
  pages: readonly GitHubPageManifestV0_3[];
  tasks: readonly GitHubTaskRecordV0_3[];
  activities: readonly GitHubActivityRecordV0_3[];
}>;

type ParentValidatedGitHubSourceBundleV0_3 =
  ClosedSourceBundleV0_4<
    "github",
    "github.source-bundle.v0.3",
    FrozenGitHubSourceBundleV0_3
  >;
~~~

Every object and array is exact-key, dense, ordinary, deeply frozen canonical data after parent
copying. Unknown, duplicate, missing, optional, undefined, inherited, accessor, symbol, proxy,
cycle, alias, non-finite number, JSON extension, or trailing content is rejected. The bundle has no
issue, diagnostic, envelope, seal, final Common record, expected Stage 2, authority result, or
provider-body field.

## 8. Modes, operations, scope, and coverage

### 8.1 Closed mode and activity kind unions

~~~ts
type GitHubActivityKindV0_3 =
  | "issue_opened"
  | "issue_closed"
  | "issue_reopened"
  | "issue_commented"
  | "pull_request_opened"
  | "pull_request_closed"
  | "pull_request_reopened"
  | "pull_request_merged"
  | "pull_request_reviewed"
  | "pull_request_review_commented"
  | "push";

type GitHubActivityWindowV0_3 = Readonly<{
  start: CanonicalUtcMillisV0_4;
  end: CanonicalUtcMillisV0_4;
}>;

type GitHubRequestedScopeV0_3 =
  | Readonly<{
      requestedCollectionMode: "repository_scope";
      requiredOperations: readonly ["repository_scope_collection"];
      repositoryRefs: readonly GitHubRepositoryRefV0_3[]; // 1..8
      requestedActivityWindow: null;
      activityKinds: readonly [];
      pageLimitPerRepositoryPerOperation: "3";
    }>
  | Readonly<{
      requestedCollectionMode: "repository_activity";
      requiredOperations: readonly [
        "repository_scope_collection",
        "activity_pagination",
      ];
      repositoryRefs: readonly GitHubRepositoryRefV0_3[]; // 1..8
      requestedActivityWindow: GitHubActivityWindowV0_3;
      activityKinds: readonly [
        GitHubActivityKindV0_3,
        ...GitHubActivityKindV0_3[],
      ];
      pageLimitPerRepositoryPerOperation: "3";
    }>;
~~~

Activity kinds are unique and ordered by union declaration order. The activity window is [start,end),
start < end, and at most 30 exact UTC days. No other mode/operation/window/kind combination, alias,
default, or extension is legal. The envelope mode and operations equal this branch exactly.

repository_scope requires activities exactly empty, no activity pages, no activity operation
coverage, paginationStatus not_applicable, and coveredActivityIntervals null.
repository_activity uses both operations and permits only requested kinds inside the requested
window. Tasks always originate from repository_scope_collection. Activities always originate from
activity_pagination. No fallback changes record origin.

### 8.2 Observed scope and operation coverage

~~~ts
type GitHubCoverageStatusV0_3 = SourceCoverageStatusV0_4;

type GitHubOperationCoverageV0_3 = Readonly<{
  repositoryRef: GitHubRepositoryRefV0_3;
  operation: "repository_scope_collection" | "activity_pagination";
  status: GitHubCoverageStatusV0_3;
  firstRequestCursorSha256: Sha256LowerHexV0_4 | null;
  finalResponseCursorSha256: Sha256LowerHexV0_4 | null;
  pageCount: NonNegativeDecimalStringV0_4;
  recordCount: NonNegativeDecimalStringV0_4;
  terminalHasNextPage: boolean | null;
  stopReason: "complete" | "page_cap" | "source_error" | "untrusted";
}>;

type GitHubObservedScopeV0_3 = Readonly<{
  repositoryRefs: readonly GitHubRepositoryRefV0_3[] | null;
  repositoryScopeStatus: GitHubCoverageStatusV0_3;
  paginationStatus: "not_applicable" | GitHubCoverageStatusV0_3;
  coveredActivityIntervals: readonly GitHubActivityWindowV0_3[] | null;
  operationCoverage: readonly GitHubOperationCoverageV0_3[];
}>;
~~~

Observed refs are null or unique 0..8. Non-null intervals are at most 1,024, inside the requested
window, ordered, non-overlapping, non-adjacent canonical merges. Empty array means trustworthy zero
coverage; null means absent or untrustworthy.

Let T be every requested (repositoryRef, requiredOperation) tuple. operationCoverage has exactly
abs(T) entries and exactly one entry for each tuple, sorted by repository-ref HMAC then operation
order. No missing, extra, duplicate, or wrong-mode tuple is legal.

Exact status consistency is:

- complete: stopReason complete, at least one page, final terminalHasNextPage false, and all page/
  record/cursor equations pass;
- partial: stopReason page_cap or source_error, trustworthy collected material may be present, and
  the page/record/cursor equations for present material pass;
- unknown: stopReason untrusted; no completeness claim is made;
- pageCount zero requires both cursor hashes and terminalHasNextPage null; otherwise first/final/
  terminal values equal the first/final page;
- pageCount nonzero requires exact first/final cursor and terminal fields, even when a cursor itself
  is null.

Repository scope status is unknown for absent/untrustworthy observed scope, partial for trustworthy
observed refs unequal to requested refs, and complete only for exact sets plus complete required
repository tuples.

Activity pagination status is unknown for absent/untrustworthy evidence, partial for source-reported
partial status or a covered-interval strict subset, and complete only when every activity tuple is
complete and the canonical interval union equals the requested window exactly.

## 9. Page manifest and tuple-local bijection

~~~ts
type GitHubPageManifestV0_3 = Readonly<{
  repositoryRef: GitHubRepositoryRefV0_3;
  operation: "repository_scope_collection" | "activity_pagination";
  requestedCollectionMode: "repository_scope" | "repository_activity";
  collectionRequestSha256: Sha256LowerHexV0_4;
  pageOrdinal: NonNegativeDecimalStringV0_4;
  requestCursorSha256: Sha256LowerHexV0_4 | null;
  responseEndCursorSha256: Sha256LowerHexV0_4 | null;
  hasNextPage: boolean;
  recordIds: readonly string[];
  previousPageSha256: Sha256LowerHexV0_4 | null;
  pageContentSha256: Sha256LowerHexV0_4;
  pageSha256: Sha256LowerHexV0_4;
}>;
~~~

collectionRequestSha256 is H of the exact JCS object:

~~~text
{
  activityKinds,
  requestedActivityWindow,
  requestedCollectionMode,
  requiredOperations,
  repositoryRef
}
~~~

For tuple t, P(t) is its ordered pages and R(t) is:

~~~text
R(repositoryRef, repository_scope_collection) =
  every taskId whose task.repositoryRef equals repositoryRef

R(repositoryRef, activity_pagination) =
  every activityId whose activity.repositoryRef equals repositoryRef
  and activityKind is requested
  and occurredAt is in requested [start,end)
~~~

U(t) is the ordered multiset concatenation of P(t).recordIds. Every tuple requires U(t) = R(t) with
multiplicity exactly one. Every top-level record belongs to exactly one required tuple. A
per-repository tuple is never compared with the global task/activity array.

Rules are exact:

1. pageCount equals abs(P(t)); recordCount equals abs(U(t)) equals abs(R(t)).
2. Ordinals are canonical decimals 0 through abs(P(t))-1 with no gap or duplicate.
3. Only the first previousPageSha256 is null; later values equal the prior pageSha256.
4. The first request cursor equals coverage firstRequestCursorSha256.
5. Each later request cursor equals the prior responseEndCursorSha256.
6. The final response cursor and hasNextPage equal coverage final fields.
7. pageContentSha256 = H(recordIds).
8. pageSha256 = H(the exact page object with only pageSha256 omitted).
9. Page source, mode, repository, operation, and request hash equal the tuple/request.
10. No page or record ID occurs in another tuple, repository, operation, or top-level array.
11. Each tuple has at most three pages.
12. A third page with hasNextPage false can be complete.
13. A third page with hasNextPage true is page_cap, partial, and PAGINATION_INCOMPLETE.
14. source_error is partial and a forced stop; untrusted is unknown.
15. Page count three alone never implies partial.

## 10. Task, activity, identity, privacy artifact, and text

### 10.1 Task record and identity

~~~ts
type GitHubTaskRecordV0_3 = Readonly<{
  recordType: "task";
  taskId: string;
  signalHash: Sha256LowerHexV0_4;
  repositoryRef: GitHubRepositoryRefV0_3;
  objectIdentityHmacSha256: Sha256LowerHexV0_4;
  workItemRole:
    | "assigned_issue"
    | "review_requested_pull_request"
    | "authored_pull_request";
  number: string;
  state: "open";
  observedAt: CanonicalUtcMillisV0_4;
  updatedAt: CanonicalUtcMillisV0_4 | null;
  title: GitHubAllowedTextSpanV0_3;
}>;
~~~

Raw objectDatabaseId is a transient canonical positive decimal matching
/^[1-9][0-9]{0,19}$/ and never wire. It derives:

~~~text
objectIdentityHmacSha256 =
  HMAC-SHA-256(Kprivacy, JCS({
    domain: "blabase.github.source-bundle.v0.3.object-identity",
    objectDatabaseId,
    repositoryIdentityHmacSha256
  }))

taskId = "ghtask_" + objectIdentityHmacSha256

signalHash = H({
  domain: "blabase.github.source-bundle.v0.3.task-signal",
  objectIdentityHmacSha256,
  repositoryIdentityHmacSha256,
  workItemRole
})
~~~

number is canonical positive decimal and converts exactly to a positive safe integer. observedAt
MUST equal sealedEnvelope.collectedAt byte-for-byte. Any inequality is a parent preflight
SOURCE_BINDING_INVALID/source_bundle_invalid failure. Raw object ID, repository owner/name/URL,
assignee, author, labels, body, branch, diff, and code are forbidden.

### 10.2 Activity record, linkage, and push head privacy artifact

~~~ts
type GitHubActivityRecordV0_3 = Readonly<{
  recordType: "activity";
  activityId: string;
  signalHash: Sha256LowerHexV0_4;
  repositoryRef: GitHubRepositoryRefV0_3;
  providerEventIdentityHmacSha256: Sha256LowerHexV0_4;
  activityKind: GitHubActivityKindV0_3;
  occurredAt: CanonicalUtcMillisV0_4;
  subjectTaskId: string | null;
  headArtifactId: string | null;
  reviewState: "approved" | "changes_requested" | "commented" | null;
  textSpans: readonly GitHubAllowedTextSpanV0_3[];
}>;
~~~

providerEventId is a transient canonical positive decimal matching /^[1-9][0-9]{0,19}$/ and its kind
is exactly github_event_database_id:

~~~text
providerEventIdentityHmacSha256 =
  HMAC-SHA-256(Kprivacy, JCS({
    domain: "blabase.github.source-bundle.v0.3.event-identity",
    providerEventId,
    providerEventIdKind: "github_event_database_id",
    repositoryIdentityHmacSha256
  }))

activityId = "ghactivity_" + providerEventIdentityHmacSha256

signalHash = H({
  activityKind,
  domain: "blabase.github.source-bundle.v0.3.activity-signal",
  providerEventIdentityHmacSha256,
  repositoryIdentityHmacSha256
})
~~~

For push only, a transient headGitObjectId matching 40 or 64 lowercase hexadecimal derives:

~~~text
headArtifactIdentityHmacSha256 =
  HMAC-SHA-256(Kprivacy, JCS({
    domain: "blabase.github.source-bundle.v0.3.head-artifact",
    headGitObjectId,
    repositoryIdentityHmacSha256
  }))

headArtifactId =
  "artifact_" + first_32_hex(headArtifactIdentityHmacSha256)
~~~

Push requires subjectTaskId null, reviewState null, and non-null headArtifactId. Non-push requires
headArtifactId null. Issue and pull-request activities require a same-bundle subjectTaskId in the
same repository; push does not. Only pull_request_reviewed can have non-null reviewState. Two events
may share headArtifactId but require distinct event HMAC/activityId.

There is no actor field. actorRef, login, name, email, node ID, comment/review body, excerpt, hash,
preview, embedding, raw provider event ID, raw head object ID, branch, diff, patch, and code are
forbidden.

### 10.3 Allowed text and sealed truncation assertion

~~~ts
type GitHubAllowedTextSpanV0_3 = Readonly<{
  kind: "task_object_title" | "push_commit_message_subject";
  text: string;
  sourceUnicodeScalarCount: NonNegativeDecimalStringV0_4;
  sourceUtf8ByteCount: NonNegativeDecimalStringV0_4;
  normalizedUnicodeScalarCountBeforeTruncation:
    NonNegativeDecimalStringV0_4;
  normalizedUtf8ByteCountBeforeTruncation:
    NonNegativeDecimalStringV0_4;
  wasTruncated: boolean;
}>;
~~~

Trusted collection measures source counts immediately after field extraction, rejects a source field
over 65,536 Unicode scalars or 262,144 UTF-8 bytes, normalizes in this exact order:

1. CRLF and CR to LF;
2. NFC;
3. Unicode White_Space runs to one ASCII space; and
4. trim leading/trailing whitespace.

It then measures complete normalized counts and selects the longest Unicode-scalar prefix satisfying
both 240 visible scalars and 2,048 visible UTF-8 bytes.

~~~text
wasTruncated =
  normalizedUnicodeScalarCountBeforeTruncation > 240
  OR normalizedUtf8ByteCountBeforeTruncation > 2048
~~~

When false, visible counts equal the normalized pre-truncation counts. When true, at least one cap is
exceeded and text is the unique longest valid scalar prefix. The parser never truncates or repairs.

A task has exactly one task_object_title span. After normalization/truncation, title.text MUST be
non-empty and MUST satisfy the unchanged frozen Common V0.1 nativeTitle prompt-text validator and
the GitHub visible bounds. Empty, whitespace-only, empty-after-normalization, or Common-invalid title
is SOURCE_BINDING_INVALID/source_bundle_invalid before callback. No repository token, number, role,
activity, untitled literal, or fallback is substituted.

Only push may contain zero through four push_commit_message_subject spans. Every non-push activity
has an exact empty textSpans array. Comment/review text is never allowed.

Applicable spans for parent completeness conversion are exact:

- a task: its one task title;
- a push activity: every allowed push-subject span on that record;
- every non-push activity: the empty applicable-span list.

Raw partial never enters projection completeness. Parent conversion is:
unknown to unknown; partial to truncated; complete to truncated iff at least one applicable span has
wasTruncated true; otherwise complete.

## 11. Hashes, counts, ordering, and manifest binding

Define H(value) = lowercase_hex(SHA-256(RFC8785_JCS_UTF8(value))).

~~~text
manifest.requestedScopeSha256 = H(requestedScope)
manifest.observedScopeSha256 = H(observedScope)
manifest.pagesSha256 = H(pages)
manifest.tasksSha256 = H(tasks)
manifest.activitiesSha256 = H(activities)
manifest.sourceBindingSha256 = H(manifest.sourceBinding)

manifest.sourceArtifactSetSha256 =
sealedEnvelope.sourceArtifactSetSha256 =
  H({
    activitiesSha256,
    domain: "blabase.github.source-bundle.v0.3.artifact-set",
    observedScopeSha256,
    pagesSha256,
    requestedScopeSha256,
    sourceBindingSha256,
    tasksSha256
  })

sealedEnvelope.artifactManifestSha256 = H(manifest)
~~~

artifactManifestSha256 is not copied into manifest. Every component hash is the exact top-level value
hash. Git object IDs are provenance identities and are never accepted as SHA-256 fields.

Counts are canonical decimals and exact:

- requestedRepositoryCount is 1..8 and equals requestedScope.repositoryRefs.length;
- observedRepositoryCount is null iff observed refs are null, otherwise 0..8 and exact length;
- pageCount, taskCount, and activityCount equal the corresponding array lengths;
- taskCount <= 128, activityCount <= 128, total <= 256;
- textSpanCount equals one per task plus all activity spans and is <= 256;
- aggregateVisibleTextUtf8Bytes equals exact sum of text UTF-8 bytes and is <= 131,072.

Arrays are canonical:

1. requested/observed refs by repository HMAC runtime ASCII;
2. activityKinds by declaration order;
3. operationCoverage by repository HMAC then operation order;
4. pages by repository HMAC, operation order, numeric ordinal;
5. tasks by taskId runtime ASCII;
6. activities by occurredAt, repository HMAC, activity-kind order, activityId;
7. text spans in provider source order after the allowed-kind filter.

The parent rejects rather than sorts, normalizes, coerces, defaults, samples, drops, splits, or
truncates input. Hash/ID/HMAC collision rejects the complete bundle without suffixing.

## 12. Common V0.4 preflight and the three input boundaries

### 12.1 Parent-only transient boundary

The parent alone owns submitted bytes, immutable runtime snapshot, proof lookup result, available
or reserved proof reference, owner token, vault, generation fence, key handle, HMAC lease,
quiescence certificate, tombstone, lifecycle terminal record, disposal result, full parsed bundle,
scope proof, coverage and attestation.

~~~ts
type GitHubExactSourceBundleBaseV0_3 =
  ExactSourceBundleBaseV0_4<
    "github",
    "github.source-bundle.v0.3"
  > & FrozenGitHubSourceBundleV0_3;

type GitHubClosedSourceBundleV0_3 =
  ClosedSourceBundleV0_4<
    "github",
    "github.source-bundle.v0.3",
    GitHubExactSourceBundleBaseV0_3
  >;

type GitHubParentCollectionSnapshotV0_3 =
  ParentCollectionSnapshotV0_4<
    "github",
    GitHubCapKeyV0_3,
    GitHubSourceCapsV0_3,
    "github.source-bundle.v0.3",
    GitHubExactSourceBundleBaseV0_3,
    ParentValidatedGitHubCapProfileV0_3,
    GitHubClosedSourceBundleV0_3,
    GitHubRepositoryVaultDescriptorV0_3,
    GitHubSourceProofWireCommitmentsV0_3
  >;
~~~

The snapshot is acquired once only after the normal claim wins. It contains the reserved proof
reference and proof owner. It never crosses the supervisor or serialized IPC boundaries.

### 12.2 Parent-resolved exact projection schema

The element schemas are closed before the payload uses them. Every listed key is required, no key
is optional, no index signature exists and no catch-all object is permitted.

~~~ts
type GitHubTaskProjectionInputV0_3 = Readonly<{
  recordType: "task";
  signalHash: Sha256LowerHexV0_4;
  projectRef:
    GitHubRepositoryRefV0_3["repositoryIdentityHmacSha256"];
  observedAt: CanonicalUtcMillisV0_4;
  sourceUpdatedAt: CanonicalUtcMillisV0_4 | null;
  completeness: ProjectionCompletenessV0_4;
  workItemRole:
    | "assigned_issue"
    | "review_requested_pull_request"
    | "authored_pull_request";
  number: PositiveSafeIntegerV0_4;
  normalizedTitle: string;
}>;

type GitHubActivityProjectionInputV0_3 = Readonly<{
  recordType: "activity";
  signalHash: Sha256LowerHexV0_4;
  projectRef:
    GitHubRepositoryRefV0_3["repositoryIdentityHmacSha256"];
  observedAt: CanonicalUtcMillisV0_4;
  sourceUpdatedAt: CanonicalUtcMillisV0_4;
  completeness: ProjectionCompletenessV0_4;
  activityKind: GitHubActivityKindV0_3;
}>;

type GitHubProjectionOnlyPayloadV0_3 =
  SourceProjectionPayloadBaseV0_4<
    "github",
    "github.common-build-projection-input.v0.3"
  > & Readonly<{
    tasks: readonly GitHubTaskProjectionInputV0_3[];
    activities: readonly GitHubActivityProjectionInputV0_3[];
  }>;

type GitHubClosedProjectionPayloadV0_3 =
  ClosedSourceProjectionPayloadV0_4<
    "github",
    "github.common-build-projection-input.v0.3",
    GitHubProjectionOnlyPayloadV0_3
  >;

type VerifiedGitHubProjectionHandleV0_3 =
  ProjectionOnlyHandleV0_4<
    "github",
    GitHubClosedProjectionPayloadV0_3
  >;
~~~

The projection derivation is deterministic and exact:

| Projection key | Verified wire/parent derivation |
| --- | --- |
| task.recordType | fixed literal task |
| task.signalHash | exact verified task signalHash |
| task.projectRef | repositoryRef.repositoryIdentityHmacSha256, unchanged and opaque |
| task.observedAt | sealed collection observation time |
| task.sourceUpdatedAt | wire task.updatedAt exactly, preserving its already verified nullability |
| task.completeness | Common V0.4 coverage-to-projection conversion only |
| task.workItemRole | exact verified GitHub work-item role |
| task.number | exact positive-safe-integer conversion of wire task.number canonical positive decimal; zero rejects |
| task.normalizedTitle | already verified wire task.title.text exactly; no second normalization and no final suggestion-title meaning |
| activity.recordType | fixed literal activity |
| activity.signalHash | exact verified activity signalHash |
| activity.projectRef | repositoryRef.repositoryIdentityHmacSha256, unchanged and opaque |
| activity.observedAt | sealed collection observation time |
| activity.sourceUpdatedAt | wire activity.occurredAt exactly and non-null |
| activity.completeness | Common V0.4 coverage-to-projection conversion only |
| activity.activityKind | exact verified GitHub activity kind |

All task keys and activity keys are required exactly once. Task sourceUpdatedAt is the only nullable
projection key listed above; activity sourceUpdatedAt is never null. Tasks have cardinality 0..128,
activities 0..128 and the combined cardinality is 0..256 under the frozen GitHub caps. The payload
root has only the exact Common projection-base keys plus tasks and activities, both readonly arrays
of the exact closed element types.

The task projection array preserves the verified canonical task wire-array order exactly. The
activity projection array preserves the verified canonical activity wire-array order exactly.
Projection performs no re-sort, re-group, deduplication, merge or provider-order fallback.

repositoryRef.repositoryIdentityHmacSha256 is copied only as opaque projectRef. Raw host,
repositoryDatabaseId, canonical repository token, HMAC key or preimage, proof, descriptor and vault
material never enter either element.

The parent materializes the projection independently after Step 8 and registers one nominal
projection-only handle. The handle and payload contain no proof, HMAC material, scope, coverage or
attestation objects, seal, supervisor object, full bundle, expected Stage 2, suggestion summary,
rank, caveat, A/B/C identity, model, prompt, configuration, guardrail, output-schema control or
authority-control object.

### 12.3 Supervisor-only invocation boundary

~~~ts
type GitHubOfflineAdapterInvocationV0_3 =
  SourceAdapterInvocationV0_4<
    "github",
    GitHubClosedProjectionPayloadV0_3
  >;
~~~

SourceAdapterInvocation is supervisor-only and NON-WIRE. The supervisor resolves its projection
handle and constructs one canonical IPC value. The adapter never receives or resolves the handle
itself.

### 12.4 Serialized adapter IPC boundary

~~~ts
type GitHubDisposableIsolateIpcInputV0_3 =
  DisposableIsolateIpcInputV0_4<
    "github",
    "github.common-build-projection-input.v0.3",
    GitHubProjectionOnlyPayloadV0_3
  >;
~~~

The actual adapter input has Common V0.4 input schema and protocol literals and carries only the
GitHub V0.3 projection payload plus the exact bounded identity/hash fields defined by the parent.
A recursive reachability check MUST prove that handle, proof, vault, HMAC lease, key handle, scope,
coverage, attestation, envelope, seal and full bundle are absent.

### 12.5 Pre-callback order and precedence

The native parent order is exact:

1. reserve caps and bounded-copy input without proof ownership;
2. one lookup, total pre-claim disposition and authoritative generation-fenced claim;
3. reserved-owner canonical envelope and bundle validation;
4. reserved-owner submitted binding-object validation without proof relookup;
5. reserved-owner collector seal validation;
6. reserved-owner manifest/component/artifact/detached hash validation;
7. key lifecycle, atomic consume plus HMAC lease, containment, certified quiescence, fence and
   zeroization;
8. remaining scope, pagination, coverage, text, forbidden and semantic checks, then projection.

Collector seal precedes component/artifact hashes. SOURCE_BINDING_INVALID is parent pre-callback.
TIMEZONE_PROFILE_INVALID is structurally impossible for GitHub. Timeout, protocol, containment
escape, teardown loss and unproven global state are unsealed operational failures with no semantic
diagnostic and builder count zero.

## 13. Terminal, result, diagnostics and global replay

### 13.1 Exact source-local terminal correlation

A GitHub terminal is not_requested, prepared, or source_local_failure. A bounded source-local
failure always has buildRecords as the exact empty tuple and carries one legal GitHub failure member
with failureCode and failureDetail. TIMEZONE_PROFILE_INVALID is excluded structurally.

Every sanitized diagnostic carries the same failureCode and failureDetail as its selected terminal
failure and also carries detail exactly equal to failureDetail. No code/detail shorthand may index
or widen a failure. Source-local and global failure unions are separate.

The callback union is only built or the single BUILD_RECORD_PROJECTION_INVALID rejection. The
rejected branch has buildRecords: readonly [], issues: readonly [] and one correlated diagnostic.
GitHubCallbackIssueV0_3 is never. SOURCE_BINDING_INVALID cannot be callback-authored.

### 13.2 Global builder replay

The obsolete ParentGlobalReplayDecisionV0_3 comparison_blocked branch and
ComparisonBlockedSourceStatusV0_3 do not exist in the active contract.

For every non-empty requested plan, each requested source reaches one sealed terminal. A bounded
GitHub source-local failure contributes exactly zero records, later sources continue, and once all
sources are sealed without a global or operational failure the parent invokes the canonical Common
V0.1 builder exactly once.

| Attempt | Builder invocation count |
| --- | ---: |
| Empty requested plan | 0 |
| All requested sources prepared | 1 |
| One or more bounded source-local failures and all sources sealed | 1 |
| Global failure, interruption, timeout, protocol loss, containment loss or any unsealed terminal | 0 |

Only a global or operational unsealed failure blocks the builder. Such a branch has no semantic
primary diagnostic. After builder success, global record count and ID-set comparison precede
same-ID content/provenance/binding comparison. Failed sources do not produce derivative missing
record mismatches.

### 13.3 Aggregate correlation

A sealed failure aggregate is fully distributed over the exact primary source, selected failure
member and fixed source tuple. Its top-level failureCode and failureDetail, primaryDiagnostic,
diagnostics[0] and selected failed-source member share the exact same pair. detail equals
failureDetail. Later diagnostics remain fixed-order, unique and exactly correlated to their own
source failure.

Success admits no failed source. A global/unsealed failure has builderInvocationCount 0,
aggregateSealState unsealed and only its exact global pair; an operational interruption has no
semantic diagnostic. Colin review and QA must reject every cross-source, cross-code, cross-detail,
cross-primary, duplicate, omitted or out-of-order combination.

## 14. Exact neutral Common V0.1 build records and authority mapping

### 14.1 Variant aliases

~~~ts
type GitHubTaskCommonBuildRecordV0_3 = Extract<
  CommonSuggestionEvidenceBuildRecordV0_1,
  {
    readonly source: "github";
    readonly kind: "github_work_item";
  }
>;

type GitHubActivityCommonBuildRecordV0_3 = Extract<
  CommonSuggestionEvidenceBuildRecordV0_1,
  {
    readonly source: "github";
    readonly kind: "github_activity";
    readonly authority: "structured_supporting_context";
  }
>;

type GitHubCommonBuildRecordV0_3 =
  | GitHubTaskCommonBuildRecordV0_3
  | GitHubActivityCommonBuildRecordV0_3;
~~~

The adapter returns no final recordId, factIds, record-set hash, coverage, attestation, or private ID
domain. Build identity is exactly { signalHash }. The existing Common builder alone derives IDs,
deduplicates, selects under the global byte budget, sorts, serializes, and seals.

### 14.2 Exact task mapping

Each projection task produces exactly one github_work_item build record.

| workItemRole | authority | attentionCapability | objectType | taskKind | relationship | semanticRole | eligibilityLimit | draftState |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| assigned_issue | primary_task_fact | candidate_input | issue | assigned_issue | assigned_to_user | direct_work_item | none | not_applicable |
| review_requested_pull_request | primary_task_fact | candidate_input | pull_request | review_requested_pull_request | review_requested_from_user | direct_work_item | draft_state_unknown | unknown |
| authored_pull_request | structured_supporting_context | overview_only | pull_request | authored_pull_request | authored_by_user | context_only | not_actionable_by_source_kind | unknown |

Common record fields are exact:

| Common field | Exact projection source |
| --- | --- |
| source | github |
| kind | github_work_item |
| authority | role table only |
| projectRef | projectRef |
| observedAt | observedAt |
| sourceUpdatedAt | projection sourceUpdatedAt, equal to wire task.updatedAt exactly |
| validUntil | null |
| completeness | completeness |
| build identity | exact object containing only signalHash |
| facts | exact 11-key object below |

The facts object has exactly:
attentionCapability, nativeTitle, repositoryFullName, number, objectType, taskKind, state,
relationship, semanticRole, eligibilityLimit, draftState.

nativeTitle is projection normalizedTitle, equal to already verified wire task.title.text exactly with no second normalization and no final suggestion-title meaning. repositoryFullName is projectRef. number is the exact positive safe integer converted from wire task.number canonical positive decimal; zero rejects.
state is open. No destinationUrl, actionability, actor, body, excerpt, label, branch, URL, head,
subject, or twelfth fact is allowed.

### 14.3 Exact activity mapping

Each projection activity produces exactly one github_activity build record:

| Common field/fact | Exact value |
| --- | --- |
| source | github |
| kind | github_activity |
| authority | structured_supporting_context |
| projectRef | projectRef |
| observedAt | observedAt |
| sourceUpdatedAt | projection sourceUpdatedAt, equal to wire activity.occurredAt exactly and non-null |
| validUntil | null |
| completeness | completeness |
| build identity | exact object containing only signalHash |
| activityKind | activityKind |
| repositoryFullName | projectRef |
| activityAt | sourceUpdatedAt |

The activity facts object contains exactly activityKind, repositoryFullName, and activityAt. Subject,
review state, head artifact, actor, text, and wire identities are not Common activity facts.

Record-level authority is permitted only inside these exact build records. Assigned issue and
review-requested pull request permit only primary_task_fact. Authored pull request and every activity
permit only structured_supporting_context. Every inconsistent classification, misplaced authority,
result/system authority, and every authoritative key is rejected.

## 15. Exact Common V0.4 adapter, isolate, terminal and result aliases

~~~ts
type GitHubCallbackIssueV0_3 = never;

type GitHubCallbackDiagnosticV0_3 = Extract<
  CallbackOwnedDiagnosticV0_4,
  { readonly code: "BUILD_RECORD_PROJECTION_INVALID" }
>;

type GitHubOfflineAdapterCallbackResultV0_3 =
  SourceAdapterReturnedResultV0_4<
    "github",
    GitHubCommonBuildRecordV0_3,
    GitHubCallbackIssueV0_3,
    GitHubCallbackDiagnosticV0_3
  >;

type GitHubDisposableIsolateIpcResultV0_3 =
  DisposableIsolateIpcResultV0_4<
    "github",
    GitHubCommonBuildRecordV0_3,
    GitHubCallbackIssueV0_3,
    GitHubCallbackDiagnosticV0_3
  >;

type GitHubDisposableIsolateCompletionV0_3 =
  DisposableIsolateCompletionV0_4<
    "github",
    GitHubCommonBuildRecordV0_3,
    GitHubCallbackIssueV0_3,
    GitHubCallbackDiagnosticV0_3
  >;

type GitHubClosedSourceTerminalFailureV0_3 =
  ClosedSourceTerminalFailureForSourceV0_4<"github">;

type GitHubParentPreflightFailureV0_3 =
  ParentPreflightFailureForSourceV0_4<"github">;

type GitHubPreparedSourceTerminalV0_3 =
  PreparedSourceTerminalV0_4<
    "github",
    GitHubCommonBuildRecordV0_3,
    GitHubClosedSourceTerminalFailureV0_3
  >;

type SealedGitHubPreparedSourceTerminalV0_3 =
  SealedPreparedSourceTerminalV0_4<
    "github",
    GitHubCommonBuildRecordV0_3,
    GitHubClosedSourceTerminalFailureV0_3
  >;

type GitHubSanitizedSourceResultV0_3 =
  SanitizedSourceResultV0_4<"github">;

type GitHubSealedAggregateFailureV0_3 =
  SealedAggregateFailureForPrimaryV0_4<
    "github",
    GitHubClosedSourceTerminalFailureV0_3
  >;
~~~

Parent preflight success uses the exact Common V0.4 verified material and
VerifiedGitHubProjectionHandleV0_3; rejection uses only
GitHubParentPreflightFailureV0_3. All isolate schema/protocol fields are V0.4 while the projection
input version and GitHub build-record variants remain V0.3.

The adapter cannot author trap, blocked access, timeout, protocol violation, containment escape,
teardown failure, SOURCE_BINDING_INVALID, scope failure, coverage, attestation or global comparison.
A returned rejection has zero build records. Contained trap maps source-locally only after confirmed
containment and teardown; loss of containment is unsealed and globally non-semantic.

## 16. Coverage-to-completeness and exact issue derivation

### 16.1 Per-record coverage

Coverage severity is unknown worse than partial worse than complete.

- repository_scope task coverage is its repository_scope_collection tuple status combined with
  repositoryScopeStatus.
- repository_activity task coverage is the worse of its repository tuple status,
  repositoryScopeStatus, and paginationStatus/covered-interval status.
- repository_activity activity coverage is the worse of its repository activity tuple,
  repositoryScopeStatus, and paginationStatus/covered-interval status.
- repository_scope has no activity record.
- record completeness then uses the parent conversion and applicable spans from Section 10.3.

Raw GitHub partial never appears in projection payload; it becomes truncated.

### 16.2 Closed neutral issue conditions and order

~~~ts
type GitHubDerivedLineageIssueCodeV0_3 =
  | "SOURCE_UNAVAILABLE"
  | "COVERAGE_UNKNOWN"
  | "SCOPE_PARTIAL"
  | "PAGINATION_INCOMPLETE"
  | "WINDOW_GAP"
  | "COLLECTION_PARTIAL"
  | "UPSTREAM_ERROR_REPORTED";
~~~

The parent, never the adapter, derives the set from verified wire conditions:

| Issue | Exact V0.3 wire condition |
| --- | --- |
| SOURCE_UNAVAILABLE | Requested GitHub runtime capability is explicitly unavailable; no bundle callback |
| COVERAGE_UNKNOWN | observed refs/coverage are absent or untrusted, or an applicable status is unknown |
| SCOPE_PARTIAL | trustworthy observed repository set differs from requested set, including empty |
| PAGINATION_INCOMPLETE | an activity tuple stops at page_cap or source_error, including a forced nonterminal stop |
| WINDOW_GAP | repository_activity has trustworthy non-null canonical covered intervals whose union is a strict subset of requested [start,end), including empty or a gap |
| COLLECTION_PARTIAL | repositoryScopeStatus, paginationStatus, or any required operation status is the exact wire literal partial |
| UPSTREAM_ERROR_REPORTED | any required operation has stopReason source_error after its present page/hash equations pass |

Conditions form a set union; one condition does not suppress another. Canonical issue order is the
table order, matching the frozen Lineage ordering after removal of inapplicable
PREPROCESSING_PARTIAL. GitHub never derives PREPROCESSING_PARTIAL because no separate preprocessing
operation exists. Issues remain neutral lineage evidence. They never become suggestion caveats,
titles, ranks, or model input.

## 17. Closed-world fictional compile, parser and runtime obligations

All fixtures are fictional, private and exact-key.

### 17.1 Version and parent binding

- Positive: GitHub V0.3 child brands with Common V0.4 envelope, snapshot, proof and isolate protocol.
- Negative: GitHub V0.2, Common V0.2, Common V0.3 parent protocol, mixed brands, aliases, wrappers,
  defaults, coercions and version probing.
- Positive: the exact four parent fields and supplied V0.4 values.
- Negative: missing/mismatched/extra/inherited fields, documentByteLength, contractSourceCommit,
  contractId, duplicate receipt and every fifth field.
- Prove every shared brand is the parent V0.4 nominal declaration and every GitHub alias stays V0.3.
- Compile-positive witnesses prove GitHubAtomicProofClaimResultV0_3,
  GitHubAtomicProofConsumeResultV0_3,
  GitHubAtomicAvailableLifecycleTerminalizationResultV0_3,
  GitHubAtomicOwnerTerminalizationResultV0_3 and
  GitHubZeroizationVaultDisposalRecordV0_3 are non-never exact parent instantiations.
- Compile-negative witnesses reject transient proof handles as verified-consumed handles, verified-
  consumed handles as transient handles, available proof references as reserved references and
  reserved proof references as available references.

### 17.2 Proof, lifecycle, HMAC and disposal

- Cover every total pre-claim priority and every equality/tie combination.
- Cover true claim-versus-rollover and verifier-versus-sweeper races with one winner.
- Distinguish available generation-stale lifecycle cleanup from reserved-owner stale
  terminalization; no stale available vault remains orphaned.
- Cover Step 3, 4, 5 and 6 owner failure separately, exact terminalization, one disposal and zero
  HMAC/callback/adapter.
- Cover key purpose/version/interval/issuance/expiry/revocation/deletion boundaries.
- Prove atomic consume and HMAC lease have one winner; every loser has zero HMAC and disposal.
- Prove raw bytes are containment-only and never map to a worker.
- Cover live reader no-overlap, normal retirement, dead-reader takeover with exact quiescence
  certificate, forged/stale/wrong-vault/wrong-owner/wrong-reader/wrong-epoch/pre-fence certificate,
  duplicate retirement and quarantine when quiescence is unproven.
- Prove zeroization occurs once only after an empty certified reader set and no restoration occurs.
- Observe a consumed retained tombstone as replay without rewriting it.
- Cover retained tombstone versus immediate-delete lifecycle record and exact deletion boundary.

### 17.3 Three boundaries and callback

- Prove parent snapshot/proof/vault cannot reach supervisor invocation or IPC.
- Prove SourceAdapterInvocationV0_4 is supervisor-only and the adapter cannot receive its handle.
- Prove actual input is DisposableIsolateIpcInputV0_4 carrying only the GitHub projection payload.
- Exact-key positives accept every required task and activity key with the declared null and
  cardinality rules.
- Positive derivation witnesses prove task.number comes only from the positive-safe conversion of
  wire task.number canonical positive decimal, task.sourceUpdatedAt equals wire task.updatedAt,
  activity.sourceUpdatedAt equals non-null wire activity.occurredAt, and task.normalizedTitle equals
  already verified wire task.title.text without second normalization.
- Positive order witnesses prove the task and activity projection arrays preserve their respective
  verified canonical wire-array order exactly.
- Parser and compile negatives reject every extra key, missing key, wrong-null sourceUpdatedAt,
  wrong element kind, widened object, index-signature substitute, task number zero, wrong task
  timestamp source, nullable or wrongly sourced activity timestamp, wrong title source, title
  re-normalization, reordered task array and reordered activity array.
- Reject raw host, repositoryDatabaseId, canonical token, HMAC key/preimage, proof, descriptor,
  vault, scope, coverage, attestation and supervisor values in either projection element or root.
- Recursively reject proof, HMAC, key, scope, coverage, attestation, seal, full bundle, expected
  Stage 2, A/B/C, model, suggestion, output path and authority-control fields.
- Accept only callback built or the one projection rejection. Rejection has buildRecords [].
- Reject SOURCE_BINDING_INVALID in callback output and reject every callback issue because
  GitHubCallbackIssueV0_3 is never.

### 17.4 Failure and replay correlation

- Positive compile witnesses cover every legal GitHub failureCode/failureDetail branch.
- Negative compile/parser fixtures cover mismatched failureCode, failureDetail, detail,
  primaryDiagnostic, diagnostics[0], selected source, duplicate/omitted/out-of-order diagnostics and
  TIMEZONE_PROFILE_INVALID.
- Bounded source-local failure seals zero records, later sources continue and builder count is 1
  after all requested terminals seal.
- Global and operational/unsealed failure has builder count 0; operational failure has no semantic
  diagnostic.
- Reject comparison_blocked and every ParentGlobalReplayDecisionV0_3 compatibility value.

### 17.5 Wire, caps, title, privacy and authority

- Preserve canonical bytes, exact keys, hostile objects, hashes, pagination, counts, repository
  scope/ref bijections, text normalization and component precedence fixtures.
- Exercise every cap boundary, title non-empty/Common-valid rule and exact projection fact shape.
- Reject comments, bodies, diffs, code, raw repository identity, tokens, keys, HMAC preimages,
  actor data, credentials, provider errors and non-fictional evidence.
- Reject suggestion title, summary, ranking, caveat, recommendation, action, intent, final output
  path, arm identity, model/prompt/config and every result/system/public authority field.
- Projection-specific negatives reject suggestion summary/rank/caveat, A/B/C, model, prompt,
  configuration, guardrail, output-schema and authority fields. normalizedTitle is accepted only as
  bounded GitHub evidence text and never as a final suggestion title or output field.
- Every result remains private/offline and authoritative: false.

No fixture is implemented or executed by this contract correction.

## 18. Privacy, retention, containment and deletion

Allowed source text remains bounded task title and push subject only. Raw repository identifiers,
canonical tokens, key material, HMAC preimages, actor/comment/body/diff/code, credentials, provider
errors, suggestions and expected outputs remain forbidden from wire, projection, IPC, diagnostics,
logs, fixtures, models and Git.

The parent Common V0.4 retention distinction is exact:

- A retained tombstone contains only the minimum opaque proof digest, non-secret binding/version
  identifiers, exact terminal state/reason and existing lifecycle boundary required for replay
  classification.
- Invalid interval, generation-stale, revoked and expired available-proof lifecycle cleanup uses
  the exact immediate-delete lifecycle terminal record and derived deletionBoundaryAt.
- Raw bytes are readable only inside the HMAC containment executor after consume-plus-lease.
- Disposal waits for normal reader retirement or an exact ReaderQuiescenceCertificateV0_4.
- Unproven quiescence enters fail-closed quarantine. Quarantine grants no arbitrary retention
  duration, raw-read authority, HMAC authority, logging permission or reuse; it requires bounded
  trusted containment recovery and private incident escalation.
- Exactly one winning owner or lifecycle cleanup owner zeroizes each owned slot once. Claim,
  consume, cleanup, fence and certificate losers dispose zero times.

Deletion of the owning private artifact invalidates derived bundles, handles, projections,
terminals, caches and receipt references under the existing policy. This correction creates no new
retention duration, consent basis, persistence or production logging. Non-fictional data remains
outside Git.

## 19. Cross-contract lifecycle and Colin gates

The lifecycle is exact:

1. Common V0.4 standalone contract drafting completed.
2. Common V0.4 full QA corrections and focused re-QA PASS completed.
3. Colin Common V0.4 content approval completed.
4. Common V0.4 exact-byte identity preparation completed.
5. Colin separately froze exact Common V0.4 bytes.
6. Stage10-2B6A GitHub V0.3 correction and exact four-field parent rebinding is the current
   completed drafting checkpoint.
7. Focused GitHub/Common cross-contract re-QA is the next pending gate.
8. Colin separately reviews corrected GitHub V0.3 content.
9. GitHub V0.3 exact-byte identity preparation remains later.
10. Colin separately decides whether to freeze exact GitHub V0.3 bytes.
11. Colin separately decides whether bounded offline implementation may begin.
12. Bounded implementation, validation and reproducibility evidence remain later.
13. Independent implementation QA remains separate.
14. Colin separately accepts, revises or rejects the offline slice.
15. Operational activation and release require a separate Colin decision and operational review.
16. Stage10-2C public authority is a separate future decision.

Passing or completing one gate never authorizes the next. Colin is the sole human authority. David
has no role. This child remains UNFROZEN, INACTIVE and UNIMPLEMENTED.

## 20. Engine, experiment and non-authorization statement

A is structured evidence only. B is the same structured evidence plus neutral Dayflow evidence. C
is neutral Dayflow evidence only. All arms use the identical Blabase input adapter, suggestion
engine, model, prompt, configuration, ranking, guardrails and output schema. Only evidence differs.

GitHub supplies private neutral evidence only. Dayflow remains capture, storage, privacy, OCR and
preprocessing evidence only. Neither source supplies suggestion-shaped semantics or engine control.
Record-level authority is evidence classification inside an exact Common build record, never
verifier, result, system, public or authoritative authority. Every Stage10-2B result is
authoritative: false.

Current state is PROJECTION_MAPPING_CORRECTED_PENDING_FOCUSED_RE_QA and
UNFROZEN / INACTIVE / UNIMPLEMENTED. The only next action is focused read-only cross-contract re-QA.
This document claims no child identity, hash, freeze, implementation approval, implementation,
validation, provider access, live data, activation, release, engine change or Stage10-2C authority.

