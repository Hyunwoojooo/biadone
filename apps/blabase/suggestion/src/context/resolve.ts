import { z } from "zod";

import { runtimeSha256 } from "../crossSource/canonicalHash";
import {
  RESOLVED_WORK_CONTEXT_CONTRACT,
  lookupProjectId,
  resolveWeeklyOutcome,
  sourceScopeFingerprint,
  sourceScopeRefSchema,
  type SourceScopeRef,
  type WeeklyOutcomeStore,
  type WorkContextRegistry
} from "./contracts";
import {
  readWeeklyOutcomeStore,
  readWorkContextRegistry,
  type StoreReadFailureReason
} from "./localStore";

const timestampSchema = z.string().datetime();

export type AttentionFocus = {
  primaryOutcome: string | null;
  capturedAt: string | null;
  validUntil: string | null;
};

export type ResolvedAttentionWorkContext = {
  contract: typeof RESOLVED_WORK_CONTEXT_CONTRACT;
  asOf: string;
  projectResolution:
    | "resolved"
    | "unmapped"
    | "conflict"
    | "registry_missing"
    | "registry_invalid";
  projectId: string | null;
  scopeProjects: Array<{
    scopeFingerprint: string;
    projectId: string | null;
  }>;
  focus: AttentionFocus;
  weeklyOutcomeStatus:
    | "active"
    | "expired"
    | "missing"
    | "invalid";
  unavailableReason:
    | StoreReadFailureReason
    | "REGISTRY_MISSING"
    | "OUTCOME_STORE_MISSING"
    | "OUTCOME_MISSING"
    | "NOT_YET_ACTIVE"
    | null;
  resolutionSha256: string;
};

export function resolveAttentionWorkContext(input: {
  registry: WorkContextRegistry;
  weeklyOutcomes: WeeklyOutcomeStore | null;
  sourceScopes: SourceScopeRef[];
  asOf: string;
}): ResolvedAttentionWorkContext {
  const asOf = timestampSchema.parse(input.asOf);
  const sourceScopes = input.sourceScopes.map((scope) =>
    sourceScopeRefSchema.parse(scope)
  );
  const scopeProjects = sourceScopes
    .map((scope) => ({
      scopeFingerprint: sourceScopeFingerprint(scope),
      projectId: lookupProjectId(input.registry, scope)
    }))
    .sort((left, right) =>
      left.scopeFingerprint.localeCompare(right.scopeFingerprint)
    );
  const mappedProjectIds = [
    ...new Set(
      scopeProjects
        .map((scope) => scope.projectId)
        .filter((projectId): projectId is string => projectId !== null)
    )
  ].sort();
  const projectResolution =
    mappedProjectIds.length === 1
      ? "resolved"
      : mappedProjectIds.length > 1
        ? "conflict"
        : "unmapped";
  const projectId =
    projectResolution === "resolved" ? mappedProjectIds[0] : null;

  if (input.weeklyOutcomes === null) {
    return sealResolution({
      contract: RESOLVED_WORK_CONTEXT_CONTRACT,
      asOf,
      projectResolution,
      projectId,
      scopeProjects,
      focus: emptyFocus(),
      weeklyOutcomeStatus: "missing",
      unavailableReason: "OUTCOME_STORE_MISSING"
    });
  }

  let outcomeResolution = resolveWeeklyOutcome(
    input.weeklyOutcomes,
    projectId === null ? { asOf } : { asOf, projectId }
  );
  if (projectId !== null && outcomeResolution.status !== "active") {
    const globalOutcomeResolution = resolveWeeklyOutcome(
      input.weeklyOutcomes,
      { asOf }
    );
    if (globalOutcomeResolution.status === "active") {
      outcomeResolution = globalOutcomeResolution;
    }
  }
  if (outcomeResolution.status === "active") {
    return sealResolution({
      contract: RESOLVED_WORK_CONTEXT_CONTRACT,
      asOf,
      projectResolution,
      projectId,
      scopeProjects,
      focus: {
        primaryOutcome: outcomeResolution.outcome.primaryOutcome,
        capturedAt: outcomeResolution.outcome.capturedAt,
        validUntil: outcomeResolution.outcome.validUntil
      },
      weeklyOutcomeStatus: "active",
      unavailableReason: null
    });
  }

  return sealResolution({
    contract: RESOLVED_WORK_CONTEXT_CONTRACT,
    asOf,
    projectResolution,
    projectId,
    scopeProjects,
    focus: emptyFocus(),
    weeklyOutcomeStatus: outcomeResolution.status,
    unavailableReason:
      outcomeResolution.status === "expired"
        ? null
        : outcomeResolution.reason
  });
}

