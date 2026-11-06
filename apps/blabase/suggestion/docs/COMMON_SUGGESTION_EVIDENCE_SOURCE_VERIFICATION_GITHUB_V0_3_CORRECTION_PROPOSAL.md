# Common Suggestion Evidence GitHub V0.3 to Common V0.4 Correction Proposal

## 0. Document status

| Field | Value |
| --- | --- |
| Document ID | COMMON-SUGGESTION-EVIDENCE-SOURCE-VERIFICATION-GITHUB-V0.3-CORRECTION-PROPOSAL |
| Checkpoint | Stage10-2B6A |
| Date and timezone | 2026-08-25, Asia/Seoul |
| Owner | Colin |
| Sole human reviewer and decision authority | Colin |
| Required David role | None |
| Status | PROJECTION_MAPPING_CORRECTED_PENDING_FOCUSED_RE_QA |
| Child contract | github.source-bundle.v0.3 |
| Frozen parent contract | blabase-common-suggestion-evidence-source-verification-v0.4 |
| Lifecycle | UNFROZEN / INACTIVE / UNIMPLEMENTED |
| Runtime effect | None |
| Authority | Always private and authoritative: false |

This proposal records the correction now applied to the still-unfrozen GitHub V0.3 full contract.
It is not a wrapper around Common V0.3 and does not create a compatibility union. The next gate is
focused read-only GitHub/Common cross-contract re-QA. It does not claim QA closure, child identity,
freeze, implementation approval, activation or release.

## 1. Purpose and accepted architecture

The GitHub wire, schema, cap, projection, adapter and bundle identity remains V0.3. The active
parent envelope, snapshot, proof ownership, state machine, HMAC containment, isolate protocol,
terminal and aggregate identity is frozen Common V0.4.

The parent owns all unknown-byte parsing, trust decisions, proof lifecycle, raw-identity vault,
scope verification, projection-handle resolution, isolate supervision, global builder replay,
coverage and attestation. The adapter receives only serialized projection evidence and returns
neutral Common V0.1 build records.

## 2. Non-goals

This correction does not modify frozen Common V0.4 or historical GitHub V0.2 bytes. It does not
define provider collection, enable credentials, create live access, change Common V0.1, generate a
suggestion, run A/B/C, create child hashes, freeze the child, approve implementation, change
architecture or use real data.

## 3. Historical blockers and corrected disposition

| Historical blocker | Old active behavior | Stage10-2B6A correction |
| --- | --- | --- |
| Parent version drift | GitHub V0.3 actively imported Common V0.3 | Active imports and protocol bindings use Common V0.4; Common V0.3 is rejection/history only |
| Proof ownership | Raw proof validation ended with consume after HMAC work | Total disposition and generation-fenced available-to-reserved claim precede owner Steps 3-6 |
| Key/HMAC race | Key lifecycle, consume, HMAC and cleanup were not atomically fenced | Key lifecycle precedes atomic consume plus HMAC lease; raw HMAC is containment-only |
| Dead reader | Cleanup could assume a reader exited | Exact correlated quiescence certificate or fail-closed quarantine is required |
| Generation stale | Available and reserved stale proof paths were conflated | Available uses zeroize-only lifecycle cleanup; reserved uses owner/supervisor terminalization |
| Callback boundary | Handle, invocation and serialized adapter input were conflated | Parent-only, supervisor-only and serialized IPC boundaries are distinct |
| Result correlation | Old code/detail shapes could widen diagnostics | failureCode, failureDetail and detail are exactly correlated |
| Replay | comparison_blocked stopped replay after bounded source failure | Failed source contributes zero records; later sources continue; sealed aggregate builds once |
| Parent binding | Old Common V0.3 identities were active | Exact four-field Common V0.4 binding is active; fifth fields reject |

Frozen GitHub V0.2 and frozen Common V0.2/V0.3 artifacts remain immutable historical evidence.
No historical value becomes active by changing a version field.

## 4. Exact frozen Common V0.4 binding

The runtime parent object has exactly:

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

The exact object rejects every missing, mismatched, inherited or fifth field. Parent byte length
126060 and contract source commit f1d0900ea815a3f430b445be92145a1a2e2ee3d6 remain external
evidence only. The receipt identifier is the existing third field, not an added field.

The sole positive active version pair is GitHub V0.3 plus Common V0.4. GitHub V0.2, Common V0.2,
Common V0.3 parent protocol and every mixed combination reject.

## 5. Corrected data flow

