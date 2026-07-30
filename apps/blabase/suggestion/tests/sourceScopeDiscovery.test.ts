import { describe, expect, it } from "vitest";

import type { StoredCodexConfig } from "../src/connectors/codex/types";
import type { GitHubSnapshot } from "../src/connectors/github/types";
import type { GoogleCalendarSnapshot } from "../src/connectors/googleCalendar/types";
import type { NotionSnapshot } from "../src/connectors/notion/types";
import {
  SOURCE_SCOPE_LABEL_MAX_LENGTH,
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  discoverSourceScopes,
  safeScopeLabel
} from "../src/context";

const PROJECT_A = `project_${"1".repeat(32)}`;
const PROJECT_B = `project_${"2".repeat(32)}`;
const T0 = "2026-07-28T00:00:00.000Z";
const T1 = "2026-07-28T00:01:00.000Z";
const T2 = "2026-07-28T00:02:00.000Z";
const CALENDAR_SCOPE_ID = `calendar_scope_${"a".repeat(32)}`;

describe("source scope discovery", () => {
  it("exposes sanitized human labels while keeping project activation explicit", () => {
    let registry = createEmptyWorkContextRegistry(T0);
    registry = createProjectIdentity(registry, {
      projectId: PROJECT_A,
      createdAt: T0
    }).registry;
    registry = createProjectIdentity(registry, {
      projectId: PROJECT_B,
      createdAt: T1
    }).registry;

    const inputs = storedState(registry);
    const unmapped = discoverSourceScopes(inputs);
    expect(unmapped.projects).toEqual([
      {
        projectId: PROJECT_A,
        label: "Project 1",
        archived: false
      },
      {
        projectId: PROJECT_B,
        label: "Project 2",
        archived: false
      }
    ]);
    expect(unmapped.scopes).toHaveLength(4);
    expect(unmapped.scopes.every((scope) => scope.projectId === null)).toBe(
      true
    );

    for (const entry of unmapped.scopes) {
      registry = confirmProjectMapping(registry, {
        scope: entry.scope,
        projectId: PROJECT_A,
        confirmedAt: T2,
        explicitUserConfirmation: true
      }).registry;
    }

    const mapped = discoverSourceScopes({
      ...inputs,
      registry
    });
    expect(mapped.scopes.map((scope) => scope.scope.source)).toEqual([
      "github",
      "codex",
      "notion",
      "google_calendar"
    ]);
    expect(mapped.scopes.every((scope) => scope.projectId === PROJECT_A)).toBe(
      true
    );
    expect(
      mapped.scopes.every(
        (scope) =>
          scope.label.length <= SOURCE_SCOPE_LABEL_MAX_LENGTH &&
          !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(
            scope.label
          )
      )
    ).toBe(true);

    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain("/Users/private/project");
    expect(serialized).not.toContain("Secret calendar event");
    expect(serialized).not.toContain("installation-secret");
  });

  it("returns only selected Codex scopes and caps oversized source lists", () => {
    const inputs = storedState(null);
    const repositories = Array.from({ length: 105 }, (_, index) => ({
      ...inputs.github!.repositories[0],
      id: index + 1,
      fullName: `owner/repository-${String(index).padStart(3, "0")}`
    }));
    const discovery = discoverSourceScopes({
      ...inputs,
      github: {
        ...inputs.github!,
        repositories
      }
    });

    expect(
      discovery.scopes.filter(
        (scope) => scope.scope.source === "github"
      )
    ).toHaveLength(100);
    expect(discovery.truncatedSources).toContain("github");
    expect(
      discovery.scopes.filter(
        (scope) => scope.scope.source === "codex"
      )
    ).toHaveLength(1);
    expect(
      discovery.scopes.some((scope) => scope.label === "Not selected")
    ).toBe(false);

    const connectedWithoutSnapshot = discoverSourceScopes({
      ...inputs,
      googleCalendar: null,
      googleCalendarConnected: true
    });
    expect(
      connectedWithoutSnapshot.scopes.some(
        (scope) => scope.scope.source === "google_calendar"
      )
    ).toBe(true);
  });

  it("uses a safe fallback and caps labels", () => {
    expect(safeScopeLabel("\u202e\n\t", "Fallback scope")).toBe(
      "Fallback scope"
    );
    expect(safeScopeLabel("x".repeat(150), "fallback")).toHaveLength(
      SOURCE_SCOPE_LABEL_MAX_LENGTH
    );
  });

  it("does not carry a Calendar project mapping across OAuth connection identities", () => {
    let registry = createEmptyWorkContextRegistry(T0);
    registry = createProjectIdentity(registry, {
      projectId: PROJECT_A,
      createdAt: T0
    }).registry;
    registry = confirmProjectMapping(registry, {
      scope: {
        source: "google_calendar",
        resourceType: "scope",
        opaqueId: CALENDAR_SCOPE_ID
      },
      projectId: PROJECT_A,
      confirmedAt: T1,
      explicitUserConfirmation: true
    }).registry;

    const nextScopeId = `calendar_scope_${"b".repeat(32)}`;
    const discovery = discoverSourceScopes({
      ...storedState(registry),
      googleCalendar: {
        ...storedState(registry).googleCalendar!,
        connectionScopeId: nextScopeId
      },
      googleCalendarConnectionScopeId: nextScopeId
    });
    const calendar = discovery.scopes.find(
      (entry) => entry.scope.source === "google_calendar"
    );

    expect(calendar).toMatchObject({
      scope: {
        opaqueId: nextScopeId
      },
      projectId: null
    });
  });
});

