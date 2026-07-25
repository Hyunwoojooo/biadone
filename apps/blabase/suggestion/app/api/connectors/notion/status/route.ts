import { NextResponse } from "next/server";

import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../../../../../src/connectors/notion/config";
import {
  readStoredNotionSnapshot,
  readStoredNotionTokens
} from "../../../../../src/connectors/notion/localStore";
import {
  fetchAndStoreNotionSnapshot,
  NotionApiError
} from "../../../../../src/connectors/notion/notionApi";
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

  try {
    const snapshot = await fetchAndStoreNotionSnapshot(configResult.config);
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
  } catch (error) {
    if (
      error instanceof NotionApiError &&
      error.code === "REAUTHORIZATION_REQUIRED"
    ) {
      return noStoreJson({
        status: "reauthorization_required",
        message: "Notion 연결이 만료되었습니다. 다시 연결해주세요."
      });
    }

    const previousSnapshot = await readStoredNotionSnapshot();
    return noStoreJson({
      status: "sync_error",
      message: "Notion 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      lastSyncedAt: previousSnapshot?.fetchedAt ?? null
    });
  }
}

function noStoreJson(body: NotionConnectionState) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" }
  });
}
