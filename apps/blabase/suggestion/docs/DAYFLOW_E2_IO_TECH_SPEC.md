# Dayflow E2-IO Candidate Technical Specification

**Status:** Candidate design for Colin review; not frozen authority  
**Checkpoint:** E2-IO.1  
**Scope:** Synthetic engineering only; no production or live-data authorization

`E2-IO` is an engineering label for the Dayflow exporter/importer boundary. It is **not** the
existing ablation Plan Stage E2 candidate-discovery stage and does not authorize candidate
discovery, live capture, experiment execution, publication, or production wiring.

## 1. Goal

Define the smallest fail-closed path from an immutable, completed Dayflow screen-evidence bundle
to the existing E1 semantic renderers:

```text
Dayflow completed raw bundle
  -> Blabase pure bundle importer/verifier
  -> separately extracted and verified normalized evidence
  -> existing E1 B/C renderers
```

The importer proves transport completeness, byte integrity, manifest lineage, and privacy-safe
structural constraints. Import alone cannot create normalized evidence. Extraction and
normalization are a separate E2-IO.2B task and must finish with the existing resolved normalized-
evidence verifier before B or C may consume the result.

### Non-goals

This design does not:

- read the live Dayflow database, WAL, filesystem, environment, or process state from Blabase;
- introduce a provider, network, cloud-storage, or production dependency;
- inspect screenshots manually;
- export `applicationHint`, idle state, raw OCR text, or normalized text;
- retain a second raw screenshot copy in Blabase;
- create normalized evidence merely because raw bytes imported successfully;
- execute E1, create a run-results artifact, publish an experiment, or enable live behavior;
- migrate legacy Dayflow captures.

## 2. Current Dayflow flow findings

The present Dayflow capture flow is not a completed evidence-export protocol:

1. A JPEG file is written before the database insert.
2. Database-insert errors are swallowed, so a JPEG may exist without committed metadata.
3. The generated database ID is discarded by the caller and cannot serve as a durable export
   identity.
4. Database time is recorded only to seconds, which is insufficient as a unique ordering or
   replay key.
5. The stored locator is an absolute host path.
6. There is no content checksum, privacy declaration, completed-bundle marker, or immutable
   manifest.
7. A database WAL and an independently written JPEG are not one atomic commit. WAL presence does
   not prove that the referenced file exists, is complete, or has the expected bytes.

Consequently, Blabase must not infer evidence completion from a database row, WAL entry, filename,
mtime, absolute path, or successful JPEG open. E2-IO requires an explicit completed export bundle.

## 3. Recommended defaults pending Colin approval

The following are recommended defaults, not approved policy until Colin explicitly accepts them.

| Decision | Recommended candidate default | Reason |
| --- | --- | --- |
| Initial data class | Synthetic-only | Exercises contracts without exposing human data |
| Capture eligibility | New captures only; legacy captures excluded | Legacy records lack trustworthy completion and checksum lineage |
| Storage/network | Local-only; no cloud, sync, upload, or provider | Keeps the first boundary narrow and auditable |
| Export content | Raw evidence bytes and minimum lineage only | Separates transport evidence from interpretation |
| Excluded fields | No `applicationHint`, idle state, OCR, or normalized text | Minimizes sensitive and unnecessary context |
| Display reference | Opaque bundle-local reference | Prevents absolute-path and host-identity leakage |
| Human viewing | No manual screenshot inspection | Tests verify bytes/contracts without exposing imagery |
| Blabase handling | Pure in-memory or bounded-stream verification; no retained raw copy | Avoids creating another raw-data store |
| Tests | Synthetic bytes under test-owned temporary roots only | Prevents access to real/private roots |
| Raw completed bundle retention | Future pilot maximum 24 hours | Short exposure window for raw frames |
| Canonical pilot frame retention | Future pilot maximum 24 hours | Same raw-image limit; no indefinite exemplar |
| Normalized redacted evidence retention | Future pilot maximum 30 days | Supports bounded evaluation without retaining raw imagery |
| Incomplete staging retention | Maximum 1 hour | Bounds abandoned `.partial` data |
| Backups | Disabled | Prevents retention from silently exceeding policy |

Retention limits describe a possible later pilot. E2-IO.1 and E2-IO.2A do not create cleanup jobs,
delete data, or authorize a pilot. Any deletion mechanism and any real-data retention decision are
separate checkpoints.

## 4. Candidate completed-bundle protocol

### 4.1 On-disk writer layout

Dayflow would construct a unique staging directory and publish it only after completion:

