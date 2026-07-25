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

import type { NotionSnapshot, StoredNotionTokens } from "./types";

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

export function notionLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "notion");
}

export async function readStoredNotionTokens(
  cwd = process.cwd()
): Promise<StoredNotionTokens | null> {
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
  cwd = process.cwd()
): Promise<void> {
  await writePrivateJson("tokens.json", tokens, cwd);
}

export async function deleteStoredNotionTokens(
  cwd = process.cwd()
): Promise<void> {
  await deleteIfPresent(join(notionLocalDirectory(cwd), "tokens.json"));
}

export async function readStoredNotionSnapshot(
  cwd = process.cwd()
): Promise<NotionSnapshot | null> {
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
  cwd = process.cwd()
): Promise<void> {
  await writePrivateJson("snapshot.json", snapshot, cwd);
}

export async function deleteStoredNotionSnapshot(
  cwd = process.cwd()
): Promise<void> {
  await deleteIfPresent(join(notionLocalDirectory(cwd), "snapshot.json"));
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
