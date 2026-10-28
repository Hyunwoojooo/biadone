import { classifyDayflowCoverage } from "../../dayflowEvidence/contracts";
import {
  dayflowPreprocessedEvidenceV0_1Schema,
  inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification,
  type DayflowPreprocessedEvidenceCoreIssueCode,
  type DayflowPreprocessedEvidenceDeferredIssueCodeV0_1,
  type DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1,
  type DayflowPreprocessedEvidenceResolvedInspectionV0_1,
  type DayflowPreprocessedEvidenceV0_1,
} from "../../dayflowEvidence/preprocessedEvidenceV0_1";
import type {
  ImportDayflowEvidenceBundleInput,
  ImportedDayflowEvidenceBundle,
  ImportedDayflowEvidenceForResolutionV0_1,
} from "./importEvidenceBundle";
import {
  DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1,
  captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1,
  copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1,
  reverifyOwnedPreprocessedEvidenceVerificationSnapshotForResolutionV0_1,
  type DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1,
  type OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
} from "./preprocessedEvidenceVerificationSnapshotV0_1";

const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectCreate = Object.create;
const intrinsicReflectApply = Reflect.apply;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;

export type PreprocessedEvidenceBundlePrerequisiteIssueCodeV0_1 =
  | DayflowPreprocessedEvidenceCoreIssueCode
  | DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1
  | "TRANSPORT_BINDING_MISMATCH"
  | "MANIFEST_BINDING_MISMATCH"
  | "ORIGIN_PHASE_MISMATCH"
  | "STUDY_PROTOCOL_MISMATCH";

declare const prerequisiteContextBrandV0_1: unique symbol;

export type OwnedPreprocessedEvidenceBundlePrerequisiteContextV0_1 = Readonly<{
  readonly [prerequisiteContextBrandV0_1]: true;
}>;

type AcceptedInspection = Extract<
  DayflowPreprocessedEvidenceResolvedInspectionV0_1,
  { status: "accepted-for-resolution" }
>;

type OwnedPrerequisiteState = Readonly<{
  candidate: AcceptedInspection["candidate"];
  imported: ImportedDayflowEvidenceForResolutionV0_1;
  deferredIssueCodes: readonly DayflowPreprocessedEvidenceDeferredIssueCodeV0_1[];
  deferredResolvedOwners: readonly DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1[];
}>;

export type VerifyPreprocessedEvidenceBundlePrerequisitesResultV0_1 =
  | Readonly<{
      valid: false;
      issueCodes: readonly PreprocessedEvidenceBundlePrerequisiteIssueCodeV0_1[];
    }>
  | Readonly<{
      valid: true;
      prerequisiteContext: OwnedPreprocessedEvidenceBundlePrerequisiteContextV0_1;
    }>;

export type PreprocessedEvidenceBundleResolutionIssueCodeV0_1 =
  | "INPUT_INVALID"
  | "SCHEMA_INVALID"
  | "CAPTURE_WINDOW_MISMATCH"
  | "CHRONOLOGY_INVALID"
  | "COVERAGE_CODE_MISMATCH"
  | "COVERAGE_FAILURE"
  | "COVERAGE_MISMATCH"
  | "OCR_TEXT_HASH_MISMATCH"
  | "OCR_TEXT_INVALID"
  | "PREPROCESSING_PROVENANCE_INVALID"
  | "PRIVACY_METADATA_INVALID"
  | "RESOURCE_COUNT_MISMATCH"
  | "SOURCE_ARTIFACT_BINDING_MISMATCH"
  | "SOURCE_ARTIFACT_SET_MISMATCH";

type ResolvedIssueCodeV0_1 = Exclude<
  PreprocessedEvidenceBundleResolutionIssueCodeV0_1,
  "INPUT_INVALID" | "SCHEMA_INVALID"
>;

type NonEmptyResolutionIssueCodesV0_1 = readonly [
  PreprocessedEvidenceBundleResolutionIssueCodeV0_1,
  ...PreprocessedEvidenceBundleResolutionIssueCodeV0_1[],
];

export type VerifyPreprocessedEvidenceBundleResolutionResultV0_1 =
  | Readonly<{
      valid: false;
      issueCodes: NonEmptyResolutionIssueCodesV0_1;
    }>
  | Readonly<{
      valid: true;
      evidence: DayflowPreprocessedEvidenceV0_1;
      issueCodes: readonly [];
    }>;

