export const SOURCE_CONNECTION_ANCHORS = {
  github: "source-github",
  codex: "source-codex",
  notion: "source-notion",
  "google-calendar": "source-google-calendar"
} as const;

export type SourceConnectionName = keyof typeof SOURCE_CONNECTION_ANCHORS;

export type OAuthSourceConnection = Exclude<SourceConnectionName, "codex">;

const SOURCE_STATUS_QUERY = {
  github: "github",
  notion: "notion",
  "google-calendar": "calendar"
} as const satisfies Record<OAuthSourceConnection, string>;

const SOURCE_RETURN_STATUSES = {
  github: [
    "authorization_required",
    "cancelled",
    "connected",
    "connected_sync_pending",
    "failed",
    "installation_required",
    "installation_sync_pending",
    "installation_updated",
    "local_only",
    "temporarily_unavailable"
  ],
  notion: [
    "cancelled",
    "connected",
    "connected_sync_pending",
    "failed",
    "local_only",
    "temporarily_unavailable"
  ],
  "google-calendar": [
    "cancelled",
    "connected",
    "connected_sync_pending",
    "failed",
    "local_only",
    "temporarily_unavailable"
  ]
} as const satisfies Record<OAuthSourceConnection, readonly string[]>;

export type SourceConnectionReturnStatus<
  Source extends OAuthSourceConnection
> = (typeof SOURCE_RETURN_STATUSES)[Source][number];

export function sourceConnectionAnchor(
  source: string | null
): string | null {
  if (
    source === null ||
    !Object.prototype.hasOwnProperty.call(
      SOURCE_CONNECTION_ANCHORS,
      source
    )
  ) {
    return null;
  }

  return SOURCE_CONNECTION_ANCHORS[source as SourceConnectionName];
}

export function launcherSourceAnchor(
  source: string | null,
  entry: string | null
): string | null {
  return entry === "launcher" ? sourceConnectionAnchor(source) : null;
}

export function sourceConnectionReturnUrl<
  Source extends OAuthSourceConnection
>(
  requestUrl: string,
  source: Source,
  status: SourceConnectionReturnStatus<Source>
): URL {
  const destination = new URL("/sources", requestUrl);
  destination.searchParams.set(SOURCE_STATUS_QUERY[source], status);
  destination.hash = SOURCE_CONNECTION_ANCHORS[source];
  return destination;
}
