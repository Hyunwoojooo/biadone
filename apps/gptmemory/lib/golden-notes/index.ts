import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  CHATGPT_SHARE_ADAPTER_VERSION,
  type ChatGPTMessage,
  type ChatGPTShareImportResult,
  validateShareUrl,
} from "../chatgpt/index.ts";
import {
  NOTE_ENGINE_VERSION,
  createConversationNote,
  type ConversationFlowKind,
  type ConversationNoteDraft,
} from "../note-engine/index.ts";

export const GOLDEN_BASELINE_RUNNER_VERSION =
  "gptmemory-golden-baseline-runner.v1";
export const GOLDEN_BASELINE_REPORT_SCHEMA_VERSION =
  "gptmemory.golden-baseline-report.v2";
export const GOLDEN_BASELINE_GUARDRAIL_VERSION =
  "gptmemory-golden-baseline-guardrails.v2";

const MANIFEST_SCHEMA_VERSION = "gptmemory.golden-note-manifest.v1";
const CASE_SCHEMA_VERSION = "gptmemory.golden-note-case.v1";
const NOTE_SCHEMA_VERSION = "gptmemory.note-draft.v1";
const SUPPORTED_CUTOFF_STRATEGY = "exclude_teacher_turn";
const NOT_REVIEWED = "not_reviewed" as const;
const QUALITY_PENDING =
  "not_scored_pending_human_reference" as const;
const TITLE_SCHEMA_TOKENS = new Set([
  "author",
  "children",
  "content",
  "content_type",
  "conversation_title",
  "conversationtitle",
  "create_time",
  "createtime",
  "id",
  "linear_conversation",
  "message",
  "parent",
  "parts",
  "recipient",
  "role",
  "text",
  "title",
  "update_time",
  "updatetime",
]);
const PRIVATE_ARTIFACT_URI_PATTERN =
  /(?:file-service:\/\/|sandbox:\/?|\/mnt\/data\/|\/home\/oai\/share\/)/i;
const TEACHER_MARKER_PATTERN =
  /\[\s*(?:REFERENCE_NOTE|EVALUATION_GUIDE)\s*\]/i;
const RICH_REFERENCE_MARKER_PATTERN =
  /\uE200[a-z][a-z0-9_-]{0,63}\uE202/i;

export type GoldenCaseStatus =
  | "teacher_draft_pending_human_review"
  | "human_reference_approved"
  | "active_eval_case"
  | "retired";

export type GoldenGateStatus = "pass" | "fail" | "warning" | "blocked";
export type GoldenTechnicalStatus = "pass" | "fail" | "blocked";
export type GoldenRunMode =
  | "fixture"
  | "live_share_fetch"
  | "local_html"
  | "mixed";
export type GoldenAcquisitionMode = Exclude<GoldenRunMode, "mixed">;

export interface GoldenManifestEntry {
  id: string;
  path: string;
  status: GoldenCaseStatus;
  language: string;
  domain: string;
}

export interface GoldenManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  datasetVersion: string;
  datasetClass: "development";
  cases: GoldenManifestEntry[];
}

export interface GoldenCaptureWarning {
  code: string;
  messageIndexes?: number[];
  messageIndexRanges?: Array<{ from: number; to: number }>;
  messageCount?: number;
  handling?: string;
  notes?: string;
}

export interface GoldenNoteCase {
  schemaVersion: typeof CASE_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  language: string;
  domain: string;
  title: string;
  source: {
    type: "chatgpt_share_link";
    shareUrl: string;
    messageCountAtCapture: number;
    candidateContentSha256?: string;
    adapterObservedTitle?: string;
    titleExtractionWarning?: boolean;
    captureWarnings?: GoldenCaptureWarning[];
    alternateCaptures?: unknown[];
  };
  inputCutoff: {
    indexBase: 1;
    strategy: typeof SUPPORTED_CUTOFF_STRATEGY;
    lastIncludedMessageIndex: number;
    excludedMessageIndexes: number[];
    excludedTrailingMessageCount: number;
    teacherPromptMessageIndex: number;
    teacherPromptMessageIndexes?: number[];
    teacherResponseMessageIndex: number;
    duplicateTeacherPromptWarning?: boolean;
  };
  teacher: {
    promptVersion: string;
    promptPath: string;
    draftPath: string;
    variantDrafts?: unknown[];
  };
  humanReview: {
    status: "pending" | "approved";
    reviewPath: string;
    referencePath: string | null;
  };
  status: GoldenCaseStatus;
}

export interface GoldenDatasetCase {
  definition: GoldenNoteCase;
  manifestEntry: GoldenManifestEntry;
  caseRelativePath: string;
  caseDirectory: string;
  teacherDraftRelativePath: string;
  reviewRelativePath: string;
  referenceRelativePath: string | null;
}

export interface GoldenNoteDataset {
  rootDirectory: string;
  manifest: GoldenManifest;
  cases: GoldenDatasetCase[];
  datasetSha256: string;
}

export interface GoldenCutoffResult {
  messages: ChatGPTMessage[];
  includedSourceIndexes: number[];
  omittedUnindexedCount: number;
  filteredAfterCutoffCount: number;
  excludedMessageIds: string[];
}

export interface GoldenGate {
  id: string;
  status: GoldenGateStatus;
  details: string;
}

export interface GoldenManualQuality {
  flowPreservation: typeof NOT_REVIEWED;
  contextTransition: typeof NOT_REVIEWED;
  correctionPreservation: typeof NOT_REVIEWED;
  finalState: typeof NOT_REVIEWED;
  groundedness: typeof NOT_REVIEWED;
  readability: typeof NOT_REVIEWED;
  compression: typeof NOT_REVIEWED;
  editability: typeof NOT_REVIEWED;
}

export interface GoldenCaseReport {
  id: string;
  title: string;
  status: GoldenCaseStatus;
  acquisitionMode: GoldenAcquisitionMode;
  technicalStatus: GoldenTechnicalStatus;
  qualityStatus: typeof QUALITY_PENDING;
  verdict:
    | "technical_pass_quality_not_reviewed"
    | "technical_fail_quality_not_reviewed"
    | "technical_blocked_quality_not_reviewed";
  durationMs: number;
  reference: {
    kind: "teacher_draft" | "human_reference";
    status: "pending" | "approved";
    eligibleForQualityScore: boolean;
    path: string;
  };
  input: {
    cutoffSourceIndex: number;
    expectedSourceMessageCount: number;
    actualSourceMessageCount: number | null;
    sanitizedFullMessageCount: number | null;
    includedMessageCount: number;
    includedSourceIndexes: number[];
    omittedUnindexedCount: number;
    filteredAfterCutoffCount: number;
    canonicalSha256: string | null;
    canonicalHashScope: "adapter_title_and_cutoff_messages_v1";
    legacyCandidateDigestStatus:
      | "not_provided"
      | "legacy_unverifiable";
  };
  output: {
    candidatePath: string | null;
    schemaVersion: typeof NOTE_SCHEMA_VERSION | null;
    sha256: string | null;
    sourceMessageCount: number | null;
    userTurnCount: number | null;
    sectionCount: number | null;
  };
  diagnostics: {
    titleSource: ChatGPTShareImportResult["diagnostics"]["titleSource"] | null;
    omittedInternalCount: number | null;
    preservedEventCount: number | null;
    unsupportedContentCount: number | null;
    privateArtifactReferenceRedactedCount: number | null;
    richReferenceMarkerOmittedCount: number | null;
    warningCodes: string[];
  };
  metrics: {
    inputCharacters: number;
    noteCharacters: number;
    compressionRatio: number | null;
    userMessages: number;
    assistantMessages: number;
    eventMessages: number;
    flowKinds: Record<ConversationFlowKind, number>;
    provenanceCoverage: number | null;
  };
  gates: GoldenGate[];
  manualQuality: GoldenManualQuality;
  error: {
    code: string;
    message: string;
    retryCount: 0;
  } | null;
}

