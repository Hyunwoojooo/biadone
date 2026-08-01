import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ApiRequestError,
  parseDeleteNoteMode,
} from "../app/api/notes/_shared.ts";
import { PERMANENT_DELETE_NOTE_SQL } from "../app/api/notes/_sql.ts";

test("keeps bare DELETE soft and requires an explicit permanent=true flag", () => {
  assert.equal(
    parseDeleteNoteMode(new Request("https://example.test/api/notes/id")),
    "soft",
  );
  assert.equal(
    parseDeleteNoteMode(
      new Request("https://example.test/api/notes/id?permanent=true"),
    ),
    "permanent",
  );

  for (const url of [
    "https://example.test/api/notes/id?permanent=false",
    "https://example.test/api/notes/id?permanent=1",
    "https://example.test/api/notes/id?permanent=true&permanent=true",
  ]) {
    assert.throws(
      () => parseDeleteNoteMode(new Request(url)),
      (error: unknown) =>
        error instanceof ApiRequestError &&
        error.code === "INVALID_DELETE_MODE" &&
        error.status === 400,
    );
  }
});

test("production hard-delete SQL only removes the owner's trashed row", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY NOT NULL,
        owner_key TEXT NOT NULL,
        deleted_at TEXT,
        generation_metadata_json TEXT
      )
    `);
    const insert = database.prepare(`
      INSERT INTO notes (id, owner_key, deleted_at, generation_metadata_json)
      VALUES (?, ?, ?, ?)
    `);
    insert.run("active-note", "owner-a", null, '{"runId":"active-run"}');
    insert.run(
      "other-owner-trash",
      "owner-b",
      "2026-08-02T01:00:00.000Z",
      '{"runId":"other-run"}',
    );
    insert.run(
      "owned-trash",
      "owner-a",
      "2026-08-02T02:00:00.000Z",
      '{"runId":"owned-run"}',
    );

    const permanentlyDelete = database.prepare(PERMANENT_DELETE_NOTE_SQL);

    assert.equal(permanentlyDelete.get("active-note", "owner-a"), undefined);
    assert.equal(
      database.prepare("SELECT id FROM notes WHERE id = ?").get("active-note")
        ?.id,
      "active-note",
    );

    assert.equal(
      permanentlyDelete.get("other-owner-trash", "owner-a"),
      undefined,
    );
    assert.equal(
      database
        .prepare("SELECT owner_key FROM notes WHERE id = ?")
        .get("other-owner-trash")?.owner_key,
      "owner-b",
    );

    const before = database
      .prepare(
        "SELECT generation_metadata_json FROM notes WHERE id = ? AND owner_key = ?",
      )
      .get("owned-trash", "owner-a");
    assert.equal(
      before?.generation_metadata_json,
      '{"runId":"owned-run"}',
    );

    const deleted = permanentlyDelete.get("owned-trash", "owner-a");
    assert.equal(deleted?.id, "owned-trash");
    assert.equal(
      database
        .prepare(
          "SELECT id, generation_metadata_json FROM notes WHERE id = ?",
        )
        .get("owned-trash"),
      undefined,
    );
  } finally {
    database.close();
  }
});