```text
<id>.partial/
  manifest.json
  objects/
    sha256/
      <digest>.jpg
  COMPLETE

atomic rename after completion:
<id>.partial -> <id>
```

`<id>` is an opaque export identity, not a database timestamp or host path. Object names are
lowercase SHA-256 digests of their exact bytes. Display references remain bundle-local and opaque,
for example `bundle-object:<digest>`; they are neither filesystem paths nor public URLs.

`manifest.json` must use the existing strict Dayflow screen-evidence export schema and its existing
detached-hash domain:

```text
blabase.dayflow-screen-evidence-export.v0.1
```

It is canonical JCS UTF-8 plus one LF. Each exported artifact binds its digest, byte length, media
type, capture interval/lineage, privacy facts, and opaque bundle-local object reference. It must not
contain an absolute path, application hint, idle value, OCR, normalized text, credential, or URL.

### 4.2 Candidate completion marker

`COMPLETE` is proposed as a strict transport-envelope record, initially non-registry. Registering
it as a standalone artifact would require a separate registry/version decision. Candidate v0.1
canonical fields are:

```json
{
  "completionSchemaVersion": "dayflow-screen-evidence-bundle-completion-v0.1",
  "bundleId": "<opaque id>",
  "exportId": "<manifest export id>",
  "manifestRelativePath": "manifest.json",
  "manifestByteLength": 0,
  "manifestRawSha256": "<64 lowercase hex>",
  "manifestDetachedSha256": "<existing manifest detached hash>",
  "objectCount": 0,
  "totalObjectBytes": 0,
  "completedAt": "<explicit UTC timestamp>",
  "completionSha256": "<detached hash>"
}
```

The candidate completion detached-hash domain is
`blabase.dayflow-screen-evidence-bundle-completion.v0.1`. Both the schema version and domain remain
pending Colin approval. The marker uses canonical JCS UTF-8 plus one LF.

### 4.3 Writer ordering and crash behavior

The future Dayflow writer must:

1. Reserve a unique `<id>.partial` directory with no-clobber semantics.
2. Write each JPEG to its final digest path inside staging using exclusive creation and no-follow
   behavior; verify exact length and SHA-256; fsync every file.
3. Write `manifest.json` with exclusive creation, verify its canonical bytes and detached hash,
   and fsync it.
4. Reopen and verify every expected staging entry without directory traversal or symlink trust.
5. Write `COMPLETE` last with exclusive creation, verify it, and fsync it.
6. Fsync the staging directory and its required parent directories.
7. Atomically rename `<id>.partial` to the unique final `<id>` on the same filesystem, refusing an
   existing destination, then fsync the parent.

A missing marker, partial object set, failed fsync, cross-filesystem rename, existing target, or
ambiguous result is not complete. Partial state is preserved for bounded later reconciliation; it
is never relabeled, resumed, overwritten, or treated as evidence. Marker-last ordering and atomic
rename establish publication completion; neither substitutes for byte verification.

The Dayflow writer is intentionally deferred to E2-IO.3 because the current JPEG-before-database
flow cannot be made atomic by a Blabase importer. E2-IO.3 should use a post-commit outbox design so
export work is durably scheduled from committed capture metadata without treating the DB and JPEG
as one transaction.

## 5. Blabase pure importer

### 5.1 Proposed boundary

The importer accepts caller-supplied values, never a directory or live-data handle. A candidate
shape is:

```ts
type DayflowEvidenceBundleEntry = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array | AsyncIterable<Uint8Array>;
}>;

type ImportDayflowEvidenceBundleInput = Readonly<{
  mode: "synthetic-contract-conformance";
  bundleId: string;
  entries: readonly DayflowEvidenceBundleEntry[];
}>;
```

An in-memory API and a bounded-stream API may share the same verification core. There is no path
input, filesystem adapter, live DB connection, WAL reader, environment lookup, process lookup,
clock, random source, network client, or storage side effect. Timestamps come from the sealed
bundle and are validated, not generated.

The importer returns only parsed identity/lineage metadata, verified artifact descriptors, opaque
display refs, replay identity, and transient verified bytes or stream-consumer results needed by
the next pure stage. It does not persist a raw copy. Defensive copying is required for in-memory
bytes; streamed bytes are hashed and bounded as they pass and must not be silently buffered beyond
the declared limit.

### 5.2 Required verification

The importer must fail closed unless all of the following hold:

1. Input and nested objects have exact key sets and current candidate versions.
2. `manifest.json` and `COMPLETE` are strict UTF-8, duplicate-aware JSON, canonical JCS plus one
   LF, and contain no duplicate keys at any depth.