export interface GoldenBaselineReport {
  schemaVersion: typeof GOLDEN_BASELINE_REPORT_SCHEMA_VERSION;
  run: {
    runId: string;
    startedAt: string;
    completedAt: string;
    datasetVersion: string;
    datasetSha256: string;
    datasetHashScope: "manifest_and_case_metadata";
    datasetClass: "development";
    split: "selected_cases";
    adapterVersion: typeof CHATGPT_SHARE_ADAPTER_VERSION;
    noteEngineVersion: typeof NOTE_ENGINE_VERSION;
    noteSchemaVersion: typeof NOTE_SCHEMA_VERSION;
    runnerVersion: typeof GOLDEN_BASELINE_RUNNER_VERSION;
    guardrailVersion: typeof GOLDEN_BASELINE_GUARDRAIL_VERSION;
    codeCommitSha: string;
    mode: GoldenRunMode;
    provider: null;
    model: null;
    promptVersion: null;
    judgeProvider: null;
    judgeModel: null;
    concurrency: 1;
    retryCount: 0;
    timeoutMs: number;
    selectedCaseIds: string[];
    includedCaseCount: number;
    excludedCaseCount: number;
    artifactLocation: string;
    candidateBundleSha256: string;
    privacyClassification: "private_derived_evaluation_output";
  };
  totals: {
    selected: number;
    technicalPassed: number;
    technicalFailed: number;
    technicalBlocked: number;
    qualityPendingHumanReview: number;
    generatedCandidates: number;
  };
  cases: GoldenCaseReport[];
  limitations: string[];
}

export interface GoldenCaseEvaluation {
  report: GoldenCaseReport;
  candidateMarkdown: string | null;
}

export interface RunGoldenBaselineOptions {
  dataset: GoldenNoteDataset;
  importCase: (
    datasetCase: GoldenDatasetCase,
  ) => Promise<ChatGPTShareImportResult>;
  mode: GoldenRunMode;
  codeCommitSha: string;
  timeoutMs: number;
  artifactLocation: string;
  caseIds?: readonly string[];
  acquisitionModeForCase?: (
    datasetCase: GoldenDatasetCase,
  ) => GoldenAcquisitionMode;
  runId?: string;
  now?: () => Date;
}

export interface GoldenBaselineExecution {
  report: GoldenBaselineReport;
  candidates: Map<string, string>;
}

export class GoldenDatasetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoldenDatasetError";
    this.code = code;
  }
}

/** Load and validate metadata only. Teacher draft contents never enter this path. */
export async function loadGoldenNoteDataset(
  rootDirectory: string,
): Promise<GoldenNoteDataset> {
  const root = resolve(rootDirectory);
  const manifestPath = resolveInside(root, "manifest.json", "manifest path");
  const manifestValue = await readJson(manifestPath, "manifest");
  const manifest = parseManifest(manifestValue);
  const seenIds = new Set<string>();
  const cases: GoldenDatasetCase[] = [];
  const canonicalCases: GoldenNoteCase[] = [];

  for (const entry of manifest.cases) {
    if (seenIds.has(entry.id)) {
      throw new GoldenDatasetError(
        "DUPLICATE_CASE_ID",
        `Duplicate case ID in manifest: ${entry.id}`,
      );
    }
    seenIds.add(entry.id);

    const casePath = resolveInside(root, entry.path, `case path for ${entry.id}`);
    const caseValue = await readJson(casePath, `case ${entry.id}`);
    const definition = parseCase(caseValue, entry.id);
    validateManifestCaseConsistency(entry, definition);
    validateCutoff(definition);

    const caseDirectory = dirname(casePath);
    const teacherDraftPath = resolveInside(
      root,
      relative(root, resolve(caseDirectory, definition.teacher.draftPath)),
      `teacher draft path for ${entry.id}`,
    );
    const promptPath = resolveInside(
      root,
      relative(root, resolve(caseDirectory, definition.teacher.promptPath)),
      `teacher prompt path for ${entry.id}`,
    );
    const reviewPath = resolveInside(
      root,
      relative(root, resolve(caseDirectory, definition.humanReview.reviewPath)),
      `review path for ${entry.id}`,
    );
    await Promise.all([
      access(teacherDraftPath),
      access(promptPath),
      access(reviewPath),
      ...collectVariantDraftPaths(definition).map((variantPath) =>
        access(
          resolveInside(
            root,
            relative(root, resolve(caseDirectory, variantPath)),
            `variant teacher draft path for ${entry.id}`,
          ),
        ),
      ),
    ]);

    let referenceRelativePath: string | null = null;
    if (definition.humanReview.referencePath) {
      const referencePath = resolveInside(
        root,
        relative(
          root,
          resolve(caseDirectory, definition.humanReview.referencePath),
        ),
        `human reference path for ${entry.id}`,
      );
      await access(referencePath);
      referenceRelativePath = normalizeRelativePath(relative(root, referencePath));
    }

    cases.push({
      definition,
      manifestEntry: entry,
      caseRelativePath: normalizeRelativePath(relative(root, casePath)),
      caseDirectory,
      teacherDraftRelativePath: normalizeRelativePath(
        relative(root, teacherDraftPath),
      ),
      reviewRelativePath: normalizeRelativePath(relative(root, reviewPath)),
      referenceRelativePath,
    });
    canonicalCases.push(definition);
  }

  return {
    rootDirectory: root,
    manifest,
    cases,
    datasetSha256: sha256(
      stableStringify({ manifest, cases: canonicalCases }),
    ),
  };
}

/**
 * Apply the historical v1-compatible cutoff. Sanitized array positions and
 * message.index are deliberately ignored because internal calls create gaps.
 */
export function applyGoldenInputCutoff(
  messages: readonly ChatGPTMessage[],
  lastIncludedSourceIndex: number,
): GoldenCutoffResult {
  if (!Number.isInteger(lastIncludedSourceIndex) || lastIncludedSourceIndex < 1) {
    throw new GoldenDatasetError(
      "INVALID_CUTOFF",
      "The Golden cutoff must be a positive 1-based source index.",
    );
  }

  const included: ChatGPTMessage[] = [];
  const includedSourceIndexes = new Set<number>();
  const excludedMessageIds: string[] = [];
  let omittedUnindexedCount = 0;
  let filteredAfterCutoffCount = 0;

  for (const message of messages) {
    if (
      message.sourceIndex === null ||
      !Number.isInteger(message.sourceIndex) ||
      message.sourceIndex < 1
    ) {
      omittedUnindexedCount += 1;
      excludedMessageIds.push(message.id);
      continue;
    }
    if (message.sourceIndex > lastIncludedSourceIndex) {
      filteredAfterCutoffCount += 1;
      excludedMessageIds.push(message.id);
      continue;
    }
    included.push(message);
    includedSourceIndexes.add(message.sourceIndex);
  }

  return {
    messages: included,
    includedSourceIndexes: [...includedSourceIndexes].sort((a, b) => a - b),
    omittedUnindexedCount,
    filteredAfterCutoffCount,
    excludedMessageIds,
  };
}

