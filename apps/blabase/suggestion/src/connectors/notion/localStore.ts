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
import type { NotionSnapshot, StoredNotionTokens } from "./types";

const NOTION_STORE_BASENAMES = [
  "tokens.json",
  "snapshot.json"
] as const;

const tokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.string().min(1),
  botId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().nullable()
});

const resourceSchema = z.object({
  id: z.string().min(1),
  source: z.literal("notion"),
  kind: z.enum(["page", "data_source"]),
  title: z.string(),
  createdAt: z.string().datetime(),
  lastEditedAt: z.string().datetime()
});

const snapshotSchema = z.object({
  schemaVersion: z.literal("notion-snapshot-v1"),
  apiVersion: z.string().min(1),
  fetchedAt: z.string().datetime(),
  workspaceId: z.string().min(1),
  workspaceName: z.string().nullable(),
  truncated: z.boolean(),
  resources: z.array(resourceSchema)
});

const mutationTails = new Map<string, Promise<void>>();
const storeGenerations = new Map<string, number>();

export function notionLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "notion");
}

export async function readStoredNotionTokens(
  cwd = process.cwd()
): Promise<StoredNotionTokens | null> {
  await cleanupStaleNotionTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(notionLocalDirectory(cwd), "tokens.json"),
      "utf8"
    );
    return tokensSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredNotionTokens(
  tokens: StoredNotionTokens,
  cwd = process.cwd(),
  expectedGeneration = notionStoreGeneration(cwd)
): Promise<void> {
  await withNotionStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await writePrivateJson(
      "tokens.json",
      tokensSchema.parse(tokens),
      cwd
    );
  });
}

/**
 * Starts a new logical Notion workspace connection and invalidates every
 * writer that captured the previous generation. The prior workspace snapshot
 * is removed before replacement credentials become visible.
 */
export async function replaceStoredNotionConnection(
  tokens: StoredNotionTokens,
  cwd = process.cwd()
): Promise<void> {
  const parsed = tokensSchema.parse(tokens);
  const replacementGeneration = notionStoreGeneration(cwd) + 1;
  storeGenerations.set(cwd, replacementGeneration);

  await withNotionStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, replacementGeneration);
    await deleteIfPresent(
      join(notionLocalDirectory(cwd), "snapshot.json")
    );
    await deleteIfPresent(
      join(notionLocalDirectory(cwd), "tokens.json")
    );
    assertCurrentGeneration(cwd, replacementGeneration);
    await writePrivateJson("tokens.json", parsed, cwd);
  });
}

export async function deleteStoredNotionTokens(
  cwd = process.cwd()
): Promise<void> {
  await withNotionStoreMutation(cwd, async () => {
    await deleteIfPresent(
      join(notionLocalDirectory(cwd), "tokens.json")
    );
  });
}

export async function readStoredNotionSnapshot(
  cwd = process.cwd()
): Promise<NotionSnapshot | null> {
  await cleanupStaleNotionTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(notionLocalDirectory(cwd), "snapshot.json"),
      "utf8"
    );
    return snapshotSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredNotionSnapshot(
  snapshot: NotionSnapshot,
  cwd = process.cwd(),
  expectedGeneration = notionStoreGeneration(cwd)
): Promise<void> {
  await withNotionStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await writePrivateJson(
      "snapshot.json",
      snapshotSchema.parse(snapshot),
      cwd
    );
  });
}

export async function deleteStoredNotionSnapshot(
  cwd = process.cwd()
): Promise<void> {
  await withNotionStoreMutation(cwd, async () => {
    await deleteIfPresent(
      join(notionLocalDirectory(cwd), "snapshot.json")
    );
  });
}

export async function deleteStoredNotionConnection(
  cwd = process.cwd()
): Promise<void> {
  storeGenerations.set(cwd, notionStoreGeneration(cwd) + 1);
  await withNotionStoreMutation(cwd, async () => {
    await Promise.all([
      deleteIfPresent(join(notionLocalDirectory(cwd), "tokens.json")),
      deleteIfPresent(
        join(notionLocalDirectory(cwd), "snapshot.json")
      )
    ]);
    await cleanupStaleNotionTempFiles(cwd, false);
  });
}

export function notionStoreGeneration(cwd = process.cwd()): number {
  return storeGenerations.get(cwd) ?? 0;
}

export function notionSnapshotMatchesTokens(
  snapshot: NotionSnapshot,
  tokens: StoredNotionTokens
): boolean {
  return snapshot.workspaceId === tokens.workspaceId;
}

async function writePrivateJson(
  filename: string,
  value: unknown,
  cwd: string
): Promise<void> {
  const directory = notionLocalDirectory(cwd);
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

async function cleanupStaleNotionTempFiles(
  cwd: string,
  bestEffort: boolean
): Promise<void> {
  const cleanup = cleanupStaleConnectorTempFiles({
    directory: notionLocalDirectory(cwd),
    canonicalBasenames: NOTION_STORE_BASENAMES,
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
  if (notionStoreGeneration(cwd) !== expectedGeneration) {
    throw new Error(
      "Notion connector state changed during operation."
    );
  }
}

async function withNotionStoreMutation<T>(
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