export type DayflowPreprocessedEvidenceIssueCodeV0_1 =
  | DayflowPreprocessedEvidenceCoreIssueCode
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

export type VerifyDayflowPreprocessedEvidenceResultV0_1 =
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

type ResolutionIssueFlags = Record<ResolvedIssueCodeV0_1, boolean>;

const resolutionIssueCodeOrder = intrinsicObjectFreeze([
  "CAPTURE_WINDOW_MISMATCH",
  "CHRONOLOGY_INVALID",
  "COVERAGE_CODE_MISMATCH",
  "COVERAGE_FAILURE",
  "COVERAGE_MISMATCH",
  "OCR_TEXT_HASH_MISMATCH",
  "OCR_TEXT_INVALID",
  "PREPROCESSING_PROVENANCE_INVALID",
  "PRIVACY_METADATA_INVALID",
  "RESOURCE_COUNT_MISMATCH",
  "SOURCE_ARTIFACT_BINDING_MISMATCH",
  "SOURCE_ARTIFACT_SET_MISMATCH",
] as const);

const prerequisiteStates = new WeakMap<object, OwnedPrerequisiteState>();

function reject(
  issueCode: PreprocessedEvidenceBundlePrerequisiteIssueCodeV0_1,
): VerifyPreprocessedEvidenceBundlePrerequisitesResultV0_1 {
  return intrinsicObjectFreeze({
    valid: false,
    issueCodes: intrinsicObjectFreeze([issueCode]),
  });
}

function hasExactTransportBinding(
  candidate: AcceptedInspection["candidate"],
  descriptor: ImportedDayflowEvidenceBundle,
): boolean {
  const binding = candidate.transportBinding;
  return (
    binding.importSchemaVersion === descriptor.importSchemaVersion &&
    binding.manifestRawSha256 === descriptor.manifestRawSha256 &&
    binding.manifestDetachedSha256 === descriptor.manifestDetachedSha256 &&
    binding.completionSha256 === descriptor.completionSha256 &&
    binding.objectCount === descriptor.objectCount &&
    binding.totalObjectBytes === descriptor.totalObjectBytes &&
    binding.replayIdentitySha256 === descriptor.replayIdentitySha256
  );
}

function hasExactResolvedManifestBinding(
  imported: ImportedDayflowEvidenceForResolutionV0_1,
): boolean {
  return (
    imported.descriptor.manifestRawSha256 ===
      imported.resolvedManifest.manifestRawSha256 &&
    imported.descriptor.manifestDetachedSha256 ===
      imported.resolvedManifest.detachedManifestSha256
  );
}

function readPrerequisiteState(
  prerequisiteContext: OwnedPreprocessedEvidenceBundlePrerequisiteContextV0_1,
): OwnedPrerequisiteState | undefined {
  try {
    return intrinsicReflectApply(intrinsicWeakMapGet, prerequisiteStates, [
      prerequisiteContext,
    ]) as OwnedPrerequisiteState | undefined;
  } catch {
    return undefined;
  }
}

function hasExactCoverage(
  candidate: AcceptedInspection["candidate"]["coverage"],
  resolved: ImportedDayflowEvidenceForResolutionV0_1["resolvedManifest"]["coverage"],
): boolean {
  if (
    candidate.expectedFrameCount !== resolved.expectedFrameCount ||
    candidate.observedFrameCount !== resolved.observedFrameCount ||
    candidate.rejectedFrameCount !== resolved.rejectedFrameCount ||
    candidate.intervals.length !== resolved.intervals.length
  ) {
    return false;
  }
  for (let index = 0; index < candidate.intervals.length; index += 1) {
    const left = candidate.intervals[index]!;
    const right = resolved.intervals[index]!;
    if (
      left.start !== right.start ||
      left.end !== right.end ||
      left.reason !== right.reason ||
      left.expectedFrameCount !== right.expectedFrameCount ||
      left.observedFrameCount !== right.observedFrameCount ||
      left.rejectedFrameCount !== right.rejectedFrameCount
    ) {
      return false;
    }
  }
  return true;
}

type CandidateFrame = AcceptedInspection["candidate"]["frames"][number];
type ResolvedArtifact = ImportedDayflowEvidenceForResolutionV0_1[
  "resolvedManifest"
]["artifacts"][number];

