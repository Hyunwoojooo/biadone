import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DAYFLOW_ARTIFACT_REGISTRY,
  dayflowNormalizedEvidenceSchema,
  dayflowScreenEvidenceExportSchema,
  domainSeparatedSha256,
  hashRegisteredArtifact,
  jcsCanonicalize,
  semanticOutputSha256,
} from "../src/dayflowEvidence/contracts";
import {
  DAYFLOW_ABLATION_ARTIFACT_REGISTRY,
  DAYFLOW_ABLATION_DETACHED_HASH_FIELDS,
  DAYFLOW_ABLATION_REGISTRY_HASH_DOMAIN,
  DAYFLOW_APPROVAL_TYPES,
  DFA002_COMMAND_DEFINING_INPUTS,
  DFA002_CONTRACT_SOURCE_ENTRIES,
  DFA002_REQUIRED_COMMANDS,
  DFA002_REQUIRED_PROVENANCE_PIN_SHAPES,
  a1ArmInputSchema,
  aggregateSchema,
  armInputSchema,
  bArmInputSchema,
  basisPointsSchema,
  cArmInputSchema,
  checkpointCompletionSchema,
  counterSchema,
  dayflowAblationArtifactRegistry,
  dayflowAblationExperimentManifestSha256,
  dayflowAblationRunResultsSha256,
  dayflowAblationRegistrySha256,
  dayflowAblationSourceProvenanceSha256,
  dayflowApprovalSchema,
  dayflowDatasetDagSchema,
  dfa002ValidationInputSetSha256,
  evidenceLineageSchema,
  evaluationExecutionFreezeSchema,
  executableStudyProtocolSchema,
  experimentManifestRefSchema,
  experimentManifestSchema,
  issuePilotVerificationAttestation,
  liveRetentionPolicySha256,
  pilotVerificationAttestationSchema,
  replicateIndexSchema,
  requestOrderManifestSchema,
  requestIssuanceReceiptSchema,
  runSchema,
  runResultsRefSchema,
  runResultsSchema,
  studyProtocolSchema,
  type AuthoritativeLiveAuthorityResolver,
  type DayflowDatasetDagResolver,
  type ResolvedExecutionBundleInput,
  validateDayflowAblationSyntheticDataset,
  validateDayflowDatasetDag,
  validateMatchedA1BInputs,
  validateResolvedDayflowDatasetDag,
  verifyResolvedDayflowDatasetDag,
  verifyResolvedExecutionBundle,
  verifyResolvedLiveExecutionAuthority,
} from "../src/evaluation/dayflowAblation/contracts";
import {
  buildDayflowAblationSyntheticExperimentManifest,
  buildDayflowAblationSyntheticDryRunPackage,
  buildDayflowAblationSyntheticRunResults,
  DayflowJsonParseError,
  loadDayflowAblationSyntheticCases,
  loadDayflowAblationSyntheticConfig,
  loadDayflowAblationSyntheticDataset,
  parseDuplicateAwareJson,
  parseDayflowAblationSyntheticDryRunPackage,
  type DayflowAblationSyntheticManifestBuildInput,
  type DayflowAblationSyntheticDryRunInput,
  verifyDayflowAblationSyntheticDryRunDecisionBinding,
} from "../src/evaluation/dayflowAblation/buildDataset";
import {
  activeAttentionResultSha256,
  resolveActiveAttention,
  verifyActiveAttentionResultIntegrity,
} from "../src/attentionDecision";
import {
  DAYFLOW_E1_AB_RENDERER_VERSION,
  DAYFLOW_E1_B_FALLBACK_CODES,
  DAYFLOW_E1_C_RENDERER_VERSION,
  DAYFLOW_E1_DETERMINISTIC_REQUEST_HASH_DOMAIN,
  DAYFLOW_E1_DETERMINISTIC_REQUEST_SCHEMA_VERSION,
  DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION,
  DAYFLOW_E1_PRESENTATION_VERSION,
  DAYFLOW_E1_PUBLIC_TEXT_GUARD_VERSION,
  DAYFLOW_E1_SCREEN_ELIGIBILITY_VERSION,
  buildDayflowE1ArmRun,
  projectDayflowE1SemanticOutputForBlindReview,
  renderDayflowE1A1SemanticOutput,
  renderDayflowE1BSemanticOutput,
  renderDayflowE1CSemanticOutput,
  type DayflowE1ResolvedScreenEvidenceInput,
} from "../src/evaluation/dayflowAblation/runGeneration";
import { activeAttentionFixture } from "./fixtures/activeAttentionFixture";

const SHA = "a".repeat(64);
const NOW = "2026-08-17T10:00:00.000Z";
const SENTINEL = "SYNTHETIC_DAYFLOW_FIXTURE_DO_NOT_USE_AS_HUMAN_DATA";

// Hermetic contract-test seam only. DFA-007 must provide authoritative
// currentness/storage before any live execution can be authorized.
type MockLiveAuthorityResolver = AuthoritativeLiveAuthorityResolver & {
  headRef: Record<string, unknown>;
  historicalHeadRef: Record<string, unknown>;
  artifacts: Map<string, Record<string, unknown>>;
};

function authorityArtifactKey(reference: {
  liveCollectionFreezeId?: unknown;
  approvalRecordId?: unknown;
}): string {
  if (typeof reference.liveCollectionFreezeId === "string") {
    return `freeze\u0000${reference.liveCollectionFreezeId}`;
  }
  if (typeof reference.approvalRecordId === "string") {
    return `approval\u0000${reference.approvalRecordId}`;
  }
  return "invalid";
}

function createMockLiveAuthorityResolver(
  headRef: Record<string, unknown>,
  artifacts: readonly Record<string, unknown>[],
): MockLiveAuthorityResolver {
  const resolver: MockLiveAuthorityResolver = {
    headRef,
    historicalHeadRef: structuredClone(headRef),
    artifacts: new Map(
      artifacts.map((artifact) => [authorityArtifactKey(artifact), artifact]),
    ),
    getCurrentHeadRef: () => resolver.headRef,
    getHeadRefAsOf: () => resolver.historicalHeadRef,
    resolve: (reference) =>
      resolver.artifacts.get(authorityArtifactKey(reference)),
  };
  return resolver;
}

function mockLiveResolver(value: {
  authorityResolver: AuthoritativeLiveAuthorityResolver;
}): MockLiveAuthorityResolver {
  return value.authorityResolver as MockLiveAuthorityResolver;
}

function mockAuthorityArtifact(
  value: { authorityResolver: AuthoritativeLiveAuthorityResolver },
  predicate: (artifact: Record<string, unknown>) => boolean,
): Record<string, unknown> {
  const artifact = [...mockLiveResolver(value).artifacts.values()].find(
    predicate,
  );
  if (artifact === undefined) throw new TypeError("Missing authority artifact");
  return artifact;
}

function readProjectFile(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const configRaw = readProjectFile(
  "eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json",
);
const casesRaw = readProjectFile(
  "eval/synthetic/dayflowEvidenceAblationCases.v0.2.json",
);

function sealArtifact<T extends Record<string, unknown>>(
  artifactClass: string,
  detachedField: keyof T & string,
  value: T,
): T {
  value[detachedField] = hashRegisteredArtifact(
    artifactClass,
    value,
  ) as T[keyof T & string];
  return value;
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildExperimentManifestFixtureInputs() {
  const encoder = new TextEncoder();
  const blabaseRevision =
    "92b2ca94fc3e8347261ac6a85a627c8e6c915400";
  const dayflowRevision =
    "df3c367edb7d405a78d1ae76edffe4ba366f57d7";
  const mediaTypeFor = (
    relativePath: string,
  ): "application/json; charset=utf-8" | "text/plain; charset=utf-8" =>
    relativePath.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8";
  const syntheticBytes = (kind: string, relativePath: string): Uint8Array =>
    encoder.encode(`SYNTHETIC_${kind}:${relativePath}\n`);

  const sourceProvenancePayload = {
    schemaVersion: "dayflow-ablation-source-provenance-v0.1" as const,
    pins: DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.map((entry) => {
      if (entry.pinKind === "repository-revision") {
        if (!("expectedRevision" in entry)) {
          throw new TypeError("Missing required repository revision");
        }
        return {
          repositoryId: entry.repositoryId,
          pinRole: entry.pinRole,
          pinKind: entry.pinKind,
          relativePath: entry.relativePath,
          revision: entry.expectedRevision,
        };
      }
      return {
        repositoryId: entry.repositoryId,
        pinRole: entry.pinRole,
        pinKind: entry.pinKind,
        relativePath: entry.relativePath,
        sha256:
          "expectedSha256" in entry
            ? entry.expectedSha256
            : rawSha256(
                syntheticBytes("SOURCE_PROVENANCE", entry.relativePath),
              ),
      };
    }),
    createdAt: "2026-08-17T07:50:00.000Z",
  };
  const sourceProvenance = {
    ...sourceProvenancePayload,
    sourceProvenanceSha256: dayflowAblationSourceProvenanceSha256(
      sourceProvenancePayload,
    ),
  };

  const candidateFiles = DFA002_CONTRACT_SOURCE_ENTRIES.map((entry) => {
    const bytes = syntheticBytes("CANDIDATE", entry.relativePath);
    return {
      relativePath: entry.relativePath,
      mediaType: mediaTypeFor(entry.relativePath),
      byteLength: String(bytes.byteLength),
      rawSha256: rawSha256(bytes),
      role: entry.role,
    };
  });
  const commandDefiningFiles = DFA002_COMMAND_DEFINING_INPUTS.map(
    (relativePath) => {
      const bytes = syntheticBytes("COMMAND_INPUT", relativePath);
      return {
        relativePath,
        mediaType: mediaTypeFor(relativePath),
        byteLength: String(bytes.byteLength),
        rawSha256: rawSha256(bytes),
      };
    },
  );
  const validationInputSetPayload = {
    trackedBaseRevision: blabaseRevision,
    candidateFiles,
    commandDefiningFiles,
    unexpectedTrackedPaths: [] as [],
  };
  const validationInputSet = {
    ...validationInputSetPayload,
    validationInputSetSha256: dfa002ValidationInputSetSha256(
      validationInputSetPayload,
    ),
  };
  const baseCodeProvenance = {
    blabaseRevision,
    dayflowRevision,
    sourceProvenanceSha256: sourceProvenance.sourceProvenanceSha256,
  };
  const toolVersions = {
    node: "22.23.2",
    dependencyCruiser: DFA002_REQUIRED_COMMANDS[0].toolVersion,
    eslint: DFA002_REQUIRED_COMMANDS[1].toolVersion,
    typescript: DFA002_REQUIRED_COMMANDS[2].toolVersion,
    vitest: DFA002_REQUIRED_COMMANDS[3].toolVersion,
  };
  return {
    sourceProvenance,
    validationInputSet,
    baseCodeProvenance,
    toolVersions,
  };
}

type StrictResolvedExecutionFixture = Omit<
  ResolvedExecutionBundleInput,
  "studyProtocol" | "executionFreeze" | "runs"
> &
  Readonly<{
    studyProtocol: ReturnType<typeof executableStudyProtocolSchema.parse>;
    executionFreeze: ReturnType<
      typeof evaluationExecutionFreezeSchema.parse
    >;
    runs: ReturnType<typeof runSchema.parse>[];
  }>;

function buildResolvedExecutionFixture(
  experimentManifestOverride?: unknown,
): StrictResolvedExecutionFixture {
  const manifestInputs = buildExperimentManifestFixtureInputs();
  const configDocument = JSON.parse(configRaw) as {
    configSchemaVersion: string;
    configId: string;
  };
  const casesIdentity = JSON.parse(casesRaw) as {
    casesSchemaVersion: string;
    fixtureSetId: string;
  };
  const configSource =
    manifestInputs.validationInputSet.candidateFiles.find(
      (entry) =>
        entry.relativePath ===
        "suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json",
    );
  const commonInputSource =
    manifestInputs.validationInputSet.candidateFiles.find(
      (entry) =>
        entry.relativePath ===
        "suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.2.json",
    );
  if (configSource === undefined || commonInputSource === undefined) {
    throw new TypeError("Missing experiment manifest source identity");
  }
  const defaultExperimentManifest = sealArtifact(
    "experiment-manifest",
    "experimentManifestSha256",
    {
      experimentManifestSchemaVersion:
        "dayflow-ablation-experiment-manifest-v0.2",
      experimentManifestId: "synthetic.experiment-manifest.resolved.0",
      lineageClass: "control",
      scopeId: "DFA-002",
      ownerPseudonym: "colin",
      targetDataOrigin: "synthetic",
      targetStudyPhase: "contract_conformance",
      sourceProvenance: structuredClone(manifestInputs.sourceProvenance),
      validationInputSet: structuredClone(
        manifestInputs.validationInputSet,
      ),
      baseCodeProvenance: structuredClone(
        manifestInputs.baseCodeProvenance,
      ),
      configurationIdentity: {
        schemaVersion: configDocument.configSchemaVersion,
        configId: configDocument.configId,
        relativePath:
          "suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json",
        configSha256: configSource.rawSha256,
      },
      toolVersions: structuredClone(
        manifestInputs.toolVersions,
      ),
      commandIdentities: DFA002_REQUIRED_COMMANDS.map((entry) => ({
        ...entry,
        argv: [...entry.argv],
      })),
      commonEvaluationInputIdentity: {
        schemaVersion: casesIdentity.casesSchemaVersion,
        inputId: casesIdentity.fixtureSetId,
        relativePath:
          "suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.2.json",
        inputSha256: commonInputSource.rawSha256,
      },
      limitations: [],
      createdAt: "2026-08-17T08:45:00.000Z",
      experimentManifestSha256: SHA,
    },
  );
  const experimentManifest =
    experimentManifestOverride === undefined
      ? defaultExperimentManifest
      : experimentManifestSchema.parse(experimentManifestOverride);
  const experimentManifestRef = {
    schemaVersion: "dayflow-ablation-experiment-manifest-v0.2",
    experimentManifestId: experimentManifest.experimentManifestId,
    experimentManifestSha256: experimentManifest.experimentManifestSha256,
  } as const;
  const studyProtocol = sealArtifact(
    "study-protocol",
    "studyProtocolHash",
    {
      studyProtocolSchemaVersion: "dayflow-ablation-study-protocol-v0.3",
      studyProtocolId: "synthetic.protocol.resolved.0",
      lineageClass: "control",
      targetDataOrigin: "synthetic",
      targetStudyPhase: "contract_conformance",
      fixtureOnly: true,
      evidenceUse: "contract_conformance_only",
      syntheticConsentPolicyId: "synthetic-consent-resolved-v0.1",
      syntheticRetentionPolicyId: "synthetic-retention-resolved-v0.1",
      fixtureGenerator: {
        version: "synthetic-generator-v0.1",
        seed: "synthetic-resolved-seed",
        configSha256: SHA,
        syntheticOnly: true,
      },
      experimentManifestRef,
      armPolicy: {
        enabledArms: ["A0", "A1", "B", "C"],
        replicateCountByArm: { A0: 1, A1: 1, B: 1, C: 1 },
      },
      claimEligibility: {
        contractConformance: true,
        quality: false,
        baseline: false,
        release: false,
        hPilotGo: false,
        hE2: false,
      },
      createdAt: "2026-08-17T09:00:00.000Z",
      studyProtocolHash: SHA,
    },
  );
  const executionTuple = {
    provider: "synthetic-provider",
    model: "synthetic-model",
    promptVersion: "synthetic-prompt-v0.1",
    promptSha256: "1".repeat(64),
    templateVersion: "synthetic-template-v0.1",
    configVersion: "synthetic-config-v0.1",
    generationParameters: {},
  };
  const executionFreeze = sealArtifact(
    "evaluation-execution-freeze",
    "evaluationExecutionFreezeSha256",
    {
      evaluationExecutionFreezeSchemaVersion:
        "dayflow-ablation-evaluation-execution-freeze-v0.3",
      evaluationExecutionFreezeId: "synthetic.freeze.resolved.0",
      lineageClass: "control",
      revision: "1",
      targetDataOrigin: "synthetic",
      targetStudyPhase: "contract_conformance",
      targetCheckpointCount: 1,
      experimentManifestRef,
      studyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: studyProtocol.studyProtocolHash,
      },
      extractorTuple: executionTuple,
      a1bCausalTuple: executionTuple,
      cScreenOnlyTuple: executionTuple,
      retryPolicy: { version: "synthetic-retry-v0.1", sha256: "3".repeat(64) },
      concurrencyPolicy: {
        version: "synthetic-concurrency-v0.1",
        sha256: "4".repeat(64),
      },
      resolverVersion: "synthetic-resolver-v0.1",
      guardrailVersion: "synthetic-guardrail-v0.1",
      verifierVersions: ["synthetic-verifier-v0.1"],
      replicatePolicy: {
        armPolicyRef: {
          studyProtocolHash: studyProtocol.studyProtocolHash,
          jsonPointer: "/armPolicy",
        },
        enabledArms: ["A0", "A1", "B", "C"],
        replicateCountByArm: { A0: 1, A1: 1, B: 1, C: 1 },
      },
      randomization: {
        algorithmVersion: "synthetic-order-v0.1",
        seed: "synthetic-order-seed",
        seedDerivationVersion: "synthetic-seed-derivation-v0.1",
        requestOrderManifestSchemaVersion:
          "dayflow-ablation-request-order-manifest-v0.1",
        bindingTime: "before-first-paired-request",
      },
      review: {
        rubricVersion: "synthetic-rubric-v0.1",
        permutationVersion: "synthetic-permutation-v0.1",
        missingOutputPolicyVersion: "synthetic-missing-output-v0.1",
      },
      createdAt: "2026-08-17T09:01:00.000Z",
      evaluationExecutionFreezeSha256: SHA,
    },
  );
  const freezeRef = {
    schemaVersion: "dayflow-ablation-evaluation-execution-freeze-v0.3",
    evaluationExecutionFreezeId:
      executionFreeze.evaluationExecutionFreezeId,
    evaluationExecutionFreezeSha256:
      executionFreeze.evaluationExecutionFreezeSha256,
  };
  const semanticOutput = {
    schemaVersion: "dayflow-ablation-semantic-output-v0.1",
    presentationMode: "display_only",
    status: "suggestions_available",
    items: [
      {
        position: 1,
        title: "Synthetic suggestion",
        summary: "Synthetic contract-only output",
        caveatCodes: ["SCREEN_CONTEXT_ONLY"],
        claimIds: [],
      },
    ],
  } satisfies Parameters<typeof semanticOutputSha256>[0];
  const outputHash = semanticOutputSha256(semanticOutput);
  const checkpoint = sealArtifact(
    "evaluation-checkpoint",
    "checkpointSha256",
    {
      checkpointSchemaVersion: "dayflow-ablation-checkpoint-v0.2",
      checkpointId: "synthetic.checkpoint.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      captureWindowId: "synthetic.capture.resolved.0",
      asOf: "2026-08-17T09:04:00.000Z",
      windowStart: "2026-08-17T09:02:00.000Z",
      windowEnd: "2026-08-17T09:02:01.000Z",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      studyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: studyProtocol.studyProtocolHash,
      },
      executionFreezeRef: freezeRef,
      expectedRunKeys: [
        { armId: "A0", replicateIndex: 0 },
        { armId: "A1", replicateIndex: 0 },
        { armId: "B", replicateIndex: 0 },
        { armId: "C", replicateIndex: 0 },
      ],
      blabaseCodeProvenance: "5".repeat(64),
      currentAttentionInputHash: "6".repeat(64),
      currentAttentionResultHash: outputHash,
      currentBoardHash: "8".repeat(64),
      structuredEvidenceHash: "9".repeat(64),
      dayflowExportHash: "a".repeat(64),
      dayflowNormalizedEvidenceHash: "b".repeat(64),
      workContextRegistryHash: "c".repeat(64),
      consentRevision: "synthetic-consent-resolved-v0.1",
      retentionPolicyId: "synthetic-retention-resolved-v0.1",
      inputSealStatus: "sealed",
      checkpointSha256: SHA,
    },
  );
  const casesDocument = JSON.parse(casesRaw) as {
    evidenceBoundaryVectors: Array<{
      vectorKind: string;
      payload: {
        exportManifest: Record<string, unknown>;
        artifactBlobs: Array<{ sourceArtifactId: string; bytes: string }>;
      };
    }>;
  };
  const observedVector = casesDocument.evidenceBoundaryVectors.find(
    (entry) => entry.vectorKind === "observed",
  );
  if (observedVector === undefined) {
    throw new TypeError("Missing synthetic observed export vector");
  }
  const exportManifest = structuredClone(
    observedVector.payload.exportManifest,
  );
  exportManifest.exportId = "synthetic.export.resolved.0";
  exportManifest.studyProtocolHash = studyProtocol.studyProtocolHash;
  exportManifest.exportedAt = checkpoint.windowEnd;
  exportManifest.windowStart = checkpoint.windowStart;
  exportManifest.windowEnd = checkpoint.windowEnd;
  exportManifest.consentRevision = studyProtocol.syntheticConsentPolicyId;
  exportManifest.retentionPolicyId =
    studyProtocol.syntheticRetentionPolicyId;
  const coverage = testRecord(exportManifest.coverage);
  const coverageIntervals = coverage.intervals;
  if (!Array.isArray(coverageIntervals)) {
    throw new TypeError("Expected synthetic coverage intervals");
  }
  testRecord(coverageIntervals[0]).start = checkpoint.windowStart;
  testRecord(coverageIntervals[0]).end = checkpoint.windowEnd;
  const exportedArtifacts = exportManifest.artifacts;
  if (!Array.isArray(exportedArtifacts)) {
    throw new TypeError("Expected synthetic exported artifact");
  }
  const exportedArtifact = testRecord(exportedArtifacts[0]);
  exportedArtifact.capturedAt = checkpoint.windowStart;
  exportedArtifact.captureConsentRevision =
    studyProtocol.syntheticConsentPolicyId;
  testRecord(exportedArtifact.pseudonymousDisplayAttestation).attestedAt =
    checkpoint.windowStart;
  testRecord(exportedArtifact.pseudonymousWindowAttestation).attestedAt =
    checkpoint.windowStart;
  sealArtifact(
    "dayflow-export-manifest",
    "detachedManifestSha256",
    exportManifest,
  );
  const exportRef = {
    schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
    exportId: String(exportManifest.exportId),
    detachedManifestSha256: String(exportManifest.detachedManifestSha256),
  };
  const sourceArtifactRef = {
    artifactType: "dayflow_export_frame" as const,
    exportRef,
    sourceRowId: String(exportedArtifact.sourceRowId),
    blobSha256: String(exportedArtifact.sha256),
  };
  const normalizedEvidence = sealArtifact(
    "normalized-screen-evidence",
    "dayflowNormalizedEvidenceHash",
    {
      schemaVersion: "dayflow-normalized-evidence-v0.1",
      evidenceId: "synthetic.normalized.resolved.0",
      generationId: "synthetic.normalized-generation.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      extractorInputHash: "1".repeat(64),
      captureWindow: {
        start: checkpoint.windowStart,
        end: checkpoint.windowEnd,
      },
      activityKind: "focused_work",
      applicationCategory: "development",
      subjectLabel: "synthetic subject",
      taskIntent: "inspect a synthetic fixture",
      stateClaim: null,
      confidenceBasisPoints: 8000,
      coverageCode: "observed",
      normalizedCoverage: structuredClone(coverage),
      sourceExportRefs: [exportRef],
      sourceArtifactHashes: [sourceArtifactRef.blobSha256],
      preprocessingVersion: "synthetic-preprocessing-v0.1",
      extractorVersion: "synthetic-extractor-v0.1",
      model: "none",
      promptVersion: "synthetic-prompt-v0.1",
      promptSha256: "2".repeat(64),
      configVersion: "synthetic-normalizer-config-v0.1",
      guardrailVersion: "synthetic-guardrail-v0.1",
      verificationStatus: "verified",
      reasonCodes: ["SYNTHETIC_CONTRACT_FIXTURE"],
      semanticOutput: {
        schemaVersion: "dayflow-ablation-semantic-output-v0.1",
        presentationMode: "display_only",
        status: "suggestions_available",
        items: [
          {
            position: 1,
            title: "synthetic subject",
            summary: "inspect a synthetic fixture",
            caveatCodes: [],
            claimIds: ["synthetic.screen-claim.1", "synthetic.screen-claim.2"],
          },
        ],
      },
      acceptedClaims: [
        {
          claimId: "synthetic.screen-claim.1",
          outputFieldPath: "/items/0/title",
          claimClass: "DISPLAY_TITLE_HINT",
          normalizedValueHash: "3".repeat(64),
          confidenceBasisPoints: 8000,
          fieldEvidenceId: "synthetic.field-evidence.1",
        },
        {
          claimId: "synthetic.screen-claim.2",
          outputFieldPath: "/items/0/summary",
          claimClass: "VISIBLE_TASK_INTENT",
          normalizedValueHash: "4".repeat(64),
          confidenceBasisPoints: 8000,
          fieldEvidenceId: "synthetic.field-evidence.2",
        },
      ],
      fieldEvidence: [
        {
          fieldEvidenceId: "synthetic.field-evidence.1",
          claimId: "synthetic.screen-claim.1",
          outputFieldPath: "/items/0/title",
          sourceArtifactRefs: [sourceArtifactRef],
          captureSpans: [
            {
              spanKind: "normalized_frame",
              sourceArtifactRef,
              startOffsetMs: 0,
              endOffsetMs: 1000,
            },
          ],
        },
        {
          fieldEvidenceId: "synthetic.field-evidence.2",
          claimId: "synthetic.screen-claim.2",
          outputFieldPath: "/items/0/summary",
          sourceArtifactRefs: [sourceArtifactRef],
          captureSpans: [
            {
              spanKind: "normalized_frame",
              sourceArtifactRef,
              startOffsetMs: 0,
              endOffsetMs: 1000,
            },
          ],
        },
      ],
      rejectedClaims: [],
      conflictingClaims: [],
      expiresAt: "2026-08-18T09:03:00.000Z",
      dayflowNormalizedEvidenceHash: SHA,
    },
  );
  checkpoint.dayflowExportHash = String(
    exportManifest.detachedManifestSha256,
  );
  checkpoint.dayflowNormalizedEvidenceHash = String(
    normalizedEvidence.dayflowNormalizedEvidenceHash,
  );
  sealArtifact("evaluation-checkpoint", "checkpointSha256", checkpoint);
  const checkpointRef = {
    schemaVersion: "dayflow-ablation-checkpoint-v0.2",
    checkpointId: checkpoint.checkpointId,
    checkpointSha256: checkpoint.checkpointSha256,
  };
  const requestOrderManifest = sealArtifact(
    "request-order-manifest",
    "requestOrderManifestSha256",
    {
      requestOrderManifestSchemaVersion:
        "dayflow-ablation-request-order-manifest-v0.1",
      requestOrderManifestId: "synthetic.request-order.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      algorithmVersion: "synthetic-order-v0.1",
      seed: "synthetic-order-seed",
      entries: [
        {
          position: "0",
          checkpointId: checkpoint.checkpointId,
          checkpointSha256: checkpoint.checkpointSha256,
          matchedPairId: "synthetic.pair.resolved.0",
          replicateIndex: 0,
          armId: "A1",
          requestId: "synthetic.request.resolved.a1.0",
        },
        {
          position: "1",
          checkpointId: checkpoint.checkpointId,
          checkpointSha256: checkpoint.checkpointSha256,
          matchedPairId: "synthetic.pair.resolved.0",
          replicateIndex: 0,
          armId: "B",
          requestId: "synthetic.request.resolved.b.0",
        },
      ],
      createdAt: "2026-08-17T09:04:30.000Z",
      requestOrderManifestSha256: SHA,
    },
  );
  const requestOrderManifestRef = {
    schemaVersion: "dayflow-ablation-request-order-manifest-v0.1",
    requestOrderManifestId: requestOrderManifest.requestOrderManifestId,
    requestOrderManifestSha256:
      requestOrderManifest.requestOrderManifestSha256,
  };
  const structuredCheckpointRef = {
    currentAttentionInputHash: checkpoint.currentAttentionInputHash,
    currentAttentionResultHash: checkpoint.currentAttentionResultHash,
    currentBoardHash: checkpoint.currentBoardHash,
    structuredEvidenceHash: checkpoint.structuredEvidenceHash,
    workContextRegistryHash: checkpoint.workContextRegistryHash,
  };
  const armInputCommon = {
    armInputSchemaVersion: "dayflow-ablation-arm-input-v0.4",
    lineageClass: "evidence",
    dataOrigin: "synthetic",
    studyPhase: "contract_conformance",
    studyProtocolHash: studyProtocol.studyProtocolHash,
    captureWindowId: checkpoint.captureWindowId,
    executionFreezeRef: freezeRef,
    replicateIndex: 0,
    presentationPolicyRef: {
      version: "synthetic-display-v0.1",
      sha256: "d".repeat(64),
    },
  };
  const a0Input = sealArtifact("a0-arm-input", "armInputHash", {
    ...armInputCommon,
    armInputId: "synthetic.input.resolved.a0.0",
    armId: "A0",
    inputKind: "structured_baseline",
    checkpointRef,
    sealedAttentionResultRef: {
      resultId: "synthetic.attention-result.resolved.0",
      resultSha256: checkpoint.currentAttentionResultHash,
    },
    structuredCheckpointRef,
    screenEvidenceMode: "none",
    armInputHash: SHA,
  });
  const a1Input = sealArtifact("a1-arm-input", "armInputHash", {
    ...armInputCommon,
    armInputId: "synthetic.input.resolved.a1.0",
    armId: "A1",
    inputKind: "structured_generation",
    checkpointRef,
    structuredCheckpointRef,
    structuredCandidateHash: "e".repeat(64),
    screenEvidenceMode: "masked",
    generationTupleSelector: "a1bCausalTuple",
    matchedPairId: "synthetic.pair.resolved.0",
    requestOrderManifestRef,
    requestId: "synthetic.request.resolved.a1.0",
    requestPosition: "0",
    armInputHash: SHA,
  });
  const bInput = sealArtifact("b-arm-input", "armInputHash", {
    ...armInputCommon,
    armInputId: "synthetic.input.resolved.b.0",
    armId: "B",
    inputKind: "structured_plus_screen_generation",
    checkpointRef,
    structuredCheckpointRef,
    structuredCandidateHash: "e".repeat(64),
    screenEvidenceMode: "normalized",
    normalizedEvidenceRef: {
      schemaVersion: "dayflow-normalized-evidence-v0.1",
      evidenceId: "synthetic.normalized.resolved.0",
      dayflowNormalizedEvidenceHash: checkpoint.dayflowNormalizedEvidenceHash,
    },
    generationTupleSelector: "a1bCausalTuple",
    matchedPairId: "synthetic.pair.resolved.0",
    requestOrderManifestRef,
    requestId: "synthetic.request.resolved.b.0",
    requestPosition: "1",
    armInputHash: SHA,
  });
  const cInput = sealArtifact("c-arm-input", "armInputHash", {
    ...armInputCommon,
    armInputId: "synthetic.input.resolved.c.0",
    armId: "C",
    inputKind: "screen_only_generation",
    screenEvidenceMode: "normalized",
    normalizedEvidenceRef: {
      schemaVersion: "dayflow-normalized-evidence-v0.1",
      evidenceId: "synthetic.normalized.resolved.0",
      dayflowNormalizedEvidenceHash: checkpoint.dayflowNormalizedEvidenceHash,
    },
    generationTupleSelector: "cScreenOnlyTuple",
    armInputHash: SHA,
  });
  const a1Receipt = sealArtifact(
    "request-issuance-receipt",
    "requestIssuanceReceiptSha256",
    {
      requestIssuanceReceiptSchemaVersion:
        "dayflow-ablation-request-issuance-receipt-v0.1",
      requestIssuanceReceiptId: "synthetic.issuance.resolved.a1.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      requestOrderManifestRef,
      requestId: a1Input.requestId,
      position: "0",
      issuanceSequence: "0",
      armInputRef: {
        schemaVersion: "dayflow-ablation-arm-input-v0.4",
        armInputId: a1Input.armInputId,
        armInputHash: a1Input.armInputHash,
      },
      issuedAt: "2026-08-17T09:04:40.000Z",
      requestIssuanceReceiptSha256: SHA,
    },
  );
  const bReceipt = sealArtifact(
    "request-issuance-receipt",
    "requestIssuanceReceiptSha256",
    {
      requestIssuanceReceiptSchemaVersion:
        "dayflow-ablation-request-issuance-receipt-v0.1",
      requestIssuanceReceiptId: "synthetic.issuance.resolved.b.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      requestOrderManifestRef,
      requestId: bInput.requestId,
      position: "1",
      issuanceSequence: "1",
      armInputRef: {
        schemaVersion: "dayflow-ablation-arm-input-v0.4",
        armInputId: bInput.armInputId,
        armInputHash: bInput.armInputHash,
      },
      issuedAt: "2026-08-17T09:04:50.000Z",
      previousReceiptSha256: a1Receipt.requestIssuanceReceiptSha256,
      requestIssuanceReceiptSha256: SHA,
    },
  );
  const requestIssuanceReceipts = [a1Receipt, bReceipt];
  const issuanceReceiptByArm = { A1: a1Receipt, B: bReceipt } as const;
  const makeRun = (
    armId: "A0" | "A1" | "B" | "C",
    armInput: Record<string, unknown>,
    startedAt: string,
    completedAt: string,
  ) => {
    const commonRun = {
      runSchemaVersion: "dayflow-ablation-run-v0.4",
      runId: `synthetic.run.resolved.${armId.toLowerCase()}.0`,
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      armInputRef: {
        schemaVersion: "dayflow-ablation-arm-input-v0.4",
        armInputId: armInput.armInputId,
        armInputHash: armInput.armInputHash,
      },
      executionFreezeRef: freezeRef,
      replicateIndex: 0,
      startedAt,
      completedAt,
      status: "completed",
      attempts: [
        {
          attemptIndex: 0,
          startedAt,
          completedAt,
          requestSha256: "f".repeat(64),
          latencyMs: 1,
          inputTokens: 1,
          outputTokens: 1,
          costMicrounits: 0,
          attemptKind: "deterministic_success",
          responseSha256: outputHash,
          attemptOutputHash: outputHash,
        },
      ],
      semanticOutput,
      validationIssueCodes: [],
      outputHash,
      runSha256: SHA,
      armId,
    };
    const armFields =
      armId === "A0"
        ? {
            runKind: "sealed_baseline",
            checkpointRef,
            sealedResultSha256: outputHash,
          }
        : armId === "C"
          ? { runKind: "screen_only_generation" }
          : {
              runKind: "causal_generation",
              checkpointRef,
              matchedPairId: "synthetic.pair.resolved.0",
              requestOrderManifestRef,
              requestId:
                armId === "A1"
                  ? "synthetic.request.resolved.a1.0"
                  : "synthetic.request.resolved.b.0",
              requestPosition: armId === "A1" ? "0" : "1",
              requestIssuanceReceiptRef: {
                schemaVersion:
                  "dayflow-ablation-request-issuance-receipt-v0.1",
                requestIssuanceReceiptId:
                  issuanceReceiptByArm[armId].requestIssuanceReceiptId,
                requestIssuanceReceiptSha256:
                  issuanceReceiptByArm[armId].requestIssuanceReceiptSha256,
              },
              issuanceSequence: armId === "A1" ? "0" : "1",
            };
    return sealArtifact("arm-run", "runSha256", {
      ...commonRun,
      ...armFields,
    });
  };
  const a0Run = makeRun(
    "A0",
    a0Input,
    "2026-08-17T09:05:00.000Z",
    "2026-08-17T09:05:30.000Z",
  );
  const a1Run = makeRun(
    "A1",
    a1Input,
    "2026-08-17T09:05:30.000Z",
    "2026-08-17T09:06:00.000Z",
  );
  const bRun = makeRun(
    "B",
    bInput,
    "2026-08-17T09:06:00.000Z",
    "2026-08-17T09:07:00.000Z",
  );
  const cRun = makeRun(
    "C",
    cInput,
    "2026-08-17T09:07:00.000Z",
    "2026-08-17T09:07:30.000Z",
  );
  const runs = [a0Run, a1Run, bRun, cRun];
  const runRefs = runs.map((run) => ({
    schemaVersion: "dayflow-ablation-run-v0.4",
    runId: run.runId,
    runSha256: run.runSha256,
    armId: run.armId,
    replicateIndex: run.replicateIndex,
  }));
  const completion = sealArtifact(
    "checkpoint-completion",
    "checkpointCompletionSha256",
    {
      checkpointCompletionSchemaVersion:
        "dayflow-ablation-checkpoint-completion-v0.1",
      checkpointCompletionId: "synthetic.completion.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      studyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: studyProtocol.studyProtocolHash,
      },
      checkpointRef,
      executionFreezeRef: freezeRef,
      expectedRunKeys: [
        { armId: "A0", replicateIndex: 0 },
        { armId: "A1", replicateIndex: 0 },
        { armId: "B", replicateIndex: 0 },
        { armId: "C", replicateIndex: 0 },
      ],
      completionStatus: "completed",
      presentRunRefs: runRefs,
      missingExpectedRunKeys: [],
      failedRunKeys: [],
      noOutputRunKeys: [],
      completedAt: "2026-08-17T09:08:00.000Z",
      checkpointCompletionSha256: SHA,
    },
  );
  return {
    experimentManifest,
    studyProtocol: executableStudyProtocolSchema.parse(studyProtocol),
    executionFreeze:
      evaluationExecutionFreezeSchema.parse(executionFreeze),
    checkpoint,
    armInputs: [a0Input, a1Input, bInput, cInput],
    requestOrderManifests: [requestOrderManifest],
    requestIssuanceReceipts,
    runs: runs.map((run) => runSchema.parse(run)),
    completion,
    screenEvidence: {
      evidence: dayflowNormalizedEvidenceSchema.parse(normalizedEvidence),
      resolvedExportManifests: [
        dayflowScreenEvidenceExportSchema.parse(exportManifest),
      ],
      resolvedArtifacts: [
        {
          sourceArtifactRef,
          exportManifest: dayflowScreenEvidenceExportSchema.parse(
            exportManifest,
          ),
          artifact: dayflowScreenEvidenceExportSchema.parse(exportManifest)
            .artifacts[0]!,
        },
      ],
      artifactBlobs: [
        {
          sourceArtifactId: String(exportedArtifact.sourceArtifactId),
          bytes: Buffer.from(
            observedVector.payload.artifactBlobs[0]!.bytes,
            "base64",
          ),
        },
      ],
      normalizedTexts: [],
    },
  };
}

