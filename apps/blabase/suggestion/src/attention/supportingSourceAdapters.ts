import { z } from "zod";

import type { GoogleCalendarSnapshot } from "../connectors/googleCalendar/types";
import { googleCalendarSnapshotScopeId } from "../connectors/googleCalendar/localStore";
import type { NotionSnapshot } from "../connectors/notion/types";
import {
  lookupProjectId,
  type WorkContextRegistry
} from "../context/contracts";

export const SUPPORTING_SOURCE_ADAPTER_VERSION =
  "supporting-source-adapter-v0.3" as const;

const timestampSchema = z.string().datetime();
const projectIdSchema = z
  .string()
  .regex(/^project_[a-f0-9]{32}$/)
  .nullable();
const unavailableReasonSchema = z.enum([
  "CONNECTOR_DISCONNECTED",
  "COLLECTION_FAILED",
  "SNAPSHOT_MISSING",
  "SNAPSHOT_PARSE_FAILED",
  "SNAPSHOT_SCHEMA_UNSUPPORTED"
]);

const unavailableSupportingSourceSchema = z
  .object({
    status: z.literal("unavailable"),
    reason: unavailableReasonSchema
  })
  .strict();

const calendarConstraintSchema = z
  .object({
    eventId: z.string().min(1).max(512),
    projectId: projectIdSchema,
    title: z.string().min(1).max(240),
    startAt: z.string().min(1).max(80),
    endAt: z.string().min(1).max(80),
    allDay: z.boolean(),
    tentative: z.boolean()
  })
  .strict();

const availableCalendarSourceSchema = z
  .object({
    status: z.literal("available"),
    adapterVersion: z.literal(SUPPORTING_SOURCE_ADAPTER_VERSION),
    fetchedAt: timestampSchema,
    freshness: z.enum(["fresh", "stale"]),
    capability: z.literal("schedule_context_only"),
    sourceScopeId: z
      .string()
      .min(1)
      .max(240)
      .startsWith("calendar:calendar_scope_"),
    projectId: projectIdSchema,
    truncated: z.boolean(),
    constraints: z.array(calendarConstraintSchema).max(250)
  })
  .strict();

export const calendarAttentionSourceSchema = z.discriminatedUnion(
  "status",
  [
    availableCalendarSourceSchema,
    unavailableSupportingSourceSchema
  ]
);

const notionResourceContextSchema = z
  .object({
    resourceId: z.string().min(1).max(512),
    projectId: projectIdSchema,
    resourceKind: z.enum(["page", "data_source"]),
    title: z.string().min(1).max(240),
    lastEditedAt: timestampSchema
  })
  .strict();

const availableNotionSourceSchema = z
  .object({
    status: z.literal("available"),
    adapterVersion: z.literal(SUPPORTING_SOURCE_ADAPTER_VERSION),
    fetchedAt: timestampSchema,
    freshness: z.enum(["fresh", "stale"]),
    capability: z.literal("project_context_only"),
    truncated: z.boolean(),
    resources: z.array(notionResourceContextSchema).max(200)
  })
  .strict();

export const notionAttentionSourceSchema = z.discriminatedUnion(
  "status",
  [availableNotionSourceSchema, unavailableSupportingSourceSchema]
);

export type CalendarAttentionSource = z.infer<
  typeof calendarAttentionSourceSchema
>;
export type NotionAttentionSource = z.infer<
  typeof notionAttentionSourceSchema
>;
export type SupportingSourceUnavailableReason = z.infer<
  typeof unavailableReasonSchema
>;

export function unavailableCalendarAttentionSource(
  reason: SupportingSourceUnavailableReason
): CalendarAttentionSource {
  return { status: "unavailable", reason };
}

export function unavailableNotionAttentionSource(
  reason: SupportingSourceUnavailableReason
): NotionAttentionSource {
  return { status: "unavailable", reason };
}

export function adaptCalendarSnapshotForAttention(input: {
  snapshot: GoogleCalendarSnapshot;
  asOf: string;
  registry: WorkContextRegistry | null;
  maxAgeMs?: number;
}): CalendarAttentionSource {
  const asOfMs = Date.parse(input.asOf);
  const scopeId = googleCalendarSnapshotScopeId(input.snapshot);
  const projectId = input.registry
    ? lookupProjectId(input.registry, {
        source: "google_calendar",
        resourceType: "scope",
        opaqueId: scopeId
      })
    : null;
  const allConstraints = input.snapshot.events
    .filter(
      (event) =>
        event.status !== "cancelled" &&
        calendarEndMs(event.endAt, event.allDay) > asOfMs
    )
    .map((event) => ({
      eventId: event.id,
      projectId,
      title: safeText(event.title, "제목 없는 일정", 240),
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      tentative: event.status === "tentative"
    }))
    .sort(
      (left, right) =>
        calendarStartMs(left.startAt, left.allDay) -
          calendarStartMs(right.startAt, right.allDay) ||
        left.eventId.localeCompare(right.eventId)
      );
  const constraints = allConstraints.slice(0, 250);

  return calendarAttentionSourceSchema.parse({
    status: "available",
    adapterVersion: SUPPORTING_SOURCE_ADAPTER_VERSION,
    fetchedAt: input.snapshot.fetchedAt,
    freshness: snapshotFreshness(
      input.snapshot.fetchedAt,
      input.asOf,
      input.maxAgeMs
    ),
    capability: "schedule_context_only",
    sourceScopeId: `calendar:${scopeId}`,
    projectId,
    truncated:
      input.snapshot.truncated === true ||
      allConstraints.length > constraints.length,
    constraints
  });
}

export function adaptNotionSnapshotForAttention(input: {
  snapshot: NotionSnapshot;
  asOf: string;
  registry: WorkContextRegistry | null;
  maxAgeMs?: number;
}): NotionAttentionSource {
  return notionAttentionSourceSchema.parse({
    status: "available",
    adapterVersion: SUPPORTING_SOURCE_ADAPTER_VERSION,
    fetchedAt: input.snapshot.fetchedAt,
    freshness: snapshotFreshness(
      input.snapshot.fetchedAt,
      input.asOf,
      input.maxAgeMs
    ),
    capability: "project_context_only",
    truncated: input.snapshot.truncated,
    resources: input.snapshot.resources.map((resource) => ({
      resourceId: resource.id,
      projectId: input.registry
        ? lookupProjectId(input.registry, {
            source: "notion",
            resourceType: "resource",
            opaqueId: resource.id
          })
        : null,
      resourceKind: resource.kind,
      title: safeText(resource.title, "제목 없는 Notion 항목", 240),
      lastEditedAt: resource.lastEditedAt
    }))
  });
}

function snapshotFreshness(
  fetchedAt: string,
  asOf: string,
  maxAgeMs = 30 * 60 * 1_000
): "fresh" | "stale" {
  const ageMs = Date.parse(asOf) - Date.parse(fetchedAt);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs
    ? "fresh"
    : "stale";
}

function calendarStartMs(value: string, allDay: boolean): number {
  return allDay
    ? Date.parse(`${value}T00:00:00+09:00`)
    : Date.parse(value);
}

function calendarEndMs(value: string, allDay: boolean): number {
  return calendarStartMs(value, allDay);
}

function safeText(
  value: string,
  fallback: string,
  maxLength: number
): string {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, maxLength);
}
