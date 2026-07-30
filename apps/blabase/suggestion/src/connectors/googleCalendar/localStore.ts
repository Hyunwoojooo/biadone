import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { z } from "zod";

import {
  cleanupStaleConnectorTempFiles,
  withActiveConnectorTempFile
} from "../localTempCleanup";
import type {
  GoogleCalendarSnapshot,
  StoredGoogleCalendarTokens
} from "./types";

const GOOGLE_CALENDAR_STORE_BASENAMES = [
  "tokens.json",
  "snapshot.json"
] as const;

export const LEGACY_GOOGLE_CALENDAR_SCOPE_ID =
  "calendar_scope_legacy_unidentified" as const;

const connectionScopeIdSchema = z
  .string()
  .regex(/^calendar_scope_[a-f0-9]{32}$/);
const snapshotConnectionScopeIdSchema = z.union([
  connectionScopeIdSchema,
  z.literal(LEGACY_GOOGLE_CALENDAR_SCOPE_ID)
]);

const tokensSchema = z.object({
  connectionScopeId: connectionScopeIdSchema.optional(),
  accessToken: z.string(),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  scope: z.string(),
  tokenType: z.string()
});

const snapshotSchema = z.object({
  schemaVersion: z.literal("google-calendar-snapshot-v1"),
  connectionScopeId: snapshotConnectionScopeIdSchema.optional(),
  fetchedAt: z.string().datetime(),
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
  truncated: z.boolean().optional().default(false),
  events: z.array(
    z.object({
      id: z.string(),
      source: z.literal("google_calendar"),
      kind: z.literal("calendar_event"),
      title: z.string(),
      status: z.enum(["confirmed", "tentative", "cancelled"]),
      startAt: z.string(),
      endAt: z.string(),
      allDay: z.boolean(),
      recurringEventId: z.string().nullable(),
      eventType: z.string(),
      updatedAt: z.string()
    })
  )
});

const mutationTails = new Map<string, Promise<void>>();
const storeGenerations = new Map<string, number>();

export function googleCalendarLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "google-calendar");
}

export async function readStoredTokens(
  cwd = process.cwd()
): Promise<StoredGoogleCalendarTokens | null> {
  await cleanupStaleGoogleCalendarTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(googleCalendarLocalDirectory(cwd), "tokens.json"),
      "utf8"
    );
    return tokensSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredTokens(
  tokens: StoredGoogleCalendarTokens,
  cwd = process.cwd(),
  expectedGeneration = googleCalendarStoreGeneration(cwd)
): Promise<void> {
  await withGoogleCalendarStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await writePrivateJson(
      "tokens.json",
      tokensSchema.parse(tokens),
      cwd
    );
  });
}

/**
 * Replaces an OAuth connection without allowing the previous account's
 * in-flight collection to publish afterward.
 *
 * The random connection scope is intentionally unrelated to Google account
 * data or OAuth secrets. Clearing the prior snapshot before exposing the new
 * scope prevents project mappings from crossing an account replacement.
 */
export async function replaceStoredGoogleCalendarConnection(
  tokens: StoredGoogleCalendarTokens,
  cwd = process.cwd()
): Promise<StoredGoogleCalendarTokens> {
  const parsed = tokensSchema.parse({
    ...tokens,
    connectionScopeId: createGoogleCalendarConnectionScopeId()
  });
  const replacementGeneration =
    googleCalendarStoreGeneration(cwd) + 1;
  storeGenerations.set(cwd, replacementGeneration);

  await withGoogleCalendarStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, replacementGeneration);
    await deleteIfPresent(
      join(googleCalendarLocalDirectory(cwd), "snapshot.json")
    );
    await deleteIfPresent(
      join(googleCalendarLocalDirectory(cwd), "tokens.json")
    );
    assertCurrentGeneration(cwd, replacementGeneration);
    await writePrivateJson("tokens.json", parsed, cwd);
  });
  return parsed;
}

export async function deleteStoredTokens(cwd = process.cwd()): Promise<void> {
  await withGoogleCalendarStoreMutation(cwd, async () => {
    await deleteIfPresent(
      join(googleCalendarLocalDirectory(cwd), "tokens.json")
    );
  });
}