function buildRunResultsFixture() {
  const bundle = buildResolvedExecutionFixture();
  const manifest = testRecord(bundle.experimentManifest);
  const protocol = testRecord(bundle.studyProtocol);
  const executionFreeze = testRecord(bundle.executionFreeze);
  const completion = testRecord(bundle.completion);
  const terminalArmRunRefs = bundle.runs
    .map((runValue) => {
      const run = testRecord(runValue);
      return {
        schemaVersion: "dayflow-ablation-run-v0.4",
        runId: run.runId,
        runSha256: run.runSha256,
        armId: run.armId,
        replicateIndex: run.replicateIndex,
      };
    })
    .sort((left, right) => {
      const key = (entry: {
        armId: unknown;
        replicateIndex: unknown;
        runId: unknown;
      }) =>
        `${String(["A0", "A1", "B", "C"].indexOf(String(entry.armId))).padStart(2, "0")}\u0000${String(entry.replicateIndex).padStart(2, "0")}\u0000${String(entry.runId)}`;
      const leftKey = key(left);
      const rightKey = key(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return sealArtifact("run-results", "runResultsSha256", {
    runResultsSchemaVersion: "dayflow-ablation-run-results-v0.1",
    runResultsId: "synthetic.run-results.resolved.0",
    lineageClass: "evidence",
    dataOrigin: "synthetic",
    studyPhase: "contract_conformance",
    studyProtocolHash: protocol.studyProtocolHash,
    experimentManifestRef: {
      schemaVersion: "dayflow-ablation-experiment-manifest-v0.2",
      experimentManifestId: manifest.experimentManifestId,
      experimentManifestSha256: manifest.experimentManifestSha256,
    },
    studyProtocolRef: {
      schemaVersion: "dayflow-ablation-study-protocol-v0.3",
      studyProtocolHash: protocol.studyProtocolHash,
    },
    executionFreezeRef: {
      schemaVersion: "dayflow-ablation-evaluation-execution-freeze-v0.3",
      evaluationExecutionFreezeId:
        executionFreeze.evaluationExecutionFreezeId,
      evaluationExecutionFreezeSha256:
        executionFreeze.evaluationExecutionFreezeSha256,
    },
    terminalArmRunRefs,
    completedAt: completion.completedAt,
    runResultsSha256: SHA,
  });
}

function buildResolvedLiveAuthorityFixture() {
  const synthetic = buildResolvedExecutionFixture();
  const experimentManifest = structuredClone(
    testRecord(synthetic.experimentManifest),
  );
  experimentManifest.experimentManifestId =
    "synthetic.experiment-manifest.live.0";
  experimentManifest.targetDataOrigin = "live";
  experimentManifest.targetStudyPhase = "private_pilot";
  experimentManifest.commonEvaluationInputIdentity = {
    schemaVersion: "synthetic-live-input-v0.1",
    inputId: "synthetic.live-input.0",
    relativePath: "inputs/synthetic.live-input.0.json",
    inputSha256: "2".repeat(64),
  };
  sealArtifact(
    "experiment-manifest",
    "experimentManifestSha256",
    experimentManifest,
  );
  const experimentManifestRef = {
    schemaVersion: "dayflow-ablation-experiment-manifest-v0.2",
    experimentManifestId: experimentManifest.experimentManifestId,
    experimentManifestSha256: experimentManifest.experimentManifestSha256,
  };
  const syntheticProtocol = testRecord(synthetic.studyProtocol);
  const liveProtocol = structuredClone(syntheticProtocol);
  liveProtocol.targetDataOrigin = "live";
  liveProtocol.targetStudyPhase = "private_pilot";
  liveProtocol.fixtureOnly = false;
  liveProtocol.evidenceUse = "evaluation";
  delete liveProtocol.syntheticConsentPolicyId;
  delete liveProtocol.syntheticRetentionPolicyId;
  delete liveProtocol.fixtureGenerator;
  liveProtocol.experimentManifestRef = experimentManifestRef;
  const captureScopeHash = "3".repeat(64);
  const capturePolicyRef = {
    version: "synthetic-live-capture-v0.1",
    sha256: "4".repeat(64),
  };
  const denylistPolicyRef = {
    version: "synthetic-live-denylist-v0.1",
    sha256: "5".repeat(64),
  };
  const retentionPolicyPayload = {
    policySchemaVersion:
      "dayflow-ablation-live-retention-policy-v0.1" as const,
    lineageClass: "control" as const,
    policyId: "synthetic.live-retention.0",
    blabaseRawCopyMaxAgeMs: "86400000",
    dayflowCanonicalSourceMaxAgeMs: "86400000",
  };
  const retentionPolicyResolution = {
    ...retentionPolicyPayload,
    policySha256: liveRetentionPolicySha256(retentionPolicyPayload),
  };
  const retentionPolicyRef = {
    policyId: retentionPolicyResolution.policyId,
    sha256: retentionPolicyResolution.policySha256,
  };
  const encryptionDeploymentRef = {
    version: "synthetic-live-encryption-v0.1",
    sha256: "6".repeat(64),
  };
  const artifactGovernancePolicyRefs = [
    {
      artifactClass: "dayflow-export-manifest",
      policyId: "synthetic.live-governance.export.0",
      policySha256: "7".repeat(64),
    },
  ];
  Object.assign(liveProtocol, {
    targetCheckpointCount: 15,
    inclusionPolicyVersion: "synthetic-inclusion-v0.1",
    exclusionPolicyVersion: "synthetic-exclusion-v0.1",
    checkpointSpacingPolicyVersion: "synthetic-checkpoint-v0.1",
    asOfPolicyVersion: "synthetic-asof-v0.1",
    missingOutputAnalysisPolicyVersion: "synthetic-missing-output-v0.1",
    reviewRubricVersion: "synthetic-rubric-v0.1",
    blindPermutationVersion: "synthetic-permutation-v0.1",
    metricFormulaVersion: "synthetic-metric-v0.1",
    captureScopeHash,
    capturePolicyRef,
    denylistPolicyRef,
    encryptionDeploymentRef,
    artifactGovernancePolicyRefs,
    localOnly: true,
    cloudImageUpload: false,
  });
  liveProtocol.consentRef = {
    lineageClass: "control",
    consentRevision: "synthetic-live-consent-v0.1",
    consentRecordSha256: "1".repeat(64),
  };
  liveProtocol.retentionPolicyRef = {
    lineageClass: "control",
    policyId: retentionPolicyResolution.policyId,
    policySha256: retentionPolicyResolution.policySha256,
  };
  liveProtocol.claimEligibility = {
    contractConformance: false,
    quality: true,
    baseline: false,
    release: false,
    hPilotGo: true,
    hE2: false,
  };
  sealArtifact("study-protocol", "studyProtocolHash", liveProtocol);

  const executionFreeze = structuredClone(
    testRecord(synthetic.executionFreeze),
  );
  executionFreeze.targetDataOrigin = "live";
  executionFreeze.targetStudyPhase = "private_pilot";
  executionFreeze.targetCheckpointCount = 15;
  executionFreeze.experimentManifestRef = experimentManifestRef;
  testRecord(executionFreeze.studyProtocolRef).studyProtocolHash =
    liveProtocol.studyProtocolHash;
  testRecord(
    testRecord(executionFreeze.replicatePolicy).armPolicyRef,
  ).studyProtocolHash = liveProtocol.studyProtocolHash;
  sealArtifact(
    "evaluation-execution-freeze",
    "evaluationExecutionFreezeSha256",
    executionFreeze,
  );
  const liveCaptureApproval = sealArtifact(
    "human-approval-record",
    "approvalRecordSha256",
    {
      approvalSchemaVersion: "dayflow-ablation-human-approval-v0.1",
      approvalRecordId: "synthetic.live-capture-approval.0",
      lineageClass: "control",
      approverPseudonym: "synthetic.live-reviewer.0",
      approvedAt: "2026-08-17T09:01:30.000Z",
      scopeHash: captureScopeHash,
      approvalType: "H-LIVE-CAPTURE",
      decision: "approved",
      phase: "private_pilot",
      studyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: liveProtocol.studyProtocolHash,
      },
      consentRevision: "synthetic-live-consent-v0.1",
      captureScopeHash,
      capturePolicyRef,
      denylistPolicyRef,
      retentionPolicyRef,
      encryptionDeploymentRef,
      artifactGovernancePolicyRefs,
      localOnly: true,
      cloudImageUpload: false,
      validFrom: "2026-08-17T09:01:30.000Z",
      validUntil: "2026-08-18T09:01:30.000Z",
      approvalRecordSha256: SHA,
    },
  );
  const executionFreezeRef = {
    schemaVersion: "dayflow-ablation-evaluation-execution-freeze-v0.3",
    evaluationExecutionFreezeId:
      executionFreeze.evaluationExecutionFreezeId,
    evaluationExecutionFreezeSha256:
      executionFreeze.evaluationExecutionFreezeSha256,
  };
  const liveCollectionFreeze = sealArtifact(
    "live-collection-freeze",
    "liveCollectionFreezeSha256",
    {
      liveCollectionFreezeSchemaVersion:
        "dayflow-ablation-live-collection-freeze-v0.3",
      liveCollectionFreezeId: "synthetic.live-collection-freeze.0",
      lineageClass: "control",
      targetDataOrigin: "live",
      targetStudyPhase: "private_pilot",
      targetCheckpointCount: 15,
      experimentManifestRef,
      executionFreezeRef,
      studyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: liveProtocol.studyProtocolHash,
      },
      inclusionPolicyVersion: "synthetic-inclusion-v0.1",
      exclusionPolicyVersion: "synthetic-exclusion-v0.1",
      checkpointSpacingPolicyVersion: "synthetic-checkpoint-v0.1",
      asOfPolicyVersion: "synthetic-asof-v0.1",
      missingOutputAnalysisPolicyVersion: "synthetic-missing-output-v0.1",
      reviewRubricVersion: "synthetic-rubric-v0.1",
      blindPermutationVersion: "synthetic-permutation-v0.1",
      metricFormulaVersion: "synthetic-metric-v0.1",
      captureScopeHash,
      consentRevision: "synthetic-live-consent-v0.1",
      capturePolicyRef,
      denylistPolicyRef,
      retentionPolicyRef,
      encryptionDeploymentRef,
      artifactGovernancePolicyRefs,
      localOnly: true,
      cloudImageUpload: false,
      approvalRefs: [
        {
          approvalType: "H-LIVE-CAPTURE",
          approvalRecordId: liveCaptureApproval.approvalRecordId,
          approvalRecordSha256:
            liveCaptureApproval.approvalRecordSha256,
        },
      ],
      status: "approved",
      approvedAt: "2026-08-17T09:03:00.000Z",
      liveCollectionFreezeSha256: SHA,
    },
  );
  const liveCollectionFreezeHeadRef = {
    schemaVersion: "dayflow-ablation-live-collection-freeze-v0.3",
    liveCollectionFreezeId: liveCollectionFreeze.liveCollectionFreezeId,
    liveCollectionFreezeSha256:
      liveCollectionFreeze.liveCollectionFreezeSha256,
  };
  return {
    experimentManifest,
    studyProtocol: liveProtocol,
    executionFreeze,
    authorizationAsOf: "2026-08-17T09:04:00.000Z",
    captureWindowStart: "2026-08-17T09:03:30.000Z",
    authorityResolutionMode: "current" as const,
    authorityResolver: createMockLiveAuthorityResolver(
      liveCollectionFreezeHeadRef,
      [liveCollectionFreeze, liveCaptureApproval],
    ),
    pilotDatasetDag: undefined as unknown,
    pilotVerificationAttestation: undefined as unknown,
    pilotHistoricalAuthorityResolver:
      undefined as AuthoritativeLiveAuthorityResolver | undefined,
    pilotDeletionReceipts: [] as unknown[],
    consentRef: liveProtocol.consentRef,
    retentionPolicyRef: retentionPolicyResolution,
  };
}

function buildDirectionalLiveAuthorityFixture() {
  const fixture = buildResolvedLiveAuthorityFixture();
  const authorityResolver = mockLiveResolver(fixture);
  fixture.captureWindowStart = "2026-08-18T09:30:00.000Z";
  fixture.authorizationAsOf = "2026-08-18T09:31:00.000Z";
  const experimentManifest = testRecord(fixture.experimentManifest);
  experimentManifest.targetStudyPhase = "directional_study";
  sealArtifact(
    "experiment-manifest",
    "experimentManifestSha256",
    experimentManifest,
  );
  const experimentManifestRef = {
    schemaVersion: "dayflow-ablation-experiment-manifest-v0.2",
    experimentManifestId: experimentManifest.experimentManifestId,
    experimentManifestSha256: experimentManifest.experimentManifestSha256,
  };
  const protocol = fixture.studyProtocol;
  protocol.targetStudyPhase = "directional_study";
  protocol.targetCheckpointCount = 60;
  protocol.experimentManifestRef = experimentManifestRef;
  protocol.claimEligibility = {
    contractConformance: false,
    quality: true,
    baseline: false,
    release: false,
    hPilotGo: false,
    hE2: true,
  };
  sealArtifact("study-protocol", "studyProtocolHash", protocol);

  const executionFreeze = fixture.executionFreeze;
  executionFreeze.targetStudyPhase = "directional_study";
  executionFreeze.targetCheckpointCount = 60;
  executionFreeze.experimentManifestRef = experimentManifestRef;
  testRecord(executionFreeze.studyProtocolRef).studyProtocolHash =
    protocol.studyProtocolHash;
  testRecord(
    testRecord(executionFreeze.replicatePolicy).armPolicyRef,
  ).studyProtocolHash = protocol.studyProtocolHash;
  sealArtifact(
    "evaluation-execution-freeze",
    "evaluationExecutionFreezeSha256",
    executionFreeze,
  );

  const liveApproval = testRecord(
    [...authorityResolver.artifacts.values()].find(
      (artifact) => artifact.approvalType === "H-LIVE-CAPTURE",
    ),
  );
  liveApproval.phase = "directional_study";
  liveApproval.validUntil = "2026-08-19T09:01:30.000Z";
  testRecord(liveApproval.studyProtocolRef).studyProtocolHash =
    protocol.studyProtocolHash;
  sealArtifact(
    "human-approval-record",
    "approvalRecordSha256",
    liveApproval,
  );

  const pilotDataset = buildResolvedPilotDagFixture();
  const pilotBinding = testRecord(pilotDataset.dag.binding);
  const pilotProtocolHash = String(pilotBinding.studyProtocolHash);
  const attestation = pilotDataset.attestation;
  const deletionObligations = attestation.checkpoints.flatMap((checkpoint) => [
    {
      artifactType: "dayflow-export-manifest" as const,
      schemaVersion: checkpoint.exportManifestRef.schemaVersion,
      artifactId: checkpoint.exportManifestRef.exportId,
      artifactSha256: checkpoint.exportManifestRef.detachedManifestSha256,
    },
    ...checkpoint.rawPurgeObligations.map((entry) => entry.frameRef),
  ]).sort((left, right) =>
    `${left.artifactType}\u0000${left.schemaVersion}\u0000${left.artifactId}\u0000${left.artifactSha256}`.localeCompare(
      `${right.artifactType}\u0000${right.schemaVersion}\u0000${right.artifactId}\u0000${right.artifactSha256}`,
    ),
  );
  const earliestBlabaseDeadline = attestation.checkpoints
    .flatMap((checkpoint) => checkpoint.rawPurgeObligations)
    .map((entry) => entry.blabaseRawCopyDeleteBy)
    .sort()[0]!;
  const earliestDayflowDeadline = attestation.checkpoints
    .flatMap((checkpoint) => checkpoint.rawPurgeObligations)
    .map((entry) => entry.dayflowCanonicalSourceDeleteBy)
    .sort()[0]!;
  const deletionReceipt = sealArtifact(
    "deletion-receipt",
    "deletionReceiptSha256",
    {
      deletionReceiptSchemaVersion:
        "dayflow-ablation-deletion-receipt-v0.1",
      deletionReceiptId: "synthetic.pilot-deletion.0",
      lineageClass: "evidence",
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: pilotProtocolHash,
      affectedArtifactRefs: deletionObligations,
      blabaseRawCopyStatus: "deleted",
      blabaseRawCopyPurgedAt: earliestBlabaseDeadline,
      dayflowCanonicalSourceStatus: "deleted",
      dayflowCanonicalSourcePurgedAt: earliestDayflowDeadline,
      createdAt: "2026-08-18T09:04:00.000Z",
      deletionReceiptSha256: SHA,
    },
  );
  const pilotApproval = sealArtifact(
    "human-approval-record",
    "approvalRecordSha256",
    {
      approvalSchemaVersion: "dayflow-ablation-human-approval-v0.1",
      approvalRecordId: "synthetic.pilot-go-approval.0",
      lineageClass: "control",
      approverPseudonym: "synthetic.pilot-reviewer.0",
      approvedAt: "2026-08-18T09:20:00.000Z",
      scopeHash: protocol.captureScopeHash,
      approvalType: "H-PILOT-GO",
      decision: "approved",
      pilotFinalBindingRef: {
        schemaVersion: "dayflow-ablation-final-dataset-binding-v0.1",
        finalDatasetBindingId: pilotBinding.finalDatasetBindingId,
        finalDatasetBindingSha256:
          pilotBinding.finalDatasetBindingSha256,
      },
      pilotVerificationAttestationRef: {
        schemaVersion:
          "dayflow-ablation-pilot-verification-attestation-v0.1",
        pilotVerificationAttestationId:
          attestation.pilotVerificationAttestationId,
        pilotVerificationAttestationSha256:
          attestation.pilotVerificationAttestationSha256,
      },
      pilotDeletionEvidenceRefs: [
        {
          schemaVersion: "dayflow-ablation-deletion-receipt-v0.1",
          deletionReceiptId: deletionReceipt.deletionReceiptId,
          deletionReceiptSha256: deletionReceipt.deletionReceiptSha256,
        },
      ],
      directionalTarget: {
        phase: "directional_study",
        studyProtocolHash: protocol.studyProtocolHash,
      },
      liveCaptureApprovalRef: {
        schemaVersion: "dayflow-ablation-human-approval-v0.1",
        approvalRecordId: liveApproval.approvalRecordId,
        approvalRecordSha256: liveApproval.approvalRecordSha256,
      },
      validFrom: "2026-08-18T09:20:00.000Z",
      validUntil: "2026-08-19T09:20:00.000Z",
      approvalRecordSha256: SHA,
    },
  );

  const liveFreeze = testRecord(
    [...authorityResolver.artifacts.values()].find(
      (artifact) => artifact.liveCollectionFreezeId !== undefined,
    ),
  );
  liveFreeze.targetStudyPhase = "directional_study";
  liveFreeze.targetCheckpointCount = 60;
  liveFreeze.experimentManifestRef = experimentManifestRef;
  liveFreeze.studyProtocolRef = {
    schemaVersion: "dayflow-ablation-study-protocol-v0.3",
    studyProtocolHash: protocol.studyProtocolHash,
  };
  liveFreeze.executionFreezeRef = {
    schemaVersion: "dayflow-ablation-evaluation-execution-freeze-v0.3",
    evaluationExecutionFreezeId:
      executionFreeze.evaluationExecutionFreezeId,
    evaluationExecutionFreezeSha256:
      executionFreeze.evaluationExecutionFreezeSha256,
  };
  liveFreeze.approvalRefs = [
    {
      approvalType: "H-LIVE-CAPTURE",
      approvalRecordId: liveApproval.approvalRecordId,
      approvalRecordSha256: liveApproval.approvalRecordSha256,
    },
    {
      approvalType: "H-PILOT-GO",
      approvalRecordId: pilotApproval.approvalRecordId,
      approvalRecordSha256: pilotApproval.approvalRecordSha256,
    },
  ];
  liveFreeze.approvedAt = "2026-08-18T09:25:00.000Z";
  sealArtifact(
    "live-collection-freeze",
    "liveCollectionFreezeSha256",
    liveFreeze,
  );
  authorityResolver.headRef.liveCollectionFreezeSha256 = String(
    liveFreeze.liveCollectionFreezeSha256,
  );
  authorityResolver.artifacts.set(
    authorityArtifactKey(pilotApproval),
    pilotApproval,
  );
  fixture.pilotDatasetDag = pilotDataset.dag;
  fixture.pilotVerificationAttestation = attestation;
  fixture.pilotHistoricalAuthorityResolver =
    pilotDataset.historicalAuthorityResolver;
  fixture.pilotDeletionReceipts = [deletionReceipt];
  const pilotHistory = pilotDataset
    .historicalAuthorityResolver as MockLiveAuthorityResolver;
  const historicalApprovedFreeze = testRecord(
    pilotHistory.artifacts.get(
      authorityArtifactKey(pilotHistory.historicalHeadRef),
    ),
  );
  const closedPilotFreeze = structuredClone(historicalApprovedFreeze);
  closedPilotFreeze.liveCollectionFreezeId =
    "synthetic.live-collection-freeze.pilot-closed";
  closedPilotFreeze.supersedesLiveCollectionFreezeRef =
    structuredClone(pilotHistory.historicalHeadRef);
  closedPilotFreeze.status = "closed";
  delete closedPilotFreeze.approvedAt;
  closedPilotFreeze.closedAt = "2026-08-17T09:13:00.000Z";
  closedPilotFreeze.closureReasonCode = "PILOT_CLOSED";
  sealArtifact(
    "live-collection-freeze",
    "liveCollectionFreezeSha256",
    closedPilotFreeze,
  );
  pilotHistory.headRef = {
    schemaVersion: "dayflow-ablation-live-collection-freeze-v0.3",
    liveCollectionFreezeId: closedPilotFreeze.liveCollectionFreezeId,
    liveCollectionFreezeSha256:
      closedPilotFreeze.liveCollectionFreezeSha256,
  };
  pilotHistory.artifacts.set(
    authorityArtifactKey(closedPilotFreeze),
    closedPilotFreeze,
  );
  return fixture;
}

function resealExecutionManifestReferences(
  bundle: ResolvedExecutionBundleInput,
): void {
  const manifest = testRecord(bundle.requestOrderManifests[0]);
  const manifestRef = {
    schemaVersion: "dayflow-ablation-request-order-manifest-v0.1",
    requestOrderManifestId: manifest.requestOrderManifestId,
    requestOrderManifestSha256: manifest.requestOrderManifestSha256,
  };
  const inputByKey = new Map<string, Record<string, unknown>>();
  for (const inputValue of bundle.armInputs) {
    const input = testRecord(inputValue);
    const armId = input.armId;
    if (typeof armId !== "string") throw new TypeError("Expected arm input");
    if (armId === "A1" || armId === "B") {
      input.requestOrderManifestRef = manifestRef;
    }
    const artifactClass =
      armId === "A0"
        ? "a0-arm-input"
        : armId === "A1"
          ? "a1-arm-input"
          : armId === "B"
            ? "b-arm-input"
            : "c-arm-input";
    sealArtifact(
      artifactClass,
      "armInputHash",
      input,
    );
    inputByKey.set(`${armId}\u0000${String(input.replicateIndex)}`, input);
  }
  const receiptByRequestId = new Map<string, Record<string, unknown>>();
  let previousReceiptSha256: unknown;
  for (const receiptValue of bundle.requestIssuanceReceipts) {
    const receipt = testRecord(receiptValue);
    const requestId = String(receipt.requestId);
    const input = [...inputByKey.values()].find(
      (candidate) => candidate.requestId === requestId,
    );
    if (input === undefined) throw new TypeError("Expected causal arm input");
    receipt.requestOrderManifestRef = manifestRef;
    receipt.armInputRef = {
      schemaVersion: "dayflow-ablation-arm-input-v0.4",
      armInputId: input.armInputId,
      armInputHash: input.armInputHash,
    };
    if (previousReceiptSha256 === undefined) {
      delete receipt.previousReceiptSha256;
    } else {
      receipt.previousReceiptSha256 = previousReceiptSha256;
    }
    sealArtifact(
      "request-issuance-receipt",
      "requestIssuanceReceiptSha256",
      receipt,
    );
    previousReceiptSha256 = receipt.requestIssuanceReceiptSha256;
    receiptByRequestId.set(requestId, receipt);
  }
  for (const runValue of bundle.runs) {
    const run = testRecord(runValue);
    const input = inputByKey.get(
      `${String(run.armId)}\u0000${String(run.replicateIndex)}`,
    );
    if (input === undefined) throw new TypeError("Expected resolved input");
    if (run.armId === "A1" || run.armId === "B") {
      run.requestOrderManifestRef = manifestRef;
      const receipt = receiptByRequestId.get(String(run.requestId));
      if (receipt === undefined) throw new TypeError("Expected issuance receipt");
      run.requestIssuanceReceiptRef = {
        schemaVersion: "dayflow-ablation-request-issuance-receipt-v0.1",
        requestIssuanceReceiptId: receipt.requestIssuanceReceiptId,
        requestIssuanceReceiptSha256:
          receipt.requestIssuanceReceiptSha256,
      };
      run.issuanceSequence = receipt.issuanceSequence;
    }
    run.armInputRef = {
      schemaVersion: "dayflow-ablation-arm-input-v0.4",
      armInputId: input.armInputId,
      armInputHash: input.armInputHash,
    };
    sealArtifact("arm-run", "runSha256", run);
  }
  const completion = testRecord(bundle.completion);
  completion.presentRunRefs = bundle.runs.map((runValue) => {
    const run = testRecord(runValue);
    return {
      schemaVersion: "dayflow-ablation-run-v0.4",
      runId: run.runId,
      runSha256: run.runSha256,
      armId: run.armId,
      replicateIndex: run.replicateIndex,
    };
  });
  sealArtifact(
    "checkpoint-completion",
    "checkpointCompletionSha256",
    completion,
  );
}

function resealReceiptRunReferences(
  bundle: ResolvedExecutionBundleInput,
): void {
  const receiptByRequestId = new Map(
    bundle.requestIssuanceReceipts.map((value) => {
      const receipt = testRecord(value);
      return [String(receipt.requestId), receipt] as const;
    }),
  );
  for (const runValue of bundle.runs) {
    const run = testRecord(runValue);
    if (run.armId === "A1" || run.armId === "B") {
      const receipt = receiptByRequestId.get(String(run.requestId));
      if (receipt === undefined) throw new TypeError("Expected issuance receipt");
      run.requestIssuanceReceiptRef = {
        schemaVersion: "dayflow-ablation-request-issuance-receipt-v0.1",
        requestIssuanceReceiptId: receipt.requestIssuanceReceiptId,
        requestIssuanceReceiptSha256:
          receipt.requestIssuanceReceiptSha256,
      };
      run.issuanceSequence = receipt.issuanceSequence;
      sealArtifact("arm-run", "runSha256", run);
    }
  }
  const completion = testRecord(bundle.completion);
  completion.presentRunRefs = bundle.runs.map((runValue) => {
    const run = testRecord(runValue);
    return {
      schemaVersion: "dayflow-ablation-run-v0.4",
      runId: run.runId,
      runSha256: run.runSha256,
      armId: run.armId,
      replicateIndex: run.replicateIndex,
    };
  });
  sealArtifact(
    "checkpoint-completion",
    "checkpointCompletionSha256",
    completion,
  );
}

function rebindExecutionCheckpointAndExport(
  bundle: ResolvedExecutionBundleInput,
  suffix: string,
): void {
  const exportManifest = testRecord(
    bundle.screenEvidence.resolvedExportManifests[0],
  );
  exportManifest.exportId = `synthetic.export.resolved.${suffix}`;
  sealArtifact(
    "dayflow-export-manifest",
    "detachedManifestSha256",
    exportManifest,
  );
  const exportRef = {
    schemaVersion: "dayflow-screen-evidence-export-v0.1",
    exportId: exportManifest.exportId,
    detachedManifestSha256: exportManifest.detachedManifestSha256,
  };
  const evidence = testRecord(bundle.screenEvidence.evidence);
  evidence.evidenceId = `synthetic.normalized.resolved.${suffix}`;
  evidence.sourceExportRefs = [exportRef];
  const fieldEvidence = evidence.fieldEvidence;
  if (!Array.isArray(fieldEvidence)) throw new TypeError("Expected evidence");
  for (const fieldValue of fieldEvidence) {
    const field = testRecord(fieldValue);
    const sourceRefs = field.sourceArtifactRefs;
    const spans = field.captureSpans;
    if (!Array.isArray(sourceRefs) || !Array.isArray(spans)) {
      throw new TypeError("Expected evidence lineage");
    }
    for (const sourceRef of sourceRefs) {
      testRecord(sourceRef).exportRef = exportRef;
    }
    for (const span of spans) {
      testRecord(testRecord(span).sourceArtifactRef).exportRef = exportRef;
    }
  }
  sealArtifact(
    "normalized-screen-evidence",
    "dayflowNormalizedEvidenceHash",
    evidence,
  );
  for (const resolvedValue of bundle.screenEvidence.resolvedArtifacts) {
    const resolved = testRecord(resolvedValue);
    testRecord(resolved.sourceArtifactRef).exportRef = exportRef;
    resolved.exportManifest = exportManifest;
  }

  const checkpoint = testRecord(bundle.checkpoint);
  checkpoint.checkpointId = `synthetic.checkpoint.resolved.${suffix}`;
  checkpoint.dayflowExportHash = exportManifest.detachedManifestSha256;
  checkpoint.dayflowNormalizedEvidenceHash =
    evidence.dayflowNormalizedEvidenceHash;
  sealArtifact("evaluation-checkpoint", "checkpointSha256", checkpoint);
  const checkpointRef = {
    schemaVersion: "dayflow-ablation-checkpoint-v0.2",
    checkpointId: checkpoint.checkpointId,
    checkpointSha256: checkpoint.checkpointSha256,
  };
  for (const armValue of bundle.armInputs) {
    const arm = testRecord(armValue);
    if (arm.armId !== "C") arm.checkpointRef = checkpointRef;
    if (arm.armId === "B" || arm.armId === "C") {
      arm.normalizedEvidenceRef = {
        schemaVersion: "dayflow-normalized-evidence-v0.1",
        evidenceId: evidence.evidenceId,
        dayflowNormalizedEvidenceHash:
          evidence.dayflowNormalizedEvidenceHash,
      };
    }
  }
  const requestManifest = testRecord(bundle.requestOrderManifests[0]);
  const entries = requestManifest.entries;
  if (!Array.isArray(entries)) throw new TypeError("Expected requests");
  for (const entry of entries) {
    const record = testRecord(entry);
    record.checkpointId = checkpoint.checkpointId;
    record.checkpointSha256 = checkpoint.checkpointSha256;
  }
  sealArtifact(
    "request-order-manifest",
    "requestOrderManifestSha256",
    requestManifest,
  );
  for (const runValue of bundle.runs) {
    const run = testRecord(runValue);
    if (run.armId !== "C") run.checkpointRef = checkpointRef;
  }
  testRecord(bundle.completion).checkpointRef = checkpointRef;
  resealExecutionManifestReferences(bundle);
}

function rebindExecutionCheckpointIdentity(
  bundle: ResolvedExecutionBundleInput,
  checkpointId: string,
  captureWindowId: string,
): void {
  const checkpoint = testRecord(bundle.checkpoint);
  checkpoint.checkpointId = checkpointId;
  checkpoint.captureWindowId = captureWindowId;
  sealArtifact("evaluation-checkpoint", "checkpointSha256", checkpoint);
  const checkpointRef = {
    schemaVersion: "dayflow-ablation-checkpoint-v0.2",
    checkpointId: checkpoint.checkpointId,
    checkpointSha256: checkpoint.checkpointSha256,
  };
  for (const armValue of bundle.armInputs) {
    const arm = testRecord(armValue);
    arm.captureWindowId = captureWindowId;
    if (arm.armId !== "C") arm.checkpointRef = checkpointRef;
  }
  const manifest = testRecord(bundle.requestOrderManifests[0]);
  const entries = manifest.entries;
  if (!Array.isArray(entries)) throw new TypeError("Expected requests");
  for (const entry of entries) {
    Object.assign(testRecord(entry), {
      checkpointId: checkpoint.checkpointId,
      checkpointSha256: checkpoint.checkpointSha256,
    });
  }
  sealArtifact(
    "request-order-manifest",
    "requestOrderManifestSha256",
    manifest,
  );
  for (const runValue of bundle.runs) {
    const run = testRecord(runValue);
    if (run.armId !== "C") run.checkpointRef = checkpointRef;
  }
  testRecord(bundle.completion).checkpointRef = checkpointRef;
  resealExecutionManifestReferences(bundle);
}

function rebindExecutionCaptureWindow(
  bundle: ResolvedExecutionBundleInput,
  suffix: string,
  windowStart: string,
  windowEnd: string,
): void {
  const checkpoint = testRecord(bundle.checkpoint);
  checkpoint.windowStart = windowStart;
  checkpoint.windowEnd = windowEnd;
  const exportManifest = testRecord(
    bundle.screenEvidence.resolvedExportManifests[0],
  );
  Object.assign(exportManifest, {
    windowStart,
    windowEnd,
    exportedAt: windowEnd,
  });
  const exportIntervals = testRecord(exportManifest.coverage).intervals;
  const artifacts = exportManifest.artifacts;
  if (!Array.isArray(exportIntervals) || !Array.isArray(artifacts)) {
    throw new TypeError("Expected export window payloads");
  }
  Object.assign(testRecord(exportIntervals[0]), {
    start: windowStart,
    end: windowEnd,
  });
  for (const artifactValue of artifacts) {
    const artifact = testRecord(artifactValue);
    artifact.capturedAt = windowStart;
    testRecord(artifact.pseudonymousDisplayAttestation).attestedAt =
      windowStart;
    testRecord(artifact.pseudonymousWindowAttestation).attestedAt =
      windowStart;
  }
  const evidence = testRecord(bundle.screenEvidence.evidence);
  evidence.captureWindow = { start: windowStart, end: windowEnd };
  const normalizedIntervals = testRecord(evidence.normalizedCoverage).intervals;
  if (!Array.isArray(normalizedIntervals)) {
    throw new TypeError("Expected normalized coverage");
  }
  Object.assign(testRecord(normalizedIntervals[0]), {
    start: windowStart,
    end: windowEnd,
  });
  for (const resolvedValue of bundle.screenEvidence.resolvedArtifacts) {
    const resolved = testRecord(resolvedValue);
    const artifactId = testRecord(resolved.artifact).sourceArtifactId;
    resolved.artifact = artifacts.find(
      (artifactValue) =>
        testRecord(artifactValue).sourceArtifactId === artifactId,
    );
  }
  rebindExecutionCheckpointAndExport(bundle, suffix);
  rebindExecutionCheckpointIdentity(
    bundle,
    `pilot.checkpoint.${suffix}`,
    `pilot.capture.${suffix}`,
  );
}

function buildDistinctPilotExecutionFixture(
  index: number,
): ResolvedExecutionBundleInput {
  const bundle = buildResolvedPilotExecutionFixture();
  const suffix = String(index).padStart(2, "0");
  const windowStart = new Date(
    Date.parse("2026-08-17T09:03:30.000Z") + index * 2_000,
  ).toISOString();
  const windowEnd = new Date(Date.parse(windowStart) + 1_000).toISOString();
  const exportManifest = testRecord(
    bundle.screenEvidence.resolvedExportManifests[0],
  );
  testRecord(exportManifest.databaseSnapshotIdentity).snapshotId =
    `pilot.snapshot.resolved.${suffix}`;
  const exportArtifacts = exportManifest.artifacts;
  if (!Array.isArray(exportArtifacts) || exportArtifacts.length !== 1) {
    throw new TypeError("Expected one pilot export artifact");
  }
  const sourceArtifactId = `pilot.source-artifact.${suffix}`;
  testRecord(exportArtifacts[0]).sourceArtifactId = sourceArtifactId;
  testRecord(bundle.screenEvidence.resolvedArtifacts[0]).artifact =
    exportArtifacts[0];
  testRecord(bundle.screenEvidence.artifactBlobs[0]).sourceArtifactId =
    sourceArtifactId;
  rebindExecutionCaptureWindow(
    bundle,
    suffix,
    windowStart,
    windowEnd,
  );

  const matchedPairId = `pilot.matched-pair.${suffix}`;
  const manifest = testRecord(bundle.requestOrderManifests[0]);
  manifest.requestOrderManifestId = `pilot.request-order.${suffix}`;
  const manifestEntries = manifest.entries;
  if (!Array.isArray(manifestEntries)) throw new TypeError("Expected requests");
  for (const entryValue of manifestEntries) {
    const entry = testRecord(entryValue);
    const armId = String(entry.armId);
    entry.requestId = `pilot.request.${suffix}.${armId.toLowerCase()}`;
    entry.matchedPairId = matchedPairId;
  }
  for (const armValue of bundle.armInputs) {
    const arm = testRecord(armValue);
    const armId = String(arm.armId);
    arm.armInputId = `pilot.arm-input.${suffix}.${armId.toLowerCase()}`;
    if (armId === "A1" || armId === "B") {
      arm.requestId = `pilot.request.${suffix}.${armId.toLowerCase()}`;
      arm.matchedPairId = matchedPairId;
    }
  }
  for (const receiptValue of bundle.requestIssuanceReceipts) {
    const receipt = testRecord(receiptValue);
    const sequence = String(receipt.issuanceSequence);
    const armId = sequence === "0" ? "a1" : "b";
    receipt.requestIssuanceReceiptId =
      `pilot.issuance.${suffix}.${sequence}`;
    receipt.requestId = `pilot.request.${suffix}.${armId}`;
  }
  for (const runValue of bundle.runs) {
    const run = testRecord(runValue);
    const armId = String(run.armId);
    run.runId = `pilot.run.${suffix}.${armId.toLowerCase()}`;
    if (armId === "A1" || armId === "B") {
      run.requestId = `pilot.request.${suffix}.${armId.toLowerCase()}`;
      run.matchedPairId = matchedPairId;
    }
  }
  testRecord(bundle.completion).checkpointCompletionId =
    `pilot.completion.${suffix}`;
  sealArtifact(
    "request-order-manifest",
    "requestOrderManifestSha256",
    manifest,
  );
  resealExecutionManifestReferences(bundle);
  return bundle;
}

function buildResolvedPilotExecutionFixture(): ResolvedExecutionBundleInput {
  const synthetic = buildResolvedExecutionFixture();
  const authority = buildResolvedLiveAuthorityFixture();
  const protocol = authority.studyProtocol;
  const executionFreeze = authority.executionFreeze;
  const freezeRef = {
    schemaVersion: "dayflow-ablation-evaluation-execution-freeze-v0.3",
    evaluationExecutionFreezeId:
      executionFreeze.evaluationExecutionFreezeId,
    evaluationExecutionFreezeSha256:
      executionFreeze.evaluationExecutionFreezeSha256,
  };
  const bundle: ResolvedExecutionBundleInput = {
    ...synthetic,
    experimentManifest: authority.experimentManifest,
    studyProtocol: protocol,
    executionFreeze,
    liveAuthority: {
      authorityResolver: authority.authorityResolver,
      pilotDeletionReceipts: [],
      consentRef: authority.consentRef,
      retentionPolicyRef: authority.retentionPolicyRef,
    },
  };
  const checkpoint = testRecord(bundle.checkpoint);
  Object.assign(checkpoint, {
    dataOrigin: "live",
    studyPhase: "private_pilot",
    captureWindowId: "pilot.capture.resolved.0",
    asOf: authority.authorizationAsOf,
    windowStart: authority.captureWindowStart,
    windowEnd: "2026-08-17T09:03:31.000Z",
    studyProtocolHash: protocol.studyProtocolHash,
    studyProtocolRef: {
      schemaVersion: "dayflow-ablation-study-protocol-v0.3",
      studyProtocolHash: protocol.studyProtocolHash,
    },
    executionFreezeRef: freezeRef,
    consentRevision: testRecord(protocol.consentRef).consentRevision,
    retentionPolicyId: testRecord(protocol.retentionPolicyRef).policyId,
  });

  const exportManifest = testRecord(
    bundle.screenEvidence.resolvedExportManifests[0],
  );
  Object.assign(exportManifest, {
    dataOrigin: "live",
    studyPhase: "private_pilot",
    studyProtocolHash: protocol.studyProtocolHash,
    exportedAt: checkpoint.windowEnd,
    windowStart: checkpoint.windowStart,
    windowEnd: checkpoint.windowEnd,
    dayflowCommitSha: "df3c367edb7d405a78d1ae76edffe4ba366f57d7",
    sourceFileHashes: [
      {
        relativePath:
          "Dayflow/Dayflow/Core/Recording/ScreenRecorder.swift",
        sha256:
          "94f2683bce56a1aec41bab3a856b07a551d87d09e64d4bc7186046d76448192e",
      },
      {
        relativePath:
          "Dayflow/Dayflow/Core/Recording/StorageManager+Screenshots.swift",
        sha256:
          "67e0ca38c673981a1a9da2d48c2359f47132c44c817789d6ad0c6468feb4b1f4",
      },
      {
        relativePath:
          "Dayflow/Dayflow/Core/Recording/StorageManager.swift",
        sha256:
          "d1fc88fe3b0caec6c2cc4dc28c8fc75735d99dfbc56b47518fb14024c394ae7b",
      },
    ],
    packageResolvedSha256:
      "2fbad062f299f029a3ac35ae82ef06eca622ad3abcb7486aff9687c8e3f33077",
    capturePolicyVersion: testRecord(protocol.capturePolicyRef).version,
    databaseSnapshotIdentity: {
      snapshotKind: "dayflow-stable-snapshot",
      snapshotAlgorithmVersion: "synthetic-stable-snapshot-v0.1",
      snapshotId: "pilot.snapshot.resolved.0",
      databaseSchemaFingerprint: "1".repeat(64),
      mainDatabaseSha256: "2".repeat(64),
      walState: "none",
      stableSnapshotMarkerSha256: "3".repeat(64),
      createdAt: checkpoint.windowStart,
    },
    consentRevision: testRecord(protocol.consentRef).consentRevision,
    retentionPolicyId: testRecord(protocol.retentionPolicyRef).policyId,
  });
  const exportCoverageIntervals = testRecord(exportManifest.coverage).intervals;
  if (!Array.isArray(exportCoverageIntervals)) {
    throw new TypeError("Expected pilot export coverage");
  }
  Object.assign(testRecord(exportCoverageIntervals[0]), {
    start: checkpoint.windowStart,
    end: checkpoint.windowEnd,
  });
  const exportedArtifacts = exportManifest.artifacts;
  if (!Array.isArray(exportedArtifacts)) {
    throw new TypeError("Expected pilot export artifact");
  }
  for (const artifactValue of exportedArtifacts) {
    const artifact = testRecord(artifactValue);
    Object.assign(artifact, {
      capturedAt: checkpoint.windowStart,
      privacyState: "consented_live",
      placeholderState: "verified_non_placeholder",
      captureConsentRevision: testRecord(protocol.consentRef).consentRevision,
      capturePolicyVersion: testRecord(protocol.capturePolicyRef).version,
    });
    for (const attestationName of [
      "pseudonymousDisplayAttestation",
      "pseudonymousWindowAttestation",
    ] as const) {
      const attestation = testRecord(artifact[attestationName]);
      Object.assign(attestation, {
        pseudonymousSubjectId:
          attestationName === "pseudonymousDisplayAttestation"
            ? "pilot-display-attestation"
            : "pilot-window-attestation",
        policyVersion: testRecord(protocol.capturePolicyRef).version,
        policySha256: testRecord(protocol.capturePolicyRef).sha256,
        attestedAt: checkpoint.windowStart,
      });
    }
  }
  for (const resolvedValue of bundle.screenEvidence.resolvedArtifacts) {
    const resolved = testRecord(resolvedValue);
    const sourceArtifactId = testRecord(resolved.artifact).sourceArtifactId;
    resolved.artifact = exportedArtifacts.find(
      (artifactValue) =>
        testRecord(artifactValue).sourceArtifactId === sourceArtifactId,
    );
  }

  const evidence = testRecord(bundle.screenEvidence.evidence);
  Object.assign(evidence, {
    dataOrigin: "live",
    studyPhase: "private_pilot",
    studyProtocolHash: protocol.studyProtocolHash,
    captureWindow: {
      start: checkpoint.windowStart,
      end: checkpoint.windowEnd,
    },
    expiresAt: "2026-08-18T09:03:31.000Z",
  });
  const normalizedCoverageIntervals = testRecord(
    evidence.normalizedCoverage,
  ).intervals;
  if (!Array.isArray(normalizedCoverageIntervals)) {
    throw new TypeError("Expected pilot normalized coverage");
  }
  Object.assign(testRecord(normalizedCoverageIntervals[0]), {
    start: checkpoint.windowStart,
    end: checkpoint.windowEnd,
  });
  for (const armValue of bundle.armInputs) {
    Object.assign(testRecord(armValue), {
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
      captureWindowId: checkpoint.captureWindowId,
      executionFreezeRef: freezeRef,
    });
  }
  for (const manifestValue of bundle.requestOrderManifests) {
    Object.assign(testRecord(manifestValue), {
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
    });
  }
  for (const receiptValue of bundle.requestIssuanceReceipts) {
    Object.assign(testRecord(receiptValue), {
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
    });
  }
  for (const runValue of bundle.runs) {
    Object.assign(testRecord(runValue), {
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
      executionFreezeRef: freezeRef,
    });
  }
  Object.assign(testRecord(bundle.completion), {
    dataOrigin: "live",
    studyPhase: "private_pilot",
    studyProtocolHash: protocol.studyProtocolHash,
    studyProtocolRef: {
      schemaVersion: "dayflow-ablation-study-protocol-v0.3",
      studyProtocolHash: protocol.studyProtocolHash,
    },
    executionFreezeRef: freezeRef,
  });
  rebindExecutionCheckpointAndExport(bundle, "pilot");
  return bundle;
}

function buildResolvedPilotDagFixture(checkpointCount = 15) {
  const bundles = Array.from({ length: checkpointCount }, (_, index) =>
    buildDistinctPilotExecutionFixture(index),
  );
  const bundle = bundles[0]!;
  const protocol = testRecord(bundle.studyProtocol);
  const completedCheckpointRuns = bundles.map((candidate) => {
    const checkpoint = testRecord(candidate.checkpoint);
    const completion = testRecord(candidate.completion);
    return {
      checkpointRef: {
        schemaVersion: "dayflow-ablation-checkpoint-v0.2",
        checkpointId: checkpoint.checkpointId,
        checkpointSha256: checkpoint.checkpointSha256,
      },
      checkpointCompletionRef: {
        schemaVersion: "dayflow-ablation-checkpoint-completion-v0.1",
        checkpointCompletionId: completion.checkpointCompletionId,
        checkpointCompletionSha256: completion.checkpointCompletionSha256,
      },
      runRefs: candidate.runs.map((runValue) => {
        const run = testRecord(runValue);
        return {
          schemaVersion: "dayflow-ablation-run-v0.4",
          runId: run.runId,
          runSha256: run.runSha256,
          armId: run.armId,
          replicateIndex: run.replicateIndex,
        };
      }),
    };
  });
  const generation = sealArtifact(
    "candidate-dataset-generation",
    "candidateDatasetGenerationSha256",
    {
      candidateDatasetGenerationSchemaVersion:
        "dayflow-ablation-candidate-dataset-generation-v0.1",
      candidateDatasetGenerationId: "pilot.generation.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
      completedCheckpointRuns,
      createdAt: "2026-08-17T09:09:00.000Z",
      candidateDatasetGenerationSha256: SHA,
    },
  );
  const generationRef = {
    schemaVersion:
      "dayflow-ablation-candidate-dataset-generation-v0.1",
    candidateDatasetGenerationId:
      generation.candidateDatasetGenerationId,
    candidateDatasetGenerationSha256:
      generation.candidateDatasetGenerationSha256,
  };
  const decisions = completedCheckpointRuns.map((entry, index) =>
    sealArtifact("exclusion-decision", "exclusionDecisionSha256", {
      exclusionDecisionSchemaVersion:
        "dayflow-ablation-exclusion-decision-v0.1",
      exclusionDecisionId: `pilot.decision.resolved.${String(index).padStart(2, "0")}`,
      lineageClass: "evidence",
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
      sourceGenerationRef: generationRef,
      checkpointRef: entry.checkpointRef,
      disposition: "include",
      reasonCode: "PILOT_INCLUDE",
      reviewerPseudonym: "pilot.reviewer.resolved.0",
      decidedAt: "2026-08-17T09:10:00.000Z",
      exclusionDecisionSha256: SHA,
    }),
  );
  const closure = sealArtifact(
    "exclusion-closure",
    "exclusionClosureSha256",
    {
      exclusionClosureSchemaVersion:
        "dayflow-ablation-exclusion-closure-v0.1",
      exclusionClosureId: "pilot.closure.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
      sourceGenerationRef: generationRef,
      decisionRefs: decisions.map((decision, index) => ({
        checkpointId:
          completedCheckpointRuns[index]!.checkpointRef.checkpointId,
        schemaVersion: "dayflow-ablation-exclusion-decision-v0.1",
        exclusionDecisionId: decision.exclusionDecisionId,
        exclusionDecisionSha256: decision.exclusionDecisionSha256,
      })),
      closedAt: "2026-08-17T09:11:00.000Z",
      exclusionClosureSha256: SHA,
    },
  );
  const includedCheckpointRuns = bundles.map((candidate, index) => ({
    checkpointRef: completedCheckpointRuns[index]!.checkpointRef,
    runRefs: candidate.runs.map((runValue) => {
      const run = testRecord(runValue);
      return {
        schemaVersion: "dayflow-ablation-run-v0.4",
        runId: run.runId,
        runSha256: run.runSha256,
        armId: run.armId,
        replicateIndex: run.replicateIndex,
        ...(run.armId === "A1" || run.armId === "B"
          ? { matchedPairId: run.matchedPairId }
          : {}),
      };
    }),
  }));
  const manifest = sealArtifact(
    "final-dataset-manifest",
    "datasetSha256",
    {
      finalDatasetManifestSchemaVersion:
        "dayflow-ablation-final-dataset-manifest-v0.1",
      lineageClass: "evidence",
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
      exclusionClosureRef: {
        schemaVersion: "dayflow-ablation-exclusion-closure-v0.1",
        exclusionClosureId: closure.exclusionClosureId,
        exclusionClosureSha256: closure.exclusionClosureSha256,
      },
      datasetVersion: "pilot-dataset-v0.1",
      includedCheckpointRuns,
      datasetSha256: SHA,
    },
  );
  const runBindings = includedCheckpointRuns.flatMap((entry) =>
    entry.runRefs.map((run) => {
      const common = {
        checkpointId: entry.checkpointRef.checkpointId,
        checkpointSha256: entry.checkpointRef.checkpointSha256,
        runId: run.runId,
        runSha256: run.runSha256,
        armId: run.armId,
        replicateIndex: run.replicateIndex,
      };
      return "matchedPairId" in run
        ? { ...common, matchedPairId: run.matchedPairId }
        : common;
    }),
  );
  const binding = sealArtifact(
    "final-dataset-binding",
    "finalDatasetBindingSha256",
    {
      finalDatasetBindingSchemaVersion:
        "dayflow-ablation-final-dataset-binding-v0.1",
      finalDatasetBindingId: "pilot.binding.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "live",
      studyPhase: "private_pilot",
      studyProtocolHash: protocol.studyProtocolHash,
      manifestRef: {
        schemaVersion: "dayflow-ablation-final-dataset-manifest-v0.1",
        datasetVersion: manifest.datasetVersion,
        datasetSha256: manifest.datasetSha256,
      },
      runBindings,
      createdAt: "2026-08-17T09:12:00.000Z",
      finalDatasetBindingSha256: SHA,
    },
  );
  const dag = { generation, decisions, closure, manifest, binding };
  const resolver: DayflowDatasetDagResolver = {
    resolveCandidateGeneration: () => undefined,
    resolveExecutionBundles: () => bundles,
  };
  const attestation = issuePilotVerificationAttestation({
    dag,
    resolver,
    pilotVerificationAttestationId: "pilot.verification-attestation.0",
    verifierVersion: "pilot-pre-purge-verifier-v0.1",
    verifiedAt: "2026-08-17T09:12:30.000Z",
  });
  if (checkpointCount === 15 && attestation === undefined) {
    throw new TypeError("Expected valid pilot verification attestation");
  }
  return {
    dag,
    bundle,
    bundles,
    resolver,
    attestation: attestation!,
    historicalAuthorityResolver:
      bundle.liveAuthority!.authorityResolver,
  };
}

function buildResolvedDagFixture(): Readonly<{
  dag: Record<string, unknown>;
  bundle: ResolvedExecutionBundleInput;
}> {
  const bundle = buildResolvedExecutionFixture();
  const checkpoint = bundle.checkpoint as Record<string, unknown>;
  const completion = bundle.completion as Record<string, unknown>;
  const runs = bundle.runs as readonly Record<string, unknown>[];
  const studyProtocol = bundle.studyProtocol as Record<string, unknown>;
  const checkpointRef = {
    schemaVersion: "dayflow-ablation-checkpoint-v0.2",
    checkpointId: checkpoint.checkpointId,
    checkpointSha256: checkpoint.checkpointSha256,
  };
  const generationRunRefs = runs.map((run) => ({
    schemaVersion: "dayflow-ablation-run-v0.4",
    runId: run.runId,
    runSha256: run.runSha256,
    armId: run.armId,
    replicateIndex: run.replicateIndex,
  }));
  const generation = sealArtifact(
    "candidate-dataset-generation",
    "candidateDatasetGenerationSha256",
    {
      candidateDatasetGenerationSchemaVersion:
        "dayflow-ablation-candidate-dataset-generation-v0.1",
      candidateDatasetGenerationId: "synthetic.generation.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      completedCheckpointRuns: [
        {
          checkpointRef,
          checkpointCompletionRef: {
            schemaVersion:
              "dayflow-ablation-checkpoint-completion-v0.1",
            checkpointCompletionId: completion.checkpointCompletionId,
            checkpointCompletionSha256:
              completion.checkpointCompletionSha256,
          },
          runRefs: generationRunRefs,
        },
      ],
      createdAt: "2026-08-17T09:09:00.000Z",
      candidateDatasetGenerationSha256: SHA,
    },
  );
  const generationRef = {
    schemaVersion:
      "dayflow-ablation-candidate-dataset-generation-v0.1",
    candidateDatasetGenerationId: generation.candidateDatasetGenerationId,
    candidateDatasetGenerationSha256:
      generation.candidateDatasetGenerationSha256,
  };
  const decision = sealArtifact(
    "exclusion-decision",
    "exclusionDecisionSha256",
    {
      exclusionDecisionSchemaVersion:
        "dayflow-ablation-exclusion-decision-v0.1",
      exclusionDecisionId: "synthetic.decision.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      sourceGenerationRef: generationRef,
      checkpointRef,
      disposition: "include",
      reasonCode: "SYNTHETIC_INCLUDE",
      reviewerPseudonym: "synthetic.reviewer.resolved.0",
      decidedAt: "2026-08-17T09:10:00.000Z",
      exclusionDecisionSha256: SHA,
    },
  );
  const closure = sealArtifact(
    "exclusion-closure",
    "exclusionClosureSha256",
    {
      exclusionClosureSchemaVersion:
        "dayflow-ablation-exclusion-closure-v0.1",
      exclusionClosureId: "synthetic.closure.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      sourceGenerationRef: generationRef,
      decisionRefs: [
        {
          checkpointId: checkpoint.checkpointId,
          schemaVersion: "dayflow-ablation-exclusion-decision-v0.1",
          exclusionDecisionId: decision.exclusionDecisionId,
          exclusionDecisionSha256: decision.exclusionDecisionSha256,
        },
      ],
      closedAt: "2026-08-17T09:11:00.000Z",
      exclusionClosureSha256: SHA,
    },
  );
  const manifestRunRefs = runs.map((run) => ({
    schemaVersion: "dayflow-ablation-run-v0.4",
    runId: run.runId,
    runSha256: run.runSha256,
    armId: run.armId,
    replicateIndex: run.replicateIndex,
    ...(run.armId === "A1" || run.armId === "B"
      ? { matchedPairId: run.matchedPairId }
      : {}),
  }));
  const manifest = sealArtifact(
    "final-dataset-manifest",
    "datasetSha256",
    {
      finalDatasetManifestSchemaVersion:
        "dayflow-ablation-final-dataset-manifest-v0.1",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      exclusionClosureRef: {
        schemaVersion: "dayflow-ablation-exclusion-closure-v0.1",
        exclusionClosureId: closure.exclusionClosureId,
        exclusionClosureSha256: closure.exclusionClosureSha256,
      },
      datasetVersion: "synthetic-resolved-dataset-v0.1",
      includedCheckpointRuns: [
        { checkpointRef, runRefs: manifestRunRefs },
      ],
      datasetSha256: SHA,
    },
  );
  const binding = sealArtifact(
    "final-dataset-binding",
    "finalDatasetBindingSha256",
    {
      finalDatasetBindingSchemaVersion:
        "dayflow-ablation-final-dataset-binding-v0.1",
      finalDatasetBindingId: "synthetic.binding.resolved.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: studyProtocol.studyProtocolHash,
      manifestRef: {
        schemaVersion: "dayflow-ablation-final-dataset-manifest-v0.1",
        datasetVersion: manifest.datasetVersion,
        datasetSha256: manifest.datasetSha256,
      },
      runBindings: manifestRunRefs.map((run) => ({
        checkpointId: checkpoint.checkpointId,
        checkpointSha256: checkpoint.checkpointSha256,
        ...run,
        schemaVersion: undefined,
      })).map(({ schemaVersion: _schemaVersion, ...run }) => run),
      createdAt: "2026-08-17T09:12:00.000Z",
      finalDatasetBindingSha256: SHA,
    },
  );
  return { dag: { generation, decisions: [decision], closure, manifest, binding }, bundle };
}

function testRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected test record");
  }
  return value as Record<string, unknown>;
}

function resealDagSuccessors(dag: Record<string, unknown>): void {
  const generation = testRecord(dag.generation);
  sealArtifact(
    "candidate-dataset-generation",
    "candidateDatasetGenerationSha256",
    generation,
  );
  const generationRef = {
    schemaVersion:
      "dayflow-ablation-candidate-dataset-generation-v0.1",
    candidateDatasetGenerationId:
      generation.candidateDatasetGenerationId,
    candidateDatasetGenerationSha256:
      generation.candidateDatasetGenerationSha256,
  };
  const decisions = dag.decisions;
  if (!Array.isArray(decisions)) throw new TypeError("Expected decisions");
  for (const decisionValue of decisions) {
    const decision = testRecord(decisionValue);
    decision.sourceGenerationRef = generationRef;
    sealArtifact("exclusion-decision", "exclusionDecisionSha256", decision);
  }
  const closure = testRecord(dag.closure);
  closure.sourceGenerationRef = generationRef;
  closure.decisionRefs = decisions.map((decisionValue) => {
    const decision = testRecord(decisionValue);
    const checkpointRef = testRecord(decision.checkpointRef);
    return {
      checkpointId: checkpointRef.checkpointId,
      schemaVersion: "dayflow-ablation-exclusion-decision-v0.1",
      exclusionDecisionId: decision.exclusionDecisionId,
      exclusionDecisionSha256: decision.exclusionDecisionSha256,
    };
  });
  sealArtifact("exclusion-closure", "exclusionClosureSha256", closure);
  const manifest = testRecord(dag.manifest);
  manifest.exclusionClosureRef = {
    schemaVersion: "dayflow-ablation-exclusion-closure-v0.1",
    exclusionClosureId: closure.exclusionClosureId,
    exclusionClosureSha256: closure.exclusionClosureSha256,
  };
  sealArtifact("final-dataset-manifest", "datasetSha256", manifest);
  const binding = testRecord(dag.binding);
  binding.manifestRef = {
    schemaVersion: "dayflow-ablation-final-dataset-manifest-v0.1",
    datasetVersion: manifest.datasetVersion,
    datasetSha256: manifest.datasetSha256,
  };
  sealArtifact(
    "final-dataset-binding",
    "finalDatasetBindingSha256",
    binding,
  );
}

