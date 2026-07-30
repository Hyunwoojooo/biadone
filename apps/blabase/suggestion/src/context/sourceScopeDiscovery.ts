import {
  readStoredCodexConfig
} from "../connectors/codex/localStore";
import type { StoredCodexConfig } from "../connectors/codex/types";
import {
  readStoredGitHubSnapshot
} from "../connectors/github/localStore";
import type { GitHubSnapshot } from "../connectors/github/types";
import {
  LEGACY_GOOGLE_CALENDAR_SCOPE_ID,
  googleCalendarConnectionScopeId,
  googleCalendarSnapshotScopeId,
  readStoredSnapshot as readStoredGoogleCalendarSnapshot,
  readStoredTokens as readStoredGoogleCalendarTokens
} from "../connectors/googleCalendar/localStore";
import type { GoogleCalendarSnapshot } from "../connectors/googleCalendar/types";
import {
  readStoredNotionSnapshot
} from "../connectors/notion/localStore";
import type { NotionSnapshot } from "../connectors/notion/types";
import {
  lookupProjectId,
  sourceScopeFingerprint,
  type SourceScopeRef,
  type WorkContextRegistry
} from "./contracts";

export const SOURCE_SCOPE_DISCOVERY_CONTRACT =
  "source-scope-discovery-v1" as const;
export const SOURCE_SCOPE_LABEL_MAX_LENGTH = 100 as const;

const SOURCE_LIMITS = {
  github: 100,
  codex: 50,
  notion: 100,
  google_calendar: 1
} as const;

export type DiscoverableSourceScope = {
  scopeFingerprint: string;
  scope: SourceScopeRef;
  label: string;
  projectId: string | null;
};

export type DiscoverableProject = {
  projectId: string;
  label: string;
  archived: boolean;
};

export type SourceScopeDiscovery = {
  contract: typeof SOURCE_SCOPE_DISCOVERY_CONTRACT;
  projects: DiscoverableProject[];
  scopes: DiscoverableSourceScope[];
  truncatedSources: Array<SourceScopeRef["source"]>;
};

type StoredDiscoveryState = {
  registry: WorkContextRegistry | null;
  github: GitHubSnapshot | null;
  codexConfig: StoredCodexConfig | null;
  notion: NotionSnapshot | null;
  googleCalendar: GoogleCalendarSnapshot | null;
  googleCalendarConnected: boolean;
  googleCalendarConnectionScopeId?: string | null;
};

/**
 * Reads only already-normalized local connector state. The returned object
 * deliberately excludes paths, tokens, URLs, event titles, and connector
 * installation secrets.
 */
export async function readStoredSourceScopeDiscovery(input?: {
  cwd?: string;
  registry?: WorkContextRegistry | null;
}): Promise<SourceScopeDiscovery> {
  const cwd = input?.cwd ?? process.cwd();
  const [
    github,
    codexConfig,
    notion,
    googleCalendar,
    googleCalendarTokens
  ] = await Promise.all([
    readStoredGitHubSnapshot(cwd),
    readStoredCodexConfig(cwd),
    readStoredNotionSnapshot(cwd),
    readStoredGoogleCalendarSnapshot(cwd),
    readStoredGoogleCalendarTokens(cwd)
  ]);

  return discoverSourceScopes({
    registry: input?.registry ?? null,
    github,
    codexConfig,
    notion,
    googleCalendar,
    googleCalendarConnected: googleCalendarTokens !== null,
    googleCalendarConnectionScopeId: googleCalendarTokens
      ? googleCalendarConnectionScopeId(googleCalendarTokens)
      : null
  });
}

