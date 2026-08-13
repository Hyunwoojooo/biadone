import {
  chmod,
  mkdir,
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
import {
  readLocalPrivateText,
  type LocalReadMode
} from "../../localReadMode";
import {
  actionabilityCoverageMatchesTasks,
  githubActionabilityCoverageSchema,
  githubPullRequestActionabilitySchema
} from "./actionabilityContract";
import type { GitHubSnapshot, StoredGitHubTokens } from "./types";

const GITHUB_STORE_BASENAMES = [
  "tokens.json",
  "snapshot.json"
] as const;

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
  updatedAt: z.string().datetime(),
  actionability: githubPullRequestActionabilitySchema.optional()
}).superRefine((task, context) => {
  if (
    task.kind !== "authored_pull_request" &&
    task.actionability !== undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["actionability"],
      message: "Only authored PR tasks can contain actionability."
    });
  }
});

const artifactIdSchema = z
  .string()
  .regex(/^artifact_[a-f0-9]{32}$/);

const legacyActivitySchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z.literal("github"),
    kind: z.literal("user_activity"),
    activityKind: z.enum([
      "push",
      "ref_created",
      "ref_deleted",
      "issue_opened",
      "issue_closed",
      "issue_reopened",
      "issue_commented",
      "pull_request_opened",
      "pull_request_closed",
      "pull_request_reopened",
      "pull_request_merged",
      "pull_request_reviewed",
      "pull_request_review_commented"
    ]),
    repositoryId: z.number().int().positive(),
    repositoryFullName: z.string().min(1),
    occurredAt: z.string().datetime(),
    subjectType: z.enum([
      "repository",
      "branch",
      "tag",
      "issue",
      "pull_request"
    ]),
    subjectNumber: z.number().int().positive().nullable(),
    subjectTitle: z.string().nullable(),
    refName: z.string().nullable(),
    reviewState: z
      .enum(["approved", "changes_requested", "commented"])
      .nullable()
  })
  .strict();

const activityV4Schema = legacyActivitySchema
  .extend({ artifactId: artifactIdSchema.nullable() })
  .superRefine((activity, context) => {
    if (
      (activity.activityKind === "push") !==
      (activity.artifactId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactId"],
        message:
          "GitHub v4 pushes require an opaque artifact ID and other activities require null."
      });
    }
  });

const activityV5Schema = legacyActivitySchema
  .extend({
    artifactId: artifactIdSchema.nullable(),
    subjectObjectId: z.number().int().safe().positive().nullable()
  })
  .superRefine((activity, context) => {
    if (
      (activity.activityKind === "push") !==
      (activity.artifactId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactId"],
        message:
          "GitHub v5 pushes require an opaque artifact ID and other activities require null."
      });
    }
    const hasWorkItemSubject =
      activity.subjectType === "issue" ||
      activity.subjectType === "pull_request";
    if (
      hasWorkItemSubject !== (activity.subjectObjectId !== null) ||
      hasWorkItemSubject !== (activity.subjectNumber !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subjectObjectId"],
        message:
          "GitHub v5 work-item activity requires an exact native object ID and number."
      });
    }
  });

const snapshotV1Schema = z.object({
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

const snapshotV2BaseSchema = snapshotV1Schema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal("github-snapshot-v2"),
    activityWindowStart: z.string().datetime(),
    activitiesState: z.enum([
      "available",
      "partial",
      "unavailable"
    ]),
    activitiesTruncated: z.boolean(),
    activities: z.array(legacyActivitySchema)
  });

const snapshotV2Schema = snapshotV2BaseSchema.superRefine(
  (snapshot, context) => {
    if (snapshot.tasks.some((task) => task.actionability !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tasks"],
        message: "GitHub v2 snapshots cannot contain v3 actionability facts."
      });
    }
  }
);

const snapshotV3Schema = snapshotV2BaseSchema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal("github-snapshot-v3"),
    actionabilityCoverage: githubActionabilityCoverageSchema
  })
  .superRefine((snapshot, context) => {
    if (
      !actionabilityCoverageMatchesTasks(
        snapshot.actionabilityCoverage,
        snapshot.tasks
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionabilityCoverage"],
        message: "GitHub actionability coverage must match collected PR facts."
      });
    }
  });

