import { NextResponse } from "next/server";

import {
  codexSnapshotMatchesConfig,
  codexScopeSelectionState,
  codexUnavailableState,
  connectedCodexState
} from "../../../../../src/connectors/codex/connectionState";
import { isLocalCodexRequest } from "../../../../../src/connectors/codex/config";
import {
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../../../../../src/connectors/codex/localStore";
import type {
  CodexConnectionState,
  StoredCodexConfig
} from "../../../../../src/connectors/codex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalCodexRequest(request)) {
    return noStoreJson(codexUnavailableState());
  }

  const config = await readStoredCodexConfig();
  if (!config) {
    return noStoreJson({ status: "disconnected" });
  }
  if (!hasSelectedScope(config)) {
    return noStoreJson(codexScopeSelectionState(config));
  }

  const storedSnapshot = await readStoredCodexSnapshot();
  const previousSnapshot =
    storedSnapshot && codexSnapshotMatchesConfig(storedSnapshot, config)
      ? storedSnapshot
      : null;
  if (previousSnapshot) {
    return noStoreJson(connectedCodexState(previousSnapshot, config));
  }

  return noStoreJson({
    status: "sync_error",
    message:
      "Codex 메타데이터를 다시 확인해야 합니다. 새로고침을 눌러주세요.",
    lastSyncedAt: storedSnapshot?.fetchedAt ?? null
  });
}

function hasSelectedScope(config: StoredCodexConfig): boolean {
  const availableIds = new Set(config.scopes.map((scope) => scope.id));
  return config.selectedScopeIds.some((scopeId) =>
    availableIds.has(scopeId)
  );
}

function noStoreJson(body: CodexConnectionState) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" }
  });
}
