import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type {
  GoogleCalendarSnapshot,
  StoredGoogleCalendarTokens
} from "./types";

const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  scope: z.string(),
  tokenType: z.string()
});

const snapshotSchema = z.object({
  schemaVersion: z.literal("google-calendar-snapshot-v1"),
  fetchedAt: z.string().datetime(),
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
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

export function googleCalendarLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "google-calendar");
}

export async function readStoredTokens(
  cwd = process.cwd()
): Promise<StoredGoogleCalendarTokens | null> {
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
  cwd = process.cwd()
): Promise<void> {
  await writePrivateJson("tokens.json", tokens, cwd);
}

export async function deleteStoredTokens(cwd = process.cwd()): Promise<void> {
  await deleteIfPresent(
    join(googleCalendarLocalDirectory(cwd), "tokens.json")
  );
}

export async function readStoredSnapshot(
  cwd = process.cwd()
): Promise<GoogleCalendarSnapshot | null> {
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
  cwd = process.cwd()
): Promise<void> {
  await writePrivateJson("snapshot.json", snapshot, cwd);
}

export async function deleteStoredSnapshot(cwd = process.cwd()): Promise<void> {
  await deleteIfPresent(
    join(googleCalendarLocalDirectory(cwd), "snapshot.json")
  );
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
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
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