describe("DFA-002 duplicate-aware synthetic loaders", () => {
  it("loads the strict config and the required synthetic vectors", () => {
    const config = loadDayflowAblationSyntheticConfig(configRaw);
    const cases = loadDayflowAblationSyntheticCases(casesRaw);

    expect(config.syntheticSentinel).toBe(SENTINEL);
    expect(config.rawHumanContentIncluded).toBe(false);
    expect(config.liveCaptureAllowed).toBe(false);
    expect(config.networkProviderCallsAllowed).toBe(false);
    expect(config.fixtureGeneratorConfigSha256).toBe(
      domainSeparatedSha256(
        "blabase.dayflow-ablation.fixture-generator-config.v0.2",
        {
          version: config.generationTuple.fixtureGeneratorVersion,
          seed: config.generationTuple.fixtureGeneratorSeed,
          syntheticOnly: config.generationTuple.syntheticOnly,
        },
      ),
    );
    expect(cases.fixtureGenerator.configSha256).toBe(
      config.fixtureGeneratorConfigSha256,
    );
    expect(Object.values(config.claimEligibility)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(cases.evidenceBoundaryVectors.map((entry) => entry.vectorKind)).toEqual([
      "observed",
      "valid_empty",
      "failure",
    ]);
    expect(cases.matchedInputVectors).toHaveLength(1);
    expect(cases.dagVectors).toHaveLength(1);
  });

  it("cross-validates the executable cases against the exact synthetic config", () => {
    const dataset = loadDayflowAblationSyntheticDataset(configRaw, casesRaw);
    expect(
      validateDayflowAblationSyntheticDataset(dataset.config, dataset.cases),
    ).toBe(true);

    const wrongSeed = structuredClone(dataset.cases);
    wrongSeed.fixtureGenerator.seed = "synthetic-wrong-seed";
    expect(
      validateDayflowAblationSyntheticDataset(dataset.config, wrongSeed),
    ).toBe(false);

    const liveNestedPayload = structuredClone(dataset.cases);
    liveNestedPayload.evidenceBoundaryVectors[0]!.payload.exportManifest.dataOrigin =
      "live";
    liveNestedPayload.evidenceBoundaryVectors[0]!.payload.exportManifest.studyPhase =
      "private_pilot";
    expect(
      validateDayflowAblationSyntheticDataset(
        dataset.config,
        liveNestedPayload,
      ),
    ).toBe(false);

    const foreignFixturePayload = structuredClone(dataset.cases);
    testRecord(
      foreignFixturePayload.evidenceBoundaryVectors[0]!.payload.exportManifest
        .databaseSnapshotIdentity,
    ).fixtureSetId = "synthetic.foreign.fixture-set.v0.1";
    expect(
      validateDayflowAblationSyntheticDataset(
        dataset.config,
        foreignFixturePayload,
      ),
    ).toBe(false);
  });

  it.each([
    '{"key":1,"key":2}',
    '{"outer":{"key":1,"key":2}}',
    '{"a":1,"\\u0061":2}',
  ])("rejects decoded duplicate keys before schema validation", (raw) => {
    try {
      parseDuplicateAwareJson(raw);
      throw new Error("expected duplicate rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DayflowJsonParseError);
      expect((error as DayflowJsonParseError).issueCode).toBe(
        "DUPLICATE_JSON_KEY",
      );
    }
  });

  it("parses nested JSON without last-key-wins behavior", () => {
    expect(parseDuplicateAwareJson('{"a":[true,null,{"b":"ok"}]}')).toEqual({
      a: [true, null, { b: "ok" }],
    });
    expect(() => parseDuplicateAwareJson('{"a":01}')).toThrow(
      DayflowJsonParseError,
    );
    expect(() => parseDuplicateAwareJson('"\\ud800"')).toThrow(
      DayflowJsonParseError,
    );
  });

  it("rejects negative zero in every shared unsigned evaluation primitive", () => {
    expect(Object.is(-0, -0)).toBe(true);
    expect(replicateIndexSchema.safeParse(-0).success).toBe(false);
    expect(counterSchema.safeParse(-0).success).toBe(false);
    expect(basisPointsSchema.safeParse(-0).success).toBe(false);
    expect(replicateIndexSchema.safeParse(0).success).toBe(true);
    expect(counterSchema.safeParse(0).success).toBe(true);
  });
});

describe("closed candidate registry and lineage", () => {
  it("matches the evidence registry's exact versions, domains, and storage modes", () => {
    expect(dayflowAblationArtifactRegistry).toHaveLength(30);
    expect(DAYFLOW_ABLATION_ARTIFACT_REGISTRY).toHaveLength(30);
    expect(
      dayflowAblationArtifactRegistry.find(
        (entry) => entry.artifactClass === "experiment-manifest",
      ),
    ).toEqual({
      artifactClass: "experiment-manifest",
      schemaVersion: "dayflow-ablation-experiment-manifest-v0.2",
      hashDomain: "blabase.dayflow-ablation.experiment-manifest.v0.2",
      storageMode: "standalone",
    });
    expect(
      dayflowAblationArtifactRegistry.find(
        (entry) => entry.artifactClass === "run-results",
      ),
    ).toEqual({
      artifactClass: "run-results",
      schemaVersion: "dayflow-ablation-run-results-v0.1",
      hashDomain: "blabase.dayflow-ablation.run-results.v0.1",
      storageMode: "standalone",
    });
    expect(DAYFLOW_ABLATION_REGISTRY_HASH_DOMAIN).toBe(
      "blabase.dayflow-ablation.artifact-registry.v0.2",
    );
    expect(
      dayflowAblationArtifactRegistry.map(
        ({ artifactClass, schemaVersion, hashDomain, storageMode }) => ({
          artifactClass,
          schemaVersion,
          hashDomain,
          storageMode,
        }),
      ),
    ).toEqual(DAYFLOW_ARTIFACT_REGISTRY);
    expect(
      new Set(dayflowAblationArtifactRegistry.map((entry) => entry.hashDomain)).size,
    ).toBe(30);
    expect(
      new Set(Object.values(DAYFLOW_ABLATION_DETACHED_HASH_FIELDS)).size,
    ).toBeGreaterThan(20);
    expect(Object.isFrozen(DAYFLOW_ARTIFACT_REGISTRY)).toBe(true);
    expect(Object.isFrozen(DAYFLOW_ARTIFACT_REGISTRY[0])).toBe(true);
    expect(Object.isFrozen(DAYFLOW_ABLATION_ARTIFACT_REGISTRY)).toBe(true);
    expect(Object.isFrozen(DAYFLOW_ABLATION_ARTIFACT_REGISTRY[0])).toBe(true);
    expect(Object.isFrozen(dayflowAblationArtifactRegistry)).toBe(true);
    expect(Object.isFrozen(dayflowAblationArtifactRegistry[0])).toBe(true);
    expect(Object.isFrozen(DFA002_CONTRACT_SOURCE_ENTRIES)).toBe(true);
    expect(Object.isFrozen(DFA002_CONTRACT_SOURCE_ENTRIES[0])).toBe(true);
    expect(DFA002_CONTRACT_SOURCE_ENTRIES).toHaveLength(11);
    expect(DFA002_REQUIRED_PROVENANCE_PIN_SHAPES).toHaveLength(22);
    expect(Object.isFrozen(DFA002_REQUIRED_COMMANDS)).toBe(true);
    expect(Object.isFrozen(DFA002_REQUIRED_COMMANDS[0])).toBe(true);
    expect(DFA002_REQUIRED_COMMANDS.map((entry) => entry.commandId)).toEqual([
      "dfa002-depcruise",
      "dfa002-eslint",
      "dfa002-tsc",
      "dfa002-vitest",
    ]);
    const commandArgv = DFA002_REQUIRED_COMMANDS.map(({ argv }) =>
      argv.join("\n"),
    ).join("\n");
    for (const deletedPath of [
      "src/evaluation/dayflowAblation/governanceAdapters.ts",
      "tests/dayflowGovernanceAdapters.test.ts",
    ]) {
      expect(commandArgv).not.toContain(deletedPath);
    }
    expect(DFA002_COMMAND_DEFINING_INPUTS).toEqual([
      "dependency-cruiser.config.mjs",
      "dependency-cruiser.suggestion.config.mjs",
      "package-lock.json",
      "package.json",
      "suggestion/eslint.config.mjs",
      "suggestion/package-lock.json",
      "suggestion/package.json",
      "suggestion/tsconfig.dayflow-dfa002.json",
      "suggestion/tsconfig.json",
      "suggestion/vitest.dayflow-dfa002.config.ts",
    ]);
    const registryHash = dayflowAblationRegistrySha256();
    expect(() => {
      (dayflowAblationArtifactRegistry[0] as { hashDomain: string }).hashDomain =
        "blabase.synthetic.mutation.v0.1";
    }).toThrow();
    expect(dayflowAblationRegistrySha256()).toBe(registryHash);
  });

  it("accepts only the three closed evidence origin/phase pairs", () => {
    const base = { lineageClass: "evidence", studyProtocolHash: SHA } as const;
    expect(
      evidenceLineageSchema.safeParse({
        ...base,
        dataOrigin: "synthetic",
        studyPhase: "contract_conformance",
      }).success,
    ).toBe(true);
    expect(
      evidenceLineageSchema.safeParse({
        ...base,
        dataOrigin: "live",
        studyPhase: "private_pilot",
      }).success,
    ).toBe(true);
    expect(
      evidenceLineageSchema.safeParse({
        ...base,
        dataOrigin: "live",
        studyPhase: "directional_study",
      }).success,
    ).toBe(true);
    expect(
      evidenceLineageSchema.safeParse({
        ...base,
        dataOrigin: "synthetic",
        studyPhase: "private_pilot",
      }).success,
    ).toBe(false);
    expect(
      evidenceLineageSchema.safeParse({
        ...base,
        dataOrigin: "live",
        studyPhase: "contract_conformance",
      }).success,
    ).toBe(false);
  });
});

describe("standalone run-results contract", () => {
  it("accepts strict lineage and exact terminal run references", () => {
    const runResults = buildRunResultsFixture();
    const parsed = runResultsSchema.parse(runResults);
    expect(dayflowAblationRunResultsSha256(parsed)).toBe(
      runResults.runResultsSha256,
    );
    expect(
      runResultsRefSchema.safeParse({
        schemaVersion: runResults.runResultsSchemaVersion,
        runResultsId: runResults.runResultsId,
        runResultsSha256: runResults.runResultsSha256,
      }).success,
    ).toBe(true);
  });

  it("rejects unsorted, duplicate, or inlined terminal run details", () => {
    const unsorted = structuredClone(buildRunResultsFixture());
    unsorted.terminalArmRunRefs.reverse();
    sealArtifact("run-results", "runResultsSha256", unsorted);
    expect(runResultsSchema.safeParse(unsorted).success).toBe(false);

    const duplicate = structuredClone(buildRunResultsFixture());
    duplicate.terminalArmRunRefs[1] = structuredClone(
      duplicate.terminalArmRunRefs[0]!,
    );
    sealArtifact("run-results", "runResultsSha256", duplicate);
    expect(runResultsSchema.safeParse(duplicate).success).toBe(false);

    const inlinedStatus = structuredClone(buildRunResultsFixture());
    Object.assign(inlinedStatus.terminalArmRunRefs[0]!, {
      status: "completed",
    });
    sealArtifact("run-results", "runResultsSha256", inlinedStatus);
    expect(runResultsSchema.safeParse(inlinedStatus).success).toBe(false);
  });

  it("rejects a detached hash or protocol-lineage mismatch", () => {
    const wrongHash = structuredClone(buildRunResultsFixture());
    wrongHash.runResultsSha256 = SHA;
    expect(runResultsSchema.safeParse(wrongHash).success).toBe(false);

    const wrongProtocol = structuredClone(buildRunResultsFixture());
    wrongProtocol.studyProtocolHash = "f".repeat(64);
    sealArtifact("run-results", "runResultsSha256", wrongProtocol);
    expect(runResultsSchema.safeParse(wrongProtocol).success).toBe(false);
  });
});

describe("study protocol freeze boundary", () => {
  it("requires a strict Colin-owned, hash-bound experiment manifest", () => {
    const fixture = buildResolvedExecutionFixture();
    expect(experimentManifestSchema.safeParse(fixture.experimentManifest).success)
      .toBe(true);
    expect(
      experimentManifestRefSchema.safeParse(
        testRecord(fixture.studyProtocol).experimentManifestRef,
      ).success,
    ).toBe(true);

    const wrongOwner = structuredClone(testRecord(fixture.experimentManifest));
    wrongOwner.ownerPseudonym = "synthetic.other-owner.0";
    sealArtifact(
      "experiment-manifest",
      "experimentManifestSha256",
      wrongOwner,
    );
    expect(experimentManifestSchema.safeParse(wrongOwner).success).toBe(false);

    const unknownField = {
      ...testRecord(fixture.experimentManifest),
      reviewerPseudonym: "synthetic.other-reviewer.0",
    };
    expect(experimentManifestSchema.safeParse(unknownField).success).toBe(false);

    const invalidProvenance = structuredClone(
      testRecord(fixture.experimentManifest),
    );
    testRecord(invalidProvenance.sourceProvenance).sourceProvenanceSha256 = SHA;
    sealArtifact(
      "experiment-manifest",
      "experimentManifestSha256",
      invalidProvenance,
    );
    expect(experimentManifestSchema.safeParse(invalidProvenance).success).toBe(
      false,
    );
  });

  it("keeps a pre-freeze synthetic candidate ineligible and non-executable", () => {
    const frozen = testRecord(buildResolvedExecutionFixture().studyProtocol);
    expect(studyProtocolSchema.safeParse(frozen).success).toBe(true);
    expect(executableStudyProtocolSchema.safeParse(frozen).success).toBe(true);

    const candidate = structuredClone(frozen);
    delete candidate.experimentManifestRef;
    testRecord(candidate.armPolicy).enabledArms = ["A1", "B"];
    testRecord(candidate.armPolicy).replicateCountByArm = {
      A0: 0,
      A1: 1,
      B: 1,
      C: 0,
    };
    testRecord(candidate.claimEligibility).contractConformance = false;
    sealArtifact("study-protocol", "studyProtocolHash", candidate);
    expect(studyProtocolSchema.safeParse(candidate).success).toBe(true);
    expect(executableStudyProtocolSchema.safeParse(candidate).success).toBe(
      false,
    );

    testRecord(candidate.claimEligibility).quality = true;
    sealArtifact("study-protocol", "studyProtocolHash", candidate);
    expect(studyProtocolSchema.safeParse(candidate).success).toBe(false);
  });

  it("resolves a current private-pilot approval and rejects revoked or closed authority", () => {
    const valid = buildResolvedLiveAuthorityFixture();
    expect(verifyResolvedLiveExecutionAuthority(valid)).toMatchObject({
      valid: true,
      issueCodes: [],
    });
    const missingResolver = buildResolvedLiveAuthorityFixture();
    expect(
      verifyResolvedLiveExecutionAuthority({
        ...missingResolver,
        authorityResolver: undefined,
      } as unknown as Parameters<typeof verifyResolvedLiveExecutionAuthority>[0]),
    ).toMatchObject({
      valid: false,
      issueCodes: ["LIVE_AUTHORITY_SCHEMA_INVALID"],
    });

    const legacyCallerAuthority = buildResolvedLiveAuthorityFixture();
    expect(
      verifyResolvedLiveExecutionAuthority({
        ...legacyCallerAuthority,
        liveCollectionFreezes: [],
        liveCollectionFreezeHeadRef: {},
      } as unknown as Parameters<typeof verifyResolvedLiveExecutionAuthority>[0]),
    ).toMatchObject({
      valid: false,
      issueCodes: ["LIVE_AUTHORITY_SCHEMA_INVALID"],
    });

    const revoked = buildResolvedLiveAuthorityFixture();
    const revokedResolver = mockLiveResolver(revoked);
    const approval = mockAuthorityArtifact(
      revoked,
      (artifact) => artifact.approvalType === "H-LIVE-CAPTURE",
    );
    approval.revokedAt = "2026-08-17T09:03:30.000Z";
    sealArtifact(
      "human-approval-record",
      "approvalRecordSha256",
      approval,
    );
    const revokedFreeze = mockAuthorityArtifact(
      revoked,
      (artifact) => artifact.liveCollectionFreezeId !== undefined,
    );
    const revokedApprovalRefs = revokedFreeze.approvalRefs;
    if (!Array.isArray(revokedApprovalRefs)) {
      throw new TypeError("Expected approvals");
    }
    testRecord(revokedApprovalRefs[0]).approvalRecordSha256 =
      approval.approvalRecordSha256;
    sealArtifact(
      "live-collection-freeze",
      "liveCollectionFreezeSha256",
      revokedFreeze,
    );
    revokedResolver.headRef.liveCollectionFreezeSha256 =
      revokedFreeze.liveCollectionFreezeSha256;
    const revokedResult = verifyResolvedLiveExecutionAuthority(revoked);
    expect(revokedResult.valid).toBe(false);
    expect(revokedResult.issueCodes).toContain(
      "LIVE_AUTHORITY_CURRENTNESS_INVALID",
    );

    const policyDrift = buildResolvedLiveAuthorityFixture();
    const policyDriftResolver = mockLiveResolver(policyDrift);
    const policyDriftFreeze = mockAuthorityArtifact(
      policyDrift,
      (artifact) => artifact.liveCollectionFreezeId !== undefined,
    );
    policyDriftFreeze.metricFormulaVersion = "synthetic-metric-drift-v0.1";
    sealArtifact(
      "live-collection-freeze",
      "liveCollectionFreezeSha256",
      policyDriftFreeze,
    );
    policyDriftResolver.headRef.liveCollectionFreezeSha256 =
      String(policyDriftFreeze.liveCollectionFreezeSha256);
    const policyDriftResult =
      verifyResolvedLiveExecutionAuthority(policyDrift);
    expect(policyDriftResult.valid).toBe(false);
    expect(policyDriftResult.issueCodes).toContain(
      "LIVE_AUTHORITY_SCOPE_MISMATCH",
    );

    const closed = buildResolvedLiveAuthorityFixture();
    const closedResolver = mockLiveResolver(closed);
    const approvedFreeze = mockAuthorityArtifact(
      closed,
      (artifact) => artifact.liveCollectionFreezeId !== undefined,
    );
    const closedFreeze = structuredClone(approvedFreeze);
    closedFreeze.liveCollectionFreezeId =
      "synthetic.live-collection-freeze.closed.0";
    closedFreeze.status = "closed";
    delete closedFreeze.approvedAt;
    closedFreeze.closedAt = "2026-08-17T09:03:30.000Z";
    closedFreeze.closureReasonCode = "SYNTHETIC_LIVE_CLOSED";
    closedFreeze.supersedesLiveCollectionFreezeRef = {
      schemaVersion: "dayflow-ablation-live-collection-freeze-v0.3",
      liveCollectionFreezeId: approvedFreeze.liveCollectionFreezeId,
      liveCollectionFreezeSha256:
        approvedFreeze.liveCollectionFreezeSha256,
    };
    sealArtifact(
      "live-collection-freeze",
      "liveCollectionFreezeSha256",
      closedFreeze,
    );
    closedResolver.artifacts.set(authorityArtifactKey(closedFreeze), closedFreeze);
    closedResolver.headRef = {
      schemaVersion: "dayflow-ablation-live-collection-freeze-v0.3",
      liveCollectionFreezeId: String(closedFreeze.liveCollectionFreezeId),
      liveCollectionFreezeSha256: String(
        closedFreeze.liveCollectionFreezeSha256,
      ),
    };
    const closedResult = verifyResolvedLiveExecutionAuthority(closed);
    expect(closedResult.valid).toBe(false);
    expect(closedResult.issueCodes).toContain(
      "LIVE_AUTHORITY_FREEZE_GRAPH_INVALID",
    );
  });

  it("rejects authority first approved after capture started", () => {
    const late = buildResolvedLiveAuthorityFixture();
    const lateResolver = mockLiveResolver(late);
    const approval = mockAuthorityArtifact(
      late,
      (artifact) => artifact.approvalType === "H-LIVE-CAPTURE",
    );
    approval.approvedAt = "2026-08-17T09:03:45.000Z";
    approval.validFrom = "2026-08-17T09:03:45.000Z";
    sealArtifact(
      "human-approval-record",
      "approvalRecordSha256",
      approval,
    );
    const freeze = mockAuthorityArtifact(
      late,
      (artifact) => artifact.liveCollectionFreezeId !== undefined,
    );
    const approvalRefs = freeze.approvalRefs;
    if (!Array.isArray(approvalRefs)) throw new TypeError("Expected approvals");
    testRecord(approvalRefs[0]).approvalRecordSha256 =
      approval.approvalRecordSha256;
    sealArtifact(
      "live-collection-freeze",
      "liveCollectionFreezeSha256",
      freeze,
    );
    lateResolver.headRef.liveCollectionFreezeSha256 = String(
      freeze.liveCollectionFreezeSha256,
    );
    const result = verifyResolvedLiveExecutionAuthority(late);
    expect(result.valid).toBe(false);
    expect(result.issueCodes).toContain("LIVE_AUTHORITY_CURRENTNESS_INVALID");
  });

  it("resolves pilot binding/deletion evidence and rejects missing or failed deletion", () => {
    const resealPilotAuthority = (
      fixture: ReturnType<typeof buildDirectionalLiveAuthorityFixture>,
    ) => {
      const resolver = mockLiveResolver(fixture);
      const receipt = testRecord(fixture.pilotDeletionReceipts[0]);
      const pilotApproval = mockAuthorityArtifact(
        fixture,
        (artifact) => artifact.approvalType === "H-PILOT-GO",
      );
      const deletionRefs = pilotApproval.pilotDeletionEvidenceRefs;
      if (!Array.isArray(deletionRefs)) {
        throw new TypeError("Expected receipts");
      }
      testRecord(deletionRefs[0]).deletionReceiptSha256 =
        receipt.deletionReceiptSha256;
      sealArtifact(
        "human-approval-record",
        "approvalRecordSha256",
        pilotApproval,
      );
      const freeze = mockAuthorityArtifact(
        fixture,
        (artifact) => artifact.liveCollectionFreezeId !== undefined,
      );
      const approvalRefs = freeze.approvalRefs;
      if (!Array.isArray(approvalRefs)) {
        throw new TypeError("Expected live-freeze approvals");
      }
      const pilotRef = approvalRefs.find(
        (entry) => testRecord(entry).approvalType === "H-PILOT-GO",
      );
      testRecord(pilotRef).approvalRecordSha256 =
        pilotApproval.approvalRecordSha256;
      sealArtifact(
        "live-collection-freeze",
        "liveCollectionFreezeSha256",
        freeze,
      );
      resolver.headRef.liveCollectionFreezeSha256 =
        freeze.liveCollectionFreezeSha256;
    };
    const valid = buildDirectionalLiveAuthorityFixture();
    const parsedPilotDag = dayflowDatasetDagSchema.safeParse(
      valid.pilotDatasetDag,
    );
    expect(parsedPilotDag.success).toBe(true);
    expect(verifyResolvedLiveExecutionAuthority(valid)).toMatchObject({
      valid: true,
      issueCodes: [],
    });
    expect("pilotDatasetDagResolver" in valid).toBe(false);
    expect(JSON.stringify(valid.pilotDatasetDag)).not.toContain(
      "artifactBlobs",
    );
    const retainedAttestation = pilotVerificationAttestationSchema.parse(
      valid.pilotVerificationAttestation,
    );
    const historicalResolver =
      valid.pilotHistoricalAuthorityResolver as MockLiveAuthorityResolver;
    expect(
      testRecord(
        historicalResolver.artifacts.get(
          authorityArtifactKey(historicalResolver.headRef),
        ),
      ).status,
    ).toBe("closed");
    expect(
      testRecord(
        historicalResolver.artifacts.get(
          authorityArtifactKey(historicalResolver.historicalHeadRef),
        ),
      ).status,
    ).toBe("approved");
    const exactDeadline = retainedAttestation.checkpoints
      .flatMap((checkpoint) => checkpoint.rawPurgeObligations)
      .map((entry) => entry.blabaseRawCopyDeleteBy)
      .sort()[0];
    expect(
      testRecord(valid.pilotDeletionReceipts[0]).blabaseRawCopyPurgedAt,
    ).toBe(exactDeadline);

    const tamperedAttestation = buildDirectionalLiveAuthorityFixture();
    const attestationRecord = testRecord(
      tamperedAttestation.pilotVerificationAttestation,
    );
    const attestedCheckpoints = attestationRecord.checkpoints;
    if (!Array.isArray(attestedCheckpoints)) {
      throw new TypeError("Expected attested checkpoints");
    }
    testRecord(attestedCheckpoints[0]).executionBundleProofSha256 =
      "f".repeat(64);
    sealArtifact(
      "pilot-verification-attestation",
      "pilotVerificationAttestationSha256",
      attestationRecord,
    );
    expect(
      verifyResolvedLiveExecutionAuthority(tamperedAttestation).issueCodes,
    ).toContain("LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID");

    const missing = buildDirectionalLiveAuthorityFixture();
    missing.pilotDeletionReceipts = [];
    const missingResult = verifyResolvedLiveExecutionAuthority(missing);
    expect(missingResult.valid).toBe(false);
    expect(missingResult.issueCodes).toContain(
      "LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID",
    );

    const unresolvedPilotDag = buildDirectionalLiveAuthorityFixture();
    unresolvedPilotDag.pilotVerificationAttestation = undefined;
    expect(
      verifyResolvedLiveExecutionAuthority(unresolvedPilotDag).issueCodes,
    ).toContain("LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID");

    const arbitraryClosure = buildDirectionalLiveAuthorityFixture();
    const arbitraryClosureRecord = testRecord(
      testRecord(arbitraryClosure.pilotDatasetDag).closure,
    );
    const arbitraryDecisionRefs = arbitraryClosureRecord.decisionRefs;
    if (!Array.isArray(arbitraryDecisionRefs)) {
      throw new TypeError("Expected pilot decisions");
    }
    testRecord(arbitraryDecisionRefs[0]).checkpointId =
      "pilot.unrelated-checkpoint.0";
    sealArtifact(
      "exclusion-closure",
      "exclusionClosureSha256",
      arbitraryClosureRecord,
    );
    expect(
      verifyResolvedLiveExecutionAuthority(arbitraryClosure).issueCodes,
    ).toContain("LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID");

    const failed = buildDirectionalLiveAuthorityFixture();
    const receipt = testRecord(failed.pilotDeletionReceipts[0]);
    receipt.blabaseRawCopyStatus = "failed";
    delete receipt.blabaseRawCopyPurgedAt;
    sealArtifact("deletion-receipt", "deletionReceiptSha256", receipt);
    resealPilotAuthority(failed);
    const failedResult = verifyResolvedLiveExecutionAuthority(failed);
    expect(failedResult.valid).toBe(false);
    expect(failedResult.issueCodes).toContain(
      "LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID",
    );

    const oneMillisecondLate = buildDirectionalLiveAuthorityFixture();
    const lateReceipt = testRecord(oneMillisecondLate.pilotDeletionReceipts[0]);
    const originalPurge = String(lateReceipt.blabaseRawCopyPurgedAt);
    lateReceipt.blabaseRawCopyPurgedAt = new Date(
      Date.parse(originalPurge) + 1,
    ).toISOString();
    sealArtifact(
      "deletion-receipt",
      "deletionReceiptSha256",
      lateReceipt,
    );
    resealPilotAuthority(oneMillisecondLate);
    expect(
      verifyResolvedLiveExecutionAuthority(oneMillisecondLate).issueCodes,
    ).toContain("LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID");

    receipt.blabaseRawCopyStatus = "deleted";
    receipt.blabaseRawCopyPurgedAt = "2026-08-17T09:13:00.000Z";
    receipt.affectedArtifactRefs = [
      {
        artifactType: "aggregate",
        schemaVersion: "dayflow-ablation-aggregate-v0.1",
        artifactId: "synthetic.unrelated-aggregate.0",
        artifactSha256: "c".repeat(64),
      },
    ];
    sealArtifact("deletion-receipt", "deletionReceiptSha256", receipt);
    resealPilotAuthority(failed);
    const unrelatedResult = verifyResolvedLiveExecutionAuthority(failed);
    expect(unrelatedResult.valid).toBe(false);
    expect(unrelatedResult.issueCodes).toContain(
      "LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID",
    );
  });
});

describe("sealed aggregate arithmetic", () => {
  function aggregateFixture() {
    const armMetrics = {
      acceptableAt1: {
        acceptableCount: 0,
        eligibleCount: 1,
        excludedCount: 0,
        rate: "0",
      },
      acceptableAt3: {
        acceptableCount: 1,
        eligibleCount: 1,
        excludedCount: 0,
        rate: "1",
      },
    };
    return sealArtifact("aggregate", "aggregateSha256", {
      aggregateSchemaVersion: "dayflow-ablation-aggregate-v0.1",
      analysisId: "synthetic.aggregate.contract.0",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: SHA,
      finalDatasetBindingId: "synthetic.binding.contract.0",
      finalDatasetBindingSha256: SHA,
      datasetVersion: "synthetic-dataset-v0.1",
      datasetSha256: SHA,
      claimScope: {
        contractConformance: false,
        quality: false,
        baseline: false,
        release: false,
        hPilotGo: false,
        hE2: false,
      },
      metrics: {
        byArm: {
          A0: structuredClone(armMetrics),
          A1: structuredClone(armMetrics),
          B: structuredClone(armMetrics),
          C: structuredClone(armMetrics),
        },
      },
      aggregateSha256: SHA,
    });
  }

  it("derives canonical rates and enforces denominator/At1-At3 parity", () => {
    const valid = aggregateFixture();
    expect(aggregateSchema.safeParse(valid).success).toBe(true);

    const contradictoryRate = structuredClone(valid);
    contradictoryRate.metrics.byArm.A1.acceptableAt1.rate = "1";
    sealArtifact("aggregate", "aggregateSha256", contradictoryRate);
    expect(aggregateSchema.safeParse(contradictoryRate).success).toBe(false);

    const denominatorDrift = structuredClone(valid);
    denominatorDrift.metrics.byArm.B.acceptableAt3.eligibleCount = 2;
    denominatorDrift.metrics.byArm.B.acceptableAt3.rate = "0.500000";
    sealArtifact("aggregate", "aggregateSha256", denominatorDrift);
    expect(aggregateSchema.safeParse(denominatorDrift).success).toBe(false);

    const monotonicityDrift = structuredClone(valid);
    monotonicityDrift.metrics.byArm.C.acceptableAt1.acceptableCount = 1;
    monotonicityDrift.metrics.byArm.C.acceptableAt1.rate = "1";
    monotonicityDrift.metrics.byArm.C.acceptableAt3.acceptableCount = 0;
    monotonicityDrift.metrics.byArm.C.acceptableAt3.rate = "0";
    sealArtifact("aggregate", "aggregateSha256", monotonicityDrift);
    expect(aggregateSchema.safeParse(monotonicityDrift).success).toBe(false);
  });
});

describe("arm isolation and forward-only dataset graph", () => {
  it("accepts the fixture A1/B pair and rejects causal or screen contamination", () => {
    const [vector] = loadDayflowAblationSyntheticCases(casesRaw).matchedInputVectors;
    expect(vector).toBeDefined();
    if (!vector) return;

    expect(validateMatchedA1BInputs(vector.a1Input, vector.bInput)).toBe(true);

    expect(
      armInputSchema.safeParse({
        ...vector.a1Input,
        presentationPolicyRef: {
          ...vector.a1Input.presentationPolicyRef,
          sha256: "f".repeat(64),
        },
      }).success,
    ).toBe(false);

    expect(
      armInputSchema.safeParse({
        ...vector.a1Input,
        normalizedEvidenceRef: vector.bInput.normalizedEvidenceRef,
      }).success,
    ).toBe(false);

    expect(
      validateMatchedA1BInputs(vector.a1Input, {
        ...vector.bInput,
        structuredCandidateHash: "f".repeat(64),
      }),
    ).toBe(false);

    const mixedOriginB = {
      ...vector.bInput,
      dataOrigin: "live" as const,
      studyPhase: "private_pilot" as const,
    };
    mixedOriginB.armInputHash = hashRegisteredArtifact(
      "b-arm-input",
      mixedOriginB,
    );
    expect(armInputSchema.safeParse(mixedOriginB).success).toBe(true);
    expect(validateMatchedA1BInputs(vector.a1Input, mixedOriginB)).toBe(false);

    const screenOnly = {
      ...vector.bInput,
      armId: "C",
      armInputId: "synthetic.arm-input.c.0",
      inputKind: "screen_only_generation",
      generationTupleSelector: "cScreenOnlyTuple",
    };
    expect(armInputSchema.safeParse(screenOnly).success).toBe(false);

    const requestContaminatedA0 = testRecord(
      structuredClone(buildResolvedExecutionFixture().armInputs[0]),
    );
    requestContaminatedA0.requestId = "synthetic.request.forbidden.a0";
    requestContaminatedA0.requestPosition = "0";
    sealArtifact("a0-arm-input", "armInputHash", requestContaminatedA0);
    expect(armInputSchema.safeParse(requestContaminatedA0).success).toBe(false);
  });

  it("accepts a valid generation-decision-closure-manifest-binding DAG", () => {
    const [dag] = loadDayflowAblationSyntheticCases(casesRaw).dagVectors;
    expect(dag).toBeDefined();
    expect(validateDayflowDatasetDag(dag)).toBe(true);
    expect(dayflowDatasetDagSchema.safeParse(dag).success).toBe(true);
  });

  it("rejects mixed lineage, reverse fields, and non-bijective final bindings", () => {
    const [fixtureDag] = loadDayflowAblationSyntheticCases(casesRaw).dagVectors;
    expect(fixtureDag).toBeDefined();
    if (!fixtureDag) return;

    const mixed = structuredClone(fixtureDag);
    mixed.closure.dataOrigin = "live";
    mixed.closure.studyPhase = "private_pilot";
    expect(validateDayflowDatasetDag(mixed)).toBe(false);

    const reverse = structuredClone(fixtureDag) as Record<string, unknown>;
    (reverse.generation as Record<string, unknown>).successorRef = {
      exclusionClosureId: fixtureDag.closure.exclusionClosureId,
    };
    expect(validateDayflowDatasetDag(reverse)).toBe(false);

    const missingBinding = structuredClone(fixtureDag);
    missingBinding.binding.runBindings.pop();
    expect(validateDayflowDatasetDag(missingBinding)).toBe(false);

    const wrongCheckpointHash = structuredClone(fixtureDag);
    wrongCheckpointHash.decisions[0]!.checkpointRef.checkpointSha256 =
      "f".repeat(64);
    wrongCheckpointHash.decisions[0]!.exclusionDecisionSha256 =
      hashRegisteredArtifact(
        "exclusion-decision",
        wrongCheckpointHash.decisions[0]!,
      );
    wrongCheckpointHash.closure.decisionRefs[0]!.exclusionDecisionSha256 =
      wrongCheckpointHash.decisions[0]!.exclusionDecisionSha256;
    wrongCheckpointHash.closure.exclusionClosureSha256 = hashRegisteredArtifact(
      "exclusion-closure",
      wrongCheckpointHash.closure,
    );
    wrongCheckpointHash.manifest.exclusionClosureRef.exclusionClosureSha256 =
      wrongCheckpointHash.closure.exclusionClosureSha256;
    wrongCheckpointHash.manifest.datasetSha256 = hashRegisteredArtifact(
      "final-dataset-manifest",
      wrongCheckpointHash.manifest,
    );
    wrongCheckpointHash.binding.manifestRef.datasetSha256 =
      wrongCheckpointHash.manifest.datasetSha256;
    wrongCheckpointHash.binding.finalDatasetBindingSha256 =
      hashRegisteredArtifact(
        "final-dataset-binding",
        wrongCheckpointHash.binding,
      );
    expect(validateDayflowDatasetDag(wrongCheckpointHash)).toBe(false);
  });

  it("requires exactly one A1 and one B request per matched group", () => {
    const base = {
      requestOrderManifestSchemaVersion:
        "dayflow-ablation-request-order-manifest-v0.1",
      requestOrderManifestId: "synthetic.request-order.test",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: SHA,
      algorithmVersion: "request-order-v0.1",
      seed: "synthetic-seed",
      entries: [
        {
          position: "0",
          checkpointId: "synthetic.checkpoint.0",
          checkpointSha256: SHA,
          matchedPairId: "synthetic.matched-pair.0",
          replicateIndex: 0,
          armId: "A1",
          requestId: "synthetic.request.a1.0",
        },
        {
          position: "1",
          checkpointId: "synthetic.checkpoint.0",
          checkpointSha256: SHA,
          matchedPairId: "synthetic.matched-pair.0",
          replicateIndex: 0,
          armId: "B",
          requestId: "synthetic.request.b.0",
        },
      ],
      createdAt: NOW,
      requestOrderManifestSha256: SHA,
    } as const;
    const sealed = {
      ...base,
      requestOrderManifestSha256: hashRegisteredArtifact(
        "request-order-manifest",
        base,
      ),
    };
    expect(requestOrderManifestSchema.safeParse(sealed).success).toBe(true);
    expect(
      requestOrderManifestSchema.safeParse({
        ...sealed,
        entries: sealed.entries.slice(0, 1),
      }).success,
    ).toBe(false);

    const duplicateArm = {
      ...sealed,
      entries: [
        sealed.entries[0],
        {
          ...sealed.entries[0],
          position: "1",
          requestId: "synthetic.request.a1.duplicate",
        },
        { ...sealed.entries[1], position: "2" },
      ],
    };
    duplicateArm.requestOrderManifestSha256 = hashRegisteredArtifact(
      "request-order-manifest",
      duplicateArm,
    );
    expect(requestOrderManifestSchema.safeParse(duplicateArm).success).toBe(false);
  });

  it("rejects duplicate completion keys even when the detached hash is valid", () => {
    const completion = {
      checkpointCompletionSchemaVersion:
        "dayflow-ablation-checkpoint-completion-v0.1",
      checkpointCompletionId: "synthetic.completion.duplicate",
      lineageClass: "evidence",
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: SHA,
      studyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: SHA,
      },
      checkpointRef: {
        schemaVersion: "dayflow-ablation-checkpoint-v0.2",
        checkpointId: "synthetic.checkpoint.duplicate",
        checkpointSha256: SHA,
      },
      executionFreezeRef: {
        schemaVersion: "dayflow-ablation-evaluation-execution-freeze-v0.3",
        evaluationExecutionFreezeId: "synthetic.freeze.duplicate",
        evaluationExecutionFreezeSha256: SHA,
      },
      expectedRunKeys: [
        { armId: "A1", replicateIndex: 0 },
        { armId: "A1", replicateIndex: 0 },
      ],
      completionStatus: "completed",
      presentRunRefs: [
        {
          schemaVersion: "dayflow-ablation-run-v0.4",
          runId: "synthetic.run.a1.first",
          runSha256: SHA,
          armId: "A1",
          replicateIndex: 0,
        },
        {
          schemaVersion: "dayflow-ablation-run-v0.4",
          runId: "synthetic.run.a1.second",
          runSha256: SHA,
          armId: "A1",
          replicateIndex: 0,
        },
      ],
      missingExpectedRunKeys: [],
      failedRunKeys: [],
      noOutputRunKeys: [],
      completedAt: NOW,
      checkpointCompletionSha256: SHA,
    };
    completion.checkpointCompletionSha256 = hashRegisteredArtifact(
      "checkpoint-completion",
      completion,
    );
    expect(checkpointCompletionSchema.safeParse(completion).success).toBe(false);
  });
});

describe("resolved execution and dataset DAG verification", () => {
  it("accepts an exact, completed frozen four-arm execution bundle", () => {
    const verification = verifyResolvedExecutionBundle(
      buildResolvedExecutionFixture(),
    );
    expect(verification.valid).toBe(true);
    if (verification.valid) {
      expect(verification.bundle.runs.map((run) => run.armId)).toEqual([
        "A0",
        "A1",
        "B",
        "C",
      ]);
    }
  });

  it("binds exact normalized evidence and artifact bytes to B/C only", () => {
    const valid = buildResolvedExecutionFixture();
    expect(valid.screenEvidence.artifactBlobs).toHaveLength(1);
    expect(verifyResolvedExecutionBundle(valid).valid).toBe(true);

    const originalBlobFixture = buildResolvedExecutionFixture();
    const tamperedBlob: ResolvedExecutionBundleInput = {
      ...originalBlobFixture,
      screenEvidence: {
        ...originalBlobFixture.screenEvidence,
        artifactBlobs: [
          {
            ...originalBlobFixture.screenEvidence.artifactBlobs[0]!,
            bytes: new TextEncoder().encode("SYNTHETIC_TAMPERED_FRAME"),
          },
        ],
      },
    };
    const tamperedBlobResult = verifyResolvedExecutionBundle(tamperedBlob);
    expect(tamperedBlobResult.valid).toBe(false);
    if (!tamperedBlobResult.valid) {
      expect(tamperedBlobResult.issueCodes).toContain(
        "EXECUTION_SCREEN_EVIDENCE_INVALID",
      );
    }

    const substitutedRef = buildResolvedExecutionFixture();
    const bInput = testRecord(substitutedRef.armInputs[2]);
    testRecord(bInput.normalizedEvidenceRef).evidenceId =
      "synthetic.normalized.substituted.0";
    resealExecutionManifestReferences(substitutedRef);
    const substitutedResult = verifyResolvedExecutionBundle(substitutedRef);
    expect(substitutedResult.valid).toBe(false);
    if (!substitutedResult.valid) {
      expect(substitutedResult.issueCodes).toContain(
        "EXECUTION_SCREEN_EVIDENCE_INVALID",
      );
    }

    const futureExport = buildResolvedExecutionFixture();
    testRecord(
      futureExport.screenEvidence.resolvedExportManifests[0],
    ).exportedAt = "2026-08-17T09:05:00.000Z";
    rebindExecutionCheckpointAndExport(futureExport, "future-export");
    const futureExportResult = verifyResolvedExecutionBundle(futureExport);
    expect(futureExportResult.valid).toBe(false);
    if (!futureExportResult.valid) {
      expect(futureExportResult.issueCodes).toContain(
        "EXECUTION_CHRONOLOGY_MISMATCH",
      );
    }

    const expiredEvidence = buildResolvedExecutionFixture();
    testRecord(expiredEvidence.screenEvidence.evidence).expiresAt =
      "2026-08-17T09:03:00.000Z";
    rebindExecutionCheckpointAndExport(expiredEvidence, "expired-evidence");
    const expiredEvidenceResult =
      verifyResolvedExecutionBundle(expiredEvidence);
    expect(expiredEvidenceResult.valid).toBe(false);
    if (!expiredEvidenceResult.valid) {
      expect(expiredEvidenceResult.issueCodes).toContain(
        "EXECUTION_CHRONOLOGY_MISMATCH",
      );
    }

    const obsoleteConsent = buildResolvedExecutionFixture();
    const obsoleteConsentManifest = testRecord(
      obsoleteConsent.screenEvidence.resolvedExportManifests[0],
    );
    obsoleteConsentManifest.consentRevision =
      "synthetic-consent-obsolete-v0.1";
    const obsoleteConsentArtifacts = obsoleteConsentManifest.artifacts;
    if (!Array.isArray(obsoleteConsentArtifacts)) {
      throw new TypeError("Expected exported artifacts");
    }
    testRecord(obsoleteConsentArtifacts[0]).captureConsentRevision =
      "synthetic-consent-obsolete-v0.1";
    rebindExecutionCheckpointAndExport(obsoleteConsent, "obsolete-consent");
    const obsoleteConsentResult =
      verifyResolvedExecutionBundle(obsoleteConsent);
    expect(obsoleteConsentResult.valid).toBe(false);
    if (!obsoleteConsentResult.valid) {
      expect(obsoleteConsentResult.issueCodes).toContain(
        "EXECUTION_SCREEN_EVIDENCE_INVALID",
      );
    }

    const obsoleteRetention = buildResolvedExecutionFixture();
    testRecord(
      obsoleteRetention.screenEvidence.resolvedExportManifests[0],
    ).retentionPolicyId = "synthetic-retention-obsolete-v0.1";
    rebindExecutionCheckpointAndExport(
      obsoleteRetention,
      "obsolete-retention",
    );
    const obsoleteRetentionResult =
      verifyResolvedExecutionBundle(obsoleteRetention);
    expect(obsoleteRetentionResult.valid).toBe(false);
    if (!obsoleteRetentionResult.valid) {
      expect(obsoleteRetentionResult.issueCodes).toContain(
        "EXECUTION_SCREEN_EVIDENCE_INVALID",
      );
    }

    for (const [suffix, mutate] of [
      [
        "commit-substitution",
        (manifest: Record<string, unknown>) => {
          manifest.dayflowCommitSha = "b".repeat(40);
        },
      ],
      [
        "source-substitution",
        (manifest: Record<string, unknown>) => {
          const sources = manifest.sourceFileHashes;
          if (!Array.isArray(sources)) throw new TypeError("Expected sources");
          testRecord(sources[0]).sha256 = "f".repeat(64);
        },
      ],
      [
        "package-substitution",
        (manifest: Record<string, unknown>) => {
          manifest.packageResolvedSha256 = "e".repeat(64);
        },
      ],
    ] as const) {
      const substitutedProvenance = buildResolvedExecutionFixture();
      mutate(
        testRecord(
          substitutedProvenance.screenEvidence.resolvedExportManifests[0],
        ),
      );
      rebindExecutionCheckpointAndExport(substitutedProvenance, suffix);
      const substitutedProvenanceResult = verifyResolvedExecutionBundle(
        substitutedProvenance,
      );
      expect(substitutedProvenanceResult.valid).toBe(false);
      if (!substitutedProvenanceResult.valid) {
        expect(substitutedProvenanceResult.issueCodes).toContain(
          "EXECUTION_SCREEN_EVIDENCE_INVALID",
        );
      }
    }

    const contaminatedA1 = buildResolvedExecutionFixture();
    const a1Input = testRecord(contaminatedA1.armInputs[1]);
    a1Input.normalizedEvidenceRef = structuredClone(
      testRecord(contaminatedA1.armInputs[2]).normalizedEvidenceRef,
    );
    sealArtifact("a1-arm-input", "armInputHash", a1Input);
    expect(verifyResolvedExecutionBundle(contaminatedA1)).toEqual({
      valid: false,
      issueCodes: ["EXECUTION_SCHEMA_INVALID"],
    });
  });

  it("rejects an arbitrary experiment manifest and synthetic live-authority injection", () => {
    const arbitraryManifest = buildResolvedExecutionFixture();
    const replacementManifest = structuredClone(
      testRecord(arbitraryManifest.experimentManifest),
    );
    replacementManifest.experimentManifestId =
      "synthetic.experiment-manifest.substituted.0";
    sealArtifact(
      "experiment-manifest",
      "experimentManifestSha256",
      replacementManifest,
    );
    const arbitraryResult = verifyResolvedExecutionBundle({
      ...arbitraryManifest,
      experimentManifest: replacementManifest,
    });
    expect(arbitraryResult.valid).toBe(false);
    if (!arbitraryResult.valid) {
      expect(arbitraryResult.issueCodes).toContain(
        "EXECUTION_EXPERIMENT_MANIFEST_INVALID",
      );
    }

    const injected = buildResolvedExecutionFixture();
    const injectedResult = verifyResolvedExecutionBundle({
      ...injected,
      liveAuthority: {
        authorityResolver: {
          getCurrentHeadRef: () => undefined,
          getHeadRefAsOf: () => undefined,
          resolve: () => undefined,
        },
        pilotDeletionReceipts: [],
        consentRef: {},
        retentionPolicyRef: {},
      },
    });
    expect(injectedResult.valid).toBe(false);
    if (!injectedResult.valid) {
      expect(injectedResult.issueCodes).toContain(
        "EXECUTION_LIVE_AUTHORITY_INVALID",
      );
    }
  });

  it("rejects expected-key drift, incomplete resolution, and false completion", () => {
    const drifted = buildResolvedExecutionFixture();
    const protocol = testRecord(drifted.studyProtocol);
    const armPolicy = testRecord(protocol.armPolicy);
    const counts = testRecord(armPolicy.replicateCountByArm);
    counts.A1 = 2;
    counts.B = 2;
    sealArtifact("study-protocol", "studyProtocolHash", protocol);
    const driftResult = verifyResolvedExecutionBundle(drifted);
    expect(driftResult.valid).toBe(false);
    if (!driftResult.valid) {
      expect(driftResult.issueCodes).toContain(
        "EXECUTION_EXPECTED_RUN_KEYS_MISMATCH",
      );
    }

    const completeFixture = buildResolvedExecutionFixture();
    const missingRun: ResolvedExecutionBundleInput = {
      ...completeFixture,
      runs: completeFixture.runs.slice(0, 1),
    };
    const missingResult = verifyResolvedExecutionBundle(missingRun);
    expect(missingResult.valid).toBe(false);
    if (!missingResult.valid) {
      expect(missingResult.issueCodes).toContain(
        "EXECUTION_RESOLUTION_NOT_EXACT",
      );
    }

    const falseCompletion = buildResolvedExecutionFixture();
    const completion = testRecord(falseCompletion.completion);
    completion.completionStatus = "failed";
    completion.failedRunKeys = [{ armId: "C", replicateIndex: 0 }];
    sealArtifact(
      "checkpoint-completion",
      "checkpointCompletionSha256",
      completion,
    );
    const falseCompletionResult =
      verifyResolvedExecutionBundle(falseCompletion);
    expect(falseCompletionResult.valid).toBe(false);
    if (!falseCompletionResult.valid) {
      expect(falseCompletionResult.issueCodes).toContain(
        "EXECUTION_RUN_STATUS_MISMATCH",
      );
      expect(falseCompletionResult.issueCodes).toContain(
        "EXECUTION_COMPLETION_MISMATCH",
      );
    }

    const mixedCompletion = buildResolvedExecutionFixture();
    const mixedCompletionRecord = testRecord(mixedCompletion.completion);
    mixedCompletionRecord.dataOrigin = "live";
    mixedCompletionRecord.studyPhase = "private_pilot";
    sealArtifact(
      "checkpoint-completion",
      "checkpointCompletionSha256",
      mixedCompletionRecord,
    );
    const mixedCompletionResult =
      verifyResolvedExecutionBundle(mixedCompletion);
    expect(mixedCompletionResult.valid).toBe(false);
    if (!mixedCompletionResult.valid) {
      expect(mixedCompletionResult.issueCodes).toContain(
        "EXECUTION_ORIGIN_PHASE_PROTOCOL_MISMATCH",
      );
    }
  });

  it("accepts exact missing-run completion state without impossible run refs", () => {
    const complete = buildResolvedExecutionFixture();
    const missing: ResolvedExecutionBundleInput = {
      ...complete,
      runs: complete.runs.slice(0, 3),
    };
    const completion = testRecord(missing.completion);
    const presentRunRefs = completion.presentRunRefs;
    if (!Array.isArray(presentRunRefs)) throw new TypeError("Expected run refs");
    presentRunRefs.pop();
    completion.missingExpectedRunKeys = [{ armId: "C", replicateIndex: 0 }];
    completion.completionStatus = "failed";
    sealArtifact(
      "checkpoint-completion",
      "checkpointCompletionSha256",
      completion,
    );
    expect(verifyResolvedExecutionBundle(missing).valid).toBe(true);

    completion.missingExpectedRunKeys = [{ armId: "B", replicateIndex: 0 }];
    sealArtifact(
      "checkpoint-completion",
      "checkpointCompletionSha256",
      completion,
    );
    const wrongPartition = verifyResolvedExecutionBundle(missing);
    expect(wrongPartition.valid).toBe(false);
    if (!wrongPartition.valid) {
      expect(wrongPartition.issueCodes).toContain(
        "EXECUTION_SCHEMA_INVALID",
      );
    }
  });

  it("binds successful runs to semantic output bytes and sorted unique issues", () => {
    const semanticDrift = buildResolvedExecutionFixture();
    const run = testRecord(semanticDrift.runs[1]);
    const semanticOutput = testRecord(run.semanticOutput);
    const items = semanticOutput.items;
    if (!Array.isArray(items)) throw new TypeError("Expected semantic items");
    testRecord(items[0]).title = "Synthetic substituted suggestion";
    sealArtifact("arm-run", "runSha256", run);
    expect(verifyResolvedExecutionBundle(semanticDrift)).toEqual({
      valid: false,
      issueCodes: ["EXECUTION_SCHEMA_INVALID"],
    });

    const unsortedIssues = buildResolvedExecutionFixture();
    const issueRun = testRecord(unsortedIssues.runs[1]);
    issueRun.validationIssueCodes = ["Z_SYNTHETIC", "A_SYNTHETIC"];
    sealArtifact("arm-run", "runSha256", issueRun);
    expect(verifyResolvedExecutionBundle(unsortedIssues)).toEqual({
      valid: false,
      issueCodes: ["EXECUTION_SCHEMA_INVALID"],
    });

    const contradictoryFailure = buildResolvedExecutionFixture();
    const failedRun = testRecord(contradictoryFailure.runs[1]);
    failedRun.status = "failed";
    delete failedRun.semanticOutput;
    delete failedRun.outputHash;
    failedRun.terminalFailureCode = "SYNTHETIC_TERMINAL_CAUSE";
    failedRun.attempts = [
      {
        attemptIndex: 0,
        startedAt: failedRun.startedAt,
        completedAt: failedRun.completedAt,
        requestSha256: "f".repeat(64),
        latencyMs: 1,
        inputTokens: 1,
        outputTokens: 0,
        costMicrounits: 0,
        attemptKind: "deterministic_failure",
        failureCode: "SYNTHETIC_ACTUAL_CAUSE",
      },
    ];
    sealArtifact("arm-run", "runSha256", failedRun);
    expect(verifyResolvedExecutionBundle(contradictoryFailure)).toEqual({
      valid: false,
      issueCodes: ["EXECUTION_SCHEMA_INVALID"],
    });
  });

  it("rejects request chronology and freeze drift after fully resealing refs", () => {
    const fixture = buildResolvedExecutionFixture();
    const manifest = testRecord(fixture.requestOrderManifests[0]);
    manifest.createdAt = "2026-08-17T09:07:30.000Z";
    sealArtifact(
      "request-order-manifest",
      "requestOrderManifestSha256",
      manifest,
    );
    resealExecutionManifestReferences(fixture);
    const result = verifyResolvedExecutionBundle(fixture);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issueCodes).toContain("EXECUTION_REQUEST_ORDER_MISMATCH");
      expect(result.issueCodes).not.toContain("EXECUTION_REFERENCE_MISMATCH");
    }

    const frozenSeedDrift = buildResolvedExecutionFixture();
    const driftedManifest = testRecord(
      frozenSeedDrift.requestOrderManifests[0],
    );
    driftedManifest.seed = "synthetic-unfrozen-seed";
    sealArtifact(
      "request-order-manifest",
      "requestOrderManifestSha256",
      driftedManifest,
    );
    resealExecutionManifestReferences(frozenSeedDrift);
    const driftedResult = verifyResolvedExecutionBundle(frozenSeedDrift);
    expect(driftedResult.valid).toBe(false);
    if (!driftedResult.valid) {
      expect(driftedResult.issueCodes).toContain(
        "EXECUTION_REQUEST_ORDER_MISMATCH",
      );
    }

    const protocolAfterFreeze = buildResolvedExecutionFixture();
    const lateProtocol = testRecord(protocolAfterFreeze.studyProtocol);
    lateProtocol.createdAt = "2026-08-17T09:01:30.000Z";
    sealArtifact("study-protocol", "studyProtocolHash", lateProtocol);
    const chronologyResult = verifyResolvedExecutionBundle(
      protocolAfterFreeze,
    );
    expect(chronologyResult.valid).toBe(false);
    if (!chronologyResult.valid) {
      expect(chronologyResult.issueCodes).toContain(
        "EXECUTION_CHRONOLOGY_MISMATCH",
      );
    }

    const reversedStarts = buildResolvedExecutionFixture();
    const firstCausalRun = testRecord(reversedStarts.runs[1]);
    firstCausalRun.startedAt = "2026-08-17T09:06:30.000Z";
    firstCausalRun.completedAt = "2026-08-17T09:06:45.000Z";
    const firstAttempts = firstCausalRun.attempts;
    if (!Array.isArray(firstAttempts)) throw new TypeError("Expected attempts");
    testRecord(firstAttempts[0]).startedAt = firstCausalRun.startedAt;
    testRecord(firstAttempts[0]).completedAt = firstCausalRun.completedAt;
    sealArtifact("arm-run", "runSha256", firstCausalRun);
    const reversedCompletion = testRecord(reversedStarts.completion);
    const reversedRefs = reversedCompletion.presentRunRefs;
    if (!Array.isArray(reversedRefs)) throw new TypeError("Expected run refs");
    testRecord(reversedRefs[1]).runSha256 = firstCausalRun.runSha256;
    sealArtifact(
      "checkpoint-completion",
      "checkpointCompletionSha256",
      reversedCompletion,
    );
    const reversedResult = verifyResolvedExecutionBundle(reversedStarts);
    expect(reversedResult.valid).toBe(false);
    if (!reversedResult.valid) {
      expect(reversedResult.issueCodes).toContain(
        "EXECUTION_REQUEST_ORDER_MISMATCH",
      );
    }

    const substitutedRequest = buildResolvedExecutionFixture();
    const a1Input = testRecord(substitutedRequest.armInputs[1]);
    const bInput = testRecord(substitutedRequest.armInputs[2]);
    bInput.requestId = a1Input.requestId;
    sealArtifact("b-arm-input", "armInputHash", bInput);
    const bRun = testRecord(substitutedRequest.runs[2]);
    bRun.requestId = a1Input.requestId;
    bRun.armInputRef = {
      schemaVersion: "dayflow-ablation-arm-input-v0.4",
      armInputId: bInput.armInputId,
      armInputHash: bInput.armInputHash,
    };
    sealArtifact("arm-run", "runSha256", bRun);
    const substitutedCompletion = testRecord(substitutedRequest.completion);
    const presentRunRefs = substitutedCompletion.presentRunRefs;
    if (!Array.isArray(presentRunRefs)) throw new TypeError("Expected run refs");
    testRecord(presentRunRefs[2]).runSha256 = bRun.runSha256;
    sealArtifact(
      "checkpoint-completion",
      "checkpointCompletionSha256",
      substitutedCompletion,
    );
    const substitutedResult = verifyResolvedExecutionBundle(substitutedRequest);
    expect(substitutedResult.valid).toBe(false);
    if (!substitutedResult.valid) {
      expect(substitutedResult.issueCodes).toContain(
        "EXECUTION_REQUEST_ORDER_MISMATCH",
      );
    }
  });

  it("requires an exact strictly ordered issuance receipt chain", () => {
    const valid = buildResolvedExecutionFixture();
    expect(
      valid.requestIssuanceReceipts.every(
        (receipt) => requestIssuanceReceiptSchema.safeParse(receipt).success,
      ),
    ).toBe(true);

    const equalTimestamp = buildResolvedExecutionFixture();
    const firstReceipt = testRecord(equalTimestamp.requestIssuanceReceipts[0]);
    const secondReceipt = testRecord(equalTimestamp.requestIssuanceReceipts[1]);
    secondReceipt.issuedAt = firstReceipt.issuedAt;
    sealArtifact(
      "request-issuance-receipt",
      "requestIssuanceReceiptSha256",
      secondReceipt,
    );
    resealReceiptRunReferences(equalTimestamp);
    const equalResult = verifyResolvedExecutionBundle(equalTimestamp);
    expect(equalResult.valid).toBe(false);
    if (!equalResult.valid) {
      expect(equalResult.issueCodes).toContain(
        "EXECUTION_REQUEST_ORDER_MISMATCH",
      );
    }

    const issuedAtManifestSeal = buildResolvedExecutionFixture();
    const firstIssuedAt = String(
      testRecord(issuedAtManifestSeal.requestIssuanceReceipts[0]).issuedAt,
    );
    const issuanceManifest = testRecord(
      issuedAtManifestSeal.requestOrderManifests[0],
    );
    issuanceManifest.createdAt = firstIssuedAt;
    sealArtifact(
      "request-order-manifest",
      "requestOrderManifestSha256",
      issuanceManifest,
    );
    resealExecutionManifestReferences(issuedAtManifestSeal);
    const issuanceSealResult = verifyResolvedExecutionBundle(
      issuedAtManifestSeal,
    );
    expect(issuanceSealResult.valid).toBe(false);
    if (!issuanceSealResult.valid) {
      expect(issuanceSealResult.issueCodes).toContain(
        "EXECUTION_REQUEST_ORDER_MISMATCH",
      );
    }

    const reordered = buildResolvedExecutionFixture();
    const reorderedResult = verifyResolvedExecutionBundle({
      ...reordered,
      requestIssuanceReceipts: [...reordered.requestIssuanceReceipts].reverse(),
    });
    expect(reorderedResult.valid).toBe(false);
    if (!reorderedResult.valid) {
      expect(reorderedResult.issueCodes).toContain(
        "EXECUTION_REQUEST_ORDER_MISMATCH",
      );
    }

    const substituted = buildResolvedExecutionFixture();
    const substitutedFirst = testRecord(
      substituted.requestIssuanceReceipts[0],
    );
    const substitutedSecond = testRecord(
      substituted.requestIssuanceReceipts[1],
    );
    substitutedSecond.armInputRef = structuredClone(
      substitutedFirst.armInputRef,
    );
    sealArtifact(
      "request-issuance-receipt",
      "requestIssuanceReceiptSha256",
      substitutedSecond,
    );
    resealReceiptRunReferences(substituted);
    const substitutedResult = verifyResolvedExecutionBundle(substituted);
    expect(substitutedResult.valid).toBe(false);
    if (!substitutedResult.valid) {
      expect(substitutedResult.issueCodes).toContain(
        "EXECUTION_REQUEST_ORDER_MISMATCH",
      );
    }
  });

  it("resolves the full dataset DAG and exact run/matched-pair bindings", () => {
    const { dag, bundle } = buildResolvedDagFixture();
    const resolver = {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [bundle],
    };
    expect(validateResolvedDayflowDatasetDag(dag, resolver)).toBe(true);
    const result = verifyResolvedDayflowDatasetDag(dag, resolver);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.generationAncestry).toHaveLength(1);
      expect(result.executionBundles).toHaveLength(1);
    }
  });

  it("rejects two export identities for one capture window across resolved bundles", () => {
    const { dag, bundle } = buildResolvedDagFixture();
    const substituted = buildResolvedExecutionFixture();
    rebindExecutionCheckpointAndExport(substituted, "second");
    expect(verifyResolvedExecutionBundle(substituted).valid).toBe(true);
    const result = verifyResolvedDayflowDatasetDag(dag, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [bundle, substituted],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issueCodes).toContain(
        "DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH",
      );
    }
  });

  it("issues pilot verification only for exactly 15 completed checkpoints", () => {
    const exact = buildResolvedPilotDagFixture(15);
    expect(pilotVerificationAttestationSchema.safeParse(exact.attestation).success)
      .toBe(true);
    expect(verifyResolvedDayflowDatasetDag(exact.dag, exact.resolver).valid)
      .toBe(true);
    testRecord(exact.bundles[0]!.screenEvidence.artifactBlobs[0]).bytes =
      Buffer.from("tampered-raw-pilot-bytes", "utf8");
    expect(
      issuePilotVerificationAttestation({
        dag: exact.dag,
        resolver: exact.resolver,
        pilotVerificationAttestationId:
          "pilot.verification-attestation.tampered",
        verifierVersion: "pilot-pre-purge-verifier-v0.1",
        verifiedAt: "2026-08-17T09:12:30.000Z",
      }),
    ).toBeUndefined();

    for (const checkpointCount of [1, 14, 16]) {
      const candidate = buildResolvedPilotDagFixture(checkpointCount);
      expect(candidate.attestation).toBeUndefined();
      const verification = verifyResolvedDayflowDatasetDag(
        candidate.dag,
        candidate.resolver,
      );
      expect(verification.valid).toBe(false);
      if (!verification.valid) {
        expect(verification.issueCodes).toContain(
          "DATASET_DAG_PILOT_TARGET_MISMATCH",
        );
      }
    }

    const wrongProtocolTarget = buildResolvedPilotExecutionFixture();
    const protocol = testRecord(wrongProtocolTarget.studyProtocol);
    protocol.targetCheckpointCount = 14;
    sealArtifact("study-protocol", "studyProtocolHash", protocol);
    expect(executableStudyProtocolSchema.safeParse(protocol).success).toBe(false);
  });

  it("enforces a live capture-window/export bijection and half-open non-overlap", () => {
    const { dag, bundles, resolver } = buildResolvedPilotDagFixture();
    expect(
      verifyResolvedDayflowDatasetDag(dag, resolver).valid,
    ).toBe(true);

    const reusedExport = buildResolvedPilotExecutionFixture();
    rebindExecutionCheckpointIdentity(
      reusedExport,
      "pilot.checkpoint.reused-export",
      "pilot.capture.reused-export",
    );
    expect(verifyResolvedExecutionBundle(reusedExport).valid).toBe(true);
    const reusedExportResult = verifyResolvedDayflowDatasetDag(dag, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [...bundles, reusedExport],
    });
    expect(reusedExportResult.valid).toBe(false);
    if (!reusedExportResult.valid) {
      expect(reusedExportResult.issueCodes).toContain(
        "DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH",
      );
    }

    const duplicateWindow = buildResolvedPilotExecutionFixture();
    rebindExecutionCheckpointIdentity(
      duplicateWindow,
      "pilot.checkpoint.duplicate-window",
      "pilot.capture.resolved.0",
    );
    const duplicateWindowResult = verifyResolvedDayflowDatasetDag(dag, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [...bundles, duplicateWindow],
    });
    expect(duplicateWindowResult.valid).toBe(false);
    if (!duplicateWindowResult.valid) {
      expect(duplicateWindowResult.issueCodes).toContain(
        "DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH",
      );
    }

    const overlapping = buildResolvedPilotExecutionFixture();
    rebindExecutionCaptureWindow(
      overlapping,
      "overlap",
      "2026-08-17T09:03:30.500Z",
      "2026-08-17T09:03:31.500Z",
    );
    expect(verifyResolvedExecutionBundle(overlapping).valid).toBe(true);
    const overlapResult = verifyResolvedDayflowDatasetDag(dag, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [overlapping, ...bundles],
    });
    expect(overlapResult.valid).toBe(false);
    if (!overlapResult.valid) {
      expect(overlapResult.issueCodes).toContain(
        "DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH",
      );
    }

    const adjacent = buildResolvedPilotExecutionFixture();
    rebindExecutionCaptureWindow(
      adjacent,
      "adjacent",
      "2026-08-17T09:03:31.000Z",
      "2026-08-17T09:03:32.000Z",
    );
    expect(verifyResolvedExecutionBundle(adjacent).valid).toBe(true);
    const adjacentResult = verifyResolvedDayflowDatasetDag(dag, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [...bundles, adjacent],
    });
    expect(adjacentResult.valid).toBe(false);
    if (!adjacentResult.valid) {
      expect(adjacentResult.issueCodes).not.toContain(
        "DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH",
      );
      expect(adjacentResult.issueCodes).toContain(
        "DATASET_DAG_RESOLUTION_NOT_EXACT",
      );
    }
  });

  it("rejects missing execution resolution and forged matched-pair bindings", () => {
    const { dag, bundle } = buildResolvedDagFixture();
    const missing = verifyResolvedDayflowDatasetDag(dag, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [],
    });
    expect(missing.valid).toBe(false);
    if (!missing.valid) {
      expect(missing.issueCodes).toContain(
        "DATASET_DAG_RESOLUTION_NOT_EXACT",
      );
    }

    const forged = structuredClone(dag);
    const manifest = testRecord(forged.manifest);
    const included = manifest.includedCheckpointRuns;
    if (!Array.isArray(included)) throw new TypeError("Expected manifest runs");
    const manifestRuns = testRecord(included[0]).runRefs;
    if (!Array.isArray(manifestRuns)) throw new TypeError("Expected run refs");
    for (const runValue of manifestRuns) {
      const run = testRecord(runValue);
      if (run.armId === "A1" || run.armId === "B") {
        run.matchedPairId = "synthetic.pair.forged.0";
      }
    }
    sealArtifact("final-dataset-manifest", "datasetSha256", manifest);
    const binding = testRecord(forged.binding);
    const runBindings = binding.runBindings;
    if (!Array.isArray(runBindings)) throw new TypeError("Expected bindings");
    for (const runValue of runBindings) {
      const run = testRecord(runValue);
      if (run.armId === "A1" || run.armId === "B") {
        run.matchedPairId = "synthetic.pair.forged.0";
      }
    }
    binding.manifestRef = {
      schemaVersion: "dayflow-ablation-final-dataset-manifest-v0.1",
      datasetVersion: manifest.datasetVersion,
      datasetSha256: manifest.datasetSha256,
    };
    sealArtifact(
      "final-dataset-binding",
      "finalDatasetBindingSha256",
      binding,
    );
    expect(validateDayflowDatasetDag(forged)).toBe(true);
    const forgedResult = verifyResolvedDayflowDatasetDag(forged, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [bundle],
    });
    expect(forgedResult.valid).toBe(false);
    if (!forgedResult.valid) {
      expect(forgedResult.issueCodes).toContain(
        "DATASET_DAG_RUN_BIJECTION_MISMATCH",
      );
    }
  });

  it("rejects successor chronology and non-cumulative generation ancestry", () => {
    const chronologyFixture = buildResolvedDagFixture();
    const chronologyDag = structuredClone(chronologyFixture.dag);
    const generation = testRecord(chronologyDag.generation);
    const decisions = chronologyDag.decisions;
    if (!Array.isArray(decisions)) throw new TypeError("Expected decisions");
    testRecord(decisions[0]).decidedAt = generation.createdAt;
    resealDagSuccessors(chronologyDag);
    const chronologyResult = verifyResolvedDayflowDatasetDag(chronologyDag, {
      resolveCandidateGeneration: () => undefined,
      resolveExecutionBundles: () => [chronologyFixture.bundle],
    });
    expect(chronologyResult.valid).toBe(false);
    if (!chronologyResult.valid) {
      expect(chronologyResult.issueCodes).toContain(
        "DATASET_DAG_CHRONOLOGY_MISMATCH",
      );
    }

    const cumulativeFixture = buildResolvedDagFixture();
    const parentGeneration = structuredClone(
      testRecord(cumulativeFixture.dag.generation),
    );
    const childDag = structuredClone(cumulativeFixture.dag);
    const childGeneration = testRecord(childDag.generation);
    childGeneration.candidateDatasetGenerationId =
      "synthetic.generation.resolved.child";
    childGeneration.priorCandidateDatasetGenerationRef = {
      schemaVersion:
        "dayflow-ablation-candidate-dataset-generation-v0.1",
      candidateDatasetGenerationId:
        parentGeneration.candidateDatasetGenerationId,
      candidateDatasetGenerationSha256:
        parentGeneration.candidateDatasetGenerationSha256,
    };
    childGeneration.createdAt = "2026-08-17T09:10:00.000Z";
    const childDecisions = childDag.decisions;
    if (!Array.isArray(childDecisions)) throw new TypeError("Expected decisions");
    testRecord(childDecisions[0]).decidedAt =
      "2026-08-17T09:11:00.000Z";
    testRecord(childDag.closure).closedAt = "2026-08-17T09:12:00.000Z";
    testRecord(childDag.binding).createdAt = "2026-08-17T09:13:00.000Z";
    resealDagSuccessors(childDag);
    expect(validateDayflowDatasetDag(childDag)).toBe(true);
    const cumulativeResult = verifyResolvedDayflowDatasetDag(childDag, {
      resolveCandidateGeneration: (reference) =>
        reference.candidateDatasetGenerationId ===
        parentGeneration.candidateDatasetGenerationId
          ? parentGeneration
          : undefined,
      resolveExecutionBundles: () => [cumulativeFixture.bundle],
    });
    expect(cumulativeResult.valid).toBe(false);
    if (!cumulativeResult.valid) {
      expect(cumulativeResult.issueCodes).toContain(
        "DATASET_DAG_CUMULATIVE_MISMATCH",
      );
    }
  });
});

