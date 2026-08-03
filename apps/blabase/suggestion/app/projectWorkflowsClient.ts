import type {
  ProjectWorkflowActionKind,
  ProjectWorkflowApiResponse,
  ProjectWorkflowProjection
} from "../src/workflows";

const ACTION_KINDS = new Set<ProjectWorkflowActionKind>([
  "review_changes",
  "commit_changes",
  "create_pull_request",
  "request_review"
]);

export async function fetchProjectWorkflows(): Promise<ProjectWorkflowApiResponse> {
  const response = await fetch("/api/context/project-workflows", {
    cache: "no-store"
  });
  return parseProjectWorkflowResponse(await response.json());
}

export async function configureProjectWorkflow(input: {
  projectId: string;
  actionKind: ProjectWorkflowActionKind;
}): Promise<ProjectWorkflowProjection> {
  return mutateProjectWorkflow({
    action: "configure",
    projectId: input.projectId,
    actionKind: input.actionKind,
    explicitUserConfirmation: true
  });
}

export async function clearProjectWorkflow(input: {
  projectId: string;
}): Promise<ProjectWorkflowProjection> {
  return mutateProjectWorkflow({
    action: "clear",
    projectId: input.projectId,
    explicitUserConfirmation: true
  });
}

export async function recordProjectWorkflowClosure(input: {
  managedRunId: string;
  bindingId: string;
  executionId: string;
  workflowDecisionId: string;
  actionKind: ProjectWorkflowActionKind;
  outcome: "completed" | "skipped";
}): Promise<ProjectWorkflowProjection> {
  return mutateProjectWorkflow({
    action: "record_closure",
    ...input,
    explicitUserConfirmation: true
  });
}

async function mutateProjectWorkflow(
  body: Record<string, unknown>
): Promise<ProjectWorkflowProjection> {
  const response = await fetch("/api/context/project-workflows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const payload = parseProjectWorkflowResponse(await response.json());
  if (!response.ok || payload.status !== "ready") {
    if (payload.status === "ready") {
      throw new ProjectWorkflowRequestError();
    }
    throw new ProjectWorkflowRequestError(
      payload.status === "error" ? payload.code : undefined,
      payload.message
    );
  }
  return payload.projection;
}

export class ProjectWorkflowRequestError extends Error {
  constructor(
    public readonly code?: string,
    message = "Project workflow request failed."
  ) {
    super(message);
    this.name = "ProjectWorkflowRequestError";
  }
}

function parseProjectWorkflowResponse(
  value: unknown
): ProjectWorkflowApiResponse {
  if (!isRecord(value) || typeof value.status !== "string") {
    return invalidResponse();
  }
  if (
    value.status === "ready" &&
    hasExactKeys(value, ["projection", "status"]) &&
    isProjectWorkflowProjection(value.projection)
  ) {
    return {
      status: "ready",
      projection: value.projection
    };
  }
  if (
    value.status === "unavailable" &&
    hasExactKeys(value, ["message", "status"]) &&
    isBoundedString(value.message, 500)
  ) {
    return value as ProjectWorkflowApiResponse;
  }
  if (
    value.status === "error" &&
    hasExactKeys(value, ["code", "message", "status"]) &&
    isBoundedString(value.code, 120) &&
    isBoundedString(value.message, 500)
  ) {
    return value as ProjectWorkflowApiResponse;
  }
  return invalidResponse();
}

function isProjectWorkflowProjection(
  value: unknown
): value is ProjectWorkflowProjection {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "activeWorkflows",
      "asOf",
      "closures",
      "contract",
      "policyVersion",
      "projectionSha256",
      "revision",
      "schemaVersion",
      "storeSha256"
    ]) ||
    value.contract !== "project-workflow-projection-v0.1" ||
    value.schemaVersion !== "project-workflow-schema-v0.1" ||
    value.policyVersion !==
      "project-workflow-follow-through-policy-v0.1" ||
    !isTimestamp(value.asOf) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isSha256(value.storeSha256) ||
    !isSha256(value.projectionSha256) ||
    !Array.isArray(value.activeWorkflows) ||
    !Array.isArray(value.closures) ||
    value.activeWorkflows.length > 10_000 ||
    value.closures.length > 50_000 ||
    !value.activeWorkflows.every(isActiveWorkflow) ||
    !value.closures.every(isClosure)
  ) {
    return false;
  }
  const active = value.activeWorkflows as Array<{
    projectId: string;
    workflowDecisionId: string;
    configuredAt: string;
  }>;
  const closures = value.closures as Array<{
    closureId: string;
    managedRunId: string;
    workflowDecisionId: string;
    decidedAt: string;
  }>;
  const asOf = Date.parse(value.asOf as string);
  return (
    isCanonicalUnique(
      active.map(
        (item) => `${item.projectId}:${item.workflowDecisionId}`
      )
    ) &&
    new Set(active.map((item) => item.projectId)).size === active.length &&
    new Set(active.map((item) => item.workflowDecisionId)).size ===
      active.length &&
    isCanonicalUnique(closures.map((item) => item.closureId)) &&
    new Set(
      closures.map(
        (item) => `${item.managedRunId}:${item.workflowDecisionId}`
      )
    ).size === closures.length &&
    Number(value.revision) >= active.length + closures.length &&
    active.every(
      (workflow) => Date.parse(workflow.configuredAt) <= asOf
    ) &&
    closures.every(
      (closure) => Date.parse(closure.decidedAt) <= asOf
    )
  );
}

function isActiveWorkflow(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "actionKind",
      "configuredAt",
      "gracePeriodMs",
      "projectId",
      "workflowDecisionId"
    ]) &&
    isWorkflowDecisionId(value.workflowDecisionId) &&
    isProjectId(value.projectId) &&
    ACTION_KINDS.has(value.actionKind as ProjectWorkflowActionKind) &&
    isTimestamp(value.configuredAt) &&
    value.gracePeriodMs === 120_000
  );
}

function isClosure(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "actionKind",
      "bindingId",
      "closureId",
      "decidedAt",
      "executionId",
      "managedRunId",
      "outcome",
      "workflowDecisionId"
    ]) &&
    typeof value.closureId === "string" &&
    /^workflow_closure_[a-f0-9]{32}$/.test(value.closureId) &&
    typeof value.managedRunId === "string" &&
    /^managed_run_[a-f0-9]{32}$/.test(value.managedRunId) &&
    typeof value.bindingId === "string" &&
    /^binding_[a-f0-9]{32}$/.test(value.bindingId) &&
    typeof value.executionId === "string" &&
    /^codex:execution:[a-f0-9]{24}$/.test(value.executionId) &&
    isWorkflowDecisionId(value.workflowDecisionId) &&
    ACTION_KINDS.has(value.actionKind as ProjectWorkflowActionKind) &&
    (value.outcome === "completed" || value.outcome === "skipped") &&
    isTimestamp(value.decidedAt)
  );
}

function isWorkflowDecisionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^workflow_decision_[a-f0-9]{32}$/.test(value)
  );
}

function isProjectId(value: unknown): value is string {
  return (
    typeof value === "string" && /^project_[a-f0-9]{32}$/.test(value)
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isBoundedString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: string[]
): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function isCanonicalUnique(values: string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every(
      (value, index) => index === 0 || values[index - 1]! < value
    )
  );
}

function invalidResponse(): ProjectWorkflowApiResponse {
  return {
    status: "error",
    code: "INVALID_PROJECT_WORKFLOW_PROJECTION",
    message: "프로젝트 workflow 결과를 검증하지 못했습니다."
  };
}