/** Evaluate technical integrity only. Semantic note quality remains human-reviewed. */
export function evaluateGoldenCase(
  datasetCase: GoldenDatasetCase,
  imported: ChatGPTShareImportResult,
  durationMs = 0,
  acquisitionMode: GoldenAcquisitionMode = "fixture",
): GoldenCaseEvaluation {
  const definition = datasetCase.definition;
  const gates: GoldenGate[] = [
    gate("dataset.manifest_case_consistency", "pass", "Validated while loading."),
    gate("cutoff.metadata", "pass", "The 1-based Teacher exclusion is contiguous and valid."),
    gate("source.fetch", "pass", "The configured conversation source was restored."),
  ];
  const base = baseCaseReport(datasetCase, durationMs, acquisitionMode);
  base.input.actualSourceMessageCount = imported.diagnostics.sourceMessageCount;
  base.input.sanitizedFullMessageCount = imported.conversation.messages.length;
  base.diagnostics = {
    titleSource: imported.diagnostics.titleSource,
    omittedInternalCount: imported.diagnostics.omittedInternalCount,
    preservedEventCount: imported.diagnostics.preservedEventCount,
    unsupportedContentCount: imported.diagnostics.unsupportedContentCount,
    privateArtifactReferenceRedactedCount:
      imported.diagnostics.privateArtifactReferenceRedactedCount,
    richReferenceMarkerOmittedCount:
      imported.diagnostics.richReferenceMarkerOmittedCount,
    warningCodes: imported.warnings.map((warning) => warning.code),
  };
  const expectedSource = validateShareUrl(definition.source.shareUrl);
  const sourceIdentityMatches =
    expectedSource.valid &&
    imported.source.normalizedUrl === expectedSource.normalizedUrl &&
    imported.source.shareId === expectedSource.shareId;
  gates.push(
    gate(
      "source.adapter_version",
      imported.source.adapterVersion === CHATGPT_SHARE_ADAPTER_VERSION
        ? "pass"
        : "fail",
      imported.source.adapterVersion === CHATGPT_SHARE_ADAPTER_VERSION
        ? `The import used ${CHATGPT_SHARE_ADAPTER_VERSION}.`
        : "The import did not use the runner's declared adapter version.",
    ),
    gate(
      "source.identity",
      sourceIdentityMatches ? "pass" : "fail",
      sourceIdentityMatches
        ? "The imported share ID matches the case metadata."
        : "The imported source identity differs from the selected Golden case.",
    ),
  );

  if (
    imported.diagnostics.sourceMessageCount !==
    definition.source.messageCountAtCapture
  ) {
    gates.push(
      gate(
        "source.capture_count_match",
        "blocked",
        `Expected ${definition.source.messageCountAtCapture} source messages but restored ${imported.diagnostics.sourceMessageCount}; the share may have drifted.`,
      ),
    );
    base.gates = gates;
    base.technicalStatus = "blocked";
    base.verdict = "technical_blocked_quality_not_reviewed";
    base.error = {
      code: "SOURCE_DRIFT",
      message: "The restored source count differs from the captured Golden metadata.",
      retryCount: 0,
    };
    return { report: base, candidateMarkdown: null };
  }

  gates.push(
    gate(
      "source.capture_count_match",
      "pass",
      `Restored all ${definition.source.messageCountAtCapture} source messages.`,
    ),
    gate(
      "source.content_identity_unverified",
      "warning",
      "The v2 canonical input digest is recorded for review but has not been human-approved and pinned in case metadata.",
    ),
  );

  const importedTitle = imported.conversation.title?.trim().toLowerCase() ?? "";
  gates.push(
    TITLE_SCHEMA_TOKENS.has(importedTitle)
      ? gate(
          "source.title_not_schema_token",
          "fail",
          "The restored title is a known payload schema token.",
        )
      : gate(
          "source.title_not_schema_token",
          "pass",
          importedTitle
            ? `The adapter supplied a non-schema title via ${imported.diagnostics.titleSource}.`
            : "No imported title was supplied; the note engine will use the first user turn.",
        ),
  );

  const cutoff = applyGoldenInputCutoff(
    imported.conversation.messages,
    definition.inputCutoff.lastIncludedMessageIndex,
  );
  base.input.includedMessageCount = cutoff.messages.length;
  base.input.includedSourceIndexes = cutoff.includedSourceIndexes;
  base.input.omittedUnindexedCount = cutoff.omittedUnindexedCount;
  base.input.filteredAfterCutoffCount = cutoff.filteredAfterCutoffCount;
  base.input.canonicalSha256 = canonicalInputDigest(
    imported.conversation.title,
    cutoff.messages,
  );

  const observedSourceIndexes = new Set(
    imported.conversation.messages.flatMap((message) =>
      message.sourceIndex === null ? [] : [message.sourceIndex],
    ),
  );
  const missingDeclaredExcludedIndexes =
    definition.inputCutoff.excludedMessageIndexes.filter(
      (index) => !observedSourceIndexes.has(index),
    );
  gates.push(
    gate(
      "input.declared_teacher_turns_observed",
      missingDeclaredExcludedIndexes.length === 0 ? "pass" : "fail",
      missingDeclaredExcludedIndexes.length === 0
        ? `Observed all ${definition.inputCutoff.excludedMessageIndexes.length} declared post-cutoff Teacher source index(es) before filtering.`
        : `${missingDeclaredExcludedIndexes.length} declared post-cutoff Teacher source index(es) were absent from sanitized adapter output.`,
    ),
  );

  const allWithinCutoff = cutoff.messages.every(
    (message) =>
      message.sourceIndex !== null &&
      message.sourceIndex <= definition.inputCutoff.lastIncludedMessageIndex,
  );
  gates.push(
    gate(
      "input.all_source_indexes_within_cutoff",
      allWithinCutoff ? "pass" : "fail",
      allWithinCutoff
        ? `All included items are at or before source index ${definition.inputCutoff.lastIncludedMessageIndex}.`
        : "At least one included item is beyond the Teacher cutoff.",
    ),
  );
  gates.push(
    gate(
      "input.unindexed_items_fail_closed",
      cutoff.omittedUnindexedCount > 0 ? "warning" : "pass",
      cutoff.omittedUnindexedCount > 0
        ? `Omitted ${cutoff.omittedUnindexedCount} item(s) without a source index.`
        : "No unindexed items were present.",
    ),
  );
  gates.push(
    gate(
      "input.nonempty",
      cutoff.messages.length > 0 ? "pass" : "fail",
      `Included ${cutoff.messages.length} sanitized message/event item(s).`,
    ),
  );
  const userMessages = cutoff.messages.filter((message) => message.role === "user");
  gates.push(
    gate(
      "input.has_user",
      userMessages.length > 0 ? "pass" : "fail",
      `Included ${userMessages.length} user message(s).`,
    ),
  );
  const uniqueMessageIds = new Set(cutoff.messages.map((message) => message.id));
  gates.push(
    gate(
      "input.unique_message_ids",
      uniqueMessageIds.size === cutoff.messages.length ? "pass" : "fail",
      uniqueMessageIds.size === cutoff.messages.length
        ? "All included message IDs are unique."
        : "Duplicate message IDs would break note provenance.",
    ),
  );

  const knownInternalIndexes = collectKnownInternalSourceIndexes(definition);
  const retainedKnownInternalText = cutoff.messages.filter(
    (message) =>
      message.kind === "text" &&
      message.sourceIndex !== null &&
      knownInternalIndexes.has(message.sourceIndex),
  );
  gates.push(
    gate(
      "input.known_internal_text_omitted",
      retainedKnownInternalText.length === 0 ? "pass" : "fail",
      retainedKnownInternalText.length === 0
        ? `No text survived at ${knownInternalIndexes.size} historical internal-call source index(es).`
        : `${retainedKnownInternalText.length} known internal-call text item(s) survived sanitization.`,
    ),
  );

  const hardInputFailure = gates.some((item) => item.status === "fail");
  if (hardInputFailure) {
    base.gates = gates;
    base.technicalStatus = "fail";
    base.verdict = "technical_fail_quality_not_reviewed";
    base.error = {
      code: "INPUT_GUARDRAIL_FAILED",
      message: "The sanitized Golden input did not pass technical guardrails.",
      retryCount: 0,
    };
    return { report: base, candidateMarkdown: null };
  }

  let draft: ConversationNoteDraft;
  try {
    draft = createConversationNote({
      title: imported.conversation.title,
      messages: cutoff.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      })),
      source: {
        type: "chatgpt_share_link",
        originalUrl: imported.source.originalUrl,
        normalizedUrl: imported.source.normalizedUrl,
        shareId: imported.source.shareId,
      },
    });
    gates.push(gate("output.generated", "pass", "The deterministic note was generated."));
  } catch (error) {
    gates.push(gate("output.generated", "fail", "The deterministic note engine rejected the input."));
    base.gates = gates;
    base.technicalStatus = "fail";
    base.verdict = "technical_fail_quality_not_reviewed";
    base.error = sanitizedError(error, "NOTE_GENERATION_FAILED");
    return { report: base, candidateMarkdown: null };
  }

  const candidateMarkdown = renderConversationNoteMarkdown(draft);
  const candidateIdSet = new Set(cutoff.messages.map((message) => message.id));
  const outputSourceIds = draft.source.messageIds;
  const outputSourceIdSet = new Set(outputSourceIds);
  const sectionSourceIds = draft.sections.flatMap(
    (section) => section.sourceMessageIds,
  );
  const sectionSourceIdSet = new Set(sectionSourceIds);
  const exactSectionProvenance =
    sectionSourceIds.length === candidateIdSet.size &&
    sectionSourceIdSet.size === candidateIdSet.size &&
    sectionSourceIds.every((id) => candidateIdSet.has(id));
  const exactSourceCoverage =
    outputSourceIds.length === candidateIdSet.size &&
    outputSourceIdSet.size === candidateIdSet.size &&
    outputSourceIds.every((id) => candidateIdSet.has(id));
  const excludedIdsAbsent = cutoff.excludedMessageIds.every(
    (id) => !outputSourceIdSet.has(id),
  );

  gates.push(
    gate(
      "output.schema_version",
      draft.schemaVersion === NOTE_SCHEMA_VERSION ? "pass" : "fail",
      `Generated ${draft.schemaVersion}.`,
    ),
    gate(
      "output.required_fields_nonempty",
      draft.title.trim() && draft.overview.trim() && draft.closingState.trim()
        ? "pass"
        : "fail",
      "Title, overview, and closing state were checked.",
    ),
    gate(
      "output.provenance_subset_of_candidate",
      exactSectionProvenance ? "pass" : "fail",
      exactSectionProvenance
        ? "Sections cover every cutoff item exactly once."
        : "Section provenance is missing, duplicating, or referencing a cutoff item incorrectly.",
    ),
    gate(
      "output.source_coverage_exact",
      exactSourceCoverage ? "pass" : "fail",
      exactSourceCoverage
        ? `The note source covers all ${candidateIdSet.size} cutoff items exactly once in its source summary.`
        : "The note source summary does not exactly cover the cutoff input.",
    ),
    gate(
      "output.excluded_ids_absent",
      excludedIdsAbsent ? "pass" : "fail",
      excludedIdsAbsent
        ? "No post-cutoff or unindexed message ID appears in the note source."
        : "An excluded message ID appears in the generated note.",
    ),
    gate(
      "output.no_private_artifact_uri",
      PRIVATE_ARTIFACT_URI_PATTERN.test(candidateMarkdown) ? "fail" : "pass",
      PRIVATE_ARTIFACT_URI_PATTERN.test(candidateMarkdown)
        ? "A private artifact URI pattern survived into the note."
        : "No private artifact URI pattern was found.",
    ),
    gate(
      "output.no_rich_reference_marker",
      RICH_REFERENCE_MARKER_PATTERN.test(candidateMarkdown) ? "fail" : "pass",
      RICH_REFERENCE_MARKER_PATTERN.test(candidateMarkdown)
        ? "A ChatGPT internal rich-reference marker survived into the note."
        : "No ChatGPT internal rich-reference marker was found.",
    ),
    gate(
      "output.teacher_markers_absent",
      TEACHER_MARKER_PATTERN.test(candidateMarkdown) ? "fail" : "pass",
      TEACHER_MARKER_PATTERN.test(candidateMarkdown)
        ? "A Teacher reference marker appears in the candidate note."
        : "No Teacher reference marker appears in the candidate note.",
    ),
  );

  const inputCharacters = cutoff.messages.reduce(
    (total, message) => total + message.text.length,
    0,
  );
  const noteCharacters = candidateMarkdown.length;
  const flowKinds = emptyFlowKindCounts();
  for (const section of draft.sections) {
    flowKinds[section.flowKind] += 1;
  }
  const coveredIds = new Set(sectionSourceIds.filter((id) => candidateIdSet.has(id)));
  base.metrics = {
    inputCharacters,
    noteCharacters,
    compressionRatio:
      inputCharacters > 0
        ? roundedRatio(noteCharacters / inputCharacters)
        : null,
    userMessages: userMessages.length,
    assistantMessages: cutoff.messages.filter(
      (message) => message.role === "assistant",
    ).length,
    eventMessages: cutoff.messages.filter((message) => message.kind === "event")
      .length,
    flowKinds,
    provenanceCoverage:
      candidateIdSet.size > 0
        ? roundedRatio(coveredIds.size / candidateIdSet.size)
        : null,
  };
  base.output = {
    candidatePath: `candidates/${definition.id}.md`,
    schemaVersion: draft.schemaVersion,
    sha256: sha256(candidateMarkdown),
    sourceMessageCount: draft.source.messageCount,
    userTurnCount: draft.source.userTurnCount,
    sectionCount: draft.sections.length,
  };
  base.gates = gates;
  base.technicalStatus = gates.some((item) => item.status === "fail")
    ? "fail"
    : "pass";
  base.verdict =
    base.technicalStatus === "pass"
      ? "technical_pass_quality_not_reviewed"
      : "technical_fail_quality_not_reviewed";
  if (base.technicalStatus === "fail") {
    base.output.candidatePath = null;
    base.error = {
      code: "OUTPUT_GUARDRAIL_FAILED",
      message: "The generated note did not pass technical output guardrails.",
      retryCount: 0,
    };
  }

  return {
    report: base,
    candidateMarkdown:
      base.technicalStatus === "pass" ? candidateMarkdown : null,
  };
}

