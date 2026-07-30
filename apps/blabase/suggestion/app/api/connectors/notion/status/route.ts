import { NextResponse } from "next/server";

import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../../../../../src/connectors/notion/config";
import {
  notionSnapshotMatchesTokens,
  readStoredNotionSnapshot,
  readStoredNotionTokens
} from "../../../../../src/connectors/notion/localStore";
import type { NotionConnectionState } from "../../../../../src/connectors/notion/types";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalNotionRequest(request)) {
    return noStoreJson({
      status: "unavailable",
      message: "Notion 연결은 http://localhost:3102에서 확인해주세요."
    });
  }

  loadSharedLocalEnv();
  const configResult = loadNotionConfig();
  if (!configResult.ok) {
    return noStoreJson({ status: "disconnected" });
  }

  const tokens = await readStoredNotionTokens();
  if (!tokens) {
    return noStoreJson({ status: "disconnected" });
  }

  const snapshot = await readStoredNotionSnapshot();
  if (!snapshot || !notionSnapshotMatchesTokens(snapshot, tokens)) {
    return noStoreJson({
      status: "sync_error",
      message:
        "현재 Notion 워크스페이스의 저장본이 아직 없습니다. 동기화를 잠시 기다리거나 다시 시도해주세요.",
      lastSyncedAt: null
    });
  }
  const pageCount = snapshot.resources.filter(
    (resource) => resource.kind === "page"
  ).length;
  const dataSourceCount = snapshot.resources.length - pageCount;
  return noStoreJson({
    status: "connected",
    workspaceName: snapshot.workspaceName,
    lastSyncedAt: snapshot.fetchedAt,
    resourceCount: snapshot.resources.length,
    pageCount,
    dataSourceCount,
    truncated: snapshot.truncated,
    resources: snapshot.resources.slice(0, 3).map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      title: resource.title,
      lastEditedAt: resource.lastEditedAt
    }))
  });
}

function noStoreJson(body: NotionConnectionState) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" }
  });
}