const snapshotV4Schema = snapshotV2BaseSchema
  .omit({ schemaVersion: true, activities: true })
  .extend({
    schemaVersion: z.literal("github-snapshot-v4"),
    actionabilityCoverage: githubActionabilityCoverageSchema,
    activities: z.array(activityV4Schema)
  })
  .superRefine((snapshot, context) => {
    if (
      !actionabilityCoverageMatchesTasks(
        snapshot.actionabilityCoverage,
        snapshot.tasks
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionabilityCoverage"],
        message: "GitHub actionability coverage must match collected PR facts."
      });
    }
  });

const snapshotV5Schema = snapshotV2BaseSchema
  .omit({ schemaVersion: true, activities: true })
  .extend({
    schemaVersion: z.literal("github-snapshot-v5"),
    actionabilityCoverage: githubActionabilityCoverageSchema,
    activities: z.array(activityV5Schema)
  })
  .superRefine((snapshot, context) => {
    if (
      !actionabilityCoverageMatchesTasks(
        snapshot.actionabilityCoverage,
        snapshot.tasks
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionabilityCoverage"],
        message: "GitHub actionability coverage must match collected PR facts."
      });
    }
  });

const snapshotV6Schema = snapshotV2BaseSchema
  .omit({ schemaVersion: true, activities: true })
  .extend({
    schemaVersion: z.literal("github-snapshot-v6"),
    actionabilityCoverage: githubActionabilityCoverageSchema,
    activities: z.array(activityV5Schema)
  })
  .superRefine((snapshot, context) => {
    if (
      !actionabilityCoverageMatchesTasks(
        snapshot.actionabilityCoverage,
        snapshot.tasks
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionabilityCoverage"],
        message: "GitHub actionability coverage must match collected PR facts."
      });
    }
  });

const snapshotSchema = z.union([
  snapshotV6Schema,
  snapshotV5Schema,
  snapshotV4Schema,
  snapshotV3Schema,
  snapshotV2Schema
]);

const storedSnapshotSchema = z.union([
  snapshotV6Schema,
  snapshotV5Schema,
  snapshotV4Schema,
  snapshotV3Schema,
  snapshotV2Schema,
  snapshotV1Schema
]);

const mutationTails = new Map<string, Promise<void>>();
const storeGenerations = new Map<string, number>();

export function githubLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "github");
}

export async function readStoredGitHubTokens(
  cwd = process.cwd(),
  mode: LocalReadMode = "maintain"
): Promise<StoredGitHubTokens | null> {
  if (mode === "maintain") {
    await cleanupStaleGitHubTempFiles(cwd, true);
  }
  try {
    const text = await readLocalPrivateText(
      join(githubLocalDirectory(cwd), "tokens.json"),
      mode,
      cwd
    );
    return tokensSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredGitHubTokens(
  tokens: StoredGitHubTokens,
  cwd = process.cwd(),
  expectedGeneration = githubStoreGeneration(cwd)
): Promise<void> {
  await withGitHubStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await writePrivateJson("tokens.json", tokensSchema.parse(tokens), cwd);
  });
}

/**
 * Starts a new logical GitHub connection generation.
 *
 * The generation changes before this mutation waits for older store writes.
 * Therefore, an in-flight sync that captured the previous generation can no
 * longer publish refreshed credentials or a snapshot after this transition.
 * The old snapshot is removed before the replacement credentials become
 * visible, so status readers never intentionally reuse it for the new OAuth
 * grant.
 */
