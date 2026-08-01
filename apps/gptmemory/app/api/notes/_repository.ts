import { getNotesDatabase } from "@/db";
import type {
  ImportedNoteCreateResult,
  ImportedNoteWrite,
  NoteImportGenerationMetadata,
} from "@/lib/note-import";

import {
  parseCreateNoteInput,
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

type NoteDbRow = {
  id: string;
  title: string;
  overview: string;
  sections_json: string;
  tags_json: string;
  source_url: string | null;
  source_title: string | null;
  source_message_count: number | null;
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
    )`);
    bindings.push(search, search, search, search, search);
  }

  if (input.tag) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM json_each(notes.tags_json) AS note_tag
      WHERE LOWER(CAST(note_tag.value AS TEXT)) = LOWER(?)
    )`);
    bindings.push(input.tag);
  }

  const query = `
    SELECT ${PUBLIC_NOTE_COLUMNS}
    FROM notes
    WHERE ${conditions.join(" AND ")}
    ORDER BY updated_at DESC, id DESC
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
  return insertNote(ownerKey, input, null);
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
        SELECT 1 AS matches
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
    .first<{ matches: number }>();

  return Boolean(match?.matches);
}

export async function createImportedNote(
  ownerKey: string,
  input: ImportedNoteWrite,
): Promise<ImportedNoteCreateResult<PublicNote>> {
  return insertNote(
    ownerKey,
    validateImportedNoteWrite(input),
    input.generationMetadata,
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
  const updatedAt = nextUpdatedAt(input.expectedUpdatedAt);
  const note = await database
    .prepare(
      `
        UPDATE notes
        SET title = ?,
            overview = ?,
            sections_json = ?,
            tags_json = ?,
            source_url = ?,
            source_title = ?,
            source_message_count = ?,
            generation_metadata_json = ?,
            updated_at = ?
        WHERE id = ?
          AND owner_key = ?
          AND source_url = ?
          AND updated_at = ?
        RETURNING ${PUBLIC_NOTE_COLUMNS}
      `,
    )
    .bind(
      noteInput.title,
      noteInput.overview,
      JSON.stringify(noteInput.sections),
      JSON.stringify(noteInput.tags),
      noteInput.sourceUrl,
      noteInput.sourceTitle,
      noteInput.sourceMessageCount,
      JSON.stringify(input.note.generationMetadata),
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
          generation_metadata_json,
          favorite,
          archived,
          deleted_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
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
      generationMetadata ? JSON.stringify(generationMetadata) : null,
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
