import { NextResponse } from "next/server";

import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import { LIVE_ATTENTION_FRESHNESS_POLICY } from "../../../src/attention/liveAttention";
import {
  managedCodexArtifactRelationProjectionSchema,
  readWorkArtifactAttributionStore,
  resolveManagedCodexArtifactRelations
} from "../../../src/artifacts";
import {
  claimAuthorityProjectionSchema,
  resolveCurrentClaimAuthority
} from "../../../src/claims";
import {
  readStoredGitHubSnapshot
} from "../../../src/connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../../../src/connectors/github/toWorkSignals";
import {
  lookupProjectId,
  readWorkContextRegistry,
  type WorkContextRegistry
} from "../../../src/context";
import {
  managedCodexPublicProjectionSchema,
  managedCodexSemanticProjectionSchema,
  readManagedCodexObservability
} from "../../../src/managedCodex";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations
} from "../../../src/relations";
import {
  readWorkSessionBindingStore,
  withManagedCodexAuthorityLease
} from "../../../src/resumption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message: "작업 연결 근거는 로컬 Work Cockpit에서 확인해주세요."
      },
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }

  const cwd = process.cwd();

  try {
    const [githubSnapshot, registryRead] = await Promise.all([
      readStoredGitHubSnapshot(cwd),
      readWorkContextRegistry(cwd)
    ]);
    const contextRegistry =
      registryRead.status === "available"
        ? registryRead.value
        : null;
    const projection = await withManagedCodexAuthorityLease(
      cwd,
      () => new Date(),
      async (authority, now) => {
        const asOf = now.toISOString();
        const githubBatch = normalizeGitHubBatch({
          snapshot: githubSnapshot,
          contextRegistry,
          asOf
        });
        const [
          managedObservability,
          bindingStore,
          artifactAttributionStore
        ] = await Promise.all([
          readManagedCodexObservability(
            {
              activeOwnerInstanceId: authority.activeOwnerInstanceId,
              activeOwnerships: authority.activeOwnerships,
              now
            },
            cwd
          ),
          readWorkSessionBindingStore(cwd, asOf),
          readWorkArtifactAttributionStore(cwd, now)
        ]);
        const managedProjection = managedCodexPublicProjectionSchema.parse(
          managedObservability.projection
        );
        const managedSemantics = managedCodexSemanticProjectionSchema.parse(
          managedObservability.semantics
        );
        const workRelations = managedCodexWorkRelationProjectionSchema.parse(
          resolveManagedCodexWorkRelations({
            asOf,
            managedProjection,
            bindingStore,
            githubBatch,
            contextRegistry
          })
        );
        const artifacts =
          managedCodexArtifactRelationProjectionSchema.parse(
            resolveManagedCodexArtifactRelations({
              asOf,
              workRelationProjection: workRelations,
              attributionStore: artifactAttributionStore,
              githubBatch
            })
          );
        const claims = claimAuthorityProjectionSchema.parse(
          resolveCurrentClaimAuthority({
            asOf,
            managedProjection,
            managedSemantics,
            workRelationProjection: workRelations,
            artifactRelationProjection: artifacts,
            githubBatch,
            contextRegistry
          })
        );
        return { workRelations, artifacts, claims };
      }
    );

    return noStoreJson({
      status: "ready",
      ...projection.workRelations,
      artifacts: projection.artifacts,
      claims: projection.claims
    });
  } catch {
    return errorResponse(
      "WORK_RELATIONS_READ_FAILED",
      "작업 연결 근거를 확인하지 못했습니다.",
      500
    );
  }
}

function normalizeGitHubBatch(input: {
  snapshot: Awaited<ReturnType<typeof readStoredGitHubSnapshot>>;
  contextRegistry: WorkContextRegistry | null;
  asOf: string;
}) {
  if (input.snapshot === null) return null;
  const normalized = normalizeGitHubSnapshotToWorkSignals(
    input.snapshot,
    {
      asOf: input.asOf,
      freshnessPolicy: LIVE_ATTENTION_FRESHNESS_POLICY,
      contextRegistrySha256:
        input.contextRegistry?.registrySha256 ?? null,
      resolveProjectId: (sourceScopeId) =>
        resolveGitHubProjectId(input.contextRegistry, sourceScopeId)
    }
  );
  return normalized.status === "normalized"
    ? normalized.batch
    : null;
}

function resolveGitHubProjectId(
  registry: WorkContextRegistry | null,
  sourceScopeId: string
): string | null {
  if (registry === null) return null;
  const match = /^repository:([1-9][0-9]*)$/.exec(sourceScopeId);
  if (!match?.[1]) return null;
  return lookupProjectId(registry, {
    source: "github",
    resourceType: "repository",
    opaqueId: match[1]
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number
) {
  return noStoreJson(
    {
      status: "error",
      code,
      message
    },
    status
  );
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