function storedState(
  registry: ReturnType<typeof createEmptyWorkContextRegistry> | null
) {
  const github: GitHubSnapshot = {
    schemaVersion: "github-snapshot-v2",
    appClientId: "client",
    appSlug: "app",
    apiVersion: "2022-11-28",
    fetchedAt: T2,
    user: { id: 1, login: "owner" },
    truncated: false,
    activityWindowStart: T0,
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 11,
        fullName: `owner/\u202esecret\n${"x".repeat(120)}`,
        private: true,
        archived: false,
        updatedAt: T2
      }
    ],
    tasks: [],
    activities: []
  };
  const codexConfig: StoredCodexConfig = {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: "a".repeat(64),
    selectedScopeIds: ["b".repeat(24)],
    scopes: [
      {
        id: "b".repeat(24),
        queryPath: "/Users/private/project",
        label: "Selected Codex project",
        sessionCount: 2,
        lastActivityAt: T2
      },
      {
        id: "c".repeat(24),
        queryPath: "/Users/private/not-selected",
        label: "Not selected",
        sessionCount: 1,
        lastActivityAt: T1
      }
    ],
    contentMode: "metadata_only",
    contentConsentAt: null,
    conversationConsentContract: null,
    conversationConsentAt: null,
    conversationRetentionDays: null,
    discoveredAt: T2
  };
  const notion: NotionSnapshot = {
    schemaVersion: "notion-snapshot-v1",
    apiVersion: "2025-09-03",
    fetchedAt: T2,
    workspaceId: "workspace",
    workspaceName: "Workspace",
    truncated: false,
    resources: [
      {
        id: "notion-resource-1",
        source: "notion",
        kind: "page",
        title: "Product plan",
        createdAt: T0,
        lastEditedAt: T2
      }
    ]
  };
  const googleCalendar: GoogleCalendarSnapshot = {
    schemaVersion: "google-calendar-snapshot-v1",
    connectionScopeId: CALENDAR_SCOPE_ID,
    fetchedAt: T2,
    timeMin: T0,
    timeMax: "2026-08-28T00:00:00.000Z",
    events: [
      {
        id: "event-1",
        source: "google_calendar",
        kind: "calendar_event",
        title: "Secret calendar event",
        status: "confirmed",
        startAt: T1,
        endAt: T2,
        allDay: false,
        recurringEventId: null,
        eventType: "default",
        updatedAt: T1
      }
    ]
  };
  return {
    registry,
    github,
    codexConfig,
    notion,
    googleCalendar,
    googleCalendarConnected: true,
    googleCalendarConnectionScopeId: CALENDAR_SCOPE_ID
  };
}
