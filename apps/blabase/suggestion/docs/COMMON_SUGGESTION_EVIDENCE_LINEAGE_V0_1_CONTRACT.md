# Common Suggestion Evidence Lineage Receipt v0.1 Contract (Frozen)

## Document status

- Checkpoint: Stage10-1A.2a.
- Date: 2026-08-21.
- Working owner and decision authority: Colin.
- Required David role: none.
- Status: Frozen v0.1; effective only upon Colin's explicit approval of this exact document state. Not implemented.
- Prerequisite: Stage10-1A.1 is implemented, validated, independently QA-reviewed, and documented.
- This document authorizes no implementation, engine connection, experiment execution, release,
  or production use.

## Objective

Define a separate, sealed lineage receipt that proves which source snapshots and coverage claims
were bound to one validated Common Suggestion Evidence Record Set v0.1.

The receipt answers two questions:

1. Provenance: Which frozen source artifact set and adapter version produced each source partition?
2. Coverage: What source scope or time range was actually observed, and what remained partial or
   unknown?

It does not generate, rank, filter, or render suggestions.

## Non-goals

- Do not modify blabase-common-suggestion-evidence-record-set-v0.1.
- Do not add provenance fields to the prompt evidence record set.
- Do not implement GitHub, Codex, Calendar, Notion, or Dayflow adapters.
- Do not connect a prompt, model, provider, ranker, guardrail, or output renderer.
- Do not add an A, B, or C arm identifier.
- Do not infer completeness from record count, OCR volume, or absence of errors.
- Do not store raw external identifiers, screenshot paths, image bytes, or private payloads.
- Do not claim cryptographic authenticity beyond the supplied frozen artifact hashes.

## Artifact identity

Proposed constants:

| Property | Proposed value |
| --- | --- |
| Schema version | blabase-common-suggestion-evidence-lineage-receipt-v0.1 |
| Detached-hash domain | blabase.common-suggestion-evidence-lineage-receipt.v0.1 |
| Detached-hash field | commonSuggestionEvidenceLineageReceiptSha256 |
| Source-attestation schema version | blabase-common-suggestion-source-collection-attestation-v0.1 |
| Source-attestation detached-hash domain | blabase.common-suggestion-source-collection-attestation.v0.1 |
| Source-attestation detached-hash field | sourceCollectionAttestationSha256 |
| Record-ID-set hash domain | blabase.common-suggestion-evidence-lineage-record-ids.v0.1 |
| Private scope-digest algorithm | HMAC-SHA-256 |
| Private scope-digest domain | blabase.lineage.private-scope.v0.1 |
| Private scope-digest wire encoding | Exactly 64 lowercase hexadecimal characters matching ^[0-9a-f]{64}$ |
| Scope-token canonicalization version | blabase-scope-token-canonicalization-v0.1 |
| Pinned timezone release | IANA tzdata2026c.tar.gz |
| Pinned timezone release SHA-512 | e0b4b7044b66fbc27bc21d13d18063abcdf78ab58d5ba5fd64bd1a88d86e9d495f45add4d8e65bb6c40249f9c94ca29b72c8ebba8d0e4c468f2965ac77932ef0 |
| Timezone profile version | blabase-tzdb-profile-2026c-v1 |
| Maximum canonical receipt bytes | 262,144 |
| Maximum canonical source-attestation bytes | 131,072 |
| Maximum private scope HMAC preimage bytes | 1,048,576 |
| Maximum source bindings | 5 |
| Maximum coverage intervals per binding | 1,024 |
| Maximum neutral issue codes per binding | 32 |
| Maximum input graph depth | 32 |
| Maximum enumerable own properties across one submitted artifact | 16,384 |

The receipt is a companion artifact. Its version does not bump or replace the Stage10-1A.1 record
set version.

## Freeze and change control

### Proposal and freeze boundary

Until Colin explicitly approves and freezes this exact contract, every field, literal, rule, version,
domain, and acceptance criterion remains a proposal. Document creation, implementation work,
automated validation, agent QA, or silence is not a freeze decision and cannot authorize sealing or
activation.

The freeze takes effect only when Colin approves one exact document state in which the title,
Document status, and proposal-only identity headings have already been changed to their frozen
status wording without changing normative contract content. That status-only transition is part of
the freeze act, not a post-freeze editorial erratum. A candidate bearing frozen-status wording has
no authority before Colin's approval. Until the approved frozen-status document state is recorded,
this contract remains a proposal even if implementation scope was separately approved.

Colin's freeze decision must identify the exact approved document state and these v0.1 identities:

- `blabase-common-suggestion-evidence-lineage-receipt-v0.1`
- `blabase.common-suggestion-evidence-lineage-receipt.v0.1`
- `blabase-common-suggestion-source-collection-attestation-v0.1`
- `blabase.common-suggestion-source-collection-attestation.v0.1`
- `blabase.common-suggestion-evidence-lineage-record-ids.v0.1`
- `blabase.lineage.private-scope.v0.1`
- `blabase-scope-token-canonicalization-v0.1`
- `blabase-tzdb-profile-2026c-v1`

After that explicit freeze, the normative v0.1 contract is immutable. Every artifact already sealed
under v0.1 remains immutable and is verified only under its original exact schema, protocol,
canonicalization version, domain, preimage, and profile semantics. It is never rewritten, rehashed,
reinterpreted, or silently promoted to a later version.

### Normative changes require version isolation

A change is normative when it can alter any accepted or rejected input, serialized byte, required or
forbidden field, nullability, type, literal, enum, order, cardinality, cap, canonicalization result,
JCS bytes, hash or HMAC preimage, source mode, required operation, participation outcome, operation
status, aggregate coverage, issue-code set, public failure code or precedence, provenance claim,
privacy boundary, key/context authority, retention or deletion result, timezone interpretation, or
authoritative verification result.

A normative change must not be edited into v0.1. Before use it must create a new exact version for
every affected protocol or domain:

- A receipt field, wire, ordering, cap, coverage, issue-code, failure-code, failure-precedence,
  privacy-authority, or receipt verification change requires a new receipt schema/protocol version
  and a new receipt detached-hash domain derived from
  `blabase-common-suggestion-evidence-lineage-receipt-v0.1` and
  `blabase.common-suggestion-evidence-lineage-receipt.v0.1`.
- A source-attestation field, wire, provenance, coverage-evidence, issue-code, or attestation
  verification change requires a new source-attestation schema version and detached-hash domain
  derived from `blabase-common-suggestion-source-collection-attestation-v0.1` and
  `blabase.common-suggestion-source-collection-attestation.v0.1`.
- A record-ID-set field, ordering, source binding, JCS object, or preimage change requires a new
  record-ID-set hash domain derived from
  `blabase.common-suggestion-evidence-lineage-record-ids.v0.1`.
- A source identifier object, normalization, token construction, sorting, uniqueness, HMAC
  preimage, scopeKind, or scope-comparison change requires a new scope-token canonicalization
  version and private scope-digest domain derived from
  `blabase-scope-token-canonicalization-v0.1` and
  `blabase.lineage.private-scope.v0.1`.
- A timezone profile membership, alias, canonical-target, pinned-release, or profile-byte change
  requires a new timezone profile version and newly reviewed profile hash derived from
  `blabase-tzdb-profile-2026c-v1`. A serialized timezone field or verification-semantic change also
  bumps every affected receipt and source-attestation version and domain.
- A requestedCollectionMode, requiredOperations mapping, participation, source-specific status, or
  issue derivation change bumps every affected receipt and source-attestation version and domain.
- A change spanning multiple rows above must bump all affected versions and domains together. One
  version bump cannot silently cover an independently affected unchanged domain.

Newly sealed artifacts use only the new exact versions, domains, preimages, and resulting hashes.
Existing detached hashes, HMACs, timezone profile hashes, and sealed artifact bytes are never
modified. The Stage10-1A.1 Common Suggestion Evidence Record Set version remains unchanged unless
that separate record-set contract itself changes.

A parser or verifier must dispatch by one exact declared version. Compatibility unions, permissive
fallbacks, alias versions, default-version inference, cross-version field unions, and reinterpretation
of an older artifact under newer semantics are forbidden. Supporting multiple versions requires
isolated exact schemas and verification paths for each version.

### Editorial-only errata

A post-freeze edit is editorial-only only when it cannot change the accepted or rejected JSON value
set, serialized bytes, field meaning, JCS or hash/HMAC preimage, derived status or issue code,
selected public failure code, privacy or retention outcome, verification authority, or any observable
implementation behavior. Spelling, grammar, formatting, or link corrections qualify only when all
of those invariants remain byte-for-byte and behavior-for-behavior unchanged.

Every editorial erratum must be recorded append-only with its before text, after text, reason,
non-normative justification, date, and Colin approval. If that proof is incomplete or disputed, the
change is normative and requires the version isolation rules above.

No new or changed version may activate before its relevant contract tests, boundary and regression
tests, independent QA, documentation, and Engine Change Record are complete and Colin explicitly
approves that exact version. Approval of v0.1 never automatically approves a later version, and
successful checks never substitute for Colin's freeze or activation decision.

## Exact wire, bounds, and hash preimages

All serialized artifacts are JSON data, not JavaScript object behavior. Inputs must be finite trees
of plain data with exact fields, dense arrays, no shared references, no cycles, no accessors, no
symbols, no proxies, and no unknown keys. Strings must contain only valid Unicode scalar values;
unpaired UTF-16 surrogates are invalid. Byte lengths are measured after strict UTF-8 encoding and
before hashing. Limits described as bytes never mean UTF-16 code units or user-perceived characters.

### Reusable scalar wire types

Every bounded phrase used by this contract resolves to this exact grammar:

