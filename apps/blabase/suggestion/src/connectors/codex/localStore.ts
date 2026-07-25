import { randomBytes } from "node:crypto";
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
  CodexSnapshot,
  StoredCodexConfig
} from "./types";

const scopeSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  queryPath: z.string().min(1),
  label: z.string().min(1).max(120),
  sessionCount: z.number().int().nonnegative(),
  lastActivityAt: z.string().datetime()
});

const configSchema = z
  .object({
    schemaVersion: z.literal("codex-connector-config-v2"),
    installationSecret: z.string().regex(/^[a-f0-9]{64}$/),
    selectedScopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)),
    scopes: z.array(scopeSchema),
    contentMode: z.enum(["metadata_only", "activity_summary"]),
    contentConsentAt: z.string().datetime().nullable(),
    discoveredAt: z.string().datetime()
  })
  .superRefine((config, context) => {
    const consentMatchesMode =
      config.contentMode === "activity_summary"
        ? config.contentConsentAt !== null
        : config.contentConsentAt === null;
    if (!consentMatchesMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentConsentAt"],
        message: "Codex content consent does not match content mode."
      });
    }
  });

const legacyConfigSchema = z.object({
  schemaVersion: z.literal("codex-connector-config-v1"),
  installationSecret: z.string().regex(/^[a-f0-9]{64}$/),
  selectedScopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)),
  scopes: z.array(scopeSchema),
  discoveredAt: z.string().datetime()
});

const sessionSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  source: z.literal("codex"),
  kind: z.literal("coding_session"),
  scopeId: z.string().regex(/^[a-f0-9]{24}$/),
  projectLabel: z.string().min(1).max(120),
  taskSummary: z.string().min(1).max(200).nullable(),
  taskSummarySource: z
    .enum(["thread_name", "first_user_request"])
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activityState: z.enum([
    "active",
    "idle",
    "not_loaded",
    "system_error",
    "unknown"
  ]),
  attentionState: z
    .enum(["waiting_on_approval", "waiting_on_user_input"])
    .nullable()
});

const legacySessionSchema = sessionSchema.omit({
  taskSummary: true,
  taskSummarySource: true
});

const snapshotSchema = z
  .object({
    schemaVersion: z.literal("codex-snapshot-v2"),
    collectorVersion: z.enum([
      "codex-app-server-metadata-v1",
      "codex-app-server-activity-summary-v1"
    ]),
    contentMode: z.enum(["metadata_only", "activity_summary"]),
    codexVersion: z.string().min(1).max(120),
    fetchedAt: z.string().datetime(),
    lookbackStart: z.string().datetime(),
    truncated: z.boolean(),
    scopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1),
    sessions: z.array(sessionSchema)
  })
  .superRefine((snapshot, context) => {
    snapshot.sessions.forEach((session, index) => {
      const summaryFieldsMatch =
        (session.taskSummary === null) ===
        (session.taskSummarySource === null);
      if (
        !summaryFieldsMatch ||
        (snapshot.contentMode === "metadata_only" &&
          session.taskSummary !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "taskSummary"],
          message: "Codex task summary does not match content mode."
        });
      }
    });
  });

const legacySnapshotSchema = z.object({
  schemaVersion: z.literal("codex-snapshot-v1"),
  collectorVersion: z.literal("codex-app-server-metadata-v1"),
  contentMode: z.literal("metadata_only"),
  codexVersion: z.string().min(1).max(120),
  fetchedAt: z.string().datetime(),
  lookbackStart: z.string().datetime(),
  truncated: z.boolean(),
  scopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1),
  sessions: z.array(legacySessionSchema)
});

const mutationTails = new Map<string, Promise<void>>();
const storeGenerations = new Map<string, number>();

export function codexLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "codex");
}

export async function readStoredCodexConfig(
  cwd = process.cwd()
): Promise<StoredCodexConfig | null> {
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "config.json"),
      "utf8"
    );
    const value: unknown = JSON.parse(text);
    const current = configSchema.safeParse(value);
    if (current.success) return current.data;
    const legacy = legacyConfigSchema.parse(value);
    return {
      ...legacy,
      schemaVersion: "codex-connector-config-v2",
      contentMode: "metadata_only",
      contentConsentAt: null
    };
  } catch {
    return null;
  }
}

