# Dayflow Preprocessed Evidence Contract

Status: E2-SCHEMA-1 design candidate  
Owner and decision authority: Colin  
Date: 2026-08-20  
Implementation authority: none  
Live/private-data authority: none

## 1. Purpose

This contract defines the evidence boundary between Dayflow and the common Blabase suggestion
engine.

Dayflow owns:

- capture;
- local storage;
- OCR;
- privacy filtering;
- deterministic preprocessing;
- neutral evidence provenance, coverage, confidence, omissions, and typed failures.

Blabase owns:

- evidence assembly;
- the LLM request;
- suggestion generation;
- validation and filtering;
- ranking and caveats;
- final suggestion title, summary, and output schema.

The contract must support this comparison:

- A: existing structured evidence only;
- B: the exact A evidence plus verified Dayflow preprocessed evidence;
- C: verified Dayflow preprocessed evidence only.

A, B, and C use one Blabase engine entry point and the same model, prompt, configuration, ranking,
guardrails, validation, post-processing, and output schema. Arm identity remains evaluation
metadata outside the engine request.

## 2. Scope

Version 0.1 is:

- synthetic contract-conformance only;
- strict and fail closed;
- immutable after sealing;
- independent from the historical suggestion-shaped DayflowNormalizedEvidence;
- bound to a freshly verified E2-IO.2A bundle;
- limited to privacy-filtered OCR observations.

Version 0.1 does not authorize:

- live or private captures;
- cloud OCR;
- production ingestion;
- provider calls;
- suggestion generation;
- fixture migration;
- evaluation execution;
- publication or release.

Neutral application, window, activity, task, project, person, and organization extraction is
deferred. Adding any of those fields requires a successor schema and a separate Colin decision.

## 3. Normative identities

| Purpose | Exact identity |
| --- | --- |
| Type | DayflowPreprocessedEvidenceV0_1 |
| Schema literal | dayflow-preprocessed-evidence-v0.1 |
| Detached hash field | dayflowPreprocessedEvidenceSha256 |
| Hash domain | blabase.dayflow-preprocessed-evidence.v0.1 |
| Verifier | dayflow-preprocessed-evidence-verifier-v0.1 |
| E2 import schema | dayflow-screen-evidence-bundle-import-v0.1 |
| E2 completion schema | dayflow-screen-evidence-bundle-completion-v0.1 |
| E2 completion hash domain | blabase.dayflow-screen-evidence-bundle-completion.v0.1 |
| E2 replay hash domain | blabase.dayflow-screen-evidence-bundle-replay.v0.1 |

## 4. Closed contract shape

The implementation must use strict objects and discriminated unions matching this logical shape.
Every listed field is required, including empty arrays and nullable fields.

    type ImportedDayflowTransportBindingV0_1 = Readonly<{
      importSchemaVersion: "dayflow-screen-evidence-bundle-import-v0.1";
      manifestRawSha256: Sha256;
      manifestDetachedSha256: Sha256;
      completionSha256: Sha256;
      objectCount: UInt;
      totalObjectBytes: UInt;
      replayIdentitySha256: Sha256;
    }>;

    type CanonicalDecimal = string;

    type SourceArtifactRefV0_1 = Readonly<{
      artifactType: "dayflow_export_frame";
      exportRef: Readonly<{
        schemaVersion: "dayflow-screen-evidence-export-v0.1";
        exportId: SafeId;
        detachedManifestSha256: Sha256;
      }>;
      sourceRowId: CanonicalDecimal;
      blobSha256: Sha256;
    }>;

    type OcrModelProvenanceV0_1 = Readonly<{
      execution: "on_device";
      provenanceLevel: "exact_model" | "engine_version_only";
      engineId: SafeId;
      engineVersion: VersionId;
      modelId: SafeId | null;
      modelVersion: VersionId | null;
      configurationSha256: Sha256;
    }>;

    type PreprocessingProvenanceV0_1 = Readonly<{
      runId: SafeId;
      pipelineVersion: VersionId;
      pipelineBuildSha256: Sha256;
      privacyPolicyVersion: VersionId;
      privacyPolicySha256: Sha256;
      completedAt: CanonicalUtcMillis;
      ocr: OcrModelProvenanceV0_1;
    }>;

    type OcrConfidenceV0_1 =
      | Readonly<{ status: "reported"; basisPoints: BasisPoints }>
      | Readonly<{ status: "unavailable"; basisPoints: null }>;

    type RedactionCategoryV0_1 =
      | "credential"
      | "email"
      | "phone"
      | "person"
      | "account_id"
      | "filesystem_path"
      | "url"
      | "other_sensitive";

    type PrivacyFilteredOcrSpanV0_1 = Readonly<{
      spanOrdinal: UInt;
      textKind: "privacy_filtered_ocr";
      text: SafeOcrText;
      textSha256: Sha256;
      confidence: OcrConfidenceV0_1;
      redaction: Readonly<{
        status: "none_detected" | "redacted";
        categories: readonly RedactionCategoryV0_1[];
      }>;
    }>;

    type FrameProcessingResultV0_1 =
      | Readonly<{
          status: "text";
          spans: readonly PrivacyFilteredOcrSpanV0_1[];
        }>
      | Readonly<{
          status: "no_text";
          spans: readonly [];
        }>
      | Readonly<{
          status: "privacy_omitted";
          spans: readonly [];
          omissionCode: "PRIVACY_POLICY_EXCLUDED";
        }>
      | Readonly<{
          status: "processing_failed";
          spans: readonly [];
          errorCode:
            | "OCR_FAILED"
            | "PRIVACY_FILTER_FAILED"
            | "UNSUPPORTED_FRAME"
            | "RESOURCE_LIMIT";
          retryability: "retryable" | "terminal";
        }>;

    type FrameEvidenceV0_1 = Readonly<{
      frameOrdinal: UInt;
      sourceArtifactRef: SourceArtifactRefV0_1;
      capturedAt: CanonicalUtcMillis;
      result: FrameProcessingResultV0_1;
    }>;

    type DayflowPreprocessedEvidenceV0_1 = Readonly<{
      schemaVersion: "dayflow-preprocessed-evidence-v0.1";
      dataOrigin: "synthetic";
      studyPhase: "contract_conformance";
      studyProtocolHash: Sha256;
      transportBinding: ImportedDayflowTransportBindingV0_1;
      preprocessing: PreprocessingProvenanceV0_1;
      captureWindow: Readonly<{
        start: CanonicalUtcMillis;
        end: CanonicalUtcMillis;
      }>;
      coverageCode: "observed" | "valid-empty" | "failure";
      coverage: DayflowCoverage;
      frames: readonly FrameEvidenceV0_1[];
      dayflowPreprocessedEvidenceSha256: Sha256;
    }>;