describe("six closed approval variants", () => {
  const common = {
    approvalSchemaVersion: "dayflow-ablation-human-approval-v0.1",
    approvalRecordId: "synthetic.approval.0",
    lineageClass: "control",
    approverPseudonym: "synthetic.approver.0",
    approvedAt: NOW,
    scopeHash: SHA,
    approvalRecordSha256: SHA,
  } as const;
  const versionHash = { version: "synthetic-policy-v0.1", sha256: SHA } as const;

  const approvals: unknown[] = [
    {
      ...common,
      approvalType: "H-CROSS-REPO",
      decision: "approved",
      repositoryRef: {
        repositoryId: "dayflow",
        canonicalPath: "synthetic-dayflow-repository",
        pinnedHeadSha256: SHA,
      },
      writeScope: {
        branchName: "synthetic-contract-branch",
        allowedPaths: ["Sources/SyntheticContract.swift"],
      },
    },
    {
      ...common,
      approvalType: "H-THREAT-MODEL-DESIGN",
      decision: "approved",
      threatModelRef: versionHash,
      encryptionPolicyRef: versionHash,
      retentionPolicyRefs: [versionHash],
      localSameUserBoundaryRef: versionHash,
    },
    {
      ...common,
      approvalType: "H-LIVE-CAPTURE",
      decision: "approved",
      phase: "private_pilot",
      studyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: SHA,
      },
      consentRevision: "consent-v0.1",
      captureScopeHash: SHA,
      capturePolicyRef: versionHash,
      denylistPolicyRef: versionHash,
      retentionPolicyRef: { policyId: "synthetic.retention.0", sha256: SHA },
      encryptionDeploymentRef: versionHash,
      artifactGovernancePolicyRefs: [
        {
          artifactClass: "dayflow-export-manifest",
          policyId: "synthetic.governance.0",
          policySha256: SHA,
        },
      ],
      localOnly: true,
      cloudImageUpload: false,
      validFrom: NOW,
      validUntil: "2026-08-18T10:00:00.000Z",
    },
    {
      ...common,
      approvalType: "H-PILOT-GO",
      decision: "approved",
      pilotFinalBindingRef: {
        schemaVersion: "dayflow-ablation-final-dataset-binding-v0.1",
        finalDatasetBindingId: "synthetic.binding.0",
        finalDatasetBindingSha256: SHA,
      },
      pilotVerificationAttestationRef: {
        schemaVersion:
          "dayflow-ablation-pilot-verification-attestation-v0.1",
        pilotVerificationAttestationId: "synthetic.pilot-attestation.0",
        pilotVerificationAttestationSha256: SHA,
      },
      pilotDeletionEvidenceRefs: [
        {
          schemaVersion: "dayflow-ablation-deletion-receipt-v0.1",
          deletionReceiptId: "synthetic.deletion.0",
          deletionReceiptSha256: SHA,
        },
      ],
      directionalTarget: {
        phase: "directional_study",
        studyProtocolHash: SHA,
      },
      liveCaptureApprovalRef: {
        schemaVersion: "dayflow-ablation-human-approval-v0.1",
        approvalRecordId: "synthetic.live-approval.0",
        approvalRecordSha256: SHA,
      },
      validFrom: NOW,
      validUntil: "2026-08-18T10:00:00.000Z",
    },
    {
      ...common,
      approvalType: "H-E2",
      decisionTarget: "e2-candidate-discovery-design",
      decision: "do-not-proceed",
      targetStudyProtocolRef: {
        schemaVersion: "dayflow-ablation-study-protocol-v0.3",
        studyProtocolHash: SHA,
      },
      targetFinalBindingRef: {
        schemaVersion: "dayflow-ablation-final-dataset-binding-v0.1",
        finalDatasetBindingId: "synthetic.binding.0",
        finalDatasetBindingSha256: SHA,
      },
      qualityEvidenceRefs: [
        {
          artifactType: "aggregate",
          schemaVersion: "dayflow-ablation-aggregate-v0.1",
          artifactId: "synthetic.aggregate.0",
          artifactSha256: SHA,
        },
      ],
      decisionReasonCode: "SYNTHETIC_DO_NOT_PROCEED",
    },
    {
      ...common,
      approvalType: "H-EXCEPTION",
      decision: "approved",
      exceptionKind: "non-blocking-check",
      exceptionScope: {
        phase: "implementation",
        artifactTypes: ["experiment-manifest"],
      },
      reasonCode: "SYNTHETIC_NON_BLOCKING",
      ownerPseudonym: "synthetic.owner.0",
      expiresAt: "2026-08-18T10:00:00.000Z",
      compensatingControls: ["SYNTHETIC_CONTROL"],
      affectedArtifactRefs: [
        {
          artifactType: "experiment-manifest",
          schemaVersion: "dayflow-ablation-experiment-manifest-v0.2",
          artifactId: "synthetic.experiment-manifest.0",
          artifactSha256: SHA,
        },
      ],
      requiredChecksPassInvariant: true,
      checkRef: {
        checkId: "synthetic.check.0",
        blockingClassification: "non-blocking",
      },
    },
  ];

  it("enumerates and parses exactly the six approval shapes", () => {
    expect(DAYFLOW_APPROVAL_TYPES).toHaveLength(6);
    const sealedApprovals = approvals.map((approval) => {
      const record = approval as Record<string, unknown>;
      return {
        ...record,
        approvalRecordSha256: hashRegisteredArtifact(
          "human-approval-record",
          record,
        ),
      };
    });
    expect(
      sealedApprovals.map(
        (approval) => dayflowApprovalSchema.safeParse(approval).success,
      ),
    ).toEqual([true, true, true, true, true, true]);
  });

  it("rejects fields from a different approval variant", () => {
    const crossRepo = { ...(approvals[0] as object), revokedAt: NOW };
    expect(dayflowApprovalSchema.safeParse(crossRepo).success).toBe(false);
  });
});
describe("synthetic four-file dry-run packaging", () => {
  function buildDryRunInput(): DayflowAblationSyntheticDryRunInput {
    const experimentManifest = experimentManifestSchema.parse(
      buildResolvedExecutionFixture().experimentManifest,
    );
    const runResultsCandidate = structuredClone(buildRunResultsFixture());
    runResultsCandidate.terminalArmRunRefs =
      runResultsCandidate.terminalArmRunRefs.filter(
        (reference) => reference.armId === "A1" || reference.armId === "B",
      );
    const runResults = runResultsSchema.parse(
      sealArtifact(
        "run-results",
        "runResultsSha256",
        runResultsCandidate,
      ),
    );
    return {
      mode: "synthetic-contract-conformance",
      runLabel: "s6-2a-contract-dry-run",
      experimentManifest,
      runResults,
      configIdentity: {
        configId: experimentManifest.configurationIdentity.configId,
        configSha256:
          experimentManifest.configurationIdentity.configSha256,
      },
      casesIdentity: {
        fixtureSetId:
          experimentManifest.commonEvaluationInputIdentity.inputId,
        casesSha256:
          experimentManifest.commonEvaluationInputIdentity.inputSha256,
      },
      colinDecision: {
        decidedAt: "2026-08-17T09:09:00.000Z",
        outcome: "revise",
        rationale: "Synthetic packaging requires separate focused validation.",
        followUpConditions: [
          "Run the separately approved focused validation checkpoint.",
        ],
        rollback: "Discard the in-memory package and retain existing contracts.",
      },
    };
  }

  it("builds exactly four deterministic non-registry files", () => {
    const first = buildDayflowAblationSyntheticDryRunPackage(
      buildDryRunInput(),
    );
    const second = buildDayflowAblationSyntheticDryRunPackage(
      buildDryRunInput(),
    );

    expect(first.files.map((file) => file.relativePath)).toEqual([
      "experiment-manifest.json",
      "run-results.json",
      "comparison-report.md",
      "colin-decision.md",
    ]);
    expect(first.files).toHaveLength(4);
    expect(first.snapshotSha256).toBe(second.snapshotSha256);
    expect(
      first.files.map((file) => ({
        ...file,
        bytes: Array.from(file.bytes),
      })),
    ).toEqual(
      second.files.map((file) => ({
        ...file,
        bytes: Array.from(file.bytes),
      })),
    );
    expect(DAYFLOW_ARTIFACT_REGISTRY).toHaveLength(30);
    expect(DAYFLOW_ABLATION_ARTIFACT_REGISTRY).toHaveLength(30);
  });

  it("emits canonical registered JSON with intact detached hashes", () => {
    const dryRun = buildDayflowAblationSyntheticDryRunPackage(
      buildDryRunInput(),
    );
    const manifestFile = dryRun.files[0];
    const runResultsFile = dryRun.files[1];
    const manifestRaw = new TextDecoder().decode(manifestFile.bytes);
    const runResultsRaw = new TextDecoder().decode(runResultsFile.bytes);
    const manifest = experimentManifestSchema.parse(JSON.parse(manifestRaw));
    const runResults = runResultsSchema.parse(JSON.parse(runResultsRaw));

    expect(manifestRaw).toBe(`${jcsCanonicalize(manifest)}\n`);
    expect(runResultsRaw).toBe(`${jcsCanonicalize(runResults)}\n`);
    expect(manifest.experimentManifestSha256).toBe(
      dayflowAblationExperimentManifestSha256(manifest),
    );
    expect(runResults.runResultsSha256).toBe(
      dayflowAblationRunResultsSha256(runResults),
    );
    expect(manifestFile.rawSha256).toBe(rawSha256(manifestFile.bytes));
    expect(runResultsFile.rawSha256).toBe(rawSha256(runResultsFile.bytes));
  });

  it("fails closed on lineage, identity, chronology, ordering, and unsafe text", () => {
    const input = buildDryRunInput();
    expect(() =>
      buildDayflowAblationSyntheticDryRunPackage({
        ...input,
        configIdentity: {
          ...input.configIdentity,
          configSha256: "f".repeat(64),
        },
      }),
    ).toThrow(/Config identity/u);

    const wrongManifestRef = structuredClone(input.runResults);
    wrongManifestRef.experimentManifestRef.experimentManifestId =
      "synthetic.experiment-manifest.other";
    sealArtifact("run-results", "runResultsSha256", wrongManifestRef);
    expect(() =>
      buildDayflowAblationSyntheticDryRunPackage({
        ...input,
        runResults: wrongManifestRef,
      }),
    ).toThrow(/exact experiment manifest/u);

    const nonSynthetic = structuredClone(input.runResults);
    nonSynthetic.dataOrigin = "live";
    nonSynthetic.studyPhase = "private_pilot";
    sealArtifact("run-results", "runResultsSha256", nonSynthetic);
    expect(() =>
      buildDayflowAblationSyntheticDryRunPackage({
        ...input,
        runResults: nonSynthetic,
      }),
    ).toThrow(/synthetic contract_conformance/u);

    const nonCanonical = structuredClone(input.runResults);
    nonCanonical.terminalArmRunRefs.reverse();
    sealArtifact("run-results", "runResultsSha256", nonCanonical);
    expect(() =>
      buildDayflowAblationSyntheticDryRunPackage({
        ...input,
        runResults: nonCanonical,
      }),
    ).toThrow();

    expect(() =>
      buildDayflowAblationSyntheticDryRunPackage({
        ...input,
        colinDecision: {
          ...input.colinDecision,
          decidedAt: "2026-08-17T09:07:59.999Z",
        },
      }),
    ).toThrow(/timestamps/u);
    expect(() =>
      buildDayflowAblationSyntheticDryRunPackage({
        ...input,
        colinDecision: {
          ...input.colinDecision,
          rationale: "Synthetic rationale\n# Injected heading",
        },
      }),
    ).toThrow();
    expect(() =>
      buildDayflowAblationSyntheticDryRunPackage({
        ...input,
        runLabel: "../escape",
      }),
    ).toThrow();
  });

  it("binds the report bytes into the decision and rejects report mutation", () => {
    const dryRun = buildDayflowAblationSyntheticDryRunPackage(
      buildDryRunInput(),
    );
    const report = dryRun.files[2];
    const decision = new TextDecoder().decode(dryRun.files[3].bytes);

    expect(decision).toContain(
      `- Comparison report raw SHA-256: \`${report.rawSha256}\``,
    );
    expect(decision).toContain(
      `- Comparison report byte length: \`${report.byteLength}\``,
    );
    expect(
      verifyDayflowAblationSyntheticDryRunDecisionBinding(dryRun.files),
    ).toBe(true);

    const mutatedFiles = dryRun.files.map((file) =>
      file.relativePath === "comparison-report.md"
        ? {
            ...file,
            bytes: new Uint8Array([...file.bytes, 0x20]),
          }
        : file,
    );
    expect(
      verifyDayflowAblationSyntheticDryRunDecisionBinding(mutatedFiles),
    ).toBe(false);
  });

  it("reports only fixture A1/B refs and makes no metric or execution claim", () => {
    const input = buildDryRunInput();
    const dryRun = buildDayflowAblationSyntheticDryRunPackage(input);
    const report = new TextDecoder().decode(dryRun.files[2].bytes);
    const decision = new TextDecoder().decode(dryRun.files[3].bytes);

    expect(
      input.runResults.terminalArmRunRefs.map((reference) => reference.armId),
    ).toEqual(["A1", "B"]);
    expect(report).toContain("- Metrics status: `not-computed`");
    expect(report).toContain(
      "- Execution resolution: `unresolved-fixture-lineage`",
    );
    expect(report).toContain("- Blind review: `not-performed`");
    expect(report).toContain("- Real experiment approval: `false`");
    expect(decision).toContain("- Approval scope: `synthetic-packaging-only`");
    expect(decision).toContain("- Real experiment approval: `false`");
    expect(report).not.toContain("\r");
    expect(decision).not.toContain("\r");
  });

  it("strictly reparses the package and returns defensive byte copies", () => {
    const original = buildDayflowAblationSyntheticDryRunPackage(
      buildDryRunInput(),
    );
    const parsed = parseDayflowAblationSyntheticDryRunPackage(original);
    const parsedManifestFirstByte = parsed.files[0].bytes[0]!;
    const originalRunResultsFirstByte = original.files[1].bytes[0]!;

    original.files[0].bytes[0] ^= 0xff;
    expect(parsed.files[0].bytes[0]).toBe(parsedManifestFirstByte);
    parsed.files[1].bytes[0] ^= 0xff;
    expect(original.files[1].bytes[0]).toBe(originalRunResultsFirstByte);
    expect(DAYFLOW_ABLATION_ARTIFACT_REGISTRY).toHaveLength(30);
  });

  it("rejects package layout, metadata, bytes, Markdown, and snapshot mutations", () => {
    type MutableDryRunPackageCandidate = {
      mode: string;
      runLabel: string;
      files: Array<{
        relativePath: string;
        mediaType: string;
        byteLength: number;
        rawSha256: string;
        bytes: Uint8Array;
      }>;
      snapshotSha256: string;
    };
    const fresh = (): MutableDryRunPackageCandidate => {
      const packageValue = buildDayflowAblationSyntheticDryRunPackage(
        buildDryRunInput(),
      );
      return {
        mode: packageValue.mode,
        runLabel: packageValue.runLabel,
        files: packageValue.files.map((file) => ({
          relativePath: file.relativePath,
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          rawSha256: file.rawSha256,
          bytes: new Uint8Array(file.bytes),
        })),
        snapshotSha256: packageValue.snapshotSha256,
      };
    };
    const expectRejected = (mutate: (value: ReturnType<typeof fresh>) => void) => {
      const value = fresh();
      mutate(value);
      expect(() => parseDayflowAblationSyntheticDryRunPackage(value)).toThrow();
    };

    expectRejected((value) => value.files.pop());
    expectRejected((value) => value.files.push(structuredClone(value.files[0]!)));
    expectRejected((value) => {
      value.files[1] = structuredClone(value.files[0]!);
    });
    expectRejected((value) => value.files.reverse());
    expectRejected((value) => {
      value.files[0]!.relativePath = "renamed.json";
    });
    expectRejected((value) => {
      value.files[0]!.mediaType = "text/plain";
    });
    expectRejected((value) => {
      value.files[0]!.byteLength += 1;
    });
    expectRejected((value) => {
      value.files[0]!.rawSha256 = "f".repeat(64);
    });
    expectRejected((value) => {
      value.files[0]!.bytes[0] ^= 0xff;
    });
    expectRejected((value) => {
      value.files[2]!.bytes[0] ^= 0xff;
    });
    expectRejected((value) => {
      value.files[3]!.bytes[0] ^= 0xff;
    });
    expectRejected((value) => {
      value.snapshotSha256 = "f".repeat(64);
    });
  });
});