~~~text
private canonical GitHub V0.3 bytes
+ Common V0.4 envelope/capability/proof token
-> bounded copy with no vault ownership
-> one immutable Common V0.4 snapshot and one proof lookup
-> total pre-claim disposition
-> authoritative generation-fenced available-to-reserved claim
-> reserved owner validates canonical input, binding, seal and hashes
-> key lifecycle
-> atomic consumed proof plus HMAC lease
-> containment-only raw read and HMAC
-> exact reader retirement certificate or fail-closed quarantine
-> fenced single zeroization
-> remaining scope/coverage/semantic checks
-> parent materializes projection-only payload and nominal handle
-> supervisor resolves handle into Common V0.4 isolate IPC input
-> adapter sees only GitHub projection payload
-> adapter returns built or the one projection rejection
-> every requested source seals; bounded failures contribute zero records
-> canonical Common V0.1 builder executes once
-> parent comparison, coverage, attestation and sanitized result
~~~

## 6. Corrected contract model

### 6.1 Active version ownership

GitHub-owned literals remain V0.3. Common-owned envelope, runtime, proof, state-machine, snapshot,
isolate, terminal and aggregate types are V0.4. GitHub aliases keep V0_3 names while instantiating
the parent V0_4 generics. The child declares no parent brand or shared unique symbol.

### 6.2 Proof ownership and total pre-claim disposition

Step 2 performs one lookup with outcomes not_found, active or retained_tombstone. A consumed
tombstone observation returns replay without rewriting it. One immutable snapshot is classified
with exact precedence:

1. structurally invalid proof interval;
2. authoritative generation stale;
3. revoked at or before the trusted decision time;
4. expired at or before the trusted decision time;
5. future-issued;
6. eligible.

Every branch above future-issued atomically terminalizes and disposes through the zeroize-only
lifecycle owner. Future-issued alone is a non-disposing context failure. Only eligible may win the
available-to-reserved claim. Claim losers own no vault.

Normal claim and generation-rollover cleanup compare the same authoritative fence. Rollover-first
makes claim fail and one cleanup owner terminalizes an available stale proof. Claim-first produces a
reserved proof whose owner/supervisor path handles later staleness.

The child uses only these exact frozen parent result declarations:

~~~ts
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

No wrapper brand, structural substitute or widened child result is permitted.

### 6.3 Reserved owner, consume and contained HMAC

Only the reserved owner runs canonical input, submitted binding, collector seal and detached hash
Steps 3-6. Each owner failure transitions to one exact terminal/tombstone and the same owner alone
disposes.

Step 7 validates the referenced privacy key and purpose-restricted handle, then atomically couples
reserved-to-consumed proof transition with a HMAC lease. Only the winner may submit HMAC operations
to the nominal containment executor. Raw repository bytes never map to the worker.

A live reader prevents disposal. A crashed reader may be retired only with an exact nominal
ReaderQuiescenceCertificateV0_4 matching vault, owner, reader, lease epoch, containment generation
and published fence, and proving raw access, live mappings, live operations and old outputs are
revoked. Invalid certificates fail closed. Unprovable quiescence enters quarantine rather than
unsafe zeroization; quarantine is not arbitrary retention authority.

### 6.4 Three input boundaries and exact closed projection schema

| Boundary | Owner | Exact content |
| --- | --- | --- |
| Parent-only transient | Common parent | snapshot, proof, owner, vault, lease, full bundle, scope, coverage, attestation |
| Supervisor-only | isolate supervisor | SourceAdapterInvocationV0_4 and nominal projection handle |
| Serialized adapter IPC | disposable isolate | DisposableIsolateIpcInputV0_4 with GitHub projection payload only |

The supervisor resolves the handle. The adapter never receives a handle, proof, HMAC object, scope,
coverage, attestation, seal or full bundle.

The standalone child declares both closed element types before the payload uses them:

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
~~~

Every key is required and exact; no optional key, index signature or catch-all object exists. Task
sourceUpdatedAt alone may be null; activity sourceUpdatedAt is non-null. Task, activity and combined
cardinalities remain 0..128, 0..128 and 0..256. The task projection array preserves the verified
canonical task wire-array order exactly, and the activity projection array preserves the verified
canonical activity wire-array order exactly. Projection performs no re-sort, re-group, deduplication,
merge or provider-order fallback.

The derivations are literal and single-source:

- task.projectRef and activity.projectRef equal
  repositoryRef.repositoryIdentityHmacSha256 unchanged and opaque;
- task.number is the exact PositiveSafeIntegerV0_4 conversion of wire task.number canonical positive
  decimal and rejects zero;