## 5. Scalar rules

| Scalar | Rule |
| --- | --- |
| Sha256 | Exactly 64 lowercase hexadecimal characters |
| SafeId | 1 to 128 characters; first character lowercase ASCII; remaining characters lowercase ASCII, digits, period, underscore, colon, or hyphen |
| VersionId | 1 to 64 lowercase ASCII alphanumeric, period, underscore, or hyphen |
| CanonicalDecimal | The string 0, or a nonzero ASCII digit followed by zero or more ASCII digits; no sign or leading zero |
| CanonicalUtcMillis | Valid YYYY-MM-DDTHH:mm:ss.sssZ with no aliases, offset form, or leap second |
| UInt | Non-negative safe integer; negative zero rejected |
| BasisPoints | Integer from 0 through 10,000 |
| SafeOcrText | NFC Unicode; 1 to 2,048 UTF-8 bytes; LF and tab allowed; CR, NUL, other C0/C1 controls, invalid scalar values, and bidi formatting controls rejected |

The safe-text rule is syntactic. It does not prove that credential, path, URL, person, or other
sensitive content was detected. That responsibility remains with the named privacy policy and its
tests.

SafeOcrText requires a dedicated byte-bounded schema. The existing scalar-counted bounded-string
helper must not be reused because it rejects LF/tab and measures a different unit.

## 6. Source and transport binding

The verifier must not trust a caller-supplied verified boolean or a structurally valid transport
receipt.

The closed verifier result is:

    type DayflowPreprocessedEvidenceIssueCodeV0_1 =
      | "INPUT_INVALID"
      | "RESOURCE_LIMIT_EXCEEDED"
      | "JSON_INVALID"
      | "JSON_DUPLICATE_KEY"
      | "JSON_NOT_CANONICAL"
      | "SCHEMA_INVALID"
      | "HASH_MISMATCH"
      | "TRANSPORT_REVERIFY_FAILED"
      | "TRANSPORT_BINDING_MISMATCH"
      | "MANIFEST_BINDING_MISMATCH"
      | "SOURCE_ARTIFACT_SET_MISMATCH"
      | "SOURCE_ARTIFACT_BINDING_MISMATCH"
      | "ORIGIN_PHASE_MISMATCH"
      | "STUDY_PROTOCOL_MISMATCH"
      | "CAPTURE_WINDOW_MISMATCH"
      | "COVERAGE_MISMATCH"
      | "COVERAGE_CODE_MISMATCH"
      | "COVERAGE_FAILURE"
      | "CHRONOLOGY_INVALID"
      | "PREPROCESSING_PROVENANCE_INVALID"
      | "OCR_TEXT_INVALID"
      | "OCR_TEXT_HASH_MISMATCH"
      | "PRIVACY_METADATA_INVALID"
      | "RESOURCE_COUNT_MISMATCH";

    type VerifyDayflowPreprocessedEvidenceResultV0_1 =
      | Readonly<{
          valid: true;
          evidence: DayflowPreprocessedEvidenceV0_1;
          issueCodes: readonly [];
        }>
      | Readonly<{
          valid: false;
          issueCodes: readonly [
            DayflowPreprocessedEvidenceIssueCodeV0_1,
            ...DayflowPreprocessedEvidenceIssueCodeV0_1[],
          ];
        }>;

Failure issue codes are sorted in ascending ASCII order and unique. A failure result has exactly
valid and issueCodes and never contains partial evidence, raw text, paths, IDs, underlying error
messages, or transport bytes. A success result has exactly valid, evidence, and an empty
issueCodes tuple.

The future verification API must accept:

    verifyDayflowPreprocessedEvidenceV0_1(
      candidateBytes,
      originalBundle,
      expectedImportedBundleDescriptor
    ): VerifyDayflowPreprocessedEvidenceResultV0_1

It must:

1. Capture candidateBytes and the bundle entries container into local references exactly once.
   Require entries to be a dense plain array, capture its length once, and reject a length greater
   than 258 before reading entry elements.
2. Capture each entry object, relativePath, entryKind, declared byteLength, and bytes view exactly
   once. Before copying bytes, require every path to be one of manifest.json, COMPLETE, or
   objects/sha256/<64-lowercase-hex>.jpg; require all paths unique; permit at most one manifest.json
   and one COMPLETE; and permit at most 256 object paths.
3. Synchronously preflight candidateBytes and every captured entry before allocating a snapshot:
   require a Uint8Array view; reject detached, SharedArrayBuffer-backed, resizable, or growable
   backing storage; compare each actual bytes.byteLength with its declared byteLength; apply the
   512-KiB candidate cap, 1-MiB manifest cap, 16-KiB completion cap, 10-MiB per-object cap,
   256-MiB aggregate object cap, and 269,500,416-byte aggregate all-entry cap. Sum actual lengths
   with safe-integer checked addition and reject overflow.
4. Only after the complete preflight succeeds, copy candidateBytes and every entry bytes view into
   new fixed-length, non-shared Uint8Array instances. Copy the strict primitive expected import
   descriptor into a new frozen exact-key object. Retain no caller-owned byte or object reference.
   All later parsing, comparison, and hashing use only these owned snapshots.