| Contract phrase | Exact wire rule |
| --- | --- |
| lowercase SHA-256 | Exactly 64 lowercase hexadecimal ASCII characters matching ^[0-9a-f]{64}$. |
| lowercase SHA-512 | Exactly 128 lowercase hexadecimal ASCII characters matching ^[0-9a-f]{128}$. |
| private scope HMAC-SHA-256 | Exactly 64 lowercase hexadecimal ASCII characters matching ^[0-9a-f]{64}$. |
| canonical UTC timestamp | Exactly 24 ASCII bytes in YYYY-MM-DDTHH:mm:ss.sssZ form, valid Gregorian date, year 0001 through 9999, seconds 00 through 59, UTC Z only. |
| bounded identifier | 1 through 64 ASCII bytes matching ^[a-z][a-z0-9._-]{0,63}$. |
| bounded version string | 1 through 128 ASCII bytes matching ^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$. |
| bounded opaque version | 1 through 64 ASCII bytes matching ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$. |
| bounded source-specific value | Exact source-specific requestedCollectionMode enum from the frozen mode table below; every literal is 1 through 64 lowercase ASCII bytes. |
| bounded opaque context ID | Exactly 46 ASCII bytes matching ^scope_context_[0-9a-f]{32}$. |
| timezoneContext | Exact literal unknown or a 1 through 255 ASCII-byte canonical Zone name that is an exact member of the frozen blabase-tzdb-profile-2026c-v1 allowlist. Syntax alone never establishes membership. |
| unsigned integer | JSON integer from 0 through 9,007,199,254,740,991 inclusive; -0, fractions, exponent ambiguity, NaN, and Infinity are invalid. |

Schema versions, source names, participation states, operation names, status values, issue codes,
failure codes, coverageKind values, accountingKind values, and pagination/collection status values
are exact ASCII literals defined by their enums. A canonical interval contains exactly start and end
timestamps using the timestamp wire above and requires start earlier than end.

### Exact collection caps

| Collection | Exact cap |
| --- | --- |
| sourceCollectionPlan | Exactly 5 entries in fixed source order. |
| sourceBindings | Exactly 5 entries in fixed source order. |
| requiredOperations | At most 2 entries and exactly the source-defined canonical subset. |
| requiredOperationStatuses | At most 2 entries and exactly one per required operation. |
| coveredIntervals | At most 1,024 entries per source binding. |
| issueCodes | At most 32 sorted unique enum values per source binding or attestation. |
| canonicalTokens in a private scope HMAC preimage | At most 4,096 sorted unique NFC strings; each at most 2,048 UTF-8 bytes; entire HMAC JCS preimage at most 1,048,576 bytes. |

The canonical serialized receipt is RFC 8785 JCS for the full validated root followed by exactly one
LF byte and must be at most 262,144 bytes including that LF. A canonical serialized source
attestation follows the same rule and must be at most 131,072 bytes including its LF. Neither CRLF
nor an omitted, duplicated, or additional trailing byte is valid. The receipt and attestation hash
preimages exclude their detached-hash field and exclude the serialization LF; each preimage must
also fit its corresponding serialized-artifact byte cap before hashing.

### Exact detached-hash formulas

All domain strings are UTF-8 ASCII. `||` means raw byte concatenation and `0x00` is one zero byte.
Every SHA-256 result uses the lowercase hexadecimal wire type above.

- Receipt hash = SHA-256(UTF8("blabase.common-suggestion-evidence-lineage-receipt.v0.1") || 0x00 || RFC8785_JCS(root without commonSuggestionEvidenceLineageReceiptSha256)).
- Source-attestation hash = SHA-256(UTF8("blabase.common-suggestion-source-collection-attestation.v0.1") || 0x00 || RFC8785_JCS(attestation without sourceCollectionAttestationSha256)).
- Record-ID-set hash = SHA-256(UTF8("blabase.common-suggestion-evidence-lineage-record-ids.v0.1") || 0x00 || RFC8785_JCS({"recordIds": sortedRecordIds, "source": source})).

RFC 8785 JCS is applied without Unicode normalization or implementation-specific pretty printing.
All serialized public strings are ASCII by grammar except source-normalized canonicalTokens, which
must be NFC before entering the private HMAC preimage. JSON numbers in receipt and attestation
artifacts are non-negative safe integers only, so alternate floating-point renderings are invalid.

Resource caps are checked before canonicalization and hashing. Structural traversal stops and
returns RESOURCE_LIMIT_EXCEEDED when depth, property, string, array, interval, token, preimage, or
serialized-byte limits are exceeded. It must not stringify, hash, invoke, or preserve an over-limit
value. Private source verification bundles are not serialized wire artifacts; each Stage10-2 source
verifier must freeze its own raw-artifact byte/count caps before authoritative activation.

## Root contract

The sealed root contains exactly:

| Field | Type | Rule |
| --- | --- | --- |
| schemaVersion | literal | Must equal the proposed schema version. |
| asOf | canonical UTC timestamp | Must equal the bound record set asOf. |
| commonSuggestionEvidenceRecordSetSha256 | lowercase SHA-256 | Must equal the validated bound record-set hash. |
| privacyScopeHmacKeyVersion | bounded opaque version or null | Required when any privacy scope HMAC is present; otherwise null. Identifies private key material without exposing it. |
| privacyScopeHmacContextId | bounded opaque context ID or null | Required when any privacy scope HMAC is present; otherwise null. Must be issued by the approved registry for exactly one frozen evaluation case. |
| privacyScopeTokenCanonicalizationVersion | literal or null | Must equal blabase-scope-token-canonicalization-v0.1 when any privacy scope HMAC is present; otherwise null. |
| sourceCollectionPlan | ordered collection-plan array | Exactly one plan entry for each of the five v0.1 sources, including sources that are not requested. |
| sourceBindings | ordered source-binding array | Exactly one binding for every collection-plan entry, including zero-record and unavailable sources. |
| commonSuggestionEvidenceLineageReceiptSha256 | lowercase SHA-256 | Detached hash of every preceding root field. |

The sealed root contains no arm ID, run ID, prompt, model, suggestion, raw source identifier, or
private build identity.

## Source collection plan

The plan contains exactly five entries in the fixed source order github, codex, google_calendar,
notion, and dayflow. Each entry contains:

| Field | Type | Rule |
| --- | --- | --- |
| source | source enum | Must match the entry's fixed position. |
| requestStatus | requested or not_requested | Declares whether collection was requested before collection results were known. |
| requestedCollectionMode | frozen source-specific enum or null | Required when requested and must match the exact mode table below; null when not_requested. |
| requiredOperations | fixed-order unique source-specific operation array | Empty when not_requested; when requested, must contain every mandatory v0.1 operation and each operation required by the requested collection mode. |

The collection plan is part of the detached receipt-hash preimage. It is not inferred from record
presence. A zero-record result cannot retroactively change requested into not_requested.

The plan contains no arm ID. A future A/B/C runner may produce different requested-source plans,
but the receipt remains validation-only and the engine cannot receive the plan through this
contract.

### Frozen requested collection modes

The v0.1 mode-to-operation mapping is exact:

| Source | requestedCollectionMode | Exact requiredOperations |
| --- | --- | --- |
| github | repository_scope | repository_scope_collection |
| github | repository_activity | repository_scope_collection, activity_pagination |
| codex | project_conversations | project_scope_collection, conversation_collection |
| google_calendar | event_window | event_window_collection |
| notion | resource_scope | resource_scope_collection |
| notion | resource_collection | resource_scope_collection, resource_pagination |
| dayflow | capture_privacy_ocr | capture_window_collection, privacy_ocr_preprocessing |

No alias, default, empty requested mode, caller extension, or mode from another source is valid. The
requiredOperations array is derived from this table in canonical order and cannot be independently
chosen. A new mode or changed operation mapping requires a new serialized protocol version; it
cannot be added under v0.1.

### Source operation vocabulary

The v0.1 operation enums and canonical order are:

| Source | Operations in canonical order | Requirement |
| --- | --- | --- |
| github | repository_scope_collection, activity_pagination | repository_scope_collection is mandatory; activity_pagination is required only by repository_activity. |
| codex | project_scope_collection, conversation_collection | Both operations are mandatory when requested. |
| google_calendar | event_window_collection | Mandatory when requested. |
| notion | resource_scope_collection, resource_pagination | resource_scope_collection is mandatory; resource_pagination is required only by resource_collection. |
| dayflow | capture_window_collection, privacy_ocr_preprocessing | Both operations are mandatory when requested. |

Unknown, duplicate, out-of-order, or cross-source operations are invalid. An operation omitted from
requiredOperations cannot be reported as complete and cannot contribute evidence to the bound
record set. The frozen requestedCollectionMode table above is the only v0.1 operation mapping.

## Common source-binding fields

Every source binding contains exactly:

| Field | Type | Rule |
| --- | --- | --- |
| source | source enum | github, codex, google_calendar, notion, or dayflow. |
| participationStatus | not_requested, collected, or unavailable | Must agree with the collection-plan requestStatus and the conditional rules below. |
| sourceCollectionAttestationSha256 | lowercase SHA-256 or null | Required for collected and unavailable; null for not_requested. Must bind the verified sealed source attestation. |
| sourceArtifactSetSha256 | lowercase SHA-256 or null | Required for collected; null for not_requested and unavailable. |
| sourceArtifactSchemaVersion | bounded version string or null | Required for collected; null for not_requested; nullable for unavailable when the failed attempt produced no artifact. |
| adapterId | bounded identifier or null | Required for collected and unavailable; null for not_requested. |
| adapterVersion | bounded version string or null | Required for collected and unavailable; null for not_requested. |
| inputContractVersion | bounded version string or null | Required for collected and unavailable; null for not_requested. |
| collectedAt | canonical UTC timestamp or null | Must equal attestation completedAt for collected, attestation attemptedAt for unavailable, and null for not_requested. |
| recordCount | unsigned integer | Must equal both the number of bound record-set records for this source and the verified attestation projection count. |
| recordIdsSha256 | lowercase SHA-256 | Domain-separated hash of source plus sorted record IDs; must match both the bound source partition and verified attestation projection. |
| coverage | not-requested, unavailable, or source-specific coverage union | Builder-derived; caller cannot freely assert complete. |
| requiredOperationStatuses | fixed-order operation-status array | Exactly one derived complete, partial, or unknown entry for every planned required operation; empty for not_requested. |
| issueCodes | sorted unique neutral-code array | Empty for complete coverage; non-empty when partial or unknown requires explanation. |

The receipt groups provenance by source. It does not repeat source artifact hashes on every record.

Participation invariants:

- A not_requested plan entry requires participationStatus not_requested, recordCount zero, the
  canonical empty record-ID-set hash, null attestation/artifact/adapter fields, not_applicable
  coverage, empty requiredOperationStatuses, and no issue code.
- A requested plan entry requires participationStatus collected or unavailable.
- Collected permits recordCount zero or greater. A complete collection that legitimately returns
  zero records remains collected and may be complete when all source-specific completeness
  predicates hold. Exactly one verified sealed source attestation is required, and binding
  collectedAt must exactly equal its completedAt.
- Unavailable requires recordCount zero, the canonical empty record-ID-set hash,
  coverageKind unavailable with status unknown, and SOURCE_UNAVAILABLE. Its future sealed
  source attestation must be verified against bounded collection-attempt evidence, and binding
  collectedAt must exactly equal its attemptedAt. Every planned required operation has status
  unknown.
- The bound record set must contain zero records for not_requested and unavailable sources.
- Exactly five bindings are present. Binding omission cannot represent not requested, zero results,
  or collection failure.

## Sealed source collection attestations

Every requested source supplies exactly one sealed source collection attestation. A not_requested
source supplies none. The attestation is a validation companion and is never part of the suggestion
engine, model input, record-set bytes, or receipt bytes other than its detached hash.

The common sealed attestation envelope contains exactly:

| Field | Type | Rule |
| --- | --- | --- |
| schemaVersion | literal | Must equal the proposed source-attestation schema version. |
| source | source enum | Must equal the collection-plan entry and source binding. |
| requestedCollectionMode | frozen source-specific enum | Must equal the requested plan value and exact v0.1 mode table. |
| requiredOperations | fixed-order unique source-specific operation array | Must exactly equal the requested collection-plan operations. |
| privacyScopeHmacKeyVersion | bounded opaque version or null | Required when this attestation contains a privacy scope HMAC and must equal the receipt root; otherwise null. |
| privacyScopeHmacContextId | bounded opaque context ID or null | Required when this attestation contains a privacy scope HMAC, must equal the receipt root, and must resolve to the same approved case registration; otherwise null. |
| privacyScopeTokenCanonicalizationVersion | literal or null | Must equal blabase-scope-token-canonicalization-v0.1 and the receipt root when this attestation contains a privacy scope HMAC; otherwise null. |
| participationStatus | collected or unavailable | Must equal the derived source-binding status. |
| sourceArtifactSetSha256 | lowercase SHA-256 or null | Required for collected and verified against the supplied frozen artifact set; null for unavailable. |
| sourceArtifactSchemaVersion | bounded version string or null | Required for collected; nullable for unavailable when no artifact was produced. |
| adapterId | bounded identifier | Must identify the adapter that performed the collection attempt. |
| adapterVersion | bounded version string | Exact adapter behavior version. |
| inputContractVersion | bounded version string | Exact input contract consumed by the adapter. |
| projectedRecordCount | unsigned integer | Exact number of Common Suggestion Evidence records produced by the verified pinned projection; zero for unavailable. |
| projectedRecordIdsSha256 | lowercase SHA-256 | Existing record-ID-set domain hash of source plus sorted projected record IDs; canonical empty value for unavailable. |
| attemptedAt | canonical UTC timestamp | Required for collected and unavailable. |
| completedAt | canonical UTC timestamp or null | Required for collected; nullable for unavailable. Must not precede attemptedAt. |
| coverageEvidence | source-specific neutral evidence or unavailable evidence | Contains the predicates needed to derive coverage; a caller assertion of final status is not authoritative. |
| issueCodes | sorted unique neutral-code array | Must be derivable from verified coverage or failure evidence. |
| sourceCollectionAttestationSha256 | lowercase SHA-256 | Detached hash of every preceding attestation field. |

A source verification bundle is a private, runtime-only input containing the sealed attestation and
the frozen source artifact set needed to check a collected result, or bounded collection-attempt
evidence needed to check an unavailable result. When scope HMACs are present, it also supplies an
approved private key handle for the exact recorded key version; raw key bytes are not accepted as a
serializable field. Raw bundle payloads are never copied into the
receipt, record set, prompt, model input, logs, committed fixtures, or public failures.

For collected, the source-specific authoritative verifier must run the pinned adapter and input
contract over the supplied frozen artifact set to recompute the exact Common Suggestion Evidence
record projection. It validates the attested projection count and record-ID-set hash and returns the
verified projected records as a transient runtime result. For unavailable, it verifies the bounded
attempt evidence and derives the canonical zero-record projection.

The source-specific authoritative verifier must also validate the attestation hash, artifact-set
hash, adapter and input-contract versions, exact required operations, collection outcome,
operation-level coverage predicates, and neutral issue codes against that bundle. A detached hash
alone establishes only byte self-consistency; it does not authenticate an external source or prove
that collection occurred. The receipt builder and verifier derive source-binding values only from
an attestation that passes this authoritative source verification.

### Required-operation status aggregation

For a collected source, the authoritative verifier derives exactly one status for every planned
required operation. Overall source coverage is complete only when every required operation is
complete, unknown when any required operation is unknown, and otherwise partial. The overall
status, requiredOperationStatuses, and issueCodes are derived together; callers cannot assert or
override them. Record count, record absence, and success of one operation never prove another
operation complete.

### Operation status decision table

The verifier applies this table without fallback judgment. A verified mismatch, explicit gap, or
trustworthy incomplete result is partial. A structurally and integrally valid attested diagnostic
that proves required upstream evidence is missing, unavailable, unusable, or untrustworthy derives
unknown. Malformed receipt, attestation, manifest, or submitted verification input never derives a
coverage status.

| Source | Required operation | Complete | Partial | Unknown |
| --- | --- | --- | --- | --- |
| github | repository_scope_collection | Requested and observed scope hashes are trustworthy and equal. | Both hashes are trustworthy and unequal, proving a bounded scope mismatch. | Observed scope hash is absent or either scope claim is untrustworthy. |
| github | activity_pagination | `paginationStatus` is `complete`, pagination evidence and `coveredActivityIntervals` are trustworthy, `coveredActivityIntervals` is non-null, and its canonical union exactly equals `requestedActivityWindow`. | Pagination evidence and bounded-window evidence are trustworthy and non-null, and either `paginationStatus` is `partial` or the canonical interval union is a strict subset of the requested window, including an empty array or one or more gaps. | `paginationStatus` is `unknown`, pagination evidence is unavailable or untrustworthy, or `coveredActivityIntervals` is null or untrustworthy, regardless of a supplied `complete` or `partial` enum. Unknown takes precedence over partial. |
| codex | project_scope_collection | Requested and observed project hashes are trustworthy and equal. | Both hashes are trustworthy and unequal, proving a bounded project mismatch. | Observed project hash is absent or either scope claim is untrustworthy. |
| codex | conversation_collection | `conversationCollectionStatus` is `complete`, its collection attestation and `coveredConversationIntervals` are trustworthy, `coveredConversationIntervals` is non-null, and its canonical union exactly equals `requestedConversationWindow`. | Collection evidence and bounded-window evidence are trustworthy and non-null, and either `conversationCollectionStatus` is `partial` or the canonical interval union is a strict subset of the requested window, including an empty array or one or more gaps. | `conversationCollectionStatus` is `unavailable` or `unknown`, its collection attestation is untrustworthy, or `coveredConversationIntervals` is null or untrustworthy, regardless of a supplied `complete` or `partial` enum. Unknown takes precedence over partial. |
| google_calendar | event_window_collection | Verified covered-interval union exactly equals the requested window and timezoneContext is a verified canonical profile Zone. | Trustworthy intervals prove one or more explicit gaps inside the requested window and timezoneContext is a verified canonical profile Zone. | A valid attested diagnostic proves interval accounting or trustworthy Calendar timezone evidence is absent, unavailable, unusable, or untrustworthy; timezoneContext must be unknown when the timezone diagnostic is the cause. |
| notion | resource_scope_collection | Requested and observed resource-set hashes are trustworthy and equal. | Both hashes are trustworthy and unequal, proving a bounded resource-set mismatch. | Observed resource-set hash is absent or either scope claim is untrustworthy. |
| notion | resource_pagination | paginationStatus is complete and its pagination evidence is trustworthy. | paginationStatus is partial and its bounded collected subset evidence is trustworthy. | paginationStatus is unknown, or structurally valid pagination evidence is unavailable or untrustworthy, regardless of a supplied complete or partial enum. |
| dayflow | capture_window_collection | Verified interval union exactly equals the requested window and the capture artifact-set hash is trustworthy. | Trustworthy intervals and artifact binding prove one or more explicit capture gaps. | A valid attested diagnostic proves interval accounting or capture artifact binding is absent, unavailable, unusable, or untrustworthy. |
| dayflow | privacy_ocr_preprocessing | accountingKind is known, every eligible capture is processed, all required input/output manifest hashes and versions match, and no bounded verified preprocessing failure exists. | accountingKind is known, accounting is trustworthy, and within that known accounting either processedCaptureCount is less than eligibleCaptureCount or a bounded verified preprocessing failure exists; verified failure takes precedence over otherwise complete counts. | accountingKind is unknown and a valid attested diagnostic proves accounting or required input/output evidence is absent, unavailable, unusable, or untrustworthy; this result takes precedence over every other preprocessing diagnostic. |

For a planned pagination operation, paginationStatus not_applicable is invalid. When pagination is
not a required operation, it has no requiredOperationStatuses entry and its source-specific
paginationStatus must be not_applicable. Operation statuses and verified diagnostics produce the
exact source-level issue-code set through the derivation table below; callers and implementations
cannot choose an alternative applicable code.

For GitHub and Notion pagination, the authoritative verifier evaluates evidence trustworthiness
before accepting paginationStatus. Structurally valid but unavailable or untrustworthy pagination
evidence always derives unknown; a caller-supplied complete or partial enum cannot override it.

### Integrity-before-coverage decision order

1. Validate receipt, record set, sealed attestation, runtime verification input, and manifest
   structure, resource limits, canonical values, detached hashes, artifact bindings, and required
   integrity invariants. Any failure produces no sealed receipt.
