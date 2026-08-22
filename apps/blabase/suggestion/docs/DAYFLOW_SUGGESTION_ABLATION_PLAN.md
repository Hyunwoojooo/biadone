# Dayflow Suggestion Ablation Plan

Status: Draft, planning only  
Branch: `experiment/dayflow-suggestion-ablation`  
Blabase base commit: `92b2ca94fc3e8347261ac6a85a627c8e6c915400`  
Dayflow repository HEAD: `df3c367edb7d405a78d1ae76edffe4ba366f57d7`  
Reference document SHA-256: `bfc38c0c22aa594711db04e87210f7b64d82802d1b8d93d5be28d39ad0dc8b39`  
Reference document source ID: `dayflow:docs/BLABASE_DAYFLOW_DATA_ARCHITECTURE.md`

## Current governance authority (2026-08-19)

이 절은 이 문서의 기존 David 전용 review/receipt/approval 지시보다 우선하는 현재
운영 규칙이다. 기존 문구와 ECR은 당시 설계와 감사 이력으로 보존하지만 새로운
아티팩트나 실행 권한을 만들지 않는다.

- `colin`은 개발자, 실험 소유자, 결과 검토자와 최종 의사결정자다.
- `david`는 필수 reviewer, signer 또는 approver가 아니다. David를 위해 별도 review
  package, authenticated receipt, proposal, decision 또는 freeze를 만들지 않는다.
- 기술 QA와 자동 검증은 유지하지만 Colin의 제품 판단을 대체하지 않는다.
- A/B/C blind output review는 제거하지 않는다. 동일한 frozen input에 대한 결과를
  `colin`이 blind 상태로 평가하고, arm 공개 뒤 최종 결정을 기록한다.
- 현재 `TrustedHumanReviewChannel`, `TrustedContractDecisionChannel`,
  `dfa-human-review-receipt`, David-bound `H-DFA-CONTRACT`, 그리고
  `ContractFreezeProposal -> decision -> freeze` 흐름은 active 실행 경로가 아니다.
  해당 source/test 계약의 제거 또는 축소는 별도 구현 Task에서 수행한다.

현재 권장 흐름은 다음과 같다.

```text
DFA-002/DFA-002A technical candidate and automated QA
  -> Colin freezes one experiment protocol/config and common evaluation input
  -> experiment-manifest.json
  -> A/B/C executions on that exact frozen input
  -> run-results.json
  -> Colin blind review and arm reveal
  -> comparison-report.md
  -> colin-decision.md
```

최소 아티팩트는 위 네 개뿐이다. `experiment-manifest.json`은 input, code, schema,
configuration, command와 SHA-256을 기록한다. `run-results.json`은 arm별 run ID와 원시
평가 결과를 기록한다. `comparison-report.md`는 비교 지표, guardrail과 limitation을
기록한다. `colin-decision.md`는 최종 판단, 이유, 후속 조건과 rollback을 기록한다.
Private/raw 결과는 ignored `.local/`에 두고 Git에 넣지 않는다. SHA-256, restrictive
file mode와 no-clobber publication이면 충분하며 David용 HMAC/receipt chain은 요구하지
않는다.

현재 중단된 evidence regeneration/publisher는 실행하지 않는다. 기존 ten-candidate
seven-artifact private chain은 stale historical evidence로 그대로 보존하고, 단순한 Colin용
대체 아티팩트가 생성·검증된 뒤 별도 파괴적 작업 승인에서만 삭제할 수 있다.

## 0. DFA-000 approved synthetic scope

DFA-000은 단일 Draft Engine Change Record
`ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17`에 기록된 사용자의
명시적 scope 승인으로 완료됐다. 이 승인은 synthetic planning/implementation boundary만
허용하며 contract, Dayflow cross-repository 변경, live collection, pilot, E2, production,
release 승인이 아니다. 별도 machine-generated scope artifact나 approval chain은 사용하지
않는다.

Normative 순서는 다음과 같다.

```text
human scope approval recorded in the Draft ECR
  -> Colin's exact two-path DFA-000 scope amendment
  -> DFA-001 planned.c4/planned view source
  -> standard repository architecture commands and readable results
  -> independent QA of planned-only boundary
  -> DFA-002 strict source schemas + synthetic fixtures + tests
  -> Colin-approved DFA-002A local governance adapters in two exact tracked paths
  -> Colin-only governance source/test simplification
  -> Colin freezes the common protocol/config/input
  -> experiment manifest + run results + comparison report + Colin decision
  -> DFA-002 complete
  -> DFA-003 only after separate H-CROSS-REPO
```

DFA-000~002A에서 변경 가능한 tracked path는 ECR에 열거된 Plan, Runbook, ECR,
`architecture/planned.c4`, planned content만 담는 `architecture/views.c4`, 그리고
17개 DFA-002/DFA-002A synthetic source/config/fixture/test/tool path뿐이다. 2026-08-18에 `colin`은
기존 allowlist에 정확히 `suggestion/tsconfig.dayflow-dfa002.json`과
`suggestion/vitest.dayflow-dfa002.config.ts` 두 path만 추가하는 human-reviewed scope
amendment를 승인했다. 이어서 전체 DFA-002A recommendation 직후의 `다음 작업 진행해`로
정확히 `suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts`와
`suggestion/tests/dayflowGovernanceAdapters.test.ts` 두 path 및 Section 0.4의 bounded local
capabilities를 승인했다. 두 결정 모두 다른 path, human signing, contract approval, live,
runtime, production 또는 release authority를 추가하지 않는다. 그 밖의 tracked path는
새 human-reviewed ECR scope decision 없이는 변경하지 않는다.

### 0.1 DFA-001 evidence

DFA-001은 기존 repository workflow를 사용한다. Blabase root에서 다음 exact commands를
실행하고 current planned-source hashes, command result와 readable output 또는 artifact
path를 기록한다.

```text
npm run arch:model:format:check
npm run arch:sources:check
npm run arch:model:check
npm run arch:model:build
```

2026-08-17 closure evidence는 다음과 같다.

- `architecture/planned.c4` raw SHA-256:
  `56b48e0049220e928398cbae636b46c89a7c9ba03141dc3044bcf186a1ecadfb`.
- `architecture/views.c4` raw SHA-256:
  `f92c7e5ec197bc7145901feb3941fc18965c736cc83fbeb7c38d57e5e294b8f4`.
- `arch:model:format:check`: PASS.
- `arch:sources:check`: PASS, 49 links.
- `arch:model:check`: PASS, 5 files.
- `arch:model:build`: PASS; output은 ignored architecture artifact뿐이다.
- Semantic `rg`: PASS; implemented model/dynamics/production 경로로 Dayflow leakage가 없다.
- Independent QA: PASS; Medium 이상 finding이 없다.

Independent QA는 diff와 결과를 직접 읽고 다음을 확인한다.

- Dayflow는 `architecture/planned.c4`와 planned view에만 나타난다.
- `architecture/model.c4`, dynamics, implemented view와 production import는 바뀌지 않는다.
- Generated build output은 ignored `artifacts/architecture/` 아래에만 있다.
- 실패, 누락, stale 결과는 통과로 간주하지 않는다.

이는 planning-only architecture validation이며 core engine baseline은 N/A다. 위 evidence로
DFA-001은 `completed`다. DFA-002의 pre-DFA-002A ten-file contract-only candidate validation과
external QA는 완료됐지만, approved two-file expansion으로 그 machine bundle은
stale/abandoned가 됐다. Nested work package DFA-002A의 구현과 기술 검증은 `completed`다.
DFA-002의 closed machine status는 `pending`이며, 다음 조건은 fresh David/proposal chain이
아니라 Colin-only governance source/test simplification과 네 개 최소 아티팩트 계약이다.
현재 prose label은 "DFA-002A technically complete; Colin-only DFA-002 simplification pending"이다.

### 0.2 DFA-002 proposal and contract freeze

DFA-001 evidence와 independent QA가 완료된 뒤에만 DFA-002 source schemas, synthetic
fixtures와 tests를 구현한다. Reproducibility record는 다음을 포함한다.

- allowed source/config/fixture/test file별 SHA-256과 known base/code provenance,
- `package-lock.json` 및 relevant package/tool version,
- exact commands, timestamps, exit codes와 readable results,
- targeted tests, typecheck, lint, 그리고 import 변경 시 `arch:deps:check`,
- data/schema/rule/prompt/model/config IDs 중 해당되는 값과 명시적 `notApplicable` 사유.

이는 source-level reproducibility이며 hermetic node_modules 또는 host proof를 주장하지
않는다. DFA-002A 구현/검증 뒤 candidate가 준비되면 source-pin set, exact 12-file
candidate/10-file command-defining input set, 네 immutable command receipt v0.1, full-content readable diff
v0.3와 이를 결속한 machine-evidence bundle v0.3를 먼저 만든다. Command receipt는 raw
output의 length/hash만 보존하고 bounded sanitized text와 redaction metadata를 결속한다.
그 뒤 authenticated `david` human-review receipt v0.3가 unchanged machine bundle을
`confirmed`한 경우에만 이 refs를 담은 immutable `ContractFreezeProposal` v0.4를 만든다.
Human `H-DFA-CONTRACT`는 이미 존재하는
proposal을 승인하거나 거절할 뿐 proposal을 생성·수정하지 않는다. 승인된 proposal을
그대로 결속한 freeze를 publish/readback한 뒤에만 strict TypeScript schemas, registry,
fixtures/vectors가 normative가 되고 DFA-002가 완료된다. Candidate byte, dependency,
config, fixture 또는 check result가 바뀌면 새 proposal과 새 human decision이 필요하다.

Pending human-role assignment은 proposer/working owner와 owner reviewer `colin`,
authenticated independent reviewer `david`다. 이는 2-of-2 approval rule이 아니다.
Proposal v0.4는 `proposerPseudonym: colin`과 별도
`independentHumanReviewReceiptRef`를 가진다. 그 ref는 trusted channel에서
`reviewerPseudonym: david`, `decision: confirmed`로 인증된 human-review receipt v0.3여야
한다. H-DFA-CONTRACT decision v0.4의 단일 `approverPseudonym`은 literal `david`이고 같은
human-review receipt를 참조한다. `colin`의 owner review/confirmation은 workflow prose이며
두 번째 decision field가 아니다. External QA PASS는 David의 authenticated confirmation
또는 H-DFA-CONTRACT decision을 대신하지 않는다. 아직 어느 human-review receipt,
proposal, decision, approval 또는 freeze도 존재하지 않는다.

### 0.3 Fixed safety boundary and status

DFA-000~002A는 local-only synthetic work다. Raw human conversation, screenshot, actual
Dayflow blob, production data, credential 또는 secret을 읽거나 fixture로 만들지 않는다.
Dayflow repository write/build/run, DB/WAL/screenshot read, macOS capture API,
network/provider/telemetry/cloud, production store/route/action 또는 production integration은
금지한다. Dayflow 문서/source pin은 read-only reference다. Generated private artifacts는
ignored `.local/` 또는 `artifacts/architecture/`에만 두며 Git에 넣지 않는다.

현재 task status는 다음과 같다.

```text
DFA-000  completed
DFA-001  completed
DFA-002  pending  <- Colin-only governance source/test simplification required
DFA-002A completed <- bounded local governance implementation and technical QA complete
DFA-003+ deferred_and_fail_closed
```

아래 detailed wire/data contracts는 DFA-002 candidate acceptance sketch다. Core A0/A1/B/C
design, immutable data DAG, privacy/retention, live approvals와 fail-closed rules는 유지된다.
Exact experiment schemas는 Colin이 common protocol/config/input을 고정하고 단순화된
manifest 계약을 확인한 뒤에만 해당 실행에 normative다.

2026-08-18 corrected final candidate evidence는 dedicated dependency-cruiser PASS (6 modules/9
dependencies), explicit ESLint PASS, scoped TypeScript PASS, targeted Vitest 3 files `75/75`
PASS다. Full suggestion typecheck와 lint도 PASS했고 root `arch:deps:check`는 0 errors로 exit
0이며 기존 warnings는 repository 12, suggestion 8, scripts 2다. External QA도 PASS했다.
Pre-DFA-002A exact 10-file byte/hash manifest와 current 36-row registry/version/domain tuple은
`ECR-DFA-002-CONTRACT-CANDIDATE-V0.4-REAL-BASE-2026-08-18`에 기록한다. Contract-only이며 production
semantic behavior와 Golden Dataset을 바꾸지 않았으므로 baseline은 N/A다. 이 manifest와
그 existing current machine bundle은 DFA-002A scope approval 뒤 proposal input으로는
stale/abandoned다. 새 두 file의 bytes, hashes, implementation results는 아직 존재한다고
주장하지 않으며, David review 전 fresh 12-candidate/10-command-input chain을 재생성한다.

Schema-valid `.local` `ContractFreezeProposal`은 만들지 않았다. Proposer `colin`, owner
reviewer `colin`, authenticated reviewer `david`의 pseudonym assignment은 기록됐지만
current-authoritative source-pin, command receipts, readable diff v0.3, machine-evidence bundle
v0.3, `david`의 authenticated human-review receipt와 두 사람의 실제 contract confirmation은
아직 없다. Prior source pin `dfa002.source-pin.936ddf31a62727536ff2b01e24f46695`와 그
validation-input hash `622f5525e5bf167b3f6b3b6046762b784af80fdde11ed2915322cf1426fe85f4`를
공유하는 네 command receipt는 real-base correction 전 evidence라 stale/abandoned다. 이들은
proposal authority가 아니며 private quarantine에서 safe purge/replacement가 pending이다.
그 exact receipt IDs는
`dfa002.receipt.dfa002-depcruise.4d7334bf80994292d38ed638a812ccfb`,
`dfa002.receipt.dfa002-eslint.c2d1862b99b5eae98e9b918cfd13de6f`,
`dfa002.receipt.dfa002-tsc.5062dce85b75e9b1e4e871236343d567`,
`dfa002.receipt.dfa002-vitest.b62241f69b04682e2bc3d4092e93f793`다.
Existing command summaries와 external QA result를 schema artifact로 추정하거나 합성하지
않는다. 다음 human-gated 단계는 authoritative evidence를 새로 결속한 proposal
assembly와 이후 `david`가 단일 independent approver로 기록할 `H-DFA-CONTRACT` 결정이다.
Approval, decision artifact,
freeze, runtime, live, production, store, CLI 또는 screen capability는 없다.

### 0.4 DFA-002A approved local governance package

`colin`은 전체 recommendation 직후 `다음 작업 진행해`라고 지시해 이 package를 명시적으로
승인했다. DFA-002A는 DFA-002 안의 bounded work-package label이며 closed machine task enum을
추가하지 않는다. 따라서 machine `currentTask`는 `DFA-002`, status는 `pending`으로 유지하고,
work-package status만 `in_progress`로 기록한다.

승인된 implementation capability는 정확히 다음뿐이다.

- fixed local Blabase Git object database에서 bounded read-only object acquisition;
- ignored private `.local` governance artifacts의 hardened, contained, no-follow read;
- proposal history resolution, current-head/currentness validation과 compare-and-swap fencing;
- proposal destination에 대한 hard-link 기반 atomic no-clobber publication과 readback.

승인된 tracked implementation paths는 정확히 다음 둘이다.

- `suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts`
- `suggestion/tests/dayflowGovernanceAdapters.test.ts`

DFA-002A는 Dayflow repository/source/runtime/Swift 접근, human signing 또는 trusted-channel
issuer, contract decision/freeze creation, live authority, route/CLI/production 연결을 명시적으로
금지한다. Proposal publisher는 schema-valid existing proposal bytes만 publish하며 승인,
decision 또는 freeze를 생성하지 않는다. Local base/current-candidate acquisition과 proposal
history/currentness/CAS ownership은 DFA-002A가 DFA-002 exit 전에 구현한다. External Dayflow
pin/export는 계속 DFA-003, live/historical authority와 attestation lifecycle은 계속 DFA-007이
소유한다. Missing/untrusted local resolution은 구현 완료 전후 모두 fail closed다.

## 1. Decision

The first implementation is an offline, local-only, paired A/B/C experiment. It does not change the production Attention, Continuation, Work Board, Launcher, action, or monitoring paths.

Dayflow remains a separate capture sidecar. Blabase does not copy Dayflow's `StorageManager`, add GRDB, or read the live Dayflow SQLite database during suggestion evaluation. A versioned immutable export boundary separates the two applications.

The experiment compares:

| System | Evidence available | Intended question |
| --- | --- | --- |
| A | Current Blabase structured evidence only | How good is the current architecture? |
| B | The same structured evidence plus Dayflow-derived screen evidence | What is the incremental value of screen context? |
| C | Dayflow-derived screen evidence only | How good is a screen-first alternative without structured-source authority? |

System A additionally emits two internal controls. `A0` is the untouched sealed production result. `A1` runs the exact E1 refiner, prompt, template, model, parameters, and config used by B, but masks all screen evidence. The primary causal comparison is B versus A1. A0 is reported as the production compatibility anchor and is never silently substituted for A1.

C is a separate screen-only discovery study. It is not included in the paired E1 causal estimate and must not receive a structured candidate, registry mapping, project label, or source state. A0, A1, B, and C may share a capture window identifier, but their serialized input projections are independently allowlisted and hashed.

## 2. Why this boundary

Dayflow currently stores screenshot JPEGs separately from SQLite metadata and derives batches, observations, and timeline cards. This separation is useful, but its live storage is not a stable Blabase API.

Current risks in a direct integration:

- JPEG is written before the screenshot row; an insert failure can leave an orphan file.
- Several reads convert database failures to empty results.
- Screenshot rows do not contain checksum, display identity, consent revision, schema version, or a trustworthy privacy-state field.
- Placeholder frames and real frames are not distinguishable from the cited screenshot schema alone.
- Observation provenance is batch-level rather than an exact screenshot span.
- Live SQLite, WAL, screenshot files, and retention purge do not provide an atomic external-reader snapshot contract.
- Dayflow has no stable WorkContext or project identity compatible with Blabase.
- Dayflow observations and timeline cards are model-derived projections, not direct facts or human Gold.

Therefore a missing or invalid Dayflow export is a typed unavailable state. It is never converted to an empty evidence set or inactivity claim.

## 3. Experiment questions

The experiment answers these questions in order:

1. Does B improve the usefulness and specificity of the next suggestion over A?
2. Does B preserve A's identity, currentness, and unsupported-claim safety?
3. Can C produce useful suggestions without borrowing structured-source authority?
4. Which screen-derived fields contribute to a win, tie, or loss?
5. Is the quality gain large enough to justify capture, retention, compute, and privacy cost?

The experiment does not initially answer whether Blabase should replace its current persistence layer, make screen capture a production source, or enable cloud image processing.

## 4. Source pinning

The Dayflow working tree contains untracked design documents, including the reference document. The repository commit does not authenticate that document. Every run must therefore bind both the Dayflow commit and exact source/document hashes.

Pinned inputs for the first contract draft:

| Input | SHA-256 or revision |
| --- | --- |
| Dayflow repository HEAD | `df3c367edb7d405a78d1ae76edffe4ba366f57d7` |
| Architecture reference document | `bfc38c0c22aa594711db04e87210f7b64d82802d1b8d93d5be28d39ad0dc8b39` |
| `ScreenRecorder.swift` | `94f2683bce56a1aec41bab3a856b07a551d87d09e64d4bc7186046d76448192e` |
| `StorageManager+Screenshots.swift` | `67e0ca38c673981a1a9da2d48c2359f47132c44c817789d6ad0c6468feb4b1f4` |
| `StorageManager.swift` | `d1fc88fe3b0caec6c2cc4dc28c8fc75735d99dfbc56b47518fb14024c394ae7b` |
| `Package.resolved` | `2fbad062f299f029a3ac35ae82ef06eca622ad3abcb7486aff9687c8e3f33077` |

The source pin must be refreshed if any cited file changes. A branch name or repository commit alone is insufficient when referenced files are untracked or modified.

## 5. Data architecture

```text
Dayflow capture and local storage
  -> capture-side consent and denylist enforcement
  -> Dayflow-owned bounded export handshake
  -> DayflowScreenEvidenceExport v0.1
  -> local privacy minimization
  -> DayflowNormalizedEvidence v0.1
  -> EvaluationCheckpoint v0.2
       -> Run v0.4 A0 untouched current Blabase
       -> RequestOrderManifest v0.1 -> RequestIssuanceReceipt v0.1 -> Run v0.4 A1 masked
       -> RequestOrderManifest v0.1 -> RequestIssuanceReceipt v0.1 -> Run v0.4 B enabled
       -> Run v0.4 C from separate screen-only input
       -> CheckpointCompletion v0.1 referencing the sealed checkpoint and completed runs
       -> OutputReview v0.2 x2 -> PairPreferenceReview v0.2 per causal group
       -> CandidateDatasetGeneration v0.1
            -> ExclusionClosure v0.1
            -> FinalDatasetManifest v0.1
            -> FinalDatasetBinding v0.1
            -> PilotVerificationAttestation v0.1 before raw purge (private pilot only)
  -> committed reviews + FinalDatasetBinding v0.1
       -> Aggregate v0.1 and explicit human decision
```

The export, normalized evidence, checkpoint, runs, reviews, candidate generation, closure, manifest, binding, and aggregate are separate immutable artifacts. Immutable means never overwritten; it does not mean retained indefinitely. Every artifact remains subject to its explicit TTL, revocation, and purge contract.

## 6. Export contract

The first contract is `dayflow-screen-evidence-export-v0.1`.

Required envelope fields:

```text
contract
schemaVersion
exportId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
exportedAt
windowStart
windowEnd
dayflowCommitSha
sourceFileHashes
packageResolvedSha256
capturePolicyVersion
captureConfig
databaseSnapshotIdentity
consentRevision
retentionPolicyId
coverage
artifacts
detachedManifestSha256
```

`coverage` is a strict, normalized object:

```text
intervals[]:
  start
  end
  reason: running | paused | locked | policy-denied | missing | read-failed | unavailable
  expectedFrameCount
  observedFrameCount
  rejectedFrameCount
expectedFrameCount
observedFrameCount
rejectedFrameCount
```

Intervals form a complete, non-overlapping half-open partition of `[windowStart, windowEnd)`. Normalization clips source spans to the window, splits them at every boundary, resolves overlaps with the fixed precedence `unavailable > read-failed > missing > policy-denied > locked > paused > running`, coalesces adjacent intervals with the same reason, and sorts by `(start, end)`. The three top-level counts must equal the corresponding interval sums; `0 <= rejectedFrameCount <= observedFrameCount`, and `artifacts.length == observedFrameCount - rejectedFrameCount`. Expected counts are derived only from the pinned capture configuration. Non-normalized partitions or count mismatches are rejected.

An empty artifact list is valid only when every interval is intentionally non-capturing (`paused`, `locked`, or `policy-denied`) and all three counts are zero. It means no observation, never inactivity. A `missing`, `read-failed`, or `unavailable` interval, a running interval without its expected artifact, any rejected artifact, or any partition/count mismatch is a typed failure and cannot be converted to a valid empty export.

Required artifact fields:

```text
sourceArtifactId
sourceRowId
capturedAt
sequenceWithinSecond
idleSeconds
relativeBlobRef
mimeType
byteSize
sha256
privacyState
captureConsentRevision
capturePolicyVersion
capturePolicyDecision
pseudonymousDisplayAttestation
pseudonymousWindowAttestation
placeholderState
availability
```

Contract rules:

- Ordering is `(capturedAt, numeric(sourceRowId))` because Dayflow capture time has second-level precision; `sourceRowId` is the canonical decimal string `0|[1-9][0-9]*`, has no leading zero, and is compared as an arbitrary-precision unsigned integer rather than lexically.
- Absolute file paths never enter Blabase domain objects or evaluation outputs.
- `relativeBlobRef` is resolved only inside the private importer root.
- Every blob is size- and SHA-256-verified before use.
- Unknown privacy state is rejected for live human data.
- Deleted, missing, future, duplicate, out-of-window, and unsupported rows are typed issues.
- Export schema mismatch is rejected, not interpreted as zero activity.
- LLM request/response bodies, headers, provider URLs, credentials, and raw timeline chat are excluded.
- `detachedManifestSha256` is exactly `SHA256(UTF8("blabase.dayflow-screen-evidence-export.v0.1\u0000") || JCS(manifestWithoutDetachedHash))`, encoded as 64 lowercase hexadecimal characters. `manifestWithoutDetachedHash` is the complete manifest value with only `detachedManifestSha256` omitted; raw blob hashes remain hashes of blob bytes.
- The complete marker is written only after every artifact is fsynced and verified.
- Export publication is atomic; incomplete staging bundles are never accepted.
- A policy or consent revision change closes the current bundle before another frame is accepted.
- Mixed-revision bundles and frames without per-capture attestations are rejected.

The exporter must run against a Dayflow-owned stable snapshot. Copying `chunks.sqlite` without WAL coordination is not sufficient.

The live exporter is a Dayflow-owned prerequisite, not a Blabase importer feature. Before a frame is captured it must enforce the approved app, window, and display policy. At capture time it must persist the consent revision, capture-policy version, display/window attestation, placeholder status, and blob checksum. Historical rows with unknown privacy state are ineligible for a live-human export.

## 7. Normalized screen evidence

Raw frames do not flow directly into suggestion resolution. Local preprocessing produces `dayflow-normalized-evidence-v0.1`.

Allowed initial fields:

```text
schemaVersion
evidenceId
generationId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
extractorInputHash
captureWindow
activityKind
applicationCategory
subjectLabel
taskIntent
stateClaim
confidenceBasisPoints
coverageCode
normalizedCoverage
sourceArtifactHashes
preprocessingVersion
extractorVersion
model
promptVersion
promptSha256
configVersion
guardrailVersion
verificationStatus
reasonCodes
acceptedClaims
fieldEvidence
rejectedClaims
conflictingClaims
expiresAt
dayflowNormalizedEvidenceHash
```

`normalizedCoverage` is the verifier-produced canonical coverage object above; it is copied into the normalization record and is never inferred by the extractor. `coverageCode` is deterministically `failure` when any failure condition above exists, `observed` when at least one accepted artifact remains and no failure exists, and `valid-empty` only for the intentional empty case above. A `failure` record emits no evidence claims and makes the screen input unavailable to evaluation. No other coverage code is accepted.

`fieldEvidence[]` maps each emitted field or claim to exact source artifact hashes and capture spans. Derived values without this mapping are rejected. Rejected and conflicting claims remain in the private artifact as separate records and never disappear into a successful empty value.

The normalized-evidence claim collections are closed schemas:

```text
acceptedClaims[] sorted unique by claimId:
  { claimId, outputFieldPath, claimClass, normalizedValueHash, confidenceBasisPoints, fieldEvidenceId }
fieldEvidence[] sorted unique by fieldEvidenceId:
  { fieldEvidenceId, claimId, outputFieldPath,
    sourceArtifactRefs[] non-empty sorted unique by (exportId,sourceRowId,blobSha256),
    captureSpans[] non-empty sorted unique by canonical discriminated-union key }
rejectedClaims[] sorted unique by rejectedClaimId:
  { rejectedClaimId, proposedOutputFieldPath, claimClass, proposedValueHash, reasonCode,
    sourceArtifactRefs[] sorted unique restricted refs, rejectedAt }
conflictingClaims[] sorted unique by conflictId:
  { conflictId, outputFieldPath, screenClaimIds[] non-empty sorted unique, structuredAuthorityRef: strict union,
    resolutionCode: STRUCTURED_AUTHORITY_WINS | DROP_SCREEN_CLAIM, reasonCode }
```

The nested wire types above are closed:

```text
sourceArtifactRef {
  artifactType: dayflow_export_frame
  exportRef { schemaVersion: dayflow-screen-evidence-export-v0.1, exportId, detachedManifestSha256 }
  sourceRowId, blobSha256
}
captureSpan:
  normalized_frame -> { spanKind: normalized_frame, sourceArtifactRef, startOffsetMs, endOffsetMs }
  text_offset_utf8 -> { spanKind: text_offset_utf8, sourceArtifactRef, normalizedTextSha256, startByteOffset, endByteOffset }
structuredAuthorityRef:
  sealed_attention_result -> { authorityType: sealed_attention_result, resultId, resultSha256 }
  checkpoint_structured_field -> { authorityType: checkpoint_structured_field,
    checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 },
    authorityClass: attention_input | attention_result | board | structured_evidence | work_context_registry,
    authoritySha256 }
semanticOutput {
  schemaVersion: dayflow-ablation-semantic-output-v0.1
  presentationMode: display_only
  status: suggestions_available | no_suggestion
  items[] max 3, sorted by position: {
    position, title, summary,
    caveatCodes[] sorted unique subset of SCREEN_CONTEXT_ONLY | NOT_COMPLETION_EVIDENCE | NOT_ACTIONABLE | NOT_OBSERVED_BY_SOURCE,
    claimIds[] sorted unique
  }
}
```

Offsets and `position` are JSON unsigned integers. Frame offsets use milliseconds with `0 <= startOffsetMs < endOffsetMs <= windowDurationMs`; text offsets use UTF-8 bytes with `0 <= startByteOffset < endByteOffset <= actualNormalizedTextByteLength`. `suggestions_available` has 1..3 items at contiguous positions 1..N; `no_suggestion` has zero items. Titles are 1..120 and summaries 1..500 NFC Unicode scalar values. `action`, `actionId`, `target`, `targetId`, executable URI, and any equivalent field are forbidden at every semantic-output level. Each `claimIds[]` entry resolves an accepted claim for that exact item leaf.

Every path field is an RFC 6901 canonical JSON Pointer: empty only where explicitly allowed, otherwise starts `/`; `~` appears only as `~0` or `~1`; array tokens are `0|[1-9][0-9]*`; decoding then NFC re-encoding must reproduce the same bytes. `outputFieldPath`/`proposedOutputFieldPath` are restricted to semantic-output leaves `/items/<0..2>/title`, `/items/<0..2>/summary`, or `/items/<0..2>/caveatCodes/<canonical-index>`. `confidenceBasisPoints` and every other confidence value are JSON unsigned integers `0..10000`; floating-point and 0..1/0..3 scales are forbidden.

`claimClass` is exactly `VISIBLE_APPLICATION | VISIBLE_SUBJECT | VISIBLE_TASK_INTENT | RECENT_FOCUS | DISPLAY_TITLE_HINT | TASK_COMPLETION | VALIDATION_RESULT | MERGE_STATE | DEPLOYMENT_STATE | DELIVERY_STATE | EXTERNAL_MUTATION | VERIFIED_WORK_CONTEXT | INACTIVITY`. The embedded control `screenClaimPolicy` has `policySchemaVersion: dayflow-screen-claim-policy-v0.1`, `lineageClass: control`, allowed classes equal the first five, forbidden classes equal the last eight, `structuredAuthorityWins: true`, and no other class. Rejection `reasonCode` is `FORBIDDEN_CLAIM_CLASS | INSUFFICIENT_EVIDENCE | PRIVACY_BLOCKED | STRUCTURED_AUTHORITY_CONFLICT | STALE_EVIDENCE | COVERAGE_UNAVAILABLE | AMBIGUOUS_IDENTITY`; conflict reason is `STRUCTURED_AUTHORITY_CONFLICT | AMBIGUOUS_IDENTITY | STALE_EVIDENCE`.

For every emitted screen-derived semantic output leaf, there is exactly one accepted claim and exactly one `fieldEvidence` item with the same `outputFieldPath` and IDs; conversely each accepted claim/evidence item maps to exactly one emitted semantic leaf. Duplicate, missing, extra, or cross-field lineage fails the whole normalized evidence. Rejected/conflicting items never satisfy accepted-field coverage and forbidden claim classes never enter semantic output.

The extractor input contract contains only the verified raw export, capture metadata, and capture/privacy policy. It cannot receive a WorkContext registry, structured candidate, target label, current Board, or structured-source state. Every extraction records an `extractorInputHash`. Arbitrary mutations to structured or registry data must leave normalized screen evidence and C byte-identical.

Initial authority restrictions:

- Screen evidence may identify that an application, project label, or task topic was visible.
- Screen evidence may improve a display-only title or explain recent focus.
- Screen evidence cannot prove task completion, validation pass/fail, merge, deployment, delivery, or external mutation.
- Screen evidence cannot override a direct GitHub, Codex, Calendar, Notion, registry, or user-confirmed claim.
- Missing capture means `notObservedBySource`, not idle, inactive, or complete.
- Model-derived Dayflow observations are treated as derived evidence and carry their model/prompt policy version.
- Timeline cards are not imported as human-approved facts.

## 8. Collection checkpoint, run, and final dataset contracts

Each `dayflow-ablation-checkpoint-v0.2` binds one evaluation time, one frozen input set, and the pre-collection `studyProtocolHash`. A collection-time checkpoint never binds the final dataset.

```text
checkpointSchemaVersion: dayflow-ablation-checkpoint-v0.2
checkpointId
lineageClass: evidence
dataOrigin
studyPhase
captureWindowId
asOf
windowStart
windowEnd
studyProtocolHash
studyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
executionFreezeRef {
  schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1
  evaluationExecutionFreezeId
  evaluationExecutionFreezeSha256
}
priorCandidateDatasetGenerationRef: optional {
  schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1
  candidateDatasetGenerationId
  candidateDatasetGenerationSha256
}
expectedRunKeys[] sorted unique by (armId, replicateIndex): { armId: A0 | A1 | B | C, replicateIndex }
blabaseCodeProvenance
currentAttentionInputHash
currentAttentionResultHash
currentBoardHash
structuredEvidenceHash
dayflowExportHash
dayflowNormalizedEvidenceHash
workContextRegistryHash
consentRevision
retentionPolicyId
inputSealStatus: sealed
checkpointSha256
```

`priorCandidateDatasetGenerationRef` is absent for the first checkpoint or resolves an immutable generation completed before checkpoint start; `priorCandidateGenerationRef`, `candidateGenerationId`, `candidateGenerationSha256`, and every other legacy alias are unknown and rejected. The prior ancestry cannot contain this checkpoint. `studyProtocolRef.studyProtocolHash` equals the repeated evidence `studyProtocolHash`; `executionFreezeRef` resolves a control artifact whose target origin/phase/protocol exactly matches that authoritative protocol and whose arm/replicate projection equals its `armPolicy`. `expectedRunKeys[]` is recomputed, never trusted: for every enabled arm it contains exactly `(armId, replicateIndex)` for JSON integer indices `0..replicateCountByArm[armId]-1`, sorted by enum arm order then numeric index. Disabled arms contribute no key. Stored/ref-resolved protocol or execution-freeze disagreement fails closed.

Each arm input is the following single strict discriminated union; common fields are required in every variant and every unlisted or cross-variant field is forbidden:

```text
common:
  armInputSchemaVersion: dayflow-ablation-arm-input-v0.4
  armInputId
  lineageClass: evidence
  armId: A0 | A1 | B | C
  dataOrigin
  studyPhase
  studyProtocolHash
  captureWindowId
  executionFreezeRef { schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
  replicateIndex
  presentationPolicyRef { version, sha256 }
  armInputHash

A0:
  inputKind: structured_baseline
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  sealedAttentionResultRef { resultId, resultSha256 }
  structuredCheckpointRef { currentAttentionInputHash, currentAttentionResultHash, currentBoardHash, structuredEvidenceHash, workContextRegistryHash }
  screenEvidenceMode: none
  structuredCandidateHash, normalizedEvidenceRef, generationTupleSelector, matchedPairId, requestOrderManifestRef, requestId, requestPosition: forbidden

A1:
  inputKind: structured_generation
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  structuredCheckpointRef { currentAttentionInputHash, currentAttentionResultHash, currentBoardHash, structuredEvidenceHash, workContextRegistryHash }
  structuredCandidateHash
  screenEvidenceMode: masked
  generationTupleSelector: a1bCausalTuple
  matchedPairId
  requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
  requestId
  requestPosition: canonical decimal string
  sealedAttentionResultRef, normalizedEvidenceRef: forbidden

B:
  inputKind: structured_plus_screen_generation
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  structuredCheckpointRef { currentAttentionInputHash, currentAttentionResultHash, currentBoardHash, structuredEvidenceHash, workContextRegistryHash }
  structuredCandidateHash
  screenEvidenceMode: normalized
  normalizedEvidenceRef { schemaVersion: dayflow-normalized-evidence-v0.1, evidenceId, dayflowNormalizedEvidenceHash }
  generationTupleSelector: a1bCausalTuple
  matchedPairId
  requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
  requestId
  requestPosition: canonical decimal string
  sealedAttentionResultRef: forbidden

C:
  inputKind: screen_only_generation
  screenEvidenceMode: normalized
  normalizedEvidenceRef { schemaVersion: dayflow-normalized-evidence-v0.1, evidenceId, dayflowNormalizedEvidenceHash }
  generationTupleSelector: cScreenOnlyTuple
  checkpointRef, sealedAttentionResultRef, structuredCheckpointRef, structuredCandidateHash, matchedPairId, requestOrderManifestRef, requestId, requestPosition: forbidden
```

Each `dayflow-ablation-run-v0.4` is immutable and binds one arm input projection. A0/A1/B bind an existing v0.2 checkpoint and exact hash; C is independently serialized screen-only input and forbids a checkpoint ref.

```text
common:
  runSchemaVersion: dayflow-ablation-run-v0.4
  runId
  lineageClass: evidence
  armId: A0 | A1 | B | C
  dataOrigin
  studyPhase
  studyProtocolHash
  armInputRef { schemaVersion: dayflow-ablation-arm-input-v0.4, armInputId, armInputHash }
  executionFreezeRef { schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
  replicateIndex
  startedAt
  completedAt
  status: completed | failed | no_output
  attempts[] sorted unique by numeric attemptIndex, strict union with common {
    attemptIndex, startedAt, completedAt,
    attemptKind: deterministic_success | provider_success | deterministic_failure | provider_failure,
    requestSha256, latencyMs, inputTokens, outputTokens, costMicrounits
  }
    deterministic_success -> { responseSha256, attemptOutputHash }; providerGenerationId, failureCode, failureStage forbidden
    provider_success -> { responseSha256, attemptOutputHash, providerGenerationId }; failureCode, failureStage forbidden
    deterministic_failure -> { failureCode }; responseSha256, attemptOutputHash, providerGenerationId, failureStage forbidden
    provider_failure -> { failureCode, failureStage: before_provider_acknowledgement | after_provider_acknowledgement };
      before -> providerGenerationId, responseSha256, attemptOutputHash forbidden;
      after -> bounded providerGenerationId and responseSha256 required, attemptOutputHash forbidden
  semanticOutput: conditional exact dayflow-ablation-semantic-output-v0.1
  validationIssueCodes[] sorted unique
  outputHash: conditional
  terminalFailureCode: conditional
  runSha256

A0:
  runKind: sealed_baseline
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  sealedResultSha256
  attempts: exactly one deterministic_success at attemptIndex 0
  status: completed
  matchedPairId, requestOrderManifestRef, requestId, requestPosition, requestIssuanceReceiptRef, issuanceSequence, terminalFailureCode: forbidden

A1 | B:
  runKind: causal_generation
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  matchedPairId
  requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
  requestId
  requestPosition: canonical decimal string
  requestIssuanceReceiptRef { schemaVersion: dayflow-ablation-request-issuance-receipt-v0.1, requestIssuanceReceiptId, requestIssuanceReceiptSha256 }
  issuanceSequence: canonical decimal string
  sealedResultSha256: forbidden

C:
  runKind: screen_only_generation
  checkpointRef, matchedPairId, requestOrderManifestRef, requestId, requestPosition, requestIssuanceReceiptRef, issuanceSequence, sealedResultSha256: forbidden
```