5. Re-run E2-IO.2A validation over the owned snapshot of the complete bundle.
6. Require field-for-field equality with expectedImportedBundleDescriptor.
7. Resolve the exact manifest artifact set from that same owned snapshot.
8. Require transportBinding to equal the fresh import result.
9. Require dataOrigin and studyPhase to equal the resolved manifest.
10. Require studyProtocolHash to equal resolvedManifest.studyProtocolHash.
11. Require captureWindow and coverage to equal the resolved manifest exactly under JCS equality.
12. Derive coverageCode only by calling classifyDayflowCoverage with the resolved manifest coverage
   and artifacts, and require the candidate value to equal that result.
13. Require every frame sourceArtifactRef to resolve to exactly one manifest artifact.
14. Require frameOrdinal order to equal the bound manifest artifact order.
15. Require capturedAt, sourceRowId, export reference, detached manifest hash, and blobSha256 to
    equal the resolved artifact.
16. Require the frames array to cover the complete manifest artifact set exactly once.
17. Reject missing, extra, duplicate, substituted, or reordered source bindings.

This preserves the completed E2-IO.2A descriptor-only public API. The new verifier owns the
stronger atomic re-verification needed for OCR-to-frame provenance.

All E2-IO.2A issue codes map to TRANSPORT_REVERIFY_FAILED. Candidate/expected receipt inequality
maps to TRANSPORT_BINDING_MISMATCH. Resolved manifest identity inequality maps to
MANIFEST_BINDING_MISMATCH. Missing, extra, duplicate, or reordered artifacts map to
SOURCE_ARTIFACT_SET_MISMATCH; a field mismatch on an otherwise resolved artifact maps to
SOURCE_ARTIFACT_BINDING_MISMATCH. Origin/phase, protocol, window, coverage bytes,
coverage-classification failure, and frame-count mismatches map respectively to
ORIGIN_PHASE_MISMATCH, STUDY_PROTOCOL_MISMATCH, CAPTURE_WINDOW_MISMATCH, COVERAGE_MISMATCH,
COVERAGE_FAILURE, and RESOURCE_COUNT_MISMATCH. The remaining issue codes map one-to-one to their
named scalar, chronology, preprocessing, OCR, privacy, resource, JSON, schema, or hash failure.

Candidate coverageCode inequality has its own mapping. When classifyDayflowCoverage returns
observed or valid-empty and the candidate value differs, emit COVERAGE_CODE_MISMATCH. When the
classifier returns failure, emit COVERAGE_FAILURE regardless of the candidate value. A coverage
object that differs from the resolved manifest emits COVERAGE_MISMATCH; after that prerequisite
fails, do not classify the untrusted candidate coverage.

### 6.1 Deterministic validation stages

Issue membership follows these ordered stages. A failed prerequisite stage stops all later stages.
Raw limits are separated from decoded limits. A predicate appears in exactly one stage and maps to
exactly one code. Within the final aggregation stage, every applicable independent predicate is
evaluated and the result is the ascending-ASCII sorted unique union of its mapped codes.

| Stage | Predicate and exact result |
| --- | --- |
| 1 API and entry metadata | Non-Uint8Array input, non-plain/sparse entries, more than 258 entries, disallowed or duplicate path, more than one control path, more than 256 object paths, detached/shared/resizable/growable backing storage, declared/actual byte-length inequality, invalid expected-descriptor shape, or unsafe aggregate arithmetic returns only INPUT_INVALID |
| 2 raw byte caps | Candidate, manifest, completion, per-object, aggregate-object, or aggregate-all-entry actual bytes over the exact pre-copy cap returns only RESOURCE_LIMIT_EXCEEDED |
| 3 JSON decode | Invalid UTF-8 or JSON returns only JSON_INVALID; a duplicate decoded key returns only JSON_DUPLICATE_KEY; otherwise valid but non-JCS-plus-LF bytes return only JSON_NOT_CANONICAL |
| 4 decoded resource caps | JSON depth, frames, spans, OCR text bytes, or redaction-category count above its stated cap returns only RESOURCE_LIMIT_EXCEEDED |
| 5 strict structure | Missing or extra keys, wrong primitive JSON types, unknown enum/version/discriminator literals, or invalid non-OCR scalar lexical forms return only SCHEMA_INVALID. A known discriminator with individually well-typed fields but an invalid field combination is deferred exclusively to Stage 9 |
| 6 detached hash | A structurally valid candidate with the wrong detached hash returns only HASH_MISMATCH |
| 7 transport | Any E2-IO.2A rejection returns only TRANSPORT_REVERIFY_FAILED; otherwise expected/fresh/candidate descriptor inequality returns only TRANSPORT_BINDING_MISMATCH |
| 8 resolved prerequisites | Evaluate in fixed priority MANIFEST_BINDING_MISMATCH, ORIGIN_PHASE_MISMATCH, STUDY_PROTOCOL_MISMATCH; return only the first applicable code and stop. E2-IO.2A has already established the resolved manifest artifact map, so candidate-frame bijection is not part of this stage |
| 9 independent aggregation | After stages 1 through 8 pass, evaluate window, exact coverage bytes, derived coverage code, candidate-frame bijection and field equality, chronology, cross-field counts, preprocessing provenance, OCR scalar semantics/hash, and privacy metadata; include every applicable mapped code, then sort and deduplicate |

Stage 9 predicate mapping is closed:

| Predicate | Issue code |
| --- | --- |
| captureWindow differs from the resolved export or capturedAt violates the half-open window | CAPTURE_WINDOW_MISMATCH |
| coverage differs from resolvedManifest.coverage | COVERAGE_MISMATCH |
| coverage matches, classifier returns observed or valid-empty, and candidate coverageCode differs | COVERAGE_CODE_MISMATCH |
| classifier returns failure | COVERAGE_FAILURE |
| frames do not bijectively cover the manifest artifact set or manifest order | SOURCE_ARTIFACT_SET_MISMATCH |
| a resolved frame field differs from its artifact | SOURCE_ARTIFACT_BINDING_MISMATCH |
| frame/span ordinal or timestamp chronology is invalid outside the window predicate | CHRONOLOGY_INVALID |
| frame count, span count, or cross-field resource count differs | RESOURCE_COUNT_MISMATCH |
| preprocessing or OCR provenance union is invalid | PREPROCESSING_PROVENANCE_INVALID |
| OCR text NFC/control/scalar semantics, span-result union, or confidence is invalid; byte/count caps are exclusively Stage 4 | OCR_TEXT_INVALID |
| textSha256 differs from exact NFC UTF-8 text bytes | OCR_TEXT_HASH_MISMATCH |
| known redaction status has present, correctly typed fields but its category values, ordering, uniqueness, cardinality, or status-to-category combination is invalid | PRIVACY_METADATA_INVALID |

Known-discriminator combinations have exclusive ownership:

- result.status no_text with a nonempty spans array, result.status text with an empty spans array,
  or any other invalid known frame-result combination emits OCR_TEXT_INVALID;
- confidence.status reported with null basisPoints, confidence.status unavailable with a numeric
  basisPoints value, or any other invalid known confidence combination emits OCR_TEXT_INVALID;
- OCR provenanceLevel exact_model with either model field null, provenanceLevel
  engine_version_only with either model field non-null, or another invalid known OCR provenance
  combination emits PREPROCESSING_PROVENANCE_INVALID;
- redaction.status none_detected with a present nonempty categories array, redacted with a present
  correctly typed but empty categories array, an unsorted or duplicate present category set, or
  another invalid combination whose keys and primitive JSON types are all present and correct
  emits PRIVACY_METADATA_INVALID.

If a discriminator literal is unknown, a required key is absent, an extra key is present, or a
field has the wrong primitive JSON type, Stage 5 owns the failure and returns only SCHEMA_INVALID.
This includes every absent, unknown-literal, or wrong-type omissionCode. The same input must never
also receive the Stage 9 code.

No predicate emits both a prerequisite-stage generic code and a later specific code. No
implementation may add an unregistered issue code, omit an applicable stage-9 code, or continue
past a failed prerequisite stage.

## 7. Cross-field invariants

- Unknown fields, enum values, and schema versions fail closed.
- dataOrigin is exactly synthetic.
- studyPhase is exactly contract_conformance.
- captureWindow is nonempty and equals the resolved export window.
- preprocessing.completedAt is not earlier than captureWindow.end.
- frames.length equals transportBinding.objectCount.
- Zero objects and an empty frames array are allowed only when the resolved export and coverage
  are valid-empty.
- Frame ordinals are contiguous from zero through frames.length minus one.
- Source artifact references are unique.
- captureWindow is half-open. Every capturedAt satisfies captureWindow.start <= capturedAt <
  captureWindow.end and is nondecreasing by frame ordinal. Equal timestamps are permitted.
- A text result has 1 to 32 spans.
- All non-text results have an empty spans array.
- Span ordinals are contiguous from zero within each frame.
- textSha256 is raw SHA-256 over the exact NFC UTF-8 bytes of text.
- none_detected requires an empty redaction category array.
- redacted requires 1 to 8 sorted, unique redaction categories.
- exact_model requires non-null modelId and modelVersion.
- engine_version_only requires both model fields to be null.
- coverage equals resolvedManifest.coverage under exact JCS equality.
- coverageCode equals classifyDayflowCoverage({ coverage: resolvedManifest.coverage, artifacts:
  resolvedManifest.artifacts }).
- coverageCode valid-empty requires zero source artifacts, objectCount zero, frames.length zero,
  no OCR text, and zero-count coverage explained only by paused, locked, or policy-denied
  intervals.
- Zero-count coverage containing missing, read-failed, or unavailable classifies as failure, never
  valid-empty.
- coverageCode observed requires at least one resolved source artifact.
- coverageCode failure returns COVERAGE_FAILURE and no sealed evidence.
- OCR confidence is recognition confidence only. It is not suggestion confidence, source
  authority, ranking, freshness, or availability.
- OCR provenance identifies the Dayflow OCR implementation only. It is never a Blabase suggestion
  model identity.

## 8. Canonicalization and detached hash

- Decode input with fatal UTF-8.
- Reject BOM, duplicate keys including escaped aliases, invalid JSON numbers, sparse arrays,
  cycles, and unsupported values.
- Require byte equality to RFC 8785 JCS of the parsed value plus one LF.
- Compute dayflowPreprocessedEvidenceSha256 by removing that field and hashing:

      UTF8("blabase.dayflow-preprocessed-evidence.v0.1")
      || NUL
      || UTF8(JCS(preimage))

- Recompute and compare the detached hash during every parse.
- Preserve array semantic order. Redaction categories are sorted and unique.
- Redaction categories sort by ascending raw ASCII byte order.
- JSON container depth counts the root object as depth 1; every nested object or array increments
  depth by 1; scalar children do not increment it. Depth 10 is accepted and depth 11 is rejected.
- Identical semantic content produces identical canonical bytes and hash.

## 9. Resource limits

| Resource | Limit |
| --- | ---: |
| Canonical evidence document | 512 KiB |
| Source frames | 256 |
| Source JPEG bytes per object during re-verification | 10 MiB |
| Aggregate source JPEG bytes during re-verification | 256 MiB |
| OCR spans per frame | 32 |
| OCR spans total | 1,024 |
| UTF-8 bytes per OCR span | 2,048 |
| UTF-8 OCR text bytes total | 65,536 |
| Redaction categories per span | 8 |
| JSON nesting depth | 10 |

Resource limits are checked before unbounded copying, Unicode normalization, concatenation, or
allocation. The producer records privacy omission or processing failure instead of silently
truncating content.

## 10. Forbidden fields and meanings

Strict parsing rejects all unlisted fields, including:

- raw JPEG or blob bytes;
- base64, thumbnails, paths, URLs, filenames, hostnames, usernames, device IDs, and workspace IDs;
- raw OCR, unfiltered window titles, clipboard data, keystrokes, accessibility trees, and full OCR
  engine responses;
