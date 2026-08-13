import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  activeAttentionResultSchema,
  type ActiveAttentionResult
} from "../attentionDecision";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson
} from "../crossSource/canonicalHash";
import {
  WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
  WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION
} from "../crossSource/versions";
import type { ContinuationCandidate } from "../continuation/contracts";
import { containsCredentialShapedPublicText } from "../publicTextSafety";
import {
  WORK_SUGGESTION_BOARD_EXECUTION_POLICY,
  createWorkSuggestionBoardSourceItemRef,
  workSuggestionBoardPublicSchema,
  workSuggestionBoardResultSchema,
  type WorkSuggestionBoardItem,
  type WorkSuggestionBoardPublic,
  type WorkSuggestionBoardResult
} from "./contracts";

const publicProjectionKeySchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u);

/**
 * Server-private correlation helper for an already-authenticated Board item.
 * The returned value is public-opaque, but this helper grants no action
 * authority and must never be used to infer a private target.
 */
export function projectWorkSuggestionBoardPublicItemRef(
  sourceItemRef: string,
  projectionKeyInput: string
): string {
  const projectionKey = publicProjectionKeySchema.parse(
    projectionKeyInput
  );
  return opaque(projectionKey, "item", sourceItemRef);
}

export function projectWorkSuggestionBoardPublic(
  boardInput: WorkSuggestionBoardResult,
  projectionKeyInput: string
): WorkSuggestionBoardPublic {
  const board = workSuggestionBoardResultSchema.parse(boardInput);
  const projectionKey = publicProjectionKeySchema.parse(
    projectionKeyInput
  );
  const items = [
    ...(board.primary === null ? [] : [board.primary]),
    ...board.alternatives
  ].map((item) => projectItem(board, item, projectionKey));

  return workSuggestionBoardPublicSchema.parse({
    contract: WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
    schemaVersion: WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION,
    generatedAt: board.asOf,
    prominentLane: items[0]?.lane ?? "none",
    primary: items[0] ?? null,
    alternatives: items.slice(1),
    continuationStatus:
      board.input.continuation.decision.status === "offers_available" ||
      board.input.continuation.decision.status === "setup_required"
        ? "available"
        : board.input.continuation.decision.status === "no_recent_context"
          ? "empty"
          : "unavailable",
    executionPolicy: WORK_SUGGESTION_BOARD_EXECUTION_POLICY
  });
}

export function projectActiveOnlyWorkSuggestionBoardPublic(
  activeInput: ActiveAttentionResult,
  projectionKeyInput: string
): WorkSuggestionBoardPublic {
  const active = activeAttentionResultSchema.parse(activeInput);
  const projectionKey = publicProjectionKeySchema.parse(
    projectionKeyInput
  );
  const candidates =
    active.decision.status === "suggested"
      ? [
          ...(active.decision.topSuggestion === null
            ? []
            : [active.decision.topSuggestion]),
          ...active.decision.alternatives
        ]
          .filter(
            (candidate) =>
              !containsCredentialShapedPublicText(candidate.title)
          )
          .slice(0, 3)
      : [];
  const items: WorkSuggestionBoardPublic["alternatives"] = candidates.map(
    (candidate) => ({
      lane: "attention",
      item: {
        itemRef: opaque(
          projectionKey,
          "item",
          candidate.candidateId
        ),
        workContextRef:
          candidate.projectId === null
            ? null
            : opaque(projectionKey, "context", candidate.projectId),
        kind: "active_attention",
        title: candidate.title,
        summary: candidate.title,
        observedAt: candidate.sourceUpdatedAt,
        expiresAt: candidate.dueAt,
        evidenceBand: "verified_attention",
        capability: "display",
        action: null,
        caveatCodes: canonical(active.decision.caveatCodes)
      }
    })
  );

  if (
    items.length === 0 &&
    active.decision.status === "needs_clarification" &&
    active.decision.clarification !== null &&
    !containsCredentialShapedPublicText(
      active.decision.clarification.question
    )
  ) {
    const clarification = active.decision.clarification;
    const title = clarification.question.slice(0, 120);
    items.push({
      lane: "attention",
      item: {
        itemRef: opaque(
          projectionKey,
          "item",
          clarification.clarificationId
        ),
        workContextRef: null,
        kind: "attention_clarification",
        title,
        summary: title,
        observedAt: null,
        expiresAt: null,
        evidenceBand: "verified_attention",
        capability: "display",
        action: null,
        caveatCodes: canonical(active.decision.caveatCodes)
      }
    });
  }

  return workSuggestionBoardPublicSchema.parse({
    contract: WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
    schemaVersion: WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION,
    generatedAt: active.asOf,
    prominentLane: items.length === 0 ? "none" : "attention",
    primary: items[0] ?? null,
    alternatives: items.slice(1),
    continuationStatus: "unavailable",
    executionPolicy: WORK_SUGGESTION_BOARD_EXECUTION_POLICY
  });
}

