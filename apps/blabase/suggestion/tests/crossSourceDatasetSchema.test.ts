import { describe, expect, it } from "vitest";

import {
  crossSourceDevDataset,
  crossSourceDevDatasetInput
} from "../eval/synthetic/crossSourceDevDataset";
import {
  buildSyntheticCase,
  completeCoverage,
  excludedAnnotation,
  insufficientCoverage,
  insufficientDecision,
  noActionDecision,
  reviewAnnotation,
  signal,
  source
} from "../eval/synthetic/devCaseBuilder";
import { syntheticCrossSourceIntegrityOptions } from "../eval/synthetic/codexDetectorConfig";
import {
  CANDIDATE_REASON_CODES,
  DECISION_REASON_CODES,
  GATE_REASON_CODES,
  OVERVIEW_REASON_CODES,
  REVIEW_REASON_CODES,
  WHY_NOW_REASON_CODES,
  crossSourceEvaluationDatasetSchema
} from "../src/evaluation/crossSourceDatasetSchema";
import {
  computeCrossSourceDatasetSha256,
  verifyCrossSourceEvaluationDatasetIntegrity
} from "../src/evaluation/crossSourceIntegrity";
import {
  loadCrossSourceEvaluationDataset,
  loadVerifiedCrossSourceEvaluationDataset
} from "../src/evaluation/loadCrossSourceEvaluationDataset";

