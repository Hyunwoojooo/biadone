import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { jcsCanonicalize } from "../src/dayflowEvidence/contracts";
import * as publicLineageModule from "../src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1";
import {
  PRIVATE_SCOPE_HMAC_DOMAIN_V0_1,
  RECEIPT_HASH_DOMAIN_V0_1,
  RECEIPT_SCHEMA_VERSION_V0_1,
  SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1,
  buildPrivateScopeHmacPreimageInternalV0_1,
  computePrivateScopeHmacSha256InternalV0_1,
  hashLineageReceiptInternalV0_1,
  hashRecordIdSetInternalV0_1,
  hashSourceAttestationInternalV0_1,
  parseSourceAttestationStructuralInternalV0_1,
  selectLineageFailureCodeInternalV0_1,
  type CommonSuggestionEvidenceLineageReceiptV0_1,
  type SourceCollectionAttestationInternalV0_1,
} from "../src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1.internal";
import {
  commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1,
  inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1,
  planCommonSuggestionEvidenceLineageSourceVerificationV0_1,
} from "../src/evaluation/dayflowAblation/commonSuggestionEvidenceLineageV0_1";

const AS_OF = "2026-08-21T12:00:00.000Z";
const COLLECTED_AT = "2026-08-21T11:59:00.000Z";
const WINDOW_START = "2026-08-21T10:00:00.000Z";
const WINDOW_MIDDLE = "2026-08-21T10:30:00.000Z";
const WINDOW_END = "2026-08-21T11:00:00.000Z";
const SOURCES = [
  "github",
  "codex",
  "google_calendar",
  "notion",
  "dayflow",
] as const;

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function notRequestedPlan(source: (typeof SOURCES)[number]) {
  return {
    source,
    requestStatus: "not_requested" as const,
    requestedCollectionMode: null,
    requiredOperations: [],
  };
}

function notRequestedBinding(source: (typeof SOURCES)[number]) {
  return {
    source,
    participationStatus: "not_requested" as const,
    sourceCollectionAttestationSha256: null,
    sourceArtifactSetSha256: null,
    sourceArtifactSchemaVersion: null,
    adapterId: null,
    adapterVersion: null,
    inputContractVersion: null,
    collectedAt: null,
    recordCount: 0,
    recordIdsSha256: hashRecordIdSetInternalV0_1(source, []),
    coverage: {
      coverageKind: "not_requested" as const,
      status: "not_applicable" as const,
    },
    requiredOperationStatuses: [],
    issueCodes: [],
  };
}

function rehash(
  receipt: CommonSuggestionEvidenceLineageReceiptV0_1,
): CommonSuggestionEvidenceLineageReceiptV0_1 {
  receipt.commonSuggestionEvidenceLineageReceiptSha256 =
    hashLineageReceiptInternalV0_1(receipt);
  return receipt;
}

function allNotRequestedReceipt(): CommonSuggestionEvidenceLineageReceiptV0_1 {
  return rehash({
    schemaVersion: RECEIPT_SCHEMA_VERSION_V0_1,
    asOf: AS_OF,
    commonSuggestionEvidenceRecordSetSha256: hash(1),
    privacyScopeHmacKeyVersion: null,
    privacyScopeHmacContextId: null,
    privacyScopeTokenCanonicalizationVersion: null,
    sourceCollectionPlan: SOURCES.map(notRequestedPlan),
    sourceBindings: SOURCES.map(notRequestedBinding),
    commonSuggestionEvidenceLineageReceiptSha256: hash(0),
  });
}

function githubRequestedReceipt(): CommonSuggestionEvidenceLineageReceiptV0_1 {
  const receipt = allNotRequestedReceipt();
  receipt.privacyScopeHmacKeyVersion = "fictional_key_v0.1";
  receipt.privacyScopeHmacContextId =
    "scope_context_0123456789abcdef0123456789abcdef";
  receipt.privacyScopeTokenCanonicalizationVersion =
    SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1;
  receipt.sourceCollectionPlan[0] = {
    source: "github",
    requestStatus: "requested",
    requestedCollectionMode: "repository_scope",
    requiredOperations: ["repository_scope_collection"],
  };
  receipt.sourceBindings[0] = {
    source: "github",
    participationStatus: "collected",
    sourceCollectionAttestationSha256: hash(2),
    sourceArtifactSetSha256: hash(3),
    sourceArtifactSchemaVersion: "fictional-github-artifact-v0.1",
    adapterId: "fictional.github.adapter",
    adapterVersion: "v0.1",
    inputContractVersion: "v0.1",
    collectedAt: COLLECTED_AT,
    recordCount: 0,
    recordIdsSha256: hashRecordIdSetInternalV0_1("github", []),
    coverage: {
      coverageKind: "github_scope",
      status: "complete",
      requestedRepositoryScopeHmacSha256: hash(4),
      observedRepositoryScopeHmacSha256: hash(4),
      paginationStatus: "not_applicable",
      requestedActivityWindow: null,
      coveredActivityIntervals: null,
    },
    requiredOperationStatuses: [
      { operation: "repository_scope_collection", status: "complete" },
    ],
    issueCodes: [],
  };
  return rehash(receipt);
}

const FROZEN_MODE_CASES = [
  {
    source: "github",
    mode: "repository_scope",
    operations: ["repository_scope_collection"],
  },
  {
    source: "github",
    mode: "repository_activity",
    operations: ["repository_scope_collection", "activity_pagination"],
  },
  {
    source: "codex",
    mode: "project_conversations",
    operations: ["project_scope_collection", "conversation_collection"],
  },
  {
    source: "google_calendar",
    mode: "event_window",
    operations: ["event_window_collection"],
  },
  {
    source: "notion",
    mode: "resource_scope",
    operations: ["resource_scope_collection"],
  },
  {
    source: "notion",
    mode: "resource_collection",
    operations: ["resource_scope_collection", "resource_pagination"],
  },
  {
    source: "dayflow",
    mode: "capture_privacy_ocr",
    operations: ["capture_window_collection", "privacy_ocr_preprocessing"],
  },
] as const;