3. Bundle ID, export ID, manifest byte length, raw hash, detached hash, object count, total object
   bytes, and completion timestamp agree exactly across input, marker, and manifest.
4. The existing screen-evidence export schema parses the manifest under
   `blabase.dayflow-screen-evidence-export.v0.1`.
5. Every object path is exactly `objects/sha256/<lowercase digest>.jpg`; no empty, absolute, dot,
   dot-dot, slash-confused, backslash, NUL, control-character, percent-decoded, Unicode-confusable,
   or platform-specific alternate path is accepted.
6. Every entry declares `regular-file`. Symlinks, hard-link metadata, devices, directories, and
   caller-provided path handles are outside the API and rejected if represented.
7. Manifest artifact references and supplied object entries form an exact one-to-one bijection:
   no missing blob, extra blob, duplicate path, duplicate digest alias, or unreferenced entry.
8. Declared byte lengths equal consumed bytes and digest filenames equal raw SHA-256. Existing
   `verifyArtifactBlobBytes` performs the artifact-level byte check.
9. Media type, JPEG constraints, capture/privacy lineage, and manifest ordering satisfy the
   existing schema. Parsing a file extension alone is insufficient.
10. The final resolved normalized evidence, when a later stage supplies it, passes
    `verifyResolvedNormalizedEvidence`. The importer must not replace that verifier with a caller
    boolean.

### 5.3 Candidate resource limits

These recommended limits are pending Colin approval and must be constants covered by boundary
tests:

- `manifest.json`: maximum 1 MiB;
- `COMPLETE`: maximum 16 KiB;
- object count: maximum 256;
- individual JPEG: maximum 20 MiB;
- aggregate JPEG bytes: maximum 256 MiB;
- SHA-256: exactly 64 lowercase hexadecimal characters;
- bundle ID and opaque display refs: bounded safe identifiers with no path syntax.

The stream implementation must stop before consuming bytes past a bound. Declared size does not
grant allocation authority, and arithmetic must remain within non-negative safe integers.

### 5.4 Replay semantics

Pure import of the same exact bundle is deterministic and returns the same replay identity. The
candidate replay identity binds `bundleId`, manifest detached hash, completion detached hash, and
ordered object hashes. A repeated bundle with identical bytes is an idempotent verification, not a
new capture. Reuse of a bundle/export ID with different marker, manifest, or object bytes is a
conflict and must fail closed at the orchestration/no-clobber boundary.

The pure importer maintains no global replay database. A future publisher or evaluator must store
the replay identity explicitly if cross-process replay rejection is required. It may not infer
freshness from timestamps or filenames.

## 6. Separation from normalization and E1

A completed raw bundle proves only that a declared set of bytes was published consistently. It
does not prove what appears on screen, produce safe text, create claims, establish confidence, or
authorize B/C output.

E2-IO.2B must separately:

1. consume only a verified synthetic import result;
2. extract and normalize without exposing raw/private fields;
3. construct explicit claim lineage, confidence, coverage, expiry, conflicts, and rejections;
4. seal the current normalized-evidence artifact; and
5. call `verifyResolvedNormalizedEvidence` over the full resolved manifest/artifact/blob inputs.

Only that separately verified result may be supplied to existing E1 B/C. The importer must expose
no shortcut that returns “verified normalized evidence” from raw JPEG import alone.

## 7. Proposed implementation split

### E2-IO.2A — Blabase completion contract and pure importer

Proposed Blabase files:

- new `suggestion/src/evaluation/dayflowAblation/importEvidenceBundle.ts`;
- new focused importer test file;
- possible strict non-registry completion schema in
  `suggestion/src/dayflowEvidence/contracts.ts` if Colin approves that ownership;
- a separate E2 scoped TypeScript config and Vitest config/test target.

A separate E2 closure is recommended so the frozen E1 closure remains 11 source entries, 22 pins,
four commands, and 30 registered classes. E2-IO.2A must not silently add a registry class or modify
E1 source/provenance/command inventories.

### E2-IO.2B — Synthetic normalization/extraction

Implement a pure synthetic extractor/normalizer and full resolved-evidence verification. No live
provider, OCR service, or manual screenshot inspection. This is the first task allowed to create
normalized evidence from verified synthetic bytes.

### E2-IO.3 — Dayflow post-commit outbox exporter

