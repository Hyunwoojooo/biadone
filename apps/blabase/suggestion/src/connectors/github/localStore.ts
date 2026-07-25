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

import type { GitHubSnapshot, StoredGitHubTokens } from "./types";

const tokensSchema = z.object({
  appClientId: z.string().min(1),
  appSlug: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  refreshTokenExpiresAt: z.string().datetime(),
  tokenType: z.string().min(1),
  scope: z.string()
});

const installationSchema = z.object({
  id: z.number().int().positive(),
  accountLogin: z.string().min(1),
  accountType: z.enum(["User", "Organization"]),
  repositorySelection: z.enum(["all", "selected"]),
  suspended: z.boolean()
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  source: z.literal("github"),
  kind: z.literal("repository"),
  installationId: z.number().int().positive(),
  fullName: z.string().min(1),
  private: z.boolean(),
  archived: z.boolean(),
  updatedAt: z.string().datetime()
});

const taskSchema = z.object({
  id: z.number().int().positive(),
  source: z.literal("github"),
  kind: z.enum([
    "assigned_issue",
    "review_requested_pull_request",
    "authored_pull_request"
  ]),
  repositoryId: z.number().int().positive(),
  repositoryFullName: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  htmlUrl: z.string().url(),
  labelNames: z.array(z.string()),
  milestoneDueAt: z.string().datetime().nullable(),
  state: z.literal("open"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const snapshotSchema = z.object({
  schemaVersion: z.literal("github-snapshot-v1"),
  appClientId: z.string().min(1),
  appSlug: z.string().min(1),
  apiVersion: z.string().min(1),
  fetchedAt: z.string().datetime(),
  user: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1)
  }),
  truncated: z.boolean(),
  installations: z.array(installationSchema),
  repositories: z.array(repositorySchema),
  tasks: z.array(taskSchema)
});

export function githubLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "github");
}

export async function readStoredGitHubTokens(
  cwd = process.cwd()
): Promise<StoredGitHubTokens | null> {
  try {
    const text = await readFile(
      join(githubLocalDirectory(cwd), "tokens.json"),
      "utf8"
    );
    return tokensSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredGitHubTokens(
  tokens: StoredGitHubTokens,
  cwd = process.cwd()
): Promise<void> {
  await writePrivateJson("tokens.json", tokens, cwd);
}

export async function deleteStoredGitHubTokens(
  cwd = process.cwd()
): Promise<void> {
  await deleteIfPresent(join(githubLocalDirectory(cwd), "tokens.json"));
}

export async function readStoredGitHubSnapshot(
  cwd = process.cwd()
): Promise<GitHubSnapshot | null> {
  try {
    const text = await readFile(
      join(githubLocalDirectory(cwd), "snapshot.json"),
      "utf8"
    );
    return snapshotSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredGitHubSnapshot(
  snapshot: GitHubSnapshot,
  cwd = process.cwd()
): Promise<void> {
  await writePrivateJson("snapshot.json", snapshot, cwd);
}

export async function deleteStoredGitHubSnapshot(
  cwd = process.cwd()
): Promise<void> {
  await deleteIfPresent(join(githubLocalDirectory(cwd), "snapshot.json"));
}

async function writePrivateJson(
  filename: string,
  value: unknown,
  cwd: string
): Promise<void> {
  const directory = githubLocalDirectory(cwd);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const target = join(directory, filename);
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString(
    "hex"
  )}.tmp`;
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
