import { createHmac, randomBytes } from "node:crypto";

import {
  createContinuationSetupActionAuthority
} from "../continuation/actions/authority";
import type {
  ContinuationSetupActionBinding,
  ContinuationSetupActionIssuanceAudit
} from "../continuation/actions/contracts";
import {
  evaluateCurrentAttentionWithLiveInputs,
  type LiveAttentionCapturedInputs
} from "../attention/liveAttention";
import type { AttentionCodeProvenance } from "../attention/codeProvenance";
import { capturePreservingLocalState } from "../attention/preserveCapture";
import { compareRuntimeStrings } from "../crossSource/canonicalHash";
import {
  CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
  CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
  CONTINUATION_RESOLUTION_SCHEMA_VERSION
} from "../crossSource/versions";
import {
  adaptCodexContinuationObservations,
  adaptGitHubContinuationObservations
} from "../continuation/adapters";
import {
  CONTINUATION_CANDIDATE_DERIVATION_CONFIG,
  deriveContinuationCandidates,
  type ContinuationCandidateDerivationResult
} from "../continuation/deriveCandidates";
import {
  createContinuationIdentityInput,
  resolveContinuationIdentity,
  type ContinuationIdentityInput,
  type ContinuationIdentityResult
} from "../continuation/resolveIdentity";
import {
  CONTINUATION_RESOLUTION_CONFIG,
  continuationResolutionEnvelopeSchema,
  resolveContinuation,
  type ContinuationResolvedDecision
} from "../continuation/resolveContinuation";
import {
  createContinuationReadFallback,
  projectContinuationReadDecision,
  type ContinuationReadDecision
} from "../continuation/readApi";
import { composeWorkSuggestionBoard } from "./composeBoard";
import {
  workBoardApiResponseSchema,
  type WorkBoardApiResponse,
  type WorkBoardFallbackReasonCode
} from "./monitoringSchema";
import {
  projectActiveOnlyWorkSuggestionBoardPublic,
  projectWorkSuggestionBoardPublicItemRef,
  projectWorkSuggestionBoardPublic
} from "./publicProjection";
import {
  createWorkSuggestionBoardSourceItemRef,
  type WorkSuggestionBoardPublic,
  type WorkSuggestionBoardResult
} from "./contracts";
import {
  createSemanticContinuationWorkBoardResponse,
  type SemanticContinuationWorkBoardResponse
} from "../semanticContinuation/contracts";
import { readSemanticContinuationIntentStore } from "../semanticContinuation/localStore";
import { buildSemanticContinuationTitlePresentation } from "../semanticContinuation/titleOverlay";
import { readSemanticValidationStore } from "../semanticContinuation/validation/store";

const INSTALLATION_SECRET_PATTERN = /^[a-f0-9]{64}$/u;