describe("E1 deterministic semantic arm renderer", () => {
  type AvailableScreenContext = Extract<
    DayflowE1ResolvedScreenEvidenceInput,
    { state: "available" }
  >;

  function activeResult() {
    const result = resolveActiveAttention(activeAttentionFixture().input);
    expect(verifyActiveAttentionResultIntegrity(result)).toBe(true);
    expect(activeAttentionResultSha256(result)).toBe(
      result.resultSha256,
    );
    return result;
  }

  function availableScreenContext(): AvailableScreenContext {
    const fixture = buildResolvedExecutionFixture();
    return {
      state: "available",
      asOf: String(
        testRecord(
          testRecord(fixture.screenEvidence.evidence).captureWindow,
        ).end,
      ),
      ...fixture.screenEvidence,
    };
  }

  function e1Records(
    value: unknown,
    label: string,
  ): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      throw new TypeError(`Expected ${label}`);
    }
    return value.map((entry) => testRecord(entry));
  }

  function resealScreenEvidence(
    context: AvailableScreenContext,
    mutate: (record: Record<string, unknown>) => void,
  ): AvailableScreenContext {
    const record = testRecord(structuredClone(context.evidence));
    mutate(record);
    return {
      ...context,
      evidence: sealArtifact(
        "normalized-screen-evidence",
        "dayflowNormalizedEvidenceHash",
        record,
      ),
    };
  }

  function eligibleBContext(): AvailableScreenContext {
    return resealScreenEvidence(
      availableScreenContext(),
      (evidence) => {
        const claims = e1Records(
          evidence.acceptedClaims,
          "accepted claims",
        );
        const summaries = claims.filter((claim) =>
          String(claim.outputFieldPath).endsWith("/summary"),
        );
        if (summaries.length === 0) {
          throw new TypeError("Expected summary claim");
        }
        for (const claim of summaries) {
          claim.claimClass = "VISIBLE_APPLICATION";
          claim.confidenceBasisPoints = 9_000;
        }
        summaries[0]!.claimClass = "RECENT_FOCUS";
      },
    );
  }

  function eligibleCContext(): AvailableScreenContext {
    return resealScreenEvidence(
      availableScreenContext(),
      (evidence) => {
        for (const claim of e1Records(
          evidence.acceptedClaims,
          "accepted claims",
        )) {
          const path = String(claim.outputFieldPath);
          if (
            path.endsWith("/title") ||
            path.endsWith("/summary")
          ) {
            claim.claimClass = path.endsWith("/title")
              ? "VISIBLE_TASK_INTENT"
              : "RECENT_FOCUS";
            claim.confidenceBasisPoints = 9_000;
          }
        }
      },
    );
  }

  function validEmptyScreenContext(): AvailableScreenContext {
    const context = availableScreenContext();
    const baseEvidence = testRecord(context.evidence);
    const captureWindow = testRecord(baseEvidence.captureWindow);
    const casesDocument = JSON.parse(casesRaw) as {
      evidenceBoundaryVectors: Array<{
        vectorKind: string;
        payload: {
          exportManifest: Record<string, unknown>;
        };
      }>;
    };
    const validEmptyVector = casesDocument.evidenceBoundaryVectors.find(
      (entry) => entry.vectorKind === "valid_empty",
    );
    if (validEmptyVector === undefined) {
      throw new TypeError("Missing canonical valid-empty export vector");
    }
    const exportManifest = structuredClone(
      validEmptyVector.payload.exportManifest,
    );
    exportManifest.exportId = "synthetic.export.e1.valid-empty.0";
    exportManifest.studyProtocolHash = baseEvidence.studyProtocolHash;
    exportManifest.exportedAt = captureWindow.end;
    exportManifest.windowStart = captureWindow.start;
    exportManifest.windowEnd = captureWindow.end;
    const originalExport = context.resolvedExportManifests[0];
    if (originalExport === undefined) {
      throw new TypeError("Expected resolved export manifest");
    }
    exportManifest.consentRevision = originalExport.consentRevision;
    exportManifest.retentionPolicyId = originalExport.retentionPolicyId;
    const coverage = testRecord(exportManifest.coverage);
    const intervals = e1Records(
      coverage.intervals,
      "valid-empty coverage intervals",
    );
    if (intervals.length !== 1) {
      throw new TypeError("Expected one valid-empty coverage interval");
    }
    intervals[0]!.start = captureWindow.start;
    intervals[0]!.end = captureWindow.end;
    const sealedExport = dayflowScreenEvidenceExportSchema.parse(
      sealArtifact(
      "dayflow-export-manifest",
      "detachedManifestSha256",
      exportManifest,
      ),
    );
    const exportRef = {
      schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
      exportId: sealedExport.exportId,
      detachedManifestSha256: sealedExport.detachedManifestSha256,
    };
    const evidence = testRecord(structuredClone(context.evidence));
    evidence.coverageCode = "valid-empty";
    evidence.normalizedCoverage = structuredClone(sealedExport.coverage);
    evidence.sourceExportRefs = [exportRef];
    evidence.sourceArtifactHashes = [];
    evidence.semanticOutput = {
      schemaVersion: "dayflow-ablation-semantic-output-v0.1",
      presentationMode: "display_only",
      status: "no_suggestion",
      items: [],
    };
    evidence.acceptedClaims = [];
    evidence.fieldEvidence = [];
    evidence.rejectedClaims = [];
    evidence.conflictingClaims = [];
    const sealedEvidence = dayflowNormalizedEvidenceSchema.parse(
      sealArtifact(
        "normalized-screen-evidence",
        "dayflowNormalizedEvidenceHash",
        evidence,
      ),
    );
    return {
      ...context,
      evidence: sealedEvidence,
      resolvedExportManifests: [sealedExport],
      resolvedArtifacts: [],
      artifactBlobs: [],
      normalizedTexts: [],
    };
  }

  function renderA1(result = activeResult()) {
    return renderDayflowE1A1SemanticOutput({
      activeAttentionResult: result,
      currentAttentionResultHash: result.resultSha256,
    });
  }

  function e1ArmRunFixtureInputs() {
    const fixture = buildResolvedExecutionFixture();
    const a1ArmInput = a1ArmInputSchema.parse(fixture.armInputs[1]);
    const bArmInput = bArmInputSchema.parse(fixture.armInputs[2]);
    const cArmInput = cArmInputSchema.parse(fixture.armInputs[3]);
    const receipts = fixture.requestIssuanceReceipts.map((receipt) =>
      requestIssuanceReceiptSchema.parse(receipt),
    );
    const receiptFor = (requestId: string) => {
      const receipt = receipts.find((entry) => entry.requestId === requestId);
      if (receipt === undefined) {
        throw new TypeError(`Missing request receipt for ${requestId}`);
      }
      return receipt;
    };
    return {
      fixture,
      a1ArmInput,
      bArmInput,
      cArmInput,
      a1Receipt: receiptFor(a1ArmInput.requestId),
      bReceipt: receiptFor(bArmInput.requestId),
    };
  }

  function noSuggestionA1RenderResult() {
    const result = structuredClone(activeResult());
    const decision = testRecord(testRecord(result).decision);
    if (decision.topSuggestion !== null) {
      testRecord(decision.topSuggestion).title =
        "https://private.example/no-suggestion";
    }
    for (const alternative of e1Records(
      decision.alternatives,
      "A1 alternatives",
    )) {
      alternative.title = "https://private.example/no-suggestion";
    }
    testRecord(result).resultSha256 = activeAttentionResultSha256(result);
    return renderA1(result);
  }

  it("renders A1 in strict order with display-only public fields", () => {
    const result = activeResult();
    const rendered = renderA1(result);
    const candidates =
      result.decision.status === "suggested"
        ? [
            ...(result.decision.topSuggestion === null
              ? []
              : [result.decision.topSuggestion]),
            ...result.decision.alternatives,
          ]
        : [];

    expect(
      rendered.semanticOutput.items.map((item) => item.title),
    ).toEqual(candidates.map((candidate) => candidate.title));
    expect(
      rendered.semanticOutput.items.map((item) => item.summary),
    ).toEqual(candidates.map((candidate) => candidate.explanation));
    expect(
      rendered.semanticOutput.items.every(
        (item) =>
          item.caveatCodes.length === 0 &&
          item.claimIds.length === 0,
      ),
    ).toBe(true);
    expect(
      Object.keys(rendered.semanticOutput.items[0]!).sort(),
    ).toEqual([
      "caveatCodes",
      "claimIds",
      "position",
      "summary",
      "title",
    ]);
    expect(JSON.stringify(rendered.semanticOutput)).not.toMatch(
      /candidateId|firstStep|intervention|action|target|sourceId|capability|destination/u,
    );
    expect(renderA1(result)).toEqual(rendered);
    expect(() =>
      renderDayflowE1A1SemanticOutput({
        activeAttentionResult: result,
        currentAttentionResultHash: SHA,
      }),
    ).toThrow(/checkpoint hash/u);
  });

  it("omits unsafe candidates and never emits an overlong candidate", () => {
    const unsafe = structuredClone(activeResult());
    const decision = testRecord(testRecord(unsafe).decision);
    const candidates = [
      decision.topSuggestion,
      ...e1Records(decision.alternatives, "alternatives"),
    ]
      .filter((candidate) => candidate !== null)
      .map((candidate) => testRecord(candidate));
    for (const candidate of candidates) {
      candidate.title = "https://private.example/path";
    }
    testRecord(unsafe).resultSha256 =
      activeAttentionResultSha256(unsafe);
    expect(renderA1(unsafe).semanticOutput).toMatchObject({
      status: "no_suggestion",
      items: [],
    });

    const overlong = structuredClone(activeResult());
    const overlongDecision = testRecord(
      testRecord(overlong).decision,
    );
    testRecord(overlongDecision.topSuggestion).title =
      "x".repeat(121);
    testRecord(overlong).resultSha256 =
      activeAttentionResultSha256(overlong);
    try {
      const output = renderA1(overlong);
      expect(
        output.semanticOutput.items.some(
          (item) => item.title.length > 120,
        ),
      ).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("uses one A/B renderer and applies only the approved B overlay", () => {
    const active = activeResult();
    const a1 = renderA1(active);
    const context = eligibleBContext();
    const b = renderDayflowE1BSemanticOutput({
      activeAttentionResult: active,
      currentAttentionResultHash: active.resultSha256,
      screenContext: context,
    });

    expect(b.outcome).toBe("rendered");
    expect(b.rendererVersion).toBe(a1.rendererVersion);
    expect(
      b.semanticOutput.items.map((item) => item.title),
    ).toEqual(a1.semanticOutput.items.map((item) => item.title));
    expect(b.semanticOutput.items.slice(1)).toEqual(
      a1.semanticOutput.items.slice(1),
    );
    expect(
      b.semanticOutput.items[0]!.summary.startsWith(
        `${a1.semanticOutput.items[0]!.summary} 화면 맥락: `,
      ),
    ).toBe(true);
    expect(b.semanticOutput.items[0]!.caveatCodes).toEqual([
      "NOT_ACTIONABLE",
      "NOT_COMPLETION_EVIDENCE",
      "SCREEN_CONTEXT_ONLY",
    ]);
    expect(b.semanticOutput.items[0]!.claimIds).toHaveLength(1);
    expect(
      renderDayflowE1BSemanticOutput({
        activeAttentionResult: active,
        currentAttentionResultHash: active.resultSha256,
        screenContext: context,
      }),
    ).toEqual(b);
  });

  it("preserves exact A1 semantics for every B fallback class", () => {
    const active = activeResult();
    const a1 = renderA1(active);
    const base = eligibleBContext();
    const validEmpty = validEmptyScreenContext();
    const lowConfidence = resealScreenEvidence(
      base,
      (evidence) => {
        for (const claim of e1Records(
          evidence.acceptedClaims,
          "accepted claims",
        )) {
          if (claim.claimClass === "RECENT_FOCUS") {
            claim.confidenceBasisPoints = 7_999;
          }
        }
      },
    );
    const noContext = resealScreenEvidence(base, (evidence) => {
      for (const claim of e1Records(
        evidence.acceptedClaims,
        "accepted claims",
      )) {
        claim.claimClass = "VISIBLE_SUBJECT";
      }
    });
    const unsafe = resealScreenEvidence(base, (evidence) => {
      e1Records(
        testRecord(evidence.semanticOutput).items,
        "semantic items",
      )[0]!.summary = "x".repeat(490);
    });
    const expiresAt = String(testRecord(base.evidence).expiresAt);
    const cases: readonly [
      DayflowE1ResolvedScreenEvidenceInput,
      (typeof DAYFLOW_E1_B_FALLBACK_CODES)[number],
    ][] = [
      [{ ...base, evidence: {} }, "SCREEN_CONTEXT_INVALID"],
      [
        { state: "unavailable" },
        "SCREEN_CONTEXT_UNAVAILABLE",
      ],
      [{ state: "rejected" }, "SCREEN_CONTEXT_REJECTED"],
      [{ state: "failure" }, "SCREEN_CONTEXT_FAILURE"],
      [
        { ...base, asOf: expiresAt },
        "SCREEN_CONTEXT_EXPIRED",
      ],
      [
        { ...base, asOf: "9999-12-31T23:59:59.999Z" },
        "SCREEN_CONTEXT_EXPIRED",
      ],
      [validEmpty, "SCREEN_CONTEXT_VALID_EMPTY"],
      [lowConfidence, "SCREEN_CONTEXT_LOW_CONFIDENCE"],
      [noContext, "SCREEN_CONTEXT_NO_CONTEXT"],
      [unsafe, "SCREEN_CONTEXT_UNSAFE"],
    ];

    for (const [screenContext, code] of cases) {
      const b = renderDayflowE1BSemanticOutput({
        activeAttentionResult: active,
        currentAttentionResultHash: active.resultSha256,
        screenContext,
      });
      expect(b.outcome).toBe("fallback");
      expect(b.fallbackCodes).toEqual([code]);
      expect(b.semanticOutput).toEqual(a1.semanticOutput);
      expect(b.semanticOutputSha256).toBe(
        a1.semanticOutputSha256,
      );
      expect(Array.from(b.semanticOutputBytes)).toEqual(
        Array.from(a1.semanticOutputBytes),
      );
    }

    for (const excludedClass of [
      "VISIBLE_APPLICATION",
      "VISIBLE_SUBJECT",
      "DISPLAY_TITLE_HINT",
    ] as const) {
      const excluded = resealScreenEvidence(base, (evidence) => {
        for (const claim of e1Records(
          evidence.acceptedClaims,
          "accepted claims",
        )) {
          claim.claimClass = excludedClass;
        }
      });
      expect(
        renderDayflowE1BSemanticOutput({
          activeAttentionResult: active,
          currentAttentionResultHash: active.resultSha256,
          screenContext: excluded,
        }),
      ).toMatchObject({
        outcome: "fallback",
        fallbackCodes: ["SCREEN_CONTEXT_NO_CONTEXT"],
      });
    }
  });

  it("requires exact C leaf lineage and strips claim IDs from blind review", () => {
    const context = eligibleCContext();
    const first = renderDayflowE1CSemanticOutput({
      screenContext: context,
    });
    expect(
      renderDayflowE1CSemanticOutput({ screenContext: context }),
    ).toEqual(first);
    expect(first.outcome).toBe("rendered");
    if (first.outcome !== "rendered") {
      throw new TypeError("Expected rendered C");
    }
    const sourceItems = e1Records(
      testRecord(testRecord(context.evidence).semanticOutput).items,
      "semantic items",
    );
    expect(
      first.semanticOutput.items.map((item) => item.title),
    ).toEqual(sourceItems.map((item) => item.title));
    expect(
      first.semanticOutput.items.every(
        (item) =>
          item.caveatCodes.includes("NOT_ACTIONABLE") &&
          item.caveatCodes.includes(
            "NOT_COMPLETION_EVIDENCE",
          ) &&
          item.caveatCodes.includes("SCREEN_CONTEXT_ONLY"),
      ),
    ).toBe(true);

    const projection =
      projectDayflowE1SemanticOutputForBlindReview(
        first.semanticOutput,
      );
    expect(
      projection.every(
        (item) =>
          Object.keys(item).sort().join(",") ===
          "caveatCodes,summary,title",
      ),
    ).toBe(true);
    expect(JSON.stringify(projection)).not.toMatch(/claimId/u);

    const rawMutation = resealScreenEvidence(
      context,
      (record) => {
        record.activityKind = "Unrelated observed activity";
        record.subjectLabel = "Unrelated observed subject";
      },
    );
    expect(
      renderDayflowE1CSemanticOutput({
        screenContext: rawMutation,
      }),
    ).toEqual(first);

    const unsafe = resealScreenEvidence(context, (record) => {
      e1Records(
        testRecord(record.semanticOutput).items,
        "semantic items",
      )[0]!.title = "/Users/private/credential";
    });
    expect(
      renderDayflowE1CSemanticOutput({
        screenContext: unsafe,
      }),
    ).toMatchObject({
      outcome: "failure",
      failureCodes: ["SCREEN_CONTEXT_UNSAFE"],
      semanticOutput: null,
    });

    const invalidLineage = resealScreenEvidence(
      context,
      (record) => {
        const title = e1Records(
          record.acceptedClaims,
          "accepted claims",
        ).find((claim) =>
          String(claim.outputFieldPath).endsWith("/title"),
        );
        if (title === undefined) {
          throw new TypeError("Expected title claim");
        }
        title.claimClass = "DISPLAY_TITLE_HINT";
      },
    );
    expect(
      renderDayflowE1CSemanticOutput({
        screenContext: invalidLineage,
      }),
    ).toMatchObject({
      outcome: "failure",
      failureCodes: [
        "SCREEN_CONTEXT_CLAIM_LINEAGE_INVALID",
      ],
    });

    const empty = validEmptyScreenContext();
    expect(
      renderDayflowE1CSemanticOutput({
        screenContext: empty,
      }),
    ).toMatchObject({
      outcome: "no_suggestion",
      semanticOutput: {
        status: "no_suggestion",
        items: [],
      },
    });

    const cFailures: readonly [
      DayflowE1ResolvedScreenEvidenceInput,
      string,
    ][] = [
      [
        { state: "unavailable" },
        "SCREEN_CONTEXT_UNAVAILABLE",
      ],
      [{ state: "rejected" }, "SCREEN_CONTEXT_REJECTED"],
      [{ state: "failure" }, "SCREEN_CONTEXT_FAILURE"],
      [{ ...context, evidence: {} }, "SCREEN_CONTEXT_INVALID"],
      [
        {
          ...context,
          asOf: "9999-12-31T23:59:59.999Z",
        },
        "SCREEN_CONTEXT_EXPIRED",
      ],
    ];
    for (const [screenContext, failureCode] of cFailures) {
      expect(
        renderDayflowE1CSemanticOutput({ screenContext }),
      ).toMatchObject({
        outcome: "failure",
        failureCodes: [failureCode],
        semanticOutput: null,
      });
    }
  });

  it("builds deterministic terminal v0.4 runs for every A1, B, and C outcome", () => {
    const inputs = e1ArmRunFixtureInputs();
    const startedAt = "2026-08-17T10:00:00.000Z";
    const completedAt = "2026-08-17T10:00:00.025Z";
    const a1Rendered = renderA1();
    const a1NoSuggestion = noSuggestionA1RenderResult();
    const bRendered = renderDayflowE1BSemanticOutput({
      activeAttentionResult: activeResult(),
      currentAttentionResultHash: activeResult().resultSha256,
      screenContext: eligibleBContext(),
    });
    const bFallback = renderDayflowE1BSemanticOutput({
      activeAttentionResult: activeResult(),
      currentAttentionResultHash: activeResult().resultSha256,
      screenContext: { state: "unavailable" },
    });
    const inactiveResult = structuredClone(activeResult());
    const inactiveDecision = testRecord(testRecord(inactiveResult).decision);
    if (inactiveDecision.topSuggestion !== null) {
      testRecord(inactiveDecision.topSuggestion).title =
        "https://private.example/no-suggestion";
    }
    for (const alternative of e1Records(
      inactiveDecision.alternatives,
      "inactive alternatives",
    )) {
      alternative.title = "https://private.example/no-suggestion";
    }
    testRecord(inactiveResult).resultSha256 =
      activeAttentionResultSha256(inactiveResult);
    const bFallbackNoSuggestion = renderDayflowE1BSemanticOutput({
      activeAttentionResult: inactiveResult,
      currentAttentionResultHash: String(testRecord(inactiveResult).resultSha256),
      screenContext: { state: "unavailable" },
    });
    const cRendered = renderDayflowE1CSemanticOutput({
      screenContext: eligibleCContext(),
    });
    const cNoSuggestion = renderDayflowE1CSemanticOutput({
      screenContext: validEmptyScreenContext(),
    });
    const cFailure = renderDayflowE1CSemanticOutput({
      screenContext: { state: "unavailable" },
    });

    const a1Completed = buildDayflowE1ArmRun({
      runId: "synthetic.e1.a1.completed.0",
      armInput: inputs.a1ArmInput,
      requestIssuanceReceipt: inputs.a1Receipt,
      renderResult: a1Rendered,
      startedAt,
      completedAt,
    });
    const a1NoOutput = buildDayflowE1ArmRun({
      runId: "synthetic.e1.a1.no-output.0",
      armInput: inputs.a1ArmInput,
      requestIssuanceReceipt: inputs.a1Receipt,
      renderResult: a1NoSuggestion,
      startedAt,
      completedAt,
    });
    const bCompleted = buildDayflowE1ArmRun({
      runId: "synthetic.e1.b.completed.0",
      armInput: inputs.bArmInput,
      requestIssuanceReceipt: inputs.bReceipt,
      renderResult: bRendered,
      startedAt,
      completedAt,
    });
    const bFallbackCompleted = buildDayflowE1ArmRun({
      runId: "synthetic.e1.b.fallback.completed.0",
      armInput: inputs.bArmInput,
      requestIssuanceReceipt: inputs.bReceipt,
      renderResult: bFallback,
      startedAt,
      completedAt,
    });
    const bFallbackNoOutput = buildDayflowE1ArmRun({
      runId: "synthetic.e1.b.fallback.no-output.0",
      armInput: inputs.bArmInput,
      requestIssuanceReceipt: inputs.bReceipt,
      renderResult: bFallbackNoSuggestion,
      startedAt,
      completedAt,
    });
    const cCompleted = buildDayflowE1ArmRun({
      runId: "synthetic.e1.c.completed.0",
      armInput: inputs.cArmInput,
      renderResult: cRendered,
      startedAt,
      completedAt,
    });
    const cNoOutput = buildDayflowE1ArmRun({
      runId: "synthetic.e1.c.no-output.0",
      armInput: inputs.cArmInput,
      renderResult: cNoSuggestion,
      startedAt,
      completedAt,
    });
    const cFailed = buildDayflowE1ArmRun({
      runId: "synthetic.e1.c.failed.0",
      armInput: inputs.cArmInput,
      renderResult: cFailure,
      startedAt,
      completedAt,
    });

    expect([
      a1Completed.status,
      a1NoOutput.status,
      bCompleted.status,
      bFallbackCompleted.status,
      bFallbackNoOutput.status,
      cCompleted.status,
      cNoOutput.status,
      cFailed.status,
    ]).toEqual([
      "completed",
      "no_output",
      "completed",
      "completed",
      "no_output",
      "completed",
      "no_output",
      "failed",
    ]);
    for (const run of [
      a1Completed,
      a1NoOutput,
      bCompleted,
      bFallbackCompleted,
      bFallbackNoOutput,
      cCompleted,
      cNoOutput,
      cFailed,
    ]) {
      expect(runSchema.parse(run)).toEqual(run);
      expect(run.runSha256).toBe(hashRegisteredArtifact("arm-run", run));
      expect(run.attempts).toHaveLength(1);
      expect(run.attempts[0]).toMatchObject({
        attemptIndex: 0,
        attemptKind:
          run.status === "failed"
            ? "deterministic_failure"
            : "deterministic_success",
        startedAt,
        completedAt,
        latencyMs: 25,
        inputTokens: 0,
        outputTokens: 0,
        costMicrounits: 0,
      });
      expect(run.attempts[0]).not.toHaveProperty("providerGenerationId");
      expect(run.attempts).toHaveLength(1);
    }
    expect(a1NoOutput).toMatchObject({
      terminalFailureCode: "NO_ELIGIBLE_OUTPUT",
      validationIssueCodes: ["NO_ELIGIBLE_OUTPUT"],
    });
    expect(cFailed.semanticOutput).toBeUndefined();
    expect(cFailed.outputHash).toBeUndefined();
    expect(cFailed.validationIssueCodes).toEqual(cFailure.failureCodes);
  });

  it("derives request, response, receipt, ordering, and run hashes without caller hash authority", () => {
    const inputs = e1ArmRunFixtureInputs();
    const renderResult = renderA1();
    const buildInput = {
      runId: "synthetic.e1.a1.deterministic.0",
      armInput: inputs.a1ArmInput,
      requestIssuanceReceipt: inputs.a1Receipt,
      renderResult,
      startedAt: "2026-08-17T10:00:00.000Z",
      completedAt: "2026-08-17T10:00:00.025Z",
    } as const;
    const first = buildDayflowE1ArmRun(buildInput);
    const second = buildDayflowE1ArmRun(buildInput);
    const attempt = first.attempts[0]!;

    expect(second).toEqual(first);
    expect(attempt.requestSha256).toBe(
      domainSeparatedSha256(DAYFLOW_E1_DETERMINISTIC_REQUEST_HASH_DOMAIN, {
        requestSchemaVersion:
          DAYFLOW_E1_DETERMINISTIC_REQUEST_SCHEMA_VERSION,
        runnerVersion: DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION,
        rendererVersion: DAYFLOW_E1_AB_RENDERER_VERSION,
        armInput: inputs.a1ArmInput,
      }),
    );
    if (attempt.attemptKind !== "deterministic_success") {
      throw new TypeError("Expected deterministic success attempt");
    }
    expect(attempt.responseSha256).toBe(
      rawSha256(renderResult.semanticOutputBytes),
    );
    expect(attempt.attemptOutputHash).toBe(
      renderResult.semanticOutputSha256,
    );
    expect(first).toMatchObject({
      armId: "A1",
      runKind: "causal_generation",
      checkpointRef: inputs.a1ArmInput.checkpointRef,
      matchedPairId: inputs.a1ArmInput.matchedPairId,
      requestOrderManifestRef: inputs.a1ArmInput.requestOrderManifestRef,
      requestId: inputs.a1ArmInput.requestId,
      requestPosition: inputs.a1ArmInput.requestPosition,
      issuanceSequence: inputs.a1Receipt.issuanceSequence,
      requestIssuanceReceiptRef: {
        schemaVersion:
          "dayflow-ablation-request-issuance-receipt-v0.1",
        requestIssuanceReceiptId:
          inputs.a1Receipt.requestIssuanceReceiptId,
        requestIssuanceReceiptSha256:
          inputs.a1Receipt.requestIssuanceReceiptSha256,
      },
    });

    const cRun = buildDayflowE1ArmRun({
      runId: "synthetic.e1.c.no-causal-fields.0",
      armInput: inputs.cArmInput,
      renderResult: renderDayflowE1CSemanticOutput({
        screenContext: eligibleCContext(),
      }),
      startedAt: buildInput.startedAt,
      completedAt: buildInput.completedAt,
    });
    for (const causalKey of [
      "checkpointRef",
      "matchedPairId",
      "requestOrderManifestRef",
      "requestId",
      "requestPosition",
      "requestIssuanceReceiptRef",
      "issuanceSequence",
    ]) {
      expect(cRun).not.toHaveProperty(causalKey);
    }
  });

  it("preserves B fallback semantics and sorted diagnostics in the run", () => {
    const inputs = e1ArmRunFixtureInputs();
    const active = activeResult();
    const a1 = renderA1(active);
    const fallback = renderDayflowE1BSemanticOutput({
      activeAttentionResult: active,
      currentAttentionResultHash: active.resultSha256,
      screenContext: { state: "unavailable" },
    });
    const run = buildDayflowE1ArmRun({
      runId: "synthetic.e1.b.fallback.binding.0",
      armInput: inputs.bArmInput,
      requestIssuanceReceipt: inputs.bReceipt,
      renderResult: fallback,
      startedAt: "2026-08-17T10:00:00.000Z",
      completedAt: "2026-08-17T10:00:00.025Z",
    });
    expect(fallback.outcome).toBe("fallback");
    expect(fallback.semanticOutput).toEqual(a1.semanticOutput);
    expect(fallback.semanticOutputSha256).toBe(a1.semanticOutputSha256);
    expect(Array.from(fallback.semanticOutputBytes)).toEqual(
      Array.from(a1.semanticOutputBytes),
    );
    expect(run.semanticOutput).toEqual(a1.semanticOutput);
    expect(run.outputHash).toBe(a1.semanticOutputSha256);
    expect(run.validationIssueCodes).toEqual(
      [...fallback.fallbackCodes].sort(),
    );
  });

  it("rejects mismatched lineage, forged renderer results, A0, and non-strict inputs", () => {
    const inputs = e1ArmRunFixtureInputs();
    const renderResult = renderA1();
    const valid = {
      runId: "synthetic.e1.a1.rejection-base.0",
      armInput: inputs.a1ArmInput,
      requestIssuanceReceipt: inputs.a1Receipt,
      renderResult,
      startedAt: "2026-08-17T10:00:00.000Z",
      completedAt: "2026-08-17T10:00:00.025Z",
    } as const;

    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        requestIssuanceReceipt: inputs.bReceipt,
      }),
    ).toThrow(/receipt/u);
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        startedAt: "2000-01-01T00:00:00.000Z",
        completedAt: "2000-01-01T00:00:00.025Z",
      }),
    ).toThrow(/receipt/u);

    const tamperedArmInput = structuredClone(inputs.a1ArmInput);
    testRecord(tamperedArmInput).armInputHash = SHA;
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        armInput: tamperedArmInput,
      }),
    ).toThrow(/arm-input detached hash/u);
    const tamperedReceipt = structuredClone(inputs.a1Receipt);
    testRecord(tamperedReceipt).requestIssuanceReceiptSha256 = SHA;
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        requestIssuanceReceipt: tamperedReceipt,
      }),
    ).toThrow(/registered request-issuance-receipt hash mismatch/u);

    const bResult = renderDayflowE1BSemanticOutput({
      activeAttentionResult: activeResult(),
      currentAttentionResultHash: activeResult().resultSha256,
      screenContext: eligibleBContext(),
    });
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        renderResult: bResult,
      } as unknown as Parameters<typeof buildDayflowE1ArmRun>[0]),
    ).toThrow(/metadata/u);

    const tamperedSemanticObject = structuredClone(renderResult);
    const semanticItems = e1Records(
      testRecord(testRecord(tamperedSemanticObject).semanticOutput).items,
      "tampered semantic items",
    );
    testRecord(semanticItems[0]).title = "Tampered title";
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        renderResult: tamperedSemanticObject,
      }),
    ).toThrow(/integrity/u);
    const tamperedSemanticHash = structuredClone(renderResult);
    testRecord(tamperedSemanticHash).semanticOutputSha256 = SHA;
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        renderResult: tamperedSemanticHash,
      }),
    ).toThrow(/integrity/u);
    const tamperedSemanticBytes = structuredClone(renderResult);
    testRecord(tamperedSemanticBytes).semanticOutputBytes = new Uint8Array([123]);
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        renderResult: tamperedSemanticBytes,
      }),
    ).toThrow(/integrity/u);

    const cFailure = structuredClone(
      renderDayflowE1CSemanticOutput({
        screenContext: { state: "unavailable" },
      }),
    );
    testRecord(cFailure).failureCodes = [
      "SCREEN_CONTEXT_UNAVAILABLE",
      "SCREEN_CONTEXT_UNSAFE",
    ];
    expect(() =>
      buildDayflowE1ArmRun({
        runId: "synthetic.e1.c.multi-failure.0",
        armInput: inputs.cArmInput,
        renderResult: cFailure,
        startedAt: valid.startedAt,
        completedAt: valid.completedAt,
      }),
    ).toThrow(/one failure/u);

    expect(() =>
      Reflect.apply(buildDayflowE1ArmRun, undefined, [
        {
          ...valid,
          armInput: inputs.fixture.armInputs[0],
        },
      ]),
    ).toThrow(/Only A1, B, and C/u);
    expect(() =>
      buildDayflowE1ArmRun({
        ...valid,
        callerRequestSha256: SHA,
      } as unknown as Parameters<typeof buildDayflowE1ArmRun>[0]),
    ).toThrow(/key set/u);
  });

  it("integrates generated A1, B, and C runs into the resolved execution bundle", () => {
    const fixture = buildResolvedExecutionFixture();
    const existingA0 = fixture.runs[0];
    const existingA1 = fixture.runs[1];
    const existingB = fixture.runs[2];
    const existingC = fixture.runs[3];
    if (
      existingA0 === undefined ||
      existingA1 === undefined ||
      existingB === undefined ||
      existingC === undefined
    ) {
      throw new TypeError("Expected the frozen four-arm execution fixture");
    }

    const a1ArmInput = a1ArmInputSchema.parse(fixture.armInputs[1]);
    const bArmInput = bArmInputSchema.parse(fixture.armInputs[2]);
    const cArmInput = cArmInputSchema.parse(fixture.armInputs[3]);
    const receipts = fixture.requestIssuanceReceipts.map((receipt) =>
      requestIssuanceReceiptSchema.parse(receipt),
    );
    const receiptFor = (requestId: string) => {
      const receipt = receipts.find((entry) => entry.requestId === requestId);
      if (receipt === undefined) {
        throw new TypeError(`Missing request receipt for ${requestId}`);
      }
      return receipt;
    };
    const active = activeResult();
    const generatedA1 = buildDayflowE1ArmRun({
      runId: existingA1.runId,
      armInput: a1ArmInput,
      requestIssuanceReceipt: receiptFor(a1ArmInput.requestId),
      renderResult: renderA1(active),
      startedAt: existingA1.startedAt,
      completedAt: existingA1.completedAt,
    });
    const generatedB = buildDayflowE1ArmRun({
      runId: existingB.runId,
      armInput: bArmInput,
      requestIssuanceReceipt: receiptFor(bArmInput.requestId),
      renderResult: renderDayflowE1BSemanticOutput({
        activeAttentionResult: active,
        currentAttentionResultHash: active.resultSha256,
        screenContext: eligibleBContext(),
      }),
      startedAt: existingB.startedAt,
      completedAt: existingB.completedAt,
    });
    const generatedC = buildDayflowE1ArmRun({
      runId: existingC.runId,
      armInput: cArmInput,
      renderResult: renderDayflowE1CSemanticOutput({
        screenContext: eligibleCContext(),
      }),
      startedAt: existingC.startedAt,
      completedAt: existingC.completedAt,
    });
    const runs = [existingA0, generatedA1, generatedB, generatedC];
    const completionCandidate = testRecord(
      structuredClone(fixture.completion),
    );
    completionCandidate.presentRunRefs = runs.map((run) => ({
      schemaVersion: "dayflow-ablation-run-v0.4",
      runId: run.runId,
      runSha256: run.runSha256,
      armId: run.armId,
      replicateIndex: run.replicateIndex,
    }));
    const completion = checkpointCompletionSchema.parse(
      sealArtifact(
        "checkpoint-completion",
        "checkpointCompletionSha256",
        completionCandidate,
      ),
    );
    const integratedBundle: ResolvedExecutionBundleInput = {
      ...fixture,
      runs,
      completion,
    };

    const verification = verifyResolvedExecutionBundle(integratedBundle);
    expect(verification.valid).toBe(true);
    if (verification.valid) {
      expect(verification.bundle.runs.map((run) => run.runSha256)).toEqual(
        runs.map((run) => run.runSha256),
      );
    }

    const mutatedB = testRecord(structuredClone(generatedB));
    mutatedB.runId = "synthetic.run.b.e1.stale.completion";
    const resealedMutatedB = runSchema.parse(
      sealArtifact("arm-run", "runSha256", mutatedB),
    );
    expect(
      verifyResolvedExecutionBundle({
        ...integratedBundle,
        runs: [existingA0, generatedA1, resealedMutatedB, generatedC],
      }),
    ).toEqual({
      valid: false,
      issueCodes: ["EXECUTION_COMPLETION_MISMATCH"],
    });
  });

  it("keeps versions, closure, registry, and local purity explicit", () => {
    expect(DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION).toBe(
      "dayflow-e1-deterministic-arm-runner-v0.1",
    );
    expect(DAYFLOW_E1_AB_RENDERER_VERSION).toBe(
      "dayflow-e1-ab-renderer-v0.1",
    );
    expect(DAYFLOW_E1_C_RENDERER_VERSION).toBe(
      "dayflow-e1-c-renderer-v0.1",
    );
    expect(DAYFLOW_E1_SCREEN_ELIGIBILITY_VERSION).toBe(
      "dayflow-e1-screen-eligibility-v0.1",
    );
    expect(DAYFLOW_E1_PUBLIC_TEXT_GUARD_VERSION).toBe(
      "dayflow-e1-public-text-guard-v0.1",
    );
    expect(DAYFLOW_E1_PRESENTATION_VERSION).toBe(
      "dayflow-e1-display-only-presentation-v0.1",
    );
    expect(DFA002_CONTRACT_SOURCE_ENTRIES).toHaveLength(11);
    expect(
      DFA002_REQUIRED_PROVENANCE_PIN_SHAPES,
    ).toHaveLength(22);
    expect(DFA002_REQUIRED_COMMANDS).toHaveLength(4);
    expect(
      DFA002_REQUIRED_COMMANDS.slice(0, 2).every((command) =>
        command.argv.some(
          (argument: string) =>
            argument ===
            "src/evaluation/dayflowAblation/runGeneration.ts",
        ),
      ),
    ).toBe(true);
    expect(DAYFLOW_ABLATION_ARTIFACT_REGISTRY).toHaveLength(30);
    expect(
      [
        buildDayflowE1ArmRun,
        renderDayflowE1A1SemanticOutput,
        renderDayflowE1BSemanticOutput,
        renderDayflowE1CSemanticOutput,
      ]
        .map(String)
        .join("\n"),
    ).not.toMatch(
      /node:fs|process\.|fetch\(|provider|network|\.local|Math\.random|Date\.now/u,
    );
  });
});