export async function runGoldenBaseline(
  options: RunGoldenBaselineOptions,
): Promise<GoldenBaselineExecution> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = options.runId ?? createRunId(startedAt);
  const selectedCases = selectCases(options.dataset, options.caseIds);
  const caseReports: GoldenCaseReport[] = [];
  const candidates = new Map<string, string>();

  for (const datasetCase of selectedCases) {
    const started = performance.now();
    const acquisitionMode = acquisitionModeFor(
      options,
      datasetCase,
    );
    try {
      const imported = await options.importCase(datasetCase);
      const evaluated = evaluateGoldenCase(
        datasetCase,
        imported,
        roundedMilliseconds(performance.now() - started),
        acquisitionMode,
      );
      caseReports.push(evaluated.report);
      if (evaluated.candidateMarkdown) {
        candidates.set(datasetCase.definition.id, evaluated.candidateMarkdown);
      }
    } catch (error) {
      const report = baseCaseReport(
        datasetCase,
        roundedMilliseconds(performance.now() - started),
        acquisitionMode,
      );
      report.technicalStatus = "blocked";
      report.verdict = "technical_blocked_quality_not_reviewed";
      report.gates = [
        gate(
          "source.fetch",
          "blocked",
          "The share could not be restored, so no candidate note was generated.",
        ),
      ];
      report.error = sanitizedError(error, "SOURCE_FETCH_FAILED");
      caseReports.push(report);
    }
  }

  const completedAt = now().toISOString();
  const candidateBundleSha256 = sha256(
    stableStringify(
      [...candidates.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, markdown]) => ({ id, sha256: sha256(markdown) })),
    ),
  );
  const report: GoldenBaselineReport = {
    schemaVersion: GOLDEN_BASELINE_REPORT_SCHEMA_VERSION,
    run: {
      runId,
      startedAt,
      completedAt,
      datasetVersion: options.dataset.manifest.datasetVersion,
      datasetSha256: options.dataset.datasetSha256,
      datasetHashScope: "manifest_and_case_metadata",
      datasetClass: options.dataset.manifest.datasetClass,
      split: "selected_cases",
      adapterVersion: CHATGPT_SHARE_ADAPTER_VERSION,
      noteEngineVersion: NOTE_ENGINE_VERSION,
      noteSchemaVersion: NOTE_SCHEMA_VERSION,
      runnerVersion: GOLDEN_BASELINE_RUNNER_VERSION,
      guardrailVersion: GOLDEN_BASELINE_GUARDRAIL_VERSION,
      codeCommitSha: options.codeCommitSha,
      mode: options.mode,
      provider: null,
      model: null,
      promptVersion: null,
      judgeProvider: null,
      judgeModel: null,
      concurrency: 1,
      retryCount: 0,
      timeoutMs: options.timeoutMs,
      selectedCaseIds: selectedCases.map((item) => item.definition.id),
      includedCaseCount: selectedCases.length,
      excludedCaseCount: options.dataset.cases.length - selectedCases.length,
      artifactLocation: options.artifactLocation,
      candidateBundleSha256,
      privacyClassification: "private_derived_evaluation_output",
    },
    totals: {
      selected: caseReports.length,
      technicalPassed: caseReports.filter(
        (item) => item.technicalStatus === "pass",
      ).length,
      technicalFailed: caseReports.filter(
        (item) => item.technicalStatus === "fail",
      ).length,
      technicalBlocked: caseReports.filter(
        (item) => item.technicalStatus === "blocked",
      ).length,
      qualityPendingHumanReview: caseReports.length,
      generatedCandidates: candidates.size,
    },
    cases: caseReports,
    limitations: [
      "All current references are unapproved Teacher drafts, so semantic quality is not scored.",
      "Compression and flow counts are diagnostics, not evidence that a note is correct.",
      "The deterministic baseline does not call an LLM and intentionally preserves source wording.",
      "Legacy candidateContentSha256 values predate adapter v2 and are not used as hard gates.",
      "datasetSha256 covers manifest and case metadata; unapproved Teacher draft contents are not used by this baseline.",
    ],
  };

  return { report, candidates };
}