export function discoverSourceScopes(
  state: StoredDiscoveryState
): SourceScopeDiscovery {
  const githubScopes =
    state.github?.repositories
      .filter((repository) => !repository.archived)
      .sort(
        (left, right) =>
          left.fullName.localeCompare(right.fullName) ||
          left.id - right.id
      )
      .map((repository) =>
        scopeEntry(
          {
            source: "github",
            resourceType: "repository",
            opaqueId: String(repository.id)
          },
          repository.fullName,
          "GitHub repository",
          state.registry
        )
      ) ?? [];

  const selectedCodexScopeIds = new Set(
    state.codexConfig?.selectedScopeIds ?? []
  );
  const codexScopes =
    state.codexConfig?.scopes
      .filter((scope) => selectedCodexScopeIds.has(scope.id))
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          left.id.localeCompare(right.id)
      )
      .map((scope) =>
        scopeEntry(
          {
            source: "codex",
            resourceType: "scope",
            opaqueId: scope.id
          },
          scope.label,
          "Codex scope",
          state.registry
        )
      ) ?? [];

  const notionScopes =
    state.notion?.resources
      .slice()
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.id.localeCompare(right.id)
      )
      .map((resource) =>
        scopeEntry(
          {
            source: "notion",
            resourceType: "resource",
            opaqueId: resource.id
          },
          resource.title,
          resource.kind === "data_source"
            ? "Notion data source"
            : "Notion page",
          state.registry
        )
      ) ?? [];

  const calendarScopeId = state.googleCalendarConnected
    ? (state.googleCalendarConnectionScopeId ??
      (state.googleCalendar
        ? googleCalendarSnapshotScopeId(state.googleCalendar)
        : LEGACY_GOOGLE_CALENDAR_SCOPE_ID))
    : null;
  const calendarScopes =
    calendarScopeId !== null
      ? [
          scopeEntry(
            {
              source: "google_calendar",
              resourceType: "scope",
              opaqueId: calendarScopeId
            },
            "기본 캘린더",
            "Google Calendar",
            state.registry
          )
        ]
      : [];

  const grouped = {
    github: uniqueScopes(githubScopes),
    codex: uniqueScopes(codexScopes),
    notion: uniqueScopes(notionScopes),
    google_calendar: uniqueScopes(calendarScopes)
  };
  const truncatedSources = (
    Object.keys(grouped) as Array<keyof typeof grouped>
  ).filter(
    (source) => grouped[source].length > SOURCE_LIMITS[source]
  );

  return {
    contract: SOURCE_SCOPE_DISCOVERY_CONTRACT,
    projects: projectViews(state.registry),
    scopes: [
      ...grouped.github.slice(0, SOURCE_LIMITS.github),
      ...grouped.codex.slice(0, SOURCE_LIMITS.codex),
      ...grouped.notion.slice(0, SOURCE_LIMITS.notion),
      ...grouped.google_calendar.slice(
        0,
        SOURCE_LIMITS.google_calendar
      )
    ],
    truncatedSources
  };
}

function projectViews(
  registry: WorkContextRegistry | null
): DiscoverableProject[] {
  if (registry === null) return [];
  return registry.projects
    .slice()
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.projectId.localeCompare(right.projectId)
    )
    .map((project, index) => ({
      projectId: project.projectId,
      label: `Project ${index + 1}`,
      archived: project.archivedAt !== null
    }));
}

function scopeEntry(
  scope: SourceScopeRef,
  label: string,
  fallback: string,
  registry: WorkContextRegistry | null
): DiscoverableSourceScope {
  return {
    scopeFingerprint: sourceScopeFingerprint(scope),
    scope,
    label: safeScopeLabel(label, fallback),
    projectId:
      registry === null ? null : lookupProjectId(registry, scope)
  };
}

function uniqueScopes(
  scopes: DiscoverableSourceScope[]
): DiscoverableSourceScope[] {
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    if (seen.has(scope.scopeFingerprint)) return false;
    seen.add(scope.scopeFingerprint);
    return true;
  });
}

export function safeScopeLabel(
  value: string,
  fallback: string
): string {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu,
      ""
    )
    .replace(/\s+/gu, " ")
    .trim();
  const safeFallback =
    fallback
      .replace(
        /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu,
        ""
      )
      .replace(/\s+/gu, " ")
      .trim() || "Source scope";
  return (normalized || safeFallback).slice(
    0,
    SOURCE_SCOPE_LABEL_MAX_LENGTH
  );
}