function frozenModeReceipt(
  modeCase: (typeof FROZEN_MODE_CASES)[number],
): CommonSuggestionEvidenceLineageReceiptV0_1 {
  if (modeCase.source === "github" && modeCase.mode === "repository_scope") {
    return githubRequestedReceipt();
  }
  const receipt = allNotRequestedReceipt();
  const sourceIndex = SOURCES.indexOf(modeCase.source);
  receipt.sourceCollectionPlan[sourceIndex] = {
    source: modeCase.source,
    requestStatus: "requested",
    requestedCollectionMode: modeCase.mode,
    requiredOperations: [...modeCase.operations],
  };
  if (["github", "codex", "notion"].includes(modeCase.source)) {
    receipt.privacyScopeHmacKeyVersion = "fictional_key_v0.1";
    receipt.privacyScopeHmacContextId =
      "scope_context_0123456789abcdef0123456789abcdef";
    receipt.privacyScopeTokenCanonicalizationVersion =
      SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1;
  }
  const common = {
    source: modeCase.source,
    participationStatus: "collected" as const,
    sourceCollectionAttestationSha256: hash(10 + sourceIndex),
    sourceArtifactSetSha256: hash(20 + sourceIndex),
    sourceArtifactSchemaVersion: "fictional-source-artifact-v0.1",
    adapterId: "fictional.source.adapter",
    adapterVersion: "v0.1",
    inputContractVersion: "v0.1",
    collectedAt: COLLECTED_AT,
    recordCount: 0,
    recordIdsSha256: hashRecordIdSetInternalV0_1(modeCase.source, []),
    issueCodes: [],
  };
  if (modeCase.source === "github") {
    receipt.sourceBindings[sourceIndex] = {
      ...common,
      source: "github",
      coverage: {
        coverageKind: "github_scope",
        status: "complete",
        requestedRepositoryScopeHmacSha256: hash(31),
        observedRepositoryScopeHmacSha256: hash(31),
        paginationStatus: "complete",
        requestedActivityWindow: { start: WINDOW_START, end: WINDOW_END },
        coveredActivityIntervals: [
          { start: WINDOW_START, end: WINDOW_END },
        ],
      },
      requiredOperationStatuses: [
        { operation: "repository_scope_collection", status: "complete" },
        { operation: "activity_pagination", status: "complete" },
      ],
    };
  } else if (modeCase.source === "codex") {
    receipt.sourceBindings[sourceIndex] = {
      ...common,
      source: "codex",
      coverage: {
        coverageKind: "codex_collection",
        status: "complete",
        requestedProjectScopeHmacSha256: hash(32),
        observedProjectScopeHmacSha256: hash(32),
        conversationCollectionStatus: "complete",
        requestedConversationWindow: { start: WINDOW_START, end: WINDOW_END },
        coveredConversationIntervals: [
          { start: WINDOW_START, end: WINDOW_END },
        ],
      },
      requiredOperationStatuses: [
        { operation: "project_scope_collection", status: "complete" },
        { operation: "conversation_collection", status: "complete" },
      ],
    };
  } else if (modeCase.source === "google_calendar") {
    receipt.sourceBindings[sourceIndex] = {
      ...common,
      source: "google_calendar",
      coverage: {
        coverageKind: "calendar_window",
        status: "complete",
        requestedWindow: { start: WINDOW_START, end: WINDOW_END },
        coveredIntervals: [{ start: WINDOW_START, end: WINDOW_END }],
        timezoneDatabaseVersion: "2026c",
        timezoneDatabaseReleaseSha512:
          "e0b4b7044b66fbc27bc21d13d18063abcdf78ab58d5ba5fd64bd1a88d86e9d495f45add4d8e65bb6c40249f9c94ca29b72c8ebba8d0e4c468f2965ac77932ef0",
        timezoneDatabaseProfileVersion: "blabase-tzdb-profile-2026c-v1",
        timezoneDatabaseProfileSha256: hash(33),
        timezoneContext: "Etc/UTC",
      },
      requiredOperationStatuses: [
        { operation: "event_window_collection", status: "complete" },
      ],
    };
  } else if (modeCase.source === "notion") {
    const paginated = modeCase.mode === "resource_collection";
    receipt.sourceBindings[sourceIndex] = {
      ...common,
      source: "notion",
      coverage: {
        coverageKind: "notion_resource_scope",
        status: "complete",
        requestedResourceSetHmacSha256: hash(34),
        observedResourceSetHmacSha256: hash(34),
        paginationStatus: paginated ? "complete" : "not_applicable",
      },
      requiredOperationStatuses: paginated
        ? [
            { operation: "resource_scope_collection", status: "complete" },
            { operation: "resource_pagination", status: "complete" },
          ]
        : [
            { operation: "resource_scope_collection", status: "complete" },
          ],
    };
  } else {
    receipt.sourceBindings[sourceIndex] = {
      ...common,
      source: "dayflow",
      coverage: {
        coverageKind: "dayflow_capture_and_preprocessing",
        status: "complete",
        captureCoverage: {
          status: "complete",
          requestedWindow: { start: WINDOW_START, end: WINDOW_END },
          coveredIntervals: [{ start: WINDOW_START, end: WINDOW_END }],
          captureArtifactSetSha256: hash(35),
        },
        preprocessingCoverage: {
          status: "complete",
          inputCaptureArtifactSetSha256: hash(35),
          accounting: {
            accountingKind: "known",
            eligibleCaptureCount: 0,
            processedCaptureCount: 0,
          },
          preprocessingVersion: "fictional-preprocessing-v0.1",
          verifierVersion: "fictional-verifier-v0.1",
          preprocessingEvidenceSha256: common.sourceArtifactSetSha256,
        },
      },
      requiredOperationStatuses: [
        { operation: "capture_window_collection", status: "complete" },
        { operation: "privacy_ocr_preprocessing", status: "complete" },
      ] satisfies SourceCollectionAttestationInternalV0_1["requiredOperationStatuses"],
    };
  }
  return rehash(receipt);
}

function setCoverageOutcome(
  receipt: CommonSuggestionEvidenceLineageReceiptV0_1,
  status: "complete" | "partial" | "unknown",
  issueCodes: CommonSuggestionEvidenceLineageReceiptV0_1["sourceBindings"][number]["issueCodes"],
): void {
  const binding = receipt.sourceBindings.find(
    (candidate) => candidate.participationStatus === "collected",
  );
  if (!binding) throw new Error("Missing fictional collected binding");
  binding.coverage.status = status;
  if (
    binding.coverage.coverageKind ===
    "dayflow_capture_and_preprocessing"
  ) {
    binding.coverage.preprocessingCoverage.status = status;
  }
  binding.requiredOperationStatuses[
    binding.requiredOperationStatuses.length - 1
  ]!.status = status;
  binding.issueCodes = [...issueCodes];
}

function unavailableGithubReceipt(
  operationStatus: "complete" | "partial" | "unknown",
  issueCodes: CommonSuggestionEvidenceLineageReceiptV0_1["sourceBindings"][number]["issueCodes"],
): CommonSuggestionEvidenceLineageReceiptV0_1 {
  const receipt = githubRequestedReceipt();
  receipt.privacyScopeHmacKeyVersion = null;
  receipt.privacyScopeHmacContextId = null;
  receipt.privacyScopeTokenCanonicalizationVersion = null;
  const binding = receipt.sourceBindings[0]!;
  binding.participationStatus = "unavailable";
  binding.sourceArtifactSetSha256 = null;
  binding.sourceArtifactSchemaVersion = null;
  binding.coverage = { coverageKind: "unavailable", status: "unknown" };
  binding.requiredOperationStatuses = [
    { operation: "repository_scope_collection", status: operationStatus },
  ];
  binding.issueCodes = [...issueCodes];
  return rehash(receipt);
}

function fictionalDayflowAttestation(): SourceCollectionAttestationInternalV0_1 {
  const receipt = frozenModeReceipt(FROZEN_MODE_CASES[6]);
  const binding = receipt.sourceBindings[4]!;
  const coverageEvidence = binding.coverage;
  if (
    coverageEvidence.coverageKind !==
    "dayflow_capture_and_preprocessing"
  ) {
    throw new Error("Expected fictional Dayflow coverage");
  }
  const attestation: SourceCollectionAttestationInternalV0_1 = {
    schemaVersion:
      "blabase-common-suggestion-source-collection-attestation-v0.1",
    source: "dayflow",
    requestedCollectionMode: "capture_privacy_ocr",
    requiredOperations: [
      "capture_window_collection",
      "privacy_ocr_preprocessing",
    ],
    requiredOperationStatuses: [
      { operation: "capture_window_collection", status: "complete" },
      { operation: "privacy_ocr_preprocessing", status: "complete" },
    ],
    privacyScopeHmacKeyVersion: null,
    privacyScopeHmacContextId: null,
    privacyScopeTokenCanonicalizationVersion: null,
    participationStatus: "collected",
    sourceArtifactSetSha256: binding.sourceArtifactSetSha256,
    sourceArtifactSchemaVersion: binding.sourceArtifactSchemaVersion,
    adapterId: binding.adapterId!,
    adapterVersion: binding.adapterVersion!,
    inputContractVersion: binding.inputContractVersion!,
    projectedRecordCount: 0,
    projectedRecordIdsSha256: binding.recordIdsSha256,
    attemptedAt: COLLECTED_AT,
    completedAt: COLLECTED_AT,
    coverageEvidence,
    issueCodes: [],
    sourceCollectionAttestationSha256: hash(0),
  };
  attestation.sourceCollectionAttestationSha256 =
    hashSourceAttestationInternalV0_1(attestation);
  return attestation;
}