Cross-repository Dayflow work. Add a durable post-commit outbox and completed-bundle writer with
marker-last, fsync, no-clobber, atomic same-filesystem rename, explicit privacy fields, and bounded
staging reconciliation. This task requires separate repository ownership and Colin approval.

### E2-IO.4 — Synthetic roundtrip

Generate a synthetic Dayflow bundle, import and verify it, normalize it through E2-IO.2B, feed the
verified result to E1 B/C, and verify deterministic output and lineage. No real screenshot or
private root is allowed.

### Later live checkpoint

Any actual live capture, real screenshot, 24-hour raw retention, publication, production wiring,
or deletion is a later separately authorized decision. Completion of E2-IO.2A through E2-IO.4 does
not imply that authorization.

## 8. Acceptance tests

E2-IO.2A should include focused tests for:

1. deterministic acceptance of an exact synthetic completed bundle in both in-memory and
   chunked-stream forms;
2. current manifest schema and detached-domain verification;
3. strict candidate completion version, canonical bytes, detached hash, and cross-binding;
4. duplicate JSON keys at every manifest/marker depth;
5. missing `COMPLETE`, missing manifest, missing object, extra object, duplicate entry, duplicate
   digest alias, and reordered/renamed special files;
6. manifest raw-hash, detached-hash, byte-length, object-count, aggregate-size, object-hash, JPEG,
   export-ID, bundle-ID, and timestamp mismatch;
7. absolute paths, `.`/`..`, slash/backslash variants, NUL/control characters, Unicode/path
   confusion, symlink-like entry kinds, and unsafe opaque refs;
8. exact boundary acceptance and one-byte-over rejection for marker, manifest, per-object, object
   count, aggregate bytes, identifier length, and streamed chunk totals;
9. caller-buffer mutation before/after parse and defensive-copy behavior;
10. exact replay determinism, identical replay identity, and conflicting ID/content rejection at
    the no-clobber orchestration seam;
11. proof that import output is not normalized evidence and cannot be passed to E1 B/C without the
    separate verified normalization stage;
12. reuse of `verifyArtifactBlobBytes` and, in integration-only tests, rejection when
    `verifyResolvedNormalizedEvidence` fails;
13. no filesystem, live DB, WAL, environment, process, clock, random, network, provider, cloud,
    publication, or production capability in the importer module;
14. synthetic temporary-root tests only for any future transport adapter, with no listing or
    access outside the test-owned root and no manual image viewing.

E2-IO.3 later requires independent crash-point tests before/after every write, fsync, marker, and
rename; same-ID concurrency tests; cross-filesystem rejection; outbox replay tests; and proof that
a swallowed DB insert or orphan JPEG can never become a completed bundle.

## 9. Risks and mitigations

| Risk | Mitigation / required gate |
| --- | --- |
| Current JPEG and DB writes are not atomic | Defer export to E2-IO.3 post-commit outbox; never import DB/WAL directly |
| Crash leaves `.partial` state | Marker-last, fsync, atomic rename; partial never counts as complete |
| Rename is not atomic across filesystems | Require staging/final directories on one pinned filesystem and reject otherwise |
| Symlink, traversal, or TOCTOU substitution | Importer accepts bytes/entries, not paths; exporter later uses pinned no-follow descriptors and readback |
| Absolute path or host identity leaks | Opaque bundle-local refs only; strict public/private text guards remain downstream |
| JPEG metadata contains sensitive data | Synthetic-only first; future exporter must define metadata stripping before real approval |
| Raw image retention expands silently | 24h proposed maximum, staging 1h, backups disabled; retention implementation is a separate gate |
| Import success is mistaken for semantic verification | Type and API separation; only E2-IO.2B can produce normalized evidence |
| Stream size declarations cause memory pressure | Incremental hashing, hard byte limits, safe-integer accounting, no unbounded buffering |
| Replayed ID is treated as new evidence | Deterministic replay identity plus later no-clobber ledger; timestamps never establish uniqueness |
| Completion schema causes registry/version cascade | Keep candidate marker non-registry in E2-IO.2A unless Colin separately approves registration |
| E2 work mutates frozen E1 closure | Use separate E2 scoped TypeScript/Vitest closure and commands |
| Legacy captures lack completion lineage | Exclude all legacy captures; only new exporter-produced bundles are eligible |

## 10. Colin decisions required

Before implementation, Colin must decide each of the following:

1. Approve or revise the recommended defaults: synthetic-only, new captures only, local-only, raw
   evidence only, excluded application/idle/text fields, opaque refs, no manual viewing, no retained
   Blabase raw copy, synthetic temp-root tests, 24h/30d/1h retention limits, and backups disabled.
