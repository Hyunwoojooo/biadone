import {
  ChatGPTImportError,
  importChatGPTShareUrl,
  type ChatGPTImportErrorCode,
} from "@/lib/chatgpt";
import { createConversationNote, NoteEngineError } from "@/lib/note-engine";

const MAX_REQUEST_BODY_BYTES = 4 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new ChatGPTImportError(
        "INVALID_REQUEST",
        "JSON 요청만 지원합니다.",
        415,
      );
    }

    const rawBody = await readRequestBody(request, MAX_REQUEST_BODY_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new ChatGPTImportError(
        "INVALID_REQUEST",
        "요청 JSON을 확인해 주세요.",
        400,
      );
    }

    const shareUrl =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).shareUrl
        : undefined;
    if (typeof shareUrl !== "string") {
      throw new ChatGPTImportError(
        "INVALID_REQUEST",
        "shareUrl 문자열이 필요합니다.",
        400,
      );
    }

    const imported = await importChatGPTShareUrl({ url: shareUrl });
    const draft = createConversationNote({
      title: imported.conversation.title,
      messages: imported.conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      })),
      source: {
        type: "chatgpt_share_link",
        originalUrl: imported.source.originalUrl,
        normalizedUrl: imported.source.normalizedUrl,
        shareId: imported.source.shareId,
      },
    });

    return jsonResponse(
      {
        status: "completed",
        draft,
        conversation: imported.conversation,
        source: {
          originalUrl: imported.source.originalUrl,
          normalizedUrl: imported.source.normalizedUrl,
          shareId: imported.source.shareId,
        },
        warnings: imported.warnings,
        diagnostics: imported.diagnostics,
      },
      200,
    );
  } catch (error) {
    const normalized = normalizeRouteError(error);
    const message = publicErrorMessage(normalized.code);

    return jsonResponse(
      {
        status: "error",
        message,
        error: {
          code: normalized.code,
          message,
        },
      },
      normalized.httpStatus,
    );
  }
}

async function readRequestBody(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ChatGPTImportError(
      "INVALID_REQUEST",
      "요청 본문이 너무 큽니다.",
      413,
    );
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let output = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ChatGPTImportError(
          "INVALID_REQUEST",
          "요청 본문이 너무 큽니다.",
          413,
        );
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function normalizeRouteError(error: unknown): ChatGPTImportError {
  if (error instanceof ChatGPTImportError) return error;
  if (error instanceof NoteEngineError) {
    if (error.code === "NO_MESSAGES" || error.code === "NO_USER_MESSAGE") {
      return new ChatGPTImportError(
        "NO_VISIBLE_MESSAGES",
        "A note requires at least one visible user message.",
        422,
        error,
      );
    }
  }
  return new ChatGPTImportError(
    "IMPORT_FAILED",
    "대화를 가져오는 중 오류가 발생했습니다.",
    500,
    error,
  );
}

function publicErrorMessage(code: ChatGPTImportErrorCode): string {
  switch (code) {
    case "INVALID_REQUEST":
      return "가져오기 요청 형식을 확인해 주세요.";
    case "INVALID_SHARE_URL":
      return "https://chatgpt.com/share/로 시작하는 공개 공유 링크를 입력해 주세요.";
    case "SHARE_LINK_DELETED":
      return "삭제되었거나 존재하지 않는 공유 링크입니다.";
    case "SHARE_LINK_NOT_ACCESSIBLE":
      return "공유 링크에 접근할 수 없습니다. 링크 공개 상태를 확인해 주세요.";
    case "SHARE_FETCH_TIMEOUT":
      return "공유 대화를 가져오는 데 시간이 너무 오래 걸렸습니다. 다시 시도해 주세요.";
    case "SHARE_RESPONSE_TOO_LARGE":
      return "대화가 현재 가져오기 크기 제한을 초과했습니다.";
    case "SHARE_RESPONSE_NOT_HTML":
      return "공유 링크가 예상한 ChatGPT 페이지를 반환하지 않았습니다.";
    case "RATE_LIMITED":
      return "잠시 요청이 많습니다. 조금 뒤 다시 시도해 주세요.";
    case "CHATGPT_PAYLOAD_CHANGED":
    case "CONVERSATION_NOT_FOUND":
      return "ChatGPT 공유 페이지 형식이 달라 대화를 읽지 못했습니다.";
    case "NO_VISIBLE_MESSAGES":
      return "가져올 수 있는 사용자·어시스턴트 메시지가 없습니다.";
    case "SHARE_FETCH_MISCONFIGURED":
    case "IMPORT_FAILED":
      return "대화를 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}
