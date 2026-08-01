import { NextResponse } from "next/server";

import {
  GitHubArtifactTargetError,
  WorkArtifactAttributionError,
  WorkArtifactMutationError,
  attachStoredWorkArtifact,
  detachStoredWorkArtifact,
  workArtifactMutationSchema
} from "../../../src/artifacts";
import {
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    input = workArtifactMutationSchema.parse(await request.json());
  } catch {
    return errorResponse(
      "INVALID_WORK_ARTIFACT_MUTATION",
      "결과 연결 요청 형식을 확인해주세요.",
      400
    );
  }

  try {
    if (input.action === "attach") {
      const decision = await attachStoredWorkArtifact(input);
      return noStoreJson({
        status: "ready",
        attributionId: decision.attributionId
      });
    }
    await detachStoredWorkArtifact(input);
    return noStoreJson({ status: "ready" });
  } catch (error) {
    if (error instanceof GitHubArtifactTargetError) {
      return githubTargetErrorResponse(error);
    }
    if (error instanceof WorkArtifactMutationError) {
      return errorResponse(
        error.code,
        error.code === "MANAGED_RUN_RELATION_NOT_FOUND"
          ? "이 Codex 실행의 사용자 작업 연결을 찾지 못했습니다. 화면을 갱신한 뒤 다시 시도해주세요."
          : "Codex 실행과 사용자 작업 연결이 달라 결과를 저장하지 않았습니다.",
        error.code === "MANAGED_RUN_RELATION_NOT_FOUND" ? 404 : 409
      );
    }
    if (error instanceof WorkArtifactAttributionError) {
      if (error.code === "ATTRIBUTION_NOT_FOUND") {
        return errorResponse(
          error.code,
          "해제할 결과 연결을 찾지 못했습니다.",
          404
        );
      }
      if (error.code === "ATTRIBUTION_NOT_ACTIVE") {
        return errorResponse(
          error.code,
          "이미 변경되거나 해제된 결과 연결입니다.",
          409
        );
      }
      if (
        error.code === "ARTIFACT_IDENTITY_CONFLICT" ||
        error.code === "DECISION_TIME_REGRESSION"
      ) {
        return errorResponse(
          error.code,
          "결과 연결 이력과 충돌해 변경하지 않았습니다.",
          409
        );
      }
    }
    return errorResponse(
      "WORK_ARTIFACT_MUTATION_FAILED",
      "결과 연결을 변경하지 못했습니다.",
      500
    );
  }
}

function githubTargetErrorResponse(error: GitHubArtifactTargetError) {
  switch (error.code) {
    case "GITHUB_ARTIFACT_URL_INVALID":
      return errorResponse(
        error.code,
        "정확한 GitHub commit 또는 PR URL을 입력해주세요.",
        400
      );
    case "GITHUB_ARTIFACT_SOURCE_UNAVAILABLE":
      return errorResponse(
        error.code,
        "GitHub 최신 정보를 확인한 뒤 다시 연결해주세요.",
        409
      );
    case "GITHUB_ARTIFACT_REPOSITORY_NOT_FOUND":
      return errorResponse(
        error.code,
        "현재 연결된 GitHub 저장소에서 이 결과를 찾지 못했습니다.",
        404
      );
    case "GITHUB_PULL_REQUEST_NOT_FOUND":
      return errorResponse(
        error.code,
        "현재 GitHub snapshot에서 이 PR의 exact native identity를 찾지 못했습니다.",
        404
      );
    case "GITHUB_ARTIFACT_REPOSITORY_IDENTITY_CONFLICT":
    case "GITHUB_PULL_REQUEST_IDENTITY_CONFLICT":
      return errorResponse(
        error.code,
        "GitHub 결과 identity가 충돌해 연결하지 않았습니다.",
        409
      );
  }
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