export function emptyUnavailableWorkSuggestionBoardPublic(
  generatedAt: string
): WorkSuggestionBoardPublic {
  return workSuggestionBoardPublicSchema.parse({
    contract: WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
    schemaVersion: WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION,
    generatedAt,
    prominentLane: "none",
    primary: null,
    alternatives: [],
    continuationStatus: "unavailable",
    executionPolicy: WORK_SUGGESTION_BOARD_EXECUTION_POLICY
  });
}

function projectItem(
  board: WorkSuggestionBoardResult,
  item: WorkSuggestionBoardItem,
  projectionKey: string
): WorkSuggestionBoardPublic["alternatives"][number] {
  if (
    containsCredentialShapedPublicText(item.localDisplayLabel) ||
    containsCredentialShapedPublicText(item.summary)
  ) {
    throw new TypeError("PUBLIC_PROJECTION_REJECTED");
  }
  const common = {
    itemRef: opaque(projectionKey, "item", item.sourceItemRef),
    workContextRef:
      item.workContextId === null
        ? null
        : opaque(projectionKey, "context", item.workContextId),
    title: item.localDisplayLabel,
    summary: item.localDisplayLabel,
    observedAt: item.observedAt,
    expiresAt: item.expiresAt,
    capability: "display" as const,
    action: null
  };
  if (item.lane === "attention") {
    return {
      lane: "attention",
      item: {
        ...common,
        kind:
          board.input.active.decision.status === "needs_clarification"
            ? "attention_clarification"
            : "active_attention",
        evidenceBand: "verified_attention",
        caveatCodes: canonical(
          board.input.active.decision.caveatCodes
        )
      }
    };
  }
  const candidate = findCandidate(board, item);
  if (candidate === null) {
    throw new TypeError("PUBLIC_PROJECTION_REJECTED");
  }
  return {
    lane: item.lane,
    item: {
      ...common,
      observedAt: candidate.observedAt,
      expiresAt: candidate.expiresAt,
      kind: candidate.candidateKind,
      evidenceBand: candidate.evidenceBand,
      caveatCodes: canonical(candidate.caveatCodes)
    }
  };
}

function findCandidate(
  board: WorkSuggestionBoardResult,
  item: WorkSuggestionBoardItem
): ContinuationCandidate | null {
  const decision = board.input.continuation.decision;
  return [
    ...(decision.primary === null ? [] : [decision.primary]),
    ...decision.alternatives
  ].find(
    (candidate) =>
      createWorkSuggestionBoardSourceItemRef({
        lane: item.lane,
        sourceStableId: candidate.candidateId
      }) === item.sourceItemRef
  ) ?? null;
}

function opaque(
  projectionKey: string,
  kind: "item" | "context",
  value: unknown
): string {
  const digest = createHmac(
    "sha256",
    Buffer.from(projectionKey, "hex")
  )
    .update(`work-board-public-${kind}-ref-v0.1`)
    .update("\0")
    .update(runtimeCanonicalJson(value))
    .digest("base64url");
  return `${kind === "item" ? "item_ref" : "context_ref"}_${digest}`;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}
