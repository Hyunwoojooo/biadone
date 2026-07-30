import { describe, expect, it } from "vitest";

import {
  adaptCalendarSnapshotForAttention,
  adaptNotionSnapshotForAttention
} from "../src/attention/supportingSourceAdapters";
import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity
} from "../src/context/contracts";

const AS_OF = "2026-07-27T06:00:00.000Z";
const CALENDAR_SCOPE_ID = `calendar_scope_${"a".repeat(32)}`;

describe("supporting Attention source adapters", () => {
  it("uses an explicit calendar scope mapping and excludes ended or cancelled events", () => {
    const registry = mappedRegistry({
      source: "google_calendar",
      resourceType: "scope",
      opaqueId: CALENDAR_SCOPE_ID
    });
    const source = adaptCalendarSnapshotForAttention({
      snapshot: {
        schemaVersion: "google-calendar-snapshot-v1",
        connectionScopeId: CALENDAR_SCOPE_ID,
        fetchedAt: "2026-07-27T05:59:00.000Z",
        timeMin: "2026-07-20T06:00:00.000Z",
        timeMax: "2026-08-10T06:00:00.000Z",
        events: [
          {
            id: "upcoming",
            source: "google_calendar",
            kind: "calendar_event",
            title: "Launch review",
            status: "confirmed",
            startAt: "2026-07-27T07:00:00.000Z",
            endAt: "2026-07-27T08:00:00.000Z",
            allDay: false,
            recurringEventId: null,
            eventType: "default",
            updatedAt: "2026-07-27T05:00:00.000Z"
          },
          {
            id: "cancelled",
            source: "google_calendar",
            kind: "calendar_event",
            title: "Cancelled",
            status: "cancelled",
            startAt: "2026-07-27T09:00:00.000Z",
            endAt: "2026-07-27T10:00:00.000Z",
            allDay: false,
            recurringEventId: null,
            eventType: "default",
            updatedAt: "2026-07-27T05:00:00.000Z"
          }
        ]
      },
      asOf: AS_OF,
      registry
    });

    expect(source).toMatchObject({
      status: "available",
      freshness: "fresh",
      capability: "schedule_context_only",
      sourceScopeId: `calendar:${CALENDAR_SCOPE_ID}`,
      projectId: registry.projects[0]?.projectId,
      truncated: false,
      constraints: [{ eventId: "upcoming" }]
    });
  });

  it("does not reuse the legacy primary mapping when a snapshot has no connection identity", () => {
    const registry = mappedRegistry({
      source: "google_calendar",
      resourceType: "scope",
      opaqueId: "primary"
    });
    const source = adaptCalendarSnapshotForAttention({
      snapshot: {
        schemaVersion: "google-calendar-snapshot-v1",
        fetchedAt: "2026-07-27T05:59:00.000Z",
        timeMin: "2026-07-20T06:00:00.000Z",
        timeMax: "2026-08-10T06:00:00.000Z",
        events: []
      },
      asOf: AS_OF,
      registry
    });

    expect(source).toMatchObject({
      status: "available",
      sourceScopeId:
        "calendar:calendar_scope_legacy_unidentified",
      projectId: null
    });
  });

  it("caps large calendar snapshots without failing Attention input validation", () => {
    const source = adaptCalendarSnapshotForAttention({
      snapshot: {
        schemaVersion: "google-calendar-snapshot-v1",
        fetchedAt: "2026-07-27T05:59:00.000Z",
        timeMin: "2026-07-20T06:00:00.000Z",
        timeMax: "2026-08-10T06:00:00.000Z",
        events: Array.from({ length: 251 }, (_, index) => ({
          id: `event-${String(index).padStart(3, "0")}`,
          source: "google_calendar" as const,
          kind: "calendar_event" as const,
          title: `Event ${index}`,
          status: "confirmed" as const,
          startAt: new Date(
            Date.parse("2026-07-27T07:00:00.000Z") +
              index * 60_000
          ).toISOString(),
          endAt: new Date(
            Date.parse("2026-07-27T07:30:00.000Z") +
              index * 60_000
          ).toISOString(),
          allDay: false,
          recurringEventId: null,
          eventType: "default",
          updatedAt: "2026-07-27T05:00:00.000Z"
        }))
      },
      asOf: AS_OF,
      registry: null
    });

    expect(source.status).toBe("available");
    if (source.status !== "available") return;
    expect(source.constraints).toHaveLength(250);
    expect(source.truncated).toBe(true);
  });

  it("keeps unmapped Notion resources as context rather than candidates", () => {
    const source = adaptNotionSnapshotForAttention({
      snapshot: {
        schemaVersion: "notion-snapshot-v1",
        apiVersion: "2026-03-11",
        fetchedAt: "2026-07-27T05:59:00.000Z",
        workspaceId: "workspace-a",
        workspaceName: "Acme",
        truncated: false,
        resources: [
          {
            id: "page-a",
            source: "notion",
            kind: "page",
            title: "Product brief",
            createdAt: "2026-07-20T00:00:00.000Z",
            lastEditedAt: "2026-07-27T05:00:00.000Z"
          }
        ]
      },
      asOf: AS_OF,
      registry: null
    });

    expect(source).toEqual({
      status: "available",
      adapterVersion: "supporting-source-adapter-v0.3",
      fetchedAt: "2026-07-27T05:59:00.000Z",
      freshness: "fresh",
      capability: "project_context_only",
      truncated: false,
      resources: [
        {
          resourceId: "page-a",
          projectId: null,
          resourceKind: "page",
          title: "Product brief",
          lastEditedAt: "2026-07-27T05:00:00.000Z"
        }
      ]
    });
  });
});

function mappedRegistry(
  scope:
    | {
        source: "google_calendar";
        resourceType: "scope";
        opaqueId: string;
      }
    | {
        source: "notion";
        resourceType: "resource";
        opaqueId: string;
      }
) {
  const empty = createEmptyWorkContextRegistry(
    "2026-07-27T00:00:00.000Z"
  );
  const created = createProjectIdentity(empty, {
    createdAt: "2026-07-27T00:00:01.000Z"
  });
  return confirmProjectMapping(created.registry, {
    scope,
    projectId: created.project.projectId,
    confirmedAt: "2026-07-27T00:00:02.000Z",
    explicitUserConfirmation: true
  }).registry;
}