2. Only after integrity succeeds, validate the sealed neutral diagnostic against bounded upstream
   attempt evidence. A valid diagnostic may classify unavailable, unusable, or untrustworthy
   upstream evidence as unknown without copying the raw error payload.
3. Derive each required operation status through the decision table, then derive issue codes and
   aggregate source coverage.

A malformed submitted artifact, inconsistent manifest, hash mismatch, invalid interval, or forged
diagnostic cannot be converted into COVERAGE_UNKNOWN or any other valid partial-evidence result.
UPSTREAM_ERROR_REPORTED may support unknown only when the authoritative verifier validates the
structurally sound sealed diagnostic and its bounded attempt evidence.

## Source-specific coverage union

### Not-requested coverage

- coverageKind: not_requested.
- status: not_applicable.

This coverage variant is valid only when the collection plan and participation status are both
not_requested and the source has zero bound records.

### Unavailable coverage

- coverageKind: unavailable.
- status: unknown.

This coverage variant is valid only when the collection plan is requested, participationStatus is
unavailable, and the source has zero bound records. It contains no observed scope, interval,
preprocessing, verifier, evidence-hash, or other collection-result field. SOURCE_UNAVAILABLE is
required; no other issue code is required by this variant. The sealed source attestation must be
verified against bounded collection-attempt evidence without exposing its raw error payload.

### GitHub coverage

- coverageKind: github_scope.
- status: complete, partial, or unknown.
- requestedRepositoryScopeHmacSha256: 64-character lowercase hexadecimal private context-bound HMAC of the requested repository scope.
- observedRepositoryScopeHmacSha256: nullable 64-character lowercase hexadecimal private context-bound HMAC of the scope actually returned.
- paginationStatus: complete, partial, not_applicable, or unknown.
- requestedActivityWindow: nullable half-open UTC interval copied from the frozen collection request.
- coveredActivityIntervals: nullable canonical array of verified half-open UTC intervals actually covered by collection.

Complete, partial, and unknown are derived only through the operation status decision table.
repository_scope_collection is derived from the scope comparison. activity_pagination is derived
jointly from paginationStatus and the bounded-window proof below and must be not_applicable only
when that operation is absent from the plan.
observedRepositoryScopeHmacSha256 null is valid only when repository_scope_collection is unknown with
an applicable neutral issue code; null can never support complete or partial.

### Codex coverage

- coverageKind: codex_collection.
- status: complete, partial, or unknown.
- requestedProjectScopeHmacSha256: 64-character lowercase hexadecimal private context-bound HMAC of the requested project scope.
- observedProjectScopeHmacSha256: nullable 64-character lowercase hexadecimal private context-bound HMAC of the observed project scope.
- conversationCollectionStatus: complete, partial, unavailable, or unknown.
- requestedConversationWindow: half-open UTC interval copied from the frozen collection request.
- coveredConversationIntervals: nullable canonical array of verified half-open UTC intervals actually covered by collection.

Complete, partial, and unknown are derived only through the operation status decision table. A
project overview or record count alone cannot prove completeness.
project_scope_collection is derived from the scope comparison; conversation_collection is derived
jointly from conversationCollectionStatus and the bounded-window proof below.

### Bounded collection-window proof

Version 0.1 supports only bounded collection windows for GitHub activity and Codex conversations;
it has no null, unbounded, all-history, default, or implicit-current-time extent. The private
verification bundle independently binds the requested window from the frozen collection request
and the covered intervals from the authoritative returned source artifact. The serialized requested
window must equal the privately bound request byte-for-byte after the contract timestamp grammar is
applied. An implementation must never infer the requested window from returned records or copy the
requested window into the covered intervals.

Each requested window has `start < end`. A non-null covered-interval array contains 0..1,024
intervals, each has `start < end`, and every interval lies wholly within the requested window. The
array is already canonical: ascending by start and then end, with no overlap or adjacency; adjacent
or overlapping intervals must be merged before serialization. Null means the covered extent is
missing or untrustworthy. An empty array means trustworthy evidence that none of the requested
window was covered. Event or conversation timestamps do not prove window coverage; coverage comes
only from the verified source collection artifact and attestation.

For GitHub `repository_activity`, `requestedActivityWindow` is non-null and
`coveredActivityIntervals` is evaluated jointly with `paginationStatus`. The verifier applies this
precedence exactly:

1. Derive `unknown` when pagination evidence is unavailable or untrustworthy,
   `paginationStatus` is `unknown`, or `coveredActivityIntervals` is null or untrustworthy.
2. Otherwise derive `partial` when `paginationStatus` is `partial` or the trustworthy canonical
   interval union is a strict subset of `requestedActivityWindow`, including an empty array or one
   or more gaps.
3. Otherwise derive `complete` only when `paginationStatus` is `complete` and the trustworthy
   canonical interval union exactly equals `requestedActivityWindow`.

For GitHub `repository_scope`, `requestedActivityWindow` and `coveredActivityIntervals` are null and
`paginationStatus` is `not_applicable`.

For Codex `project_conversations`, `requestedConversationWindow` is required and
`coveredConversationIntervals` is evaluated jointly with `conversationCollectionStatus`. The
verifier applies this precedence exactly:

1. Derive `unknown` when `conversationCollectionStatus` is `unavailable` or `unknown`, its
   collection attestation is untrustworthy, or `coveredConversationIntervals` is null or
   untrustworthy.
2. Otherwise derive `partial` when `conversationCollectionStatus` is `partial` or the trustworthy
   canonical interval union is a strict subset of `requestedConversationWindow`, including an empty
   array or one or more gaps.
3. Otherwise derive `complete` only when `conversationCollectionStatus` is `complete` and the
   trustworthy canonical interval union exactly equals `requestedConversationWindow`.

A base `partial` status remains partial even when the requested window is fully covered. A null or
untrustworthy covered extent takes precedence and derives `unknown`. Codex `unavailable` always
derives `unknown` and can never support complete.

Base-status and bounded-window issue-code predicates are evaluated independently before exact set
union:

- A trustworthy base partial with full window coverage contributes only its existing base-status
  code.
- A base complete with a trustworthy window gap or empty covered extent contributes `WINDOW_GAP`.
- A base partial plus a trustworthy window gap or empty covered extent contributes both its existing
  base-status code and `WINDOW_GAP`.
- A null or untrustworthy covered extent contributes `COVERAGE_UNKNOWN`; any independently verified
  base-partial or window-gap predicate still contributes its own code.
- A complete operation contributes none of these codes.

The final issue-code array remains the deduplicated runtime-ASCII-sorted exact set union required by
this contract.

### Google Calendar coverage

- coverageKind: calendar_window.
- status: complete, partial, or unknown.
- requestedWindow: required half-open UTC interval.
- coveredIntervals: ordered, non-overlapping half-open UTC intervals.
- timezoneDatabaseVersion: exact literal 2026c.
- timezoneDatabaseReleaseSha512: exact pinned tzdata2026c.tar.gz SHA-512 from Artifact identity.
- timezoneDatabaseProfileVersion: exact literal blabase-tzdb-profile-2026c-v1.
- timezoneDatabaseProfileSha256: lowercase SHA-256 of the exact frozen project profile bytes.
- timezoneContext: exact literal unknown or canonical Zone member of the frozen profile allowlist.

The operation status decision table derives event_window_collection from the verified interval
union. It is the only complete, partial, or unknown decision rule for this coverage variant.

The project profile is generated only from the pinned tzdata2026c.tar.gz release after its exact
SHA-512 is verified. It contains a case-sensitive canonical Zone allowlist and a Link-alias map.
Input aliases are resolved through the frozen Link map until one canonical Zone target remains; the
receipt serializes only that target. UTC must normalize to Etc/UTC and GMT to Etc/GMT. A canonical
Factory value is accepted only if it is a Zone member in the frozen profile. Empty components,
single-dot or double-dot components, alias cycles, unknown names, wrong case, and values absent from
the profile fail closed.

timezoneContext unknown is a separate conservative branch, not an allowlist member. It is valid
only when the authoritative Calendar verifier validates a structurally sound sealed diagnostic
against bounded source evidence proving that trustworthy Calendar timezone evidence is absent,
unavailable, unusable, or untrustworthy. That branch must derive
event_window_collection unknown, aggregate Calendar coverage unknown, and the exact
COVERAGE_UNKNOWN issue code. Caller assertion, missing fields, parse failure, or an unregistered
timezone string cannot produce the unknown branch.

The host OS zoneinfo database, JavaScript Intl or ICU result, PATH lookup, environment variable,
network lookup, and a newer or older TZDB release are not authoritative substitutes. The Calendar
source verification bundle must bind the exact frozen profile bytes, and the verifier must match
their SHA-256 to timezoneDatabaseProfileSha256 and to the single approved profile hash before
timezone membership or alias normalization succeeds.

### Notion coverage

- coverageKind: notion_resource_scope.
- status: complete, partial, or unknown.
- requestedResourceSetHmacSha256: 64-character lowercase hexadecimal private context-bound HMAC of the explicitly bound resource set.
- observedResourceSetHmacSha256: nullable 64-character lowercase hexadecimal private context-bound HMAC of the resources actually read.
- paginationStatus: complete, partial, not_applicable, or unknown.

Complete, partial, and unknown are derived only through the operation status decision table. The
receipt never claims workspace-wide Notion coverage.
resource_scope_collection is derived from the resource-set comparison. resource_pagination is
derived from paginationStatus and must be not_applicable only when that operation is absent from
the plan.

### Dayflow coverage

- coverageKind: dayflow_capture_and_preprocessing.
- status: complete, partial, or unknown, aggregated from both mandatory operations.
- captureCoverage:
  - status: complete, partial, or unknown.
  - requestedWindow: required half-open UTC capture interval.
  - coveredIntervals: ordered, non-overlapping half-open UTC intervals.
  - captureArtifactSetSha256: lowercase SHA-256 of the verified captured artifact set.
