import { getNotesDatabase } from "@/db";
import type {
  ImportedNoteCreateResult,
  ImportedNoteWrite,
  NoteImportGenerationMetadata,
} from "@/lib/note-import";
import {
  CONTENT_NOTE_SCHEMA_VERSION,
  parseConversationContentNoteV4,
  type ConversationContentNoteV4,
} from "@/lib/note-content";
import {
  parseConversationSummaryV2,
  SUMMARY_SCHEMA_VERSION,
  type ConversationSummaryV2,
} from "@/lib/note-summary";
import {
  applyStateNoteCorrection,
  parseConversationStateNoteV3,
  StateNoteCorrectionError,
  STATE_NOTE_SCHEMA_VERSION,
  type ConversationStateNoteV3,
} from "@/lib/note-state";

import {
  ApiRequestError,
  parseCreateNoteInput,
  parseStoredConversationContentNote,
  parseStoredConversationStateNote,
  parseStoredConversationSummary,
  type CreateNoteInput,
  type ListNotesInput,
  type PatchNoteInput,
  type PublicNote,
} from "./_shared";
import { PERMANENT_DELETE_NOTE_SQL } from "./_sql";

/*
 * Imported notes bypass the public create route, so the repository reuses the
 * same size and shape validation before any D1 write.
 */
function validateImportedNoteWrite(input: ImportedNoteWrite): CreateNoteInput {
  return parseCreateNoteInput({
    title: input.title,
    overview: input.overview,
    sections: input.sections,
    tags: input.tags,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle,
    sourceMessageCount: input.sourceMessageCount,
    favorite: false,
    archived: false,
  });
}

type StoredSourceTimelineWrite = Pick<
  ImportedNoteWrite,
  | "sourceTimelineAt"
  | "sourceLastVisibleAt"
  | "sourceTimestampedVisibleMessageCount"
  | "sourceVisibleMessageCount"
>;

function validateImportedSourceTimeline(
  input: ImportedNoteWrite,
): StoredSourceTimelineWrite {
  const sourceTimeline = {
    sourceTimelineAt: validateNullableUtcIso(
      input.sourceTimelineAt,
      "sourceTimelineAt",
    ),
    sourceLastVisibleAt: validateNullableUtcIso(
      input.sourceLastVisibleAt,
      "sourceLastVisibleAt",
    ),
    sourceTimestampedVisibleMessageCount: validateImportedCount(
      input.sourceTimestampedVisibleMessageCount,
      "sourceTimestampedVisibleMessageCount",
    ),
    sourceVisibleMessageCount: validateImportedCount(
      input.sourceVisibleMessageCount,
      "sourceVisibleMessageCount",
    ),
  };
  if (
    sourceTimeline.sourceVisibleMessageCount !== input.sourceMessageCount ||
    sourceTimeline.sourceTimestampedVisibleMessageCount >
      sourceTimeline.sourceVisibleMessageCount ||
    (sourceTimeline.sourceLastVisibleAt === null) !==
      (sourceTimeline.sourceTimestampedVisibleMessageCount === 0) ||
    (sourceTimeline.sourceTimelineAt !== null &&
      sourceTimeline.sourceLastVisibleAt === null)
  ) {
    throw new Error("Imported source timeline coverage is inconsistent.");
  }
  return sourceTimeline;
}

type StoredSummaryWrite =
  | {
      schemaVersion: typeof SUMMARY_SCHEMA_VERSION;
      summary: ConversationSummaryV2;
    }
  | {
      schemaVersion: typeof STATE_NOTE_SCHEMA_VERSION;
      summary: ConversationStateNoteV3;
    }
  | {
      schemaVersion: typeof CONTENT_NOTE_SCHEMA_VERSION;
      summary: ConversationContentNoteV4;
    };

function validateImportedSummary(input: ImportedNoteWrite): StoredSummaryWrite {
  if (input.summarySchemaVersion === SUMMARY_SCHEMA_VERSION) {
    return {
      schemaVersion: SUMMARY_SCHEMA_VERSION,
      summary: parseConversationSummaryV2(input.summary),
    };
  }
  if (input.summarySchemaVersion === STATE_NOTE_SCHEMA_VERSION) {
    return {
      schemaVersion: STATE_NOTE_SCHEMA_VERSION,
      summary: parseConversationStateNoteV3(input.summary),
    };
  }
  if (input.summarySchemaVersion === CONTENT_NOTE_SCHEMA_VERSION) {
    return {
      schemaVersion: CONTENT_NOTE_SCHEMA_VERSION,
      summary: parseConversationContentNoteV4(input.summary),
    };
  }
  throw new Error("Imported generated-note version is unsupported.");
}