2. Approve `COMPLETE` as a strict non-registry transport record with candidate version
   `dayflow-screen-evidence-bundle-completion-v0.1` and candidate hash domain
   `blabase.dayflow-screen-evidence-bundle-completion.v0.1`, or request a different contract.
3. Approve or revise the proposed 1 MiB / 16 KiB / 256 objects / 20 MiB per JPEG / 256 MiB total
   importer bounds.
4. Approve E2-IO.2A ownership: new pure importer and test, possible completion schema addition, and
   separate E2 scoped TypeScript/Vitest closure with no E1 registry/closure mutation.
5. Confirm that E2-IO.2B normalization, E2-IO.3 cross-repository Dayflow exporter, E2-IO.4
   roundtrip, and any live-data checkpoint remain separately authorized tasks.

### Recommended approval bundle

Approve decisions 1–5 as written and authorize **E2-IO.2A only**. Hold E2-IO.2B, E2-IO.3,
E2-IO.4, legacy migration, real capture, retention enforcement, publication, and production work
until their individual checkpoints. This keeps the first implementation pure, synthetic,
bounded, and reversible while preserving the frozen E1 boundary.


---

## 2026-08-20 implementation-status and supersession appendix

This appendix is current for E2-IO.2A only. It preserves earlier design and
diagnostic text while superseding claims that E2-IO.2A is proposed, pending,
blocked, or dependent on a David review gate.

### Accepted implementation status

Colin accepted the design through the implementation, focused-validation
correction, independent-QA, and documentation checkpoint instructions. Colin is
the sole owner, reviewer, and decision authority. David has no required role or
artifact.

`E2-IO.2A` is complete for synthetic, in-memory, transport-only import:

| Contract item | Accepted value |
| --- | --- |
| Completion schema | `dayflow-screen-evidence-bundle-completion-v0.1` |
| Completion hash domain | `blabase.dayflow-screen-evidence-bundle-completion.v0.1` |
| Import schema | `dayflow-screen-evidence-bundle-import-v0.1` |
| Replay hash domain | `blabase.dayflow-screen-evidence-bundle-replay.v0.1` |
| Maximum objects | 256 |
| Maximum bytes per object | 10 MiB |
| Maximum aggregate object bytes | 256 MiB |

Limits are checked before copying. The importer rejects invalid UTF-8,
duplicate keys including escaped aliases, noncanonical JSON, completion
self-hash or manifest-binding substitution, unsafe/non-regular/duplicate/extra/
missing entries, digest/length/filename/MIME mismatch, and unframed JPEG
transport.

Caller entry order is not authoritative. One exact manifest/entry bijection is
verified, and any ordering of the same set derives one replay identity.

Success returns this frozen primitive-only descriptor:

```text
importSchemaVersion
manifestRawSha256
manifestDetachedSha256
completionSha256
objectCount
totalObjectBytes
replayIdentitySha256
```

Manifest data, paths, idle metadata, blob bytes, normalized evidence, semantic
verification, source state, and runtime capabilities are excluded. The strict
parser is capability-free. The E2 closure exposes no dataset builder,
filesystem, network, environment, provider, clock, random, normalization,
rendering, publication, or live operation.

### Verification and applicability

Final focused evidence: TypeScript 5.9.3 PASS; ESLint 9.39.5 PASS on four exact
TS targets; Vitest 3.2.7 PASS with 1 file/10 tests; dependency-cruiser 18.2.0
PASS with 0 errors; independent read-only QA PASS with no
Critical/High/Medium finding. Existing warnings remain repository 12,
suggestion 8, scripts 2; coverage was 17 entries/4 sentinel edges. Earlier
author-test failure and QA HOLD are superseded diagnostic history.

No normalized evidence or E1 B/C run occurred. Dataset/version/hash, run IDs,
comparison metrics, model/provider, tokens, latency, and production baseline
are N/A. The targeted regression is the recorded validation because this
transport-only tooling does not change semantic output, filtering, ordering,
selection, or interpretation.

Pending and not implied by this closure: E2-IO.2B, E2-IO.2.3, E2-IO.2.4, live
Dayflow/filesystem access, exporter and retention policy, normalized/semantic
evaluation, provider, production, publication, or release authority.

Privacy claims are limited to the synthetic test scope. No actual
Dayflow/private or `.local` data, filesystem/network/environment/provider
access, production/publication path, raw retention, or manual private-data
inspection was used.