- preprocessingCoverage:
  - status: complete, partial, or unknown.
  - inputCaptureArtifactSetSha256: lowercase SHA-256 that must exactly equal
    captureCoverage.captureArtifactSetSha256.
  - accounting: known or unknown discriminated union defined below.
  - preprocessingVersion: bounded version string containing the exact privacy/OCR preprocessing
    behavior version.
  - verifierVersion: bounded version string containing the exact Stage 1-9 verifier behavior
    version.
  - preprocessingEvidenceSha256: lowercase SHA-256 of the verified neutral preprocessed evidence
    artifact set; it must exactly equal both the sealed attestation and source binding
    sourceArtifactSetSha256.

The preprocessing accounting union is exact:

| accountingKind | Fields | Rule |
| --- | --- | --- |
| known | eligibleCaptureCount, processedCaptureCount | Both are unsigned integers derived from trustworthy manifest accounting; processedCaptureCount must not exceed eligibleCaptureCount. |
| unknown | no additional fields | Count fields are forbidden, preprocessingCoverage.status must be unknown, and an applicable neutral issue code plus verified diagnostic is required. |

Known zero eligible and zero processed captures is distinct from unknown accounting. It may support
complete only when the authoritative verifier confirms that zero captures were privacy-eligible and
all other input/output manifest, hash, and version predicates pass with no bounded verified
preprocessing failure. Unknown accounting can never support complete or partial. A bounded
preprocessing failure diagnostic does not change unknown accounting to partial; partial exists only
inside the known, trustworthy accounting branch.

Within known accounting, the verifier evaluates bounded preprocessing failures before complete.
Any verified bounded failure derives partial even when processedCaptureCount equals
eligibleCaptureCount and every hash or version matches. Complete is considered only when no such
failure exists.

capture_window_collection is complete only when verified covered intervals exactly cover the
requested capture window and the captured artifact set is bound. privacy_ocr_preprocessing is
complete only when the verified preprocessing input hash equals the captured artifact-set hash,
accountingKind is known, processedCaptureCount equals eligibleCaptureCount, and the neutral output
artifact-set hash exactly equals the attestation and binding sourceArtifactSetSha256. For Dayflow,
preprocessingEvidenceSha256 is not a second independent hash: it names the same frozen neutral
output artifact set used by the pinned adapter to recompute the exact Common Suggestion Evidence
record projection.

The authoritative Dayflow verifier must also validate a preprocessing manifest in the private
source verification bundle. That manifest binds the exact captureArtifactSetSha256 as input, the
pinned preprocessingVersion and verifierVersion, and the exact preprocessingEvidenceSha256 as
output. Some but not all eligible captures processed is partial; absent trustworthy input
accounting is unknown. Capture completeness never implies preprocessing completeness,
preprocessing success never fills a capture-window gap, and OCR text volume proves neither
operation complete.

## Neutral issue codes

The proposal permits only coverage and collection diagnostics, never suggestion semantics:

- SOURCE_UNAVAILABLE
- COVERAGE_UNKNOWN
- SCOPE_PARTIAL
- PAGINATION_INCOMPLETE
- WINDOW_GAP
- COLLECTION_PARTIAL
- PREPROCESSING_PARTIAL
- UPSTREAM_ERROR_REPORTED

### Exact issue-code derivation

The authoritative verifier evaluates every row and takes the set union of all codes whose verified
predicate is true. It then removes duplicates and sorts the exact set with runtime ASCII ordering.
No triggered code may be omitted and no untriggered code may be added.

| Verified predicate | Exact code contributed |
| --- | --- |
| participationStatus is unavailable | SOURCE_UNAVAILABLE |
| A collected operation is unknown because a valid diagnostic proves required pagination, collection, or bounded-window extent evidence absent, unavailable, unusable, or untrustworthy | COVERAGE_UNKNOWN |
| github.repository_scope_collection, codex.project_scope_collection, or notion.resource_scope_collection is partial because trustworthy requested and observed scope hashes differ | SCOPE_PARTIAL |
| `github.activity_pagination` has trustworthy pagination evidence and its base `paginationStatus` is `partial` | PAGINATION_INCOMPLETE |
| `notion.resource_pagination` is partial | PAGINATION_INCOMPLETE |
| `github.activity_pagination` or `codex.conversation_collection` has trustworthy bounded-window evidence whose canonical union proves a strict subset, one or more gaps, or an empty covered extent inside its requested window | WINDOW_GAP |
| `google_calendar.event_window_collection` or `dayflow.capture_window_collection` is partial because trustworthy intervals prove a gap | WINDOW_GAP |
| `codex.conversation_collection` has trustworthy collection evidence and its base `conversationCollectionStatus` is `partial` | COLLECTION_PARTIAL |
| dayflow.privacy_ocr_preprocessing is partial | PREPROCESSING_PARTIAL |
| A structurally valid sealed diagnostic verified against bounded attempt evidence reports an upstream error that directly causes or explains at least one required operation's partial or unknown status | UPSTREAM_ERROR_REPORTED |

SOURCE_UNAVAILABLE is the base unknown reason for an unavailable source and suppresses the generic
COVERAGE_UNKNOWN contribution for operation statuses that are unknown solely because the whole
source is unavailable. UPSTREAM_ERROR_REPORTED is additive only when its verified error directly
causes or explains a partial or unknown required operation. A recovered, non-impacting upstream
error that leaves every required operation complete is excluded from the sealed lineage diagnostic
and receipt issueCodes; it may remain only in an approved private operational channel. A collected
source may contribute multiple partial or unknown reason codes when distinct required operations
independently satisfy multiple table rows.

A complete binding and a not_requested binding have an empty issueCodes array. A partial or unknown
collected binding has at least one code derived by the table. The sealed attestation and receipt
binding must contain the same exact derived array.

## Valid partial evidence versus invalid lineage

The following may produce a valid sealed receipt with partial or unknown coverage:

- A requested source is collected successfully and legitimately returns zero records.
- A source is temporarily unavailable but the failure is explicitly attested.
- Pagination is incomplete.
- A requested time window contains explicit gaps.
- Codex conversation collection is partial or unavailable.
- Dayflow preprocessing reports partial neutral coverage without an integrity mismatch.

The following fail closed and produce no sealed receipt:

- The supplied record set is structurally or authoritatively invalid.
- The receipt record-set hash or asOf does not match the bound record set.
- The collection plan does not contain exactly one entry for every v0.1 source.
- A collection-plan entry lacks exactly one corresponding source binding.
- requestStatus and participationStatus are inconsistent.
- requiredOperations is missing, contains an unknown, duplicate, out-of-order, cross-source, or
  mode-incompatible operation, or differs among plan, attestation, and binding status entries.
- requestedCollectionMode is not an exact source-specific v0.1 enum, its derived requiredOperations
  differs from the frozen mapping, or a not_requested source supplies a mode or operation.
- A privacy scope token canonicalization version is absent or mismatched; a mode-to-operation
  mapping differs from the frozen table; a source identifier object, normalization, JCS bytes,
  unpadded base64url token, sorting, or uniqueness rule differs from
  blabase-scope-token-canonicalization-v0.1; or requested and observed scopes use different rules.
- A not_requested or unavailable source has one or more bound records.
- recordCount or recordIdsSha256 does not match the bound source partition.
- A present source artifact hash or version is malformed.
- A collected binding omits its required source artifact hash, source artifact schema version,
  adapter ID, adapter version, input contract version, or collectedAt timestamp.
- A requested source lacks exactly one source verification bundle, its sealed attestation is
  invalid, or its verified attestation hash and derived fields do not match the source binding.
- The verified projected records do not exactly equal the Stage 2 bound source partition, or their
  projectedRecordCount or projectedRecordIdsSha256 differs from the receipt binding.
- A collected binding's collectedAt differs from the verified attestation completedAt, or an
  unavailable binding's collectedAt differs from the verified attestation attemptedAt.
- requiredOperationStatuses does not contain exactly one correctly derived entry per planned
  operation, an entry differs from the operation status decision table, its issue code is
  incompatible, or the aggregate coverage status does not follow the required aggregation rule.
- issueCodes omits any code triggered by the exact derivation table, includes an untriggered code,
  differs between the verified sealed attestation and receipt binding, contains duplicates, or is
  not in runtime ASCII order.
- UPSTREAM_ERROR_REPORTED is present without a verified causal or explanatory partial/unknown
  operation, or is omitted when such a verified upstream error directly explains that status.
- GitHub observedRepositoryScopeHmacSha256 is null while repository_scope_collection is complete or
  partial, or is present but malformed.
- A privacy scope digest uses an unkeyed hash, the recorded key version or context is absent or
  mismatched, the supplied private key handle cannot verify the HMAC, or a scope HMAC appears when
  both root privacy HMAC fields are null.
- A privacy scope HMAC is not exactly 64 lowercase hexadecimal characters matching
  ^[0-9a-f]{64}$, including uppercase hexadecimal, base64, base64url, padding, or alternate-length
  encodings.
- A privacy scope context is caller-minted, unregistered, revoked, expired, reused across unrelated
  cases, or presented outside the exact frozen evaluation case registered for it.
- Any scalar, timestamp, integer, interval, array, graph, string, UTF-8, JCS, preimage, serialized
  byte, trailing-LF, or detached-hash formula differs from the exact wire and cap rules above.
- Calendar timezone metadata does not match the pinned 2026c release, release SHA-512, profile
  version, or approved profile SHA-256; a non-unknown timezoneContext is an unnormalized alias, is
  absent from the canonical profile allowlist, contains an empty, dot, or double-dot component, or
  is accepted from an OS, ICU, environment, network, or unpinned TZDB source; or timezoneContext is
  unknown without the required verified diagnostic, unknown operation status, aggregate unknown
  status, and exact COVERAGE_UNKNOWN issue code.
- GitHub or Notion pagination is reported complete or partial without trustworthy supporting
  pagination evidence, or an untrustworthy result is not derived as unknown.
- For Dayflow, preprocessing input hash differs from captureArtifactSetSha256,
  preprocessingEvidenceSha256 differs from either the attestation or binding
  sourceArtifactSetSha256, the verified preprocessing manifest does not bind that exact input,
  pinned behavior, and output chain, known accounting counts are invalid or inconsistent, unknown
  accounting contains count fields or supports a non-unknown status, or either nested status is
  unsupported by its independent evidence.
- Dayflow privacy_ocr_preprocessing is reported complete while a bounded verified preprocessing
  failure exists.