type NoteDbRow = {
  id: string;
  title: string;
  overview: string;
  sections_json: string;
  tags_json: string;
  source_url: string | null;
  source_title: string | null;
  source_message_count: number | null;
  source_timeline_at: string | null;
  source_last_visible_at: string | null;
  source_timestamped_visible_message_count: number | null;
  source_visible_message_count: number | null;
  summary_schema_version: string | null;
  summary_json: string | null;
  favorite: number;
  archived: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

const PUBLIC_NOTE_COLUMNS = `
  id,
  title,
  overview,
  sections_json,
  tags_json,
  source_url,
  source_title,
  source_message_count,
  source_timeline_at,
  source_last_visible_at,
  source_timestamped_visible_message_count,
  source_visible_message_count,
  summary_schema_version,
  summary_json,
  favorite,
  archived,
  deleted_at,
  created_at,
  updated_at
`;

export async function listNotes(
  ownerKey: string,
  input: ListNotesInput,
): Promise<PublicNote[]> {
  const database = await getNotesDatabase();
  const conditions = ["owner_key = ?"];
  const bindings: unknown[] = [ownerKey];

  switch (input.view) {
    case "favorites":
      conditions.push("deleted_at IS NULL", "archived = 0", "favorite = 1");
      break;
    case "archive":
      conditions.push("deleted_at IS NULL", "archived = 1");
      break;
    case "trash":
      conditions.push("deleted_at IS NOT NULL");
      break;
    case "timeline":
      conditions.push(
        "deleted_at IS NULL",
        "archived = 0",
        "source_url IS NOT NULL",
      );
      break;
    default:
      conditions.push("deleted_at IS NULL", "archived = 0");
      break;
  }

  if (input.query) {
    const search = `%${escapeLikePattern(input.query.toLocaleLowerCase())}%`;
    conditions.push(`(
      LOWER(title) LIKE ? ESCAPE '\\'
      OR LOWER(overview) LIKE ? ESCAPE '\\'
      OR LOWER(sections_json) LIKE ? ESCAPE '\\'
      OR LOWER(tags_json) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(source_title, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(summary_json, '')) LIKE ? ESCAPE '\\'
    )`);
    bindings.push(search, search, search, search, search, search);
  }

  if (input.tag) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM json_each(notes.tags_json) AS note_tag
      WHERE LOWER(CAST(note_tag.value AS TEXT)) = LOWER(?)
    )`);
    bindings.push(input.tag);
  }

  const orderBy =
    input.view === "timeline"
      ? `CASE WHEN source_timeline_at IS NULL THEN 1 ELSE 0 END ASC,
         source_timeline_at DESC,
         updated_at DESC,
         id DESC`
      : "updated_at DESC, id DESC";
  const query = `
    SELECT ${PUBLIC_NOTE_COLUMNS}
    FROM notes
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
  `;
  const result = await database
    .prepare(query)
    .bind(...bindings)
    .all<NoteDbRow>();

  return result.results.map(toPublicNote);
}

export async function createNote(
  ownerKey: string,
  input: CreateNoteInput,
): Promise<ImportedNoteCreateResult<PublicNote>> {
  return insertNote(ownerKey, input, null, null, null);
}

export async function findNoteBySourceUrl(
  ownerKey: string,
  normalizedUrl: string,
): Promise<PublicNote | null> {
  const database = await getNotesDatabase();
  const note = await database
    .prepare(
      `
        SELECT ${PUBLIC_NOTE_COLUMNS}
        FROM notes
        WHERE owner_key = ? AND source_url = ?
        LIMIT 1
      `,
    )
    .bind(ownerKey, normalizedUrl)
    .first<NoteDbRow>();

  return note ? toPublicNote(note) : null;
}

export async function hasReplacementCandidate(input: {
  ownerKey: string;
  noteId: string;
  normalizedUrl: string;
  expectedUpdatedAt: string;
}): Promise<boolean> {
  const database = await getNotesDatabase();
  const match = await database
    .prepare(
      `
        SELECT 1 AS matches, summary_schema_version, summary_json
        FROM notes
        WHERE id = ?
          AND owner_key = ?
          AND source_url = ?
          AND updated_at = ?
        LIMIT 1
      `,
    )
    .bind(
      input.noteId,
      input.ownerKey,
      input.normalizedUrl,
      input.expectedUpdatedAt,
    )
    .first<{
      matches: number;
      summary_schema_version: string | null;
      summary_json: string | null;
    }>();

  if (!match?.matches) return false;
  const stateNote = parseStoredConversationStateNote(
    match.summary_schema_version,
    match.summary_json,
  );
  if (stateNote?.userCorrections?.length) {
    throw new ApiRequestError(
      "REIMPORT_BLOCKED_BY_USER_CORRECTIONS",
      "사용자가 직접 수정하거나 숨긴 항목이 있어 이 노트는 자동 재생성하지 않았습니다. 기존 노트는 그대로 보존됩니다.",
      409,
    );
  }
  return true;
}

export async function createImportedNote(
  ownerKey: string,
  input: ImportedNoteWrite,
): Promise<ImportedNoteCreateResult<PublicNote>> {
  return insertNote(
    ownerKey,
    validateImportedNoteWrite(input),
    input.generationMetadata,
    validateImportedSummary(input),
    validateImportedSourceTimeline(input),
  );
}

export async function replaceImportedNote(input: {
  ownerKey: string;
  noteId: string;
  normalizedUrl: string;
  expectedUpdatedAt: string;
  note: ImportedNoteWrite;
}): Promise<PublicNote | null> {
  const database = await getNotesDatabase();
  const noteInput = validateImportedNoteWrite(input.note);
  const generatedSummary = validateImportedSummary(input.note);
  const sourceTimeline = validateImportedSourceTimeline(input.note);
  const updatedAt = nextUpdatedAt(input.expectedUpdatedAt);
  const note = await database
    .prepare(
      `
        UPDATE notes
        SET source_title = ?,
            source_message_count = ?,
            source_timeline_at = ?,
            source_last_visible_at = ?,
            source_timestamped_visible_message_count = ?,
            source_visible_message_count = ?,
            generation_metadata_json = ?,
            summary_schema_version = ?,
            summary_json = ?,
            updated_at = ?
        WHERE id = ?
          AND owner_key = ?
          AND source_url = ?
          AND updated_at = ?
        RETURNING ${PUBLIC_NOTE_COLUMNS}
      `,
    )
    .bind(
      noteInput.sourceTitle,
      noteInput.sourceMessageCount,
      sourceTimeline.sourceTimelineAt,
      sourceTimeline.sourceLastVisibleAt,
      sourceTimeline.sourceTimestampedVisibleMessageCount,
      sourceTimeline.sourceVisibleMessageCount,
      JSON.stringify(input.note.generationMetadata),
      generatedSummary.schemaVersion,
      JSON.stringify(generatedSummary.summary),
      updatedAt,
      input.noteId,
      input.ownerKey,
      input.normalizedUrl,
      input.expectedUpdatedAt,
    )
    .first<NoteDbRow>();

  return note ? toPublicNote(note) : null;
}

export async function getNote(
  ownerKey: string,
  id: string,
): Promise<PublicNote | null> {
  const database = await getNotesDatabase();
  const note = await database
    .prepare(
      `
        SELECT ${PUBLIC_NOTE_COLUMNS}
        FROM notes
        WHERE id = ? AND owner_key = ?
      `,
    )
    .bind(id, ownerKey)
    .first<NoteDbRow>();

  return note ? toPublicNote(note) : null;
}

export async function patchNote(
  ownerKey: string,
  id: string,
  patch: PatchNoteInput,
): Promise<PublicNote | null> {
  if (patch.stateNoteCorrection) {
    return patchStateNoteCorrection(ownerKey, id, patch);
  }

  const database = await getNotesDatabase();
  const assignments: string[] = [];
  const bindings: unknown[] = [];

  if (patch.title !== undefined) {
    assignments.push("title = ?");
    bindings.push(patch.title);
  }
  if (patch.overview !== undefined) {
    assignments.push("overview = ?");
    bindings.push(patch.overview);
  }
  if (patch.sections !== undefined) {
    assignments.push("sections_json = ?");
    bindings.push(JSON.stringify(patch.sections));
  }
  if (patch.tags !== undefined) {
    assignments.push("tags_json = ?");
    bindings.push(JSON.stringify(patch.tags));
  }
  if (patch.favorite !== undefined) {
    assignments.push("favorite = ?");
    bindings.push(patch.favorite ? 1 : 0);
  }
  if (patch.archived !== undefined) {
    assignments.push("archived = ?");
    bindings.push(patch.archived ? 1 : 0);
  }
  if (patch.deletedAt === null) {
    assignments.push("deleted_at = NULL");
  }

  assignments.push("updated_at = ?");
  bindings.push(new Date().toISOString(), id, ownerKey);

  const note = await database
    .prepare(
      `
        UPDATE notes
        SET ${assignments.join(", ")}
        WHERE id = ? AND owner_key = ?
        RETURNING ${PUBLIC_NOTE_COLUMNS}
      `,
    )
    .bind(...bindings)
    .first<NoteDbRow>();

  return note ? toPublicNote(note) : null;
}

async function patchStateNoteCorrection(
  ownerKey: string,
  id: string,
  patch: PatchNoteInput,
): Promise<PublicNote | null> {
  const expectedUpdatedAt = patch.expectedUpdatedAt;
  const correction = patch.stateNoteCorrection;
  if (!expectedUpdatedAt || !correction) {
    throw new ApiRequestError(
      "INVALID_CORRECTION_PATCH",
      "State-note corrections require expectedUpdatedAt.",
      400,
    );
  }

  const current = await getNote(ownerKey, id);
  if (!current) return null;
  if (current.updatedAt !== expectedUpdatedAt) {
    throw staleCorrectionWrite(current.updatedAt);
  }
  if (
    current.summarySchemaVersion !== STATE_NOTE_SCHEMA_VERSION ||
    !current.stateNote
  ) {
    throw new ApiRequestError(
      "STATE_NOTE_CORRECTION_UNSUPPORTED",
      "Only valid v3 state notes support item corrections.",
      409,
    );
  }

  const updatedAt = nextUpdatedAt(expectedUpdatedAt);
  let corrected: ConversationStateNoteV3;
  try {
    corrected = applyStateNoteCorrection(
      current.stateNote,
      correction,
      updatedAt,
    );
  } catch (error) {
    if (error instanceof StateNoteCorrectionError) {
      throw new ApiRequestError(error.code, error.message, 400);
    }
    throw error;
  }

  const database = await getNotesDatabase();
  const note = await database
    .prepare(
      `
        UPDATE notes
        SET summary_json = ?, updated_at = ?
        WHERE id = ?
          AND owner_key = ?
          AND summary_schema_version = ?
          AND updated_at = ?
        RETURNING ${PUBLIC_NOTE_COLUMNS}
      `,
    )
    .bind(
      JSON.stringify(corrected),
      updatedAt,
      id,
      ownerKey,
      STATE_NOTE_SCHEMA_VERSION,
      expectedUpdatedAt,
    )
    .first<NoteDbRow>();

  if (!note) {
    const latest = await getNote(ownerKey, id);
    throw staleCorrectionWrite(latest?.updatedAt);
  }
  return toPublicNote(note);
}

function staleCorrectionWrite(currentUpdatedAt?: string): ApiRequestError {
  return new ApiRequestError(
    "STALE_WRITE",
    "The note changed before this correction could be saved.",
    409,
    currentUpdatedAt ? { currentUpdatedAt } : undefined,
  );
}

export async function softDeleteNote(
  ownerKey: string,
  id: string,
): Promise<PublicNote | null> {
  const database = await getNotesDatabase();
  const now = new Date().toISOString();
  const note = await database
    .prepare(
      `
        UPDATE notes
        SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND owner_key = ?
        RETURNING ${PUBLIC_NOTE_COLUMNS}
      `,
    )
    .bind(now, now, id, ownerKey)
    .first<NoteDbRow>();

  return note ? toPublicNote(note) : null;
}

export async function permanentlyDeleteNote(
  ownerKey: string,
  id: string,
): Promise<boolean> {
  const database = await getNotesDatabase();
  const deleted = await database
    .prepare(PERMANENT_DELETE_NOTE_SQL)
    .bind(id, ownerKey)
    .first<{ id: string }>();

  return deleted?.id === id;
}

function toPublicNote(row: NoteDbRow): PublicNote {
  const summary = parseStoredConversationSummary(
    row.summary_schema_version,
    row.summary_json,
  );
  const stateNote = parseStoredConversationStateNote(
    row.summary_schema_version,
    row.summary_json,
  );
  const contentNote = parseStoredConversationContentNote(
    row.summary_schema_version,
    row.summary_json,
  );
  return {
    id: row.id,
    title: row.title,
    overview: row.overview,
    sections: parseObjectArray(row.sections_json),
    tags: parseStringArray(row.tags_json),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.source_title ? { sourceTitle: row.source_title } : {}),
    ...(row.source_message_count !== null
      ? { sourceMessageCount: row.source_message_count }
      : {}),
    sourceTimelineAt: row.source_timeline_at,
    sourceLastVisibleAt: row.source_last_visible_at,
    sourceTimestampedVisibleMessageCount:
      row.source_timestamped_visible_message_count,
    sourceVisibleMessageCount: row.source_visible_message_count,
    summarySchemaVersion: contentNote
      ? CONTENT_NOTE_SCHEMA_VERSION
      : stateNote
        ? STATE_NOTE_SCHEMA_VERSION
        : summary
          ? SUMMARY_SCHEMA_VERSION
          : null,
    summary,
    stateNote,
    contentNote,
    favorite: Boolean(row.favorite),
    archived: Boolean(row.archived),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertNote(
  ownerKey: string,
  input: CreateNoteInput,
  generationMetadata: NoteImportGenerationMetadata | null,
  generatedSummary: StoredSummaryWrite | null,
  sourceTimeline: StoredSourceTimelineWrite | null,
): Promise<ImportedNoteCreateResult<PublicNote>> {
  const database = await getNotesDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const note = await database
    .prepare(
      `
        INSERT INTO notes (
          id,
          owner_key,
          title,
          overview,
          sections_json,
          tags_json,
          source_url,
          source_title,
          source_message_count,
          source_timeline_at,
          source_last_visible_at,
          source_timestamped_visible_message_count,
          source_visible_message_count,
          generation_metadata_json,
          summary_schema_version,
          summary_json,
          favorite,
          archived,
          deleted_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(owner_key, source_url)
          WHERE source_url IS NOT NULL
          DO NOTHING
        RETURNING ${PUBLIC_NOTE_COLUMNS}
      `,
    )
    .bind(
      id,
      ownerKey,
      input.title,
      input.overview,
      JSON.stringify(input.sections),
      JSON.stringify(input.tags),
      input.sourceUrl,
      input.sourceTitle,
      input.sourceMessageCount,
      sourceTimeline?.sourceTimelineAt ?? null,
      sourceTimeline?.sourceLastVisibleAt ?? null,
      sourceTimeline?.sourceTimestampedVisibleMessageCount ?? null,
      sourceTimeline?.sourceVisibleMessageCount ?? null,
      generationMetadata ? JSON.stringify(generationMetadata) : null,
      generatedSummary?.schemaVersion ?? null,
      generatedSummary ? JSON.stringify(generatedSummary.summary) : null,
      input.favorite ? 1 : 0,
      input.archived ? 1 : 0,
      now,
      now,
    )
    .first<NoteDbRow>();

  if (note) {
    return { note: toPublicNote(note), disposition: "created" };
  }

  if (input.sourceUrl) {
    const existing = await findNoteBySourceUrl(ownerKey, input.sourceUrl);
    if (existing) {
      return { note: existing, disposition: "existing" };
    }
  }

  throw new Error("D1 did not return the created note.");
}

function validateNullableUtcIso(
  value: string | null,
  field: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Imported ${field} must be a nullable UTC ISO timestamp.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Imported ${field} must be a nullable UTC ISO timestamp.`);
  }
  return value;
}

function validateImportedCount(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`Imported ${field} must be a non-negative integer.`);
  }
  return value;
}

function nextUpdatedAt(expectedUpdatedAt: string): string {
  const now = Date.now();
  const expected = Date.parse(expectedUpdatedAt);
  return new Date(
    Number.isFinite(expected) ? Math.max(now, expected + 1) : now,
  ).toISOString();
}

function parseObjectArray(value: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.every(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      )
      ? (parsed as Record<string, unknown>[])
      : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
