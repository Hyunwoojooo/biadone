import { NextResponse } from "next/server";

import {
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import {
  WorkResumptionStoreError,
  bindWorkSession,
  openWorkSession,
  readWorkResumptionCommandStatus,
  readWorkResumptionStatus,
  unbindWorkSession,
  workResumptionCommandIdSchema,
  workResumptionMutationSchema
} from "../../../src/resumption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSafeReadOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }

  const rawCommandId = new URL(request.url).searchParams.get(
    "commandId"
  );
  let commandId: string | null = null;
  if (rawCommandId !== null) {
    const parsed =
      workResumptionCommandIdSchema.safeParse(rawCommandId);
    if (!parsed.success) {
      return errorResponse(
        "INVALID_COMMAND_ID",
        "작업 열기 요청 ID 형식을 확인해주세요.",
        400
      );
    }
    commandId = parsed.data;
  }

  try {
    const snapshot = await readWorkResumptionStatus();
    const command = commandId
      ? await readWorkResumptionCommandStatus(commandId)
      : undefined;
    if (commandId && command === null) {
      return errorResponse(
        "COMMAND_NOT_FOUND",
        "작업 열기 요청을 찾지 못했습니다.",
        404
      );
    }
    return noStoreJson({
      status: "ready",
      ...snapshot,
      ...(commandId ? { command } : {})
    });
  } catch {
    return errorResponse(
      "WORK_RESUMPTION_READ_FAILED",
      "작업 이어가기 상태를 확인하지 못했습니다.",
      500
    );
  }
}

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSameAttentionOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }

  let input;
  try {
    input = workResumptionMutationSchema.parse(
      await request.json()
    );
  } catch {
    return errorResponse(
      "INVALID_WORK_RESUMPTION_MUTATION",
      "작업 이어가기 요청 형식을 확인해주세요.",
      400
    );
  }

  try {
    if (input.action === "bind") {
      await bindWorkSession({
        taskRef: input.taskRef,
        executionId: input.executionId,
        explicitUserConfirmation:
          input.explicitUserConfirmation
      });
      return readyResponse();
    }
    if (input.action === "unbind") {
      await unbindWorkSession({
        taskRef: input.taskRef,
        explicitUserConfirmation:
          input.explicitUserConfirmation
      });
      return readyResponse();
    }

    const acceptedCommand = await openWorkSession({
      taskRef: input.taskRef,
      explicitUserAction: input.explicitUserAction
    });
    const snapshot = await readWorkResumptionStatus();
    return noStoreJson(
      {
        status: "ready",
        ...snapshot,
        acceptedCommand
      },
      202
    );
  } catch (error) {
    if (error instanceof WorkResumptionStoreError) {
      if (error.code === "CODEX_EXECUTION_NOT_FOUND") {
        return errorResponse(
          "CODEX_EXECUTION_NOT_FOUND",
          "연결할 Codex 세션을 현재 수집 데이터에서 찾지 못했습니다.",
          404
        );
      }
      if (error.code === "CODEX_CONNECTION_UNAVAILABLE") {
        return errorResponse(
          "CODEX_CONNECTION_UNAVAILABLE",
          "Codex 연결이 변경되어 세션을 연결하지 않았습니다. Codex 상태를 다시 확인해주세요.",
          409
        );
      }
      if (error.code === "BINDING_NOT_FOUND") {
        return errorResponse(
          "BINDING_NOT_FOUND",
          "이 작업에 연결된 Codex 세션이 없습니다.",
          404
        );
      }
      if (error.code === "COMPANION_OFFLINE") {
        return errorResponse(
          "COMPANION_OFFLINE",
          "Local Companion이 오프라인이라 작업 열기 요청을 만들지 않았습니다.",
          409
        );
      }
    }
    return errorResponse(
      "WORK_RESUMPTION_MUTATION_FAILED",
      "작업 이어가기 상태를 변경하지 못했습니다.",
      500
    );
  }
}

async function readyResponse() {
  const snapshot = await readWorkResumptionStatus();
  return noStoreJson({
    status: "ready",
    ...snapshot
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number
) {
  return noStoreJson(
    {
      status: "error",
      code,
      message
    },
    status
  );
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