export async function readStoredSnapshot(
  cwd = process.cwd()
): Promise<GoogleCalendarSnapshot | null> {
  await cleanupStaleGoogleCalendarTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(googleCalendarLocalDirectory(cwd), "snapshot.json"),
      "utf8"
    );
    return snapshotSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredSnapshot(
  snapshot: GoogleCalendarSnapshot,
  cwd = process.cwd(),
  expectedGeneration = googleCalendarStoreGeneration(cwd)
): Promise<void> {
  await withGoogleCalendarStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await writePrivateJson(
      "snapshot.json",
      snapshotSchema.parse(snapshot),
      cwd
    );
  });
}

export async function deleteStoredSnapshot(cwd = process.cwd()): Promise<void> {
  await withGoogleCalendarStoreMutation(cwd, async () => {
    await deleteIfPresent(
      join(googleCalendarLocalDirectory(cwd), "snapshot.json")
    );
  });
}

export async function deleteStoredGoogleCalendarConnection(
  cwd = process.cwd()
): Promise<void> {
  storeGenerations.set(
    cwd,
    googleCalendarStoreGeneration(cwd) + 1
  );
  await withGoogleCalendarStoreMutation(cwd, async () => {
    await Promise.all([
      deleteIfPresent(
        join(googleCalendarLocalDirectory(cwd), "tokens.json")
      ),
      deleteIfPresent(
        join(googleCalendarLocalDirectory(cwd), "snapshot.json")
      )
    ]);
    await cleanupStaleGoogleCalendarTempFiles(cwd, false);
  });
}

export function googleCalendarStoreGeneration(
  cwd = process.cwd()
): number {
  return storeGenerations.get(cwd) ?? 0;
}

export function googleCalendarConnectionScopeId(
  tokens: StoredGoogleCalendarTokens
): string {
  return (
    tokens.connectionScopeId ?? LEGACY_GOOGLE_CALENDAR_SCOPE_ID
  );
}

export function googleCalendarSnapshotScopeId(
  snapshot: GoogleCalendarSnapshot
): string {
  return (
    snapshot.connectionScopeId ?? LEGACY_GOOGLE_CALENDAR_SCOPE_ID
  );
}

export function googleCalendarSnapshotMatchesTokens(
  snapshot: GoogleCalendarSnapshot,
  tokens: StoredGoogleCalendarTokens
): boolean {
  return (
    googleCalendarSnapshotScopeId(snapshot) ===
    googleCalendarConnectionScopeId(tokens)
  );
}

function createGoogleCalendarConnectionScopeId(): string {
  return `calendar_scope_${randomBytes(16).toString("hex")}`;
}

async function writePrivateJson(
  filename: string,
  value: unknown,
  cwd: string
): Promise<void> {
  const directory = googleCalendarLocalDirectory(cwd);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const target = join(directory, filename);
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString(
    "hex"
  )}.tmp`;
  await withActiveConnectorTempFile(temporary, async () => {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  });
}

async function deleteIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

async function cleanupStaleGoogleCalendarTempFiles(
  cwd: string,
  bestEffort: boolean
): Promise<void> {
  const cleanup = cleanupStaleConnectorTempFiles({
    directory: googleCalendarLocalDirectory(cwd),
    canonicalBasenames: GOOGLE_CALENDAR_STORE_BASENAMES,
    removeFresh: !bestEffort
  });
  if (bestEffort) {
    await cleanup.catch(() => undefined);
    return;
  }
  await cleanup;
}

function assertCurrentGeneration(
  cwd: string,
  expectedGeneration: number
): void {
  if (googleCalendarStoreGeneration(cwd) !== expectedGeneration) {
    throw new Error(
      "Google Calendar connector state changed during operation."
    );
  }
}

async function withGoogleCalendarStoreMutation<T>(
  cwd: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = mutationTails.get(cwd) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  mutationTails.set(cwd, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (mutationTails.get(cwd) === tail) {
      mutationTails.delete(cwd);
    }
  }
}