describe("cross-source evaluation dataset schema", () => {
  it("loads the bundled mutable synthetic Dev Candidate without rewriting it", () => {
    expect(crossSourceDevDataset.datasetVersion).toBe(
      "suggestion-cross-source-dev-v0.1"
    );
    expect(crossSourceDevDataset.lifecycle).toEqual({
      state: "mutable",
      datasetSha256: null,
      immutableRef: null,
      frozenAt: null
    });
    expect(crossSourceDevDataset.dataOrigin).toBe("synthetic");
    expect(crossSourceDevDataset.containsProductionData).toBe(false);
    expect(crossSourceDevDataset.datasetRevision).toBe(2);
    expect(crossSourceDevDataset.inputBoundary).toBe(
      "normalized_work_signals_and_relations"
    );
    expect(loadCrossSourceEvaluationDataset(crossSourceDevDatasetInput)).toEqual(
      crossSourceDevDatasetInput
    );
  });

  it("contains 30 unique cases under the aggressive decision policy", () => {
    expect(crossSourceDevDataset.cases).toHaveLength(30);
    expect(
      new Set(crossSourceDevDataset.cases.map((item) => item.caseId)).size
    ).toBe(30);

    const statusCounts = Object.fromEntries(
      [
        "suggested",
        "needs_clarification",
        "no_action",
        "insufficient_evidence"
      ].map((status) => [
        status,
        crossSourceDevDataset.cases.filter(
          (item) => item.expectedDecision.status === status
        ).length
      ])
    );

    expect(statusCounts).toEqual({
      suggested: 12,
      needs_clarification: 0,
      no_action: 10,
      insufficient_evidence: 8
    });
  });

  it("keeps current Codex v2 cases overview-only and separate from future exception cases", () => {
    const currentV2Cases = crossSourceDevDataset.cases.filter((item) =>
      item.tags.includes("current_codex_v2")
    );
    const futureCodexCases = crossSourceDevDataset.cases.filter((item) =>
      item.tags.includes("future_candidate_capable_codex")
    );

    expect(currentV2Cases).toHaveLength(3);
    expect(futureCodexCases).toHaveLength(14);
    expect(
      currentV2Cases.every(
        (item) =>
          item.expectedDecision.status === "insufficient_evidence" &&
          item.sourceSnapshotWindows.every(
            (window) => window.attentionCapability === "overview_only"
          )
      )
    ).toBe(true);
  });

  it("registers exactly the 68 reason codes defined by Attention Definition v0.2", () => {
    const codes = [
      ...OVERVIEW_REASON_CODES,
      ...CANDIDATE_REASON_CODES,
      ...WHY_NOW_REASON_CODES,
      ...GATE_REASON_CODES,
      ...REVIEW_REASON_CODES,
      ...DECISION_REASON_CODES
    ];

    expect(codes).toHaveLength(68);
    expect(new Set(codes).size).toBe(68);
  });

  it("verifies every snapshot and the materialized detector config", () => {
    const snapshots = crossSourceDevDataset.cases.flatMap((item) =>
      item.sourceSnapshotWindows.flatMap(
        (window) => window.orderedSnapshotRefs
      )
    );

    expect(snapshots.length).toBeGreaterThan(30);
    expect(
      snapshots.every((snapshot) =>
        /^[a-f0-9]{64}$/.test(snapshot.snapshotSha256)
      )
    ).toBe(true);
    expect(
      verifyCrossSourceEvaluationDatasetIntegrity(
        crossSourceDevDataset,
        syntheticCrossSourceIntegrityOptions
      )
    ).toEqual({
      ok: true,
      issues: []
    });
  });

  it("changes a snapshot hash when its materialized signal content changes", () => {
    const buildHash = (marker: string) =>
      buildSyntheticCase({
        caseId: "AD-DEV-HASH-001",
        title: "Synthetic snapshot hash contract",
        summary: "The same snapshot envelope with changed signal facts.",
        tags: ["hash_contract"],
        sources: [source("github", "candidate_capable")],
        signals: [
          signal(
            "sig-hash",
            "github",
            "pr-hash",
            "activity",
            {
              state: "open",
              marker
            }
          )
        ],
        annotations: [
          excludedAnnotation({
            itemId: "item-hash",
            subjectIds: ["pr-hash"],
            overview: ["OVERVIEW_SOURCE_CONTEXT_ONLY"],
            gateReasons: ["GATE_NO_USER_INTERVENTION"]
          })
        ],
        expectedCoverage: completeCoverage(),
        expectedDecision: noActionDecision(["item-hash"]),
        hardFailureRisks: ["false_candidate"]
      }).sourceSnapshotWindows[0].orderedSnapshotRefs[0].snapshotSha256;

    expect(buildHash("first")).not.toBe(buildHash("second"));
    expect(buildHash("first")).toBe(buildHash("first"));
  });

  it("detects a stale snapshot hash after materialized signal tampering", () => {
    const tampered = structuredClone(crossSourceDevDataset);
    tampered.cases[0].workSignals[0].facts = {
      ...tampered.cases[0].workSignals[0].facts,
      injectedAfterHash: true
    };

    const result = verifyCrossSourceEvaluationDatasetIntegrity(
      tampered,
      syntheticCrossSourceIntegrityOptions
    );

    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.kind === "snapshot_hash_mismatch")
    ).toBe(true);
    expect(() =>
      loadVerifiedCrossSourceEvaluationDataset(
        tampered,
        syntheticCrossSourceIntegrityOptions
      )
    ).toThrow(/integrity check failed/);
  });

  it("detects a detector config artifact that does not match its reference", () => {
    const configReference = crossSourceDevDataset.cases.find(
      (item) => item.codexDetectorConfig !== null
    )?.codexDetectorConfig;
    expect(configReference).not.toBeNull();
    expect(configReference).toBeDefined();
    if (!configReference) {
      return;
    }

    const result = verifyCrossSourceEvaluationDatasetIntegrity(
      crossSourceDevDataset,
      {
        configArtifacts: {
          [configReference.immutableRef]: {
            version: configReference.version,
            tamperedAfterHash: true
          }
        }
      }
    );

    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.kind === "detector_config_hash_mismatch"
      )
    ).toBe(true);
  });

  it("verifies the canonical digest of a frozen dataset", () => {
    const provisional = crossSourceEvaluationDatasetSchema.parse({
      ...structuredClone(crossSourceDevDataset),
      datasetVersion: "suggestion-cross-source-gold-v0.1",
      datasetClass: "golden",
      lifecycle: {
        state: "frozen",
        datasetSha256: "0".repeat(64),
        immutableRef: "private://evaluation/gold-v0.1.json",
        frozenAt: "2026-07-26T13:00:00.000Z"
      },
      cases: crossSourceDevDataset.cases.map((item) => ({
        ...item,
        review: {
          status: "frozen",
          authorId: item.review.authorId,
          reviewerIds: ["reviewer-one", "reviewer-two"],
          adjudicationRef: `private://evaluation/${item.caseId}`,
          notes: "Synthetic integrity fixture."
        }
      }))
    });
    const datasetSha256 = computeCrossSourceDatasetSha256(provisional);
    const frozen = crossSourceEvaluationDatasetSchema.parse({
      ...provisional,
      lifecycle: {
        ...provisional.lifecycle,
        datasetSha256
      }
    });

    expect(
      verifyCrossSourceEvaluationDatasetIntegrity(
        frozen,
        syntheticCrossSourceIntegrityOptions
      ).ok
    ).toBe(true);
    expect(frozen.lifecycle.state).toBe("frozen");
    if (frozen.lifecycle.state !== "frozen") {
      return;
    }

    const mismatched = {
      ...frozen,
      lifecycle: {
        ...frozen.lifecycle,
        datasetSha256: "f".repeat(64)
      }
    };
    expect(
      verifyCrossSourceEvaluationDatasetIntegrity(
        mismatched,
        syntheticCrossSourceIntegrityOptions
      ).issues.some((issue) => issue.kind === "dataset_hash_mismatch")
    ).toBe(true);
  });

  it("rejects duplicate case IDs", () => {
    const firstCase = crossSourceDevDatasetInput.cases[0];
    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [...crossSourceDevDatasetInput.cases, firstCase]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects unknown or cross-source evidence snapshot references", () => {
    const firstCase = crossSourceDevDatasetInput.cases[0];
    const firstSignal = firstCase.workSignals[0];
    const invalidCase = {
      ...firstCase,
      workSignals: [
        {
          ...firstSignal,
          evidenceRefs: ["AD-DEV-CV2-001/github/snapshot-1"]
        }
      ]
    };
    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [invalidCase]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects reason codes placed in the wrong semantic bucket", () => {
    const firstCase = crossSourceDevDatasetInput.cases[0];
    const firstAnnotation = firstCase.annotations[0];
    const invalidCase = {
      ...firstCase,
      annotations: [
        {
          ...firstAnnotation,
          reasonCodes: {
            ...firstAnnotation.reasonCodes,
            overview: ["GATE_CODEX_EXCEPTION_UNVERIFIED"]
          }
        }
      ]
    };
    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [invalidCase]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects no-action labels without complete candidate-capable negative coverage", () => {
    const healthyCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-CX-001"
    );
    expect(healthyCase).toBeDefined();
    if (!healthyCase) {
      return;
    }

    const invalidCase = {
      ...healthyCase,
      sourceSnapshotWindows: healthyCase.sourceSnapshotWindows.map(
        (window) => ({
          ...window,
          attentionCapability: "overview_only",
          candidateSetComplete: false
        })
      )
    };
    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [invalidCase]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects a limited-source suggestion that does not prove candidate independence", () => {
    const partialCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-DS-003"
    );
    expect(partialCase).toBeDefined();
    if (!partialCase) {
      return;
    }

    const invalidCase = {
      ...partialCase,
      expectedCoverage: {
        ...partialCase.expectedCoverage,
        positiveCandidateIndependentOfUnknowns: false
      }
    };
    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [invalidCase]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects complete coverage labels that hide a failed source", () => {
    const partialCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-DS-003"
    );
    expect(partialCase).toBeDefined();
    if (!partialCase) {
      return;
    }

    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...partialCase,
          expectedCoverage: {
            disposition: "complete",
            negativeCandidateCoverageComplete: true,
            limitedSources: [],
            materialUncertaintySources: [],
            uncertaintyBasis: [],
            positiveCandidateIndependentOfUnknowns: false
          }
        }
      ]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("allows scoped no-action when an unevaluated source is non-material", () => {
    const scopedCase = crossSourceDevDataset.cases.find(
      (item) => item.caseId === "AD-DEV-GH-003"
    );

    expect(scopedCase?.expectedDecision.status).toBe("no_action");
    expect(scopedCase?.expectedCoverage).toMatchObject({
      disposition: "limited_but_sufficient",
      negativeCandidateCoverageComplete: true,
      limitedSources: ["notion"],
      materialUncertaintySources: []
    });
    expect(
      scopedCase?.sourceSnapshotWindows.find(
        (window) => window.source === "notion"
      )?.materialToDecision
    ).toBe(false);
  });

  it("represents complete-source critical conflicts as insufficient evidence", () => {
    const conflictCase = buildSyntheticCase({
      caseId: "AD-DEV-CONFLICT-001",
      title: "Complete sources disagree about owner",
      summary: "Both source snapshots are complete, but owner claims conflict.",
      tags: ["critical_conflict", "owner_conflict"],
      sources: [
        source("github", "candidate_capable"),
        source("notion", "candidate_capable")
      ],
      signals: [
        signal(
          "sig-conflict-github-owner",
          "github",
          "task-conflict",
          "ownership",
          { owner: "user" }
        ),
        signal(
          "sig-conflict-notion-owner",
          "notion",
          "task-conflict",
          "ownership",
          { owner: "other" }
        )
      ],
      annotations: [
        reviewAnnotation({
          itemId: "item-conflict",
          subjectIds: ["task-conflict"],
          reviewReasons: ["REVIEW_OWNER_CONFLICT"]
        })
      ],
      expectedCoverage: insufficientCoverage(
        ["github", "notion"],
        "critical_conflict"
      ),
      expectedDecision: insufficientDecision(["item-conflict"]),
      hardFailureRisks: ["wrong_owner"]
    });

    expect(
      crossSourceEvaluationDatasetSchema.safeParse({
        ...crossSourceDevDatasetInput,
        cases: [conflictCase]
      }).success
    ).toBe(true);

    const ungroundedConflict = {
      ...conflictCase,
      annotations: conflictCase.annotations.map((annotation) => ({
        ...annotation,
        reasonCodes: {
          ...annotation.reasonCodes,
          review: ["REVIEW_SOURCE_STALE"]
        }
      }))
    };
    expect(
      crossSourceEvaluationDatasetSchema.safeParse({
        ...crossSourceDevDatasetInput,
        cases: [ungroundedConflict]
      }).success
    ).toBe(false);

    const unrelatedConflictSubject = {
      ...conflictCase,
      workSignals: [
        ...conflictCase.workSignals,
        {
          ...conflictCase.workSignals[0],
          signalId: "sig-unrelated-conflict",
          nativeId: "unrelated-conflict-native",
          subjectId: "unrelated-conflict-subject"
        }
      ],
      annotations: conflictCase.annotations.map((annotation) => ({
        ...annotation,
        sourceSubjectIds: ["unrelated-conflict-subject"]
      }))
    };
    expect(
      crossSourceEvaluationDatasetSchema.safeParse({
        ...crossSourceDevDatasetInput,
        cases: [unrelatedConflictSubject]
      }).success
    ).toBe(false);
  });

  it("rejects threshold escalation without ordered stable request history", () => {
    const requestCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-CX-014"
    );
    expect(requestCase).toBeDefined();
    if (!requestCase) {
      return;
    }

    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...requestCase,
          workSignals: requestCase.workSignals.filter(
            (signalItem) =>
              signalItem.signalId !== "sig-cx14-request-initial"
          )
        }
      ]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );

    const latestSnapshotId = requestCase.sourceSnapshotWindows[0]
      .orderedSnapshotRefs.at(-1)?.snapshotId;
    expect(latestSnapshotId).toBeDefined();
    if (!latestSnapshotId) {
      return;
    }
    const sameSnapshotHistory = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...requestCase,
          workSignals: requestCase.workSignals.map((signalItem) =>
            signalItem.signalId === "sig-cx14-request-initial"
              ? {
                  ...signalItem,
                  evidenceRefs: [latestSnapshotId]
                }
              : signalItem
          )
        }
      ]
    };
    expect(
      crossSourceEvaluationDatasetSchema.safeParse(sameSnapshotHistory).success
    ).toBe(false);

    const executionOnlyRequestCandidate = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...requestCase,
          annotations: requestCase.annotations.map((annotation) => ({
            ...annotation,
            sourceSubjectIds: annotation.sourceSubjectIds.filter(
              (subjectId) => subjectId !== "request-cx14"
            )
          }))
        }
      ]
    };
    expect(
      crossSourceEvaluationDatasetSchema.safeParse(
        executionOnlyRequestCandidate
      ).success
    ).toBe(false);
  });

  it("rejects invalid execution/request subject types and terminal request visibility", () => {
    const currentCodexCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-CV2-001"
    );
    const resolvedRequestCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-CX-013"
    );
    expect(currentCodexCase).toBeDefined();
    expect(resolvedRequestCase).toBeDefined();
    if (!currentCodexCase || !resolvedRequestCase) {
      return;
    }

    const wrongExecutionType = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...currentCodexCase,
          workSignals: currentCodexCase.workSignals.map((signalItem) => ({
            ...signalItem,
            subjectType: "request"
          }))
        }
      ]
    };
    const staleTerminalOverview = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...resolvedRequestCase,
          annotations: resolvedRequestCase.annotations.map((annotation) =>
            annotation.itemId === "item-cx13-resolved-request"
              ? {
                  ...annotation,
                  disposition: {
                    ...annotation.disposition,
                    overview: "include"
                  },
                  acceptableOverviewStates: ["waiting"],
                  reasonCodes: {
                    ...annotation.reasonCodes,
                    overview: ["OVERVIEW_CODEX_REQUEST_STATUS_ONLY"]
                  }
                }
              : annotation
          )
        }
      ]
    };

    expect(
      crossSourceEvaluationDatasetSchema.safeParse(wrongExecutionType).success
    ).toBe(false);
    expect(
      crossSourceEvaluationDatasetSchema.safeParse(staleTerminalOverview)
        .success
    ).toBe(false);
  });

  it("rejects a first step backed only by an unrelated subject", () => {
    const githubCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-GH-001"
    );
    expect(githubCase).toBeDefined();
    if (!githubCase) {
      return;
    }
    const evidenceRef =
      githubCase.sourceSnapshotWindows[0].orderedSnapshotRefs[0].snapshotId;
    const unrelatedSignal = {
      ...githubCase.workSignals[0],
      signalId: "sig-unrelated-first-step",
      nativeId: "unrelated-native",
      subjectId: "unrelated-subject",
      evidenceRefs: [evidenceRef]
    };
    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...githubCase,
          workSignals: [...githubCase.workSignals, unrelatedSignal],
          annotations: githubCase.annotations.map((annotation) => ({
            ...annotation,
            firstStep: {
              ...annotation.firstStep,
              evidenceSignalIds: [unrelatedSignal.signalId]
            }
          }))
        }
      ]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects dataset class/version and decision reason mismatches", () => {
    const versionMismatch = {
      ...crossSourceDevDatasetInput,
      datasetVersion: "suggestion-cross-source-gold-v0.1"
    };
    const firstCase = crossSourceDevDatasetInput.cases[0];
    const reasonMismatch = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...firstCase,
          expectedDecision: {
            ...firstCase.expectedDecision,
            reasonCodes: ["DECISION_TOP_ITEM_SELECTED"]
          }
        }
      ]
    };

    expect(
      crossSourceEvaluationDatasetSchema.safeParse(versionMismatch).success
    ).toBe(false);
    expect(
      crossSourceEvaluationDatasetSchema.safeParse(reasonMismatch).success
    ).toBe(false);
  });

  it("rejects eligible first steps without a source-native destination", () => {
    const githubCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-GH-001"
    );
    expect(githubCase).toBeDefined();
    if (!githubCase) {
      return;
    }

    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...githubCase,
          workSignals: githubCase.workSignals.map((item) => ({
            ...item,
            destinationRef: null
          }))
        }
      ]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects detector-derived Codex signals without immutable detector config", () => {
    const progressCase = crossSourceDevDatasetInput.cases.find(
      (item) => item.caseId === "AD-DEV-CX-001"
    );
    expect(progressCase).toBeDefined();
    if (!progressCase) {
      return;
    }

    const invalid = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...progressCase,
          codexDetectorConfig: null
        }
      ]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects frozen lifecycle claims while cases are still draft", () => {
    const invalid = {
      ...crossSourceDevDatasetInput,
      datasetVersion: "suggestion-cross-source-gold-v0.1",
      datasetClass: "golden",
      lifecycle: {
        state: "frozen",
        datasetSha256: "a".repeat(64),
        immutableRef: "private://evaluation/gold-v0.1.json",
        frozenAt: "2026-07-26T04:00:00.000Z"
      }
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(invalid).success).toBe(
      false
    );
  });

  it("rejects evidence or review claims that occur after decisionAt", () => {
    const firstCase = crossSourceDevDatasetInput.cases[0];
    const invalidTime = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...firstCase,
          workSignals: firstCase.workSignals.map((item) => ({
            ...item,
            sourceUpdatedAt: "2026-07-26T04:00:00.000Z"
          }))
        }
      ]
    };
    const reviewedByAuthor = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...firstCase,
          review: {
            ...firstCase.review,
            status: "reviewed",
            reviewerIds: [firstCase.review.authorId]
          }
        }
      ]
    };

    expect(
      crossSourceEvaluationDatasetSchema.safeParse(invalidTime).success
    ).toBe(false);
    expect(
      crossSourceEvaluationDatasetSchema.safeParse(reviewedByAuthor).success
    ).toBe(false);
  });

  it("compares ISO instants correctly across fractional-second formats", () => {
    const firstCase = crossSourceDevDatasetInput.cases[0];
    const valid = {
      ...crossSourceDevDatasetInput,
      cases: [
        {
          ...firstCase,
          focus: {
            primaryOutcome: "Fractional precision boundary",
            capturedAt: "2026-07-26T03:00:00Z",
            validUntil: "2026-07-26T03:00:00.001Z",
            activeProjectIds: []
          }
        }
      ]
    };

    expect(crossSourceEvaluationDatasetSchema.safeParse(valid).success).toBe(
      true
    );
  });

  it("contains no obvious production secrets or raw private paths", () => {
    const serialized = JSON.stringify(crossSourceDevDataset);

    for (const forbiddenFragment of [
      "/Users/",
      "/Volumes/",
      "@example.com",
      "\"containsProductionData\":true"
    ]) {
      expect(serialized).not.toContain(forbiddenFragment);
    }
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/);
    expect(serialized).not.toMatch(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    );
    expect(serialized).not.toMatch(/\b(?:https?|file):\/\//i);
  });
});