Known Low residuals are SOI/EOI-only JPEG framing, chronology relying on
canonical UTC, and absent exact-limit success/deep-JSON performance tests. A
separately approved successor may address these or remove only the five E2 files;
no migration or data cleanup is required.


---

<!-- current-tech-spec:E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:begin -->

## Successor role boundary: preprocessing input, not suggestion output

This section supersedes any conflicting E2-IO.2B candidate text in this document. The earlier
candidate must not be implemented where it creates suggestion-shaped normalized evidence or feeds
the existing B overlay and separate C renderer.

### Component ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| Dayflow | capture, storage, OCR, privacy filtering, preprocessing, neutral observations, confidence, coverage, provenance, conflicts and typed errors | final suggestion title/summary, ranking, caveats, suggestion availability, next-action judgment |
| E2-IO.2A | immutable bundle transport, manifest/hash/size validation and replay identity | OCR interpretation, semantic inference or suggestion generation |
| Blabase evidence adapter | strict verification and mapping of neutral Dayflow observations into the common engine input | arm-specific copy, ranking or final suggestions |
| Blabase suggestion engine | LLM request, suggestion generation, validation, filtering, ranking, caveats and final schema | Dayflow storage or capture lifecycle |

The required data flow is:

Dayflow capture/store/OCR/preprocess
-> DayflowPreprocessedEvidence vNext
-> Blabase common evidence adapter
-> Blabase common suggestion engine
-> Blabase suggestion output

A, B, and C use the same engine identity and differ only by evidence composition. Dayflow may
supply privacy-minimized OCR text/spans, neutral application/window/activity observations,
capture intervals, confidence, coverage, provenance, preprocessing versions, conflicts, omissions,
and typed errors. It must not supply semanticOutput, final title/summary, caveats, ranking,
suggestion availability, RECENT_FOCUS, VISIBLE_TASK_INTENT, or final output-field paths.

### Compatibility and status

E2-IO.2A remains complete and compatible because it returns only primitive integrity and replay
facts. Existing E1 semantic contracts, fixtures, renderer versions, and hashes remain immutable
historical records but are not compatible execution authority for this successor design. A new
contract version and new fixture/config hashes are required; no compatibility union or in-place
mutation is authorized by this documentation task.

This section defines design authority only. E2-IO.2B remains not authorized until E2-SCHEMA-1 is
separately approved, implemented, validated, reviewed, and recorded.

<!-- current-tech-spec:E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:end -->


---

<!-- current-tech-spec:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:begin -->

## Successor implementation status: E2-SCHEMA-2A pure core

`E2-SCHEMA-2A` is complete for the isolated synthetic-only schema, sealer, serializer, and
canonical parser. The implementation uses schema `dayflow-preprocessed-evidence-v0.1`, verifier
`dayflow-preprocessed-evidence-verifier-v0.1`, detached-hash domain
`blabase.dayflow-preprocessed-evidence.v0.1`, and binds exactly to the completed E2-IO.2A import
schema `dayflow-screen-evidence-bundle-import-v0.1`.

The pure core accepts only strict neutral OCR evidence with transport binding, coverage, privacy,
confidence, provenance, omissions, and typed failures. It rejects unknown fields and legacy
suggestion-shaped normalized evidence. Final titles, summaries, `semanticOutput`, rank, caveats,
suggestion availability, next-action labels, and output-field pointers remain forbidden.

The implemented safety boundary includes one 512-KiB canonical-document cap across seal,
serialize, and parse; iterative strict JSON syntax, decoded-duplicate, and depth handling; and an
intrinsic byte snapshot with unsafe-buffer `INPUT_INVALID` precedence. JCS plus one LF and the
domain-separated detached hash are checked deterministically.

Final evidence is dedicated Vitest 29/29, dedicated TypeScript PASS, targeted ESLint PASS, E2
importer 10/10, DFA regression 90/90, five files and 129 tests in the compatibility matrix, full
suggestion TypeScript and lint PASS, and architecture dependency PASS with zero errors. Existing
warnings remain repository 12, suggestion 8, and scripts 2. Independent read-only QA passed for
the final F2a, F2b.1, and F2c.1 scopes with no Medium-or-higher finding.

E2-IO.2A remains unchanged. `E2-SCHEMA-2B`, including an importer adapter, owned bundle snapshot,
and fresh bundle re-verification, is pending and not authorized. The common Blabase engine adapter,
run generation, live data, and A/B/C execution also remain pending. No dataset, baseline, model,
prompt, engine result, private artifact, real screenshot, or live OCR was changed or inspected.

