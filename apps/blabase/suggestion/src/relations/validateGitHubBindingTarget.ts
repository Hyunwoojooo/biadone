import { readStoredGitHubSnapshot } from "../connectors/github/localStore";
import type { GitHubTaskSignal } from "../connectors/github/types";
import type { WorkResumptionTaskRef } from "../resumption/contracts";

export type ValidatedGitHubBindingTarget = {
  subjectId: string;
  objectType: "issue" | "pull_request";
  number: number;
};

/**
 * Validates the source-native identity used by a new explicit binding.
 * Existing binding history remains readable even when the source later stops
 * observing the object; absence here is never interpreted as completion.
 */
export async function validateStoredGitHubBindingTarget(
  taskRef: WorkResumptionTaskRef,
  cwd = process.cwd()
): Promise<ValidatedGitHubBindingTarget | null> {
  if (taskRef.source !== "github") return null;
  const match = taskRef.subjectId.match(
    /^github:object:([1-9][0-9]*)$/
  );
  if (!match) {
    throw new WorkRelationTargetError(
      "GITHUB_WORK_ITEM_IDENTITY_INVALID"
    );
  }
  const nativeId = Number(match[1]);
  const snapshot = await readStoredGitHubSnapshot(cwd);
  if (snapshot === null) {
    throw new WorkRelationTargetError(
      "GITHUB_WORK_ITEM_SOURCE_UNAVAILABLE"
    );
  }
  const matches = snapshot.tasks.filter(
    (task) => task.id === nativeId
  );
  if (matches.length === 0) {
    throw new WorkRelationTargetError("GITHUB_WORK_ITEM_NOT_FOUND");
  }
  const first = matches[0];
  if (!first || matches.some((task) => !sameNativeTarget(first, task))) {
    throw new WorkRelationTargetError(
      "GITHUB_WORK_ITEM_IDENTITY_CONFLICT"
    );
  }
  return {
    subjectId: taskRef.subjectId,
    objectType:
      first.kind === "assigned_issue" ? "issue" : "pull_request",
    number: first.number
  };
}

function sameNativeTarget(
  left: GitHubTaskSignal,
  right: GitHubTaskSignal
): boolean {
  return (
    (left.kind === "assigned_issue") ===
      (right.kind === "assigned_issue") &&
    left.repositoryId === right.repositoryId &&
    left.number === right.number &&
    left.htmlUrl === right.htmlUrl
  );
}

export class WorkRelationTargetError extends Error {
  constructor(
    public readonly code:
      | "GITHUB_WORK_ITEM_IDENTITY_INVALID"
      | "GITHUB_WORK_ITEM_SOURCE_UNAVAILABLE"
      | "GITHUB_WORK_ITEM_NOT_FOUND"
      | "GITHUB_WORK_ITEM_IDENTITY_CONFLICT"
  ) {
    super(code);
    this.name = "WorkRelationTargetError";
  }
}
