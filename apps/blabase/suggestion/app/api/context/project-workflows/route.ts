import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import { readWorkContextRegistry } from "../../../../src/context";
import {
  clearStoredProjectWorkflow,
  configureStoredProjectWorkflow,
  projectWorkflowActionKindSchema,
  projectWorkflowBindingIdSchema,
  projectWorkflowDecisionIdSchema,
  projectWorkflowExecutionIdSchema,
  projectWorkflowManagedRunIdSchema,
  projectWorkflowProjectIdSchema,
  projectWorkflowProjectionSchema,
  readProjectWorkflowStore,
  recordStoredProjectWorkflowClosure,
  resolveProjectWorkflowProjection,
  type ProjectWorkflowApiResponse
} from "../../../../src/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("configure"),
      projectId: projectWorkflowProjectIdSchema,
      actionKind: projectWorkflowActionKindSchema,
      explicitUserConfirmation: z.literal(true)
    })
    .strict(),
  z
    .object({
      action: z.literal("clear"),
      projectId: projectWorkflowProjectIdSchema,
      explicitUserConfirmation: z.literal(true)
    })
    .strict(),
  z
    .object({
      action: z.literal("record_closure"),
      managedRunId: projectWorkflowManagedRunIdSchema,
      bindingId: projectWorkflowBindingIdSchema,
      executionId: projectWorkflowExecutionIdSchema,
      workflowDecisionId: projectWorkflowDecisionIdSchema,
      actionKind: projectWorkflowActionKindSchema,
      outcome: z.enum(["completed", "skipped"]),
      explicitUserConfirmation: z.literal(true)
    })
    .strict()
]);

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message: "프로젝트 workflow는 로컬 Work Cockpit에서 설정해주세요."
      },
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }
  return projectionResponse(new Date());
}

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message: "프로젝트 workflow는 로컬 Work Cockpit에서 설정해주세요."
      },
      404
    );
  }
  if (!hasSameAttentionOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }

  let input: z.infer<typeof mutationSchema>;
  try {
    input = mutationSchema.parse(await request.json());
  } catch {
    return errorResponse(
      "INVALID_PROJECT_WORKFLOW_MUTATION",
      "프로젝트 workflow 변경 요청을 확인하지 못했습니다.",
      400
    );
  }

  const now = new Date();
  const decidedAt = now.toISOString();
  try {
    if (input.action === "configure") {
      const registry = await readWorkContextRegistry();
      if (registry.status !== "available") {
        return errorResponse(
          "PROJECT_CONTEXT_UNAVAILABLE",
          "프로젝트 정보를 먼저 확인해주세요.",
          409
        );
      }
      const project = registry.value.projects.find(
        (candidate) => candidate.projectId === input.projectId
      );
      if (!project || project.archivedAt !== null) {
        return errorResponse(
          "PROJECT_NOT_ACTIVE",
          "활성 프로젝트에만 workflow를 설정할 수 있습니다.",
          409
        );
      }
      await configureStoredProjectWorkflow({
        projectId: input.projectId,
        actionKind: input.actionKind,
        configuredAt: decidedAt,
        explicitUserConfirmation: true
      });
    } else if (input.action === "clear") {
      await clearStoredProjectWorkflow({
        projectId: input.projectId,
        clearedAt: decidedAt,
        explicitUserConfirmation: true
      });
    } else {
      await recordStoredProjectWorkflowClosure({
        managedRunId: input.managedRunId,
        bindingId: input.bindingId,
        executionId: input.executionId,
        workflowDecisionId: input.workflowDecisionId,
        actionKind: input.actionKind,
        outcome: input.outcome,
        decidedAt,
        explicitUserConfirmation: true
      });
    }
    return projectionResponse(now);
  } catch {
    return errorResponse(
      "PROJECT_WORKFLOW_MUTATION_FAILED",
      "프로젝트 workflow를 변경하지 못했습니다.",
      500
    );
  }
}

async function projectionResponse(now: Date) {
  try {
    const store = await readProjectWorkflowStore();
    const projection = projectWorkflowProjectionSchema.parse(
      resolveProjectWorkflowProjection({
        store,
        asOf: now.toISOString()
      })
    );
    return noStoreJson({ status: "ready", projection });
  } catch {
    return errorResponse(
      "PROJECT_WORKFLOW_READ_FAILED",
      "프로젝트 workflow를 확인하지 못했습니다.",
      500
    );
  }
}

function errorResponse(
  code: string,
  message: string,
  status: number
) {
  return noStoreJson({ status: "error", code, message }, status);
}

function noStoreJson(
  body: ProjectWorkflowApiResponse,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