export async function evaluateLiveWorkSuggestionBoard(input?: {
  cwd?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkBoardApiResponse> {
  const base = await evaluateLiveWorkSuggestionBoardBase(input);
  return base.response;
}

export async function evaluateLiveContinuationRead(input?: {
  cwd?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<ContinuationReadDecision> {
  const { captured, resolution } =
    await captureLiveWorkSuggestionBoardResolution(input);
  if (resolution.continuation.kind === "resolved") {
    return projectContinuationReadDecision(
      resolution.continuation.decision
    );
  }
  if (resolution.continuation.kind === "unavailable") {
    return createContinuationReadFallback(
      captured.asOf,
      "unavailable"
    );
  }
  if (resolution.continuation.kind === "insufficient") {
    return createContinuationReadFallback(
      captured.asOf,
      "insufficient_evidence"
    );
  }
  throw new TypeError("CONTINUATION_READ_PROJECTION_FAILED");
}

export async function evaluateLiveSemanticWorkSuggestionBoard(input?: {
  cwd?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<SemanticContinuationWorkBoardResponse> {
  const base = await evaluateLiveWorkSuggestionBoardBase(input);
  if (
    base.response.status !== "ready" ||
    base.response.mode !== "full" ||
    base.registrySha256 === null
  ) {
    return createSemanticContinuationWorkBoardResponse(base.response, null);
  }
  const readyResponse = base.response;
  const registrySha256 = base.registrySha256;
  const cwd = input?.cwd ?? process.cwd();
  const installationSecret = base.installationSecret ?? null;
  const semanticPresentation = await capturePreservingLocalState({
    cwd,
    scope: "semantic",
    read: async () => {
      const stored = await readSemanticContinuationIntentStore(
        cwd,
        "preserve"
      );
      const validationStored =
        installationSecret === null
          ? null
          : await readSemanticValidationStore(
              cwd,
              installationSecret,
              "preserve"
            );
      return stored.status === "available"
        ? buildSemanticContinuationTitlePresentation({
            board: readyResponse.board,
            registrySha256,
            store: stored.value,
            validationStore:
              validationStored?.status === "available"
                ? validationStored.value
                : null,
            currentCodeProvenance: base.codeProvenance
          })
        : null;
    }
  }).catch(() => null);
  return createSemanticContinuationWorkBoardResponse(
    base.response,
    semanticPresentation
  );
}

export type LiveWorkSuggestionBoardBase = {
  response: WorkBoardApiResponse;
  registrySha256: string | null;
  codeProvenance: AttentionCodeProvenance;
  /** Private request-scoped authority; never serialized in the API wrapper. */
  installationSecret?: string | null;
};

export async function evaluateLiveWorkSuggestionBoardBase(input?: {
  cwd?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<LiveWorkSuggestionBoardBase> {
  const { captured, resolution } =
    await captureLiveWorkSuggestionBoardResolution(input);
  return {
    response: resolution.response,
    codeProvenance: captured.codeProvenance,
    installationSecret:
      captured.codexConfig?.installationSecret ?? null,
    registrySha256:
      captured.registryStatus === "available" &&
      captured.registry !== null
        ? captured.registry.registrySha256
        : null
  };
}

async function captureLiveWorkSuggestionBoardResolution(input?: {
  cwd?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}) {
  const captured = await evaluateCurrentAttentionWithLiveInputs({
    ...(input?.cwd ? { cwd: input.cwd } : {}),
    ...(input?.now ? { now: input.now } : {}),
    ...(input?.env ? { env: input.env } : {}),
    refreshSources: false,
    readMode: "preserve"
  });
  return {
    captured,
    resolution: composeCapturedBoardResolution(captured)
  };
}

export function composeCapturedBoard(
  captured: LiveAttentionCapturedInputs
): WorkBoardApiResponse {
  return composeCapturedBoardResolution(captured).response;
}

type CapturedContinuationResolution =
  | { kind: "resolved"; decision: ContinuationResolvedDecision }
  | { kind: "unavailable" }
  | { kind: "insufficient" }
  | { kind: "error" };

export type CapturedBoardResolution = {
  response: WorkBoardApiResponse;
  continuation: CapturedContinuationResolution;
  /** Server-private action correlation; never part of a public response. */
  setupActionAuthorities: CapturedSetupActionAuthority[];
};

export type CapturedSetupActionBinding = ContinuationSetupActionBinding;

export type CapturedSetupActionAuthority = {
  capability: "open_setup_surface";
  destination: "project_mappings";
  binding: CapturedSetupActionBinding;
};

export type LiveContinuationSetupActionAuthority = {
  asOf: string;
  installationSecret: string;
  setupActionAuthorities: CapturedSetupActionAuthority[];
};

/**
 * Executes exactly one preserve capture and returns only server-private Setup
 * action authority derived from the same successful public Board projection.
 */
export async function evaluateLiveContinuationSetupActionAuthority(input?: {
  cwd?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<LiveContinuationSetupActionAuthority | null> {
  const { captured, resolution } =
    await captureLiveWorkSuggestionBoardResolution(input);
  const installationSecret =
    captured.codexConfig?.installationSecret ?? null;
  if (
    installationSecret === null ||
    !INSTALLATION_SECRET_PATTERN.test(installationSecret) ||
    resolution.response.status !== "ready" ||
    resolution.response.mode !== "full" ||
    resolution.continuation.kind !== "resolved"
  ) {
    return null;
  }
  return {
    asOf: captured.asOf,
    installationSecret,
    setupActionAuthorities: resolution.setupActionAuthorities
  };
}

export function composeCapturedBoardResolution(
  captured: LiveAttentionCapturedInputs
): CapturedBoardResolution {
  const installationSecret =
    captured.codexConfig?.installationSecret ?? null;
  if (
    installationSecret === null ||
    !INSTALLATION_SECRET_PATTERN.test(installationSecret)
  ) {
    return {
      response: unavailableProjectionKey(),
      continuation: { kind: "unavailable" },
      setupActionAuthorities: []
    };
  }
  const projectionKey = deriveProjectionKey(installationSecret);

  const activeOnly = (
    reasonCode: WorkBoardFallbackReasonCode
  ): WorkBoardApiResponse => {
    try {
      return workBoardApiResponseSchema.parse({
        status: "ready",
        mode: "active_only_fallback",
        reasonCode,
        board: projectActiveOnlyWorkSuggestionBoardPublic(
          captured.evaluated.result,
          projectionKey
        )
      });
    } catch {
      return workBoardApiResponseSchema.parse({
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "Work Board 공개 투영을 검증하지 못했습니다."
      });
    }
  };

  const unavailable = (
    reasonCode: WorkBoardFallbackReasonCode
  ): CapturedBoardResolution => ({
    response: activeOnly(reasonCode),
    continuation: { kind: "unavailable" },
    setupActionAuthorities: []
  });
  const insufficient = (
    reasonCode: WorkBoardFallbackReasonCode
  ): CapturedBoardResolution => ({
    response: activeOnly(reasonCode),
    continuation: { kind: "insufficient" },
    setupActionAuthorities: []
  });
  const failed = (
    reasonCode: WorkBoardFallbackReasonCode
  ): CapturedBoardResolution => ({
    response: activeOnly(reasonCode),
    continuation: { kind: "error" },
    setupActionAuthorities: []
  });

  try {
    if (
      captured.registryStatus !== "available" ||
      captured.registry === null ||
      captured.codeProvenance.codeCommitSha === null ||
      !["clean_commit", "declared_commit"].includes(
        captured.codeProvenance.codeState
      )
    ) {
      return unavailable("CONTINUATION_PREREQUISITES_UNAVAILABLE");
    }

    const asOfMs = Date.parse(captured.asOf);
    if (!Number.isFinite(asOfMs)) {
      return unavailable("CONTINUATION_PREREQUISITES_UNAVAILABLE");
    }
    const adapterBatches = [
      adaptCodexContinuationObservations(
        captured.codex.status === "available"
          ? captured.codex.snapshot
          : null,
        {
          installationSecret,
          asOf: captured.asOf,
          snapshotFreshnessCutoff: new Date(
            asOfMs - 5 * 60_000
          ).toISOString()
        }
      ),
      adaptGitHubContinuationObservations(
        captured.github.status === "available"
          ? captured.github.snapshot
          : null,
        {
          installationSecret,
          asOf: captured.asOf,
          snapshotFreshnessCutoff: new Date(
            asOfMs - 30 * 60_000
          ).toISOString()
        }
      )
    ].sort((left, right) =>
      compareRuntimeStrings(left.source, right.source)
    );
    const identityOptions = {
      installationSecret,
      expectedRegistrySha256: captured.registry.registrySha256
    };
    const identityInput = createContinuationIdentityInput(
      { registry: captured.registry, adapterBatches },
      identityOptions
    );
    const identity = resolveContinuationIdentity(
      identityInput,
      identityOptions
    );
    if (!identity.ok) {
      return insufficient("CONTINUATION_IDENTITY_REJECTED");
    }

    const derivationEnvelope = {
      contract: CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
      schemaVersion:
        CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
      asOf: captured.asOf,
      config: CONTINUATION_CANDIDATE_DERIVATION_CONFIG
    } as const;
    const derivation = deriveContinuationCandidates(
      identity.result,
      derivationEnvelope
    );
    if (!derivation.ok) {
      return insufficient("CONTINUATION_DERIVATION_REJECTED");
    }

    const runEntropy = randomBytes(16).toString("hex");
    const resolutionEnvelope =
      continuationResolutionEnvelopeSchema.parse({
        contract: CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
        schemaVersion: CONTINUATION_RESOLUTION_SCHEMA_VERSION,
        asOf: captured.asOf,
        config: CONTINUATION_RESOLUTION_CONFIG,
        run: {
          runId: `continuation_run_${runEntropy}`,
          analysisId: `analysis_${randomBytes(16).toString("hex")}`,
          startedAt: captured.asOf,
          completedAt: captured.asOf,
          codeCommitSha: captured.codeProvenance.codeCommitSha,
          datasetVersion: null,
          datasetSha256: null
        }
      });
    const trustedOptions = {
      ...identityOptions,
      expectedCodeCommitSha:
        captured.codeProvenance.codeCommitSha,
      expectedDatasetVersion: null,
      expectedDatasetSha256: null
    };
    const resolved = resolveContinuation(
      identityInput,
      identity.result,
      derivationEnvelope,
      derivation.result,
      resolutionEnvelope,
      trustedOptions
    );
    if (!resolved.ok) {
      return insufficient("CONTINUATION_RESOLUTION_REJECTED");
    }

    const composed = composeWorkSuggestionBoard(
      {
        active: captured.evaluated.result,
        continuationIdentityInput: identityInput,
        continuationIdentityResult: identity.result,
        continuationDerivationEnvelope: derivationEnvelope,
        continuationDerivationResult: derivation.result,
        continuationResolutionEnvelope: resolutionEnvelope,
        continuationResolvedDecision: resolved.result
      },
      trustedOptions
    );
    if (!composed.ok) {
      return failed("BOARD_COMPOSITION_REJECTED");
    }
    try {
      const publicBoard = projectWorkSuggestionBoardPublic(
        composed.board,
        projectionKey
      );
      let setupActionAuthorities: CapturedSetupActionAuthority[] = [];
      try {
        setupActionAuthorities = deriveSetupActionAuthorities(
          composed.board,
          publicBoard,
          resolved.result,
          identityInput,
          identity.result,
          derivation.result,
          projectionKey,
          installationSecret,
          captured.codeProvenance
        );
      } catch {
        // Action authority is strictly additive. A private correlation failure
        // must disable Setup actions without changing the existing Board.
      }
      return {
        response: workBoardApiResponseSchema.parse({
          status: "ready",
          mode: "full",
          reasonCode: null,
          board: publicBoard
        }),
        continuation: {
          kind: "resolved",
          decision: resolved.result
        },
        setupActionAuthorities
      };
    } catch {
      return failed("BOARD_PUBLIC_PROJECTION_REJECTED");
    }
  } catch {
    return {
      response: activeOnly("CONTINUATION_PREREQUISITES_UNAVAILABLE"),
      continuation: { kind: "error" },
      setupActionAuthorities: []
    };
  }
}

function deriveSetupActionAuthorities(
  board: WorkSuggestionBoardResult,
  publicBoard: WorkSuggestionBoardPublic,
  resolved: ContinuationResolvedDecision,
  identityInput: ContinuationIdentityInput,
  identityResult: ContinuationIdentityResult,
  derivationResult: ContinuationCandidateDerivationResult,
  projectionKey: string,
  installationSecret: string,
  codeProvenance: AttentionCodeProvenance
): CapturedSetupActionAuthority[] {
  const publicItems = [
    ...(publicBoard.primary === null ? [] : [publicBoard.primary]),
    ...publicBoard.alternatives
  ];
  const candidates = [
    ...(resolved.decision.primary === null
      ? []
      : [resolved.decision.primary]),
    ...resolved.decision.alternatives
  ];
  const internalItems = [
    ...(board.primary === null ? [] : [board.primary]),
    ...board.alternatives
  ];
  if (
    codeProvenance.codeCommitSha !== resolved.decision.run.codeCommitSha ||
    !["clean_commit", "declared_commit"].includes(
      codeProvenance.codeState
    ) ||
    codeProvenance.codeFingerprintSha256 !== null
  ) {
    throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
  }
  const sourceBatches = (["codex", "github"] as const).map((source) => {
    const assessment = resolved.sourceAssessments.find(
      (candidate) => candidate.source === source
    );
    const dependency = resolved.decision.run.dependencies[source];
    if (assessment === undefined) {
      throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
    }
    return {
      source,
      batchSha256: assessment.batchSha256,
      snapshotSha256:
        dependency.state === "available"
          ? dependency.snapshotSha256
          : null
    };
  }) as ContinuationSetupActionIssuanceAudit["sourceBatches"];

  return internalItems.flatMap((item) => {
    if (item.lane !== "setup") return [];
    const candidate = candidates.find(
      (value) =>
        createWorkSuggestionBoardSourceItemRef({
          lane: "setup",
          sourceStableId: value.candidateId
        }) === item.sourceItemRef
    );
    if (
      candidate === undefined ||
      candidate.candidateKind !== "workspace_mapping" ||
      candidate.workContextId !== null ||
      candidate.evidenceBand !== "setup" ||
      candidate.availability !== "setup_required" ||
      candidate.capability !== "open_setup_surface" ||
      candidate.privateActionTarget?.capability !== "open_setup_surface"
    ) {
      throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
    }
    const setupReason = candidate.reasonCodes.find(
      (reason): reason is
        | "IDENTITY_MAPPING_NOT_CONFIRMED"
        | "IDENTITY_BINDING_CONFLICT" =>
        reason === "IDENTITY_MAPPING_NOT_CONFIRMED" ||
        reason === "IDENTITY_BINDING_CONFLICT"
    );
    if (setupReason === undefined) {
      throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
    }
    const derivationCandidate = derivationResult.candidates.find(
      (value) => value.candidateId === candidate.candidateId
    );
    if (derivationCandidate === undefined) {
      throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
    }
    const itemRef = projectWorkSuggestionBoardPublicItemRef(
      item.sourceItemRef,
      projectionKey
    );
    const publicItem = publicItems.find(
      (value) =>
        value.lane === "setup" &&
        value.item.itemRef === itemRef &&
        value.item.kind === "workspace_mapping" &&
        value.item.evidenceBand === "setup" &&
        value.item.capability === "display" &&
        value.item.action === null &&
        value.item.expiresAt === candidate.expiresAt
    );
    if (publicItem === undefined) {
      throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
    }
    return [
      {
        capability: "open_setup_surface" as const,
        destination: "project_mappings" as const,
        binding: {
          authority: createContinuationSetupActionAuthority({
            installationSecret,
            itemRef,
            candidate: derivationCandidate,
            identityInput,
            identityResult,
            derivationResult,
            codeProvenance
          }),
          issuanceAudit: {
            candidateSha256: candidate.candidateSha256,
            privateTargetRef: candidate.privateActionTarget.targetRef,
            generatedAt: resolved.decision.asOf,
            continuationResolvedResultSha256: resolved.resultSha256,
            continuationDecisionResultSha256:
              resolved.decision.resultSha256,
            continuationDecisionSemanticResultSha256:
              resolved.decision.semanticResultSha256,
            continuationResolutionInputSha256:
              resolved.decision.run.inputSha256,
            identityResultSha256: resolved.identityResultSha256,
            derivationResultSha256: resolved.derivationResultSha256,
            scoringResultSha256: resolved.scoringResultSha256,
            registrySha256:
              resolved.decision.run.dependencies.workContextRegistrySha256,
            sourceBatches
          }
        }
      }
    ];
  });
}

function deriveProjectionKey(installationSecret: string): string {
  return createHmac(
    "sha256",
    Buffer.from(installationSecret, "hex")
  )
    .update("work-board-public-projection-key-v0.1")
    .digest("hex");
}

function unavailableProjectionKey(): WorkBoardApiResponse {
  return workBoardApiResponseSchema.parse({
    status: "unavailable",
    code: "WORK_BOARD_PROJECTION_KEY_UNAVAILABLE",
    message: "Work Board 공개 식별 키를 사용할 수 없습니다."
  });
}