function candidateSourceKey(frame: CandidateFrame): string {
  return (
    frame.sourceArtifactRef.sourceRowId +
    "\u0000" +
    frame.sourceArtifactRef.blobSha256
  );
}

function resolvedSourceKey(artifact: ResolvedArtifact): string {
  return artifact.sourceRowId + "\u0000" + artifact.sha256;
}

function hasSourceArtifactSetMismatch(
  candidate: AcceptedInspection["candidate"],
  imported: ImportedDayflowEvidenceForResolutionV0_1,
): boolean {
  const frames = candidate.frames;
  const artifacts = imported.resolvedManifest.artifacts;
  let mismatch = frames.length !== artifacts.length;
  for (let index = 0; index < frames.length; index += 1) {
    const key = candidateSourceKey(frames[index]!);
    if (
      index >= artifacts.length ||
      key !== resolvedSourceKey(artifacts[index]!)
    ) {
      mismatch = true;
    }
    for (let previous = 0; previous < index; previous += 1) {
      if (key === candidateSourceKey(frames[previous]!)) mismatch = true;
    }
  }
  for (let index = 0; index < artifacts.length; index += 1) {
    const key = resolvedSourceKey(artifacts[index]!);
    for (let previous = 0; previous < index; previous += 1) {
      if (key === resolvedSourceKey(artifacts[previous]!)) mismatch = true;
    }
  }
  return mismatch;
}

function hasSourceArtifactBindingMismatch(
  candidate: AcceptedInspection["candidate"],
  imported: ImportedDayflowEvidenceForResolutionV0_1,
): boolean {
  const manifest = imported.resolvedManifest;
  let mismatch = false;
  for (let frameIndex = 0; frameIndex < candidate.frames.length; frameIndex += 1) {
    const frame = candidate.frames[frameIndex]!;
    const key = candidateSourceKey(frame);
    let matchCount = 0;
    let matchedArtifact: ResolvedArtifact | undefined;
    for (
      let artifactIndex = 0;
      artifactIndex < manifest.artifacts.length;
      artifactIndex += 1
    ) {
      const artifact = manifest.artifacts[artifactIndex]!;
      if (key === resolvedSourceKey(artifact)) {
        matchCount += 1;
        matchedArtifact = artifact;
      }
    }
    if (matchCount === 1 && matchedArtifact !== undefined) {
      const source = frame.sourceArtifactRef;
      if (
        source.artifactType !== "dayflow_export_frame" ||
        source.exportRef.schemaVersion !== manifest.schemaVersion ||
        source.exportRef.exportId !== manifest.exportId ||
        source.exportRef.detachedManifestSha256 !==
          manifest.detachedManifestSha256 ||
        source.sourceRowId !== matchedArtifact.sourceRowId ||
        source.blobSha256 !== matchedArtifact.sha256 ||
        frame.capturedAt !== matchedArtifact.capturedAt
      ) {
        mismatch = true;
      }
    }
  }
  return mismatch;
}

function newResolutionIssueFlags(): ResolutionIssueFlags {
  return {
    CAPTURE_WINDOW_MISMATCH: false,
    CHRONOLOGY_INVALID: false,
    COVERAGE_CODE_MISMATCH: false,
    COVERAGE_FAILURE: false,
    COVERAGE_MISMATCH: false,
    OCR_TEXT_HASH_MISMATCH: false,
    OCR_TEXT_INVALID: false,
    PREPROCESSING_PROVENANCE_INVALID: false,
    PRIVACY_METADATA_INVALID: false,
    RESOURCE_COUNT_MISMATCH: false,
    SOURCE_ARTIFACT_BINDING_MISMATCH: false,
    SOURCE_ARTIFACT_SET_MISMATCH: false,
  };
}