export function renderConversationNoteMarkdown(
  draft: ConversationNoteDraft,
): string {
  const lines = [`# ${draft.title}`, "", draft.overview];
  draft.sections.forEach((section, index) => {
    lines.push(
      "",
      `## ${String(index + 1).padStart(2, "0")}. ${section.heading}`,
      "",
      section.body,
    );
  });
  lines.push("", "## 현재 도달한 상태", "", draft.closingState, "");
  return lines.join("\n");
}

export function renderGoldenBaselineSummary(
  report: GoldenBaselineReport,
): string {
  const lines = [
    "# Golden Note Baseline",
    "",
    `- Run ID: \`${report.run.runId}\``,
    `- Dataset: \`${report.run.datasetVersion}\``,
    `- Dataset SHA-256: \`${report.run.datasetSha256}\``,
    `- Code commit: \`${report.run.codeCommitSha}\``,
    `- Adapter: \`${report.run.adapterVersion}\``,
    `- Note engine: \`${report.run.noteEngineVersion}\``,
    `- Technical pass / fail / blocked: ${report.totals.technicalPassed} / ${report.totals.technicalFailed} / ${report.totals.technicalBlocked}`,
    "- Semantic quality: not scored; human references are still pending.",
    "",
    "Technical pass means only that cutoff, provenance, sanitization, and output contracts held. It does not mean the note is a good summary.",
    "",
    "## Cases",
    "",
    "| Case | Technical | Candidate | Reference metadata | Compression |",
    "|---|---:|---|---|---:|",
  ];

  for (const item of report.cases) {
    const candidate = item.output.candidatePath
      ? `[candidate](${item.output.candidatePath})`
      : "—";
    const compression =
      item.metrics.compressionRatio === null
        ? "—"
        : item.metrics.compressionRatio.toFixed(3);
    const reference = `\`${item.reference.path}\` (${item.reference.status})`;
    lines.push(
      `| ${escapeTableCell(item.title)} | ${item.technicalStatus} | ${candidate} | ${reference} | ${compression} |`,
    );
  }

  lines.push(
    "",
    "## Human review still required",
    "",
    "Compare each generated candidate with its repository Teacher draft and the original conversation. Record corrections in the case review file before promoting any reference.",
    "",
    "> These artifacts may contain derived private conversation content. Keep them under the ignored `outputs/` directory or another approved private store.",
    "",
  );
  return lines.join("\n");
}

