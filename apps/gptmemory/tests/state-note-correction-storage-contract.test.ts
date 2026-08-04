import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

test("correction PATCH remains owner scoped and protected from stale writes", async () => {
  const repositorySource = await readFile(
    new URL("app/api/notes/_repository.ts", appRoot),
    "utf8",
  );
  const correctionUpdate = repositorySource.match(
    /async function patchStateNoteCorrection[\s\S]*?UPDATE notes([\s\S]*?)RETURNING \$\{PUBLIC_NOTE_COLUMNS\}/,
  )?.[1];
  assert.ok(correctionUpdate, "correction UPDATE should be discoverable");

  assert.match(correctionUpdate, /SET summary_json = \?, updated_at = \?/);
  assert.match(correctionUpdate, /WHERE id = \?/);
  assert.match(correctionUpdate, /AND owner_key = \?/);
  assert.match(correctionUpdate, /AND summary_schema_version = \?/);
  assert.match(correctionUpdate, /AND updated_at = \?/);
  for (const generatedOrLegacyColumn of [
    "title",
    "overview",
    "sections_json",
    "tags_json",
    "source_url",
    "source_title",
    "source_message_count",
    "favorite",
    "archived",
    "deleted_at",
    "created_at",
  ]) {
    assert.doesNotMatch(
      correctionUpdate,
      new RegExp(`^\\s*${generatedOrLegacyColumn}\\s*=`, "m"),
    );
  }
});
test("note PATCH route validates correction payload before repository access", async () => {
  const routeSource = await readFile(
    new URL("app/api/notes/[id]/route.ts", appRoot),
    "utf8",
  );
  const parseIndex = routeSource.indexOf("parsePatchNoteInput(");
  const patchIndex = routeSource.indexOf("patchNote(ownerKey, id, patch)");
  assert.ok(parseIndex >= 0);
  assert.ok(patchIndex > parseIndex);
});

test("reimport refuses to discard persisted v3 user corrections", async () => {
  const repositorySource = await readFile(
    new URL("app/api/notes/_repository.ts", appRoot),
    "utf8",
  );
  const replacementGuard = repositorySource.match(
    /export async function hasReplacementCandidate[\s\S]*?return true;/,
  )?.[0];
  assert.ok(replacementGuard, "replacement guard should be discoverable");
  assert.match(replacementGuard, /summary_schema_version, summary_json/);
  assert.match(replacementGuard, /parseStoredConversationStateNote/);
  assert.match(replacementGuard, /stateNote\?\.userCorrections\?\.length/);
  assert.match(replacementGuard, /REIMPORT_BLOCKED_BY_USER_CORRECTIONS/);
});