- A not_requested source supplies a source attestation or source verification bundle.
- Coverage intervals are invalid, overlapping, unsorted, outside the requested window, or over cap.
- Caller-supplied complete status is not supported by the source-specific attestation.
- The detached receipt hash is wrong.
- A malformed receipt, record set, attestation, verification input, manifest, hash binding, or
  integrity invariant is reclassified as partial or unknown instead of failing closed before
  coverage derivation.
- Unknown fields, accessors, proxies, shared references, sparse arrays, or resource-limit violations
  are present.

Partial coverage is evidence quality information. An integrity or binding mismatch is artifact
invalidity. They are not interchangeable.

## Determinism and canonicalization

- Source bindings serialize in the fixed order github, codex, google_calendar, notion, dayflow.
- The collection plan and source bindings both contain all five v0.1 sources in that fixed order.
- A source absent from the record set still has a binding that explicitly distinguishes
  not_requested, collected with zero records, and unavailable.
- Record IDs are sorted with runtime ASCII ordering before the record-ID-set hash is computed.
- Coverage intervals sort by start then end and must be non-overlapping.
- Required operations and required-operation statuses use each source's fixed v0.1 order.
- Issue codes use runtime ASCII ordering and must be unique.
- Detached hashing uses the exact domain, zero-byte separator, RFC 8785 JCS preimage, field
  exclusion, and lowercase-hex formulas above, with no serialization LF in the preimage.
- Serialization is validated RFC 8785 JCS followed by exactly one LF and must satisfy the exact
  artifact byte cap including that LF.
- Success objects and nested collections are deeply frozen.
- Public failures expose only bounded issue codes, not source payloads or underlying exceptions.

## Frozen public implementation surface

Stage10-1A.2b is structural and orchestration-only. It may implement only:

- commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(input)
- inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(input)
- planCommonSuggestionEvidenceLineageSourceVerificationV0_1(receipt, recordSet, sourceVerificationBundles)

The intrinsic inspector may report only Stage 1 structural, resource, canonical-value, and detached
hash self-consistency results. The verification planner may validate orchestration shape and report
which source-specific verifier is required, but it cannot mark a receipt, record-set binding,
attestation, provenance claim, or coverage claim authoritative.

Stage10-1A.2b must not export a successful build-and-seal, authoritative verify, or receipt
serialize path. When a requested source lacks an implemented authoritative source verifier, the
orchestration path fails closed with SOURCE_VERIFIER_UNAVAILABLE. Stage-local success types must
not be accepted as, cast to, or serialized as an authoritative receipt.

The following full APIs remain activation targets only after Stage10-2 supplies every required
source-specific authoritative verifier and projection implementation and every private HMAC
lifecycle prerequisite in this contract is implemented and validated and the pinned timezone
profile artifact is created, independently verified, hash-frozen, and available:

- buildAndSealCommonSuggestionEvidenceLineageReceiptV0_1(recordSet, collectionPlan, sourceVerificationBundles)
- verifyCommonSuggestionEvidenceLineageReceiptV0_1(receipt, recordSet, sourceVerificationBundles)
- serializeCommonSuggestionEvidenceLineageReceiptV0_1(receipt, recordSet, sourceVerificationBundles)

The builder, authoritative verifier, and serializer require the bound record set and the exact
source verification bundles for every requested source. No two-argument authoritative verification
path exists. Intrinsic receipt validation can check detached-hash self-consistency only; it cannot
establish record membership, source provenance, coverage truth, or external authenticity.

## Authoritative three-stage verification

After Stage10-2 activation, the authoritative builder, verifier, and serializer execute these
fail-closed stages in order:

1. Intrinsic receipt stage: enforce structural schema, resource caps, exact source order, canonical
   values, unknown-input hardening, and detached receipt-hash self-consistency.
2. Record-set binding stage: authoritatively verify the supplied record set, then match its hash,
   asOf, source partitions, record counts, and record-ID-set hashes to the receipt.
3. Source-attestation stage: require exactly one source verification bundle for every requested
   source and none for not_requested sources; run the source-specific authoritative verifier; then
   exactly compare its transient recomputed record projection with the Stage 2 bound source
   partition and match the verified projection count and record-ID-set hash, attestation hash,
   participation outcome, collectedAt mapping, provenance, coverage, and issue codes to the receipt
   binding. When privacy scope HMACs are present, this stage first validates the registered
   case-bound context, exact key-version lifecycle state, restricted key handle, exact token
   canonicalization version, and source token derivation before HMAC comparison. For Google
   Calendar, it validates the pinned timezone release and approved frozen profile hash before
   timezone membership, alias normalization, or coverage interpretation.

Success is returned only after all three stages pass. A structural parse, receipt hash match,
record-set match, or sealed-attestation hash match alone is never an authoritative success. The
deterministic single-code failure-selection table below is authoritative for every public builder,
verifier, and serializer invocation.

Within the source-attestation stage, structure, resource, hash, manifest, artifact-binding, privacy
context and key, source-specific integrity, and projection-binding validation precede
operation-status and coverage classification.

## Frozen failure codes

- INPUT_INVALID
- RESOURCE_LIMIT_EXCEEDED
- RECORD_SET_BINDING_MISMATCH
- SOURCE_BINDING_INVALID
- SOURCE_ATTESTATION_INVALID
- SOURCE_ATTESTATION_BINDING_MISMATCH
- SOURCE_VERIFIER_UNAVAILABLE
- PRIVACY_SCOPE_DIGEST_INVALID
- PRIVACY_SCOPE_KEY_UNAVAILABLE
- PRIVACY_SCOPE_CONTEXT_INVALID
- SCOPE_TOKEN_CANONICALIZATION_INVALID
- TIMEZONE_PROFILE_INVALID
- RECORD_ID_SET_MISMATCH
- COVERAGE_INVALID
- HASH_MISMATCH

### Deterministic single-code failure selection

A failed public invocation returns exactly one `failureCode` from the exact enum above. It never
returns a set, source-specific payload, raw diagnostic, private value, underlying exception, path,
or discovered predicate.

Stages retain the frozen order `intrinsic receipt` -> `record-set binding` ->
`source attestation`. When one or more applicable predicates fail in a stage, no downstream stage
is executed. The verifier evaluates every safely applicable sanitized predicate in that failing
stage, collects its candidate failure codes, and returns the first candidate in that stage's frozen
order below. It must not return the first failure encountered during traversal, source iteration,
hashing, registry access, or verifier execution.

A predicate whose structural or integrity prerequisite did not succeed is not applicable and must
not be evaluated by invoking unsafe input behavior or consuming unverified downstream data. This
prerequisite rule cannot be used to skip an independently evaluable earlier-priority predicate.

| Stage | Frozen in-stage failure-code order |
| --- | --- |
| 1. Intrinsic receipt | `RESOURCE_LIMIT_EXCEEDED` -> `INPUT_INVALID` -> `SOURCE_BINDING_INVALID` -> `HASH_MISMATCH` |
| 2. Record-set binding | `RESOURCE_LIMIT_EXCEEDED` -> `INPUT_INVALID` -> `HASH_MISMATCH` -> `RECORD_SET_BINDING_MISMATCH` -> `RECORD_ID_SET_MISMATCH` |
| 3. Source attestation | `RESOURCE_LIMIT_EXCEEDED` -> `INPUT_INVALID` -> `SOURCE_BINDING_INVALID` -> `SOURCE_ATTESTATION_INVALID` -> `HASH_MISMATCH` -> `SOURCE_VERIFIER_UNAVAILABLE` -> `PRIVACY_SCOPE_CONTEXT_INVALID` -> `PRIVACY_SCOPE_KEY_UNAVAILABLE` -> `SCOPE_TOKEN_CANONICALIZATION_INVALID` -> `PRIVACY_SCOPE_DIGEST_INVALID` -> `TIMEZONE_PROFILE_INVALID` -> `SOURCE_ATTESTATION_BINDING_MISMATCH` -> `RECORD_ID_SET_MISMATCH` -> `COVERAGE_INVALID` |

The stage-specific meanings are exact:

| Failure code | Applicable stage predicate |
| --- | --- |
| `RESOURCE_LIMIT_EXCEEDED` | A current-stage input exceeds an authoritative graph, collection, string, preimage, or serialized-byte cap before canonicalization or hashing. |
| `INPUT_INVALID` | A safely bounded current-stage input violates plain-data, schema, scalar, canonical-value, unknown-key, accessor, proxy, shared-reference, sparse-array, or required-field rules not assigned a more specific code below. |
| `SOURCE_BINDING_INVALID` | Receipt plan/binding shape, fixed source order, participation, required-operation, bundle presence, or not-requested/requested source invariant is invalid. |
| `HASH_MISMATCH` | The current stage's intrinsically checkable detached or sealed artifact hash is malformed or does not match its exact frozen preimage. |
| `RECORD_SET_BINDING_MISMATCH` | Every applicable per-source `recordCount` and domain-separated sorted record-ID-set binding matches, but the valid authoritative record set disagrees with the receipt root hash, `asOf`, fixed source presence or partition membership, or a same-ID record-content root binding. This predicate excludes every per-source count and record-ID-set mismatch. |
| `RECORD_ID_SET_MISMATCH` | At Stage 2, an authoritative per-source partition disagrees with its receipt binding's `recordCount` or domain-separated sorted record-ID-set hash. At Stage 3, a transient source projection disagrees with the applicable verified attestation or receipt count or record-ID-set binding. This predicate excludes root-only, provenance, and same-ID record-content mismatches. |
| `SOURCE_ATTESTATION_INVALID` | A requested source attestation or its required private verification input is structurally, canonically, or intrinsically invalid. |
| `SOURCE_VERIFIER_UNAVAILABLE` | Required source-verifier implementation or authoritative verifier capability is unavailable after required orchestration inputs pass structural checks. |
| `PRIVACY_SCOPE_CONTEXT_INVALID` | A required context-registry snapshot or registration is absent, unavailable, internally inconsistent, caller-minted, malformed, non-ordered, mismatched, expired, revoked, or unauthorized for the frozen case. |
| `PRIVACY_SCOPE_KEY_UNAVAILABLE` | A required key-lifecycle snapshot, exact registered key-version record, or restricted key handle is absent, unavailable, internally inconsistent, malformed, non-ordered, expired, revoked, deleted, mismatched, or substituted. |
| `SCOPE_TOKEN_CANONICALIZATION_INVALID` | A required source identifier, canonicalization version, identifier object, JCS token, base64url encoding, ordering, or uniqueness rule is invalid. |
| `PRIVACY_SCOPE_DIGEST_INVALID` | Context, key, and canonical token prerequisites are valid, but the recomputed private scope HMAC does not equal the sealed digest. |
| `TIMEZONE_PROFILE_INVALID` | A required timezone-profile snapshot is absent, unavailable, or internally inconsistent, or Calendar's pinned release, release hash, profile version, profile hash, canonical membership, or alias normalization is invalid. |
| `SOURCE_ATTESTATION_BINDING_MISMATCH` | Every applicable source count and record-ID-set binding matches, but a verified attestation's non-coverage provenance, participation, collection-time, artifact, adapter, manifest, or same-ID transient projection record-content binding disagrees with the plan or receipt binding. This predicate excludes every count and record-ID-set mismatch. |
| `COVERAGE_INVALID` | All required structural, resource, hash, provenance, privacy, timezone, and projection predicates pass, but operation status, aggregation, issue-code derivation, or source-specific coverage semantics are invalid. |

