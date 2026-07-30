import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import {
  confirmStoredProjectMapping,
  createStoredProjectIdentity,
  readStoredSourceScopeDiscovery,
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
    } else {
      await removeStoredProjectMapping({
        scope: input.scope,
        removedAt: now,
        explicitUserConfirmation: true
      });
    }
    return registryResponse();
  } catch {
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
  const discovery = await readStoredSourceScopeDiscovery({
    registry: registryValue
  });
  return noStoreJson({
    status: "ready",
    registry: registryValue,
    discovery
  });
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
