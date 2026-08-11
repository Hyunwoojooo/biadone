import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import {
  WorkContextStoreError,
  confirmStoredRepositoryScopeProposal,
  confirmStoredProjectMapping,
  createStoredProjectIdentity,
  readStoredSourceScopeDiscovery,
  readStoredRepositoryScopeProposals,
  readWorkContextRegistry,
  removeStoredProjectMapping,
  sourceScopeRefSchema
} from "../../../../src/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create_project")
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm_repository_scope_proposal"),
      proposalGroupId: z
        .string()
        .regex(/^repository_scope_group_[a-f0-9]{32}$/),
      projectId: z.string().regex(/^project_[a-f0-9]{32}$/),
      explicitUserConfirmation: z.literal(true)
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm_mapping"),
      projectId: z.string().regex(/^project_[a-f0-9]{32}$/),
      scope: sourceScopeRefSchema,
      explicitUserConfirmation: z.literal(true)
    })
    .strict(),
  z
    .object({
      action: z.literal("remove_mapping"),
      scope: sourceScopeRefSchema,
      explicitUserConfirmation: z.literal(true)
    })
    .strict()
]);

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSafeReadOrigin(request)) {
    return noStoreJson(
      { status: "error", code: "INVALID_ORIGIN" },
      403
    );
  }
  return registryResponse();
}

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSameAttentionOrigin(request)) {
    return noStoreJson(
      { status: "error", code: "INVALID_ORIGIN" },
      403
    );
  }
  let input: z.infer<typeof mutationSchema>;
  try {
    input = mutationSchema.parse(await request.json());
  } catch {
    return noStoreJson(
      { status: "error", code: "INVALID_CONTEXT_MUTATION" },
      400
    );
  }

  const now = new Date().toISOString();
  try {
    if (input.action === "create_project") {
      await createStoredProjectIdentity({ createdAt: now });
    } else if (input.action === "confirm_mapping") {
      await confirmStoredProjectMapping({
        scope: input.scope,
        projectId: input.projectId,
        confirmedAt: now,
        explicitUserConfirmation: true
      });
    } else if (input.action === "confirm_repository_scope_proposal") {
      const registryRead = await readWorkContextRegistry();
      if (registryRead.status !== "available") {
        return noStoreJson(
          { status: "error", code: "STALE_MAPPING_PROPOSAL" },
          409
        );
      }
      const resolution = await readStoredRepositoryScopeProposals({
        asOf: now,
        registry: registryRead.value
      });
      const group =
        resolution.status === "ready"
          ? resolution.groups.find(
              (candidate) =>
                candidate.proposalGroupId === input.proposalGroupId
            )
          : undefined;
      const project = registryRead.value.projects.find(
        (candidate) =>
          candidate.projectId === input.projectId &&
          candidate.archivedAt === null
      );
      if (
        group === undefined ||
        project === undefined ||
        (group.suggestedProjectId !== null &&
          group.suggestedProjectId !== input.projectId)
      ) {
        return noStoreJson(
          { status: "error", code: "STALE_MAPPING_PROPOSAL" },
          409
        );
      }
      await confirmStoredRepositoryScopeProposal({
        githubScope: group.scopes.github,
        codexScope: group.scopes.codex,
        projectId: input.projectId,
        confirmedAt: now,
        expectedRegistrySha256: registryRead.value.registrySha256,
        explicitUserConfirmation: true
      });
    } else {
      await removeStoredProjectMapping({
        scope: input.scope,
        removedAt: now,
        explicitUserConfirmation: true
      });
    }
    return registryResponse();
  } catch (error) {
    if (
      error instanceof WorkContextStoreError &&
      error.code === "STALE_REGISTRY"
    ) {
      return noStoreJson(
        { status: "error", code: "STALE_MAPPING_PROPOSAL" },
        409
      );
    }
    return noStoreJson(
      { status: "error", code: "CONTEXT_MUTATION_FAILED" },
      500
    );
  }
}

async function registryResponse() {
  const registry = await readWorkContextRegistry();
  if (registry.status === "invalid") {
    return noStoreJson(
      { status: "error", code: registry.reason },
      500
    );
  }
  const registryValue =
    registry.status === "available" ? registry.value : null;
  const asOf = new Date().toISOString();
  const [discovery, repositoryScopeProposalResolution] =
    await Promise.all([
      readStoredSourceScopeDiscovery({ registry: registryValue }),
      readStoredRepositoryScopeProposals({
        asOf,
        registry: registryValue
      })
    ]);
  return noStoreJson({
    status: "ready",
    registry: registryValue,
    discovery,
    repositoryScopeProposals:
      repositoryScopeProposalResolution.groups
  });
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