export async function writeStoredCodexConfig(
  config: StoredCodexConfig,
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd)
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await writePrivateJson(
      "config.json",
      configSchema.parse(config),
      cwd
    );
  });
}

export async function transitionStoredCodexConfig(
  previousConfig: StoredCodexConfig,
  nextConfig: StoredCodexConfig,
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd)
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    const currentConfig = await readStoredCodexConfig(cwd);
    if (!sameConnectionSelection(currentConfig, previousConfig)) {
      throw new Error("Codex connector selection changed during update.");
    }

    if (nextConfig.contentMode === "metadata_only") {
      await purgeTaskSummariesFile(cwd);
    }
    await writePrivateJson(
      "config.json",
      configSchema.parse(nextConfig),
      cwd
    );
  });
}

export async function readStoredCodexSnapshot(
  cwd = process.cwd()
): Promise<CodexSnapshot | null> {
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "snapshot.json"),
      "utf8"
    );
    const value: unknown = JSON.parse(text);
    const current = snapshotSchema.safeParse(value);
    if (current.success) return current.data;
    const legacy = legacySnapshotSchema.parse(value);
    return {
      ...legacy,
      schemaVersion: "codex-snapshot-v2",
      sessions: legacy.sessions.map((session) => ({
        ...session,
        taskSummary: null,
        taskSummarySource: null
      }))
    };
  } catch {
    return null;
  }
}

export async function writeStoredCodexSnapshot(
  snapshot: CodexSnapshot,
  expectedConfig: StoredCodexConfig,
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd)
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    const currentConfig = await readStoredCodexConfig(cwd);
    if (!sameConnectionSelection(currentConfig, expectedConfig)) {
      throw new Error("Codex connector selection changed during sync.");
    }
    await writePrivateJson(
      "snapshot.json",
      snapshotSchema.parse(snapshot),
      cwd
    );
  });
}

export async function deleteStoredCodexConnection(
  cwd = process.cwd()
): Promise<void> {
  storeGenerations.set(cwd, codexStoreGeneration(cwd) + 1);
  await withCodexStoreMutation(cwd, async () => {
    await Promise.all([
      deleteIfPresent(join(codexLocalDirectory(cwd), "config.json")),
      deleteIfPresent(join(codexLocalDirectory(cwd), "snapshot.json"))
    ]);
  });
}

export function createCodexInstallationSecret(): string {
  return randomBytes(32).toString("hex");
}

export function codexStoreGeneration(cwd = process.cwd()): number {
  return storeGenerations.get(cwd) ?? 0;
}

async function purgeTaskSummariesFile(cwd: string): Promise<void> {
  const snapshot = await readStoredCodexSnapshot(cwd);
  if (!snapshot) {
    await deleteIfPresent(
      join(codexLocalDirectory(cwd), "snapshot.json")
    );
    return;
  }
  await writePrivateJson(
    "snapshot.json",
    snapshotSchema.parse({
      ...snapshot,
      schemaVersion: "codex-snapshot-v2",
      contentMode: "metadata_only",
      sessions: snapshot.sessions.map((session) => ({
        ...session,
        taskSummary: null,
        taskSummarySource: null
      }))
    }),
    cwd
  );
}

async function writePrivateJson(
  filename: string,
  value: unknown,
  cwd: string
): Promise<void> {
  const directory = codexLocalDirectory(cwd);
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

function sameConnectionSelection(
  current: StoredCodexConfig | null,
  expected: StoredCodexConfig
): boolean {
  if (
    !current ||
    current.installationSecret !== expected.installationSecret ||
    current.contentMode !== expected.contentMode
  ) {
    return false;
  }
  const currentIds = [...new Set(current.selectedScopeIds)].sort();
  const expectedIds = [...new Set(expected.selectedScopeIds)].sort();
  return (
    currentIds.length === expectedIds.length &&
    currentIds.every(
      (scopeId, index) => scopeId === expectedIds[index]
    )
  );
}

function assertCurrentGeneration(
  cwd: string,
  expectedGeneration: number
): void {
  if (codexStoreGeneration(cwd) !== expectedGeneration) {
    throw new Error("Codex connector state changed during operation.");
  }
}

async function withCodexStoreMutation<T>(
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