- task.sourceUpdatedAt equals wire task.updatedAt exactly and preserves its verified nullability;
- activity.sourceUpdatedAt equals wire activity.occurredAt exactly and is non-null;
- task.normalizedTitle equals already verified wire task.title.text exactly, with no second
  normalization and no final suggestion-title meaning;
- observedAt is the sealed collection observation time;
- completeness is only the frozen Common V0.4 coverage-to-projection conversion; and
- workItemRole and activityKind equal their corresponding verified wire literals.

Raw host, repositoryDatabaseId, canonical repository token, HMAC key/preimage, proof, descriptor,
vault, scope, coverage, attestation, supervisor data, suggestion summary/rank/caveat, A/B/C,
model/prompt/configuration/guardrail, output-schema control and authority fields are absent.

### 6.5 Parent generics, results and diagnostics

ParentCollectionSnapshotV0_4 is instantiated with the GitHub V0.3 cap key/value object, bundle
version, exact bundle, closed cap profile, closed bundle, descriptor set and wire commitments.
Adapter, isolate, preflight, terminal, sanitized and aggregate aliases use Common V0.4 generics.

A terminal failure has failureCode and failureDetail. Its diagnostic repeats the exact pair and
detail equals failureDetail. Aggregate top level, primaryDiagnostic, diagnostics[0] and selected
failure member share the same pair. GitHub structurally excludes TIMEZONE_PROFILE_INVALID.
Source-local and global failure unions are separate.

### 6.6 Exact callback union

GitHubCallbackIssueV0_3 is never. Adapter output is only:

- built with exact GitHub Common build records, empty issues and diagnostics; or
- BUILD_RECORD_PROJECTION_INVALID rejection with buildRecords as the exact empty tuple, empty
  issues and one correlated diagnostic.

SOURCE_BINDING_INVALID remains parent pre-callback. Trap, forbidden access, timeout, protocol,
containment and teardown states are supervisor-owned.

### 6.7 Builder replay

ParentGlobalReplayDecisionV0_3 comparison_blocked and ComparisonBlockedSourceStatusV0_3 are removed.
A bounded source-local failure seals zero records and does not stop later sources. After every
requested source seals and no global/operational failure exists, the global Common builder runs
exactly once. Empty plan, global failure and operational/unsealed failure run it zero times.
Operational failure has no semantic diagnostic.

## 7. Preserved GitHub child behavior

The 18-key cap object and numeric limits, repository identifier framing, per-ref and set-HMAC
domains, scope null rules, manifest/component precedence, pagination, text normalization, title
non-empty rule, neutral task/activity projection, record-level evidence authority and Common V0.1
build-record mappings remain unchanged.

Collector seal remains before component/artifact/detached hashes. Structured GitHub evidence never
becomes suggestion wording, ranking, caveat, output path, engine control or public authority.

## 8. Version and compatibility implications

| Surface | Active rule |
| --- | --- |
| GitHub bundle/schema/adapter/caps/projection | V0.3 only |
| Parent envelope/runtime/proof/isolate/results | Common V0.4 only |
| Common V0.1 builder | unchanged canonical global builder |
| GitHub V0.2 | immutable history and rejection fixture only |
| Common V0.2/V0.3 protocol | immutable history and rejection fixture only |
| Compatibility | no union, alias, wrapper, migration, default or fallback |
| Child lifecycle | UNFROZEN / INACTIVE / UNIMPLEMENTED |
| Next gate | focused cross-contract re-QA |

No child identity or freeze evidence is prepared by this correction.

## 9. Privacy and retention

Retained consumed/rejected tombstones contain only minimized opaque replay-classification evidence.
Invalid interval, generation-stale, revoked and expired available-proof cleanup uses the Common V0.4
immediate-delete lifecycle record and exact existing boundary. Raw bytes are containment-only.
Zeroization waits for certified quiescence.

Quarantine is fail-closed incident state, not permission for arbitrary retention, raw access,
HMAC, reuse, logging or model input. Existing lawful basis, minimization, retention and deletion
policy remains unchanged. No real GitHub or credential data enters Git.

## 10. Closed-world fictional fixture obligations

- Exact four-field parent binding positive and fifth-field negatives.
- Compile-positive non-never witnesses for the exact claim, consume, available-lifecycle
  terminalization, owner-terminalization and disposal aliases.
- Compile-negative transient-versus-verified-consumed and available-versus-reserved assignments.
- Positive GitHub V0.3 plus Common V0.4 brands; every mixed/historical parent combination rejects.
- Every pre-claim priority, equality and combined-fault case.
- True claim/rollover and verifier/sweeper races.
- Available versus reserved generation stale cleanup.
- Separate Step 3, 4, 5 and 6 owner failures with zero HMAC/callback and one disposal.
- Key lifecycle, atomic consume plus lease and one HMAC winner.
- Containment-only raw bytes, live reader exclusion, dead-reader certificate takeover, every invalid
  certificate and quarantine.
