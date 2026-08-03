import {
  ChatGPTImportError,
  importChatGPTShareUrl,
  type ChatGPTImportErrorCode,
  validateShareUrl,
} from "@/lib/chatgpt";
import {
  createNoteImportService,
  NoteImportWorkflowError,
  sha256Hex,
  type NoteImportCommand,
  type NoteImportReplacement,
} from "@/lib/note-import";
import {
  createConversationNote,
  NOTE_ENGINE_VERSION,
  NoteEngineError,
} from "@/lib/note-engine";
import {
  createGeminiConversationSummary,
  DEFAULT_GEMINI_MODEL,
  SUMMARY_ENGINE_VERSION,
  SUMMARY_PROMPT_VERSION,
  SummaryGenerationError,
} from "@/lib/note-summary";
import {
  createGeminiConversationStateNote,
  DEFAULT_GEMINI_STATE_MODEL,
  STATE_NOTE_ENGINE_VERSION,
  STATE_NOTE_PROMPT_VERSION,
  StateNoteGenerationError,
} from "@/lib/note-state";

import {
  createImportedNote,
  findNoteBySourceUrl,
  hasReplacementCandidate,
  replaceImportedNote,
} from "../_repository";
import {
  ApiRequestError,
  noteErrorResponse,
  requireOwnerKey,
  type PublicNote,
} from "../_shared";

const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const NOTE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const importService = createNoteImportService<PublicNote>({
  repository: {
    findBySourceUrl: findNoteBySourceUrl,
    hasReplacementCandidate,
    createImportedNote,
    replaceImportedNote,
  },
  importShareUrl: (normalizedUrl) =>
    importChatGPTShareUrl({ url: normalizedUrl }),
  createDraft: async (imported) => {
    const legacyDraft = createConversationNote({
      title: imported.conversation.title,
      messages: imported.conversation.messages,
      source: {
        type: "chatgpt_share_link",
        originalUrl: imported.source.normalizedUrl,
        normalizedUrl: imported.source.normalizedUrl,
        shareId: imported.source.shareId,
      },
    });
    const useLegacySummary =
      process.env.GPTMEMORY_GENERATION_MODE?.trim() === "summary-v2";
    const model = useLegacySummary
      ? process.env.GPTMEMORY_SUMMARY_MODEL?.trim() ||
        process.env.GEMINI_MODEL?.trim() ||
        DEFAULT_GEMINI_MODEL
      : process.env.GPTMEMORY_STATE_MODEL?.trim() ||
        process.env.GPTMEMORY_SUMMARY_MODEL?.trim() ||
        process.env.GEMINI_MODEL?.trim() ||
        DEFAULT_GEMINI_STATE_MODEL;
    const summary = useLegacySummary
      ? await createGeminiConversationSummary(
          {
            title: imported.conversation.title,
            messages: imported.conversation.messages,
          },
          { model },
        )
      : await createGeminiConversationStateNote(
          {
            title: imported.conversation.title,
            messages: imported.conversation.messages,
          },
          { model },
        );
    return {
      legacyDraft,
      summary,
      summaryProvider: {
        provider: "gemini",
        model,
        engineVersion: useLegacySummary
          ? SUMMARY_ENGINE_VERSION
          : STATE_NOTE_ENGINE_VERSION,
        promptVersion: useLegacySummary
          ? SUMMARY_PROMPT_VERSION
          : STATE_NOTE_PROMPT_VERSION,
      },
    };
  },
  noteEngineVersion: NOTE_ENGINE_VERSION,
  now: () => new Date().toISOString(),
  randomUUID: () => crypto.randomUUID(),
  sha256Hex,
});