- free-form error messages;
- inferred application, window, activity, task, project, person, or organization entities;
- semanticOutput;
- final title or summary;
- caveats, rank, ranking, recommendation, availability, next action, or output-field pointers;
- RECENT_FOCUS, VISIBLE_TASK_INTENT, DISPLAY_TITLE_HINT, or any equivalent suggestion label;
- arm identity;
- Blabase suggestion provider, model, prompt, configuration, ranking, guardrail, or engine
  selection;
- Dayflow-authored paraphrases, classifications, inferred intent, or imperatives.

Only spans[].text may contain free text. Suggestion-like words observed on screen may appear there
as quoted, untrusted OCR evidence. The Blabase adapter must serialize OCR text as data and never
place it in system or developer instruction channels.

## 11. Common-engine adapter requirements

The later Blabase adapter must:

- accept only successfully verified DayflowPreprocessedEvidenceV0_1;
- map it into one common evidence representation;
- treat OCR text as untrusted quoted evidence;
- add no arm-specific copy or ranking;
- expose no arm identity to the generator;
- preserve coverage, omissions, failures, confidence, and provenance;
- keep structured-source authority stronger than screen inference for conflicting direct facts.

Blabase engine run records, not this evidence artifact, own the suggestion provider, model, prompt,
configuration, ranking, guardrails, validation, post-processing, and final output identity. Those
identities must be equal across A/B/C.

## 12. Compatibility and migration

- This is a new sibling contract, not a revision, pick, extension, or compatibility union of
  DayflowNormalizedEvidence.
- Historical contracts, fixtures, renderer artifacts, versions, and hashes remain byte-immutable.
- The v0.1 parser accepts only the exact v0.1 literal.
- Unknown versions fail closed.
- Adding an optional field requires v0.2.
- Changing field meaning requires a new schema version.
- Historical suggestion-shaped normalized evidence is rejected.
- No automatic migration from historical normalized evidence is allowed.
- A later migration must reprocess eligible source captures under a new preprocessing run,
  privacy policy, version, and detached hash.
- Live/private input, cloud OCR, richer neutral metadata, producer authentication, and production
  transport require separate successor contracts and Colin approval.
- E2-IO.2A source, public API, limits, validation closure, bytes, and hashes remain unchanged.

## 13. Implementation acceptance criteria

Future E2-SCHEMA-2 tests must prove:

1. The smallest canonical observed and valid-empty artifacts are accepted.
2. Key reordering before sealing produces identical canonical bytes and hash.
3. Exact E2-IO.2A descriptor and manifest-artifact binding are required.
4. Missing, extra, duplicated, substituted, or reordered source artifacts fail.
5. Unknown keys, enums, versions, and union combinations fail at every nesting level.
6. Legacy normalized evidence and all suggestion-shaped fields fail.
7. Hash, canonical JSON, UTF-8, duplicate-key, chronology, coverage, count, and cap violations fail.
8. OCR text hash, NFC, byte limits, confidence, redaction, and result-union invariants are enforced.
9. Suggestion-like words are allowed only as quoted spans[].text data.
10. The sealed output is deeply immutable and contains no raw image bytes or capability handle.
11. Parser and verifier code have no environment, provider, network, clock, random, publication,
    production, or runtime capture capability.
12. Existing E2-IO.2A tests and exact public return shape remain unchanged.
13. Canonical-decimal sourceRowId values, protocol-hash equality, coverage classification, and the
    exact sorted verifier issue mapping are enforced.
14. Shared, resizable, growable, detached, or concurrently substitutable caller buffers are
    rejected or copied into the required owned fixed-length snapshot before parsing.

## 14. Known limitations

- Synthetic v0.1 does not authorize real user data.
- Schema and hashes cannot prove OCR accuracy or that privacy filtering detected every secret.
- OCR text can contain prompt-injection content and must remain an untrusted data block.
- Confidence values are not calibrated across OCR engine/model/configuration changes.
- Capture timestamps do not prove that the device clock was accurate.
- Privacy filtering and limits may remove useful context; omissions must remain visible.
- The contract deliberately excludes app/window/activity/entity labels until evidence shows they
  are necessary.
- Authenticated live producer binding remains a later E2-IO design decision.

## 15. Checkpoints

| Checkpoint | Scope | Decision |
| --- | --- | --- |
| E2-SCHEMA-1 | This design candidate only | Colin approves, revises, or holds |
| E2-SCHEMA-1-V | Independent document and contract review | Separate Colin decision |
| E2-SCHEMA-2 | New parser, sealer, verifier, and synthetic tests | Not authorized |
| E2-ADAPTER-1 | Verified evidence to common engine input | Not authorized |
| E2-ROUNDTRIP-1 | Synthetic A/B/C same-engine integration | Not authorized |

No later checkpoint is authorized by this document.


---

<!-- current-contract:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:begin -->

## 16. E2-SCHEMA-2A pure-core implementation status

This additive section is the current implementation authority for the pure-core subset of
E2-SCHEMA-2. It preserves Sections 1 through 15 as the frozen design and diagnostic history, but
supersedes the earlier `E2-SCHEMA-2` not-authorized status only for the completed `2A` scope below.

### 16.1 Completed scope

`E2-SCHEMA-2A` is implemented, focused-validated, compatibility-validated, and independently
read-only QA-reviewed for synthetic input only. It contains:

- a pure strict schema, sealer, serializer, canonical parser, detached-hash verifier, and deeply
  frozen result in `src/dayflowEvidence/preprocessedEvidenceV0_1.ts`;
- synthetic unit coverage in `tests/dayflowPreprocessedEvidenceV0_1.test.ts`;
- the dedicated `tsconfig.dayflow-e2schema.json` and `vitest.dayflow-e2schema.config.ts` closures.

The implemented frozen literals are:

