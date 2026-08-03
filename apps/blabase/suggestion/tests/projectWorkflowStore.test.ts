import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROJECT_WORKFLOW_GRACE_PERIOD_MS,
  clearProjectWorkflow,
  configureProjectWorkflow,
  createEmptyProjectWorkflowStore,
  projectWorkflowAppliesToManagedRun,
  projectWorkflowGraceElapsed,
  projectWorkflowProjectionSchema,
  projectWorkflowStorePath,
  projectWorkflowStoreSchema,
  readProjectWorkflowStore,
  recordProjectWorkflowClosure,
  resolveProjectWorkflowProjection,
  writeProjectWorkflowStore
} from "../src/workflows";

const PROJECT_A = `project_${"1".repeat(32)}`;
const PROJECT_B = `project_${"2".repeat(32)}`;
const MANAGED_RUN_ID = `managed_run_${"3".repeat(32)}`;
const BINDING_ID = `binding_${"4".repeat(32)}`;
const EXECUTION_ID = `codex:execution:${"5".repeat(24)}`;
const CONFIGURED_AT = "2026-08-01T10:00:00.000Z";
const RECONFIGURED_AT = "2026-08-01T10:10:00.000Z";
const CLOSED_AT = "2026-08-01T10:20:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("project workflow append-only store", () => {
  it("keeps configure, reconfigure, and clear decisions as an immutable chain", () => {
    const first = configureProjectWorkflow(
      createEmptyProjectWorkflowStore(),
      {
        projectId: PROJECT_A,
        actionKind: "review_changes",
        configuredAt: CONFIGURED_AT,
        explicitUserConfirmation: true
      }
    );
    const second = configureProjectWorkflow(first.store, {
      projectId: PROJECT_A,
      actionKind: "commit_changes",
      configuredAt: RECONFIGURED_AT,
      explicitUserConfirmation: true
    });
    const cleared = clearProjectWorkflow(second.store, {
      projectId: PROJECT_A,
      clearedAt: CLOSED_AT,
      explicitUserConfirmation: true
    });

    expect(cleared.store).toMatchObject({ revision: 3 });
    expect(cleared.store.decisions).toHaveLength(3);
    expect(cleared.store.decisions.map((decision) => decision.sequence)).toEqual([
      1,
      2,
      3
    ]);
    expect(cleared.store.decisions[1]?.supersedesWorkflowDecisionId).toBe(
      first.decision.workflowDecisionId
    );
    expect(cleared.store.decisions[2]?.supersedesWorkflowDecisionId).toBe(
      second.decision.workflowDecisionId
    );
    expect(
      resolveProjectWorkflowProjection({
        store: cleared.store,
        asOf: CLOSED_AT
      }).activeWorkflows
    ).toEqual([]);
  });

  it("projects one canonical active setting per project without raw content", () => {
    const projectB = configureProjectWorkflow(
      createEmptyProjectWorkflowStore(),
      {
        projectId: PROJECT_B,
        actionKind: "request_review",
        configuredAt: CONFIGURED_AT,
        explicitUserConfirmation: true
      }
    );
    const projectA = configureProjectWorkflow(projectB.store, {
      projectId: PROJECT_A,
      actionKind: "create_pull_request",
      configuredAt: RECONFIGURED_AT,
      explicitUserConfirmation: true
    });
    const projection = resolveProjectWorkflowProjection({
      store: projectA.store,
      asOf: CLOSED_AT
    });

    expect(projectWorkflowProjectionSchema.parse(projection)).toEqual(
      projection
    );
    expect(projection.activeWorkflows.map((workflow) => workflow.projectId)).toEqual([
      PROJECT_A,
      PROJECT_B
    ]);
    expect(projection.activeWorkflows[0]).toMatchObject({
      projectId: PROJECT_A,
      actionKind: "create_pull_request",
      configuredAt: RECONFIGURED_AT,
      gracePeriodMs: 120_000
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /title|prompt|content|response/i
    );
  });

  it("does not apply a workflow retroactively and fixes grace at two minutes", () => {
    const configured = configureProjectWorkflow(
      createEmptyProjectWorkflowStore(),
      {
        projectId: PROJECT_A,
        actionKind: "commit_changes",
        configuredAt: CONFIGURED_AT,
        explicitUserConfirmation: true
      }
    );
    const workflow = resolveProjectWorkflowProjection({
      store: configured.store,
      asOf: "2026-08-01T10:10:00.000Z"
    }).activeWorkflows[0]!;

    expect(PROJECT_WORKFLOW_GRACE_PERIOD_MS).toBe(120_000);
    expect(
      projectWorkflowAppliesToManagedRun({
        workflow,
        managedRunStartedAt: "2026-08-01T09:59:59.999Z"
      })
    ).toBe(false);
    expect(
      projectWorkflowGraceElapsed({
        workflow,
        managedRunStartedAt: "2026-08-01T09:59:59.999Z",
        completedAt: "2026-08-01T10:01:00.000Z",
        asOf: "2026-08-01T10:03:00.000Z"
      })
    ).toBe(false);
    expect(
      projectWorkflowGraceElapsed({
        workflow,
        managedRunStartedAt: CONFIGURED_AT,
        completedAt: "2026-08-01T10:01:00.000Z",
        asOf: "2026-08-01T10:02:59.999Z"
      })
    ).toBe(false);
    expect(
      projectWorkflowGraceElapsed({
        workflow,
        managedRunStartedAt: CONFIGURED_AT,
        completedAt: "2026-08-01T10:01:00.000Z",
        asOf: "2026-08-01T10:03:00.000Z"
      })
    ).toBe(true);
  });

  it("records an explicit completed or skipped closure once per run and workflow", () => {
    const configured = configureProjectWorkflow(
      createEmptyProjectWorkflowStore(),
      {
        projectId: PROJECT_A,
        actionKind: "review_changes",
        configuredAt: CONFIGURED_AT,
        explicitUserConfirmation: true
      }
    );
    const input = {
      managedRunId: MANAGED_RUN_ID,
      bindingId: BINDING_ID,
      executionId: EXECUTION_ID,
      workflowDecisionId: configured.decision.workflowDecisionId,
      actionKind: "review_changes" as const,
      outcome: "completed" as const,
      decidedAt: CLOSED_AT,
      explicitUserConfirmation: true as const
    };
    const closed = recordProjectWorkflowClosure(configured.store, input);
    const duplicate = recordProjectWorkflowClosure(closed.store, input);

    expect(closed.changed).toBe(true);
    expect(duplicate.changed).toBe(false);
    expect(duplicate.closure).toEqual(closed.closure);
    expect(
      resolveProjectWorkflowProjection({
        store: closed.store,
        asOf: CLOSED_AT
      }).closures
    ).toEqual([
      expect.objectContaining({
        managedRunId: MANAGED_RUN_ID,
        outcome: "completed"
      })
    ]);
    expect(() =>
      recordProjectWorkflowClosure(closed.store, {
        ...input,
        outcome: "skipped"
      })
    ).toThrowError(
      expect.objectContaining({ code: "CLOSURE_ALREADY_RECORDED" })
    );
  });

  it("rejects hash tampering and unknown raw fields", () => {
    const store = createEmptyProjectWorkflowStore();

    expect(
      projectWorkflowStoreSchema.safeParse({
        ...store,
        storeSha256: "0".repeat(64)
      }).success
    ).toBe(false);
    expect(
      projectWorkflowStoreSchema.safeParse({
        ...store,
        rawTitle: "must never enter the workflow store"
      }).success
    ).toBe(false);
  });

  it("writes the local workflow store atomically with private permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blabase-workflow-"));
    temporaryDirectories.push(directory);
    const configured = configureProjectWorkflow(
      createEmptyProjectWorkflowStore(),
      {
        projectId: PROJECT_A,
        actionKind: "commit_changes",
        configuredAt: CONFIGURED_AT,
        explicitUserConfirmation: true
      }
    );

    await writeProjectWorkflowStore(configured.store, directory);

    await expect(readProjectWorkflowStore(directory)).resolves.toEqual(
      configured.store
    );
    expect((await stat(projectWorkflowStorePath(directory))).mode & 0o777).toBe(
      0o600
    );
    expect(
      (await stat(join(directory, ".local", "context"))).mode & 0o777
    ).toBe(0o700);

    await chmod(projectWorkflowStorePath(directory), 0o644);
    await expect(readProjectWorkflowStore(directory)).rejects.toMatchObject({
      code: "STORE_INVALID"
    });
  });
});