- Retained consumed tombstone replay without rewrite.
- Parent-only, supervisor-only and serialized IPC reachability.
- Exact-key positive task/activity projection fixtures with all required fields and exact null/
  cardinality rules.
- Positive derivation witnesses bind task.number to positive-safe conversion of canonical
  positive-decimal wire task.number, task.sourceUpdatedAt to wire task.updatedAt,
  activity.sourceUpdatedAt to non-null wire activity.occurredAt, and normalizedTitle to already
  verified wire task.title.text without second normalization.
- Positive order witnesses preserve verified canonical task and activity wire-array order exactly.
- Negative projection fixtures cover extra, missing, wrong-null or widened keys; task number zero;
  wrong task timestamp source; nullable or wrongly sourced activity timestamp; wrong title source
  or title re-normalization; reordered task array; reordered activity array; raw repository
  identity; proof/HMAC material; suggestion summary/rank/caveat; A/B/C; model/prompt/configuration/
  guardrail; authority; and output-schema fields.
- Exact built/rejection callback union and empty rejected buildRecords.
- failureCode/failureDetail/detail and aggregate cross-pair negatives.
- TIMEZONE_PROFILE_INVALID rejection for GitHub.
- Source-local failure builder count 1 after all terminals; global/unsealed count 0.
- Exact caps, title boundaries, canonical wire, hashes, pagination, scope and descriptor bijections.
- Forbidden suggestion/output/authority/model/arm/provider/private fields.

Fixtures remain fictional. This checkpoint specifies but does not implement or run them.

## 11. Decision table

| Decision | Applied state |
| --- | --- |
| Child/parent versions | GitHub V0.3 plus frozen Common V0.4 |
| Parent runtime binding | exact four fields |
| Common V0.3 active compatibility | removed; rejection/history only |
| Proof acquisition | total disposition then generation-fenced reserved claim |
| HMAC | key lifecycle, consume plus lease, containment only |
| Dead reader | exact certificate or quarantine |
| Input boundary | parent transient, supervisor invocation, serialized IPC |
| Callback | built or one projection rejection |
| Diagnostics | exact failureCode/failureDetail/detail correlation |
| Replay | bounded source failure continues; global builder once |
| Authority | private/offline and authoritative: false |
| Lifecycle | UNFROZEN / INACTIVE / UNIMPLEMENTED |
| Next gate | focused cross-contract re-QA |

These are applied draft corrections, not QA findings closure or implementation approval.

## 12. Colin review and QA checkpoint

Common V0.4 drafting, QA correction, focused re-QA, Colin content approval, identity preparation and
freeze are complete. Colin authorized this child correction/rebinding checkpoint.

No further product decision is required before read-only cross-contract QA. After QA, Colin must
separately choose revise, hold or approve the corrected child content. Automated QA does not replace
that decision.

## 13. Required lifecycle

~~~text
Common V0.4 frozen
-> Stage10-2B6A child correction and four-field rebinding completed
-> renewed GitHub/Common cross-contract QA pending
-> Colin child content review
-> child exact-byte identity preparation
-> separate Colin child freeze decision
-> separate bounded implementation approval
-> implementation
-> validation and reproducibility evidence
-> independent implementation QA
-> Colin offline acceptance
-> separate operational activation/release review
-> separate Stage10-2C authority decision
~~~

No gate is inferred from another. David has no role.

## 14. Engine and experiment invariants

A is structured evidence. B is the same structured evidence plus neutral Dayflow evidence. C is
neutral Dayflow evidence only. Every arm uses the same Blabase adapter, suggestion engine, model,
prompt, configuration, ranking, guardrails and output schema. Only evidence differs.

GitHub is private neutral structured evidence. Dayflow is capture, storage, privacy, OCR and
preprocessing evidence. Neither supplies suggestion-shaped semantics or engine control. Every
Stage10-2B result remains authoritative: false.

## 15. Non-authorization statement

This correction changes documentation only. It creates no child hash or freeze, implementation,
test, parser, verifier, adapter, collector, registry, key, capability, provider connection, live
data access, public API, release, activation, engine change, architecture change or authority.

Current state is PROJECTION_MAPPING_CORRECTED_PENDING_FOCUSED_RE_QA and
UNFROZEN / INACTIVE / UNIMPLEMENTED. The only next action is focused read-only cross-contract re-QA.