export async function resolveStoredAttentionWorkContext(input: {
  sourceScopes: SourceScopeRef[];
  asOf: string;
  cwd?: string;
}): Promise<ResolvedAttentionWorkContext> {
  const cwd = input.cwd ?? process.cwd();
  const [registryRead, outcomeRead] = await Promise.all([
    readWorkContextRegistry(cwd),
    readWeeklyOutcomeStore(cwd)
  ]);

  if (registryRead.status !== "available") {
    const globalOutcomeResolution =
      outcomeRead.status === "available"
        ? resolveWeeklyOutcome(outcomeRead.value, {
            asOf: input.asOf
          })
        : null;
    const activeGlobalOutcome =
      globalOutcomeResolution?.status === "active"
        ? globalOutcomeResolution.outcome
        : null;
    return sealResolution({
      contract: RESOLVED_WORK_CONTEXT_CONTRACT,
      asOf: timestampSchema.parse(input.asOf),
      projectResolution:
        registryRead.status === "missing"
          ? "registry_missing"
          : "registry_invalid",
      projectId: null,
      scopeProjects: input.sourceScopes
        .map((scope) => ({
          scopeFingerprint: sourceScopeFingerprint(scope),
          projectId: null
        }))
        .sort((left, right) =>
          left.scopeFingerprint.localeCompare(right.scopeFingerprint)
        ),
      focus:
        activeGlobalOutcome === null
          ? emptyFocus()
          : {
              primaryOutcome: activeGlobalOutcome.primaryOutcome,
              capturedAt: activeGlobalOutcome.capturedAt,
              validUntil: activeGlobalOutcome.validUntil
            },
      weeklyOutcomeStatus:
        outcomeRead.status === "invalid"
          ? "invalid"
          : globalOutcomeResolution?.status ?? "missing",
      unavailableReason:
        registryRead.status === "missing"
          ? "REGISTRY_MISSING"
          : registryRead.reason
    });
  }

  if (outcomeRead.status === "invalid") {
    const resolved = resolveAttentionWorkContext({
      registry: registryRead.value,
      weeklyOutcomes: null,
      sourceScopes: input.sourceScopes,
      asOf: input.asOf
    });
    return sealResolution({
      ...withoutResolutionHash(resolved),
      weeklyOutcomeStatus: "invalid",
      unavailableReason: outcomeRead.reason
    });
  }

  return resolveAttentionWorkContext({
    registry: registryRead.value,
    weeklyOutcomes:
      outcomeRead.status === "available" ? outcomeRead.value : null,
    sourceScopes: input.sourceScopes,
    asOf: input.asOf
  });
}

function emptyFocus(): AttentionFocus {
  return {
    primaryOutcome: null,
    capturedAt: null,
    validUntil: null
  };
}

function sealResolution(
  input: Omit<ResolvedAttentionWorkContext, "resolutionSha256">
): ResolvedAttentionWorkContext {
  return {
    ...input,
    resolutionSha256: runtimeSha256(input)
  };
}

function withoutResolutionHash(
  resolution: ResolvedAttentionWorkContext
): Omit<ResolvedAttentionWorkContext, "resolutionSha256"> {
  const {
    resolutionSha256: _resolutionSha256,
    ...content
  } = resolution;
  return content;
}
