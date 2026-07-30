import type { ConnectorTimelineState } from "../../src/connectors/timeline/types";

export type SourceSyncName =
  | "github"
  | "codex"
  | "notion"
  | "google_calendar";

export type SourceSyncState =
  | "idle"
  | "syncing"
  | "backoff"
  | "disconnected"
  | "error";

export type SourceSyncStatus = {
  source: SourceSyncName;
  status: SourceSyncState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
  retryCount: number;
  lastErrorCode: string | null;
  snapshotRevision: string | null;
  snapshotHash: string | null;
};

export type SourceSyncStatusResponse = {
  status: "ready";
  revision: string;
  generatedAt: string;
  sources: SourceSyncStatus[];
  adapterMode: "coordinator" | "timeline_fallback";
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function fetchSourceSyncStatus(
  fetchImpl: FetchLike = fetch
): Promise<SourceSyncStatusResponse> {
  const response = await fetchImpl("/api/sync/status", {
    cache: "no-store"
  });

  if (response.status === 404) {
    return fetchTimelineFallback(fetchImpl);
  }
  if (!response.ok) {
    throw new Error(`Sync status request failed (${response.status}).`);
  }

  return parseCoordinatorResponse(await response.json());
}

export async function requestSourceSync(
  sources: readonly SourceSyncName[],
  fetchImpl: FetchLike = fetch
): Promise<SourceSyncStatusResponse> {
  const response = await fetchImpl("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sources: Array.from(new Set(sources))
    })
  });
  if (!response.ok) {
    throw new Error(`Source sync request failed (${response.status}).`);
  }
  return parseCoordinatorResponse(await response.json());
}

export async function requestSourceSyncStart(
  fetchImpl: FetchLike = fetch
): Promise<SourceSyncStatusResponse> {
  const response = await fetchImpl("/api/sync/start", {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(
      `Source sync start request failed (${response.status}).`
    );
  }
  return parseCoordinatorResponse(await response.json());
}

function parseCoordinatorResponse(
  value: unknown
): SourceSyncStatusResponse {
  if (!isRecord(value) || value.status !== "ready") {
    throw new Error("Invalid sync status response.");
  }
  if (
    typeof value.revision !== "string" ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.sources)
  ) {
    throw new Error("Incomplete sync status response.");
  }

  return {
    status: "ready",
    revision: value.revision,
    generatedAt: value.generatedAt,
    sources: value.sources.map(parseSourceStatus),
    adapterMode: "coordinator"
  };
}

function parseSourceStatus(value: unknown): SourceSyncStatus {
  if (!isRecord(value)) {
    throw new Error("Invalid source sync status.");
  }
  if (!isSource(value.source) || !isSourceState(value.status)) {
    throw new Error("Unknown source sync status.");
  }
  if (
    !isNullableString(value.lastAttemptAt) ||
    !isNullableString(value.lastSuccessAt) ||
    !isNullableString(value.lastFailureAt) ||
    !isNullableString(value.nextRetryAt) ||
    !isNullableString(value.lastErrorCode) ||
    !isNullableString(value.snapshotRevision) ||
    !isNullableString(value.snapshotHash) ||
    typeof value.retryCount !== "number" ||
    !Number.isInteger(value.retryCount) ||
    value.retryCount < 0
  ) {
    throw new Error("Incomplete source sync status.");
  }

  return {
    source: value.source,
    status: value.status,
    lastAttemptAt: value.lastAttemptAt,
    lastSuccessAt: value.lastSuccessAt,
    lastFailureAt: value.lastFailureAt,
    nextRetryAt: value.nextRetryAt,
    retryCount: value.retryCount,
    lastErrorCode: value.lastErrorCode,
    snapshotRevision: value.snapshotRevision,
    snapshotHash: value.snapshotHash
  };
}

async function fetchTimelineFallback(
  fetchImpl: FetchLike
): Promise<SourceSyncStatusResponse> {
  const response = await fetchImpl("/api/connectors/timeline", {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(
      `Timeline fallback request failed (${response.status}).`
    );
  }
  const timeline = (await response.json()) as ConnectorTimelineState;
  if (timeline.status !== "ready") {
    throw new Error("Timeline fallback is unavailable.");
  }

  const sources = timeline.sources.map((source) => ({
    source: source.source,
    status: source.state === "missing" ? "disconnected" : "idle",
    lastAttemptAt: null,
    lastSuccessAt: source.snapshotFetchedAt,
    lastFailureAt: null,
    nextRetryAt: null,
    retryCount: 0,
    lastErrorCode: null,
    snapshotRevision:
      source.snapshotFetchedAt === null
        ? null
        : fallbackSnapshotRevision(source),
    snapshotHash: null
  })) satisfies SourceSyncStatus[];

  return {
    status: "ready",
    revision: fallbackOverallRevision(sources),
    generatedAt: timeline.generatedAt,
    sources,
    adapterMode: "timeline_fallback"
  };
}

function fallbackSnapshotRevision(
  source: Extract<
    ConnectorTimelineState,
    { status: "ready" }
  >["sources"][number]
): string {
  return `timeline:${simpleHash(
    [
      source.source,
      source.state,
      source.snapshotFetchedAt,
      source.itemCount,
      source.skippedItemCount,
      source.truncated
    ].join("|")
  )}`;
}

function fallbackOverallRevision(
  sources: SourceSyncStatus[]
): string {
  return `timeline:${simpleHash(
    sources
      .map(
        (source) =>
          `${source.source}:${source.snapshotRevision ?? "missing"}:${source.snapshotHash ?? "missing"}`
      )
      .sort()
      .join("|")
  )}`;
}

function simpleHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSource(value: unknown): value is SourceSyncName {
  return (
    value === "github" ||
    value === "codex" ||
    value === "notion" ||
    value === "google_calendar"
  );
}

function isSourceState(value: unknown): value is SourceSyncState {
  return (
    value === "idle" ||
    value === "syncing" ||
    value === "backoff" ||
    value === "disconnected" ||
    value === "error"
  );
}
