import { createHmac } from "node:crypto";

import { z } from "zod";

import { runtimeSha256 } from "../../crossSource/canonicalHash";

export const CODEX_LOCAL_GIT_SNAPSHOT_SCHEMA_VERSION =
  "codex-local-git-snapshot-v1" as const;
export const CODEX_LOCAL_GIT_COLLECTOR_VERSION =
  "codex-local-git-metadata-v1" as const;
export const CODEX_LOCAL_GIT_UPSTREAM_BASIS =
  "local_tracking_ref_without_network_refresh" as const;
export const MAX_CODEX_LOCAL_GIT_REPOSITORIES = 32;
export const MAX_CODEX_LOCAL_GIT_TRACKING_COUNT = 100_000;
const CODEX_LOCAL_GIT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

const scopeIdSchema = z.string().regex(/^[a-f0-9]{24}$/u);
const repositoryIdSchema = z
  .string()
  .regex(/^local_repo_[a-f0-9]{64}$/u);
const commitIdSchema = z
  .string()
  .regex(/^local_commit_[a-f0-9]{64}$/u);
const githubRepositoryKeySchema = z
  .string()
  .regex(/^github_repo_[a-f0-9]{32}$/u);
const trackingCountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_CODEX_LOCAL_GIT_TRACKING_COUNT);

export const codexLocalGitTrackingStateSchema = z.enum([
  "in_sync",
  "ahead",
  "behind",
  "diverged",
  "not_configured",
  "unborn",
  "unavailable"
]);

export const codexLocalGitUnavailableReasonSchema = z.enum([
  "UNSAFE_SCOPE_PATH",
  "PATH_UNAVAILABLE",
  "NOT_A_REPOSITORY",
  "GIT_UNAVAILABLE",
  "GIT_COMMAND_TIMED_OUT",
  "GIT_EXECUTION_FAILED",
  "GIT_OUTPUT_INVALID",
  "GIT_REFS_CHANGED_DURING_COLLECTION"
]);

export const codexLocalGitRepositorySchema = z
  .object({
    scopeId: scopeIdSchema,
    repositoryId: repositoryIdSchema.nullable(),
    headCommitId: commitIdSchema.nullable(),
    githubRepositoryKey: githubRepositoryKeySchema.nullable(),
    mappingEligibility: z.enum(["exact", "none", "conflict"]),
    trackingState: codexLocalGitTrackingStateSchema,
    aheadCount: trackingCountSchema.nullable(),
    behindCount: trackingCountSchema.nullable(),
    headCommittedAt: z.string().datetime().nullable(),
    unavailableReason: codexLocalGitUnavailableReasonSchema.nullable()
  })
  .strict()
  .superRefine((repository, context) => {
    const mappingMatches =
      (repository.mappingEligibility === "exact") ===
      (repository.githubRepositoryKey !== null);
    if (!mappingMatches) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubRepositoryKey"],
        message: "Local GitHub mapping state is inconsistent."
      });
    }

    if (repository.trackingState === "unavailable") {
      if (
        repository.headCommitId !== null ||
        repository.aheadCount !== null ||
        repository.behindCount !== null ||
        repository.headCommittedAt !== null ||
        repository.unavailableReason === null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trackingState"],
          message: "Unavailable Local Git state must fail closed."
        });
      }
      return;
    }

    if (
      repository.repositoryId === null ||
      repository.unavailableReason !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repositoryId"],
        message: "Available Local Git state requires a repository."
      });
    }

    if (repository.trackingState === "unborn") {
      if (
        repository.headCommitId !== null ||
        repository.aheadCount !== null ||
        repository.behindCount !== null ||
        repository.headCommittedAt !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["headCommitId"],
          message: "An unborn repository cannot expose a head."
        });
      }
      return;
    }

    if (
      repository.headCommitId === null ||
      repository.headCommittedAt === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["headCommitId"],
        message: "Configured Local Git state requires a head."
      });
    }

    if (repository.trackingState === "not_configured") {
      if (
        repository.aheadCount !== null ||
        repository.behindCount !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aheadCount"],
          message: "An unconfigured upstream has no tracking counts."
        });
      }
      return;
    }

    if (
      repository.aheadCount === null ||
      repository.behindCount === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aheadCount"],
        message: "Tracked Local Git state requires bounded counts."
      });
      return;
    }
    const expected = trackingStateForCounts(
      repository.aheadCount,
      repository.behindCount
    );
    if (repository.trackingState !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trackingState"],
        message: "Local Git tracking counts do not match state."
      });
    }
  });

const snapshotShape = {
  schemaVersion: z.literal(CODEX_LOCAL_GIT_SNAPSHOT_SCHEMA_VERSION),
  collectorVersion: z.literal(CODEX_LOCAL_GIT_COLLECTOR_VERSION),
  upstreamBasis: z.literal(CODEX_LOCAL_GIT_UPSTREAM_BASIS),
  fetchedAt: z.string().datetime(),
  scopeIds: z
    .array(scopeIdSchema)
    .max(MAX_CODEX_LOCAL_GIT_REPOSITORIES),
  repositories: z
    .array(codexLocalGitRepositorySchema)
    .max(MAX_CODEX_LOCAL_GIT_REPOSITORIES),
  truncated: z.boolean()
};

const codexLocalGitSnapshotContentSchema = z
  .object(snapshotShape)
  .strict()
  .superRefine(validateSnapshotContent);