function mergeDeferredIssues(
  flags: ResolutionIssueFlags,
  issueCodes: readonly DayflowPreprocessedEvidenceDeferredIssueCodeV0_1[],
): void {
  for (let index = 0; index < issueCodes.length; index += 1) {
    switch (issueCodes[index]!) {
      case "CAPTURE_WINDOW_MISMATCH":
        flags.CAPTURE_WINDOW_MISMATCH = true;
        break;
      case "CHRONOLOGY_INVALID":
        flags.CHRONOLOGY_INVALID = true;
        break;
      case "PREPROCESSING_PROVENANCE_INVALID":
        flags.PREPROCESSING_PROVENANCE_INVALID = true;
        break;
      case "OCR_TEXT_INVALID":
        flags.OCR_TEXT_INVALID = true;
        break;
      case "OCR_TEXT_HASH_MISMATCH":
        flags.OCR_TEXT_HASH_MISMATCH = true;
        break;
      case "PRIVACY_METADATA_INVALID":
        flags.PRIVACY_METADATA_INVALID = true;
        break;
      case "RESOURCE_COUNT_MISMATCH":
        flags.RESOURCE_COUNT_MISMATCH = true;
        break;
    }
  }
}

function orderedResolutionIssues(
  flags: ResolutionIssueFlags,
): readonly ResolvedIssueCodeV0_1[] {
  const issueCodes: ResolvedIssueCodeV0_1[] = [];
  let outputIndex = 0;
  for (
    let orderIndex = 0;
    orderIndex < resolutionIssueCodeOrder.length;
    orderIndex += 1
  ) {
    const issueCode = resolutionIssueCodeOrder[orderIndex]!;
    if (flags[issueCode]) {
      issueCodes[outputIndex] = issueCode;
      outputIndex += 1;
    }
  }
  return intrinsicObjectFreeze(issueCodes);
}

function rejectResolutionInput(): VerifyPreprocessedEvidenceBundleResolutionResultV0_1 {
  return intrinsicObjectFreeze({
    valid: false,
    issueCodes: intrinsicObjectFreeze(["INPUT_INVALID"] as const),
  });
}

function rejectDayflowVerification(
  issueCode: DayflowPreprocessedEvidenceIssueCodeV0_1,
): VerifyDayflowPreprocessedEvidenceResultV0_1 {
  return intrinsicObjectFreeze({
    valid: false,
    issueCodes: intrinsicObjectFreeze([issueCode] as const),
  });
}

function mapPrerequisiteIssueCode(
  issueCode: PreprocessedEvidenceBundlePrerequisiteIssueCodeV0_1,
): DayflowPreprocessedEvidenceIssueCodeV0_1 {
  switch (issueCode) {
    case "BUNDLE_IMPORT_REJECTED":
      return "TRANSPORT_REVERIFY_FAILED";
    case "IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH":
      return "TRANSPORT_BINDING_MISMATCH";
    case "SNAPSHOT_HANDLE_INVALID":
      return "INPUT_INVALID";
    default:
      return issueCode;
  }
}

function isFullDayflowPreprocessedEvidenceV0_1(
  candidate: AcceptedInspection["candidate"],
): candidate is DayflowPreprocessedEvidenceV0_1 {
  return dayflowPreprocessedEvidenceV0_1Schema.safeParse(candidate).success;
}

/** @internal */
export function verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
  snapshot: OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
): VerifyPreprocessedEvidenceBundlePrerequisitesResultV0_1 {
  try {
    const candidateBytes =
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      );
    const inspection =
      inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
        candidateBytes,
      );
    if (inspection.status === "rejected") {
      return reject(inspection.issueCode);
    }

    const imported =
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotForResolutionV0_1(
        snapshot,
      );

    if (!hasExactTransportBinding(inspection.candidate, imported.descriptor)) {
      return reject("TRANSPORT_BINDING_MISMATCH");
    }
    if (!hasExactResolvedManifestBinding(imported)) {
      return reject("MANIFEST_BINDING_MISMATCH");
    }
    if (
      inspection.candidate.dataOrigin !== "synthetic" ||
      inspection.candidate.studyPhase !== "contract_conformance" ||
      imported.resolvedManifest.dataOrigin !== "synthetic" ||
      imported.resolvedManifest.studyPhase !== "contract_conformance"
    ) {
      return reject("ORIGIN_PHASE_MISMATCH");
    }
    if (
      inspection.candidate.studyProtocolHash !==
      imported.resolvedManifest.studyProtocolHash
    ) {
      return reject("STUDY_PROTOCOL_MISMATCH");
    }

    const prerequisiteContext = intrinsicObjectFreeze(
      intrinsicObjectCreate(null),
    ) as OwnedPreprocessedEvidenceBundlePrerequisiteContextV0_1;
    const prerequisiteState = intrinsicObjectFreeze({
      candidate: inspection.candidate,
      imported,
      deferredIssueCodes: inspection.deferredIssueCodes,
      deferredResolvedOwners: inspection.deferredResolvedOwners,
    });
    intrinsicReflectApply(intrinsicWeakMapSet, prerequisiteStates, [
      prerequisiteContext,
      prerequisiteState,
    ]);
    return intrinsicObjectFreeze({ valid: true, prerequisiteContext });
  } catch (error) {
    if (
      error instanceof
      DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1
    ) {
      return reject(error.issueCode);
    }
    return reject("INPUT_INVALID");
  }
}