For identical receipt, record set, source verification bundles, verifier versions, key material, and
one immutable registry, key, and profile snapshot, every compliant implementation must select the
same public failure code.

Immediately before Stage 3, the authoritative verifier obtains exactly one
`verificationStartedAt` from the approved UTC clock. `verificationStartedAt` must satisfy the
contract's canonical UTC timestamp grammar. At that same boundary it obtains one immutable,
internally consistent snapshot of the committed context-registry state, key-version lifecycle state,
restricted key handles, and pinned timezone-profile state required by the invocation.

The verifier must use that single `verificationStartedAt` and snapshot for every Stage 3 lifecycle,
authorization, HMAC, and profile decision. It must not reread wall-clock time, registry state, key
state, revocation state, deletion state, or profile state during the invocation. If the verifier
cannot obtain every required component at that boundary, it fails closed before HMAC or coverage
interpretation. An absent, unavailable, malformed, or internally inconsistent context-registry
component contributes `PRIVACY_SCOPE_CONTEXT_INVALID`; the corresponding key-lifecycle component
or restricted handle contributes `PRIVACY_SCOPE_KEY_UNAVAILABLE`; and a required timezone-profile
component contributes `TIMEZONE_PROFILE_INVALID`. Each applicable failed component contributes its
candidate independently. When multiple candidates exist, the existing frozen Stage 3 order selects
the single public `failureCode`; discovery order and the component queried first have no effect.

The chosen code is the only public diagnostic. Raw source errors, failed values, private identifiers,
HMAC material, registry records, source paths, and exception messages remain private and are neither
serialized nor returned.

## Privacy and retention

- Identifier-derived GitHub repository, Codex project, and Notion resource scopes appear only as
  approved private context-bound HMAC-SHA-256 digests. Unkeyed scope hashes are forbidden.
- No raw repository, workspace, account, event, page, conversation, screenshot, or filesystem
  identifier is stored in the receipt.
- No OCR text or screenshot bytes are stored in the receipt.
- Synthetic receipts may be committed only when their fixtures are fictional.
- Future live receipts remain private evaluation artifacts under the approved local/private store
  and retention policy.
- Source verification bundles and their raw artifact or attempt-evidence payloads are transient
  private inputs; they are never serialized into the receipt, exposed to the model, or committed.
- Hashes are lineage bindings, not proof that re-identification risk is zero.

### Private scope HMAC construction

The verifier computes each scope digest as HMAC-SHA-256 over the UTF-8 JCS bytes of exactly:

```json
{
  "domain": "blabase.lineage.private-scope.v0.1",
  "contextId": "<privacyScopeHmacContextId>",
  "source": "<github|codex|notion>",
  "scopeKind": "<repository_scope|project_scope|resource_set>",
  "tokenCanonicalizationVersion": "blabase-scope-token-canonicalization-v0.1",
  "canonicalTokens": ["<sorted unique source-normalized token>"]
}
```

The 32-byte HMAC result is encoded as exactly 64 lowercase hexadecimal characters matching
^[0-9a-f]{64}$. Base64, base64url, uppercase hexadecimal, prefixes, separators, and padding are
forbidden. The encoded string, not raw bytes or an alternate encoding, is the canonical field value
included in JCS receipt and attestation hashing.

The source adapter creates canonicalTokens transiently from the minimum identifiers required for
the requested scope. Each token is unpadded RFC 4648 base64url of the UTF-8 RFC 8785 JCS bytes of
the exact source identifier object below. Token strings match ^[A-Za-z0-9_-]+$, sort with runtime
ASCII ordering, and are unique. Padding, standard base64 characters, alternate object fields, and
caller-provided prebuilt tokens are invalid.

| Source | Exact identifier object and input normalization |
| --- | --- |
| github | {"host": canonicalHost, "repositoryDatabaseId": canonicalDecimalId}. canonicalHost is an ASCII DNS name lowercased after removing at most one trailing dot; each label is 1-63 characters, uses only a-z, 0-9, or interior hyphen, and the whole host is at most 253 bytes. Scheme, port, path, userinfo, empty labels, and non-ASCII hosts are invalid in v0.1. repositoryDatabaseId is a positive unsigned decimal string with no leading zero and at most 20 digits. Owner and repository names are not identity inputs. |
| codex | {"lexicalProjectKey": exactPath, "pathFlavor": "posix"}. exactPath is the exact lexical key sealed by the upstream Codex artifact, not a physical filesystem identity. It must already be NFC, start with exactly one slash, use exactly one slash between non-empty components, contain no dot or double-dot component, and have no trailing slash except root. Reject rather than normalize non-NFC text, leading double slash, repeated slash, dot, double-dot, NUL, relative path, or trailing slash. Preserve every accepted byte and case. Do not collapse, decode, case-fold, normalize, resolve symlinks, aliases, mounts, or realpath. exactPath is at most 1,400 UTF-8 bytes. |
| notion | {"resourceId": canonicalUuid}. Input is exactly 32 hexadecimal digits with optional 8-4-4-4-12 hyphens. Lowercase it and serialize canonicalUuid in 8-4-4-4-12 form. URL, slug, query, fragment, workspace name, and page title are not identity inputs. |

Requested and observed scopes for the same source and scopeKind run the identical canonicalization
algorithm before set sorting and HMAC. A missing stable GitHub database ID, invalid Codex path, or
invalid Notion UUID fails with SCOPE_TOKEN_CANONICALIZATION_INVALID; it cannot fall back to display
names, raw URLs, filesystem identity lookup, or caller tokens. The canonical identifier objects,
base64url tokens, HMAC preimages, and key bytes are reversible or sensitive private intermediates:
they are zeroized or released after verification and are never serialized, logged, committed, or
sent to the suggestion engine or model.

For GitHub, the private verification bundle must independently bind the
`requestedRepositoryIdentifierSet` from the frozen collection request and the
`observedRepositoryIdentifierSet | null` from the authoritative returned GitHub artifact. Each
requested set must contain 1..4,096 unique exact GitHub identifier objects after canonicalization;
the observed set is either null or contains 0..4,096 unique exact GitHub identifier objects. An
empty requested set fails closed with `SCOPE_TOKEN_CANONICALIZATION_INVALID` and must never mean all
repositories, a default repository, or an implicit caller scope. Each non-null set must use the same
frozen canonicalization version and token-derivation algorithm, but set equality is not a
precondition: the requested set derives only `requestedRepositoryScopeHmacSha256`, and the observed
set derives only `observedRepositoryScopeHmacSha256`. An implementation must never copy or reuse the
requested set as the observed set. After integrity and attestation verification, equal trustworthy
sets satisfy the scope-equality condition for `repository_scope_collection`; trustworthy unequal
sets, including a trustworthy empty observed set, force `partial` with `SCOPE_PARTIAL`; and a missing
or untrustworthy observed set forces `unknown` with `COVERAGE_UNKNOWN`, subject to the remaining
coverage decision-table rules.
Repository-set equality does not determine `activity_pagination`, which remains an independent
required operation when present in the collection plan.

For Notion, the private verification bundle must independently bind the
`requestedResourceIdentifierSet` from the frozen collection request and the
`observedResourceIdentifierSet | null` from the authoritative returned Notion read artifact. The
requested set must contain 1..4,096 unique exact Notion identifier objects after canonicalization;
the observed set is either null or contains 0..4,096 unique exact Notion identifier objects. An
empty requested set fails closed with `SCOPE_TOKEN_CANONICALIZATION_INVALID` and must never mean all
resources, a workspace default, or an implicit caller scope. Each non-null set must use the same
frozen canonicalization version and token-derivation algorithm, but set equality is not a
precondition: the requested set derives only `requestedResourceSetHmacSha256`, and the observed
set derives only `observedResourceSetHmacSha256`. An implementation must never copy or reuse the
requested set as the observed set. After integrity and attestation verification, equal trustworthy
sets satisfy the scope-equality condition for `resource_scope_collection`; trustworthy unequal
sets, including a trustworthy empty observed set, force `partial` with `SCOPE_PARTIAL`; and a missing
or untrustworthy observed set forces `unknown` with `COVERAGE_UNKNOWN`, subject to the remaining
coverage decision-table rules. Resource-set equality does not determine `resource_pagination`,
which remains an independent required operation when present in the collection plan.

For Codex, the private verification bundle must independently bind `requestedLexicalProjectKey`
from the frozen collection request and `observedLexicalProjectKey | null` from the authoritative
source artifact. Each non-null value must satisfy the same frozen lexical grammar, canonicalization
version, and token-derivation algorithm, but value equality is not a precondition: the requested
value derives only the requested-scope token, and the observed value derives only the
observed-scope token. An implementation must never copy or reuse the requested value as the
observed value. After integrity and attestation verification, equal trustworthy values satisfy the
scope-equality condition for `complete`; trustworthy unequal values force `partial` with
`SCOPE_PARTIAL`; and a missing or untrustworthy observed value forces `unknown` with
`COVERAGE_UNKNOWN`, subject to the remaining coverage decision-table rules.