export async function replaceStoredGitHubConnection(
  tokens: StoredGitHubTokens,
  cwd = process.cwd()
): Promise<void> {
  const parsed = tokensSchema.parse(tokens);
  const replacementGeneration = githubStoreGeneration(cwd) + 1;
  storeGenerations.set(cwd, replacementGeneration);

  await withGitHubStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, replacementGeneration);
    await deleteIfPresent(
      join(githubLocalDirectory(cwd), "snapshot.json")
    );
    await deleteIfPresent(
      join(githubLocalDirectory(cwd), "tokens.json")
    );
    assertCurrentGeneration(cwd, replacementGeneration);
    await writePrivateJson("tokens.json", parsed, cwd);
  });
}

export async function deleteStoredGitHubTokens(
  cwd = process.cwd()
): Promise<void> {
  await withGitHubStoreMutation(cwd, async () => {
    await deleteIfPresent(
      join(githubLocalDirectory(cwd), "tokens.json")
    );
  });
}

export async function readStoredGitHubSnapshot(
  cwd = process.cwd(),
  mode: LocalReadMode = "maintain"
): Promise<GitHubSnapshot | null> {
  if (mode === "maintain") {
    await cleanupStaleGitHubTempFiles(cwd, true);
  }
  try {
    const text = await readLocalPrivateText(
      join(githubLocalDirectory(cwd), "snapshot.json"),
      mode,
      cwd
    );
    const snapshot = storedSnapshotSchema.parse(JSON.parse(text));
    return snapshot.schemaVersion === "github-snapshot-v1"
      ? migrateV1Snapshot(snapshot)
      : snapshot;
  } catch {
    return null;
  }
}

export async function writeStoredGitHubSnapshot(
  snapshot: GitHubSnapshot,
  cwd = process.cwd(),
  expectedGeneration = githubStoreGeneration(cwd)
): Promise<GitHubSnapshot> {
  return withGitHubStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    const parsed = snapshotSchema.parse(snapshot);
    const current = await readStoredGitHubSnapshot(cwd);
    if (
      current &&
      Date.parse(current.fetchedAt) >= Date.parse(parsed.fetchedAt)
    ) {
      return current;
    }
    await writePrivateJson("snapshot.json", parsed, cwd);
    return parsed;
  });
}

export async function deleteStoredGitHubSnapshot(
  cwd = process.cwd()
): Promise<void> {
  await withGitHubStoreMutation(cwd, async () => {
    await deleteIfPresent(
      join(githubLocalDirectory(cwd), "snapshot.json")
    );
  });
}

export async function deleteStoredGitHubConnection(
  cwd = process.cwd()
): Promise<void> {
  storeGenerations.set(cwd, githubStoreGeneration(cwd) + 1);
  await withGitHubStoreMutation(cwd, async () => {
    await Promise.all([
      deleteIfPresent(join(githubLocalDirectory(cwd), "tokens.json")),
      deleteIfPresent(join(githubLocalDirectory(cwd), "snapshot.json"))
    ]);
    await cleanupStaleGitHubTempFiles(cwd, false);
  });
}

export function githubStoreGeneration(
  cwd = process.cwd()
): number {
  return storeGenerations.get(cwd) ?? 0;
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

async function cleanupStaleGitHubTempFiles(
  cwd: string,
  bestEffort: boolean
): Promise<void> {
  const cleanup = cleanupStaleConnectorTempFiles({
    directory: githubLocalDirectory(cwd),
    canonicalBasenames: GITHUB_STORE_BASENAMES,
    removeFresh: !bestEffort
  });
  if (bestEffort) {
    await cleanup.catch(() => undefined);
    return;
  }
  await cleanup;
}

function migrateV1Snapshot(
  snapshot: z.infer<typeof snapshotV1Schema>
): GitHubSnapshot {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  const activityWindowStart = new Date(
    fetchedAt - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    ...snapshot,
    schemaVersion: "github-snapshot-v2",
    activityWindowStart,
    activitiesState: "unavailable",
    activitiesTruncated: false,
    activities: []
  };
}

function assertCurrentGeneration(
  cwd: string,
  expectedGeneration: number
): void {
  if (githubStoreGeneration(cwd) !== expectedGeneration) {
    throw new Error("GitHub connector state changed during operation.");
  }
}

async function withGitHubStoreMutation<T>(
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