export async function POST(request: Request): Promise<Response> {
  try {
    // Ownership is required before duplicate lookup or any share-link fetch.
    const ownerKey = requireOwnerKey(request);
    const command = await parseImportCommand(request, ownerKey);
    const result = await importService.execute(command);

    switch (result.status) {
      case "already_exists":
        return jsonResponse(result, 409);
      case "created":
        return jsonResponse(result, 201);
      case "replaced":
        return jsonResponse(result, 200);
    }
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return noteErrorResponse(error);
    }
    if (
      error instanceof Error &&
      error.name === "NotesDatabaseUnavailableError"
    ) {
      return noteErrorResponse(error);
    }
    if (error instanceof NoteImportWorkflowError) {
      const message = workflowErrorMessage(error.code);
      return jsonResponse(
        {
          status: "error",
          message,
          error: { code: error.code, message },
        },
        error.httpStatus,
      );
    }
    if (error instanceof SummaryGenerationError) {
      const message = summaryGenerationErrorMessage(error);
      return jsonResponse(
        {
          status: "error",
          message,
          error: { code: error.code, message },
        },
        error.httpStatus,
      );
    }
    if (error instanceof StateNoteGenerationError) {
      const message = stateNoteGenerationErrorMessage(error);
      return jsonResponse(
        {
          status: "error",
          message,
          error: { code: error.code, message },
        },
        error.httpStatus,
      );
    }

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

async function parseImportCommand(
  request: Request,
  ownerKey: string,
): Promise<NoteImportCommand> {
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidImportRequest("요청 본문은 JSON 객체여야 합니다.");
  }
  const record = body as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter(
    (field) => field !== "shareUrl" && field !== "replace",
  );
  if (unknownFields.length > 0) {
    throw invalidImportRequest("지원하지 않는 요청 필드가 있습니다.");
  }
  if (typeof record.shareUrl !== "string") {
    throw invalidImportRequest("shareUrl 문자열이 필요합니다.");
  }

  const source = validateShareUrl(record.shareUrl);
  if (!source.valid) {
    throw new ChatGPTImportError(
      "INVALID_SHARE_URL",
      "A supported ChatGPT share URL is required.",
      400,
    );
  }

  const replace = parseReplacement(record.replace);
  return {
    ownerKey,
    normalizedUrl: source.normalizedUrl,
    shareId: source.shareId,
    ...(replace ? { replace } : {}),
  };
}

function parseReplacement(value: unknown): NoteImportReplacement | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidImportRequest("replace 형식을 확인해 주세요.");
  }

  const record = value as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter(
    (field) => field !== "noteId" && field !== "expectedUpdatedAt",
  );
  if (unknownFields.length > 0) {
    throw invalidImportRequest("replace에 지원하지 않는 필드가 있습니다.");
  }
  if (
    typeof record.noteId !== "string" ||
    !NOTE_ID_PATTERN.test(record.noteId)
  ) {
    throw invalidImportRequest("replace.noteId가 올바르지 않습니다.");
  }
  if (
    typeof record.expectedUpdatedAt !== "string" ||
    !isCanonicalIsoTimestamp(record.expectedUpdatedAt)
  ) {
    throw invalidImportRequest(
      "replace.expectedUpdatedAt이 올바르지 않습니다.",
    );
  }

  return {
    noteId: record.noteId,
    expectedUpdatedAt: record.expectedUpdatedAt,
  };
}

function isCanonicalIsoTimestamp(value: string): boolean {
  if (value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function invalidImportRequest(message: string): ChatGPTImportError {
  return new ChatGPTImportError("INVALID_REQUEST", message, 400);
}

async function readRequestBody(
  request: Request,
  maxBytes: number,
): Promise<string> {
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

function workflowErrorMessage(code: NoteImportWorkflowError["code"]): string {
  switch (code) {
    case "NOTE_CHANGED_SINCE_CONFIRMATION":
      return "확인 후 기존 노트가 변경되었습니다. 최신 노트를 확인한 뒤 다시 시도해 주세요.";
    case "IMPORTED_SOURCE_MISMATCH":
      return "가져온 대화의 출처를 확인하지 못했습니다. 다시 시도해 주세요.";
  }
}

function summaryGenerationErrorMessage(error: SummaryGenerationError): string {
  if (error.httpStatus === 429) {
    return "요약 요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (error.httpStatus === 408 || error.httpStatus === 504) {
    return "대화를 요약하는 데 시간이 너무 오래 걸렸습니다. 다시 시도해 주세요.";
  }
  if (error.httpStatus === 422) {
    return "요약 결과를 안전하게 검증하지 못했습니다. 다시 시도해 주세요.";
  }
  if (error.httpStatus === 503) {
    return "요약 서비스를 사용할 수 없습니다. Gemini 연결 설정을 확인해 주세요.";
  }
  return "대화를 요약하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function stateNoteGenerationErrorMessage(
  error: StateNoteGenerationError,
): string {
  if (error.httpStatus === 429) {
    return "상태 노트 요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (error.httpStatus === 408 || error.httpStatus === 504) {
    return "대화의 현재 상태를 정리하는 데 시간이 너무 오래 걸렸습니다. 다시 시도해 주세요.";
  }
  if (error.httpStatus === 422) {
    return "상태 노트의 근거와 흐름을 안전하게 검증하지 못했습니다. 다시 시도해 주세요.";
  }
  if (error.httpStatus === 503) {
    return "상태 노트 서비스를 사용할 수 없습니다. Gemini 연결 설정을 확인해 주세요.";
  }
  return "상태 노트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}