Attempts are non-empty and contiguous from JSON integer index `0`. `providerGenerationId` matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`; it is required only by `provider_success` and acknowledged `provider_failure` and forbidden otherwise. Failure variants own no semantic output or output hash. `completed` requires one final success variant, `semanticOutput.status: suggestions_available`, its hash, and no terminal failure; all earlier attempts are failure variants. `failed` requires only failure variants and forbids `semanticOutput`/`outputHash`. `no_output` requires one final success variant, `semanticOutput.status: no_suggestion`, its hash, and literal `NO_ELIGIBLE_OUTPUT`. A0's sole deterministic success is the sealed result projection and never calls a provider. Any other combination is rejected.

Collection-time runs do not contain `datasetVersion`, `datasetSha256`, `finalDatasetBindingId`, review status, or analysis IDs. Those later artifacts refer to existing immutable run IDs; runs are never patched after collection.

An A1/B matched pair has the same `checkpointId`/hash, `studyProtocolHash`, `replicateIndex`, and globally unique `matchedPairId`. Both runs carry the exact same typed `requestOrderManifestRef`; that resolved manifest contains exactly one A1 request and one B request for the `matchedPairId`, and each arm input/run request ID and position matches its entry. Before each causal run starts, a standalone issuance receipt binds that manifest entry and exact arm input. Receipt `position` and `issuanceSequence` are contiguous from `"0"`, the first omits `previousReceiptSha256`, each successor binds the immediately prior receipt hash with strictly increasing `issuedAt`, and the run repeats the exact receipt ref/sequence. A0/C forbid all causal request/receipt fields. Duplicate pair/receipt IDs, mixed checkpoints/protocols/replicates/manifests, broken receipt chains, missing/extra peer entries, and run-to-manifest/receipt mismatches are rejected.

Run completion never patches the checkpoint that runs already hash. It publishes a separate immutable completion artifact:

```text
checkpointCompletionSchemaVersion: dayflow-ablation-checkpoint-completion-v0.1
checkpointCompletionId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
studyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
executionFreezeRef { schemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
expectedRunKeys[] sorted unique by (armId, replicateIndex): { armId: A0 | A1 | B | C, replicateIndex }
completionStatus: completed | failed
presentRunRefs[] sorted unique by (armId, replicateIndex, runId):
  { schemaVersion: dayflow-ablation-run-v0.4, runId, runSha256, armId, replicateIndex }
missingExpectedRunKeys[] sorted unique by (armId, replicateIndex)
failedRunKeys[] sorted unique by (armId, replicateIndex)
noOutputRunKeys[] sorted unique by (armId, replicateIndex)
completedAt
checkpointCompletionSha256
```

The completion's checkpoint/protocol/execution-freeze refs and `expectedRunKeys[]` are byte/JCS-equal to the checkpoint fields, and the verifier independently recomputes the keys from protocol `armPolicy`. `presentRunRefs[]` plus `missingExpectedRunKeys[]` exactly partition expected keys; `failedRunKeys[]` and `noOutputRunKeys[]` are sorted subsets of present keys and cannot overlap. `completed` requires no missing, failed, or no-output key; `failed` requires at least one. A0/A1/B runs resolve the exact checkpoint; C matches capture window and control refs through its arm input. Only a resolved `completed` completion enters a generation.

After a checkpoint and its required runs are complete, collection advances through this strict, forward-only DAG:

```text
CandidateDatasetGeneration v0.1
  -> ExclusionClosure v0.1
  -> FinalDatasetManifest v0.1
  -> FinalDatasetBinding v0.1
```

Each successor contains a typed hash reference to its immediate predecessor. A predecessor never references a successor. Mixed `studyProtocolHash`, reverse references, self references, cycles, unresolved refs, duplicate refs, unsorted arrays, hash mismatches, and unknown fields are rejected.

`dayflow-ablation-candidate-dataset-generation-v0.1`:

```text
candidateDatasetGenerationSchemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1
candidateDatasetGenerationId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
priorCandidateDatasetGenerationRef: optional {
  schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1
  candidateDatasetGenerationId
  candidateDatasetGenerationSha256
}
completedCheckpointRuns[] sorted unique by checkpointId:
  checkpointRef {
    schemaVersion: dayflow-ablation-checkpoint-v0.2
    checkpointId
    checkpointSha256
  }
  checkpointCompletionRef {
    schemaVersion: dayflow-ablation-checkpoint-completion-v0.1
    checkpointCompletionId
    checkpointCompletionSha256
  }
  runRefs[] sorted unique by (armId, replicateIndex, runId):
    schemaVersion: dayflow-ablation-run-v0.4
    runId
    runSha256
    armId
    replicateIndex
createdAt
candidateDatasetGenerationSha256
```

Every checkpoint, completion, and run ref must resolve and match origin/phase/protocol. The completion must be `completed`, and the entry's `runRefs[]` must be an exact sorted bijection over its resolved `presentRunRefs[]`. `priorCandidateDatasetGenerationRef` is absent only for the first generation. Every child is a cumulative full snapshot: all parent entries remain byte/JCS-identical, none is changed or dropped, and at least one new sorted checkpoint entry is added. Delta-only generations, legacy `parentGenerationRef`/`priorCandidateGenerationRef` aliases, self/skip/forward/cycles fail.

`dayflow-ablation-exclusion-decision-v0.1` is standalone and immutable:

```text
exclusionDecisionSchemaVersion: dayflow-ablation-exclusion-decision-v0.1
exclusionDecisionId
lineageClass: evidence
dataOrigin: synthetic | live
studyPhase: contract_conformance | private_pilot | directional_study
studyProtocolHash
sourceGenerationRef { schemaVersion, candidateDatasetGenerationId, candidateDatasetGenerationSha256 }
checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
disposition: include | exclude
reasonCode
reasonDetail: optional private text
reviewerPseudonym
decidedAt
exclusionDecisionSha256
```

`dayflow-ablation-exclusion-closure-v0.1`:

```text
exclusionClosureSchemaVersion: dayflow-ablation-exclusion-closure-v0.1
exclusionClosureId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
sourceGenerationRef {
  schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1
  candidateDatasetGenerationId
  candidateDatasetGenerationSha256
}
decisionRefs[] sorted unique by checkpointId:
  checkpointId
  schemaVersion: dayflow-ablation-exclusion-decision-v0.1
  exclusionDecisionId
  exclusionDecisionSha256
closedAt
exclusionClosureSha256
```

The closure resolves exactly one standalone decision for every source-generation checkpoint and no decision for any other checkpoint. A decision may be created only after its source generation is immutable-published and readback-verified; `decidedAt` must be later than `generation.createdAt`, and generation payloads contain no decision/ref. Each decision matches origin, phase, protocol, source generation, and checkpoint hash; `reasonCode` is required. Neither decision nor closure has a successor reverse ref.

`dayflow-ablation-final-dataset-manifest-v0.1`:

```text
finalDatasetManifestSchemaVersion: dayflow-ablation-final-dataset-manifest-v0.1
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
exclusionClosureRef {
  schemaVersion: dayflow-ablation-exclusion-closure-v0.1
  exclusionClosureId
  exclusionClosureSha256
}
datasetVersion
includedCheckpointRuns[] sorted unique by checkpointId:
  checkpointRef {
    schemaVersion: dayflow-ablation-checkpoint-v0.2
    checkpointId
    checkpointSha256
  }
  runRefs[] sorted unique by (armId, replicateIndex, runId):
    schemaVersion: dayflow-ablation-run-v0.4
    runId
    runSha256
    armId
    replicateIndex
    matchedPairId: required for A1 | B; forbidden for A0 | C
datasetSha256: detached manifest hash
```

The manifest includes exactly the closure's `include` decisions and only run refs already present under those checkpoints in the source generation. `datasetSha256` is computed with that field omitted from the JCS preimage and stored as the detached manifest hash. The manifest has no binding reverse ref.

`dayflow-ablation-final-dataset-binding-v0.1`:

```text
finalDatasetBindingSchemaVersion: dayflow-ablation-final-dataset-binding-v0.1
finalDatasetBindingId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
manifestRef {
  schemaVersion: dayflow-ablation-final-dataset-manifest-v0.1
  datasetVersion
  datasetSha256
}
runBindings[] sorted unique by (checkpointId, armId, replicateIndex, runId):
  checkpointId
  checkpointSha256
  runId
  runSha256
  armId
  replicateIndex
  matchedPairId: required for A1 | B; forbidden for A0 | C
createdAt
finalDatasetBindingSha256
```

The binding resolves its typed manifest ref and repeats no manifest or closure payload. Flatten `manifest.includedCheckpointRuns[].runRefs[]` together with each parent `checkpointRef`; `runBindings[]` MUST be an exact bijection over that flattened set. Cardinality must match, every manifest run appears exactly once, and no run may be omitted, added, or duplicated. Each mapped entry must exactly equal the manifest/ref-resolved values for `checkpointId`, `checkpointSha256`, `runId`, `runSha256`, `armId`, `replicateIndex`, and conditional `matchedPairId`. Direct aggregate comparison is valid only when every compared run is present in the same final binding ID/hash. A changed exclusion decision creates a new closure, manifest, binding, dataset version/hash, and analysis; it never mutates an existing artifact.

A0, A1, and B use the same permitted structured checkpoint. A1 and B additionally share the fixed structured candidate, `asOf`, language, output limit, and review rubric. C receives a separately serialized `screenOnlyInput` that contains no structured candidate, target label, registry field, structured-source hash, or structured checkpoint payload.

Exactly one Dayflow export is produced per `captureWindowId`. Only B and C may consume the verified normalized screen evidence. A0 and A1 may carry the allowlisted `captureWindowId` and `checkpointId` solely for grouping and audit; their serialized arm inputs contain no export hash, normalized-evidence hash, screen label, blob ref, or capability that can dereference screen artifacts.

## 9. Arm contracts

### A0: production compatibility control

- Uses the existing sealed current result without modification.
- Records the exact current Attention and Board hashes.
- May carry only allowlisted `captureWindowId` and `checkpointId` for grouping/audit; these identifiers confer no screen-artifact read capability.
- Does not read Dayflow normalized evidence.
- Acts as both the quality control and a byte-preservation regression.

### A1: causal structured-evidence control

- Uses the exact E1 refiner, model, prompt, template, parameters, and config used by B.
- Receives the same fixed structured candidate as B.
- Receives a static `screenEvidenceMode: masked` value, not an export/evidence reference. Apart from the permitted window/checkpoint identifiers, it receives no screen artifact field or read capability.
- Cannot read Dayflow export, normalized evidence, or screen-derived labels through another dependency.
- A Dayflow-only mutation must leave A1 input bytes, output bytes, and hashes unchanged.

### B: hybrid

- Starts from the same structured checkpoint as A.
- Adds only normalized, current, consented screen evidence.
- First slice may refine display-only suggestion wording and rationale.
- First slice cannot alter production admission, score, ordering, capability, action, or target.
- Invalid screen evidence produces a byte-equal A1 result and a separate availability failure record.
- A structured-evidence mutation outside the fixed candidate must not change B's serialized input or output.

### C: separate screen-only discovery study

- Receives no GitHub, Codex, Calendar, Notion, registry mapping, or structured-source state.
- May use only normalized Dayflow evidence and common non-source presentation rules.
- Cannot claim a verified WorkContext unless separately confirmed inside the C arm.
- Emits display-only suggestions with explicit screen-only caveats.
- No screen evidence yields no suggestion, not an A fallback.
- Structured-source, registry, and target-label mutations must leave C input and output bytes unchanged.

## 10. Two-stage evaluation

### Stage E1: suggestion specificity

E1 asks whether B improves the wording and immediate usefulness of a suggestion over A1 when the underlying structured candidate and the complete refinement pipeline are identical.

E1 keeps selection, ranking, capability, and action fixed. This is the first implementation target because it isolates semantic value without changing production authority.

The E1 refiner must be deterministic. Prefer deterministic code or a model route with a supported recorded seed. If the selected provider cannot guarantee determinism, A1 and B use matched replicate counts, randomized request order, recorded provider generation IDs, and a predeclared variance analysis. A single unseeded A1/B sample is not a valid causal comparison.

### Stage E2: candidate discovery

E2 asks whether B finds useful work that A misses. C remains a separately reported screen-only discovery study. E2 starts only if E1 passes privacy and correctness gates.

E2 requires a separately versioned candidate policy, stronger identity binding, stale/completed suppression, new synthetic cases, and a new Engine Change Record. E1 results cannot approve E2 automatically.

## 11. Human evaluation

The reviewer scores A1 and B independently in separate sessions before seeing a paired preference view. The reviewer sees deterministic opaque slots and must not see the source arm until the rating is committed. C is reviewed in a separate queue because its mandatory screen-only caveat would otherwise reveal the arm. A0 is reported as a compatibility reference, not mixed into the blind causal rating.

`OutputReview` is a strict `queue`/`arm` discriminated union. Its common fields are:

```text
reviewSchemaVersion: dayflow-ablation-output-review-v0.2
reviewId
evalId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
checkpointId
runId
reviewerPseudonym
reviewedAt
committedAt
commitSequence
rankAcceptability[]:
  rank: 1 | 2 | 3
  outputItemId
  acceptable: yes | no
specificity: 0..3
nextActionClarity: 0..3
correctness: 0..3
timeliness: 0..3
privacyConcern: none | possible | confirmed
unsupportedClaimCodes[]
wrongIdentity: boolean
staleOrCompletedResurfaced: boolean
reviewerNote: optional private text
outputReviewSha256
```

The strict variants are:

```text
A1BBlindOutputReview:
  queue: causal-blind
  arm: A1 | B
  comparisonGroupId
  opaqueSlot
  permutationRef: { version, hash }
  sourceArmGuess: A1 | B | unsure
  sourceArmGuessConfidenceBasisPoints: JSON unsigned integer 0..10000

A0ReferenceOutputReview:
  queue: reference
  arm: A0

CScreenOnlyOutputReview:
  queue: screen-only
  arm: C
```

Every OutputReview has globally unique `reviewId` and `evalId`. `comparisonGroupId` is required only on A1/B blind OutputReviews and forbidden on A0/C reviews. A causal `comparisonGroupId` is globally unique and owns exactly three records: one A1 OutputReview, one B OutputReview, and one PairPreferenceReview. The two OutputReviews share only `comparisonGroupId`; their `evalId` values remain distinct. Their runs must form one valid matched pair with the same checkpoint, `studyProtocolHash`, JSON-integer `replicateIndex`, exact `matchedPairId`, and exact `requestOrderManifestRef` relation described above. All A1/B blind-only fields are required. The persisted A1/B record's actual `arm` discriminator is storage-side metadata validated against `permutationRef`; before rating commit, the separate reviewer projection (which is not an `OutputReview` record) uses `arm: redacted` and exposes only `opaqueSlot` plus the immutable permutation reference. A0 and C records forbid `comparisonGroupId`, `opaqueSlot`, `permutationRef`, `sourceArmGuess`, and `sourceArmGuessConfidenceBasisPoints`; arm guessing is not applicable to their disclosed queues. Unknown fields are rejected in every variant.

`rankAcceptability[]` is the raw judgment store: entries must match `semanticOutput.items[].position`, have unique contiguous positions starting at 1, and include every emitted item up to position 3. Raw reviews are immutable private artifacts at:

```text
suggestion/.local/evaluations/dayflow-ablation/reviews/<reviewId>.json
```

`Acceptable@1` is derived from the rank-1 judgment; `Acceptable@3` is derived from whether any judgment at ranks 1 through 3 is `yes`. Missing-output treatment follows the frozen analysis policy rather than inventing rank judgments. The aggregate artifact at `suggestion/.local/evaluations/dayflow-ablation/aggregates/<analysisId>.json` stores both metrics at these schema paths:

```text
aggregateSchemaVersion: dayflow-ablation-aggregate-v0.1
analysisId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
finalDatasetBindingId
finalDatasetBindingSha256
datasetVersion
datasetSha256
metrics.byArm.<A0|A1|B|C>.acceptableAt1:
  acceptableCount
  eligibleCount
  excludedCount
  rate
metrics.byArm.<A0|A1|B|C>.acceptableAt3:
  acceptableCount
  eligibleCount
  excludedCount
  rate
aggregateSha256
```

`PairPreferenceReview` fields:

```text
reviewSchemaVersion: dayflow-ablation-pair-preference-review-v0.2
reviewId
evalId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
comparisonGroupId
checkpointId
leftOutputReviewId
rightOutputReviewId
leftRunId
rightRunId
leftOpaqueSlot
rightOpaqueSlot
permutationVersion
permutationHash
preference: left | right | tie | none
reviewerPseudonym
reviewedAt
committedAt
commitSequence
pairPreferenceReviewSha256
```

Every PairPreferenceReview also has globally unique `reviewId` and `evalId`; both ID namespaces are shared across the OutputReview and PairPreferenceReview schemas. It is the only PairPreferenceReview in its globally unique `comparisonGroupId`, which must already contain exactly the two referenced A1/B OutputReviews and no other record. `commitSequence` is a store-assigned monotonic decimal string. Validation requires that both OutputReviews are immutable and have `committedAt` no later than, and `commitSequence` strictly lower than, the pair review; all three records have the same checkpoint and reviewer pseudonym; the two runs have the same protocol, replicate, matched-pair ID, and exact request-order-manifest relation; left/right review IDs resolve to those declared distinct A1/B run IDs; opaque slots and run orientation match the exact permutation version/hash; and no ID or group has already been used elsewhere. Any cardinality, duplicate, uniqueness, linkage, reviewer, checkpoint, protocol, replicate, matched-pair, manifest, permutation, or commit-order failure is rejected.

Primary metrics:

- Acceptable@1 and Acceptable@3 for A0, A1, B, and separately C.
- Paired B-versus-A1 win, tie, and loss counts.
- Mean specificity and next-action clarity.
- Wrong identity rate.
- Unsupported state-claim rate.
- Stale or completed work resurfacing rate.
- Confirmed privacy leak rate.
- Added latency, compute, and retained-byte cost.
- Reviewer source-arm guess accuracy as a blinding diagnostic.
- B screen-evidence fallback and availability-failure rate.

Pilot plan:

| Phase | Checkpoints | Purpose |
| --- | ---: | --- |
| Instrumentation pilot | 15 | Validate contracts, blind review, and deletion |
| Directional private study | Exactly 60 eligible non-overlapping checkpoints over at least 10 working days | Estimate paired quality difference |
| Contract-conformance regression | Synthetic fixtures only | Reproducible contract evidence; never quality, baseline, release, `H-PILOT-GO`, or `H-E2` evidence |
| Reviewed live regression candidate | Explicitly reviewed/anonymized live data only | Eligible for a later separately approved release process; this study itself makes no release claim |

Suggested promotion thresholds for a later decision:

- B improves Acceptable@1 over A1 by at least 10 percentage points.
- B does not increase wrong identity or unsupported state claims.
- Confirmed privacy leaks are zero.
- Automatic execution or mutation is zero.
- Every screen-derived title is traceable to normalized evidence and source hashes.
- C is reported independently and is not required to beat A for B to proceed.

These are provisional experiment thresholds, not production release approval.

Before the directional study, freeze checkpoint eligibility, sampling interval, exclusion reasons, missing-output handling, fallback handling, and minimum discordant-pair count. Checkpoints from overlapping capture windows are not treated as independent. Report a paired effect interval with resampling clustered by working day and WorkContext. The first study remains directional single-user evidence even if the interval excludes zero.

## 12. Privacy and retention

Screen capture requires a new consent contract. Existing connector, Work Board monitoring, semantic continuation, or quality-feedback consent cannot be reused.

Recommended pilot defaults requiring explicit user approval:

| Policy | Recommended default |
| --- | --- |
| Processing | Local only |
| Cloud image upload | Disabled |
| Blabase raw export/blob-copy retention | Maximum 24 hours |
| Pilot-created Dayflow canonical source-frame retention | Maximum 24 hours; if Dayflow cannot enforce this TTL, live pilot capture is forbidden unless a longer TTL receives separate explicit approval |
| Redacted normalized evidence retention | Maximum 30 days |
| Blabase completed export bundle retention | Maximum 24 hours |
| OCR text, thumbnails, extractor temporaries, and model intermediates | In-memory when possible; otherwise maximum 1 hour |
| Checkpoint, arm output, blind mapping, and private review retention | Maximum 30 days |
| Pilot verification attestation | Private metadata/no raw blobs; audit need only, maximum 30 days from `verifiedAt`; earliest applicable deletion/revocation/invalidation/rollback trigger wins |
| DFA-002 pending evidence chain | Private source/code governance metadata; maximum 30 days from `sourcePinSet.createdAt`, with earlier abandonment/rejection/scope-revocation/rollback purge; stale/abandoned artifacts are never promoted and remain pending safe purge/replacement; only a complete chain referenced by an approved current freeze enters append-only source/audit retention |
| Staging and incomplete bundle retention | Maximum 1 hour, then reconciled |
| Content-free aggregate metrics | Indefinite only after privacy review |
| Diagnostic logs | Content-free, maximum 30 days |
| Capture state | Visible with immediate pause |
| App/window denylist | Required before capture |
| Password, authentication, banking, health, private messaging | Denied by default |
| Git or Golden Dataset storage | Forbidden for raw human frames |
| Backup inclusion | Disabled by default |

Blabase-owned raw export/blob copies, OCR text, private model output, and human notes stay under an approved private `.local/` store with `0700` directories and `0600` files. Dayflow canonical source frames remain Dayflow-owned in its separate storage root; import never transfers their ownership or makes the Blabase copy and canonical source the same retention class. Public reports contain hashes and aggregate metrics only.

DFA-002 pre-freeze evidence contains no raw screen/conversation/blob. Command receipts retain
only raw output byte length/hash plus bounded sanitized text and explicit redaction metadata;
the unsanitized bytes are not persisted. Readable diff v0.3 contains bounded UTF-8 before/after
source content and rejects private-secret material. Pins, receipts, diff, machine bundle, human
receipt and proposal remain private, Git/backup/export/telemetry-excluded metadata. A sensitive
or mismatched artifact is abandoned and replaced rather than edited in place, then safely purged
under the pending-chain retention rule.

The experiment store requires its own lifecycle implementation before live collection: approved encryption/threat model, per-class TTL, consent-revocation tombstone, in-flight publication fencing, atomic purge, crash-left staging reconciliation, deletion receipt, and verified backup exclusion. The existing private evaluation writer provides no-clobber publication but does not provide this lifecycle by itself.

Each deletion receipt reports both stores independently:

```text
deletionReceiptSchemaVersion: dayflow-ablation-deletion-receipt-v0.1
deletionReceiptId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
affectedArtifactRefs[] sorted unique
blabaseRawCopyStatus: deleted | not-present | pending | failed
blabaseRawCopyPurgedAt
dayflowCanonicalSourceStatus: deleted | not-present | retained-under-separate-explicit-approval | pending | failed
dayflowCanonicalSourcePurgedAt
dayflowCanonicalRetentionExceptionRef: required when retained {
  schemaVersion: dayflow-ablation-human-approval-v0.1
  approvalType: H-EXCEPTION
  approvalRecordId
  approvalRecordSha256
}
createdAt
deletionReceiptSha256
```

A receipt is not successful while either required purge is `pending` or `failed`. Pilot-created Dayflow frames must be `deleted` or `not-present` within 24 hours unless the later receipt resolves `dayflowCanonicalRetentionExceptionRef` to a pre-existing, current `H-EXCEPTION` with `exceptionKind: longer-retention` whose affected-artifact scope and deadlines cover those frames.

After raw deletion, suggestion replay starts from the frozen normalized evidence rather than re-running image extraction. Production screenshots cannot become Gold without a separate lawful-basis, minimization, anonymization, and human-review decision.

### Typed live-collection approvals

`DFA-007` requires an immutable typed `H-THREAT-MODEL-DESIGN` approval of the **threat-model design** before the lifecycle implementation is considered complete. This design approval is distinct from phase-specific authorization to collect live data.

Every approval uses the strict `dayflow-ablation-human-approval-v0.1` discriminated union. The common base is:

```text
approvalSchemaVersion: dayflow-ablation-human-approval-v0.1
approvalRecordId
lineageClass: control
approvalType: H-CROSS-REPO | H-THREAT-MODEL-DESIGN | H-LIVE-CAPTURE | H-PILOT-GO | H-E2 | H-EXCEPTION
approverPseudonym
approvedAt
scopeHash
approvalRecordSha256
```

Strict variants add exactly these fields:

```text
H-CROSS-REPO:
  decision: approved
  repositoryRef { repositoryId, canonicalPath, pinnedHeadSha256 }
  writeScope { branchName, allowedPaths[] sorted unique }

H-THREAT-MODEL-DESIGN:
  decision: approved
  threatModelRef { version, sha256 }
  encryptionPolicyRef { version, sha256 }
  retentionPolicyRefs[] sorted unique by (version, sha256)
  localSameUserBoundaryRef { version, sha256 }

H-LIVE-CAPTURE:
  decision: approved
  phase: private_pilot | directional_study
  studyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
  consentRevision
  captureScopeHash
  capturePolicyRef { version, sha256 }
  denylistPolicyRef { version, sha256 }
  retentionPolicyRef { policyId, sha256 }
  encryptionDeploymentRef { version, sha256 }
  artifactGovernancePolicyRefs[] sorted unique by (artifactClass, policyId): { artifactClass, policyId, policySha256 }
  localOnly: true
  cloudImageUpload: false
  validFrom
  validUntil
  revokedAt: optional

H-PILOT-GO:
  decision: approved
  pilotFinalBindingRef { schemaVersion: dayflow-ablation-final-dataset-binding-v0.1, finalDatasetBindingId, finalDatasetBindingSha256 }
  pilotVerificationAttestationRef { schemaVersion: dayflow-ablation-pilot-verification-attestation-v0.1, pilotVerificationAttestationId, pilotVerificationAttestationSha256 }
  pilotDeletionEvidenceRefs[] non-empty, sorted unique by (deletionReceiptId, deletionReceiptSha256):
    { schemaVersion: dayflow-ablation-deletion-receipt-v0.1, deletionReceiptId, deletionReceiptSha256 }
  directionalTarget { phase: directional_study, studyProtocolHash }
  liveCaptureApprovalRef { schemaVersion: dayflow-ablation-human-approval-v0.1, approvalRecordId, approvalRecordSha256 }
  validFrom
  validUntil
  revokedAt: optional

H-E2:
  decisionTarget: e2-candidate-discovery-design
  decision: design-E2 | do-not-proceed
  targetStudyProtocolRef { schemaVersion: dayflow-ablation-study-protocol-v0.1, studyProtocolHash }
  targetFinalBindingRef { schemaVersion: dayflow-ablation-final-dataset-binding-v0.1, finalDatasetBindingId, finalDatasetBindingSha256 }
  qualityEvidenceRefs[] non-empty, sorted unique by (artifactType, schemaVersion, artifactId, artifactSha256):
    { artifactType: aggregate | output-review | pair-preference-review, schemaVersion, artifactId, artifactSha256 }
  decisionReasonCode
  decisionNote: optional private text

H-EXCEPTION:
  decision: approved
  exceptionKind: non-blocking-check | longer-retention
  exceptionScope { phase: implementation | private_pilot | directional_study | post_study_audit, artifactTypes[] non-empty sorted unique }
  reasonCode
  ownerPseudonym
  expiresAt
  compensatingControls[] non-empty sorted unique
  affectedArtifactRefs[] non-empty, sorted unique by (artifactType, schemaVersion, artifactId, artifactSha256):
    { artifactType, schemaVersion, artifactId, artifactSha256 }
  requiredChecksPassInvariant: true
  when exceptionKind = non-blocking-check:
    checkRef { checkId, blockingClassification: non-blocking }
    originalDeadline, extendedDeadline: forbidden
  when exceptionKind = longer-retention:
    originalDeadline
    extendedDeadline
    checkRef: forbidden
```

For `H-E2.qualityEvidenceRefs[]`, the only valid discriminator/schema pairs are `aggregate -> dayflow-ablation-aggregate-v0.1`, `output-review -> dayflow-ablation-output-review-v0.2`, and `pair-preference-review -> dayflow-ablation-pair-preference-review-v0.2`. `H-EXCEPTION.affectedArtifactRefs[]` must use an artifact type/schema pair from the immutable-artifact registry in Section 14; arbitrary schema strings are invalid.

All common and selected-variant fields are required except fields explicitly marked optional. Fields belonging to another variant are forbidden, unknown fields are rejected, arrays are sorted/unique, and every typed ref must resolve with the declared hash and the schema allowed by its discriminator. Only a selected variant's declared phase, protocol, validity, decision, and revocation fields apply; they are not blanket common-base requirements. `H-E2` quality evidence must include the target binding's aggregate, and every evidence ref must resolve to the target protocol/final binding where that artifact carries those fields. `H-EXCEPTION` is valid only for an explicitly classified non-blocking check or a separately approved longer-retention interval created before `originalDeadline`; for longer retention, `originalDeadline < extendedDeadline <= expiresAt`. It contains no deletion-receipt reference and cannot be amended when a receipt is created. The later deletion receipt carries the typed `H-EXCEPTION` ID/hash ref. If inverse/future navigation is later needed, only a separate derived forward-link audit index may carry outgoing typed refs to the immutable exception and receipt; neither source artifact is altered, and the index must receive its own exact versioned schema/hash domain before creation. Mutual hash references, reverse refs into that index, and cycles are invalid. `H-EXCEPTION` cannot waive, omit, or turn failure into pass for any required typecheck, lint, test, baseline, architecture check, privacy/safety gate, typed approval, or deletion obligation. Every live-collection freeze uses an `approvalRefs[]` array of `{ approvalType, approvalRecordId, approvalRecordSha256 }` and has no singular `approvalRef`.

For the private pilot, the freeze resolves one current, unrevoked `H-LIVE-CAPTURE` scoped to that pilot. Before DFA-014 begins, the pilot exclusion closure, final manifest, final binding, immutable pilot-verification attestation, and all required pilot deletion receipts must be complete; the proposed directional `studyProtocolHash` must be frozen; and a current directional `H-LIVE-CAPTURE` for that exact target must exist. A `go` decision creates `H-PILOT-GO` that binds the pilot final binding, exact verification attestation, successful deletion evidence, directional phase/protocol target, and that directional live approval. A no-go/revise outcome updates the Engine Change Record and immutable state generation but does not create `H-PILOT-GO`. The directional live freeze then resolves the exact embedded `H-LIVE-CAPTURE` plus `H-PILOT-GO`, both current and scope-valid. Any missing/duplicate/expired/revoked/mixed-scope ref fails closed.

The resolved H-LIVE-CAPTURE and live freeze MUST exactly match freeze `targetDataOrigin: live`, approval `phase` to freeze `targetStudyPhase` using the same underscore enum, study-protocol ref, capture-scope hash, consent revision, typed capture-policy, denylist-policy, retention-policy, encryption-deployment refs including hashes, the complete sorted `artifactGovernancePolicyRefs[]`, `localOnly: true`, and `cloudImageUpload: false`. A version/ID-only match is insufficient.

Human scope approval은 Section 0의 Draft ECR에 기록되고 `H-DFA-CONTRACT`는 이 JCS live
approval union과 분리된 human contract decision이다. Candidate TypeScript parser가 scope
또는 contract approval을 자체 생성하는 순환은 금지한다. DFA-002는 existing
ContractFreezeProposal을 참조하는 별도 `H-DFA-CONTRACT` section, DFA-012는 completion
section만 추가한다.

## 13. Blabase code boundary

The first implementation uses new experiment-only modules.

```text
suggestion/src/dayflowEvidence/contracts.ts
suggestion/src/dayflowEvidence/normalize.ts
suggestion/src/dayflowEvidence/extract.ts
suggestion/src/evaluation/dayflowAblation/contracts.ts
suggestion/src/evaluation/dayflowAblation/buildDataset.ts
suggestion/src/evaluation/dayflowAblation/evaluate.ts
suggestion/src/evaluation/dayflowAblation/run.ts
suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.1.json
suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.1.json
suggestion/tools/run-dayflow-evidence-ablation.ts
suggestion/tests/dayflowEvidenceContracts.test.ts
suggestion/tests/dayflowEvidenceExtraction.test.ts
suggestion/tests/dayflowAblationEvaluation.test.ts
```

The Dayflow-owned exporter is implemented in a separately approved Dayflow branch rooted at the pinned source revision. Its exact Swift files are recorded in the Draft Engine Change Record before that repository is modified.

Private run artifacts use:

```text
suggestion/.local/evaluations/dayflow-ablation/<runId>.json
```

The first slice must not modify:

- `syncSourceSchema` or runtime connector enums.
- Active Attention inputs, ranking, or resolver.
- Continuation source, identity, candidate, score, or resolver contracts.
- Work Board contracts, ordering, projection, or API routes.
- Launcher, X-001 actions, monitoring, or semantic continuation stores.
- Existing frozen evaluation datasets or historical run artifacts.

The evaluator may reuse `writePrivateEvaluationArtifact` for mode, hash, readback, and no-clobber behavior. That helper is not a no-follow security authority and has a parent-directory TOCTOU window. Import and live-pilot storage use an independently hardened directory-chain and file-open boundary. Any hardening of the shared writer is a separately reviewed change with adversarial symlink-swap tests.

## 14. Reproducibility record

Section 8 contains the single full-run candidate acceptance sketch. Its exact source schema becomes normative only when included in the human-approved source-hash proposal and matching contract freeze. No second run schema or open-ended provenance bag is allowed. All reproducibility fields are either in that closed run union, its typed `executionFreezeRef`, its typed arm-input ref, or the resolved checkpoint/protocol; unknown duplicated version/config fields on a run are rejected.

A0, A1, and B paired runs are valid only when they share the same v0.2 checkpoint and `studyProtocolHash`; A1 and B also share the causal tuple. C may share the capture-window identifier, but it uses an independently hashed screen-only input and is reported separately. The run is immutable and is not backfilled with dataset, review, or analysis state. Direct aggregate comparison starts only after one final-dataset-binding v0.1 references the exact checkpoint and existing run IDs; compared metrics must reference the same final binding ID/hash.

After `contractFrozen`, every experiment JSON artifact governed by the candidate registry
uses the exact schema version and hash domain below. The human-approved Draft scope ECR is
outside that registry. ContractFreezeProposal and ContractFreeze use their frozen source
schemas and hashes. A new candidate-registry type or
version cannot be published until the approved source-hash proposal, both implementations, and canonical
conformance vectors are updated through a new proposal.

The canonical inventory is the frozen `DAYFLOW_ABLATION_ARTIFACT_REGISTRY` in
[`contracts.ts`](../src/evaluation/dayflowAblation/contracts.ts). Its current complete 36-row
projection is:

| Artifact class | Schema version | Hash domain | Storage | Detached hash field |
| --- | --- | --- | --- | --- |
| `dayflow-export-manifest` | `dayflow-screen-evidence-export-v0.1` | `blabase.dayflow-screen-evidence-export.v0.1` | `standalone` | `detachedManifestSha256` |
| `normalized-screen-evidence` | `dayflow-normalized-evidence-v0.1` | `blabase.dayflow-normalized-evidence.v0.1` | `standalone` | `dayflowNormalizedEvidenceHash` |
| `source-pin-set` | `dayflow-ablation-source-pin-set-v0.1` | `blabase.dayflow-ablation.source-pin-set.v0.1` | `standalone` | `sourcePinSetSha256` |
| `artifact-layout-config` | `dayflow-ablation-artifact-layout-config-v0.1` | `blabase.dayflow-ablation.artifact-layout-config.v0.1` | `standalone` | `artifactLayoutConfigSha256` |
| `contract-freeze-proposal` | `dayflow-dfa-contract-freeze-proposal-v0.4` | `blabase.dayflow-dfa.contract-freeze-proposal.v0.4` | `standalone` | `contractFreezeProposalSha256` |
| `dfa-contract-decision` | `dayflow-dfa-contract-decision-v0.4` | `blabase.dayflow-dfa.contract-decision.v0.4` | `standalone` | `contractDecisionSha256` |
| `contract-freeze` | `dayflow-dfa-contract-freeze-v0.4` | `blabase.dayflow-dfa.contract-freeze.v0.4` | `standalone` | `contractFreezeSha256` |
| `dfa-command-receipt` | `dayflow-dfa-command-receipt-v0.1` | `blabase.dayflow-dfa.command-receipt.v0.1` | `standalone` | `commandReceiptSha256` |
| `dfa-readable-diff` | `dayflow-dfa-readable-diff-v0.3` | `blabase.dayflow-dfa.readable-diff.v0.3` | `standalone` | `readableDiffSha256` |
| `dfa-machine-evidence-bundle` | `dayflow-dfa-machine-evidence-bundle-v0.3` | `blabase.dayflow-dfa.machine-evidence-bundle.v0.3` | `standalone` | `machineEvidenceBundleSha256` |
| `dfa-human-review-receipt` | `dayflow-dfa-human-review-receipt-v0.3` | `blabase.dayflow-dfa.human-review-receipt.v0.3` | `standalone` | `humanReviewReceiptSha256` |
| `evaluation-execution-freeze` | `dayflow-ablation-evaluation-execution-freeze-v0.1` | `blabase.dayflow-ablation.evaluation-execution-freeze.v0.1` | `standalone` | `evaluationExecutionFreezeSha256` |
| `live-collection-freeze` | `dayflow-ablation-live-collection-freeze-v0.1` | `blabase.dayflow-ablation.live-collection-freeze.v0.1` | `standalone` | `liveCollectionFreezeSha256` |
| `human-approval-record` | `dayflow-ablation-human-approval-v0.1` | `blabase.dayflow-ablation.human-approval.v0.1` | `standalone` | `approvalRecordSha256` |
| `study-protocol` | `dayflow-ablation-study-protocol-v0.1` | `blabase.dayflow-ablation.study-protocol.v0.1` | `standalone` | `studyProtocolHash` |
| `request-order-manifest` | `dayflow-ablation-request-order-manifest-v0.1` | `blabase.dayflow-ablation.request-order-manifest.v0.1` | `standalone` | `requestOrderManifestSha256` |
| `request-issuance-receipt` | `dayflow-ablation-request-issuance-receipt-v0.1` | `blabase.dayflow-ablation.request-issuance-receipt.v0.1` | `standalone` | `requestIssuanceReceiptSha256` |
| `blind-permutation` | `dayflow-ablation-blind-permutation-v0.1` | `blabase.dayflow-ablation.blind-permutation.v0.1` | `standalone` | `permutationHash` |
| `candidate-dataset-generation` | `dayflow-ablation-candidate-dataset-generation-v0.1` | `blabase.dayflow-ablation.candidate-dataset-generation.v0.1` | `standalone` | `candidateDatasetGenerationSha256` |
| `exclusion-decision` | `dayflow-ablation-exclusion-decision-v0.1` | `blabase.dayflow-ablation.exclusion-decision.v0.1` | `standalone` | `exclusionDecisionSha256` |
| `exclusion-closure` | `dayflow-ablation-exclusion-closure-v0.1` | `blabase.dayflow-ablation.exclusion-closure.v0.1` | `standalone` | `exclusionClosureSha256` |
| `final-dataset-manifest` | `dayflow-ablation-final-dataset-manifest-v0.1` | `blabase.dayflow-ablation.final-dataset-manifest.v0.1` | `standalone` | `datasetSha256` |
| `final-dataset-binding` | `dayflow-ablation-final-dataset-binding-v0.1` | `blabase.dayflow-ablation.final-dataset-binding.v0.1` | `standalone` | `finalDatasetBindingSha256` |
| `pilot-verification-attestation` | `dayflow-ablation-pilot-verification-attestation-v0.1` | `blabase.dayflow-ablation.pilot-verification-attestation.v0.1` | `standalone` | `pilotVerificationAttestationSha256` |
| `evaluation-checkpoint` | `dayflow-ablation-checkpoint-v0.2` | `blabase.dayflow-ablation.checkpoint.v0.2` | `standalone` | `checkpointSha256` |
| `checkpoint-completion` | `dayflow-ablation-checkpoint-completion-v0.1` | `blabase.dayflow-ablation.checkpoint-completion.v0.1` | `standalone` | `checkpointCompletionSha256` |
| `a0-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.a0.v0.4` | `standalone` | `armInputHash` |
| `a1-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.a1.v0.4` | `standalone` | `armInputHash` |
| `b-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.b.v0.4` | `standalone` | `armInputHash` |
| `c-arm-input` | `dayflow-ablation-arm-input-v0.4` | `blabase.dayflow-ablation.arm-input.c.v0.4` | `standalone` | `armInputHash` |
| `semantic-output` | `dayflow-ablation-semantic-output-v0.1` | `blabase.dayflow-ablation.semantic-output.v0.1` | `standalone` | `semanticOutputSha256` |
| `arm-run` | `dayflow-ablation-run-v0.4` | `blabase.dayflow-ablation.run.v0.4` | `standalone` | `runSha256` |
| `output-review` | `dayflow-ablation-output-review-v0.2` | `blabase.dayflow-ablation.output-review.v0.2` | `standalone` | `outputReviewSha256` |
| `pair-preference-review` | `dayflow-ablation-pair-preference-review-v0.2` | `blabase.dayflow-ablation.pair-preference-review.v0.2` | `standalone` | `pairPreferenceReviewSha256` |
| `deletion-receipt` | `dayflow-ablation-deletion-receipt-v0.1` | `blabase.dayflow-ablation.deletion-receipt.v0.1` | `standalone` | `deletionReceiptSha256` |
| `aggregate` | `dayflow-ablation-aggregate-v0.1` | `blabase.dayflow-ablation.aggregate.v0.1` | `standalone` | `aggregateSha256` |

Each candidate-registry row is the closed tuple `{ artifactClass, schemaVersion,
hashDomain, storageMode, detachedHashField }`, where `storageMode` is exactly
`standalone | embedded`; all 36 current rows are `standalone`.
The human-approved Draft scope ECR has no candidate-registry row. ContractFreezeProposal and
ContractFreeze use their frozen source schema/hash rules; confusing those refs with another
registry domain fails closed.

Layout `pathTemplates[]` is an exact bijection over `storageMode: standalone` rows only. State generations and `CURRENT_STATE.json` are operational non-registry layout exceptions: generations are immutable whole-file-hashed JSON and `CURRENT_STATE.json` is the one replaceable pointer following Section 21.3 bytes/CAS rules; neither has a registry storage mode. Export blobs are outside the JSON registry as immutable raw-byte blobs at the layout's export-blob template; their owner is exactly one resolved export-manifest frame entry and their SHA-256 is over raw bytes. No other storage mode, embedded owner, pointer, or blob exception is allowed.

C's run input contains only the screen-only projection. The run artifact stores the canonical payload hash outside the payload being hashed. Raw screenshot blobs retain their raw-byte SHA-256 recorded by the export manifest; they are not JCS JSON artifacts.

Every hash preimage is `UTF8(domain + "\u0000") || JCS(value)`. Contract timestamps are UTC RFC 3339 strings with exactly three fractional digits and `Z`. Strings are valid Unicode scalar sequences with no control or bidi formatting characters unless a field explicitly permits them. Numbers are finite JSON numbers; identifiers, byte counts above the safe integer range, and source row IDs are decimal strings. Swift and TypeScript must pass the same normative RFC 8785/JCS vectors before an export is accepted.

The table's `Detached hash field` column is exhaustive and authoritative for the current
registry: each standalone strict schema omits exactly that one field from its registered JCS
hash preimage and no other field. State generation and its replaceable pointer are operational
non-registry artifacts: `stateGenerationSha256` is SHA-256 of the exact whole-file UTF-8/LF raw
bytes and proves byte integrity only. Raw export blobs and the Draft scope ECR likewise use their
declared byte/hash rules.

## 15. Test strategy

Contract and privacy cases:

- Unknown export version.
- Database/read failure versus valid empty window.
- Missing, changed, oversized, or hash-mismatched blob.
- Absolute path, URL, credential, token, email, private identifier, and control-character leakage.
- Unknown privacy state and placeholder ambiguity.
- Consent mismatch, revoke, expiry, and deletion.
- Future, duplicate, same-second, out-of-order, deleted, and out-of-window rows.
- Raw LLM body, timeline chat, and provider header exclusion.

Evaluation cases:

- A0, A1, and B share the permitted structured checkpoint; C shares only `captureWindowId` and uses an independent screen-only input.
- Exactly one export is created per capture window; only B and C can consume normalized screen evidence, while A0/A1 inputs expose only allowlisted window/checkpoint identifiers.
- Checkpoint v0.2/run v0.4 reject collection-time `datasetVersion`, `datasetSha256`, final binding, review, and analysis fields.
- A checkpoint accepts only an optional prior candidate-generation ref whose completed ancestry cannot contain that checkpoint.
- Candidate generations include only already completed checkpoint ID/hash refs, supersede at most one prior generation, and reject cycles, self-reference, missing refs, and forward refs.
- Candidate-generation strict schema rejects missing/unknown fields, unsorted/duplicate checkpoint or run refs, non-completed refs, wrong hashes, mixed protocols, and invalid parent refs.
- Exclusion closure covers every source-generation checkpoint exactly once with an inclusion/exclusion reason and rejects extra/missing decisions, reverse refs, mixed protocols, and unknown fields.
- Final manifest includes exactly the closure's included checkpoints and source-generation runs in canonical sorted order; detached dataset hash, closure ref, protocol, and dataset version are validated.
- Final binding `runBindings[]` is an exact bijection over the flattened manifest run refs: equal cardinality, every manifest run exactly once, and no omit/add/duplicate; `checkpointId`, `checkpointSha256`, `runId`, `runSha256`, `armId`, `replicateIndex`, and conditional `matchedPairId` mismatches are rejected.
- The `candidate -> closure -> manifest -> binding` DAG rejects reverse edges, cycles, mixed protocols, missing refs, and payload/hash mismatches.
- Direct aggregate comparisons reject mixed or missing final binding IDs/hashes.
- Deterministic replay and deterministic blind permutation.
- A current Attention and Board byte/hash equality.
- B invalid-screen fallback equivalence to A1.
- A1 and B execute the exact same refiner/model/prompt/template/config tuple.
- Dayflow mutations cannot alter A1 input or output.
- Structured fields outside the fixed candidate cannot alter B input or output.
- C receives no structured-source, registry, target-label, or fixed-candidate fields.
- Changing all structured and registry fields cannot alter C input or output.
- Changing structured, registry, or target-label data cannot alter `extractorInputHash`, normalized screen evidence, or C output.
- Screen evidence cannot produce pass/fail/completed/deployed claims.
- Structured direct evidence wins every conflict.
- Capture gaps never imply inactivity.
- Private artifacts never enter Git or public reports.
- Stable row/blob snapshot publication rejects incomplete bundles.
- Capture-side denylist and placeholder attestation fail closed.
- Consent revocation fences export, normalization, review, and publication.
- TTL purge covers exports, staging, checkpoints, outputs, blind mappings, notes, logs, and backups.
- TTL purge covers OCR text, thumbnails, extractor temporaries, and model intermediates.
- Every immutable artifact uses its registered exact versioned hash domain, and canonical hash conformance vectors match across producers and consumers.
- Local extractor redaction, bounded resources, typed failure, and claim-to-frame lineage pass synthetic and reviewed-redacted fixtures.
- Deterministic seed or matched replicate behavior is reproducible.
- Mixed consent or capture-policy revision bundles are rejected.
- Blind review rejects double-submit and measures arm-guess leakage.
- OutputReview and PairPreferenceReview enforce globally unique `evalId`/`reviewId`, shared `comparisonGroupId`, same reviewer/checkpoint, correct run/permutation linkage, and OutputReview commit before pair review.
- Each causal `comparisonGroupId` is globally unique and accepts exactly two OutputReviews (one A1, one B) plus one PairPreferenceReview; duplicate/extra/missing records are rejected.
- Reviewed A1/B runs must match checkpoint, protocol, replicate, `matchedPairId`, and the exact shared request-order-manifest entries; duplicates and every mismatch are rejected.
- A1/B arm inputs, request-order-manifest entries, request-issuance receipts, and causal runs must repeat the exact `requestId`/`requestPosition`; issuance receipts form one contiguous predecessor-hash chain, and missing, duplicate, reordered, or cross-request refs fail closed.
- Live study protocol, evaluation-execution freeze, and live-collection freeze must agree on phase-locked `targetCheckpointCount` (`private_pilot=15`, `directional_study=60`); every other count or cross-record mismatch is rejected.
- A pilot-verification attestation is issued only pre-purge for exactly 15 complete private-pilot checkpoint bundles; `H-PILOT-GO` must bind its exact typed ref plus deletion-receipt refs, and post-purge verification must resolve metadata, the immutable attestation, historical-as-of authority, and receipts without a raw blob.
- Approval discriminated-union tests cover every variant's required and forbidden fields, unknown-field rejection, sorted/unique arrays, discriminator-specific typed-ref schemas/hashes, and only the selected variant's phase/protocol/validity rules.
- `H-E2` tests require the E2 target, target protocol/final binding, target-binding aggregate and typed quality-evidence refs, valid decision enum, and reason; missing, extra, cross-protocol, or cross-binding evidence is rejected.
- `H-EXCEPTION` tests enforce both conditional variants: only an explicitly non-blocking check or separately approved longer retention is allowed; scope/reason/owner/expiry/controls/affected-artifact refs are required, longer retention requires valid `originalDeadline < extendedDeadline <= expiresAt`, other-subvariant fields and every exception-to-receipt ref are forbidden, expired refs fail, and required-check failure or omission cannot be bypassed.
- A retained deletion receipt must resolve its typed `H-EXCEPTION` ID/hash and covered artifact/deadline; exception/receipt mutual hash refs, reverse refs into an optional separate audit index, and every reference cycle are rejected without altering either immutable source artifact.
- Typed live approvals reject missing, duplicate, expired, revoked, wrong-phase, wrong-protocol, wrong-scope, or hash-mismatched refs; `H-PILOT-GO` must bind the pilot final binding, exact pilot-verification attestation, successful deletion evidence, directional protocol target, and exact current directional `H-LIVE-CAPTURE`.
- DFA-007 acceptance includes an immutable threat-model **design** approval and does not substitute a later live-capture approval for it.
- DFA-007 tests cover create-no-overwrite attestation publication, current and historical-as-of authority resolution, currentness/revocation, private store/read/purge, the `verifiedAt`-anchored 30-day hard cap and earlier purge triggers, deletion-receipt coverage, and corruption/rollback fail-closed behavior; the schema remains free of invented TTL fields.

## 16. Task breakdown

| Task | Description | Dependency | Done criteria | Risk |
| --- | --- | --- | --- | --- |
| DFA-000 | Record the human-approved local synthetic scope in one full-template Draft ECR | None | `ECR-DFA-000-DAYFLOW-ABLATION-SYNTHETIC-SCOPE-2026-08-17` records exact tracked paths, prohibitions, status, rationale and rollback | Low |
| DFA-001 | Validate the planned LikeC4 external export boundary with standard repository commands and independent QA | DFA-000 | Format, source-link, model validation and build commands succeed with recorded results/tool versions; QA confirms planned-only changes and unchanged model/dynamics | Medium |
| DFA-002 | Build strict synthetic source schemas/fixtures/tests, complete DFA-002A, propose the expanded exact source hashes, and independently freeze the approved contract | DFA-001 | A fresh exact 12-candidate/10-command-input source pin set, four fresh command receipts v0.1, regenerated readable diff v0.3, machine evidence bundle v0.3, and authenticated `david` human-review receipt v0.3 resolve into a proposal v0.4; `H-DFA-CONTRACT` then requires the matching `david` decision v0.4 and freeze v0.4 readback; no live/quality/baseline/release claim | Medium |
| DFA-002A (nested work package) | Implement only the approved local governance adapters and adversarial tests in two exact paths before DFA-002 exit | DFA-001, Colin's DFA-002A scope decision | Bounded read-only local Git acquisition, hardened `.local` governance reads, proposal history/currentness/CAS and hard-link atomic no-clobber proposal publication pass targeted validation; the stale ten-candidate bundle is replaced by a fresh 12/10 chain; no human/decision/freeze/live/external capability | Medium |
| DFA-003 | Implement Dayflow-owned capture policy and atomic exporter on a pinned Dayflow branch | DFA-002, strict `H-CROSS-REPO` | Pinned repository/head/write scope resolve; denylist, stable bundle, complete marker pass | High |
| DFA-004 | Implement Blabase private export verifier/importer | DFA-002, DFA-003 | Hash, bounds, typed failure, independent no-follow tests pass | High |
| DFA-005 | Implement local-only extraction, minimization, and claim verification | DFA-002 | Screen-only input hash, redaction, bounds, field lineage, typed failures pass; no model/provider call occurs before DFA-006 execution freeze | High |
| DFA-006 | Freeze a new immutable evaluation-execution revision, then implement A0/A1/B paired E1 evaluator, separate C runner, strict dataset DAG, and matched-pair manifest validation | DFA-002, DFA-005 | Execution freeze pins provider/model/prompt/template/config/generation/replicate/randomization/review tuple without mutating the trusted contract freeze; screen isolation, DAG, matched-pair/request-manifest, replay tests pass | High |
| DFA-007 | Implement private-store lifecycle, authoritative current/historical-as-of resolution, immutable pilot-attestation publication/storage, strict approval validation, purge, and deletion receipts | DFA-002 | Typed `H-THREAT-MODEL-DESIGN` present; create-no-overwrite, historical-as-of/currentness/revocation, attestation store/read/purge, TTL/receipt, corruption and rollback fail-closed tests pass | High |
| DFA-008 | Implement blinded local review surface and final-binding-scoped aggregate metrics | DFA-006, DFA-007 | Globally unique group has exactly A1+B OutputReviews and one Pair; IDs, reviewer/checkpoint, matched pair, permutation, commit order validate | Medium |
| DFA-009 | Run targeted synthetic contract-conformance regression | DFA-006 | Exact versions, hashes, run IDs, private artifacts, and false quality/baseline/release claim flags recorded | Medium |
| DFA-010 | Update implemented LikeC4 model | DFA-003, DFA-004, DFA-005, DFA-006, DFA-007, DFA-008 | `model.c4` matches implementation and validates | Medium |
| DFA-011 | Run final automated verification | DFA-006, DFA-007, DFA-008, DFA-010 | Typecheck, lint, all required tests, required existing Golden baseline check, targeted synthetic contract regression, `arch:deps:check`, `arch:model:check`, and `arch:check` pass; missing tests fail | Medium |
| DFA-012 | Finalize Engine Change Record | DFA-009, DFA-011 | Exact evidence, scope, limitations, accepted exceptions, architecture results recorded | Medium |
| DFA-013 | Approve and run 15-checkpoint local pilot and close pilot dataset | DFA-004, DFA-005, DFA-007, DFA-008, DFA-012 | Phase-scoped current `H-LIVE-CAPTURE`; exactly 15 checkpoints resolve through closure/manifest/binding; the immutable pilot-verification attestation is published pre-purge; deletion evidence and manual inspection complete | High |
| DFA-014 | Human go/no-go after pilot | DFA-013 | Entry validates pilot binding, exact pilot-verification attestation, deletion evidence, and directional protocol/live approval; go emits strict `H-PILOT-GO`, no-go emits none | High |
| DFA-015 | Run 60-checkpoint directional study and close dataset | DFA-014 | Current phase-scoped `H-LIVE-CAPTURE` + `H-PILOT-GO`; closure and final binding produced; paired report uses only that binding | High |
| DFA-016 | Decide whether to design E2 candidate discovery | DFA-015 | Strict `H-E2` binds the target protocol/final binding, quality evidence, decision, and reason | High |

`DFA-002A` is a scoped implementation work-package label, not a new value in the closed
`DFA-000..016` machine task enum. While it is `in_progress`, the machine state remains
`currentTask: DFA-002`, `executionStatus: pending`.

## 17. Approval gates

DFA-001 may proceed under the human-approved tracked-path and safety scope recorded in the
Draft ECR. That approval authorizes no contract. DFA-002 remains a provisional candidate
and DFA-002A remains an in-progress local implementation package until its two paths and tests
are validated. DFA-002 cannot exit until its fresh 12/10 source pin, four fresh authoritative
command receipts v0.1, readable diff v0.3,
machine evidence bundle v0.3, and authenticated `david` human-review receipt v0.3 resolve into a
`ContractFreezeProposal` v0.4, which is then approved through the matching `david` decision
v0.4 and published/read back as the matching immutable freeze v0.4. DFA-012 appends a separate completion record;
it never edits the Draft section or labels synthetic evidence a baseline claim.

For this pending gate, `colin` is the proposal's working owner/proposer and owner reviewer;
`david` is the authenticated independent reviewer. Proposal v0.4 has one proposer and an
`independentHumanReviewReceiptRef`; human-review receipt v0.3 fixes the reviewer as `david`,
and decision v0.4 fixes the approver as `david` while binding that same receipt. This is not a
2-of-2 decision rule. `colin`'s owner confirmation remains a workflow requirement but is not
an additional schema approval; only `david` satisfies independence and may sign the future
`approved | rejected` decision. No human-review receipt, proposal, confirmation, decision, or
freeze exists yet.

DFA-003 requires strict `H-CROSS-REPO` with the exact Dayflow repository identity, pinned HEAD, branch, and allowed write paths. The current Dayflow `main` working tree and its untracked design documents are never modified implicitly.

DFA-003 may implement and test the exporter with synthetic frames, but it must not capture live human data until consent and retention are approved.

DFA-007 cannot complete without an immutable typed `H-THREAT-MODEL-DESIGN` approval of the encryption/local same-user threat-model **design**. It owns immutable create-no-overwrite attestation publication, authoritative current and historical-as-of resolution, currentness/revocation enforcement, private attestation store/read/purge, retention/deletion-receipt coverage, and corruption/rollback fail-closed tests. This is a design gate, not authorization to capture live data.

DFA-013 requires explicit approval of:

- Screen Recording permission and capture indicator behavior.
- App/window/display denylist.
- Raw and derived retention.
- Local-only versus cloud processing.
- Human screenshot inspection policy.
- Full purge behavior and backup exclusion.
- Encryption and local same-user threat model.

The pilot live freeze must resolve one current, unrevoked, phase-scoped `H-LIVE-CAPTURE` typed ref. DFA-014 creates the separate typed `H-PILOT-GO`. The directional-study live freeze must resolve both a current directional-study `H-LIVE-CAPTURE` and the current pilot-derived `H-PILOT-GO`; a singular or untyped approval reference is invalid.

No arm may trigger an action, open a target, write to an external source, change production ranking, or publish a production suggestion during this experiment.

DFA-014 is a mandatory human gate. A successful instrumentation pilot does not automatically authorize the directional study.

DFA-014 entry requires the completed pilot closure, typed final manifest/binding, exact immutable pilot-verification attestation published before raw purge, successful typed pilot deletion receipts, frozen directional `studyProtocolHash`, and a current directional `H-LIVE-CAPTURE` that targets that protocol. Its `go` exit emits exactly one strict `H-PILOT-GO` referencing those artifacts; `no-go` or `revise` forbids an `H-PILOT-GO`. DFA-015 must resolve the same directional live approval referenced by `H-PILOT-GO`.

DFA-016 emits one strict `H-E2` for the reviewed directional study. It binds the exact study protocol, final binding, target-binding aggregate and typed quality evidence, plus the `design-E2 | do-not-proceed` decision and reason. It is not a live-capture or E2 implementation approval.

## 18. Rollback

The experiment is removed by disabling or deleting the experiment-only runner and purging Blabase-owned raw copies, normalized evidence, checkpoints, outputs, reviews, blind mappings, aggregates, incomplete exports, complete export bundles, and staging files through the reviewed Blabase private-store command. Production code paths and stored contracts remain unchanged.

The experimental Dayflow build/exporter is disabled separately, capture permission is revoked if requested, and pilot-created canonical source frames are purged through the reviewed Dayflow-side command under their approved TTL. Pilot-verification attestations remain raw-free Blabase private metadata and are purged by DFA-007's `verifiedAt`-anchored lifecycle with deletion-receipt coverage. The rollback receipt records Blabase-copy and Dayflow-canonical status separately. Rollback never expands this purge to unrelated or pre-existing Dayflow canonical data; pilot-created frames still obey the 24-hour limit unless a separate explicit longer-retention approval exists.

For the corrected DFA-002 candidate, rollback also abandons and safely purges the pre-correction
source pin `dfa002.source-pin.936ddf31a62727536ff2b01e24f46695` and its four receipt files after
replacement/reconciliation. Their validation-input hash
`622f5525e5bf167b3f6b3b6046762b784af80fdde11ed2915322cf1426fe85f4` is stale and must never
enter a proposal. The exact ten pre-DFA-002A candidate files remain separately identified;
DFA-002A adds only the two rollback paths below. No production migration or frozen authority exists.

DFA-002A rollback removes only
`suggestion/src/evaluation/dayflowAblation/governanceAdapters.ts` and
`suggestion/tests/dayflowGovernanceAdapters.test.ts`, restores the preceding 15-path scope, and
abandons any new private 12/10 evidence assembled from them. It never mutates the stale bundle,
Git objects, Dayflow, production state or human governance records.

## 19. Current status

```text
DFA-000  completed
DFA-001  completed
DFA-002  pending  <- DFA-002A required; proposal reassembly pending
DFA-002A in_progress <- bounded local governance work package; not a machine-task enum value
DFA-003  not_started  <- external pin/export implementation deferred; resolution fails closed
DFA-004  not_started
DFA-005  not_started
DFA-006  not_started
DFA-007  not_started  <- trusted authority/attestation lifecycle deferred; resolution fails closed
DFA-008  not_started
DFA-009  not_started
DFA-010  not_started
DFA-011  not_started
DFA-012  not_started
DFA-013  blocked_by_human_approval
DFA-014  blocked_by_DFA-013
DFA-015  blocked_by_DFA-014
DFA-016  blocked_by_DFA-015
```

Planning alone does not require a baseline run because it changes no engine input, output,
filtering, ordering, interpretation, persistence, or release state. The single full-template
Draft ECR records the accepted synthetic scope and deliberate governance simplification.
DFA-001 planned-source validation evidence and independent QA passed. The pre-DFA-002A ten-file
candidate validation and external QA passed, but Colin's approved two-file expansion invalidates
its proposal readiness. DFA-002's closed machine status remains `pending`; DFA-002A work-package
status is `in_progress`; the prose label is "DFA-002A local governance implementation in progress;
DFA-002 proposal reassembly pending".
No schema-valid local proposal was emitted. The pre-correction source pin and four receipts are
stale/abandoned non-authority pending safe purge/replacement. The formerly current ten-candidate
machine bundle is also stale for proposal use; a fresh 12/10 source pin, receipts, readable diff
v0.3, replacement machine-evidence bundle v0.3, authenticated David human-review receipt and
actual contract confirmations do not exist. The
assigned pseudonyms (`colin` proposer/owner reviewer; `david` authenticated independent reviewer/
future sole decision signer) are recorded without fabricating either person's review or an
approval. Colin's tracked-path scope approvals and external QA PASS are not H-DFA-CONTRACT evidence.
Every conformance/quality/baseline/live/release claim remains incomplete or forbidden until the
proposal, independent `H-DFA-CONTRACT`, and matching freeze sequence completes.

## 20. DFA-002 candidate acceptance sketch

This section is a non-authoritative candidate acceptance sketch. It guides provisional
DFA-002 implementation but cannot complete DFA-002 or create conformance, quality, baseline,
live, downstream, or release authority. Section 0 and the human-approved Draft ECR define the
pre-code tracked-path and safety scope. The exact TypeScript schema/registry/fixture bytes
become normative only when their source-hash proposal is approved by `H-DFA-CONTRACT` and the
matching immutable contract freeze is published/read back.

### 20.1 Origin, phase, and claim eligibility

Every immutable artifact has an exact lineage discriminator. Source pins, layout config, DFA command receipts, readable diffs, machine-evidence bundles, human-review receipts, every freeze/proposal, study protocol, state generation, approval, and typed ECR ref use `lineageClass: control` and MUST omit/forbid `dataOrigin` and `studyPhase`; phase targeting uses fields named `targetDataOrigin` and `targetStudyPhase`. Export, normalized evidence, checkpoint, checkpoint completion, arm input, semantic output, run, request-order manifest, request-issuance receipt, blind permutation, candidate generation, exclusion decision/closure, final manifest/binding, pilot-verification attestation, OutputReview, PairPreferenceReview, deletion receipt, and aggregate use `lineageClass: evidence` and require `dataOrigin` plus `studyPhase` inside the hashed value. The only evidence pairs are `synthetic + contract_conformance`, `live + private_pilot`, and `live + directional_study`.

Reference compatibility is closed: evidence may reference control; control may reference control; evidence-to-evidence refs require exact `dataOrigin`, `studyPhase`, and `studyProtocolHash`; control-to-evidence refs are forbidden except the typed evidence refs explicitly declared by H-PILOT-GO, H-E2, H-EXCEPTION, and the non-authoritative operational locators in state-generation-v0.2. The only cross-phase semantic edge is H-PILOT-GO's declared live/private-pilot evidence to live/directional-study target fields; state locators do not connect evidence graphs. Synthetic evidence/ref ancestry is never valid as live, H-PILOT-GO, H-E2, or release input.

The canonical contract-conformance protocol is strict `dayflow-ablation-study-protocol-v0.1`:

```text
studyProtocolSchemaVersion: dayflow-ablation-study-protocol-v0.1
studyProtocolId
lineageClass: control
targetDataOrigin: synthetic
targetStudyPhase: contract_conformance
fixtureOnly: true
evidenceUse: contract_conformance_only
syntheticConsentPolicyId: synthetic-consent-<version>
syntheticRetentionPolicyId: synthetic-retention-<version>
fixtureGenerator { version, seed, configSha256, syntheticOnly: true }
armPolicy {
  enabledArms[] canonical enum-order subset of [A0, A1, B, C]
  replicateCountByArm { A0, A1, B, C }: each JSON unsigned integer 0..8
}
claimEligibility {
  contractConformance: true,
  quality: false,
  baseline: false,
  release: false,
  hPilotGo: false,
  hE2: false
}
createdAt
studyProtocolHash
```

After `contractFrozen`, its hash is computed in the approved registered study-protocol
domain with `studyProtocolHash` omitted. In `armPolicy`, a count is `0` iff that arm is
disabled and is `1..8` iff enabled; A1 and B are enabled or disabled together and, when
enabled for the primary comparison, have the same positive count. Synthetic contract
conformance enables all four arms. Synthetic artifacts may resolve only consent/retention
IDs beginning `synthetic-consent-` and `synthetic-retention-`. Before `contractFrozen`,
the candidate protocol is fixture-only but every claim flag, including conformance, is
false; after freeze only the approved protocol may enable contract-conformance eligibility.
Quality, baseline, release, `H-PILOT-GO`, and `H-E2` remain false.

A live protocol is the other control variant with `targetDataOrigin: live`, `targetStudyPhase: private_pilot | directional_study`, and phase-locked `targetCheckpointCount` (`15` for `private_pilot`, `60` for `directional_study`); it has `fixtureOnly: false`, `evidenceUse: evaluation`, the same required strict `armPolicy`, `consentRef { lineageClass: control, consentRevision, consentRecordSha256 }`, `retentionPolicyRef { lineageClass: control, policyId, policySha256 }`, phase-specific `claimEligibility`, `createdAt`, and `studyProtocolHash`, and forbids synthetic consent/retention/generator fields. Any protocol used for the primary comparison enables A1/B with equal positive counts. Private pilot eligibility is `{ contractConformance: false, quality: true, baseline: false, release: false, hPilotGo: true, hE2: false }`; directional eligibility changes only `hPilotGo: false, hE2: true`. Live evidence rejects `notApplicableUntilLive`, sentinel, synthetic ID/ref. The synthetic variant forbids the live-only refs and count. Release remains false in every variant.

### 20.2 Implementation safety and reproducibility

The Draft ECR plus its additive scope decisions are the exact tracked-path allowlist for
DFA-000–002A. Dayflow document/source
pins are read-only references, and no Dayflow write/build/run, live capture, production path,
network, provider, telemetry, cloud, environment-secret or credential access is authorized.
Private generated output remains under ignored `.local/` or
`artifacts/architecture/` paths.

DFA-001 records the exact standard repository commands and results listed in Section 0,
the current planned-source hashes, `package-lock.json` hash, relevant Node/npm/LikeC4
versions, readable generated architecture output, and independent QA. Before DFA-002A,
`DFA002_CONTRACT_SOURCE_ENTRIES` has 10 entries. DFA-002A must add exactly its two approved paths
so the next evidence chain binds 12 candidate entries while
`DFA002_COMMAND_DEFINING_INPUTS` remains exactly 10, using these four source-authoritative invocations:
`dfa002-depcruise` (dependency-cruiser 18.2.0), `dfa002-eslint` (ESLint 9.39.5),
`dfa002-tsc` (TypeScript 5.9.3 with `tsconfig.dayflow-dfa002.json`), and
`dfa002-vitest` (Vitest 3.2.7 with `vitest.dayflow-dfa002.config.ts`); after DFA-002A, its
authoritative argv must include `dayflowGovernanceAdapters.test.ts` as the fourth targeted test
file. Each receipt repeats the validation-input-set hash, exact cwd/tool entry/argv,
runtime version, empty environment-variable-name set, no env file, disabled network, timestamps,
zero exit status, and bounded sanitized stdout/stderr evidence. Full suggestion typecheck/lint
and root `arch:deps:check` are additional compatibility evidence recorded in the ECR, not extra
typed command-receipt variants.

These records support deterministic source-level reproduction. They do not claim a hermetic
host, byte-for-byte node_modules proof, custom execution sandbox, or machine-generated
approval. An unexpected tracked path, live/production input, network/provider call, required
check failure, stale result or missing independent review fails closed.

### 20.3 Source pins, layout, and freezes

The strict source-pin artifact is:

```text
sourcePinSetSchemaVersion: dayflow-ablation-source-pin-set-v0.1
sourcePinSetId
lineageClass: control
pins[] sorted unique by (repositoryId, pinRole, pinKind, relativePath):
  repository-revision -> { repositoryId: blabase | dayflow, pinRole: immutable-input | authorized-output-baseline, pinKind, relativePath: ".", revision }; sha256 forbidden
  file-sha256 -> { repositoryId: blabase | dayflow, pinRole: immutable-input | authorized-output-baseline, pinKind, relativePath, sha256 }; revision forbidden
createdAt
sourcePinSetSha256
```

Absolute or escaping paths, unknown fields/kinds/roles, duplicate sort keys, a missing required Plan/Runbook/ECR/planned-architecture/Dayflow pin, or a start-of-task hash/revision mismatch are rejected. A `file-sha256` pin is exactly SHA-256 over raw file bytes, with no domain prefix or text normalization. Plan, Runbook, and all Dayflow pins are `immutable-input`. Whole-file ECR, `architecture/planned.c4`, and `architecture/views.c4` are `authorized-output-baseline`: ECR may drift only in DFA-000/DFA-002/DFA-012 append windows; both architecture files only in DFA-001 and views only for planned-view content. Each window records output ID/hash. Any other drift fails. The Draft ECR section remains immutable through its scoped ref. ECR is UTF-8 no-BOM/LF-only. `sectionId` selects inclusive raw bytes from `<!-- engine-change-record-section:<sectionId>:begin -->\n` through `<!-- engine-change-record-section:<sectionId>:end -->\n`; `draftEcrRef.sha256` is raw SHA-256 of those bytes and `byteSize` is their canonical-decimal exact length. Missing/duplicate/nested markers, CRLF, or BOM fail. Source-pin artifact hashing retains its registered domain formula.

The strict layout artifact is:

```text
artifactLayoutConfigSchemaVersion: dayflow-ablation-artifact-layout-config-v0.1
artifactLayoutConfigId
lineageClass: control
root: suggestion/.local/evaluations/dayflow-ablation
pathTemplates[] sorted unique by artifactClass: { artifactClass, relativeTemplate }
temporaryRootTemplate
directoryMode: "0700"
fileMode: "0600"
immutablePublish: { noClobber: true, atomicRename: true, readbackHash: true, noFollow: true }
privateOnly: true
createdAt
artifactLayoutConfigSha256
```

Its templates MUST form an exact bijection with registry rows whose `storageMode` is `standalone`; embedded rows have no template. The replaceable current-state pointer and raw export blobs are the only explicit non-registry entries. Every template remains below either `root` or the resolved unique `temporaryRootTemplate` and contains neither an absolute path nor `..`. Missing, extra, or duplicate standalone classes are rejected. Its exact hash uses `blabase.dayflow-ablation.artifact-layout-config.v0.1` with only `artifactLayoutConfigSha256` omitted.

The exact private pre-freeze path set is:

```text
suggestion/.local/evaluations/dayflow-ablation/
  staging/<sessionId>/
  pins/<sourcePinSetId>.json
  command-receipts/<commandReceiptId>.json
  readable-diffs/<readableDiffId>.json
  machine-evidence-bundles/<machineEvidenceBundleId>.json
  human-review-receipts/<humanReviewReceiptId>.json
  contract-proposals/<contractFreezeProposalId>.json
  state/CURRENT_STATE.json
  state/generations/<stateGenerationId>.json
```

`contract-decisions/<contractDecisionId>.json` and
`contract-freezes/<contractFreezeId>.json` become eligible only after their respective human
decision and approved-decision gates. Directories are `0700`, files `0600`; immutable publish
uses no-follow, destination-absent/no-clobber, same-root atomic rename and byte/hash readback.
Only `staging/<sessionId>/` may hold a draft, for at most one hour. No persistent unregistered
`contract-proposals/evidence` or separate report subtree exists.

After DFA-002A implementation and validation, a fresh source-pin set and validation-input set bind
the exact 12 candidate and 10 command-defining bytes. Four fresh command receipts and readable diff v0.3 resolve into one
machine-evidence bundle v0.3. An authenticated David human-review receipt v0.3 must confirm
that exact bundle before proposal v0.4 publication. Only an independent human
`H-DFA-CONTRACT` decision v0.4 and matching immutable contract freeze v0.4 can promote that
exact proposal. The candidate's
contract-only generation tuple is:

```text
generationMode: deterministic_fixture_only
provider: none
model: none
promptVersion: none
promptSha256: none
templateVersion: none
generationParameters: {}
fixtureGeneratorVersion
fixtureGeneratorSeed
fixtureGeneratorConfigSha256
syntheticOnly: true
```

The tuple is included in the proposal's source-hash record. `none` is a literal enum and no
model call is permitted in DFA-000–002. Any candidate source, config, fixture, dependency or
check-result change creates a new proposal/approval/freeze chain; an old approval cannot be
replayed.

Live-collection freeze lifecycle is also append-only. Every freeze repeats the phase-locked
`targetCheckpointCount` (`15` pilot, `60` directional) from its live study protocol and execution
freeze. An `approved` record requires `approvedAt` and forbids `closedAt/closureReasonCode`; a
later `closed` record has a new ID/hash, typed immediate `supersedesLiveCollectionFreezeRef`,
`closedAt/closureReasonCode`, forbids `approvedAt`, and repeats the resolved policy/protocol scope
exactly. No freeze is edited in place, predecessor refs are single-parent and acyclic, and only
the latest resolved approved/unclosed record can authorize capture.

Before the first model/provider call in DFA-006, publish a new immutable `dayflow-ablation-evaluation-execution-freeze-v0.1` control revision containing schema version, ID, revision and optional predecessor ref, `targetDataOrigin`, `targetStudyPhase`, `targetCheckpointCount`, typed trusted-contract-freeze and study-protocol refs, strict A1/B causal and separate C execution tuples, retry/concurrency, resolver/guardrail/verifier versions, replicate policy, randomization algorithm/seed/derivation and request-order schema/binding-time policy, review rubric/permutation/missing-output policy, creation timestamp, and detached hash. Live counts are exact (`15` private pilot, `60` directional) and must equal the resolved protocol. Its domain is `blabase.dayflow-ablation.evaluation-execution-freeze.v0.1`. Checkpoint IDs do not exist yet, so this freeze MUST NOT contain a concrete request-order manifest ID/hash. Each concrete manifest is published after checkpoint sealing and before its first paired request, and runs reference it. Any change creates a successor revision; it never patches the trusted contract freeze or an earlier execution freeze.

```text
evaluationExecutionFreezeSchemaVersion: dayflow-ablation-evaluation-execution-freeze-v0.1
evaluationExecutionFreezeId
lineageClass: control
revision
predecessorRef: required iff revision > "1" { schemaVersion, evaluationExecutionFreezeId, evaluationExecutionFreezeSha256 }
targetDataOrigin
targetStudyPhase
targetCheckpointCount
contractFreezeRef { schemaVersion: dayflow-dfa-contract-freeze-v0.4, contractFreezeId, contractFreezeSha256 }
studyProtocolRef { schemaVersion, studyProtocolHash }
extractorTuple { provider, model, promptVersion, promptSha256, templateVersion, configVersion, generationParameters }
a1bCausalTuple { provider, model, promptVersion, promptSha256, templateVersion, configVersion, generationParameters }
cScreenOnlyTuple { provider, model, promptVersion, promptSha256, templateVersion, configVersion, generationParameters }
retryPolicy
concurrencyPolicy
resolverVersion
guardrailVersion
verifierVersions
replicatePolicy {
  armPolicyRef { studyProtocolHash, jsonPointer: /armPolicy }
  enabledArms[] canonical enum-order subset
  replicateCountByArm { A0, A1, B, C }: JSON unsigned integers 0..8
}
randomization { algorithmVersion, seed, seedDerivationVersion, requestOrderManifestSchemaVersion, bindingTime: before-first-paired-request }
review { rubricVersion, permutationVersion, missingOutputPolicyVersion }
createdAt
evaluationExecutionFreezeSha256
```

Revision is a canonical decimal string; every `replicateIndex` in every artifact is a JSON unsigned integer `0..7`, never a string. `replicatePolicy.armPolicyRef` resolves the exact authoritative protocol and its copied enabled/count fields are byte/JCS-equal to `studyProtocolRef./armPolicy`. The predecessor is the exact immediate revision in the same target-origin/target-phase/protocol ancestry; self/skip/forward/cycle refs fail. Runs carry this freeze's typed ID/hash plus their later concrete request-order ref. A1/B use `a1bCausalTuple` byte-identically, C uses only its separate tuple, and A0 makes no new model call.

### 20.4 Strict DFA-002 wire contract

Unknown fields are rejected at every level. IDs match `^[a-z][a-z0-9._:-]{0,127}$`; versions match `^[a-z0-9][a-z0-9._-]{0,63}$`; SHA-256 matches `^[0-9a-f]{64}$`; reason/issue codes match `^[A-Z][A-Z0-9_]{0,63}$`; UTC timestamps match `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`; canonical decimal strings match `^(0|[1-9][0-9]*)$`. General strings are at most 256 Unicode scalar values, human reason text 1,024, relative paths 512; control/bidi characters are forbidden. Default arrays are at most 256, source refs 32, coverage intervals 1,024, files/artifacts 256. A JSON artifact is at most 4 MiB, a blob 10 MiB, and a bundle 512 MiB/256 blobs. Smaller schema-specific cardinalities still apply.

The DFA-002 proposal evidence chain is closed as follows:

```text
dfaCommandReceipt v0.1:
  scopeId: DFA-002; commandId; validationInputSetSha256
  invocation { cwd, runtime: node, runtimeVersion, toolPackage, toolVersion,
    toolEntryRelativePath, argv, environmentVariableNames: [], envFilesLoaded: false,
    networkAccess: disabled }
  startedAt; completedAt; exitStatus: 0
  stdout/stderr { mediaType, rawByteLength, rawSha256, sanitizedByteLength,
    sanitizedSha256, sanitizedText, redactionApplied,
    redactionPolicyVersion: dayflow-dfa-command-output-redaction-v0.1 }
  commandReceiptSha256

dfaReadableDiff v0.3:
  scopeId: DFA-002; baseRevision
  operations[] sorted unique by relativePath:
    add    -> before: null, after: full UTF-8 content ref
    modify -> before/after full UTF-8 content refs with different bytes
    delete -> before full UTF-8 content ref, after: null
  each content ref { relativePath, mediaType, encoding: utf-8, byteLength, rawSha256, content }
  aggregate full content <= 4194304 bytes; private-secret content forbidden
  createdAt; readableDiffSha256

dfaMachineEvidenceBundle v0.3:
  scopeId: DFA-002; sourcePinSetRef; baseCodeProvenance
  validationInputSet { trackedBaseRevision, candidateFiles[12],
    commandDefiningFiles[10], unexpectedTrackedPaths: [], validationInputSetSha256 }
  deterministic generationTuple; exact toolVersions
  commandReceiptRefs[4]; readableDiffRef; limitations[]; assembledAt
  machineEvidenceBundleSha256

dfaHumanReviewReceipt v0.3:
  scopeId: DFA-002; reviewerPseudonym: david
  decision: confirmed | changes-requested
  machineEvidenceBundleRef; reviewedAt
  reviewReport { mediaType, byteLength, rawSha256, text }
  limitations[]; humanReviewReceiptSha256

ContractFreezeProposal v0.4:
  revision/predecessorRef; sourcePinSetRef; baseCodeProvenance; draftEcrRef
  machineEvidenceBundleRef; independentHumanReviewReceiptRef
  limitations[]; proposerPseudonym: colin; createdAt; contractFreezeProposalSha256

H-DFA-CONTRACT decision v0.4:
  decision: approved | rejected; proposalRef; humanReviewReceiptRef
  approverPseudonym: david; decidedAt; contractDecisionSha256

ContractFreeze v0.4:
  proposalRef; approvalRef; byte-identical approvedProposal/approvedDecision
  frozenRegistry[36]; frozenRegistrySha256; frozenAt; contractFreezeSha256
```

The readable diff must be reconstructed from the trusted fixed base plus the exact candidate
bytes using DFA-002A's bounded local Git acquisition. The existing ten-candidate diff and machine
bundle are stale/abandoned. The fresh diff must cover all 12 candidate paths, including the two
new paths; this scope decision records no new bytes, hashes, resolver result or operation-count
claim. Source pin creation precedes
command starts; all commands complete before bundle assembly; diff creation is no later than
bundle assembly; bundle assembly precedes David review; review precedes proposal creation;
proposal precedes decision and decision precedes freeze. Missing resolver content,
non-canonical bytes, secret-bearing diff/output, cross-input hashes, unauthenticated review,
stale proposal head, existing destination or chronology mismatch fails closed.

The export's nested strict shapes are:

```text
sourceFileHashes[] sorted unique by relativePath: { relativePath, sha256 }
captureConfig {
  captureIntervalMs, maxWindowDurationMs, maxArtifactsPerExport, maxBlobBytes: canonical decimal strings
  allowedMimeTypes[]: non-empty sorted unique enum values
}
databaseSnapshotIdentity:
  synthetic -> { snapshotKind: synthetic-fixture, fixtureSetId, fixtureGeneratorVersion, fixtureGeneratorSeed, fixtureGeneratorConfigSha256 }; database/WAL fields forbidden
  live -> { snapshotKind: dayflow-stable-snapshot, snapshotAlgorithmVersion, snapshotId, databaseSchemaFingerprint, mainDatabaseSha256, walState: none | included, walSha256: required only when included, stableSnapshotMarkerSha256, createdAt }; fixture fields forbidden
artifact closed fields:
  mimeType: image/jpeg | image/png
  privacyState: synthetic_fixture | consented_live
  capturePolicyDecision: allow
  placeholderState: synthetic_fixture | verified_non_placeholder
  availability: available
  pseudonymousDisplayAttestation, pseudonymousWindowAttestation:
    { attestationSchemaVersion: dayflow-pseudonymous-capture-attestation-v0.1, pseudonymousSubjectId, policyVersion, policySha256, attestedAt }
```

`allowedMimeTypes[]` is a non-empty subset of the exact MIME enum above. `captureIntervalMs`, `maxWindowDurationMs`, `maxArtifactsPerExport`, and `maxBlobBytes` are positive canonical decimals; additionally `maxWindowDurationMs <= "86400000"`, `maxArtifactsPerExport <= "256"`, `maxBlobBytes <= "10485760"`, and the observed bundle total is at most 512 MiB. Artifact `sourceRowId`, `sequenceWithinSecond`, and `byteSize` are canonical decimals. `byteSize` MUST equal the actual referenced blob byte length and be `<= maxBlobBytes`; inequality in either direction fails. Every coverage count is a JSON unsigned integer in `0..1000000`; interval counts and top-level counts use the same type and exact sums. `idleSeconds` is a JSON unsigned integer in `0..86400`. Replicate/attempt/rank/latency/token/cost counters are JSON unsigned integers in `0..9007199254740991`. Synthetic artifacts require `synthetic_fixture` privacy/placeholder states and synthetic attestation IDs; live artifacts require `consented_live` plus `verified_non_placeholder` and non-synthetic attestations. All other enum combinations fail with a typed issue; rejected/missing/denied rows are issues and coverage counts, not accepted artifact variants.

The export detached hash is exactly the formula in Section 6. Persisted export coverage MUST already be canonical. The producer's contract builder may normalize source intervals before serialization; the importer/verifier never repairs persisted input. It rejects non-canonical order/partition/counts. A duplicate-aware tokenizer/parser is mandatory for DFA-002 synthetic loading; plain `JSON.parse`-style last-key-wins parsing is forbidden. DFA-004 later supplies the independent raw-byte live parser. Both emit `DUPLICATE_JSON_KEY` on any duplicate object key before schema validation.

All privacy validation failures use a strict issue record `{ issueCode, artifactRef: optional, fieldPath: optional, detectedAt }`. Allowed fatal `issueCode` values are `PRIVACY_STATE_UNKNOWN`, `CONSENT_REVISION_MISMATCH`, `CAPTURE_POLICY_MISMATCH`, `DENYLIST_BLOCKED`, `DISPLAY_ATTESTATION_MISSING`, `WINDOW_ATTESTATION_MISSING`, `PLACEHOLDER_AMBIGUOUS`, `SENSITIVE_CATEGORY`, `RAW_CONTENT_FORBIDDEN`, `CREDENTIAL_PATTERN`, `ABSOLUTE_PATH_FORBIDDEN`, `ORIGIN_PHASE_MISMATCH`, `LIVE_SENTINEL_FORBIDDEN`, and `SYNTHETIC_ID_IN_LIVE`. Every one makes screen input unavailable; no issue is downgraded to empty evidence.

The strict request-order artifact is:

```text
requestOrderManifestSchemaVersion: dayflow-ablation-request-order-manifest-v0.1
requestOrderManifestId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
algorithmVersion
seed
entries[] sorted by contiguous position starting "0":
  { position, checkpointId, checkpointSha256, matchedPairId, replicateIndex, armId: A1 | B, requestId }
createdAt
requestOrderManifestSha256
```

The strict issuance receipt is:

```text
requestIssuanceReceiptSchemaVersion: dayflow-ablation-request-issuance-receipt-v0.1
requestIssuanceReceiptId
lineageClass: evidence
dataOrigin
studyPhase
studyProtocolHash
requestOrderManifestRef { schemaVersion: dayflow-ablation-request-order-manifest-v0.1, requestOrderManifestId, requestOrderManifestSha256 }
requestId
position: canonical decimal string
issuanceSequence: canonical decimal string
armInputRef { schemaVersion: dayflow-ablation-arm-input-v0.4, armInputId, armInputHash }
issuedAt
previousReceiptSha256: optional; forbidden for position "0", otherwise exact prior receipt hash
requestIssuanceReceiptSha256
```

The live-pilot-only verification attestation is:

```text
pilotVerificationAttestationSchemaVersion: dayflow-ablation-pilot-verification-attestation-v0.1
pilotVerificationAttestationId
lineageClass: evidence
dataOrigin: live
studyPhase: private_pilot
studyProtocolHash
targetCheckpointCount: 15
sourceGenerationRef { schemaVersion: dayflow-ablation-candidate-dataset-generation-v0.1, candidateDatasetGenerationId, candidateDatasetGenerationSha256 }
exclusionClosureRef { schemaVersion: dayflow-ablation-exclusion-closure-v0.1, exclusionClosureId, exclusionClosureSha256 }
finalDatasetManifestRef { schemaVersion: dayflow-ablation-final-dataset-manifest-v0.1, datasetVersion, datasetSha256 }
finalDatasetBindingRef { schemaVersion: dayflow-ablation-final-dataset-binding-v0.1, finalDatasetBindingId, finalDatasetBindingSha256 }
verifierVersion
verificationStatus: verified
verificationIssueCodes: []
checkpoints[15] sorted unique by checkpointId:
  captureWindowId, windowStart, windowEnd, checkpointAsOf
  checkpointRef { schemaVersion: dayflow-ablation-checkpoint-v0.2, checkpointId, checkpointSha256 }
  checkpointCompletionRef { schemaVersion: dayflow-ablation-checkpoint-completion-v0.1, checkpointCompletionId, checkpointCompletionSha256 }
  exportManifestRef { schemaVersion: dayflow-screen-evidence-export-v0.1, exportId, detachedManifestSha256 }
  normalizedEvidenceRef { schemaVersion: dayflow-normalized-evidence-v0.1, evidenceId, dayflowNormalizedEvidenceHash }
  historicalLiveAuthorityRef { schemaVersion: dayflow-ablation-live-collection-freeze-v0.1, liveCollectionFreezeId, liveCollectionFreezeSha256 }
  retentionPolicy { policySchemaVersion: dayflow-ablation-live-retention-policy-v0.1, lineageClass: control, policyId, blabaseRawCopyMaxAgeMs, dayflowCanonicalSourceMaxAgeMs, policySha256 }
  executionBundleProofSha256
  rawPurgeObligations[] sorted unique by frameRef.artifactId:
    frameRef { artifactType: dayflow-export-frame, schemaVersion: dayflow-export-artifact-v0.1, artifactId, artifactSha256 }
    exportManifestRef { schemaVersion: dayflow-screen-evidence-export-v0.1, exportId, detachedManifestSha256 }
    capturedAt, exportedAt, blabaseRawCopyDeleteBy, dayflowCanonicalSourceDeleteBy
verifiedAt
pilotVerificationAttestationSha256
```

The attestation is issued only before raw purge, after all 15 execution bundles resolve and
while `verifiedAt` is not later than any recorded raw deadline. Post-purge verification resolves
the immutable DAG metadata, attestation, historical-as-of authority, and deletion receipts;
missing or mismatched evidence fails closed. The schema intentionally has no `createdAt`,
`expiresAt`, TTL, revocation, purge,
or raw-blob field. DFA-007 publishes it immutably with no overwrite and stores it as private
metadata. The store anchors retention at `verifiedAt`, retains it only while needed for the
pilot/directional/release-decision audit, and applies a hard maximum of 30 days. It purges at
the earliest of that cap, an applicable experiment deletion request or consent revocation,
authority/contract invalidation, or rollback. It is excluded from backup, export, and telemetry.
Authority or contract mismatch makes the immutable attestation invalid for use rather than
mutating it; purge is covered by a deletion receipt. DFA-007 owns historical-as-of authority
resolution, currentness/revocation checks, immutable store/read/purge behavior, receipt coverage,
and corruption/rollback fail-closed tests.

Each `(checkpoint, matchedPairId, replicateIndex)` has exactly one A1 and one B entry; the immutable manifest is committed before either request. Receipts form a complete manifest-order chain and each causal run repeats its exact receipt ref and sequence. Checkpoint v0.2 is input-sealed before runs and contains no run/completion refs. The standalone strict checkpoint-completion v0.1 defined in Section 8 carries `completionStatus`, `completedAt`, `presentRunRefs[]`, `missingExpectedRunKeys[]`, `failedRunKeys[]`, and `noOutputRunKeys[]`; only a resolved `completed` ref may enter a later candidate generation. A collection-time checkpoint references only the protocol and optional prior generation; it never references its runs, completion, itself, or its future generation.

Exclusion decisions are the standalone artifacts defined above, and closure contains only their typed refs. Normalized evidence owns extraction/lineage and has no forward `runId`; runs own execution/output only; reviews score existing committed runs and cannot mutate them; state generations are operational pointers, never dataset/approval authority; deletion receipts attest deletion status and contain no deleted raw payload; aggregates resolve one final binding and committed reviews and cannot repair, exclude, or relabel source artifacts. Every aggregate carries machine-readable claim scope and rejects mixed binding/origin/phase/protocol input.

### 20.5 DFA-002 acceptance matrix

DFA-002 acceptance uses the exact source revision named by the proposal. All required targeted
tests, typecheck, lint, and applicable architecture checks must pass against that revision.
The fresh source pin's exact 12-candidate/10-command-input set, four fresh command receipts v0.1, readable diff v0.3,
and machine evidence bundle v0.3 must resolve before authenticated `david` human review; that
review must then resolve as human-review receipt v0.3 before proposal v0.4 assembly. External technical QA
is recorded separately and cannot substitute for `david`'s authenticated confirmation. Missing,
failed, stale or cross-revision evidence fails; no exception can convert a required failure to pass.

Required negative and parity coverage includes:

- every invalid `dataOrigin`/`studyPhase` combination, synthetic/live/sentinel mix, and
  synthetic input to pilot/E2/release gates;
- deterministic fixture generation, zero raw conversation/blob input, and zero
  model/provider/network/telemetry call in DFA-000–002;
- proposal → human H-DFA-CONTRACT → freeze equality, source/check-result mutation, stale
  proposal, predecessor fork/cycle, and self-approval rejection;
- exact tracked-path allowlist, unexpected production/Dayflow write, unapproved live input,
  private-artifact escape, symlink/hardlink, credential/environment and network/provider
  violations;
- one export per window; A0/A1/B/C arm-input forbidden-field combinations; A1/B matched-pair
  parity; C structured contamination; screen-unavailable invariance;
- checkpoint → run → completion acyclicity and completion-run bijection; cumulative candidate
  generations; exclusion decision → closure → final manifest → final binding DAG; final
  binding run bijection;
- OutputReview and PairPreferenceReview unique IDs, exact comparison group, same
  checkpoint/reviewer, committed-before-pair ordering, permutation and run compatibility;
- exact schema/version/hash domain, duplicate JSON-key rejection, JCS vectors, export hash
  parity, byte-size/bounds/ID/timestamp/JSON-pointer grammars and unknown-field rejection;
- privacy issue enums, consent/coverage/retention/deletion state, deletion receipts, backup
  policy, synthetic purge, crash recovery, state-generation/pointer atomicity and rollback;
- DFA-001 planned-only architecture guard and absence of Dayflow from implemented
  model/dynamics.

The tests validate the frozen source schemas rather than provisional governance machinery.
Missing implementation tests fail acceptance.

## 21. Candidate control and operational acceptance sketches

### 21.1 Source-hash contract candidate

The DFA-002 candidate is identified by one immutable ContractFreezeProposal v0.4. The proposal
does not duplicate command output or source content. It binds source-pin v0.1, machine-evidence
v0.3 and independent-human-review v0.3 refs; the resolved machine bundle binds the exact 12-file
candidate, 10 command-defining inputs, deterministic fixture tuple, four command receipts v0.1,
readable diff v0.3, tool versions and limitations. The resolved authenticated David receipt
binds that exact machine bundle, a non-empty hashed report and `confirmed`. Unknown, stale,
unresolved, non-canonical or cross-revision evidence fails. The proposal contains no live data,
model/provider output, quality claim or release authority.

`colin` is the pending `proposerPseudonym` and owner reviewer; `david` is the only authenticated
`reviewerPseudonym` allowed by human-review receipt v0.3 and the literal future decision
`approverPseudonym`. The closed decision schema contains one decision, not two votes. `colin`'s
owner confirmation is not a second schema approval, and his tracked-path scope approvals
is not a contract confirmation. External QA PASS is technical review only and cannot be
substituted for David's authenticated receipt or decision.
Approval never constructs or repairs a proposal. The final freeze must reference the
byte-identical approved proposal and decision. Any source, dependency, config, fixture, test or
result change requires a successor proposal and new human decision. No proposal, confirmation,
decision, or approval exists yet.

### 21.2 Repository-native validation and safety

DFA-001 uses `npm run arch:model:format:check`,
`npm run arch:sources:check`, `npm run arch:model:check`, and
`npm run arch:model:build`. DFA-002's authoritative typed evidence uses the four exact
`DFA002_REQUIRED_COMMANDS` described in Section 20.2. The full suggestion typecheck/lint and
root `npm run arch:deps:check` remain supplemental compatibility checks. Each recorded result
names the source revision/input-set hash, exact command, relevant tool/runtime version, time,
exit status and sanitized readable output evidence.

The ECR path allowlist is authoritative for tracked writes. Generated output is restricted to
ignored `.local/` and `artifacts/architecture/`; source paths remain subject to normal
repository review. Dayflow writes/build/run, live capture/data, production integration,
network/provider/telemetry/cloud and credentials remain forbidden. Independent QA verifies
the diff and command evidence. This process deliberately makes no hermetic node_modules or
host claim.

### 21.3 Strict state generation and pointer

The following closed `dayflow-ablation-state-generation-v0.2` payload is a candidate acceptance sketch; its exact source schema becomes normative only after `H-DFA-CONTRACT` and trusted freeze:

```text
stateSchemaVersion, stateGenerationId, lineageClass: control
previousStateGenerationRef: optional { schemaVersion, stateGenerationId, stateGenerationSha256 }
updatedAt, updatedByAgent
planningStatus: draft_planning_only | approved_for_implementation
currentTask: DFA-000 | DFA-001 | DFA-002 | DFA-003 | DFA-004 | DFA-005 | DFA-006 | DFA-007 | DFA-008 | DFA-009 | DFA-010 | DFA-011 | DFA-012 | DFA-013 | DFA-014 | DFA-015 | DFA-016
currentPhase: scope_authority | planned_architecture | contract_candidate | cross_repo_exporter | private_import | evidence_normalization | evaluation_execution | artifact_lifecycle | human_review | synthetic_contract_regression | implemented_architecture | automated_verification | engine_record | private_pilot | pilot_decision | directional_study | e2_decision
executionStatus: pending | implementation_validation_pending | not_started | in_review | blocked | in_progress | completed | failed
taskStatuses[] exactly 17 sorted by numeric DFA suffix: { taskId, status: same execution-status enum }
nextAtomicAction { actionId, taskId, actionCode, descriptionCode }; sessionId: optional
activeStudyProtocolRef: required in DFA-000..002, otherwise phase-policy required/optional typed control ref
claimEligibility: required exact protocol-derived six-boolean object in DFA-000..002
controlArtifactRefs[] sorted unique typed registry refs
evidenceArtifactRefs[] sorted unique typed refs carrying dataOrigin, studyPhase, studyProtocolHash
approvalRefs[] sorted unique typed approval refs
exitEvidenceRefs[] sorted unique by (taskId, artifactType, artifactId), each a typed control/evidence ref
exceptionRefs[] sorted unique typed H-EXCEPTION refs
blockers[] sorted unique by blockerId: { blockerId, taskId, blockerCode: MISSING_APPROVAL | MISSING_ARTIFACT | HASH_MISMATCH | FAILED_REQUIRED_CHECK | PRIVACY_HOLD | RETENTION_HOLD | DEPENDENCY_NOT_COMPLETE | OPERATOR_PAUSE, ownerPseudonym, openedAt, detailCode }
safetyIssues[] sorted unique by safetyIssueId: { safetyIssueId, issueCode, severity: low | medium | high | critical, status: open | mitigated | closed, artifactRefs[] sorted unique typed refs }
resumeChecks[] sorted unique by resumeCheckId: { resumeCheckId, checkCode: POINTER_MATCH | PREDECESSOR_MATCH | HASH_READBACK | APPROVAL_CURRENT | RETENTION_CURRENT | STAGING_RECONCILED | LINEAGE_COMPATIBLE, status: pending | passed | failed, artifactRefs[] sorted unique typed refs }
governanceItems[] sorted unique by artifactClass: {
  artifactClass,
  consentPolicyRef { schemaVersion, policyId, policySha256 },
  retentionPolicyRef { schemaVersion, policyId, policySha256 },
  deletionPolicyRef { schemaVersion, policyId, policySha256 },
  backupPolicyRef { schemaVersion, policyId, policySha256 },
  nextDeadline: exact UTC timestamp | null
}
handoffNoteCode, stateGenerationSha256
```

Every generic typed ref, including every governance ref, must resolve its declared schema/ID/hash; bare policy IDs are invalid. Candidate-state claim eligibility is all-false until the matching human-approved contract freeze exists; only then may it equal the approved synthetic protocol. Each `nextDeadline` is either `null` or an exact UTC timestamp, never absent/sentinel. The task list contains DFA-000..016 exactly once; `currentTask` status equals `executionStatus`, at most one task is `in_progress`, and task/phase pairs have the same ordinal. The first scope-approved state was `draft_planning_only`, DFA-001/`planned_architecture`/`implementation_validation_pending`, with DFA-000 `completed` and DFA-002 `pending`. After the recorded DFA-001 exit evidence, its immediate successor is DFA-002/`contract_candidate`/`pending`, with DFA-000 and DFA-001 `completed` and DFA-003..016 not started or dependency-blocked. The predecessor is absent only for the first state and otherwise names the immediate latest generation; skip, forked-latest, ID-only, self, forward, reverse-successor, and cycle refs fail. State evidence refs are non-authoritative resume locators and do not connect or make evidence graphs compatible. Top-level `dataOrigin`/`studyPhase` are forbidden. A state raw SHA read back by `/usr/bin/shasum` establishes bytes only; required command results, external technical QA, and the authenticated human review required by a gate are separate evidence and cannot be inferred from the state hash or substituted for one another.

`CURRENT_STATE.json` has exactly `{ pointerSchemaVersion: dayflow-ablation-current-state-pointer-v0.1, stateGenerationId, stateGenerationSha256 }` and bytes `UTF8(JCS(pointer) + "\n")`. Publication is generation no-clobber plus whole-file raw SHA readback, then same-directory `0600` temp write, file fsync, expected-old ID/hash CAS, symlink-safe atomic replace, directory fsync, and parse/JCS/raw-hash readback. Formatting and CAS protect deterministic bytes/concurrency; they do not certify semantic completeness. Any mismatch leaves the unpublished generation for orphan audit and fails closed without overwriting the pointer.
<!-- dfa002a-final-implementation-evidence:begin -->

## DFA-002A final implementation evidence (2026-08-18)

이 섹션은 앞선 DFA-002A scope/sequencing 기록을 덮어쓰지 않고 구현 결과만 보정한다.
Nested work package `DFA-002A`는 구현·검증 `completed`다. Parent machine task
`DFA-002`는 fresh evidence와 human gate가 남아 있으므로 계속 `pending`이다.

- Current candidate inventory: 정확히 12개.
- Command-defining input inventory: 정확히 10개.
- Distinct candidate/command closure: 두 config path의 중복을 제거한 정확히 20개.
- Required source-pin shape: 정확히 23개. 이 문서와 Runbook, ECR의 최종 bytes는 다음
  private source-pin 생성 시 새로 resolve한다. 이 기록은 편집 전 문서 hash를 current라고
  주장하지 않는다.
- Authoritative commands: `dfa002-depcruise`, `dfa002-eslint`, `dfa002-tsc`,
  `dfa002-vitest` 네 개 모두 PASS.
- Targeted result: dependency-cruiser 8 modules/14 dependencies/0 violations;
  Vitest 4 files/93 tests PASS.
- Compatibility: full suggestion typecheck PASS, full suggestion lint PASS,
  root `arch:deps:check` exit 0. 기존 warning count는 repository 12, suggestion 8,
  scripts 2다.
- Independent current-head QA: Green, Medium 이상 finding 0건.

구현은 local read-only Git fixed-base resolver, hardened candidate/machine-evidence reads,
proposal history/currentness/CAS, proposal-only immutable publisher를 제공한다. Git object
resolution은 `GIT_NO_LAZY_FETCH=1`이고 tree traversal이 authoritative absence를 입증해야
한다. Snapshot 검증은 candidate, command inputs, canonical stored source pin, 모든 local
pin, machine evidence, proposal history와 external fact를 하나의 coherent whole-set으로
재수집한다. Publisher는 retained descriptor와 고정된 root-owned/non-writable
`/usr/bin/python3 -I -S` helper를 통해 descriptor-relative `linkat`/`unlinkat`를 수행하고,
fixed environment, 실행 bound, no-clobber, fsync와 byte/hash readback을 요구한다. 결과가
모호하면 staged inode와 authenticated lock을 유지하고 사람이 reconcile하기 전까지
fail closed한다.

이는 새 production dependency, Dayflow access/runtime, human issuer/signing, decision/freeze,
route/CLI, live authority 또는 production wiring을 추가하지 않는다. `/usr/bin/python3`가
없거나 owner/mode 검증에 실패하는 host에서는 publication이 fail closed하므로 명시적인
배포 전제이자 portability risk다.

이전 10-candidate source pin, 네 command receipt, readable diff와 machine bundle로 구성된
7-artifact private chain은 stale/abandoned다. bytes는 untouched이며 safe purge가 pending이다.
현재 12-candidate source pin, command receipt, readable diff, machine bundle, David receipt,
proposal, decision 또는 freeze는 없다. 따라서 다음 순서는 final docs readback, stale chain
safe purge, fresh 12/10 evidence chain 생성·readback, David authenticated review, Colin proposal
publication/readback, David H-DFA-CONTRACT decision과 approved인 경우에만 freeze다.

정확한 12-file/10-input bytes와 SHA-256, 명령 원문 및 보안 제약은
`ECR-DFA-002A-LOCAL-GOVERNANCE-IMPLEMENTED-2026-08-18`에 기록한다. Golden/Regression/
Rolling/Holdout 또는 production semantic behavior는 바뀌지 않았으므로 baseline은 N/A다.

<!-- dfa002a-final-implementation-evidence:end -->
<!-- dfa002a-external-qa-hold-correction:begin -->

## DFA-002A external-QA HOLD correction (2026-08-18)

이 보정은 바로 앞 final implementation evidence의 `completed` 및 independent QA Green/
Medium 이상 0건 주장을 대체한다. 외부 독립 current-head QA의 최신 판정에 따라 nested
`DFA-002A`의 현재 상태는 `in_progress` / `HOLD`다. Parent `DFA-002`는 계속 `pending`이다.

미해결 항목은 정확히 다음 세 가지다.

1. Final whole-set capture 이후 proposal link 직전과 link 이후 검증 사이에 남은
   whole-set TOCTOU 경계.
2. Prepublication 검증에서 `draftEcrRef`가 실제 artifact로 resolve되지 않는 경계.
3. Cleanup의 stat/unlink 사이에서 link count가 바뀔 수 있어 unlink 결과가 모호해지는 경계.

기록된 4 files/93 tests와 dependency/typecheck/lint/architecture check 결과는 해당 bytes에
대한 기술 증거로 유지되지만 completion 또는 approval authority가 아니다. 세 항목을
보완하고 관련 검증과 외부 독립 current-head QA를 다시 통과하기 전에는 DFA-002A를
`completed`로 되돌리거나 fresh evidence assembly, David review 또는 proposal publication을
진행하지 않는다. 이전 10-candidate private chain은 계속 stale/abandoned, untouched,
safe-purge pending이다.

<!-- dfa002a-external-qa-hold-correction:end -->
<!-- dfa002a-final-qa-pass-supersession:begin -->

## DFA-002A final external-QA PASS supersession (2026-08-18)

이 최종 보정은 `DFA-002A external-QA HOLD correction`의 HOLD와 세 open finding을
대체한다. Remediation과 재검증이 완료됐고 latest independent current-head QA는 PASS,
Medium 이상 finding 0건이다. Nested `DFA-002A`는 다시 `completed` / `validated`이며,
parent `DFA-002`는 fresh evidence와 human gate가 남아 계속 `pending`이다.

- `draftEcrRef`는 global fatal UTF-8 strict ECR marker parser를 통해 prepublication에서
  실제 bytes로 resolve·검증된다.
- Descriptor helper는 bounded seam으로 제한되고 hostile coverage가 추가됐다.
- Commit/post-link whole-set fencing과 unlink cleanup의 prior fixes가 남았던 TOCTOU 및
  link-count ambiguity를 닫았다.
- Authoritative Vitest 결과는 4 files/103 tests PASS다. Dependency-cruiser 8 modules/14
  dependencies, scoped ESLint/TypeScript, full suggestion typecheck/lint 및 root architecture
  dependency 결과는 모두 이전 PASS와 동일하다.

이 완료는 DFA-002 contract approval이 아니다. 이전 10-candidate private seven-artifact
chain은 계속 stale/abandoned, untouched, safe-purge pending이며 fresh source pin, receipt,
diff, bundle, David receipt, proposal, decision 또는 freeze는 아직 없다. 다음 source pin은
이 Plan, Runbook과 ECR의 최종 readback bytes를 새로 resolve해야 하며 이 문서는 자신의
최종 hash를 선행 주장하지 않는다.

<!-- dfa002a-final-qa-pass-supersession:end -->
<!-- current-authority:DFA-COLIN-S3-2B-2026-08-19:begin -->

## Current authority: Colin-only S3.2b contract simplification

This section is the current DFA governance authority as of 2026-08-19. It supersedes active
instructions elsewhere in this Plan that require David review artifacts, H-DFA-CONTRACT,
ContractFreezeProposal, a contract decision, a contract freeze, source-pin-set, command receipts,
a readable diff, or a machine-evidence bundle. Historical ECR entries remain historical evidence
and are not rewritten.

### Completed implementation units

- S1 replaced active contract-freeze references with a Colin-owned experiment manifest.
- S2 moved reusable private artifact primitives into the neutral private artifact store.
- S3.1 removed the obsolete DFA governance adapter and its dedicated test suite.
- S3.2a removed the David receipt/proposal/decision/freeze contract chain without a compatibility
  union.
- S3.2b completely removed source-pin-set and the orphan machine-evidence packages, migrated the
  registry and synthetic fixtures, and added the standalone run-results contract.

### Current contract boundary

The registered DFA artifact set contains exactly 30 standalone classes. The following eight
classes are retired and forbidden in new active artifacts:

- `source-pin-set`
- `dfa-command-receipt`
- `dfa-readable-diff`
- `dfa-machine-evidence-bundle`
- `dfa-human-review-receipt`
- `contract-freeze-proposal`
- `dfa-contract-decision`
- `contract-freeze`

Source provenance is embedded strictly in experiment-manifest v0.2 and is not a separately
published artifact. `run-results` v0.1 is the standalone terminal-run aggregate and contains only
typed refs to terminal arm runs plus protocol/manifest/freeze lineage; it does not duplicate run
status, output, metrics, or private payloads.

The current serialized versions are:

- experiment manifest v0.2;
- study protocol v0.3;
- evaluation execution freeze v0.3;
- live collection freeze v0.3;
- artifact-layout config v0.2;
- synthetic config and cases v0.2;
- fixture-generator and synthetic-cases hash domains v0.2;
- evidence-vector hash domain v0.1;
- run-results v0.1.

No compatibility union is retained for the retired versions. Unknown, mixed, or retired versions
fail closed.

### Minimum Colin-owned experiment record

The active minimum evidence set is:

1. `experiment-manifest.json`
2. `run-results.json`
3. `comparison-report.md`
4. `colin-decision.md`

Colin is the developer, experiment reviewer, and final decision authority. David has no required
workflow role. Technical QA is supporting evidence, not a separate human approval gate.

### Current validation and next gate

Focused validation for the current S3.2b bytes passed: three Vitest files and 68 tests, scoped
TypeScript, and scoped ESLint. The first focused run exposed one stale test-only v0.1 config ID;
that literal was updated to v0.2 and the identical focused matrix then passed. No Git operation or
private-artifact operation was performed, and the existing private seven-file stale chain remains
untouched.

S4 documentation alignment and the separately approved S5 broader compatibility validation are
complete. S5 passed the full 162-file/1,412-test suite, full typecheck, full lint, production build,
and architecture dependency checks. Architecture checks reported zero errors and the existing
12 repository, 8 suggestion, and 2 script warnings. The Next.js compatibility build loaded the
local `.env.local` according to its standard build output; no value was inspected or printed, and
that build is not hermetic DFA experiment evidence. No experiment execution, live collection,
production enablement, release decision, or stale-private-artifact deletion is authorized by this
checkpoint.

<!-- current-authority:DFA-COLIN-S3-2B-2026-08-19:end -->

<!-- current-authority:DFA-COLIN-S6-SYNTHETIC-DRY-RUN-2026-08-19:begin -->

## Current authority: Colin-only S6 synthetic dry-run tooling complete

This additive section is the current DFA synthetic dry-run authority as of 2026-08-19. It
supersedes earlier planning statements that describe the four Colin records as unimplemented,
while preserving every prior section as historical evidence. S6.1 mapping, S6.2a packaging,
S6.2b two-stage construction, S6.3 generic no-clobber publication/readback, and S6.4
recordkeeping are complete and focused-green.

### Implemented boundary

The active APIs are:

- `buildDayflowAblationSyntheticDryRunPackage`
- `verifyDayflowAblationSyntheticDryRunDecisionBinding`
- `parseDayflowAblationSyntheticDryRunPackage`
- `buildDayflowAblationSyntheticExperimentManifest`
- `buildDayflowAblationSyntheticRunResults`
- `publishPrivateEvaluationArtifactSetNoClobber`
- `verifyPrivateEvaluationArtifactSetReadback`

The package contains exactly four files, in order:

1. `experiment-manifest.json`
2. `run-results.json`
3. `comparison-report.md`
4. `colin-decision.md`

The Markdown formats are internal, non-registry records. The registered standalone artifact
inventory remains exactly 30 classes. S6 added no artifact class, schema or serialized-version
change, dependency, public API, or production behavior.

Stage A derives the experiment manifest v0.2 and its typed ref from explicit current v0.2
config/cases bytes, exact source and provenance bytes/facts, tool facts, and `manifestCreatedAt`.
Stage B accepts that sealed manifest plus full sealed study protocol v0.3, evaluation execution
freeze v0.3, and terminal arm-run v0.4 artifacts. It parses detached hashes and verifies the full
manifest-to-protocol-to-freeze-to-run lineage before producing run-results v0.1 and its typed ref;
refs alone are not trusted.

Packaging is pure and deterministic: JSON is canonical JCS UTF-8 plus one LF, Markdown is
deterministic LF-only, timestamps and Colin's decision are explicit inputs, and the decision binds
the comparison report's raw SHA-256 and byte length. The report states
`metricsStatus: not-computed` and both records identify the result as synthetic contract
conformance, unresolved execution evidence, and not a real experiment approval.

The private store is generic transport outside experiment provenance. It accepts an explicit root
and safe path components, creates a unique `0700` run directory, writes ordered `0600` files with
no-clobber and fsync, and performs exact byte/hash/length readback from defensive copies. A partial
failure is preserved; the same label remains unusable and retry requires a new label. It does not
list, clean up, overwrite, resume, or access the existing private seven.

### Validation and next Colin gate

- S6.2a: Vitest 1 file / 47 tests PASS; scoped TypeScript PASS; ESLint PASS.
- S6.2b: Vitest 1 file / 51 tests PASS; scoped TypeScript PASS; ESLint PASS.
- S6.3: Vitest 2 files / 62 tests PASS; full TypeScript PASS; ESLint PASS.

Intermediate findings were test- or type-only and were corrected without changing semantics or
serialized bytes. No real `.local` artifact, Colin decision, A/B/C metric, live capture,
provider/network/environment read, Git operation, production behavior, dataset run, or baseline
run occurred. The existing private seven remain untouched. A baseline is not applicable because
S6 changes only evaluation tooling, serialization, and private storage transport.

Real synthetic publication is a new Colin gate. It requires a new `runLabel`, explicit decision
input, and full sealed lineage artifacts. Deleting the private seven and starting live Dayflow work
remain separate decisions. Rollback removes only the S6 additions and tests through a successor
record; it must never mutate historical records or private immutable data.

<!-- current-authority:DFA-COLIN-S6-SYNTHETIC-DRY-RUN-2026-08-19:end -->

<!-- current-authority:DFA-COLIN-E1-DETERMINISTIC-ARM-RUNNER-2026-08-20:begin -->

## Current authority: E1 deterministic semantic renderer and arm-run builder complete

This additive section is the current E1 engineering authority as of 2026-08-20. It preserves all
earlier sections as historical records while superseding stale top-level wording that requires a
provider call, David review or approval, a David-bound contract freeze, or an unimplemented
run-results/execution-freeze path for E1. E1 uses the existing evaluation execution freeze v0.3 as
caller-resolved lineage; it does not create or replace that artifact. David has no E1 role.

E1.1 policy definition, E1.2 pure deterministic A1/B/C rendering and arm-run construction, and
E1.3 scoped validation and recordkeeping are complete. A0 remains outside the runner and cannot
be called through the typed or runtime E1 builder boundary.

### Deterministic renderer and runner boundary

The frozen implementation identities are:

- runner `dayflow-e1-deterministic-arm-runner-v0.1`;
- shared A1/B renderer `dayflow-e1-ab-renderer-v0.1`;
- C renderer `dayflow-e1-c-renderer-v0.1`;
- screen eligibility `dayflow-e1-screen-eligibility-v0.1`;
- public-text guard `dayflow-e1-public-text-guard-v0.1`;
- presentation `dayflow-e1-display-only-presentation-v0.1`;
- deterministic request preimage `dayflow-e1-deterministic-request-v0.1` under hash domain
  `blabase.dayflow-e1.deterministic-request.v0.1`.

A1 consumes a sealed Active Attention result, verifies its integrity and expected hash, preserves
`topSuggestion` followed by `alternatives`, and emits only safe title/explanation-derived display
text. Unsafe or overlong candidates are omitted rather than truncated or redacted; no eligible
candidate yields `no_suggestion`.

B starts from the exact A1 semantic output and may change only item 1 summary, caveats, and private
machine claim IDs. Its sole approved single-space template is:

```text
{A1 summary} 화면 맥락: {normalized screen summary} (화면 표시는 완료·검증 근거가 아닙니다.)
```

Only one fully verified `RECENT_FOCUS` or `VISIBLE_TASK_INTENT` claim at confidence >= 8000 basis
points is eligible. Invalid, unavailable, rejected, failed, valid-empty, low-confidence,
no-context, unsafe, or expired (`asOf >= expiresAt`) screen context falls back to the exact A1
semantic object, bytes, and hash with sorted typed diagnostics outside the semantic output.

C consumes only fully resolved and verified normalized evidence. Every title and summary leaf must
bind to an eligible >= 8000 claim without a conflicted path. It preserves item order, unions the
three display-only caveats, and rejects the entire output when any item is unsafe or invalid.
Valid-empty becomes `no_suggestion`; invalid, rejected, expired, unavailable, and failure states
remain typed fail-closed outcomes. The blind-review projection removes private claim IDs.

`buildDayflowE1ArmRun` constructs arm-run v0.4 for A1/B/C only. It reparses and verifies sealed
arm inputs, full A1/B issuance receipts, renderer metadata, semantic schema/hash, and exact JCS+LF
bytes. The request hash is derived internally from the entire sealed arm input plus runner and
renderer identities. Successful and no-output response hashes are raw SHA-256 over the exact
semantic bytes. Every run contains one deterministic attempt, no retry or provider generation ID,
and zero input tokens, output tokens, and cost. C failures contain one exact failure code and no
fabricated semantic response. Renderer exceptions propagate.

### Contract, closure, privacy, and compatibility status

The existing serialized contracts remain arm input/run v0.4, semantic output v0.1, request
issuance receipt v0.1, and evaluation execution freeze v0.3. E1 added no schema, registry class,
configuration version, cases version, production dependency, public API, or production behavior.
The closure is exactly 11 contract source entries, 22 required provenance pin shapes, four
commands, and 30 registered standalone artifact classes.

No renderer or runner performs filesystem, environment, process, clock, random, network, provider,
publication, live collection, private-store, or production operation. Raw OCR/normalized values,
IDs, refs, paths, URLs, hashes, credentials, and Active action/target/source internals are not
copied into public semantic text. No real run, run-results artifact, `.local` artifact, private
artifact access, live capture, model call, metric, dataset change, or product behavior occurred.

The exact validated tracked identities were:

- `runGeneration.ts`: 33,122 bytes,
  `301e5134d18391d1c5485722ceac50a75c96f7c70d327f7cadda571bdcc12d08`;
- `contracts.ts`: 242,781 bytes,
  `77bd9b5bf33f5c25f69450630d4d20ca01bba95929781f8170331715c3c473cd`;
- `tsconfig.dayflow-dfa002.json`: 726 bytes,
  `09a27ed04b2530f0887e9978dc3a3edb379e85ae141e87a2f9619776e25821cb`;
- `dayflowAblationEvaluation.test.ts`: 230,514 bytes,
  `7b07b741f4cd35d5f871cdd485ba5e400e79b412deb1a75f99863f737b2706c0`.

### Validation interpretation and next Colin gate

Scoped dependency-cruiser passed with 115 modules, 443 dependencies, zero errors, and eight
existing warnings. Scoped ESLint, scoped TypeScript, and scoped Vitest (3 files / 90 tests) passed.
Full TypeScript and lint passed. Architecture checks reported zero errors and the existing 12
repository, 8 suggestion, and 2 script warnings. Full Vitest completed 161/162 files and
1,437/1,438 tests; the sole failure was the existing 5-second injected-clock timeout in
`continuationEvaluation`, outside E1. Its isolated file then passed 1 file / 22 tests. Therefore
scoped E1 is green, but this record does not claim an unqualified full-Vitest pass.

Dataset IDs, actual run IDs, metrics, and baseline are N/A for this pure evaluation renderer and
serialization change. Git identity was not inspected and no artifact was created. Rollback removes
the E1 runner, its tests, and its source-closure entries only through a successor record; historical
records and private immutable data remain untouched.

The only next decision is Colin's choice whether to start the `E2-IO` Dayflow exporter/importer
engineering checkpoint. This label is not authorization for the earlier Plan Stage E2 candidate
discovery, any provider execution, publication, live capture, private-artifact operation, or
production behavior.

<!-- current-authority:DFA-COLIN-E1-DETERMINISTIC-ARM-RUNNER-2026-08-20:end -->


---

## 2026-08-20 current authority: E2-IO.2A closure

This additive section preserves earlier planning and diagnostic history. It is
the current authority wherever earlier text describes E2-IO.2A as planned,
pending, blocked, or dependent on a David review artifact. Its authority is
limited to E2-IO.2A.

### Decision and status

- Colin is the sole working owner, human reviewer, and decision authority.
- David has no required reviewer, signer, receipt, artifact, or approval role.
- Colin authorized the bounded implementation, narrow test correction,
  independent static QA, and this documentation checkpoint.
- `E2-IO.2A` is `completed` for synthetic, in-memory, transport-only scope.
- This does not authorize `E2-IO.2B`, `E2-IO.2.3`, `E2-IO.2.4`, live access,
  retention, exporter work, production integration, publication, or release.

| Work item | Current status | Authority |
| --- | --- | --- |
| E2-IO.2A synthetic bundle import | completed | Colin-approved implementation, validation, QA, and documentation |
| E2-IO.2B | not authorized | separate Colin decision required |
| E2-IO.2.3 | not authorized | separate Colin decision required |
| E2-IO.2.4 | not authorized | separate Colin decision required |
| Live, retention, exporter, provider, or production work | not authorized | separate scoped decision required |

### Accepted behavior

The completed transport boundary:

- applies fatal UTF-8 decoding, duplicate-key rejection, and canonical JSON;
- binds completion to raw/detached manifest hashes and identity/count fields;
- requires an unordered exact one-to-one manifest/entry bijection;
- rejects more than 256 objects, an object over 10 MiB, or aggregate object
  bytes over 256 MiB before copying;
- validates digest, declared length, filename, MIME, and JPEG SOI/EOI framing;
- returns only a frozen primitive schema/hash/count replay descriptor;
- keeps the strict parser capability-free, with no filesystem, network,
  environment, provider, clock, random, dataset-builder, normalization,
  rendering, publication, or live-runtime capability.

Recorded contract literals:

- completion schema: `dayflow-screen-evidence-bundle-completion-v0.1`;
- completion hash domain:
  `blabase.dayflow-screen-evidence-bundle-completion.v0.1`;
- import schema: `dayflow-screen-evidence-bundle-import-v0.1`;
- replay hash domain:
  `blabase.dayflow-screen-evidence-bundle-replay.v0.1`.

### Closure evidence and limits

Focused validation passed with Node `v22.23.2`: TypeScript `5.9.3`, ESLint
`9.39.5`, Vitest `3.2.7` with 1 file and 10/10 tests, and dependency-cruiser
`18.2.0` with 0 errors. Existing warnings remain repository 12, suggestion 8,
and scripts 2; coverage was 17 entries and 4 sentinel edges. Independent
read-only static QA passed with no Critical, High, or Medium finding.

Low residual risks are SOI/EOI-only JPEG framing, chronology relying on
canonical UTC schema values, and absent exact-limit success/deep-JSON
performance tests.

No dataset/version/hash, evaluation run, metric, model, provider, token,
semantic baseline, normalized evidence, or E1 B/C execution was involved. A
targeted regression was used; production baseline is not applicable because
transport-only evaluation tooling does not alter semantic output or selection.

Privacy scope was synthetic and in-memory only. No actual Dayflow/private data,
`.local` artifact, filesystem, network, environment, provider, production,
publication, raw retention, or manual private-data inspection was used.


---

<!-- current-authority:E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:begin -->

## 2026-08-20 current authority: Dayflow preprocessing and one Blabase suggestion engine

This successor section is the current authority for the Dayflow A/B/C experiment. It preserves
earlier E1 implementation and validation records as historical evidence, but supersedes any
earlier instruction that treats arm-specific rendering, a post-hoc screen-summary overlay, or a
Dayflow-produced suggestion-shaped semantic output as an executable comparison design.

### Fixed ownership boundary

Dayflow owns capture, local storage, OCR, privacy filtering, and preprocessing. Its output may
contain privacy-minimized OCR text or spans, application/window/activity observations, capture
intervals, coverage, confidence, provenance, preprocessing versions, conflicts, omissions, and
typed errors.

Dayflow output must not contain or decide final suggestion titles, final summaries, caveats,
ranking, suggestion availability, output-field pointers such as /items/.../title, or semantic
labels whose purpose is to decide what the user should do next. In particular, semanticOutput,
RECENT_FOCUS, VISIBLE_TASK_INTENT, and final display copy are owned by the Blabase suggestion
engine.

Blabase owns evidence assembly, the LLM request, suggestion generation, validation, filtering,
ranking, caveats, and the final output schema.

### Fixed arm comparison

The successor experiment is:

- A: existing structured evidence only;
- B: the exact A structured evidence plus Dayflow preprocessed evidence;
- C: Dayflow preprocessed evidence only.

All three arms must call one Blabase suggestion-engine entry point and use the same model, prompt,
configuration, ranking policy, guardrails, output schema, and post-processing. Arm identity is
evaluation metadata and must not enable arm-specific generation branches. The only permitted arm
difference is the evidence set supplied to that common engine. A0 may remain a compatibility
reference outside the A/B/C comparison.

### Superseded and preserved work

The deterministic E1 runner remains a historical implementation record, but its shared A1/B
renderer, B string overlay, separate C renderer, screen_only_generation output path, and
suggestion-shaped normalized evidence are not authorized for future A/B/C execution, metrics, or
freeze evidence. Existing E1 results are not comparable evidence for the successor experiment.

E2-IO.2A remains valid and unchanged as a transport-only integrity boundary. Bundle, manifest,
hash, byte-size, replay-identity, provenance, consent, privacy, retention, deletion, and
SQLite/WAL-isolation rules remain reusable. E2-IO.2B is not authorized under its earlier design;
it must be redesigned as Dayflow preprocess -> neutral evidence envelope -> Blabase
verifier/adapter -> common Blabase suggestion engine.

### Status and next gate

E2-ROLE-1 is complete as documentation authority only. No production code, schema, fixture,
dataset, model, prompt, run, metric, baseline, private artifact, live capture, or release changed.
The next bounded task is E2-SCHEMA-1: define a new evidence-only Dayflow contract without modifying
historical frozen contracts or hashes. Starting that task requires a separate Colin decision.

<!-- current-authority:E2-ROLE-1-SAME-BLABASE-ENGINE-2026-08-20:end -->


---

<!-- current-authority:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:begin -->

## 2026-08-20 current authority: E2-SCHEMA-2A pure core completed

This additive checkpoint supersedes only active plan text that still describes the pure-core
neutral evidence contract as unimplemented or wholly unauthorized. Historical E1 and E2 records
remain unchanged.

### Completed result

`E2-SCHEMA-2A` implemented the strict synthetic-only
`dayflow-preprocessed-evidence-v0.1` schema, sealer, serializer, and canonical parser, with verifier
version `dayflow-preprocessed-evidence-verifier-v0.1` and detached-hash domain
`blabase.dayflow-preprocessed-evidence.v0.1`. It binds to
`dayflow-screen-evidence-bundle-import-v0.1` without changing E2-IO.2A or accepting a compatibility
union with legacy suggestion-shaped normalized evidence.

The implementation preserves the fixed role boundary. Dayflow produces neutral capture/OCR,
privacy, coverage, confidence, provenance, omission, and error evidence only. It does not produce
suggestion titles, summaries, `semanticOutput`, ranking, caveats, availability, next-action
semantics, or final output paths.

Focused validation passed with 29/29 dedicated tests, dedicated TypeScript, and targeted ESLint.
Compatibility validation passed with E2 importer 10/10, DFA regression 90/90, five files and 129
tests total, full suggestion TypeScript and lint, and architecture dependency zero errors with the
existing repository 12/suggestion 8/scripts 2 warnings. Final independent read-only QA passed for
F2a, F2b.1, and F2c.1 with no Medium-or-higher finding in each scope.

### Current plan gate

| Work item | Status | Required decision |
| --- | --- | --- |
| E2-SCHEMA-2A pure core | implemented, validated, QA-reviewed | documentation checkpoint only; no release authority |
| E2-SCHEMA-2B bundle adapter and re-verification | pending, not authorized | separate Colin decision |
| Common evidence adapter and same-engine run generation | pending, not authorized | separate Colin decision |
| Live inputs and A/B/C execution | pending, not authorized | separate Colin decision |

No dataset, baseline, run, comparison metric, model, prompt, production behavior, real screenshot,
OCR, or private artifact was created, changed, or inspected. Automated QA does not replace Colin's
decision authority, and David has no required role or artifact.

<!-- current-authority:E2-SCHEMA-2A-PURE-CORE-COMPLETED-2026-08-20:end -->


---

<!-- current-authority:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:begin -->

## 2026-08-21 current authority: E2-SCHEMA-2B-1 completed

This additive checkpoint preserves the E2-SCHEMA-1 and 2A records and supersedes only active
planning language that treats the owned verification snapshot as unimplemented.

`E2-SCHEMA-2B-1` now provides a synthetic-only opaque owned snapshot around candidate evidence
bytes, the original E2-IO.2A bundle input, and its exact seven-field expected import descriptor.
It validates bounded object shape and path/control/count structure, rejects unsafe typed arrays,
applies caps before copying, retains only fixed owned copies, returns fresh copies, and immediately
reimports the bundle through the unchanged importer. The snapshot API emits only five closed
sanitized issue codes.

This is transport ownership and descriptor binding, not semantic verification. It does not parse
the candidate evidence, resolve frame-to-manifest evidence, generate title or summary, decide
rank, caveat, availability, or next action, adapt engine input, or invoke an engine.

| Work item | Current status | Decision authority |
| --- | --- | --- |
| E2-SCHEMA-2A pure core | completed | retained unchanged |
| E2-SCHEMA-2B-1 owned snapshot | implemented, validated, read-only QA-reviewed | Colin accepted this documentation checkpoint only |
| E2-SCHEMA-2B-2 staged parse and resolved verification | pending, not authorized, not complete | separate Colin decision required |
| Common-engine adapter and run generation | pending, not authorized | separate Colin decision required |
| Live data and A/B/C execution | pending, not authorized | separate Colin decision required |

Focused evidence is 21/21 dedicated snapshot tests, dedicated TypeScript, and targeted ESLint.
Compatibility is six test files and 150 tests: 21 snapshot, 29 schema, 10 importer, and 90 DFA.
Full suggestion typecheck/lint and root architecture dependency checking passed; architecture had
zero errors, valid 17-entry/4-sentinel-edge coverage, and existing warnings repository 12,
suggestion 8, scripts 2. QA3 was automated read-only technical evidence, passed with no High or
Medium finding, and is not a separate human approval.

Golden/baseline and LikeC4 updates are N/A for this unconnected evaluation-only capability. No
runtime engine input/output/filter/order/rank changed, and no real screenshot, OCR, private
artifact, or live data was created, inspected, or persisted. Colin remains the sole decision
authority; David has no required role or artifact.

<!-- current-authority:E2-SCHEMA-2B-1-OWNED-SNAPSHOT-COMPLETED-2026-08-21:end -->


---

<!-- current-authority:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:begin -->

## 2026-08-21 current authority: E2-SCHEMA-2B-2A completed

This additive checkpoint subdivides the earlier broad E2-SCHEMA-2B-2 plan without rewriting its
history. The structural inspection half, `2B-2A`, is implemented and validated. The capture-only
ordering and manifest-backed final verifier half, `2B-2B`, is not implemented.

`2B-2A` preserves all existing public schema-core bytes and behavior while adding one internal,
non-product inspector. It orders byte/JSON/resource/canonical validation before structural schema,
root hash, and intrinsic/owner collection. Seven intrinsic issue codes are final at this layer;
three resolved owners only identify work that `2B-2B` must decide against the owned manifest.

| Work item | Current status | Next authority |
| --- | --- | --- |
| E2-SCHEMA-2A pure core | completed | unchanged |
| E2-SCHEMA-2B-1 owned snapshot | completed | unchanged |
| E2-SCHEMA-2B-2A staged structural inspection | completed and validated | Colin accepted this documentation checkpoint only |
| E2-SCHEMA-2B-2B capture-only order and resolved verifier | pending, not authorized, unimplemented | separate Colin decision required |
| Common-engine adapter, run generation, live A/B/C, production | pending, not authorized | separate Colin decision required |

Validation is 39/39 focused and six files/160 tests compatible, with full suggestion typecheck and
lint plus architecture dependencies passing. QA-R2 was independent read-only automated technical
evidence and passed with no finding; it is not human approval. Colin is the sole decision
authority, and David has no role or required artifact.

No baseline run occurred, no Golden dataset changed, and no runtime engine input/output/filter/
order/rank or LikeC4 connection changed. Synthetic tests handled no real screenshot, OCR, private
artifact, log, or live data. Suggestion semantics remain solely future Blabase-engine work.

<!-- current-authority:E2-SCHEMA-2B-2A-STAGED-INSPECTION-COMPLETED-2026-08-21:end -->

## 2026-08-21 current authority: E2-SCHEMA-2B Stage 1-9 completed

This additive checkpoint preserves all prior E2 records and supersedes their active statement that
E2-SCHEMA-2B-2B is pending. The raw three-argument, direct-module
`verifyDayflowPreprocessedEvidenceV0_1` flow is implemented through Stage 9:
capture-only ownership, core inspection, one detailed import, Stage 7 transport binding, Stage 8
manifest/protocol prerequisites, and Stage 9 neutral evidence resolution.

| Work item | Current status | Next authority |
| --- | --- | --- |
| B1 capture-only projection | implemented, focused-validated, independent QA PASS | retained internal |
| B2-1 prerequisites | implemented, focused-validated, independent QA PASS | retained internal |
| B2-2A resolution | implemented, focused-validated, current-head QA PASS with no Medium+ | retained internal |
| B2-2B facade | implemented, focused-validated, current-head QA PASS with no Medium+ | documentation checkpoint only |
| Full Vitest unit suite | deferred because Colin selected documentation | must pass before release or freeze |
| Stage 10 common-engine adapter and generation | pending, not authorized | separate Colin decision |
| Live A/B/C, API, persistence, provider, production, release, freeze | pending, not authorized | separate Colin decision |

Final evidence is two focused files/42 tests and four integration files/93 tests
(39 core + 12 importer + 42 snapshot/final), plus full suggestion typecheck/lint and architecture
dependency exit zero. Architecture retained 17-entry/4-sentinel-edge coverage, no new Dayflow
violation, and existing warnings 12 repository/8 suggestion/2 scripts. Earlier 29/36 focused counts
are superseded evidence. The full repository Vitest unit suite was not run.

No baseline or Golden run applies because no model, prompt, ranking, suggestion output, dataset, or
runtime engine behavior changed. No LikeC4 update applies because no implemented system boundary,
container, or runtime flow changed. Tests were synthetic-only and performed no live/user, private,
environment, raw-bundle, JPEG, path, log, or persistence operation.

Dayflow owns only capture, storage, OCR, privacy filtering, and neutral preprocessing. Stage 1-9
does not introduce suggestion title, summary, `semanticOutput`, ranking, caveat, availability,
next action, or output-path fields. The same future Blabase engine remains mandatory for A/B/C.
Colin is the sole decision authority. David has no required role or artifact, and agent QA is not
human approval.

<!-- current-authority:E2-SCHEMA-2B-STAGE1-9-DIRECT-VERIFIER-COMPLETED-2026-08-21:end -->

## 2026-08-21 current authority: E2-FULL-UNIT gate completed

The previously deferred full Vitest unit-suite gate is now complete. From `suggestion/`,
`npm test` exited 0 with 166 files/1,531 tests PASS, no failures, Vitest 20.05 seconds, and
approximately 20.26 seconds elapsed.

| Evidence | Current status |
| --- | --- |
| Focused verifier closure | PASS, 2 files/42 tests; retained separately |
| Integration closure | PASS, 4 files/93 tests; retained separately |
| Full Vitest unit suite | PASS, 166 files/1,531 tests; exit 0, no failures |
| Stage 10/common engine/generation | pending, not authorized |
| A/B/C/live/API/persistence/product/release/freeze | pending, not authorized |

This documentation checkpoint made no code edit and reran no validation. Passing the unit suite
does not create release or freeze authority and does not change baseline, Golden, LikeC4, privacy,
retention, neutral Dayflow, Colin-only authority, no-David-gate, or same-engine A/B/C decisions.

<!-- current-authority:E2-FULL-UNIT-PASSED-2026-08-21:end -->

---

<!-- dayflow-plan-section:STAGE10-1A-1-COMMON-EVIDENCE-RECORD-SET-COMPLETED-2026-08-21:begin -->

## Stage10-1A.1 Common Evidence Record Set - completed 2026-08-21

### Decision and status

- Working owner, human reviewer, and decision authority: Colin.
- Required David review, receipt, artifact, or approval: none.
- Status: Implemented, focused-validated, full-regression-validated, and independently QA-reviewed
  with PASS.
- Applicability: Evaluation-only and unconnected. This checkpoint does not authorize or implement
  the common suggestion engine, prompt, model, ranking, output generation, A/B/C execution, live
  data, API, persistence, provider, product, release, or production use.

### Completed objective

Stage10-1A.1 introduces a source-neutral, deterministic, sealed record set that can later become the
input boundary for the same Blabase suggestion engine across A, B, and C. It stores evidence facts
only. It does not contain a suggestion title, summary, semanticOutput, rank, caveat, availability,
next action, or final output path.

The implemented artifact is:

- Schema version: blabase-common-suggestion-evidence-record-set-v0.1.
- Detached-hash domain: blabase.common-suggestion-evidence-record-set.v0.1.
- Detached-hash field: commonSuggestionEvidenceRecordSetSha256.
- Budget version: common-suggestion-evidence-budget-v0.1.
- Public builder: buildAndSealCommonSuggestionEvidenceRecordSetV0_1(input).
- Public structural facade: commonSuggestionEvidenceRecordSetStructuralSchemaV0_1.safeParse(input).
- Public authoritative verifier: verifyCommonSuggestionEvidenceRecordSetV0_1(input).
- Public serializer: serializeCommonSuggestionEvidenceRecordSetV0_1(value).

### Accepted record contract

The seven record kinds are github_work_item, github_deadline, github_activity, codex_overview,
calendar_constraint, notion_resource, and dayflow_frame.

The only authority values are primary_task_fact, structured_supporting_context, and
screen_observation. Dayflow records are observations only. GitHub work items and deadlines are
primary only when their accepted attention and semantic-role predicates permit it; other
structured records remain supporting context.

Dayflow fact-ID preimages use the approved dotted paths:

- spans.N.text
- spans.N.confidence.status
- spans.N.confidence.basisPoints
- spans.N.redaction.status
- spans.N.redaction.categories

Build-only source identities are stripped from the sealed artifact. Sealed record IDs must match
^evidence_record_[0-9a-f]{32}$; fact IDs remain derived from record ID, fact key, and a
domain-separated fact-value hash.

### Resource, ordering, and integrity closure

- Structured input cap: 2,048 records.
- Dayflow input cap: 256 records.
- Structured selected-record budget: 49,152 UTF-8 bytes.
- Dayflow selected-record budget: 65,536 UTF-8 bytes.
- Prompt-envelope reserve: 8,192 UTF-8 bytes.
- Total prompt limit: 122,880 UTF-8 bytes.
- Selection order and final serialization order remain separate deterministic orders.
- Duplicate collapse is partition-local, but record-ID and fact-ID collision checks cover both
  complete deduplicated partitions before selection and truncation.
- RECORD_ID_COLLISION precedes FACT_ID_COLLISION.
- The verifier checks the detached hash, selected-record source/authority/fact IDs, ordering,
  count arithmetic, caps, selected bytes, and the checkable byte-budget relation.
- The verifier does not claim it can reconstruct omitted record IDs or their original preimage
  from a sealed artifact.

All public unknown-input paths use bounded hardened projection before Zod. Accessors, proxies,
shared-reference graphs, excessive depth, excessive keys, and excessive arrays fail closed.
Internal authority schemas do not reuse the publicly exported SHA-256 or UTC Zod instances.

### Validation and QA closure

- Focused Vitest: 13/13 PASS.
- Full Suggestion typecheck: PASS.
- Full Suggestion lint: PASS with no warning or error.
- Full Suggestion Vitest: 167 files and 1,544 tests PASS.
- Independent final QA: PASS with no Critical, High, Medium, or blocking Low finding.
- Initial QA found four Medium integrity gaps in the public structural facade, private child-schema
  isolation, truncation metadata invariants, and record-ID grammar. All four were corrected and
  independently re-reviewed as closed.
- Remaining non-blocking test opportunities are stronger causal fixtures for shared/oversized
  structural input, a forced global fact-ID collision, and a dedicated simultaneous record/fact
  collision precedence case.

No Golden, Regression, Rolling, Holdout, LLM, model, prompt, ranking, or suggestion-quality run was
created or changed. The 1,544 passing tests are engineering regression evidence, not suggestion
quality evidence.

### Privacy, architecture, and next checkpoint

No live screenshot, OCR payload, user data, private artifact, environment value, credential, log,
or retention action was created or persisted. Synthetic fictional fixtures only were used.

No LikeC4 update is required because this module is still an unconnected evaluation contract and
does not add an implemented system boundary, container, external integration, or runtime flow.

Stage10-1A.2 source-specific coverage and provenance, Stage10-2 structured adaptation, Stage10-3
Dayflow composition, common-engine generation, offline runners, and A/B/C execution remain pending
and require separate Colin decisions. Completion of Stage10-1A.1 authorizes none of them.

<!-- dayflow-plan-section:STAGE10-1A-1-COMMON-EVIDENCE-RECORD-SET-COMPLETED-2026-08-21:end -->

---

<!-- dayflow-plan-section:STAGE10-1A-2B-LINEAGE-STRUCTURAL-ORCHESTRATION-READY-2026-08-22:begin -->

## Stage10-1A.2b lineage structural orchestration - ready for Colin acceptance 2026-08-22

### Decision and status

- Working owner, human reviewer, and decision authority: Colin.
- Required David review, receipt, artifact, or approval: none.
- Frozen prerequisite: `COMMON_SUGGESTION_EVIDENCE_LINEAGE_V0_1_CONTRACT.md`, committed as
  `e1415ad`; this checkpoint does not rewrite that frozen contract.
- Status: Implemented, focused-validated, full-regression-validated, and bounded technical QA PASS.
  Colin's explicit checkpoint acceptance remains the final human gate.
- Applicability: Evaluation-only, structural, and unconnected. No source verifier, suggestion engine,
  model, prompt, ranking, output generation, A/B/C runner, API, persistence, provider, product,
  release, or production authority is activated.

This additive section supersedes only active statements that Stage10-1A.2 structural orchestration
remains wholly unimplemented. It preserves Stage10-1A.1, all E2 history, and the historical E1
records without treating historical E1 B/C generation as valid same-engine evidence.

### Implemented boundary

The public runtime surface is limited to:

- `commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1`.
- `inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1`.
- `planCommonSuggestionEvidenceLineageSourceVerificationV0_1`.

The following authoritative APIs do not exist:

- `buildAndSealCommonSuggestionEvidenceLineageReceiptV0_1`.
- `verifyCommonSuggestionEvidenceLineageReceiptV0_1`.
- `serializeCommonSuggestionEvidenceLineageReceiptV0_1`.

The private implementation provides exact receipt and source-attestation structural validation,
fixed five-source planning, frozen failure precedence, bounded hostile-input projection, ordinary
deeply frozen results, detached-hash inspection, private scope-token/HMAC preimage boundaries, and
runtime-private registry, key, time, and timezone snapshot interfaces. A requested source whose
private bundle passes bundle preflight reaches `SOURCE_VERIFIER_UNAVAILABLE`. Missing, malformed,
extra, proxy/accessor, or non-requested bundles fail earlier with `INPUT_INVALID` or
`SOURCE_BINDING_INVALID`. No source can return authoritative success.

The source-attestation wire remains internal. It binds `requiredOperations` and
`requiredOperationStatuses`, enforces operation order and coverage-status consistency, requires
`completedAt === null` for unavailable participation, and binds the complete attestation through its
detached hash. These checks establish structural honesty only; they do not prove upstream collection.

The lineage receipt remains a provenance and coverage sidecar. It is never suggestion-engine or
model input. The existing Stage10-1A.1 common record set remains a separate suggestion payload and
is not reinterpreted as a lineage receipt.

### Frozen identities and limits

- Receipt schema: `blabase-common-suggestion-evidence-lineage-receipt-v0.1`.
- Receipt hash domain: `blabase.common-suggestion-evidence-lineage-receipt.v0.1`.
- Source-attestation schema: `blabase-common-suggestion-source-collection-attestation-v0.1`.
- Source-attestation hash domain:
  `blabase.common-suggestion-source-collection-attestation.v0.1`.
- Record-ID-set hash domain: `blabase.common-suggestion-evidence-lineage-record-ids.v0.1`.
- Private scope HMAC domain: `blabase.lineage.private-scope.v0.1`.
- Scope-token canonicalization: `blabase-scope-token-canonicalization-v0.1`.
- Frozen timezone profile: `blabase-tzdb-profile-2026c-v1`, release `2026c`.
- Maximum canonical receipt bytes: 262,144.
- Maximum canonical source-attestation bytes: 131,072.
- Maximum private HMAC preimage bytes: 1,048,576.
- Maximum source bindings: five.
- Maximum coverage intervals per binding: 1,024.
- Maximum neutral issue codes per binding: 32.

The shared JCS/domain-hash helper was hardened against post-import intrinsic mutation without
changing RFC 8785 canonical bytes or `UTF-8(domain) || NUL || UTF-8(JCS(value))` framing. The lineage
runtime uses captured intrinsics and indexed loops across projection, manual validation, deep freeze,
hash/HMAC processing, attestation parsing, and planning. Runtime Zod parsing is not used in the
receipt, private attestation, HMAC context, or HMAC key-version paths.

### Validation and QA closure

- Stage10 focused Vitest: 24/24 PASS.
- Shared Dayflow contract Vitest: 20/20 PASS.
- Full application TypeScript typecheck: PASS.
- Focused ESLint for the five affected source/test files: PASS.
- Full Suggestion Vitest: 168 files and 1,569 tests PASS, no failures.
- Final bounded read-only QA: PASS with no Critical, High, Medium, or Low finding in scope.

Intermediate validation and QA found Zod v3 union compatibility, mutable runtime intrinsic,
shared-JCS hardening, private attestation operation-status, and unavailable-timestamp defects. All
confirmed findings were corrected, regression-tested, and independently re-reviewed as closed.

The full application lint command, architecture checks, build, and Golden baseline were not run in
this checkpoint. Focused lint is the only lint evidence claimed here. Golden and suggestion-quality
evaluation are not applicable because no dataset, engine input, prompt, model, ranking, filtering,
ordering, generated suggestion, or result-resolution behavior changed.

### Privacy, architecture, rollback, and next gate

All fixtures are fictional and synthetic. No screenshot, OCR payload, live connector response, user
data, private artifact, key, credential, environment value, log, persistence, deletion, or retention
operation was created or read by this checkpoint.

No LikeC4 model change is required because the lineage implementation remains an unconnected
evaluation contract and adds no implemented container, external integration, or runtime flow. No
existing production boundary or runtime flow was connected. The checkpoint added unconnected
evaluation imports from the public facade to its internal module and from that internal module to
the shared Dayflow contract helper. Architecture commands were not rerun and no architecture PASS
is claimed by this section.

Rollback requires a successor record. Remove the three lineage source/test additions and revert the
bounded shared JCS/test hardening only if that hardening is explicitly included in the rollback.
Preserve Stage10-1A.1 and all E2/E1 history. No private-data cleanup exists.

The next human gate is Colin's acceptance of this Stage10-1A.2b documentation checkpoint.
Stage10-2 authoritative source verifiers, registry/key/profile implementations, connector sidecars,
Stage10-3 composition, common-engine generation, offline A/B/C execution, and all live/product work
remain pending and require separate Colin decisions.

<!-- dayflow-plan-section:STAGE10-1A-2B-LINEAGE-STRUCTURAL-ORCHESTRATION-READY-2026-08-22:end -->

<!-- dayflow-plan-section:STAGE10-1A-2B-COLIN-ACCEPTED-2026-08-22:begin -->

## Stage10-1A.2b Colin acceptance - 2026-08-22

Colin explicitly accepted the Stage10-1A.2b lineage structural-orchestration checkpoint after the
recorded implementation, focused validation, full 168-file/1,569-test Suggestion regression,
bounded code QA PASS, Engine Change Record, and documentation QA PASS.

This acceptance closes Stage10-1A.2b only. It supersedes the pending-Colin-acceptance status in the
immediately preceding READY section without changing its implementation identities, validation
evidence, privacy boundary, rollback, or limitations. No command was rerun and no code changed for
this acceptance record.

Stage10-2 authoritative source verifiers, registry/key/profile implementations, connector
sidecars, Stage10-3 composition, common-engine generation, offline A/B/C execution, and all
live/product work remain pending and require separate Colin decisions.

<!-- dayflow-plan-section:STAGE10-1A-2B-COLIN-ACCEPTED-2026-08-22:end -->