| Identity | Exact value |
| --- | --- |
| evidence schema | `dayflow-preprocessed-evidence-v0.1` |
| detached-hash domain | `blabase.dayflow-preprocessed-evidence.v0.1` |
| verifier version | `dayflow-preprocessed-evidence-verifier-v0.1` |
| bound import schema | `dayflow-screen-evidence-bundle-import-v0.1` |

The parser and sealer enforce strict synthetic-only structure, exact transport-receipt fields,
privacy and provenance invariants, JCS plus one LF, the domain-separated detached hash, and the
resource limits in Section 9. There is no compatibility union with legacy suggestion-shaped
`DayflowNormalizedEvidence`.

The final F2 corrections share the 512-KiB boundary across sealing, serialization, and parsing;
use an iterative strict JSON scan so invalid syntax and decoded duplicate keys retain precedence
over depth exhaustion; and take an intrinsic `Uint8Array` snapshot only after unsafe shared,
growable, resizable, detached, or proxied inputs are rejected as `INPUT_INVALID`. Oversized safe
fixed buffers remain `RESOURCE_LIMIT_EXCEEDED`.

### 16.2 Recorded evidence and remaining boundary

Focused validation passed: dedicated Vitest 29/29, dedicated TypeScript, and targeted ESLint.
Compatibility validation passed: E2 importer 10/10, DFA regression 90/90, five files and 129 tests
in total, full suggestion TypeScript, full suggestion lint, and root architecture dependency check
with zero errors. Existing architecture warnings remain repository 12, suggestion 8, and scripts
2. Final read-only QA for F2a, F2b.1, and F2c.1 passed with no Medium-or-higher finding in each
final scope. Automated QA is technical evidence for Colin, not a separate human approval.

No Golden, Regression, Rolling, or Holdout dataset, baseline, engine input/output, filtering,
ordering, ranking, prompt, model, or production path changed. No real screenshot, OCR, private
artifact, or live data was created or inspected. Dataset hashes, run IDs, and product-quality
metrics are therefore not applicable.

| Checkpoint | Current status | Boundary |
| --- | --- | --- |
| E2-SCHEMA-2A | completed | pure-core schema, sealer, serializer, parser, and synthetic tests |
| E2-SCHEMA-2B | pending and not authorized | importer adapter, owned bundle snapshot, and fresh bundle re-verification |
| Common-engine adapter and run generation | pending and not authorized | one Blabase engine for A/B/C |
| Live data and A/B/C execution | pending and not authorized | separate Colin decision required |

Known Low residuals are suffix-based numeric-scanner allocation bounded by the 512-KiB document
cap and optional hostile `byteOffset`/`constructor`, exact-subview, and grammar-parity test
coverage. They do not authorize expansion of `2A`.

Dayflow remains limited to capture, storage, OCR, privacy filtering, and neutral preprocessing.
This artifact cannot contain or decide suggestion titles, summaries, `semanticOutput`, ranking,
caveats, availability, next-action labels, or output paths. A/B/C must later use the same Blabase
suggestion engine; that adapter and execution work is not implemented by this checkpoint.

<!-- current-contract:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:end -->


---

<!-- current-contract:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:begin -->

## 17. E2-SCHEMA-2B-1 owned verification snapshot status

This additive section is the current authority for the first half of E2-SCHEMA-2B. It preserves
the contract and E2-SCHEMA-2A history, but supersedes active wording that treats the owned bundle
snapshot as wholly pending. It does not mark all of E2-SCHEMA-2B complete.

### 17.1 Implemented boundary

`E2-SCHEMA-2B-1` implements an ephemeral owned verification snapshot with version
`dayflow-preprocessed-evidence-verification-snapshot-v0.1`. Its public surface is:

- `captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1`;
- `copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1`;
- `copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1`;
- `reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1`.

The returned handle is frozen, opaque, and backed only by an internal `WeakMap`. Capture projects
the expected enumerable data properties into bounded local values, rejects accessors, proxies,
unexpected enumerable properties, sparse arrays, unsafe lexical paths, and invalid control/count
structure, then validates all byte views and resource caps before copying. Expected properties are
read as data descriptors. Enumerable extras fail on the first bounded discovery. Symbol and
non-enumerable extras are intentionally ignored and are never retained.

Every accepted candidate and bundle entry view is copied into fixed owned storage. Detached,
shared, growable, resizable, proxied, or otherwise unsafe typed-array storage fails closed. Public
copy accessors return fresh copies. Capture immediately calls the existing E2-IO.2A importer over
a fresh owned bundle copy and requires exact equality of all seven imported descriptor fields.
The importer and E2-SCHEMA-2A core APIs remain unchanged.

The only public issue codes are:

- `INPUT_INVALID`;
- `RESOURCE_LIMIT_EXCEEDED`;
- `BUNDLE_IMPORT_REJECTED`;
- `IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH`;
- `SNAPSHOT_HANDLE_INVALID`.

Errors expose only the typed issue code and fixed sanitized message. They retain no caller bytes,
paths, descriptor values, underlying exception, or private evidence.

### 17.2 Ordering, evidence, and remaining gate

Preflight order is closed: bounded semantic shape and path/bundle/control/count validation first;
all typed-array validity checks second; raw resource caps third; owned copying fourth; fresh-copy
E2-IO.2A reimport and exact seven-field descriptor comparison last. F1, F2a, F2a.1, F2b, F3, R1,
and F3.1 corrections are closed within this ordering.

Focused validation passed with dedicated snapshot Vitest 21/21, dedicated TypeScript, and targeted
ESLint. Compatibility passed with snapshot 21, schema 29, importer 10, and DFA 90: six test files
and 150 tests total. Full suggestion TypeScript and lint passed. Root architecture dependency
checking passed with zero errors, valid 17-entry/4-sentinel-edge coverage, and the existing
repository 12/suggestion 8/scripts 2 warnings. Final QA3 was read-only and passed with no High or
Medium finding; this automated QA is not human approval.

`E2-SCHEMA-2B-1` does not parse the candidate as semantic evidence and does not implement the
resolved evidence verifier described in Section 6. `E2-SCHEMA-2B-2` remains pending, not
authorized, and incomplete. The common-engine adapter, run generation, live data, and A/B/C
execution also remain pending.