describe("two-stage synthetic manifest and run-results builders", () => {
  function buildStageAInput(): DayflowAblationSyntheticManifestBuildInput {
    const encoder = new TextEncoder();
    const requiredPaths = Array.from(
      new Set([
        ...DFA002_CONTRACT_SOURCE_ENTRIES.map((entry) => entry.relativePath),
        ...DFA002_COMMAND_DEFINING_INPUTS,
        ...DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.filter(
          (entry) =>
            entry.repositoryId === "blabase" &&
            entry.pinKind === "file-sha256",
        ).map((entry) => entry.relativePath),
      ]),
    ).sort();
    const configBytes = encoder.encode(configRaw);
    const casesBytes = encoder.encode(casesRaw);
    const sourceSnapshot = requiredPaths.map((relativePath) => {
      const bytes =
        relativePath ===
        "suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json"
          ? configBytes
          : relativePath ===
              "suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.2.json"
            ? casesBytes
            : encoder.encode(`SYNTHETIC_STAGE_A_SOURCE:${relativePath}\n`);
      return {
        relativePath,
        bytes,
        expectedByteLength: String(bytes.byteLength),
        expectedRawSha256: rawSha256(bytes),
      };
    });
    const revision = (repositoryId: "blabase" | "dayflow") => {
      const pin = DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.find(
        (entry) =>
          entry.repositoryId === repositoryId &&
          entry.pinKind === "repository-revision",
      );
      if (pin === undefined || !("expectedRevision" in pin)) {
        throw new TypeError("Missing synthetic revision fixture");
      }
      return pin.expectedRevision;
    };
    const dayflowFilePins = DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.filter(
      (entry) =>
        entry.repositoryId === "dayflow" && entry.pinKind === "file-sha256",
    ).map((entry) => {
      if (
        !("expectedSha256" in entry) ||
        !("expectedByteLength" in entry)
      ) {
        throw new TypeError("Missing synthetic Dayflow pin fixture");
      }
      return {
        relativePath: entry.relativePath,
        expectedByteLength: entry.expectedByteLength,
        expectedSha256: entry.expectedSha256,
      };
    });
    return {
      mode: "synthetic-contract-conformance",
      runLabel: "s6-2b-two-stage",
      configBytes,
      casesBytes,
      sourceSnapshot,
      provenanceFacts: {
        blabaseRevision: revision("blabase"),
        dayflowRevision: revision("dayflow"),
        dayflowFilePins,
      },
      toolVersions: {
        node: "22.23.2",
        dependencyCruiser: DFA002_REQUIRED_COMMANDS[0].toolVersion,
        eslint: DFA002_REQUIRED_COMMANDS[1].toolVersion,
        typescript: DFA002_REQUIRED_COMMANDS[2].toolVersion,
        vitest: DFA002_REQUIRED_COMMANDS[3].toolVersion,
      },
      manifestCreatedAt: "2026-08-17T08:45:00.000Z",
    };
  }

  function buildStageBFixture() {
    const stageA = buildDayflowAblationSyntheticExperimentManifest(
      buildStageAInput(),
    );
    const bundle = buildResolvedExecutionFixture(stageA.experimentManifest);
    const completedAt = String(testRecord(bundle.completion).completedAt);
    return {
      stageA,
      bundle,
      input: {
        stageA,
        studyProtocol: bundle.studyProtocol,
        executionFreeze: bundle.executionFreeze,
        terminalRuns: bundle.runs,
        completedAt,
      },
    };
  }

  it("builds the current manifest deterministically from bytes and stable facts", () => {
    const first = buildDayflowAblationSyntheticExperimentManifest(
      buildStageAInput(),
    );
    const second = buildDayflowAblationSyntheticExperimentManifest(
      buildStageAInput(),
    );

    expect(first).toEqual(second);
    expect(experimentManifestSchema.parse(first.experimentManifest)).toEqual(
      first.experimentManifest,
    );
    expect(
      experimentManifestRefSchema.parse(first.experimentManifestRef),
    ).toEqual(first.experimentManifestRef);
    expect(first.experimentManifest.experimentManifestSha256).toBe(
      dayflowAblationExperimentManifestSha256(first.experimentManifest),
    );
    expect(
      first.experimentManifest.validationInputSet.candidateFiles,
    ).toHaveLength(11);
    expect(
      first.experimentManifest.validationInputSet.commandDefiningFiles,
    ).toHaveLength(10);
    expect(
      first.experimentManifest.sourceProvenance.pins,
    ).toHaveLength(22);
    expect(first.experimentManifest.commandIdentities).toHaveLength(4);
    expect(DAYFLOW_ABLATION_ARTIFACT_REGISTRY).toHaveLength(30);
  });

  it("rejects Stage A source, input, tool, timestamp, ordering, and hash authority", () => {
    const input = buildStageAInput();
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest({
        ...input,
        sourceSnapshot: input.sourceSnapshot.slice(1),
      }),
    ).toThrow(/sourceSnapshot/u);
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest({
        ...input,
        sourceSnapshot: [...input.sourceSnapshot, input.sourceSnapshot[0]!],
      }),
    ).toThrow(/sourceSnapshot/u);
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest({
        ...input,
        sourceSnapshot: [...input.sourceSnapshot].reverse(),
      }),
    ).toThrow(/sourceSnapshot/u);
    const tamperedSnapshot = structuredClone(input.sourceSnapshot);
    tamperedSnapshot[0]!.bytes = new Uint8Array([
      ...tamperedSnapshot[0]!.bytes,
      0x20,
    ]);
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest({
        ...input,
        sourceSnapshot: tamperedSnapshot,
      }),
    ).toThrow(/stable fact mismatch/u);
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest({
        ...input,
        configBytes: new Uint8Array([...input.configBytes, 0x20]),
      }),
    ).toThrow(/configBytes and casesBytes/u);
    const invalidToolVersionInput: unknown = {
      ...input,
      toolVersions: { ...input.toolVersions, eslint: "0.0.0" },
    };
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest(
        invalidToolVersionInput as DayflowAblationSyntheticManifestBuildInput,
      ),
    ).toThrow();
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest({
        ...input,
        manifestCreatedAt: "not-a-timestamp",
      }),
    ).toThrow();
    expect(() =>
      buildDayflowAblationSyntheticExperimentManifest({
        ...input,
        validationInputSetSha256: SHA,
      } as DayflowAblationSyntheticManifestBuildInput),
    ).toThrow();
  });

  it("builds sealed run-results from full resolved lineage and feeds packaging", () => {
    const { stageA, input } = buildStageBFixture();
    const first = buildDayflowAblationSyntheticRunResults(input);
    const second = buildDayflowAblationSyntheticRunResults(input);

    expect(first).toEqual(second);
    expect(runResultsSchema.parse(first.runResults)).toEqual(first.runResults);
    expect(runResultsRefSchema.parse(first.runResultsRef)).toEqual(
      first.runResultsRef,
    );
    expect(first.runResults.runResultsSha256).toBe(
      dayflowAblationRunResultsSha256(first.runResults),
    );
    expect(first.runResults.terminalArmRunRefs.map((run) => run.armId)).toEqual([
      "A0",
      "A1",
      "B",
      "C",
    ]);

    const packaged = buildDayflowAblationSyntheticDryRunPackage({
      mode: "synthetic-contract-conformance",
      runLabel: stageA.runLabel,
      experimentManifest: stageA.experimentManifest,
      runResults: first.runResults,
      configIdentity: {
        configId: stageA.experimentManifest.configurationIdentity.configId,
        configSha256:
          stageA.experimentManifest.configurationIdentity.configSha256,
      },
      casesIdentity: {
        fixtureSetId:
          stageA.experimentManifest.commonEvaluationInputIdentity.inputId,
        casesSha256:
          stageA.experimentManifest.commonEvaluationInputIdentity.inputSha256,
      },
      colinDecision: {
        decidedAt: "2026-08-17T09:09:00.000Z",
        outcome: "revise",
        rationale: "Synthetic two-stage packaging awaits focused validation.",
        followUpConditions: ["Run the separately approved validation gate."],
        rollback: "Discard the in-memory package without publication.",
      },
    });
    expect(packaged.files).toHaveLength(4);
    expect(packaged.files[1].rawSha256).toBe(
      rawSha256(packaged.files[1].bytes),
    );
  });

  it("rejects Stage B manifest, protocol, freeze, run, terminal, and chronology drift", () => {
    const { input } = buildStageBFixture();
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        stageA: {
          ...input.stageA,
          experimentManifestRef: {
            ...input.stageA.experimentManifestRef,
            experimentManifestSha256: "f".repeat(64),
          },
        },
      }),
    ).toThrow(/Stage A manifest/u);

    const wrongProtocol = structuredClone(input.studyProtocol);
    testRecord(wrongProtocol.experimentManifestRef).experimentManifestSha256 =
      "f".repeat(64);
    sealArtifact("study-protocol", "studyProtocolHash", wrongProtocol);
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        studyProtocol: wrongProtocol,
      }),
    ).toThrow(/Study protocol/u);

    const wrongFreeze = structuredClone(input.executionFreeze);
    testRecord(wrongFreeze.studyProtocolRef).studyProtocolHash = "f".repeat(64);
    sealArtifact(
      "evaluation-execution-freeze",
      "evaluationExecutionFreezeSha256",
      wrongFreeze,
    );
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        executionFreeze: wrongFreeze,
      }),
    ).toThrow(/replicate policy must bind the same protocol/u);

    const wrongRun = structuredClone(input.terminalRuns[0]!);
    testRecord(wrongRun.executionFreezeRef).evaluationExecutionFreezeSha256 =
      "f".repeat(64);
    sealArtifact("arm-run", "runSha256", wrongRun);
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        terminalRuns: [wrongRun, ...input.terminalRuns.slice(1)],
      }),
    ).toThrow(/does not bind/u);

    const badDetachedHash = structuredClone(input.terminalRuns[0]!);
    badDetachedHash.runSha256 = "f".repeat(64);
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        terminalRuns: [badDetachedHash, ...input.terminalRuns.slice(1)],
      }),
    ).toThrow();

    const nonterminal = structuredClone(input.terminalRuns[0]!);
    nonterminal.status = "failed";
    sealArtifact("arm-run", "runSha256", nonterminal);
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        terminalRuns: [nonterminal, ...input.terminalRuns.slice(1)],
      }),
    ).toThrow();
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        terminalRuns: [...input.terminalRuns, input.terminalRuns[0]!],
      }),
    ).toThrow(/Duplicate terminal run/u);
    expect(() =>
      buildDayflowAblationSyntheticRunResults({
        ...input,
        completedAt: "2026-08-17T09:06:00.000Z",
      }),
    ).toThrow(/chronology/u);
  });
});

