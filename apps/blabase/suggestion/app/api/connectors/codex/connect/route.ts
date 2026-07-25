import { NextResponse } from "next/server";
import { z } from "zod";

import {
  discoverAndStoreCodexScopes,
  fetchAndStoreCodexSnapshot,
  selectStoredCodexScopes
} from "../../../../../src/connectors/codex/appServer";
import {
  codexErrorState,
  codexScopeSelectionState,
  connectedCodexState
} from "../../../../../src/connectors/codex/connectionState";
import {
  hasSameOrigin,
  isLocalCodexRequest
} from "../../../../../src/connectors/codex/config";
import {
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../../../../../src/connectors/codex/localStore";
import type { CodexConnectionState } from "../../../../../src/connectors/codex/types";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("discover")
  }),
  z.object({
    action: z.literal("refresh")
  }),
  z.object({
    action: z.literal("set_content_mode"),
    contentMode: z.enum(["metadata_only", "activity_summary"])
  }),
  z.object({
    action: z.literal("connect"),
    scopeIds: z
      .array(z.string().regex(/^[a-f0-9]{24}$/))
      .min(1)
      .max(100),
    contentMode: z
      .enum(["metadata_only", "activity_summary"])
      .default("metadata_only")
  })
]);

export async function POST(request: Request) {
  if (!isLocalCodexRequest(request)) {
    return noStoreError("LOCAL_ONLY", 404);
  }
  if (!hasSameOrigin(request)) {
    return noStoreError("INVALID_ORIGIN", 403);
  }

  const body = await parseRequest(request);
  if (!body) {
    return noStoreError("INVALID_REQUEST", 400);
  }

  loadSharedLocalEnv();
  if (body.action === "discover") {
    try {
      const config = await discoverAndStoreCodexScopes();
      return noStoreJson(codexScopeSelectionState(config));
    } catch (error) {
      return noStoreJson(codexErrorState(error, null));
    }
  }

  const previousSnapshot = await readStoredCodexSnapshot();
  if (body.action === "refresh") {
    const config = await readStoredCodexConfig();
    if (!config) {
      return noStoreJson({ status: "disconnected" });
    }
    if (config.selectedScopeIds.length === 0) {
      return noStoreJson(codexScopeSelectionState(config));
    }
    try {
      const snapshot = await fetchAndStoreCodexSnapshot(config);
      return noStoreJson(connectedCodexState(snapshot, config));
    } catch (error) {
      return noStoreJson(
        codexErrorState(error, previousSnapshot?.fetchedAt ?? null)
      );
    }
  }

  if (body.action === "set_content_mode") {
    const config = await readStoredCodexConfig();
    if (!config) {
      return noStoreJson({ status: "disconnected" });
    }
    if (config.selectedScopeIds.length === 0) {
      return noStoreJson(codexScopeSelectionState(config));
    }
    try {
      const updatedConfig = await selectStoredCodexScopes(
        config.selectedScopeIds,
        process.cwd(),
        body.contentMode
      );
      const snapshot = await fetchAndStoreCodexSnapshot(updatedConfig);
      return noStoreJson(
        connectedCodexState(snapshot, updatedConfig)
      );
    } catch (error) {
      return noStoreJson(
        codexErrorState(error, previousSnapshot?.fetchedAt ?? null)
      );
    }
  }

  try {
    const config = await selectStoredCodexScopes(
      body.scopeIds,
      process.cwd(),
      body.contentMode
    );
    const snapshot = await fetchAndStoreCodexSnapshot(config);
    return noStoreJson(connectedCodexState(snapshot, config));
  } catch (error) {
    return noStoreJson(
      codexErrorState(error, previousSnapshot?.fetchedAt ?? null)
    );
  }
}

async function parseRequest(
  request: Request
): Promise<z.infer<typeof requestSchema> | null> {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function noStoreJson(body: CodexConnectionState) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" }
  });
}

function noStoreError(error: string, status: number) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: { "Cache-Control": "no-store" }
    }
  );
}