Two distinct accepted lexical keys remain distinct even if the host filesystem would resolve them
to the same physical directory. The contract makes no physical-identity claim and permits no
filesystem lookup to merge aliases. This may conservatively produce a scope mismatch, but it cannot
merge two accepted lexical keys into a false complete result.

The HMAC key contains at least 256 bits generated by an approved cryptographic random source and is
stored only in an approved private key store. privacyScopeHmacKeyVersion is an opaque identifier,
not key material. The authoritative verifier resolves the exact version through a restricted key
handle; a missing, revoked, mismatched, or substituted key fails closed and cannot fall back to
another version.

### Linkability, rotation, and deletion

privacyScopeHmacContextId is minted once per frozen evaluation case. The same context may be shared
only by the A/B/C arms of that exact fixed case when direct scope equality is required. It must not
be reused across unrelated cases, datasets, users, or evaluation runs. Equality is intentionally
visible within the same key version, context, source, and scope kind; digest equality across any
other boundary is neither expected nor authoritative.

An approved private context issuer and registry, not the caller, mints and records each context.
The private context registration binds the context to one frozen evaluation-case identifier, its
authorized same-case A/B/C comparison scope, the exact `privacyScopeHmacKeyVersion`, and this
lifecycle tuple:

| Private lifecycle field | Exact rule |
| --- | --- |
| `issuedAt` | Required canonical UTC timestamp. |
| `expiresAt` | Required canonical UTC timestamp with `issuedAt < expiresAt`. |
| `revokedAt` | Canonical UTC timestamp or null. A non-null value requires `issuedAt <= revokedAt`. |

The private key-version lifecycle record selected by the exact
`privacyScopeHmacKeyVersion` uses the same required `issuedAt`, `expiresAt`, and `revokedAt`
fields and timestamp rules. These are private registry/key-store fields, not receipt, attestation,
record-set, source-bundle, or model fields. A boolean revocation flag, missing timestamp, alternate
field, caller assertion, or implementation-local default cannot substitute for this tuple.

Using the single Stage 3 `verificationStartedAt`, a context registration is valid only when:

`issuedAt <= verificationStartedAt < expiresAt`

and:

`revokedAt == null || verificationStartedAt < revokedAt`

Equality at `expiresAt` is expired and invalid. Equality at a non-null `revokedAt` is revoked and
invalid. The selected key-version record must satisfy the same two inequalities. The verifier must
not extend either boundary through clock rounding, grace periods, default timezone conversion,
cached wall-clock values, or a later time read.

A context registration that is absent, caller-minted, malformed, non-ordered, expired, revoked,
cross-case, cross-dataset, cross-user, or otherwise reused fails with
`PRIVACY_SCOPE_CONTEXT_INVALID`. A key-version record or restricted key handle that is absent,
malformed, non-ordered, expired, revoked, deleted, mismatched, or substituted fails with
`PRIVACY_SCOPE_KEY_UNAVAILABLE`. When both predicates apply, the existing frozen Stage 3 failure
order selects `PRIVACY_SCOPE_CONTEXT_INVALID` first.

A revocation committed before the immutable Stage 3 snapshot is part of the current invocation's
decision. A registry, key, revocation, expiry, deletion, or profile change committed after that
snapshot does not alter the current invocation and applies to the next invocation. The key store
must retain the snapshotted restricted handle for the current invocation; if it cannot do so, the
snapshot acquisition fails closed before HMAC evaluation.

`verificationStartedAt`, lifecycle tuples, registry records, restricted handles, and snapshot
metadata are runtime-only private validation state. They are never serialized into a receipt,
attestation, record set, source artifact, source verification bundle output, public failure, log,
committed fixture, suggestion-engine input, or model input.

Key rotation creates a new key version for new receipts. Existing sealed receipts and scope HMACs
are immutable and are never rewritten under the new key. Each key version is retained no longer
than the approved verification-retention period of the private receipts that depend on it, then the
key and associated raw scope material are deleted. After key deletion, intrinsic receipt integrity
may still be inspected, but privacy scope equality and authoritative lineage verification are
expired and must return PRIVACY_SCOPE_KEY_UNAVAILABLE; another key must never be substituted.

Authoritative activation is blocked until the approved key store, key-version resolver, context
issuer and registry, same-case authorization check, rotation, expiry, revocation, retention, and
deletion paths are implemented and validated together. A configuration flag, caller assertion,
test stub, or HMAC calculation alone cannot satisfy this gate.

## Stage10-1A.2b acceptance criteria

Implementation may begin only after Colin approves this exact structural/orchestration scope.
Stage10-1A.2b must demonstrate:

1. Structural schemas and intrinsic inspection enforce the proposed field shapes, caps, canonical
   scalar grammars, UTC timestamp and safe-integer rules, UTF-8 and artifact-byte limits, RFC 8785
   JCS, exact detached-hash formulas, privacy HMAC key/context metadata, unknown-input hardening,
   exact requestedCollectionMode enums and operation mappings, token canonicalization version, and
   detached-hash self-consistency without claiming authority.
2. The orchestration planner preserves the three explicit stages and identifies the exact
   source-specific verifier, frozen requested mode, and exact required operation set for every
   requested source.
3. Missing source verifier coverage always fails closed with SOURCE_VERIFIER_UNAVAILABLE.
4. No stage-local result can be consumed as an authoritative receipt or bypass a later stage.
5. No successful build-and-seal, authoritative verify, or receipt serialization API is exported.
6. Requested sources require verification bundles in the plan; not_requested sources reject them.
7. Tests use fictional synthetic inputs and prove that structural or orchestration success cannot
   be promoted to an authoritative success.
8. Focused tests, full typecheck, lint, relevant integration tests, full regression tests,
   independent QA, documentation, and an Engine Change Record remain separate gates.

## Post-Stage10-2 authoritative activation criteria

The full APIs may activate only after every requested source has an implemented authoritative
verifier and deterministic Common Suggestion Evidence projection and every private HMAC lifecycle
prerequisite is implemented and the pinned timezone profile is created, independently verified,
hash-frozen, and available. Activation must demonstrate:

1. Deterministic receipt bytes under permuted source attestations and interval inputs.
2. Exact record-set hash, asOf, source presence, record count, record-ID-set, verified sealed
   source-attestation binding, and byte-equivalent recomputed source projection through the three
   authoritative stages, including completedAt-to-collectedAt or attemptedAt-to-collectedAt exact
   mapping by participation outcome.
3. Exact distinction among not requested, collected with zero records, unavailable, and collected
   with one or more records.
4. Source-specific derivation of complete, partial, and unknown coverage for every required
   operation, including independent Dayflow capture and preprocessing derivation, exact
   capture-to-preprocessing-to-source-artifact-to-record-projection binding, deterministic status
   decision-table enforcement, distinct known-zero versus unknown accounting, exact issue-code set
   derivation, exact private context-bound scope HMAC verification, exact source token
   canonicalization and requested/observed equality behavior, and aggregation.
5. Approved key-store resolution of the exact key version; registry-issued context binding to one
   frozen evaluation case; authorized same-case A/B/C sharing; fail-closed unregistered,
   caller-minted, expired, revoked, substituted-key, or cross-case attempts; and validated rotation,
   retention, expiry, revocation, and deletion behavior.
6. Exact IANA tzdata2026c release SHA-512 verification, independently reviewed frozen profile
   SHA-256, canonical Zone membership and Link-alias normalization, UTC-to-Etc/UTC and
   GMT-to-Etc/GMT mapping, valid single-component Zone handling, and fail-closed dot, double-dot,
   alias-cycle, wrong-case, unregistered, OS-only, ICU-only, and unpinned-release values; plus exact
   verified-diagnostic-only timezoneContext unknown derivation to operation and aggregate unknown
   with COVERAGE_UNKNOWN.
7. Fail-closed missing, extra, malformed, or mismatched source attestations and verification
   bundles, forged-complete, plan/binding mismatch, interval, and hash cases.
   Malformed or integrity-invalid artifacts must fail before partial or unknown classification.
8. Hardened unknown-input handling for accessors, proxies, shared references, sparse arrays, depth,
   keys, counts, and bytes.
9. Isolation of private authority schemas from externally mutable exported Zod instances.
10. Strict RFC 8785 canonical serialization, exact preimage formulas and byte caps, exactly one LF,
   resource-limit precedence, and sanitized failures.
11. No arm ID or suggestion-shaped field in schema, bytes, issue codes, or APIs.
12. Synthetic fictional fixtures only and no private/live artifact in Git.
13. Focused tests, full typecheck, lint, relevant integration tests, full regression tests,
    independent QA, documentation, and an Engine Change Record as separate gates.

## Explicitly deferred work

- Stage10-1A.2b implementation until Colin field-level approval.
- Stage10-2 source-specific adapters, authoritative attestation verifiers, and actual
  source-artifact sealing implementations.
- Private HMAC key-store, version rotation, context issuance, retention, expiry, and deletion
  implementation.
- Generation, independent review, and hash freeze of blabase-tzdb-profile-2026c-v1 from the pinned
  IANA tzdata2026c.tar.gz release. This contract task does not create that replacement artifact.
- Activation of authoritative lineage receipt build, verification, and serialization APIs until
  every required Stage10-2 verifier and deterministic record projection exists and every private
  HMAC lifecycle prerequisite above is implemented and validated and the pinned timezone profile
  artifact is created, reviewed, hash-frozen, and available.
- Stage10-3 Dayflow record composition from verified Stage 1-9 evidence.
- Common prompt, output verifier, ranking, generator, and offline runner.
- Frozen input dataset, A/B/C execution, comparison metrics, and comparison report.
- Live capture, API, persistence, provider, product, release, and production integration.

## Colin decision required

Colin must approve, revise, or reject the proposed artifact identity, field tables, source-specific
coverage derivation, issue codes, resource caps, three-stage verification with exact source
verification bundles, privacy rules, and Stage10-1A.2b acceptance criteria. Silence or document
creation is not approval.
