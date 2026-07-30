import { getNotesDatabase } from "@/db";

import type {
  CreateNoteInput,
  ListNotesInput,
  PatchNoteInput,
  PublicNote,
} from "./_shared";

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
): Promise<PublicNote> {
  const database = await getNotesDatabase();
  if (input.sourceUrl) {
    const existing = await database
      .prepare(
        `
          SELECT ${PUBLIC_NOTE_COLUMNS}
          FROM notes
          WHERE owner_key = ? AND source_url = ?
          LIMIT 1
        `,
      )
      .bind(ownerKey, input.sourceUrl)
      .first<NoteDbRow>();
    if (existing) return toPublicNote(existing);
  }

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
          favorite,
          archived,
          deleted_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
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
      input.favorite ? 1 : 0,
      input.archived ? 1 : 0,
      now,
      now,
    )
    .first<NoteDbRow>();

  if (!note) throw new Error("D1 did not return the created note.");
  return toPublicNote(note);
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
  if (patch.sourceUrl !== undefined) {
    assignments.push("source_url = ?");
    bindings.push(patch.sourceUrl);
  }
  if (patch.sourceTitle !== undefined) {
    assignments.push("source_title = ?");
    bindings.push(patch.sourceTitle);
  }
  if (patch.sourceMessageCount !== undefined) {
    assignments.push("source_message_count = ?");
    bindings.push(patch.sourceMessageCount);
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