Golden and baseline evaluation are N/A because this is an unconnected evaluation-only ownership
boundary and changes no runtime engine input, output, filtering, ordering, or ranking. No real
screenshot, OCR, private artifact, or live data was created, inspected, or persisted. LikeC4 is
N/A because no live system boundary was connected; architecture dependencies were checked.

Residual Low test gaps are exact 259-entry and 257-object issue cases, exact 256-MiB success,
explicit cloned/proxied-handle cases, and runtime-dependent resizable/growable branches.

<!-- current-contract:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:end -->


---

<!-- current-contract:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:begin -->

## 18. E2-SCHEMA-2B-2A staged structural inspection status

This additive section is the current authority for the structural half of the previously pending
E2-SCHEMA-2B-2 checkpoint. It preserves all earlier records and does not mark resolved bundle
verification complete.

### 18.1 Implemented layer

`E2-SCHEMA-2B-2A` adds layered structural and full semantic schema handling plus the internal raw
byte inspector `inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification`. The
inspector is marked internal and is not exposed through a barrel or product API. Existing public
sealer, serializer, parser, issue codes, canonical bytes, schema/version literals, and hash domain
remain unchanged.

Inspection order is fixed:

1. byte safety, strict JSON, decoded duplicate keys, resource caps, and canonical JCS plus LF;
2. full structural schema;
3. detached root hash;
4. intrinsic issue and future resolved-owner collection.

A full-semantic failure with no classified intrinsic code or resolved owner fails closed as the
existing core `SCHEMA_INVALID`. Rejected output contains only `status` and the existing core issue
code. Accepted output contains the structurally accepted candidate and sorted unique intrinsic-code
and owner arrays; the result, candidate, and arrays are deeply frozen.

The seven intrinsic codes are exactly:

- `CAPTURE_WINDOW_MISMATCH`;
- `CHRONOLOGY_INVALID`;
- `PREPROCESSING_PROVENANCE_INVALID`;
- `OCR_TEXT_INVALID`;
- `OCR_TEXT_HASH_MISMATCH`;
- `PRIVACY_METADATA_INVALID`;
- `RESOURCE_COUNT_MISMATCH`.

The future resolved owners are exactly `COVERAGE`, `SOURCE_ARTIFACT_BINDING`, and
`SOURCE_ARTIFACT_SET`. Owners are routing ledger entries, not final verifier issue codes and not
acceptance. E2-SCHEMA-2B-2B must resolve them against the owned transport, manifest, and artifact
set before producing a final result.

`contracts.ts` now separates `dayflowCoverageStructuralSchema` from the existing full
`dayflowCoverageSchema`; existing public full-schema behavior is preserved. OCR span values may
contain suggestion-like words observed on screen, but strict schemas continue to reject
suggestion-shaped fields. Dayflow remains capture/storage/OCR/privacy preprocessing only and owns
no title, summary, `semanticOutput`, ranking, caveat, availability, or output path.

### 18.2 Closure and remaining gate

Development closure fixed the initial valid-sealing failure by excluding the root detached hash
from the collector preimage, removed a duplicate public refinement found by QA HOLD, added the
resolved-owner ledger and fail-closed fallback for silent full-schema invalidity, and corrected
fixture path, ordinal, and truthfulness defects. Current independent read-only QA-R2 passed with no
finding and no Medium-or-higher issue. Automated QA is not human approval.

Focused validation passed 39/39 with dedicated TypeScript and scoped ESLint. Compatibility passed
six files and 160 tests: snapshot 21, schema 39, importer 10, DFA 90. Full suggestion typecheck
passed in 3.72 seconds and lint in 10.47 seconds. Root architecture dependency checking passed in
6.47 seconds with zero errors, valid coverage of 17 entries and 4 sentinel edges, and the existing
repository 12/suggestion 8/scripts 2 warnings.

Golden/baseline is N/A and no baseline run occurred because no prompt, model, ranking, output,
generation, dataset, live authority, or runtime engine path is connected. LikeC4 needs no update
because no implemented boundary or module connection changed; architecture dependencies were
checked. Synthetic-only tests created, inspected, and stored no live screenshot, OCR, private
data, artifact, or log. Rejections remain redacted and retention is unchanged.

`E2-SCHEMA-2B-2B` capture-only ordering and transport/manifest/resolved verification remains
pending, not authorized, and unimplemented. Common-engine adaptation, run generation, live A/B/C,
and production work also remain pending. Residual optional tests are an intrinsic-default assertion
for each owner helper, combined ordering for all three owners, direct public Zod path/message
ordering, and the redaction-nine category cap.

<!-- current-contract:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:end -->

## 19. E2-SCHEMA-2B Stage 1-9 direct verifier status

This additive section is the current authority for the implemented Stage 1-9 verification seam. It
preserves Sections 1 through 18 as design and implementation history and supersedes their active
wording that leaves E2-SCHEMA-2B-2B unimplemented. It does not authorize Stage 10, an engine
connection, live data, production use, release, or contract freeze.

### 19.1 Public entry point and exact order

The new direct-module-only entry point is
`verifyDayflowPreprocessedEvidenceV0_1(candidateBytes, originalBundle,
expectedImportedBundleDescriptor)`. It accepts exactly three raw caller arguments and is not exported
through a barrel or product API.

The closed order is:

1. capture-only projection owns bounded candidate, bundle, and expected-descriptor values without
   importing;
2. the existing core inspector performs byte, strict JSON, resource, canonical, structural, root
   hash, and intrinsic classification;
3. the detailed importer runs exactly once over a fresh owned bundle and returns its descriptor and
   minimal resolved manifest;
4. Stage 7 compares the candidate, imported descriptor, and expected transport binding;
5. Stage 8 checks resolved-manifest binding, synthetic origin, contract-conformance phase, and study
   protocol;