describe("hermetic contract-only boundary", () => {
  it("keeps production modules free of fs, network, env, subprocess, stores, and routes", () => {
    const sources = [
      readProjectFile("src/dayflowEvidence/contracts.ts"),
      readProjectFile("src/evaluation/dayflowAblation/contracts.ts"),
      readProjectFile("src/evaluation/dayflowAblation/buildDataset.ts"),
    ].join("\n");

    expect(sources).not.toMatch(/from ["']node:(?:fs|child_process|http|https|net|tls)/u);
    expect(sources).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
    expect(sources).not.toMatch(/\bprocess\.(?:env|cwd)\b/u);
    expect(sources).not.toMatch(
      /from ["'][^"']*(?:privateArtifactStore|suggestionBoard|continuation|launcher|provider)|\b(?:callProvider|providerClient)\b/u,
    );
    expect(sources).not.toMatch(
      /export\s+(?:async\s+)?function\s+(?:issue|create|build|publish)[A-Za-z0-9_]*HumanReview/u,
    );
  });

  it("pins hermetic scoped TypeScript and Vitest configuration", () => {
    const tsconfig = readProjectFile("tsconfig.dayflow-dfa002.json");
    const vitestConfig = readProjectFile("vitest.dayflow-dfa002.config.ts");
    expect(tsconfig).toContain('"incremental": false');
    expect(tsconfig).toContain('".next/**"');
    expect(tsconfig).toContain('".local/**"');
    expect(vitestConfig).toContain("envDir: false");
    expect(vitestConfig).not.toMatch(/\b(?:loadEnv|dotenv|process\.env)\b/u);
    for (const testPath of [
      "tests/dayflowEvidenceContracts.test.ts",
      "tests/dayflowEvidenceExtraction.test.ts",
      "tests/dayflowAblationEvaluation.test.ts",
    ]) {
      expect(vitestConfig).toContain(testPath);
    }
  });

  it("keeps both tracked fixtures obviously synthetic and content-free", () => {
    for (const raw of [configRaw, casesRaw]) {
      expect(raw).toContain(SENTINEL);
      expect(raw).not.toMatch(/(?:\/Users\/|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9])/u);
      expect(raw).not.toMatch(/"(?:conversation|messageBody|screenshotBytes|rawText)"\s*:/u);
    }
    const cases = loadDayflowAblationSyntheticCases(casesRaw);
    expect(cases.rawHumanContentIncluded).toBe(false);
    expect(cases.humanConversationIncluded).toBe(false);
    expect(cases.screenshotBlobIncluded).toBe(false);
    expect(cases.filesystemPathIncluded).toBe(false);
    expect(cases.secretIncluded).toBe(false);
  });
});
