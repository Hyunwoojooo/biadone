import { createHmac, randomBytes } from "node:crypto";

import {
  evaluateCurrentAttentionWithLiveInputs,
  type LiveAttentionCapturedInputs
} from "../attention/liveAttention";
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
  deriveContinuationCandidates
} from "../continuation/deriveCandidates";
import {
  createContinuationIdentityInput,
  resolveContinuationIdentity
} from "../continuation/resolveIdentity";
import {
  CONTINUATION_RESOLUTION_CONFIG,
  continuationResolutionEnvelopeSchema,
  resolveContinuation
} from "../continuation/resolveContinuation";
import { composeWorkSuggestionBoard } from "./composeBoard";
import {
  workBoardApiResponseSchema,
  type WorkBoardApiResponse,
  type WorkBoardFallbackReasonCode
} from "./monitoringSchema";
import {
  projectActiveOnlyWorkSuggestionBoardPublic,
  projectWorkSuggestionBoardPublic
} from "./publicProjection";

const INSTALLATION_SECRET_PATTERN = /^[a-f0-9]{64}$/u;

export async function evaluateLiveWorkSuggestionBoard(input?: {
  cwd?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkBoardApiResponse> {
  const captured = await evaluateCurrentAttentionWithLiveInputs({
    ...(input?.cwd ? { cwd: input.cwd } : {}),
    ...(input?.now ? { now: input.now } : {}),
    ...(input?.env ? { env: input.env } : {}),
    refreshSources: false
  });
  return workBoardApiResponseSchema.parse(composeCapturedBoard(captured));
}

export function composeCapturedBoard(
  captured: LiveAttentionCapturedInputs
): WorkBoardApiResponse {
  const installationSecret =
    captured.codexConfig?.installationSecret ?? null;
  if (
    installationSecret === null ||
    !INSTALLATION_SECRET_PATTERN.test(installationSecret)
  ) {
    return unavailableProjectionKey();
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

  try {
    if (
      captured.registryStatus !== "available" ||
      captured.registry === null ||
      captured.codeProvenance.codeCommitSha === null ||
      !["clean_commit", "declared_commit"].includes(
        captured.codeProvenance.codeState
      )
    ) {
      return activeOnly("CONTINUATION_PREREQUISITES_UNAVAILABLE");
    }

    const asOfMs = Date.parse(captured.asOf);
    if (!Number.isFinite(asOfMs)) {
      return activeOnly("CONTINUATION_PREREQUISITES_UNAVAILABLE");
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
      return activeOnly("CONTINUATION_IDENTITY_REJECTED");
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
      return activeOnly("CONTINUATION_DERIVATION_REJECTED");
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
      return activeOnly("CONTINUATION_RESOLUTION_REJECTED");
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
      return activeOnly("BOARD_COMPOSITION_REJECTED");
    }
    try {
      return workBoardApiResponseSchema.parse({
        status: "ready",
        mode: "full",
        reasonCode: null,
        board: projectWorkSuggestionBoardPublic(
          composed.board,
          projectionKey
        )
      });
    } catch {
      return activeOnly("BOARD_PUBLIC_PROJECTION_REJECTED");
    }
  } catch {
    return activeOnly("CONTINUATION_PREREQUISITES_UNAVAILABLE");
  }
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