<!-- current-tech-spec:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:end -->


---

<!-- current-tech-spec:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:begin -->

## Successor implementation status: E2-SCHEMA-2B-1 owned snapshot

`E2-SCHEMA-2B-1` is implemented, validated, and read-only QA-reviewed for a synthetic-only,
evaluation-only owned snapshot. Version
`dayflow-preprocessed-evidence-verification-snapshot-v0.1` creates an opaque ephemeral `WeakMap`
handle, owns fixed copies of candidate and bundle bytes, returns only fresh copies, immediately
reimports the owned bundle through the unchanged E2-IO.2A importer, and binds the result to the
exact seven-field expected import descriptor.

The preflight sequence is strict. It validates bounded projected data shape, lexical paths,
`bundleId`, controls, counts, and entry classes before byte handling; validates every typed-array
view before any cap result; applies candidate/per-entry/aggregate caps before copying; then copies
and reimports. Expected enumerable properties must be own data descriptors. Enumerable extras are
found with bounded early exit. Proxies and unsafe typed arrays fail closed. Symbols and
non-enumerable extras are intentionally ignored and are not retained.

Errors are limited to `INPUT_INVALID`, `RESOURCE_LIMIT_EXCEEDED`, `BUNDLE_IMPORT_REJECTED`,
`IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH`, and `SNAPSHOT_HANDLE_INVALID`, with sanitized fixed
messages. No raw byte, path, private value, caller exception, or mutable caller reference crosses
the boundary.

Focused checks passed: snapshot Vitest 21/21, dedicated TypeScript, and targeted ESLint.
Compatibility passed for six files and 150 tests: snapshot 21, schema 29, importer 10, DFA 90.
Full suggestion typecheck and lint passed. Root architecture dependency checking passed with zero
errors, valid 17-entry/4-sentinel-edge coverage, and the existing repository 12/suggestion 8/
scripts 2 warnings. Final read-only QA3 passed with no High or Medium finding.

This checkpoint does not parse `dayflow-preprocessed-evidence-v0.1`, does not resolve manifest
artifacts into semantic frame verification, and does not implement suggestion semantics, the
common-engine adapter, runtime integration, live capture, or A/B/C execution. E2-SCHEMA-2B-2 is
pending and not authorized. E2-IO.2A and the E2-SCHEMA-2A public APIs are unchanged.

No Golden/baseline run applies, no runtime engine behavior changed, and no real screenshot, OCR,
or private artifact was created, inspected, or persisted. LikeC4 is not applicable to this
unconnected evaluation-only capability; dependency closure was checked.

<!-- current-tech-spec:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:end -->


---

<!-- current-tech-spec:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:begin -->

## Successor implementation status: E2-SCHEMA-2B-2A staged inspection

`E2-SCHEMA-2B-2A` is complete for internal structural inspection only. The new internal function
`inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification` accepts owned raw bytes,
applies the existing byte/JSON/cap/canonical checks, validates the layered structural schema,
checks the existing detached root hash, and then returns either a redacted core rejection or a
deeply frozen candidate with sorted unique intrinsic issues and future resolved-owner entries.
It is not barrel- or product-exposed.

Public parser, sealer, serializer, core codes, canonical bytes, hash domain, E2-IO.2A importer, and
E2-SCHEMA-2B-1 snapshot APIs are unchanged. The coverage schema was internally layered with
`dayflowCoverageStructuralSchema`, while existing `dayflowCoverageSchema` behavior remains intact.
Unclassified full-semantic invalidity fails closed as `SCHEMA_INVALID`.

Intrinsic codes are `CAPTURE_WINDOW_MISMATCH`, `CHRONOLOGY_INVALID`,
`PREPROCESSING_PROVENANCE_INVALID`, `OCR_TEXT_INVALID`, `OCR_TEXT_HASH_MISMATCH`,
`PRIVACY_METADATA_INVALID`, and `RESOURCE_COUNT_MISMATCH`. `COVERAGE`,
`SOURCE_ARTIFACT_BINDING`, and `SOURCE_ARTIFACT_SET` are future resolved owners only. They are not
final issue codes or acceptance decisions.

Focused validation passed 39/39, dedicated TypeScript, and scoped ESLint. Compatibility passed six
files and 160 tests: 21 snapshot, 39 schema, 10 importer, and 90 DFA. Full suggestion typecheck
passed in 3.72 seconds, lint in 10.47 seconds, and root architecture dependencies in 6.47 seconds
with zero errors, 17-entry/4-sentinel-edge coverage, and existing warnings 12/8/2. Independent
read-only QA-R2 passed with no finding or Medium-or-higher issue.

