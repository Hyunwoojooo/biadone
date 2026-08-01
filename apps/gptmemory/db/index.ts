import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

const CREATE_NOTES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    owner_key TEXT NOT NULL,
    title TEXT NOT NULL,
    overview TEXT NOT NULL DEFAULT '',
    sections_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    source_url TEXT,
    source_title TEXT,
    source_message_count INTEGER,
    generation_metadata_json TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

const CREATE_NOTES_OWNER_VIEW_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS notes_owner_view_updated_idx
  ON notes (owner_key, deleted_at, archived, favorite, updated_at)
`;

const CREATE_NOTES_OWNER_SOURCE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS notes_owner_source_url_unique_idx
  ON notes (owner_key, source_url)
  WHERE source_url IS NOT NULL
`;

type NotesDatabase = NonNullable<typeof env.DB>;

const initializationByDatabase = new WeakMap<object, Promise<void>>();

export class NotesDatabaseUnavailableError extends Error {
  constructor() {
    super("Cloudflare D1 binding `DB` is unavailable.");
    this.name = "NotesDatabaseUnavailableError";
  }
}

export async function getNotesDatabase(): Promise<NotesDatabase> {
  const database = env.DB;
  if (!database) throw new NotesDatabaseUnavailableError();

  await ensureNotesSchema(database);
  return database;
}

// Kept for the opt-in Drizzle example and migration tooling. Runtime notes
// routes use getNotesDatabase() and raw prepared statements.
export function getDb() {
  if (!env.DB) throw new NotesDatabaseUnavailableError();
  return drizzle(env.DB, { schema });
}

async function ensureNotesSchema(database: NotesDatabase): Promise<void> {
  const databaseKey = database as object;
  const existing = initializationByDatabase.get(databaseKey);
  if (existing) {
    await existing;
    return;
  }

  const initialization = initializeNotesSchema(database)
    .catch((error: unknown) => {
      initializationByDatabase.delete(databaseKey);
      throw error;
    });

  initializationByDatabase.set(databaseKey, initialization);
  await initialization;
}

async function initializeNotesSchema(database: NotesDatabase): Promise<void> {
  await database.prepare(CREATE_NOTES_TABLE_SQL).run();

  const columns = await database
    .prepare("PRAGMA table_info(notes)")
    .all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "generation_metadata_json")) {
    try {
      await database
        .prepare("ALTER TABLE notes ADD COLUMN generation_metadata_json TEXT")
        .run();
    } catch (error) {
      // Two fresh isolates can observe the old schema at the same time. A
      // concurrent successful additive migration is safe to accept.
      if (!isDuplicateColumnError(error, "generation_metadata_json")) {
        throw error;
      }
    }
  }

  await database.batch([
    database.prepare(CREATE_NOTES_OWNER_VIEW_INDEX_SQL),
    database.prepare(CREATE_NOTES_OWNER_SOURCE_INDEX_SQL),
  ]);
}

function isDuplicateColumnError(error: unknown, column: string): boolean {
  return (
    error instanceof Error &&
    error.message.toLocaleLowerCase().includes("duplicate column") &&
    error.message.includes(column)
  );
}