/** Write a complete run via a sibling temporary directory, then rename once. */
export async function writeGoldenBaselineArtifacts(
  execution: GoldenBaselineExecution,
  outputDirectory: string,
): Promise<void> {
  const approvedCandidateIds = new Set(
    execution.report.cases
      .filter(
        (item) =>
          item.technicalStatus === "pass" && item.output.candidatePath !== null,
      )
      .map((item) => item.id),
  );
  if (approvedCandidateIds.size !== execution.candidates.size) {
    throw new GoldenDatasetError(
      "OUTPUT_CANDIDATE_SET_MISMATCH",
      "The candidate map does not exactly match technical-pass report cases.",
    );
  }
  for (const caseId of execution.candidates.keys()) {
    if (!approvedCandidateIds.has(caseId)) {
      throw new GoldenDatasetError(
        "OUTPUT_CANDIDATE_NOT_APPROVED",
        `Refusing to persist a candidate that did not pass guardrails: ${caseId}`,
      );
    }
    const caseReport = execution.report.cases.find(
      (item) => item.id === caseId,
    );
    const candidate = execution.candidates.get(caseId);
    if (
      !caseReport ||
      candidate === undefined ||
      caseReport.output.sha256 !== sha256(candidate)
    ) {
      throw new GoldenDatasetError(
        "OUTPUT_CANDIDATE_HASH_MISMATCH",
        `Candidate content does not match its report digest: ${caseId}`,
      );
    }
  }
  const target = resolve(outputDirectory);
  const parent = dirname(target);
  const temporary = resolve(
    parent,
    `.${basename(target)}.tmp-${randomUUID()}`,
  );
  if (!temporary.startsWith(`${parent}${sep}`)) {
    throw new GoldenDatasetError(
      "UNSAFE_OUTPUT_PATH",
      "The temporary output directory escaped its parent.",
    );
  }

  try {
    await access(target);
    throw new GoldenDatasetError(
      "OUTPUT_EXISTS",
      `Refusing to overwrite an existing evaluation directory: ${target}`,
    );
  } catch (error) {
    if (error instanceof GoldenDatasetError) throw error;
    if (!isNotFoundError(error)) throw error;
  }

  await mkdir(resolve(temporary, "candidates"), {
    recursive: true,
    mode: 0o700,
  });
  try {
    for (const [caseId, markdown] of execution.candidates) {
      await writeFile(
        resolve(temporary, "candidates", `${safeArtifactName(caseId)}.md`),
        markdown,
        { encoding: "utf8", mode: 0o600 },
      );
    }
    await Promise.all([
      writeFile(
        resolve(temporary, "report.json"),
        `${JSON.stringify(execution.report, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      ),
      writeFile(
        resolve(temporary, "summary.md"),
        renderGoldenBaselineSummary(execution.report),
        { encoding: "utf8", mode: 0o600 },
      ),
    ]);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function parseManifest(value: unknown): GoldenManifest {
  const record = requireRecord(value, "manifest");
  const schemaVersion = requireString(record.schemaVersion, "manifest.schemaVersion");
  if (schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new GoldenDatasetError(
      "UNSUPPORTED_MANIFEST_SCHEMA",
      `Unsupported manifest schema: ${schemaVersion}`,
    );
  }
  const datasetVersion = requireString(
    record.datasetVersion,
    "manifest.datasetVersion",
  );
  if (record.datasetClass !== "development") {
    throw new GoldenDatasetError(
      "UNSUPPORTED_DATASET_CLASS",
      "The current Golden Note manifest must be an unapproved development dataset.",
    );
  }
  if (!Array.isArray(record.cases) || record.cases.length === 0) {
    throw new GoldenDatasetError(
      "INVALID_MANIFEST",
      "manifest.cases must be a non-empty array.",
    );
  }
  const cases = record.cases.map((entry, index) => {
    const item = requireRecord(entry, `manifest.cases[${index}]`);
    return {
      id: requireSafeId(item.id, `manifest.cases[${index}].id`),
      path: requireString(item.path, `manifest.cases[${index}].path`),
      status: requireCaseStatus(item.status, `manifest.cases[${index}].status`),
      language: requireString(item.language, `manifest.cases[${index}].language`),
      domain: requireString(item.domain, `manifest.cases[${index}].domain`),
    };
  });
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    datasetVersion,
    datasetClass: "development",
    cases,
  };
}

function parseCase(value: unknown, expectedId: string): GoldenNoteCase {
  const record = requireRecord(value, `case ${expectedId}`);
  const schemaVersion = requireString(record.schemaVersion, `${expectedId}.schemaVersion`);
  if (schemaVersion !== CASE_SCHEMA_VERSION) {
    throw new GoldenDatasetError(
      "UNSUPPORTED_CASE_SCHEMA",
      `Unsupported case schema for ${expectedId}: ${schemaVersion}`,
    );
  }
  const source = requireRecord(record.source, `${expectedId}.source`);
  const cutoff = requireRecord(record.inputCutoff, `${expectedId}.inputCutoff`);
  const teacher = requireRecord(record.teacher, `${expectedId}.teacher`);
  const humanReview = requireRecord(record.humanReview, `${expectedId}.humanReview`);
  const captureWarnings = parseCaptureWarnings(
    source.captureWarnings,
    `${expectedId}.source.captureWarnings`,
  );
  const indexBase = requirePositiveInteger(
    cutoff.indexBase,
    `${expectedId}.inputCutoff.indexBase`,
  );
  const strategy = requireString(
    cutoff.strategy,
    `${expectedId}.inputCutoff.strategy`,
  );
  const sourceType = requireString(source.type, `${expectedId}.source.type`);
  if (sourceType !== "chatgpt_share_link") {
    throw new GoldenDatasetError(
      "UNSUPPORTED_SOURCE_TYPE",
      `Unsupported source type for ${expectedId}: ${sourceType}`,
    );
  }
  if (indexBase !== 1 || strategy !== SUPPORTED_CUTOFF_STRATEGY) {
    throw new GoldenDatasetError(
      "UNSUPPORTED_CUTOFF",
      `${expectedId} must use 1-based ${SUPPORTED_CUTOFF_STRATEGY}.`,
    );
  }
  const reviewStatus = requireString(
    humanReview.status,
    `${expectedId}.humanReview.status`,
  );
  if (reviewStatus !== "pending" && reviewStatus !== "approved") {
    throw new GoldenDatasetError(
      "INVALID_REVIEW_STATUS",
      `Unsupported human review status for ${expectedId}: ${reviewStatus}`,
    );
  }
  const referencePath = optionalNullableString(
    humanReview.referencePath,
    `${expectedId}.humanReview.referencePath`,
  );
  const caseStatus = requireCaseStatus(record.status, `${expectedId}.status`);
  const requiresApprovedReference =
    caseStatus === "human_reference_approved" ||
    caseStatus === "active_eval_case";
  if (
    (reviewStatus === "pending" && referencePath !== null) ||
    (reviewStatus === "approved" && referencePath === null) ||
    (requiresApprovedReference &&
      (reviewStatus !== "approved" || referencePath === null)) ||
    (caseStatus === "teacher_draft_pending_human_review" &&
      reviewStatus !== "pending")
  ) {
    throw new GoldenDatasetError(
      "INCONSISTENT_REFERENCE_STATUS",
      `${expectedId} has inconsistent case, human-review, and reference states.`,
    );
  }

  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    id: requireSafeId(record.id, `${expectedId}.id`),
    createdAt: requireString(record.createdAt, `${expectedId}.createdAt`),
    language: requireString(record.language, `${expectedId}.language`),
    domain: requireString(record.domain, `${expectedId}.domain`),
    title: requireString(record.title, `${expectedId}.title`),
    source: {
      type: "chatgpt_share_link",
      shareUrl: requireString(source.shareUrl, `${expectedId}.source.shareUrl`),
      messageCountAtCapture: requirePositiveInteger(
        source.messageCountAtCapture,
        `${expectedId}.source.messageCountAtCapture`,
      ),
      candidateContentSha256: optionalString(source.candidateContentSha256),
      adapterObservedTitle: optionalString(source.adapterObservedTitle),
      titleExtractionWarning: optionalBoolean(source.titleExtractionWarning),
      captureWarnings,
      alternateCaptures: Array.isArray(source.alternateCaptures)
        ? source.alternateCaptures
        : undefined,
    },
    inputCutoff: {
      indexBase: 1,
      strategy: SUPPORTED_CUTOFF_STRATEGY,
      lastIncludedMessageIndex: requirePositiveInteger(
        cutoff.lastIncludedMessageIndex,
        `${expectedId}.inputCutoff.lastIncludedMessageIndex`,
      ),
      excludedMessageIndexes: requireIntegerArray(
        cutoff.excludedMessageIndexes,
        `${expectedId}.inputCutoff.excludedMessageIndexes`,
      ),
      excludedTrailingMessageCount: requirePositiveInteger(
        cutoff.excludedTrailingMessageCount,
        `${expectedId}.inputCutoff.excludedTrailingMessageCount`,
      ),
      teacherPromptMessageIndex: requirePositiveInteger(
        cutoff.teacherPromptMessageIndex,
        `${expectedId}.inputCutoff.teacherPromptMessageIndex`,
      ),
      teacherPromptMessageIndexes: optionalIntegerArray(
        cutoff.teacherPromptMessageIndexes,
        `${expectedId}.inputCutoff.teacherPromptMessageIndexes`,
      ),
      teacherResponseMessageIndex: requirePositiveInteger(
        cutoff.teacherResponseMessageIndex,
        `${expectedId}.inputCutoff.teacherResponseMessageIndex`,
      ),
      duplicateTeacherPromptWarning: optionalBoolean(
        cutoff.duplicateTeacherPromptWarning,
      ),
    },
    teacher: {
      promptVersion: requireString(
        teacher.promptVersion,
        `${expectedId}.teacher.promptVersion`,
      ),
      promptPath: requireString(
        teacher.promptPath,
        `${expectedId}.teacher.promptPath`,
      ),
      draftPath: requireString(
        teacher.draftPath,
        `${expectedId}.teacher.draftPath`,
      ),
      variantDrafts: Array.isArray(teacher.variantDrafts)
        ? teacher.variantDrafts
        : undefined,
    },
    humanReview: {
      status: reviewStatus,
      reviewPath: requireString(
        humanReview.reviewPath,
        `${expectedId}.humanReview.reviewPath`,
      ),
      referencePath,
    },
    status: caseStatus,
  };
}

function validateManifestCaseConsistency(
  entry: GoldenManifestEntry,
  definition: GoldenNoteCase,
): void {
  const mismatches = [
    ["id", entry.id, definition.id],
    ["status", entry.status, definition.status],
    ["language", entry.language, definition.language],
    ["domain", entry.domain, definition.domain],
  ].filter(([, manifestValue, caseValue]) => manifestValue !== caseValue);
  if (mismatches.length > 0) {
    throw new GoldenDatasetError(
      "MANIFEST_CASE_MISMATCH",
      `${entry.id} differs between manifest and case: ${mismatches
        .map(([field]) => field)
        .join(", ")}`,
    );
  }
}

function validateCutoff(definition: GoldenNoteCase): void {
  const cutoff = definition.inputCutoff;
  if (definition.source.messageCountAtCapture > 100_000) {
    throw new GoldenDatasetError(
      "SOURCE_COUNT_TOO_LARGE",
      `${definition.id} exceeds the Golden source-message safety limit.`,
    );
  }
  const expectedExcludedCount =
    definition.source.messageCountAtCapture -
    cutoff.lastIncludedMessageIndex;
  const contiguousExclusion =
    expectedExcludedCount > 0 &&
    cutoff.excludedMessageIndexes.length === expectedExcludedCount &&
    cutoff.excludedMessageIndexes.every(
      (value, index) =>
        value === cutoff.lastIncludedMessageIndex + index + 1,
    );
  if (!contiguousExclusion) {
    throw new GoldenDatasetError(
      "NONCONTIGUOUS_TEACHER_EXCLUSION",
      `${definition.id} must exclude every source index after its cutoff.`,
    );
  }
  if (cutoff.excludedTrailingMessageCount !== expectedExcludedCount) {
    throw new GoldenDatasetError(
      "INVALID_EXCLUDED_COUNT",
      `${definition.id} excludedTrailingMessageCount does not match its indexes.`,
    );
  }
  const promptIndexes =
    cutoff.teacherPromptMessageIndexes ?? [cutoff.teacherPromptMessageIndex];
  const uniquePromptIndexes = [...new Set(promptIndexes)];
  const teacherIndexes = [
    ...uniquePromptIndexes,
    cutoff.teacherResponseMessageIndex,
  ].sort((left, right) => left - right);
  if (
    !promptIndexes.includes(cutoff.teacherPromptMessageIndex) ||
    cutoff.teacherPromptMessageIndex !== Math.max(...uniquePromptIndexes) ||
    cutoff.teacherResponseMessageIndex <= cutoff.teacherPromptMessageIndex ||
    !sameIntegerArray(teacherIndexes, cutoff.excludedMessageIndexes) ||
    (uniquePromptIndexes.length > 1) !==
      (cutoff.duplicateTeacherPromptWarning === true)
  ) {
    throw new GoldenDatasetError(
      "TEACHER_INDEX_INSIDE_INPUT",
      `${definition.id} has a Teacher index inside the candidate input.`,
    );
  }

  for (const warning of definition.source.captureWarnings ?? []) {
    const warnedIndexes = new Set<number>();
    for (const index of warning.messageIndexes ?? []) {
      if (index > definition.source.messageCountAtCapture) {
        throw new GoldenDatasetError(
          "INVALID_CAPTURE_WARNING",
          `${definition.id} has a capture warning index beyond the source count.`,
        );
      }
      warnedIndexes.add(index);
    }
    for (const range of warning.messageIndexRanges ?? []) {
      if (
        range.from > range.to ||
        range.to > definition.source.messageCountAtCapture
      ) {
        throw new GoldenDatasetError(
          "INVALID_CAPTURE_WARNING",
          `${definition.id} has an invalid capture warning range.`,
        );
      }
      for (let index = range.from; index <= range.to; index += 1) {
        warnedIndexes.add(index);
      }
    }
    if (
      warning.messageCount !== undefined &&
      warning.messageCount !== warnedIndexes.size
    ) {
      throw new GoldenDatasetError(
        "INVALID_CAPTURE_WARNING",
        `${definition.id} capture warning count does not match its indexes.`,
      );
    }
  }
}

function parseCaptureWarnings(
  value: unknown,
  label: string,
): GoldenCaptureWarning[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new GoldenDatasetError("INVALID_CASE", `${label} must be an array.`);
  }
  return value.map((warning, index) => {
    const record = requireRecord(warning, `${label}[${index}]`);
    let ranges: Array<{ from: number; to: number }> | undefined;
    if (record.messageIndexRanges !== undefined) {
      if (!Array.isArray(record.messageIndexRanges)) {
        throw new GoldenDatasetError(
          "INVALID_CASE",
          `${label}[${index}].messageIndexRanges must be an array.`,
        );
      }
      ranges = record.messageIndexRanges.map((range, rangeIndex) => {
        const item = requireRecord(
          range,
          `${label}[${index}].messageIndexRanges[${rangeIndex}]`,
        );
        return {
          from: requirePositiveInteger(item.from, `${label}.range.from`),
          to: requirePositiveInteger(item.to, `${label}.range.to`),
        };
      });
    }
    return {
      code: requireString(record.code, `${label}[${index}].code`),
      messageIndexes: optionalIntegerArray(
        record.messageIndexes,
        `${label}[${index}].messageIndexes`,
      ),
      messageIndexRanges: ranges,
      messageCount:
        record.messageCount === undefined
          ? undefined
          : requirePositiveInteger(
              record.messageCount,
              `${label}[${index}].messageCount`,
            ),
      handling: optionalString(record.handling),
      notes: optionalString(record.notes),
    };
  });
}

function collectKnownInternalSourceIndexes(
  definition: GoldenNoteCase,
): Set<number> {
  const indexes = new Set<number>();
  for (const warning of definition.source.captureWarnings ?? []) {
    if (!/(?:tool_call|code_execution)/i.test(warning.code)) continue;
    for (const index of warning.messageIndexes ?? []) {
      if (index <= definition.inputCutoff.lastIncludedMessageIndex) {
        indexes.add(index);
      }
    }
    for (const range of warning.messageIndexRanges ?? []) {
      const end = Math.min(
        range.to,
        definition.inputCutoff.lastIncludedMessageIndex,
      );
      for (let index = range.from; index <= end; index += 1) {
        indexes.add(index);
      }
    }
  }
  return indexes;
}

function collectVariantDraftPaths(definition: GoldenNoteCase): string[] {
  return (definition.teacher.variantDrafts ?? []).map((variant, index) => {
    const record = requireRecord(
      variant,
      `${definition.id}.teacher.variantDrafts[${index}]`,
    );
    return requireString(
      record.draftPath,
      `${definition.id}.teacher.variantDrafts[${index}].draftPath`,
    );
  });
}

function baseCaseReport(
  datasetCase: GoldenDatasetCase,
  durationMs: number,
  acquisitionMode: GoldenAcquisitionMode,
): GoldenCaseReport {
  const definition = datasetCase.definition;
  const hasHumanReference =
    definition.humanReview.status === "approved" &&
    datasetCase.referenceRelativePath !== null;
  return {
    id: definition.id,
    title: definition.title,
    status: definition.status,
    acquisitionMode,
    technicalStatus: "blocked",
    qualityStatus: QUALITY_PENDING,
    verdict: "technical_blocked_quality_not_reviewed",
    durationMs,
    reference: {
      kind: hasHumanReference ? "human_reference" : "teacher_draft",
      status: definition.humanReview.status,
      eligibleForQualityScore: hasHumanReference,
      path:
        hasHumanReference
          ? datasetCase.referenceRelativePath!
          : datasetCase.teacherDraftRelativePath,
    },
    input: {
      cutoffSourceIndex: definition.inputCutoff.lastIncludedMessageIndex,
      expectedSourceMessageCount: definition.source.messageCountAtCapture,
      actualSourceMessageCount: null,
      sanitizedFullMessageCount: null,
      includedMessageCount: 0,
      includedSourceIndexes: [],
      omittedUnindexedCount: 0,
      filteredAfterCutoffCount: 0,
      canonicalSha256: null,
      canonicalHashScope: "adapter_title_and_cutoff_messages_v1",
      legacyCandidateDigestStatus: definition.source.candidateContentSha256
        ? "legacy_unverifiable"
        : "not_provided",
    },
    output: {
      candidatePath: null,
      schemaVersion: null,
      sha256: null,
      sourceMessageCount: null,
      userTurnCount: null,
      sectionCount: null,
    },
    diagnostics: {
      titleSource: null,
      omittedInternalCount: null,
      preservedEventCount: null,
      unsupportedContentCount: null,
      privateArtifactReferenceRedactedCount: null,
      richReferenceMarkerOmittedCount: null,
      warningCodes: [],
    },
    metrics: {
      inputCharacters: 0,
      noteCharacters: 0,
      compressionRatio: null,
      userMessages: 0,
      assistantMessages: 0,
      eventMessages: 0,
      flowKinds: emptyFlowKindCounts(),
      provenanceCoverage: null,
    },
    gates: [],
    manualQuality: {
      flowPreservation: NOT_REVIEWED,
      contextTransition: NOT_REVIEWED,
      correctionPreservation: NOT_REVIEWED,
      finalState: NOT_REVIEWED,
      groundedness: NOT_REVIEWED,
      readability: NOT_REVIEWED,
      compression: NOT_REVIEWED,
      editability: NOT_REVIEWED,
    },
    error: null,
  };
}

function acquisitionModeFor(
  options: RunGoldenBaselineOptions,
  datasetCase: GoldenDatasetCase,
): GoldenAcquisitionMode {
  const explicit = options.acquisitionModeForCase?.(datasetCase);
  if (explicit) return explicit;
  if (options.mode === "mixed") {
    throw new GoldenDatasetError(
      "MISSING_CASE_ACQUISITION_MODE",
      "Mixed runs must record an acquisition mode for every case.",
    );
  }
  return options.mode;
}

function selectCases(
  dataset: GoldenNoteDataset,
  requestedIds: readonly string[] | undefined,
): GoldenDatasetCase[] {
  if (!requestedIds || requestedIds.length === 0) {
    return dataset.cases.filter(
      (item) => item.definition.status !== "retired",
    );
  }
  const byId = new Map(
    dataset.cases.map((item) => [item.definition.id, item]),
  );
  const selected: GoldenDatasetCase[] = [];
  const seen = new Set<string>();
  for (const id of requestedIds) {
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) {
      throw new GoldenDatasetError(
        "UNKNOWN_CASE_ID",
        `Unknown Golden case ID: ${id}`,
      );
    }
    selected.push(item);
    seen.add(id);
  }
  return selected;
}

function canonicalInputDigest(
  title: string | null,
  messages: readonly ChatGPTMessage[],
): string {
  return sha256(
    stableStringify(
      {
        title: title?.trim() || null,
        messages: messages.map((message) => ({
          id: message.id,
          sourceIndex: message.sourceIndex,
          role: message.role,
          kind: message.kind,
          eventType: message.eventType ?? null,
          text: message.text,
          createdAt: message.createdAt,
        })),
      },
    ),
  );
}

function emptyFlowKindCounts(): Record<ConversationFlowKind, number> {
  return {
    opening: 0,
    follow_up: 0,
    correction: 0,
    transition: 0,
    opening_context: 0,
  };
}

function gate(
  id: string,
  status: GoldenGateStatus,
  details: string,
): GoldenGate {
  return { id, status, details };
}

function sanitizedError(
  error: unknown,
  fallbackCode: string,
): GoldenCaseReport["error"] {
  const errorRecord =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : null;
  const code =
    typeof errorRecord?.code === "string" && errorRecord.code.trim()
      ? errorRecord.code.trim().slice(0, 80)
      : fallbackCode;
  return {
    code,
    message: `Evaluation step failed (${code}); sensitive provider details were not persisted.`,
    retryCount: 0,
  };
}

function createRunId(startedAt: string): string {
  return `golden-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function roundedMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundedRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function safeArtifactName(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(value)) {
    throw new GoldenDatasetError(
      "UNSAFE_ARTIFACT_NAME",
      `Unsafe case ID for artifact output: ${value}`,
    );
  }
  return value;
}

function resolveInside(root: string, pathValue: string, label: string): string {
  if (!pathValue || isAbsolute(pathValue)) {
    throw new GoldenDatasetError(
      "UNSAFE_DATASET_PATH",
      `${label} must be a relative path inside the dataset.`,
    );
  }
  const resolved = resolve(root, pathValue);
  const relativePath = relative(root, resolved);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new GoldenDatasetError(
      "UNSAFE_DATASET_PATH",
      `${label} escapes the dataset directory.`,
    );
  }
  return resolved;
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/");
}

async function readJson(path: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new GoldenDatasetError(
      "DATASET_FILE_UNREADABLE",
      `Unable to read ${label}: ${sanitizedError(error, "READ_FAILED")?.message}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new GoldenDatasetError(
      "INVALID_DATASET_JSON",
      `${label} is not valid JSON.`,
    );
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoldenDatasetError("INVALID_DATASET", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GoldenDatasetError(
      "INVALID_DATASET",
      `${label} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, label);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new GoldenDatasetError(
      "INVALID_DATASET",
      `${label} must be a positive integer.`,
    );
  }
  return value as number;
}

function requireIntegerArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GoldenDatasetError(
      "INVALID_DATASET",
      `${label} must be a non-empty integer array.`,
    );
  }
  return value.map((item, index) =>
    requirePositiveInteger(item, `${label}[${index}]`),
  );
}

function optionalIntegerArray(
  value: unknown,
  label: string,
): number[] | undefined {
  if (value === undefined) return undefined;
  return requireIntegerArray(value, label);
}

function requireSafeId(value: unknown, label: string): string {
  const id = requireString(value, label);
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) {
    throw new GoldenDatasetError(
      "INVALID_DATASET_ID",
      `${label} must be a lowercase kebab-case identifier.`,
    );
  }
  return id;
}

function requireCaseStatus(value: unknown, label: string): GoldenCaseStatus {
  const status = requireString(value, label);
  if (
    status !== "teacher_draft_pending_human_review" &&
    status !== "human_reference_approved" &&
    status !== "active_eval_case" &&
    status !== "retired"
  ) {
    throw new GoldenDatasetError(
      "INVALID_CASE_STATUS",
      `${label} has unsupported status ${status}.`,
    );
  }
  return status;
}

function sameIntegerArray(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortForStableJson(item)]),
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