export const codexLocalGitSnapshotSchema = z
  .object({
    ...snapshotShape,
    snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
  .superRefine((snapshot, context) => {
    validateSnapshotContent(snapshot, context);
    const { snapshotSha256, ...content } = snapshot;
    if (snapshotSha256 !== codexLocalGitSnapshotSha256(content)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshotSha256"],
        message: "Local Git snapshot hash does not match content."
      });
    }
  });

export type CodexLocalGitTrackingState = z.infer<
  typeof codexLocalGitTrackingStateSchema
>;
export type CodexLocalGitUnavailableReason = z.infer<
  typeof codexLocalGitUnavailableReasonSchema
>;
export type CodexLocalGitRepository = z.infer<
  typeof codexLocalGitRepositorySchema
>;
export type CodexLocalGitSnapshotContent = z.infer<
  typeof codexLocalGitSnapshotContentSchema
>;
export type CodexLocalGitSnapshot = z.infer<
  typeof codexLocalGitSnapshotSchema
>;

export function sealCodexLocalGitSnapshot(
  input: CodexLocalGitSnapshotContent
): CodexLocalGitSnapshot {
  const content = codexLocalGitSnapshotContentSchema.parse(input);
  return codexLocalGitSnapshotSchema.parse({
    ...content,
    snapshotSha256: codexLocalGitSnapshotSha256(content)
  });
}

export function parseCodexLocalGitSnapshot(
  input: unknown
): CodexLocalGitSnapshot {
  return codexLocalGitSnapshotSchema.parse(input);
}

export function codexLocalGitSnapshotSha256(
  input: CodexLocalGitSnapshotContent
): string {
  return runtimeSha256({
    domain: "codex-local-git-snapshot-v1",
    snapshot: input
  });
}

export function createCodexLocalGitRepositoryId(
  installationSecret: string,
  canonicalRepositoryPath: string
): string {
  return `local_repo_${installationHmac(
    installationSecret,
    "local-repository-v1",
    canonicalRepositoryPath
  )}`;
}

export function createCodexLocalGitHeadCommitId(
  installationSecret: string,
  canonicalRepositoryPath: string,
  rawHeadCommit: string
): string {
  return `local_commit_${installationHmac(
    installationSecret,
    "local-head-commit-v1",
    `${canonicalRepositoryPath}\0${rawHeadCommit.toLowerCase()}`
  )}`;
}

export function createCodexLocalGitGitHubRepositoryKey(
  installationSecret: string,
  repositoryFullName: string
): string | null {
  const canonical = canonicalGitHubRepositoryName(repositoryFullName);
  if (canonical === null) return null;
  return `github_repo_${installationHmac(
    installationSecret,
    "github-repository-v1",
    canonical
  ).slice(0, 32)}`;
}

function installationHmac(
  installationSecret: string,
  domain: string,
  value: string
): string {
  if (
    !/^[a-f0-9]{64}$/u.test(installationSecret) ||
    value.length === 0
  ) {
    throw new TypeError("Invalid Local Git identity input.");
  }
  return createHmac("sha256", Buffer.from(installationSecret, "hex"))
    .update(`blabase:${domain}\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function canonicalGitHubRepositoryName(value: string): string | null {
  const parts = value.trim().split("/");
  if (
    parts.length !== 2 ||
    parts.some(
      (part) =>
        part.length === 0 ||
        part.length > 100 ||
        !/^[a-zA-Z0-9_.-]+$/u.test(part)
    )
  ) {
    return null;
  }
  return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

function trackingStateForCounts(
  aheadCount: number,
  behindCount: number
): Exclude<
  CodexLocalGitTrackingState,
  "not_configured" | "unborn" | "unavailable"
> {
  if (aheadCount === 0 && behindCount === 0) return "in_sync";
  if (aheadCount > 0 && behindCount === 0) return "ahead";
  if (aheadCount === 0 && behindCount > 0) return "behind";
  return "diverged";
}

function validateSnapshotContent(
  snapshot: {
    fetchedAt: string;
    scopeIds: string[];
    repositories: CodexLocalGitRepository[];
  },
  context: z.RefinementCtx
): void {
  const sortedScopeIds = [...snapshot.scopeIds].sort();
  if (
    new Set(snapshot.scopeIds).size !== snapshot.scopeIds.length ||
    snapshot.scopeIds.some(
      (scopeId, index) => scopeId !== sortedScopeIds[index]
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scopeIds"],
      message: "Local Git scope IDs must be unique and sorted."
    });
  }
  if (
    snapshot.repositories.length !== snapshot.scopeIds.length ||
    snapshot.repositories.some(
      (repository, index) =>
        repository.scopeId !== snapshot.scopeIds[index]
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repositories"],
      message: "Local Git repository observations must match scopes."
    });
  }
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  snapshot.repositories.forEach((repository, index) => {
    if (repository.headCommittedAt === null) return;
    const headCommittedAt = Date.parse(repository.headCommittedAt);
    if (
      !Number.isFinite(headCommittedAt) ||
      headCommittedAt < 0 ||
      headCommittedAt >
        fetchedAt + CODEX_LOCAL_GIT_MAX_FUTURE_SKEW_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repositories", index, "headCommittedAt"],
        message: "Local Git commit timestamp is outside bounds."
      });
    }
  });
}