describe("Common Suggestion Evidence Lineage Receipt v0.1", () => {
  it("exposes only the frozen structural, intrinsic, and planner runtime APIs", () => {
    expect(Object.keys(publicLineageModule).sort()).toEqual([
      "commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1",
      "inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1",
      "planCommonSuggestionEvidenceLineageSourceVerificationV0_1",
    ]);
    expect(
      "buildAndSealCommonSuggestionEvidenceLineageReceiptV0_1" in
        publicLineageModule,
    ).toBe(false);
    expect(
      "verifyCommonSuggestionEvidenceLineageReceiptV0_1" in
        publicLineageModule,
    ).toBe(false);
    expect(
      "serializeCommonSuggestionEvidenceLineageReceiptV0_1" in
        publicLineageModule,
    ).toBe(false);
  });

  it("accepts the exact five-source structural boundary and deeply freezes it", () => {
    const result =
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        allNotRequestedReceipt(),
      );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sourceCollectionPlan.map((entry) => entry.source)).toEqual(
      SOURCES,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data.sourceBindings)).toBe(true);
    expect(Object.isFrozen(result.data.sourceBindings[0])).toBe(true);
    expect(Object.isFrozen(result.data.sourceBindings[0]!.coverage)).toBe(true);
    expect(Object.isFrozen(result.data.sourceCollectionPlan[0])).toBe(true);
    expect(
      Object.isFrozen(result.data.sourceCollectionPlan[0]!.requiredOperations),
    ).toBe(true);
  });

  it("enforces the frozen private attestation operation-status wire", () => {
    const valid = fictionalDayflowAttestation();
    const parsedValid = parseSourceAttestationStructuralInternalV0_1(valid);
    expect(parsedValid).toMatchObject({ ok: true });
    if (parsedValid.ok) {
      expect(Object.isFrozen(parsedValid.value)).toBe(true);
      expect(Object.isFrozen(parsedValid.value.requiredOperationStatuses)).toBe(
        true,
      );
      expect(
        Object.isFrozen(parsedValid.value.requiredOperationStatuses[0]),
      ).toBe(true);
      expect(Object.isFrozen(parsedValid.value.coverageEvidence)).toBe(true);
      if (
        parsedValid.value.coverageEvidence.coverageKind ===
        "dayflow_capture_and_preprocessing"
      ) {
        expect(
          Object.isFrozen(
            parsedValid.value.coverageEvidence.preprocessingCoverage,
          ),
        ).toBe(true);
      }
    }

    const missing: Record<string, unknown> = { ...fictionalDayflowAttestation() };
    delete missing.requiredOperationStatuses;

    const extra = fictionalDayflowAttestation();
    extra.requiredOperationStatuses = [
      { operation: "capture_window_collection", status: "complete" },
      { operation: "privacy_ocr_preprocessing", status: "complete" },
      { operation: "fictional_extra_operation", status: "complete" },
    ];
    extra.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(extra);

    const wrongOperation = fictionalDayflowAttestation();
    wrongOperation.requiredOperationStatuses = [
      { operation: "fictional_wrong_operation", status: "complete" },
      { operation: "privacy_ocr_preprocessing", status: "complete" },
    ];
    wrongOperation.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(wrongOperation);

    const wrongOrder = fictionalDayflowAttestation();
    wrongOrder.requiredOperationStatuses = [
      { operation: "privacy_ocr_preprocessing", status: "complete" },
      { operation: "capture_window_collection", status: "complete" },
    ];
    wrongOrder.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(wrongOrder);

    const invalidStatus = {
      ...fictionalDayflowAttestation(),
      requiredOperationStatuses: [
        { operation: "capture_window_collection", status: "fictional" },
        { operation: "privacy_ocr_preprocessing", status: "complete" },
      ],
    };

    const aggregateMismatch = fictionalDayflowAttestation();
    aggregateMismatch.requiredOperationStatuses[1]!.status = "partial";
    aggregateMismatch.issueCodes = ["PREPROCESSING_PARTIAL"];
    if (
      aggregateMismatch.coverageEvidence.coverageKind ===
      "dayflow_capture_and_preprocessing"
    ) {
      aggregateMismatch.coverageEvidence.preprocessingCoverage.status =
        "partial";
    }
    aggregateMismatch.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(aggregateMismatch);

    expect(parseSourceAttestationStructuralInternalV0_1(extra)).toEqual({
      ok: false,
      failureCode: "RESOURCE_LIMIT_EXCEEDED",
    });
    for (const rejected of [
      missing,
      wrongOperation,
      wrongOrder,
      invalidStatus,
      aggregateMismatch,
    ]) {
      expect(parseSourceAttestationStructuralInternalV0_1(rejected)).toEqual({
        ok: false,
        failureCode: "SOURCE_ATTESTATION_INVALID",
      });
    }
  });

  it("requires unavailable attestation completion to remain null", () => {
    const unavailable = fictionalDayflowAttestation();
    unavailable.participationStatus = "unavailable";
    unavailable.sourceArtifactSetSha256 = null;
    unavailable.sourceArtifactSchemaVersion = null;
    unavailable.projectedRecordCount = 0;
    unavailable.projectedRecordIdsSha256 = hashRecordIdSetInternalV0_1(
      "dayflow",
      [],
    );
    unavailable.completedAt = null;
    unavailable.coverageEvidence = {
      coverageKind: "unavailable",
      status: "unknown",
    };
    unavailable.requiredOperationStatuses = [
      { operation: "capture_window_collection", status: "unknown" },
      { operation: "privacy_ocr_preprocessing", status: "unknown" },
    ];
    unavailable.issueCodes = ["SOURCE_UNAVAILABLE"];
    unavailable.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(unavailable);
    expect(parseSourceAttestationStructuralInternalV0_1(unavailable)).toMatchObject(
      { ok: true },
    );

    const completedUnavailable: SourceCollectionAttestationInternalV0_1 = {
      ...unavailable,
      completedAt: COLLECTED_AT,
    };
    completedUnavailable.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(completedUnavailable);
    expect(
      parseSourceAttestationStructuralInternalV0_1(completedUnavailable),
    ).toEqual({
      ok: false,
      failureCode: "SOURCE_ATTESTATION_INVALID",
    });

    const reversedCollected = fictionalDayflowAttestation();
    reversedCollected.attemptedAt = AS_OF;
    reversedCollected.completedAt = COLLECTED_AT;
    reversedCollected.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(reversedCollected);
    expect(
      parseSourceAttestationStructuralInternalV0_1(reversedCollected),
    ).toEqual({
      ok: false,
      failureCode: "SOURCE_ATTESTATION_INVALID",
    });
  });

  it("dispatches only the exact v0.1 schema version", () => {
    const receipt = allNotRequestedReceipt() as unknown as Record<
      string,
      unknown
    >;
    receipt.schemaVersion =
      "blabase-common-suggestion-evidence-lineage-receipt-v0.2";
    const result =
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        receipt,
      );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      { code: "custom", message: "INPUT_INVALID", path: [] },
    ]);
  });

  it("rejects wrong source order and mode-operation disagreement", () => {
    const reordered = allNotRequestedReceipt();
    [reordered.sourceCollectionPlan[0], reordered.sourceCollectionPlan[1]] = [
      reordered.sourceCollectionPlan[1]!,
      reordered.sourceCollectionPlan[0]!,
    ];
    rehash(reordered);
    const orderResult =
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        reordered,
      );
    expect(orderResult.success).toBe(false);
    if (!orderResult.success) {
      expect(orderResult.error.issues[0].message).toBe(
        "SOURCE_BINDING_INVALID",
      );
    }

    const wrongOperations = githubRequestedReceipt();
    wrongOperations.sourceCollectionPlan[0]!.requiredOperations = [
      "activity_pagination",
    ];
    rehash(wrongOperations);
    const operationResult =
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        wrongOperations,
      );
    expect(operationResult.success).toBe(false);
    if (!operationResult.success) {
      expect(operationResult.error.issues[0].message).toBe(
        "SOURCE_BINDING_INVALID",
      );
    }
  });

  it("rejects accessors, proxies, shared references, sparse arrays, and deep graphs", () => {
    const accessorReceipt = allNotRequestedReceipt();
    const getter = vi.fn(() => RECEIPT_SCHEMA_VERSION_V0_1);
    Object.defineProperty(accessorReceipt, "schemaVersion", {
      enumerable: true,
      configurable: true,
      get: getter,
    });
    expect(
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        accessorReceipt,
      ).success,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();

    const proxy = new Proxy(allNotRequestedReceipt(), {
      ownKeys() {
        throw new Error("must not execute");
      },
    });
    expect(
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(proxy)
        .success,
    ).toBe(false);

    const shared = allNotRequestedReceipt();
    shared.sourceCollectionPlan[1] = shared.sourceCollectionPlan[0]!;
    expect(
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        shared,
      ).success,
    ).toBe(false);

    const sparse = allNotRequestedReceipt();
    delete sparse.sourceBindings[2];
    expect(
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        sparse,
      ).success,
    ).toBe(false);

    const deep = allNotRequestedReceipt() as unknown as Record<string, unknown>;
    let cursor: Record<string, unknown> = {};
    deep.unrecognized = cursor;
    for (let index = 0; index < 34; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const depthResult =
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(deep);
    expect(depthResult.success).toBe(false);
    if (!depthResult.success) {
      expect(depthResult.error.issues[0].message).toBe(
        "RESOURCE_LIMIT_EXCEEDED",
      );
    }
  });

  it("checks the exact detached domain, zero separator, and JCS preimage", () => {
    const receipt = allNotRequestedReceipt();
    const { commonSuggestionEvidenceLineageReceiptSha256: _hash, ...preimage } =
      receipt;
    const expected = createHash("sha256")
      .update(RECEIPT_HASH_DOMAIN_V0_1, "utf8")
      .update("\0", "utf8")
      .update(jcsCanonicalize(preimage), "utf8")
      .digest("hex");
    expect(receipt.commonSuggestionEvidenceLineageReceiptSha256).toBe(expected);
    expect(jcsCanonicalize({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');

    const inspected =
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(receipt);
    expect(inspected).toMatchObject({
      inspected: true,
      authoritative: false,
      stage: "intrinsic_receipt",
    });
  });

  it("returns only HASH_MISMATCH for a detached-hash mismatch", () => {
    const receipt = allNotRequestedReceipt();
    receipt.commonSuggestionEvidenceLineageReceiptSha256 = hash(63);
    expect(
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(receipt),
    ).toEqual({
      inspected: false,
      authoritative: false,
      stage: "intrinsic_receipt",
      failureCode: "HASH_MISMATCH",
    });
  });

  it("pins deterministic multi-fault precedence independently of discovery order", () => {
    const forward = new Set([
      "HASH_MISMATCH" as const,
      "SOURCE_BINDING_INVALID" as const,
      "RESOURCE_LIMIT_EXCEEDED" as const,
    ]);
    const reverse = new Set([...forward].reverse());
    expect(
      selectLineageFailureCodeInternalV0_1("intrinsic_receipt", forward),
    ).toBe("RESOURCE_LIMIT_EXCEEDED");
    expect(
      selectLineageFailureCodeInternalV0_1("intrinsic_receipt", reverse),
    ).toBe("RESOURCE_LIMIT_EXCEEDED");
  });

  it("derives private scope tokens and HMAC only through an injected frozen handle", () => {
    const preimage = buildPrivateScopeHmacPreimageInternalV0_1({
      contextId: "scope_context_0123456789abcdef0123456789abcdef",
      scope: {
        source: "github",
        scopeKind: "repository_scope",
        identifiers: [
          { host: "EXAMPLE.invalid.", repositoryDatabaseId: "42" },
        ],
      },
    });
    expect(preimage).toMatchObject({
      domain: PRIVATE_SCOPE_HMAC_DOMAIN_V0_1,
      source: "github",
      scopeKind: "repository_scope",
      tokenCanonicalizationVersion:
        SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1,
    });
    expect(preimage.canonicalTokens).toHaveLength(1);
    expect(preimage.canonicalTokens[0]).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(Object.isFrozen(preimage)).toBe(true);
    expect(Object.isFrozen(preimage.canonicalTokens)).toBe(true);

    const key = Buffer.alloc(32, 0x0b);
    const handle = Object.freeze({
      keyVersion: "fictional_key_v0.1",
      computeHmacSha256(bytes: Uint8Array): Uint8Array {
        return new Uint8Array(createHmac("sha256", key).update(bytes).digest());
      },
    });
    const expected = createHmac("sha256", key)
      .update(jcsCanonicalize(preimage), "utf8")
      .digest("hex");
    expect(
      computePrivateScopeHmacSha256InternalV0_1({
        keyVersion: "fictional_key_v0.1",
        handle,
        preimage,
      }),
    ).toBe(expected);
  });

  it("keeps planning deterministic and fails closed when a source verifier is absent", () => {
    const receipt = githubRequestedReceipt();
    const missingBundle =
      planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
        receipt,
        {},
        {},
      );
    expect(missingBundle).toEqual({
      planned: false,
      authoritative: false,
      failedStage: "source_attestation",
      failureCode: "SOURCE_BINDING_INVALID",
    });

    const planned =
      planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
        receipt,
        {},
        { github: { fictionalBundle: true } },
      );
    expect(planned).toEqual({
      planned: false,
      authoritative: false,
      failedStage: "source_attestation",
      failureCode: "SOURCE_VERIFIER_UNAVAILABLE",
      requiredSourceVerifications: [
        {
          source: "github",
          requestedCollectionMode: "repository_scope",
          requiredOperations: ["repository_scope_collection"],
          sourceAttestationSchemaVersion:
            "blabase-common-suggestion-source-collection-attestation-v0.1",
          bundlePresent: true,
          authoritativeVerifierStatus: "unavailable",
        },
      ],
    });
    expect(Object.isFrozen(planned)).toBe(true);
    expect(Object.isFrozen(planned.requiredSourceVerifications)).toBe(true);
    const plannedRequirement = planned.requiredSourceVerifications?.[0];
    expect(plannedRequirement).toBeDefined();
    if (plannedRequirement !== undefined) {
      expect(Object.isFrozen(plannedRequirement)).toBe(true);
      expect(Object.isFrozen(plannedRequirement.requiredOperations)).toBe(true);
    }
  });

  it("rejects bundles for not-requested sources and never promotes an empty plan", () => {
    const receipt = allNotRequestedReceipt();
    expect(
      planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
        receipt,
        {},
        { dayflow: { fictionalBundle: true } },
      ),
    ).toEqual({
      planned: false,
      authoritative: false,
      failedStage: "source_attestation",
      failureCode: "SOURCE_BINDING_INVALID",
    });

    const emptyPlan =
      planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
        receipt,
        {},
        {},
      );
    expect(emptyPlan).toMatchObject({
      planned: true,
      authoritative: false,
      stageStatus: {
        recordSetBinding: "not_authoritatively_executed",
        sourceAttestation: "not_required",
      },
    });
    expect("receipt" in emptyPlan).toBe(false);
  });

  it("does not leak accessor errors or private bundle values", () => {
    const receipt = githubRequestedReceipt();
    const bundles: Record<string, unknown> = {};
    Object.defineProperty(bundles, "github", {
      enumerable: true,
      get() {
        throw new Error("fictional-private-repository-identifier");
      },
    });
    const result =
      planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
        receipt,
        {},
        bundles,
      );
    expect(result).toEqual({
      planned: false,
      authoritative: false,
      failedStage: "source_attestation",
      failureCode: "INPUT_INVALID",
    });
    expect(JSON.stringify(result)).not.toContain("repository");
  });

  it("is invariant to post-import mutation of timestamp and prototype intrinsics", () => {
    const validReceipt = frozenModeReceipt(FROZEN_MODE_CASES[3]);
    const allNotRequested = allNotRequestedReceipt();
    const requestedReceipt = githubRequestedReceipt();
    const invalidReceipt = allNotRequestedReceipt();
    invalidReceipt.asOf = "2026-08-21T12:00:00Z";
    rehash(invalidReceipt);
    const forgedPrivacyReceipt = githubRequestedReceipt();
    forgedPrivacyReceipt.privacyScopeHmacContextId = null;
    rehash(forgedPrivacyReceipt);
    const unavailableStatusReceipt = unavailableGithubReceipt("complete", [
      "SOURCE_UNAVAILABLE",
    ]);
    const unavailableMissingIssueReceipt = unavailableGithubReceipt(
      "unknown",
      [],
    );
    const unavailableIncorrectIssueReceipt = unavailableGithubReceipt(
      "unknown",
      ["COVERAGE_UNKNOWN"],
    );
    const forgedAggregateReceipt = githubRequestedReceipt();
    forgedAggregateReceipt.sourceBindings[0]!.coverage.status = "partial";
    forgedAggregateReceipt.sourceBindings[0]!.issueCodes = ["SCOPE_PARTIAL"];
    rehash(forgedAggregateReceipt);
    const extraKeyReceipt = { ...validReceipt, fictionalExtra: true };
    const wrongUnionReceipt = {
      ...validReceipt,
      sourceBindings: validReceipt.sourceBindings.map((binding, index) =>
        index === 2
          ? { ...binding, coverage: { coverageKind: "fictional_wrong", status: "complete" } }
          : binding,
      ),
    };
    const detachedHashReceipt = {
      ...validReceipt,
      commonSuggestionEvidenceLineageReceiptSha256: hash(63),
    };
    const validAttestation = fictionalDayflowAttestation();
    const malformedAttestation = {
      ...validAttestation,
      fictionalExtra: true,
    };
    const relationshipAttestation: SourceCollectionAttestationInternalV0_1 = {
      ...validAttestation,
      privacyScopeHmacKeyVersion: "fictional_key_v0.1",
    };
    relationshipAttestation.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(relationshipAttestation);
    const detachedHashAttestation: SourceCollectionAttestationInternalV0_1 = {
      ...validAttestation,
      sourceCollectionAttestationSha256: hash(63),
    };
    const hmacPreimage = buildPrivateScopeHmacPreimageInternalV0_1({
      contextId: "scope_context_0123456789abcdef0123456789abcdef",
      scope: {
        source: "codex",
        scopeKind: "project_scope",
        identifiers: [{ lexicalProjectKey: "/", pathFlavor: "posix" }],
      },
    });
    const hmacKey = Buffer.alloc(32, 0x0c);
    const hmacHandle = Object.freeze({
      keyVersion: "fictional_key_v0.1",
      computeHmacSha256(bytes: Uint8Array): Uint8Array {
        return new Uint8Array(
          createHmac("sha256", hmacKey).update(bytes).digest(),
        );
      },
    });
    const targets: Array<readonly [object, PropertyKey, PropertyDescriptor]> = [
      [Number, "isFinite", Object.getOwnPropertyDescriptor(Number, "isFinite")!],
      [Date, "parse", Object.getOwnPropertyDescriptor(Date, "parse")!],
      [
        Date.prototype,
        "toISOString",
        Object.getOwnPropertyDescriptor(Date.prototype, "toISOString")!,
      ],
      [
        RegExp.prototype,
        "test",
        Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!,
      ],
      [
        String.prototype,
        "split",
        Object.getOwnPropertyDescriptor(String.prototype, "split")!,
      ],
      ...[
        "normalize",
        "startsWith",
        "endsWith",
        "includes",
        "slice",
        "toLowerCase",
        "replaceAll",
        "charCodeAt",
      ].map(
        (key) =>
          [
            String.prototype,
            key,
            Object.getOwnPropertyDescriptor(String.prototype, key)!,
          ] as const,
      ),
      [
        Array.prototype,
        "every",
        Object.getOwnPropertyDescriptor(Array.prototype, "every")!,
      ],
      [
        Array.prototype,
        "some",
        Object.getOwnPropertyDescriptor(Array.prototype, "some")!,
      ],
      [
        Array.prototype,
        "map",
        Object.getOwnPropertyDescriptor(Array.prototype, "map")!,
      ],
      [
        Array.prototype,
        "includes",
        Object.getOwnPropertyDescriptor(Array.prototype, "includes")!,
      ],
    ];
    let validResult: unknown;
    let invalidResult: unknown;
    let forgedPrivacyResult: unknown;
    let unavailableStatusResult: unknown;
    let unavailableMissingIssueResult: unknown;
    let unavailableIncorrectIssueResult: unknown;
    let forgedAggregateResult: unknown;
    let validStructuralResult: unknown;
    let allNotRequestedPlanResult: unknown;
    let requestedPlanResult: unknown;
    let extraKeyResult: unknown;
    let wrongUnionResult: unknown;
    let detachedHashResult: unknown;
    let validAttestationResult: unknown;
    let malformedAttestationResult: unknown;
    let relationshipAttestationResult: unknown;
    let detachedHashAttestationResult: unknown;
    let validHmacResult: unknown;
    let invalidContextRejected = false;
    let invalidKeyRejected = false;
    try {
      for (const [target, key] of targets) {
        Object.defineProperty(target, key, {
          configurable: true,
          writable: true,
          value() {
            throw new Error("mutated intrinsic must not execute");
          },
        });
      }
      validResult =
        inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(
          validReceipt,
        );
      validStructuralResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          validReceipt,
        );
      allNotRequestedPlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          allNotRequested,
          {},
          {},
        );
      requestedPlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          requestedReceipt,
          {},
          { github: { fictionalBundle: true } },
        );
      invalidResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          invalidReceipt,
        );
      forgedPrivacyResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          forgedPrivacyReceipt,
        );
      unavailableStatusResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          unavailableStatusReceipt,
        );
      unavailableMissingIssueResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          unavailableMissingIssueReceipt,
        );
      unavailableIncorrectIssueResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          unavailableIncorrectIssueReceipt,
        );
      forgedAggregateResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          forgedAggregateReceipt,
        );
      extraKeyResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          extraKeyReceipt,
        );
      wrongUnionResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          wrongUnionReceipt,
        );
      detachedHashResult =
        inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(
          detachedHashReceipt,
        );
      validAttestationResult =
        parseSourceAttestationStructuralInternalV0_1(validAttestation);
      malformedAttestationResult =
        parseSourceAttestationStructuralInternalV0_1(malformedAttestation);
      relationshipAttestationResult =
        parseSourceAttestationStructuralInternalV0_1(
          relationshipAttestation,
        );
      detachedHashAttestationResult =
        parseSourceAttestationStructuralInternalV0_1(
          detachedHashAttestation,
        );
      try {
        validHmacResult = computePrivateScopeHmacSha256InternalV0_1({
          keyVersion: "fictional_key_v0.1",
          handle: hmacHandle,
          preimage: hmacPreimage,
        });
      } catch (error) {
        validHmacResult = error;
      }
      try {
        buildPrivateScopeHmacPreimageInternalV0_1({
          contextId: "invalid_context",
          scope: {
            source: "codex",
            scopeKind: "project_scope",
            identifiers: [{ lexicalProjectKey: "/", pathFlavor: "posix" }],
          },
        });
      } catch {
        invalidContextRejected = true;
      }
      try {
        computePrivateScopeHmacSha256InternalV0_1({
          keyVersion: "invalid key version",
          handle: hmacHandle,
          preimage: hmacPreimage,
        });
      } catch {
        invalidKeyRejected = true;
      }
    } finally {
      for (const [target, key, descriptor] of [...targets].reverse()) {
        Object.defineProperty(target, key, descriptor);
      }
    }
    expect(validResult).toMatchObject({
      inspected: true,
      authoritative: false,
    });
    expect(validStructuralResult).toMatchObject({ success: true });
    expect(allNotRequestedPlanResult).toMatchObject({
      planned: true,
      authoritative: false,
    });
    expect(requestedPlanResult).toMatchObject({
      planned: false,
      authoritative: false,
      failureCode: "SOURCE_VERIFIER_UNAVAILABLE",
    });
    expect(invalidResult).toMatchObject({
      success: false,
      error: { issues: [{ message: "INPUT_INVALID", path: [] }] },
    });
    for (const forgedResult of [
      forgedPrivacyResult,
      unavailableStatusResult,
      unavailableMissingIssueResult,
      unavailableIncorrectIssueResult,
      forgedAggregateResult,
    ]) {
      expect(forgedResult).toMatchObject({
        success: false,
        error: {
          issues: [{ message: "SOURCE_BINDING_INVALID", path: [] }],
        },
      });
    }
    for (const inputInvalidResult of [extraKeyResult, wrongUnionResult]) {
      expect(inputInvalidResult).toMatchObject({
        success: false,
        error: { issues: [{ message: "INPUT_INVALID", path: [] }] },
      });
    }
    expect(detachedHashResult).toMatchObject({
      inspected: false,
      authoritative: false,
      failureCode: "HASH_MISMATCH",
    });
    expect(validAttestationResult).toMatchObject({ ok: true });
    if (
      typeof validAttestationResult === "object" &&
      validAttestationResult !== null &&
      "ok" in validAttestationResult &&
      validAttestationResult.ok === true &&
      "value" in validAttestationResult
    ) {
      expect(Object.isFrozen(validAttestationResult.value)).toBe(true);
    }
    expect(malformedAttestationResult).toEqual({
      ok: false,
      failureCode: "SOURCE_ATTESTATION_INVALID",
    });
    expect(relationshipAttestationResult).toEqual({
      ok: false,
      failureCode: "SOURCE_ATTESTATION_INVALID",
    });
    expect(detachedHashAttestationResult).toEqual({
      ok: false,
      failureCode: "HASH_MISMATCH",
    });
    expect(validHmacResult).toMatch(/^[0-9a-f]{64}$/u);
    expect(invalidContextRejected).toBe(true);
    expect(invalidKeyRejected).toBe(true);
  });

  it("is invariant across whole-module post-import intrinsic mutation", () => {
    const validReceipt = frozenModeReceipt(FROZEN_MODE_CASES[3]);
    const validAttestation = fictionalDayflowAttestation();
    const allNotRequested = allNotRequestedReceipt();
    const requestedReceipt = githubRequestedReceipt();
    const baselineRecordIdHash = hashRecordIdSetInternalV0_1("github", [
      "fictional-record-b",
      "fictional-record-a",
    ]);
    const precedenceCandidates: Parameters<
      typeof selectLineageFailureCodeInternalV0_1
    >[1] = new Set(["HASH_MISMATCH", "COVERAGE_INVALID", "INPUT_INVALID"]);
    const baselinePreimage = buildPrivateScopeHmacPreimageInternalV0_1({
      contextId: "scope_context_0123456789abcdef0123456789abcdef",
      scope: {
        source: "codex",
        scopeKind: "project_scope",
        identifiers: [{ lexicalProjectKey: "/", pathFlavor: "posix" }],
      },
    });

    const validDigest = new Uint8Array(32);
    const invalidDigest = new Uint8Array(31);
    for (let index = 0; index < validDigest.length; index += 1) {
      validDigest[index] = 0x0c;
    }
    for (let index = 0; index < invalidDigest.length; index += 1) {
      invalidDigest[index] = 0x0d;
    }
    const observedPreimageCapture: { bytes?: Uint8Array } = {};
    const hmacHandle = Object.freeze({
      keyVersion: "fictional_key_v0.1",
      computeHmacSha256(bytes: Uint8Array): Uint8Array {
        observedPreimageCapture.bytes = bytes;
        return validDigest;
      },
    });
    const invalidHmacHandle = Object.freeze({
      keyVersion: "fictional_key_v0.1",
      computeHmacSha256(): Uint8Array {
        return invalidDigest;
      },
    });

    const extraKeyReceipt = { ...validReceipt, fictionalExtra: true };
    const missingKeyReceipt: Record<string, unknown> = { ...validReceipt };
    delete missingKeyReceipt.asOf;
    const wrongPrototypeReceipt = Object.assign(
      Object.create(null) as Record<string, unknown>,
      validReceipt,
    );
    const proxyReceipt = new Proxy(validReceipt, {});
    const accessorReceipt = { ...validReceipt };
    Object.defineProperty(accessorReceipt, "asOf", {
      enumerable: true,
      get() {
        throw new Error("fictional accessor must not execute");
      },
    });
    const sparseBindings = validReceipt.sourceBindings.slice();
    delete sparseBindings[2];
    const sparseReceipt = {
      ...validReceipt,
      sourceBindings: sparseBindings,
    };
    const cyclicInput: Record<string, unknown> = {};
    cyclicInput.self = cyclicInput;
    const sharedChild = { fictional: true };
    const sharedInput = { first: sharedChild, second: sharedChild };
    const projectionInvalidInputs: readonly unknown[] = [
      extraKeyReceipt,
      missingKeyReceipt,
      wrongPrototypeReceipt,
      proxyReceipt,
      accessorReceipt,
      sparseReceipt,
      cyclicInput,
      sharedInput,
      { value: Number.MAX_SAFE_INTEGER + 1 },
      { value: -1 },
      { value: -0 },
      { value: Number.NaN },
    ];
    const projectionInvalidResults: unknown[] = new Array(
      projectionInvalidInputs.length,
    );

    const validBundles = { github: { fictionalBundle: true } };
    const extraBundles = {
      github: { fictionalBundle: true },
      fictional: { fictionalBundle: true },
    };
    const notRequestedBundles = { dayflow: { fictionalBundle: true } };
    const accessorBundles: Record<string, unknown> = {};
    Object.defineProperty(accessorBundles, "github", {
      enumerable: true,
      get() {
        throw new Error("fictional private bundle accessor");
      },
    });
    const proxyBundles = new Proxy(validBundles, {});

    const getOwnPropertyDescriptorIntrinsic =
      Object.getOwnPropertyDescriptor;
    const definePropertyIntrinsic = Object.defineProperty;
    type IntrinsicMutation = Readonly<{
      owner: object;
      key: PropertyKey;
      original: PropertyDescriptor;
      hostile: PropertyDescriptor;
    }>;
    const mutations: IntrinsicMutation[] = [];
    const addDataMutation = (
      owner: object,
      key: PropertyKey,
      optional = false,
    ): void => {
      const descriptor = getOwnPropertyDescriptorIntrinsic(owner, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        (descriptor.configurable !== true && descriptor.writable !== true)
      ) {
        if (optional) return;
        throw new Error("required mutable intrinsic is not patchable");
      }
      mutations[mutations.length] = {
        owner,
        key,
        original: descriptor,
        hostile: {
          ...descriptor,
          value() {
            throw new Error("mutated intrinsic must not execute");
          },
        },
      };
    };
    const addGetterMutation = (
      owner: object,
      key: PropertyKey,
      optional = false,
    ): void => {
      const descriptor = getOwnPropertyDescriptorIntrinsic(owner, key);
      if (
        descriptor === undefined ||
        !("get" in descriptor) ||
        descriptor.configurable !== true
      ) {
        if (optional) return;
        throw new Error("required mutable getter is not patchable");
      }
      mutations[mutations.length] = {
        owner,
        key,
        original: descriptor,
        hostile: {
          ...descriptor,
          get() {
            throw new Error("mutated getter must not execute");
          },
        },
      };
    };

    addDataMutation(Object, "freeze");
    addDataMutation(Object, "isFrozen");
    addDataMutation(Object, "create");
    addDataMutation(Object, "getPrototypeOf");
    addDataMutation(Object, "getOwnPropertyDescriptor");
    addDataMutation(Object, "defineProperty");
    addDataMutation(Object, "is");
    addDataMutation(Object.prototype, "hasOwnProperty");
    addDataMutation(Reflect, "ownKeys");
    addDataMutation(Reflect, "apply");
    addDataMutation(Array, "isArray");
    addDataMutation(Array.prototype, Symbol.iterator);
    addDataMutation(Array.prototype, "push");
    addDataMutation(Array.prototype, "filter");
    addDataMutation(Array.prototype, "map");
    addDataMutation(Array.prototype, "includes");
    addDataMutation(Array.prototype, "slice");
    addDataMutation(Array.prototype, "sort");
    addDataMutation(Array.prototype, "every");
    addDataMutation(Array.prototype, "some");
    addDataMutation(Number, "isSafeInteger");
    addDataMutation(Number, "isFinite");
    addDataMutation(Number.prototype, "toString");
    addDataMutation(String.prototype, "charCodeAt");
    addDataMutation(String.prototype, "includes");
    addDataMutation(String.prototype, "slice");
    addDataMutation(String.prototype, "split");
    addDataMutation(String.prototype, "normalize");
    addDataMutation(String.prototype, "startsWith");
    addDataMutation(String.prototype, "endsWith");
    addDataMutation(String.prototype, "toLowerCase");
    addDataMutation(String.prototype, "replaceAll");
    addDataMutation(String.prototype, "padStart");
    addDataMutation(globalThis, "String");
    addDataMutation(globalThis, "TypeError");
    addDataMutation(globalThis, "WeakSet");
    addDataMutation(WeakSet.prototype, "has");
    addDataMutation(WeakSet.prototype, "add");
    addDataMutation(globalThis, "Set");
    addDataMutation(Set.prototype, "has");
    addDataMutation(globalThis, "TextEncoder");
    addDataMutation(TextEncoder.prototype, "encode");
    addDataMutation(Buffer, "from");
    addDataMutation(Buffer.prototype, "toString");
    addDataMutation(globalThis, "Uint8Array");
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    addDataMutation(typedArrayPrototype, "fill");
    addGetterMutation(typedArrayPrototype, "byteLength");
    addDataMutation(nodeUtilTypes, "isProxy", true);
    addDataMutation(nodeUtilTypes, "isUint8Array", true);

    let validReceiptResult: unknown;
    let validAttestationResult: unknown;
    let allNotRequestedPlanResult: unknown;
    let requestedPlanResult: unknown;
    let extraBundlePlanResult: unknown;
    let notRequestedBundlePlanResult: unknown;
    let accessorBundlePlanResult: unknown;
    let proxyBundlePlanResult: unknown;
    let mutatedPreimage: unknown;
    let validHmacResult: unknown;
    let invalidHmacRejected = false;
    let recordIdHashUnderMutation: unknown;
    let duplicateRecordIdsRejected = false;
    let selectedFailure: unknown;
    try {
      for (let index = 0; index < mutations.length; index += 1) {
        const mutation = mutations[index]!;
        definePropertyIntrinsic(
          mutation.owner,
          mutation.key,
          mutation.hostile,
        );
      }

      validReceiptResult =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          validReceipt,
        );
      validAttestationResult =
        parseSourceAttestationStructuralInternalV0_1(validAttestation);
      allNotRequestedPlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          allNotRequested,
          {},
          {},
        );
      requestedPlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          requestedReceipt,
          {},
          validBundles,
        );
      extraBundlePlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          requestedReceipt,
          {},
          extraBundles,
        );
      notRequestedBundlePlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          allNotRequested,
          {},
          notRequestedBundles,
        );
      accessorBundlePlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          requestedReceipt,
          {},
          accessorBundles,
        );
      proxyBundlePlanResult =
        planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
          requestedReceipt,
          {},
          proxyBundles,
        );
      for (
        let index = 0;
        index < projectionInvalidInputs.length;
        index += 1
      ) {
        projectionInvalidResults[index] =
          commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
            projectionInvalidInputs[index],
          );
      }
      mutatedPreimage = buildPrivateScopeHmacPreimageInternalV0_1({
        contextId: "scope_context_0123456789abcdef0123456789abcdef",
        scope: {
          source: "codex",
          scopeKind: "project_scope",
          identifiers: [{ lexicalProjectKey: "/", pathFlavor: "posix" }],
        },
      });
      validHmacResult = computePrivateScopeHmacSha256InternalV0_1({
        keyVersion: "fictional_key_v0.1",
        handle: hmacHandle,
        preimage: mutatedPreimage as typeof baselinePreimage,
      });
      try {
        computePrivateScopeHmacSha256InternalV0_1({
          keyVersion: "fictional_key_v0.1",
          handle: invalidHmacHandle,
          preimage: mutatedPreimage as typeof baselinePreimage,
        });
      } catch {
        invalidHmacRejected = true;
      }
      recordIdHashUnderMutation = hashRecordIdSetInternalV0_1("github", [
        "fictional-record-b",
        "fictional-record-a",
      ]);
      try {
        hashRecordIdSetInternalV0_1("github", [
          "fictional-duplicate",
          "fictional-duplicate",
        ]);
      } catch {
        duplicateRecordIdsRejected = true;
      }
      selectedFailure = selectLineageFailureCodeInternalV0_1(
        "source_attestation",
        precedenceCandidates,
      );
    } finally {
      for (let index = mutations.length - 1; index >= 0; index -= 1) {
        const mutation = mutations[index]!;
        definePropertyIntrinsic(
          mutation.owner,
          mutation.key,
          mutation.original,
        );
      }
    }

    expect(validReceiptResult).toMatchObject({ success: true });
    if (
      typeof validReceiptResult === "object" &&
      validReceiptResult !== null &&
      "success" in validReceiptResult &&
      validReceiptResult.success === true &&
      "data" in validReceiptResult &&
      typeof validReceiptResult.data === "object" &&
      validReceiptResult.data !== null
    ) {
      expect(Object.isFrozen(validReceiptResult.data)).toBe(true);
      const receiptData =
        validReceiptResult.data as CommonSuggestionEvidenceLineageReceiptV0_1;
      expect(Object.isFrozen(receiptData.sourceBindings)).toBe(true);
      expect(Object.isFrozen(receiptData.sourceBindings[0])).toBe(true);
      expect(Object.isFrozen(receiptData.sourceBindings[0]!.coverage)).toBe(
        true,
      );
    }
    expect(validAttestationResult).toMatchObject({ ok: true });
    if (
      typeof validAttestationResult === "object" &&
      validAttestationResult !== null &&
      "ok" in validAttestationResult &&
      validAttestationResult.ok === true &&
      "value" in validAttestationResult &&
      typeof validAttestationResult.value === "object" &&
      validAttestationResult.value !== null
    ) {
      expect(Object.isFrozen(validAttestationResult.value)).toBe(true);
      const attestationValue =
        validAttestationResult.value as SourceCollectionAttestationInternalV0_1;
      expect(Object.isFrozen(attestationValue.requiredOperationStatuses)).toBe(
        true,
      );
      expect(
        Object.isFrozen(attestationValue.requiredOperationStatuses[0]),
      ).toBe(true);
      expect(Object.isFrozen(attestationValue.coverageEvidence)).toBe(true);
    }
    for (let index = 0; index < projectionInvalidResults.length; index += 1) {
      expect(projectionInvalidResults[index]).toMatchObject({
        success: false,
        error: { issues: [{ message: "INPUT_INVALID", path: [] }] },
      });
    }
    expect(allNotRequestedPlanResult).toMatchObject({
      planned: true,
      authoritative: false,
      stageStatus: { sourceAttestation: "not_required" },
    });
    expect(requestedPlanResult).toMatchObject({
      planned: false,
      authoritative: false,
      failureCode: "SOURCE_VERIFIER_UNAVAILABLE",
    });
    expect(extraBundlePlanResult).toMatchObject({
      failureCode: "SOURCE_BINDING_INVALID",
    });
    expect(notRequestedBundlePlanResult).toMatchObject({
      failureCode: "SOURCE_BINDING_INVALID",
    });
    expect(accessorBundlePlanResult).toMatchObject({
      failureCode: "INPUT_INVALID",
    });
    expect(proxyBundlePlanResult).toMatchObject({
      failureCode: "INPUT_INVALID",
    });
    expect(Object.isFrozen(allNotRequestedPlanResult)).toBe(true);
    expect(mutatedPreimage).toEqual(baselinePreimage);
    expect(Object.isFrozen(mutatedPreimage)).toBe(true);
    expect(Object.isFrozen(baselinePreimage.canonicalTokens)).toBe(true);
    expect(validHmacResult).toBe("0c".repeat(32));
    expect(invalidHmacRejected).toBe(true);
    const observedPreimageBytes = observedPreimageCapture.bytes;
    expect(observedPreimageBytes).toBeDefined();
    if (observedPreimageBytes === undefined) {
      throw new Error("HMAC callback did not receive preimage bytes");
    }
    for (let index = 0; index < observedPreimageBytes.length; index += 1) {
      expect(observedPreimageBytes[index]).toBe(0);
    }
    for (let index = 0; index < validDigest.length; index += 1) {
      expect(validDigest[index]).toBe(0);
    }
    for (let index = 0; index < invalidDigest.length; index += 1) {
      expect(invalidDigest[index]).toBe(0);
    }
    expect(recordIdHashUnderMutation).toBe(baselineRecordIdHash);
    expect(duplicateRecordIdsRejected).toBe(true);
    expect(selectedFailure).toBe("INPUT_INVALID");
  });

  it("accepts all seven frozen modes with exact operation order and fixed source order", () => {
    for (const modeCase of FROZEN_MODE_CASES) {
      const receipt = frozenModeReceipt(modeCase);
      const parsed =
        commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
          receipt,
        );
      expect(parsed.success, `${modeCase.source}.${modeCase.mode}`).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.sourceCollectionPlan.map((entry) => entry.source)).toEqual(
        SOURCES,
      );
      const plan = parsed.data.sourceCollectionPlan.find(
        (entry) => entry.requestStatus === "requested",
      );
      expect(plan?.requestedCollectionMode).toBe(modeCase.mode);
      expect(plan?.requiredOperations).toEqual(modeCase.operations);
    }
  });

  it("accepts Codex root lexical key and rejects every frozen forbidden form", () => {
    const contextId = "scope_context_0123456789abcdef0123456789abcdef";
    expect(() =>
      buildPrivateScopeHmacPreimageInternalV0_1({
        contextId,
        scope: {
          source: "codex",
          scopeKind: "project_scope",
          identifiers: [{ lexicalProjectKey: "/", pathFlavor: "posix" }],
        },
      }),
    ).not.toThrow();
    for (const lexicalProjectKey of [
      "//fictional",
      "/fictional/",
      "/fictional/./task",
      "/fictional/../task",
      "/fictional//task",
      "relative/path",
      "/fictional\0task",
      "/e\u0301",
    ]) {
      expect(() =>
        buildPrivateScopeHmacPreimageInternalV0_1({
          contextId,
          scope: {
            source: "codex",
            scopeKind: "project_scope",
            identifiers: [{ lexicalProjectKey, pathFlavor: "posix" }],
          },
        }),
      ).toThrow();
    }
  });

  it("keeps GitHub and Codex null, empty, gap, and full windows structural only", () => {
    const cases = ["null", "empty", "gap", "full"] as const;
    for (const source of ["github", "codex"] as const) {
      for (const branch of cases) {
        const receipt = frozenModeReceipt(
          source === "github" ? FROZEN_MODE_CASES[1] : FROZEN_MODE_CASES[2],
        );
        const binding = receipt.sourceBindings.find(
          (candidate) => candidate.source === source,
        )!;
        const intervals =
          branch === "null"
            ? null
            : branch === "empty"
              ? []
              : branch === "gap"
                ? [{ start: WINDOW_START, end: WINDOW_MIDDLE }]
                : [{ start: WINDOW_START, end: WINDOW_END }];
        if (binding.coverage.coverageKind === "github_scope") {
          binding.coverage.coveredActivityIntervals = intervals;
          binding.coverage.paginationStatus =
            branch === "null"
              ? "unknown"
              : branch === "full"
                ? "complete"
                : "partial";
        } else if (binding.coverage.coverageKind === "codex_collection") {
          binding.coverage.coveredConversationIntervals = intervals;
          binding.coverage.conversationCollectionStatus =
            branch === "null"
              ? "unknown"
              : branch === "full"
                ? "complete"
                : "partial";
        }
        setCoverageOutcome(
          receipt,
          branch === "null"
            ? "unknown"
            : branch === "full"
              ? "complete"
              : "partial",
          branch === "null"
            ? ["COVERAGE_UNKNOWN"]
            : branch === "full"
              ? []
              : ["WINDOW_GAP"],
        );
        rehash(receipt);
        const inspected =
          inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(receipt);
        expect(inspected).toMatchObject({
          inspected: true,
          authoritative: false,
        });
      }
    }
  });

  it("covers Dayflow known, unknown, 0/0, partial, and hash-chain structures", () => {
    const knownZero = frozenModeReceipt(FROZEN_MODE_CASES[6]);
    expect(
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(knownZero),
    ).toMatchObject({ inspected: true, authoritative: false });

    const partial = frozenModeReceipt(FROZEN_MODE_CASES[6]);
    const partialBinding = partial.sourceBindings[4]!;
    if (
      partialBinding.coverage.coverageKind ===
      "dayflow_capture_and_preprocessing"
    ) {
      partialBinding.coverage.preprocessingCoverage.accounting = {
        accountingKind: "known",
        eligibleCaptureCount: 2,
        processedCaptureCount: 1,
      };
    }
    setCoverageOutcome(partial, "partial", ["PREPROCESSING_PARTIAL"]);
    rehash(partial);
    expect(
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(partial),
    ).toMatchObject({ inspected: true, authoritative: false });

    const unknown = frozenModeReceipt(FROZEN_MODE_CASES[6]);
    const unknownBinding = unknown.sourceBindings[4]!;
    if (
      unknownBinding.coverage.coverageKind ===
      "dayflow_capture_and_preprocessing"
    ) {
      unknownBinding.coverage.preprocessingCoverage.accounting = {
        accountingKind: "unknown",
      };
    }
    setCoverageOutcome(unknown, "unknown", ["COVERAGE_UNKNOWN"]);
    rehash(unknown);
    expect(
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(unknown),
    ).toMatchObject({ inspected: true, authoritative: false });

    const reportedFailure = frozenModeReceipt(FROZEN_MODE_CASES[6]);
    setCoverageOutcome(reportedFailure, "partial", [
      "PREPROCESSING_PARTIAL",
      "UPSTREAM_ERROR_REPORTED",
    ]);
    rehash(reportedFailure);
    expect(
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(
        reportedFailure,
      ),
    ).toMatchObject({ inspected: true, authoritative: false });

    const brokenChain = frozenModeReceipt(FROZEN_MODE_CASES[6]);
    const brokenBinding = brokenChain.sourceBindings[4]!;
    if (
      brokenBinding.coverage.coverageKind ===
      "dayflow_capture_and_preprocessing"
    ) {
      brokenBinding.coverage.preprocessingCoverage.inputCaptureArtifactSetSha256 =
        hash(62);
    }
    rehash(brokenChain);
    expect(
      commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1.safeParse(
        brokenChain,
      ).success,
    ).toBe(false);
  });

  it("keeps Calendar canonical and unknown timezone branches non-authoritative", () => {
    const canonical = frozenModeReceipt(FROZEN_MODE_CASES[3]);
    expect(
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(canonical),
    ).toMatchObject({ inspected: true, authoritative: false });

    const unknown = frozenModeReceipt(FROZEN_MODE_CASES[3]);
    const binding = unknown.sourceBindings[2]!;
    if (binding.coverage.coverageKind === "calendar_window") {
      binding.coverage.timezoneContext = "unknown";
    }
    setCoverageOutcome(unknown, "unknown", ["COVERAGE_UNKNOWN"]);
    rehash(unknown);
    expect(
      inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(unknown),
    ).toMatchObject({ inspected: true, authoritative: false });
  });

  it("excludes LF from receipt and private attestation detached hash preimages", () => {
    const receipt = frozenModeReceipt(FROZEN_MODE_CASES[6]);
    const { commonSuggestionEvidenceLineageReceiptSha256: _receiptHash, ...receiptPreimage } =
      receipt;
    const withoutLf = createHash("sha256")
      .update(RECEIPT_HASH_DOMAIN_V0_1, "utf8")
      .update("\0", "utf8")
      .update(jcsCanonicalize(receiptPreimage), "utf8")
      .digest("hex");
    const withLf = createHash("sha256")
      .update(RECEIPT_HASH_DOMAIN_V0_1, "utf8")
      .update("\0", "utf8")
      .update(`${jcsCanonicalize(receiptPreimage)}\n`, "utf8")
      .digest("hex");
    expect(receipt.commonSuggestionEvidenceLineageReceiptSha256).toBe(withoutLf);
    expect(withLf).not.toBe(withoutLf);

    const binding = receipt.sourceBindings[4]!;
    const coverageEvidence = binding.coverage;
    if (
      coverageEvidence.coverageKind !==
      "dayflow_capture_and_preprocessing"
    ) {
      throw new Error("Expected fictional Dayflow coverage");
    }
    const attestation = {
      schemaVersion:
        "blabase-common-suggestion-source-collection-attestation-v0.1" as const,
      source: "dayflow" as const,
      requestedCollectionMode: "capture_privacy_ocr",
      requiredOperations: [
        "capture_window_collection",
        "privacy_ocr_preprocessing",
      ],
      requiredOperationStatuses: [
        { operation: "capture_window_collection", status: "complete" },
        { operation: "privacy_ocr_preprocessing", status: "complete" },
      ] satisfies SourceCollectionAttestationInternalV0_1["requiredOperationStatuses"],
      privacyScopeHmacKeyVersion: null,
      privacyScopeHmacContextId: null,
      privacyScopeTokenCanonicalizationVersion: null,
      participationStatus: "collected" as const,
      sourceArtifactSetSha256: binding.sourceArtifactSetSha256,
      sourceArtifactSchemaVersion: binding.sourceArtifactSchemaVersion,
      adapterId: binding.adapterId!,
      adapterVersion: binding.adapterVersion!,
      inputContractVersion: binding.inputContractVersion!,
      projectedRecordCount: 0,
      projectedRecordIdsSha256: binding.recordIdsSha256,
      attemptedAt: COLLECTED_AT,
      completedAt: COLLECTED_AT,
      coverageEvidence,
      issueCodes: [],
      sourceCollectionAttestationSha256: hash(0),
    };
    attestation.sourceCollectionAttestationSha256 =
      hashSourceAttestationInternalV0_1(attestation);
    expect(parseSourceAttestationStructuralInternalV0_1(attestation)).toMatchObject({
      ok: true,
    });
  });

  it("does not promote equal scope digests or copied claims without source authority", () => {
    const receipt = githubRequestedReceipt();
    const result =
      planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
        receipt,
        {},
        { github: { fictionalBundle: true } },
      );
    expect(result).toMatchObject({
      planned: false,
      authoritative: false,
      failureCode: "SOURCE_VERIFIER_UNAVAILABLE",
    });

    const contextId = "scope_context_0123456789abcdef0123456789abcdef";
    const root = buildPrivateScopeHmacPreimageInternalV0_1({
      contextId,
      scope: {
        source: "codex",
        scopeKind: "project_scope",
        identifiers: [{ lexicalProjectKey: "/", pathFlavor: "posix" }],
      },
    });
    const child = buildPrivateScopeHmacPreimageInternalV0_1({
      contextId,
      scope: {
        source: "codex",
        scopeKind: "project_scope",
        identifiers: [
          { lexicalProjectKey: "/fictional", pathFlavor: "posix" },
        ],
      },
    });
    expect(root.canonicalTokens).not.toEqual(child.canonicalTokens);
  });

  it("uses frozen same-stage precedence regardless of source discovery order", () => {
    const candidates = [
      "TIMEZONE_PROFILE_INVALID",
      "PRIVACY_SCOPE_KEY_UNAVAILABLE",
      "SOURCE_VERIFIER_UNAVAILABLE",
      "COVERAGE_INVALID",
    ] as const;
    expect(
      selectLineageFailureCodeInternalV0_1(
        "source_attestation",
        new Set(candidates),
      ),
    ).toBe("SOURCE_VERIFIER_UNAVAILABLE");
    expect(
      selectLineageFailureCodeInternalV0_1(
        "source_attestation",
        new Set([...candidates].reverse()),
      ),
    ).toBe("SOURCE_VERIFIER_UNAVAILABLE");
  });
});