6. Stage 9 resolves capture window, coverage, source-artifact set and binding, and all intrinsic
   evidence issues;
7. only then is a deeply frozen success or redacted failure returned.

The implementation checkpoints are closed as follows:

| Component | Result |
| --- | --- |
| B1 capture-only projection | implemented, focused-validated, independent QA PASS |
| B2-1 core, single detailed import, Stage 7 and Stage 8 prerequisites | implemented, focused-validated, independent QA PASS |
| B2-2A Stage 9 resolution | implemented, focused-validated, current-head QA PASS |
| B2-2B three-argument facade | implemented, focused-validated, current-head QA PASS |

### 19.2 Public result and issue taxonomy

Success is exactly a frozen `{ valid: true, evidence, issueCodes: [] }` result. `evidence` is
the validated neutral Dayflow evidence artifact; it contains no original bundle, JPEG bytes,
filesystem path, private snapshot state, or mutable caller reference.

Failure is exactly a frozen `{ valid: false, issueCodes: nonEmptyArray }` result. It contains no
candidate, partial evidence, original bundle, JPEG bytes, filesystem path, descriptor value,
underlying exception, or private state.

The public final issue taxonomy is closed:

| Class | Exact codes |
| --- | --- |
| Existing core | `INPUT_INVALID`, `RESOURCE_LIMIT_EXCEEDED`, `JSON_INVALID`, `JSON_DUPLICATE_KEY`, `JSON_NOT_CANONICAL`, `SCHEMA_INVALID`, `HASH_MISMATCH` |
| Transport and protocol | `TRANSPORT_REVERIFY_FAILED`, `TRANSPORT_BINDING_MISMATCH`, `MANIFEST_BINDING_MISMATCH`, `ORIGIN_PHASE_MISMATCH`, `STUDY_PROTOCOL_MISMATCH` |
| Resolved neutral evidence | `CAPTURE_WINDOW_MISMATCH`, `COVERAGE_MISMATCH`, `COVERAGE_CODE_MISMATCH`, `COVERAGE_FAILURE`, `CHRONOLOGY_INVALID`, `PREPROCESSING_PROVENANCE_INVALID`, `OCR_TEXT_INVALID`, `OCR_TEXT_HASH_MISMATCH`, `PRIVACY_METADATA_INVALID`, `RESOURCE_COUNT_MISMATCH`, `SOURCE_ARTIFACT_BINDING_MISMATCH`, `SOURCE_ARTIFACT_SET_MISMATCH` |

The public facade maps internal `BUNDLE_IMPORT_REJECTED` to
`TRANSPORT_REVERIFY_FAILED`. It maps internal
`IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH` and a valid-shaped candidate transport-binding mismatch
to `TRANSPORT_BINDING_MISMATCH`. It maps internal `SNAPSHOT_HANDLE_INVALID` to
`INPUT_INVALID`. A descriptor-to-resolved-manifest mismatch remains
`MANIFEST_BINDING_MISMATCH`. Internal snapshot/importer error objects do not cross this public
facade.

### 19.3 Validation, privacy, and stop boundary

The latest focused closure passed two files and 42 tests. The integration closure passed four files
and 93 tests: core 39, importer 12, and snapshot/final verifier 42. Full suggestion TypeScript and
lint passed. Architecture dependency checking exited zero with no new Dayflow violation, valid
17-entry/4-sentinel-edge coverage, and the existing warnings repository 12, suggestion 8, and
scripts 2. Current-head independent QA for both B2-2A and B2-2B passed with no Medium-or-higher
finding. Earlier 29- and 36-test focused results are superseded evidence, not the final counts.

Historical checkpoint note: the full Vitest unit suite had not yet been run when Section 19 was
first recorded because Colin selected documentation. Section 20 supersedes that deferred status:
`npm test` from `suggestion/` exited 0 with 166 files and 1,531 tests passing and no
failures. This closes only the full-unit validation gate; it does not authorize release or freeze.
No Golden or baseline run applies at this checkpoint because no LLM prompt, model, ranking,
suggestion output, dataset, or runtime engine connection changed.

Dayflow remains limited to capture, storage, OCR, privacy filtering, and neutral preprocessing.
Neither input nor output adds suggestion title, summary, `semanticOutput`, ranking, caveat,
availability, next-action, or final output-path fields. Tests used synthetic data only. No live or
user data, raw private bundle, JPEG, environment value, private artifact, or log was created,
inspected, persisted, or added to retention.

Stage 10, the common Blabase engine adapter and generation, A/B/C execution, live/API/persistence
paths, barrel exposure, provider work, production, release, and freeze remain pending and
unauthorized. The same-engine A/B/C direction is unchanged.

Known Low follow-ups are a facade post-call mutation test, malformed-descriptor versus valid-mismatch
contrast, an exact importer call-count spy, hostile direct `WeakMap.get`/`Reflect.apply` tests, a
full-schema fallback fixture, field-table coverage, and a whole-repository barrel-negative check.
The implementation has one static detailed-import path, but no call-count spy is claimed.

<!-- current-contract:E2-SCHEMA-2B-STAGE1-9-DIRECT-VERIFIER-COMPLETED-2026-08-21:end -->

## 20. E2-FULL-UNIT validation gate closure

This additive validation authority supersedes only Section 19 wording that leaves the full Vitest
unit-suite gate deferred or not run. It does not replace or sum the separate focused two-file/
42-test evidence or the separate integration four-file/93-test evidence.

From `suggestion/`, `npm test` exited 0 with 166 files and 1,531 tests passing, no
failures, Vitest duration 20.05 seconds, and elapsed time approximately 20.26 seconds. This
documentation checkpoint did not edit code or rerun the command.

The full-unit gate is therefore complete. Stage 10, common-engine adaptation and generation, A/B/C
execution, live/API/persistence, provider, product, release, and freeze remain pending and
unauthorized. No baseline, Golden, LikeC4, privacy, retention, or same-engine decision changes.

<!-- current-contract:E2-FULL-UNIT-PASSED-2026-08-21:end -->