This layer does not order capture-only verification with the owned snapshot, resolve coverage or
artifacts against the manifest, or issue a final resolved-verifier result. Those are
E2-SCHEMA-2B-2B and remain unimplemented and not authorized. There is no engine adapter, A/B/C
generation, live path, or production authority.

No Golden/baseline run applies or occurred. No runtime semantic behavior, LikeC4 boundary, privacy
retention, or live/private data handling changed. OCR values may contain observed suggestion-like
terms as untrusted data; suggestion-shaped fields remain rejected.

<!-- current-tech-spec:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:end -->

## Successor implementation status: E2-SCHEMA-2B Stage 1-9 verifier

This additive status supersedes only the preceding active statement that E2-SCHEMA-2B-2B is
unimplemented. Stage 1-9 is now implemented and validated through the direct-module-only raw
three-argument `verifyDayflowPreprocessedEvidenceV0_1` facade. It is not a product API, release,
or frozen contract.

The enforced flow is capture-only ownership, existing core inspection, one detailed importer call,
Stage 7 exact transport binding, Stage 8 manifest/origin/phase/protocol prerequisites, and Stage 9
capture-window/coverage/source/intrinsic resolution. B1 projection, B2-1 prerequisites, B2-2A
resolution, and B2-2B facade are each implemented, focused-validated, and independently QA-reviewed
with PASS. Current-head B2-2A and B2-2B QA found no Medium-or-higher issue.

The existing public core parser, sealer, serializer, E2-IO.2A importer, and E2-SCHEMA-2B-1 snapshot
APIs remain compatible. The detailed importer, capture-only snapshot operation, staged functions,
and final verifier are direct-module seams only. The final facade maps internal
`BUNDLE_IMPORT_REJECTED` to `TRANSPORT_REVERIFY_FAILED`; internal
`IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH` and a valid-shaped candidate transport-binding mismatch
to `TRANSPORT_BINDING_MISMATCH`; internal `SNAPSHOT_HANDLE_INVALID` to
`INPUT_INVALID`; and descriptor-to-resolved-manifest mismatch to
`MANIFEST_BINDING_MISMATCH`. Success exposes only frozen neutral evidence; failure exposes only
a non-empty issue-code array.

Latest focused validation passed two files/42 tests. Integration passed four files/93 tests:
core 39, importer 12, snapshot/final 42. Full suggestion typecheck and lint passed. Architecture
dependency checking exited zero with no new Dayflow violation, 17-entry/4-sentinel-edge coverage,
and existing warnings repository 12/suggestion 8/scripts 2. Earlier focused 29 and 36 counts are
historical and superseded.

The full Vitest unit suite was not run because Colin selected documentation and remains a required
pre-release/pre-freeze gate. Golden/baseline and LikeC4 updates are N/A here: no LLM prompt, model,
ranking, suggestion output, implemented system boundary, container, or runtime engine connection
changed.

Dayflow still provides capture/storage/OCR/privacy preprocessing only. No suggestion title, summary,
`semanticOutput`, ranking, caveat, output path, live data, API, persistence, or production
authority is added. No raw bundle, JPEG, path, private state, environment value, or user data crosses
the result boundary or was operated on during this checkpoint.

Stage 10, the shared Blabase engine adapter and generation, live A/B/C execution, barrel exposure,
release, and freeze remain pending and unauthorized. A/B/C must still use the same future Blabase
engine.

<!-- current-tech-spec:E2-SCHEMA-2B-STAGE1-9-DIRECT-VERIFIER-COMPLETED-2026-08-21:end -->

## Successor validation status: E2-FULL-UNIT passed

This additive status supersedes only the preceding deferred full-unit gate. From
`suggestion/`, `npm test` exited 0: 166 files and 1,531 tests passed with no failures,
Vitest reported 20.05 seconds, and elapsed time was approximately 20.26 seconds.

The focused two-file/42-test and integration four-file/93-test closures remain separate recorded
evidence; neither is replaced by or added to the full-unit total. No command was rerun and no code
was edited during this documentation checkpoint.

This closes validation only. It does not authorize Stage 10, common-engine integration, generation,
A/B/C execution, live/API/persistence, product use, release, or freeze. Baseline, Golden, LikeC4,
privacy, retention, neutral-evidence, and same-engine boundaries remain unchanged.

<!-- current-tech-spec:E2-FULL-UNIT-PASSED-2026-08-21:end -->