/** @internal */
export function verifyPreprocessedEvidenceBundleResolutionV0_1(
  prerequisiteContext: OwnedPreprocessedEvidenceBundlePrerequisiteContextV0_1,
): VerifyPreprocessedEvidenceBundleResolutionResultV0_1 {
  try {
    const state = readPrerequisiteState(prerequisiteContext);
    if (state === undefined) return rejectResolutionInput();

    const candidate = state.candidate;
    const manifest = state.imported.resolvedManifest;
    const flags = newResolutionIssueFlags();
    mergeDeferredIssues(flags, state.deferredIssueCodes);

    if (
      candidate.captureWindow.start !== manifest.windowStart ||
      candidate.captureWindow.end !== manifest.windowEnd
    ) {
      flags.CAPTURE_WINDOW_MISMATCH = true;
    }

    const exactCoverage = hasExactCoverage(candidate.coverage, manifest.coverage);
    if (!exactCoverage) {
      flags.COVERAGE_MISMATCH = true;
    } else {
      const resolvedCoverageCode = classifyDayflowCoverage({
        coverage: manifest.coverage,
        artifacts: manifest.artifacts,
      });
      if (resolvedCoverageCode === "failure") {
        flags.COVERAGE_FAILURE = true;
      } else if (resolvedCoverageCode !== candidate.coverageCode) {
        flags.COVERAGE_CODE_MISMATCH = true;
      }
    }

    if (hasSourceArtifactSetMismatch(candidate, state.imported)) {
      flags.SOURCE_ARTIFACT_SET_MISMATCH = true;
    }
    if (hasSourceArtifactBindingMismatch(candidate, state.imported)) {
      flags.SOURCE_ARTIFACT_BINDING_MISMATCH = true;
    }

    const issueCodes = orderedResolutionIssues(flags);
    if (issueCodes.length > 0) {
      return intrinsicObjectFreeze({
        valid: false,
        issueCodes: issueCodes as NonEmptyResolutionIssueCodesV0_1,
      });
    }
    if (!isFullDayflowPreprocessedEvidenceV0_1(candidate)) {
      return intrinsicObjectFreeze({
        valid: false,
        issueCodes: intrinsicObjectFreeze(["SCHEMA_INVALID"] as const),
      });
    }
    return intrinsicObjectFreeze({
      valid: true,
      evidence: candidate,
      issueCodes: intrinsicObjectFreeze([] as const),
    });
  } catch {
    return rejectResolutionInput();
  }
}

export function verifyDayflowPreprocessedEvidenceV0_1(
  candidateBytes: Uint8Array,
  originalBundle: ImportDayflowEvidenceBundleInput,
  expectedImportedBundleDescriptor: ImportedDayflowEvidenceBundle,
): VerifyDayflowPreprocessedEvidenceResultV0_1 {
  try {
    const snapshot =
      captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1({
        candidateBytes,
        originalBundle,
        expectedImportedBundleDescriptor,
      });
    const prerequisite =
      verifyPreprocessedEvidenceBundlePrerequisitesV0_1(snapshot);
    if (!prerequisite.valid) {
      const issueCode = prerequisite.issueCodes[0];
      return rejectDayflowVerification(
        issueCode === undefined
          ? "INPUT_INVALID"
          : mapPrerequisiteIssueCode(issueCode),
      );
    }
    return verifyPreprocessedEvidenceBundleResolutionV0_1(
      prerequisite.prerequisiteContext,
    );
  } catch (error) {
    if (
      error instanceof
      DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1
    ) {
      return rejectDayflowVerification(
        error.issueCode === "RESOURCE_LIMIT_EXCEEDED"
          ? "RESOURCE_LIMIT_EXCEEDED"
          : "INPUT_INVALID",
      );
    }
    return rejectDayflowVerification("INPUT_INVALID");
  }
}
