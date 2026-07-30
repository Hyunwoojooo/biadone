import { NextResponse } from "next/server";
import { z } from "zod";

import {
  persistPreparedCodexScopeDiscovery,
  prepareCodexScopeDiscovery,
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
import {
  CODEX_CONVERSATION_CONSENT_CONTRACT,
  CODEX_CONVERSATION_RETENTION_DAYS
} from "../../../../../src/connectors/codex/conversationContract";
import type {
  CodexConnectionState,
  CodexContentMode
} from "../../../../../src/connectors/codex/types";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";
import {
  supersedeRuntimeSourceConnection,
  syncRuntimeSources
} from "../../../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentModeSchema = z.enum([
  "metadata_only",
  "activity_summary",
  "conversation_and_execution"
]);

const requestSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("discover")
    }),
    z.object({
      action: z.literal("refresh")
    }),
    z.object({
      action: z.literal("set_content_mode"),
      contentMode: contentModeSchema,
      conversationConsentAccepted: z.literal(true).optional(),
      conversationConsentContract: z
        .literal(CODEX_CONVERSATION_CONSENT_CONTRACT)
        .optional(),
      conversationRetentionDays: z
        .literal(CODEX_CONVERSATION_RETENTION_DAYS)
        .optional()
    }),
    z.object({
      action: z.literal("connect"),
      scopeIds: z
        .array(z.string().regex(/^[a-f0-9]{24}$/))
        .min(1)
        .max(100),
      contentMode: contentModeSchema.default("metadata_only"),
      conversationConsentAccepted: z.literal(true).optional(),
      conversationConsentContract: z
        .literal(CODEX_CONVERSATION_CONSENT_CONTRACT)
        .optional(),
      conversationRetentionDays: z
        .literal(CODEX_CONVERSATION_RETENTION_DAYS)
        .optional()
    })
  ])
  .superRefine((body, context) => {
    if (
      (body.action === "connect" ||
        body.action === "set_content_mode") &&
      body.contentMode === "conversation_and_execution" &&
      (body.conversationConsentAccepted !== true ||
        body.conversationConsentContract !==
          CODEX_CONVERSATION_CONSENT_CONTRACT ||
        body.conversationRetentionDays !==
          CODEX_CONVERSATION_RETENTION_DAYS)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Codex 대화와 실행 기록 수집에 현재 동의 계약과 7일 보관 확인이 필요합니다."
      });
    }
  });

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
      const prepared = await prepareCodexScopeDiscovery();
      if (
        prepared.previousConfig &&
        selectionRequestChanged(
          prepared.previousConfig,
          prepared.config.selectedScopeIds,
          prepared.config.contentMode
        )
      ) {
        await persistPreparedCodexScopeDiscovery(prepared);
        await supersedeRuntimeSourceConnection("codex");
      } else {
        await persistPreparedCodexScopeDiscovery(prepared);
      }
      return noStoreJson(
        codexScopeSelectionState(prepared.config)
      );
    } catch (error) {
      return noStoreJson(codexErrorState(error, null));
    }
  }

  const [previousConfig, previousSnapshot] = await Promise.all([
    readStoredCodexConfig(),
    readStoredCodexSnapshot()
  ]);
  if (body.action === "refresh") {
    const config = previousConfig;
    if (!config) {
      return noStoreJson({ status: "disconnected" });
    }
    if (config.selectedScopeIds.length === 0) {
      return noStoreJson(codexScopeSelectionState(config));
    }
    try {
      const snapshot = await syncAndReadCodexSnapshot();
      return noStoreJson(connectedCodexState(snapshot, config));
    } catch (error) {
      return noStoreJson(
        codexErrorState(error, previousSnapshot?.fetchedAt ?? null)
      );
    }
  }

  if (body.action === "set_content_mode") {
    const config = previousConfig;
    if (!config) {
      return noStoreJson({ status: "disconnected" });
    }
    if (config.selectedScopeIds.length === 0) {
      return noStoreJson(codexScopeSelectionState(config));
    }
    try {
      const selectionChanged = selectionRequestChanged(
        config,
        config.selectedScopeIds,
        body.contentMode
      );
      const updatedConfig = await selectStoredCodexScopes(
        config.selectedScopeIds,
        process.cwd(),
        body.contentMode,
        new Date(),
        explicitConversationConsent(body)
      );
      if (selectionChanged) {
        await supersedeRuntimeSourceConnection("codex");
      }
      const snapshot = await syncAndReadCodexSnapshot();
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
    if (
      !previousConfig ||
      body.scopeIds.some(
        (scopeId) =>
          !previousConfig.scopes.some(
            (scope) => scope.id === scopeId
          )
      )
    ) {
      throw new Error("INVALID_CODEX_SCOPE_SELECTION");
    }
    const selectionChanged = selectionRequestChanged(
      previousConfig,
      body.scopeIds,
      body.contentMode
    );
    const config = await selectStoredCodexScopes(
      body.scopeIds,
      process.cwd(),
      body.contentMode,
      new Date(),
      explicitConversationConsent(body)
    );
    if (selectionChanged) {
      await supersedeRuntimeSourceConnection("codex");
    }
    const snapshot = await syncAndReadCodexSnapshot();
    return noStoreJson(connectedCodexState(snapshot, config));
  } catch (error) {
    return noStoreJson(
      codexErrorState(error, previousSnapshot?.fetchedAt ?? null)
    );
  }
}

function selectionRequestChanged(
  previous: Awaited<ReturnType<typeof readStoredCodexConfig>>,
  requestedScopeIds: readonly string[],
  requestedContentMode: CodexContentMode
): boolean {
  if (!previous || previous.contentMode !== requestedContentMode) {
    return true;
  }
  const previousScopeIds = [
    ...new Set(previous.selectedScopeIds)
  ].sort();
  const requestedIds = [
    ...new Set(requestedScopeIds)
  ].sort();
  return (
    previousScopeIds.length !== requestedIds.length ||
    previousScopeIds.some(
      (scopeId, index) => scopeId !== requestedIds[index]
    )
  );
}

function explicitConversationConsent(
  body: z.infer<typeof requestSchema>
):
  | {
      accepted: true;
      contract: typeof CODEX_CONVERSATION_CONSENT_CONTRACT;
      retentionDays: typeof CODEX_CONVERSATION_RETENTION_DAYS;
    }
  | undefined {
  if (
    (body.action !== "connect" &&
      body.action !== "set_content_mode") ||
    body.contentMode !== "conversation_and_execution"
  ) {
    return undefined;
  }
  return {
    accepted: true,
    contract: CODEX_CONVERSATION_CONSENT_CONTRACT,
    retentionDays: CODEX_CONVERSATION_RETENTION_DAYS
  };
}

async function syncAndReadCodexSnapshot() {
  const sync = await syncRuntimeSources({ sources: ["codex"] });
  const source = sync.sources.find(
    (candidate) => candidate.source === "codex"
  );
  if (
    source?.status !== "idle" ||
    source.lastErrorCode !== null ||
    source.lastSuccessAt === null
  ) {
    throw new Error(source?.lastErrorCode ?? "CODEX_SYNC_FAILED");
  }
  const snapshot = await readStoredCodexSnapshot();
  if (!snapshot) {
    throw new Error("CODEX_SNAPSHOT_MISSING");
  }
  return snapshot;
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
