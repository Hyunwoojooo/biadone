import {
  ChatGPTShareAdapterError,
  importChatGPTShareUrl
} from "../../src/core/adapters/chatgpt-share";

import type {
  RestoredConversation,
  SourceStatus
} from "./types";

const RESTORE_CONCURRENCY = 3;

export type RestoreBatchResult = {
  restored: RestoredConversation[];
  sources: SourceStatus[];
};

export async function restoreConversations(
  shareUrls: string[]
): Promise<RestoreBatchResult> {
  const results = await mapWithConcurrency(
    shareUrls.map((url, inputIndex) => ({ url, inputIndex })),
    RESTORE_CONCURRENCY,
    async ({ url, inputIndex }) => {
      try {
        const result = await importChatGPTShareUrl({ url });
        const usableMessages = result.conversation.messages.filter(
          (message) =>
            message.role === "user" &&
            message.metadata.messageCategory === "clean_conversation" &&
            message.metadata.semanticAnalyzable !== false &&
            message.text.trim().length > 0
        );
        if (usableMessages.length === 0) {
          return {
            restored: null,
            source: failedSource(
              inputIndex,
              "NO_ANALYZABLE_USER_MESSAGES",
              "분석 가능한 사용자 메시지가 없습니다."
            )
          };
        }

        return {
          restored: {
            inputIndex,
            conversation: result.conversation
          } satisfies RestoredConversation,
          source: {
            inputIndex,
            status: "restored",
            conversationId: result.conversation.id,
            title: result.conversation.title,
            messageCount: result.conversation.stats.cleanConversationMessages,
            errorCode: null,
            errorMessage: null
          } satisfies SourceStatus
        };
      } catch (error) {
        const normalized = normalizeRestoreError(error);
        return {
          restored: null,
          source: failedSource(
            inputIndex,
            normalized.code,
            normalized.message
          )
        };
      }
    }
  );

  return {
    restored: results
      .map((result) => result.restored)
      .filter((value): value is RestoredConversation => value !== null),
    sources: results
      .map((result) => result.source)
      .sort((left, right) => left.inputIndex - right.inputIndex)
  };
}

function failedSource(
  inputIndex: number,
  errorCode: string,
  errorMessage: string
): SourceStatus {
  return {
    inputIndex,
    status: "failed",
    conversationId: null,
    title: null,
    messageCount: null,
    errorCode,
    errorMessage
  };
}

function normalizeRestoreError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof ChatGPTShareAdapterError) {
    return {
      code: error.code,
      message: userMessageForCode(error.code)
    };
  }
  return {
    code: "RESTORE_FAILED",
    message: "대화를 복원하지 못했습니다."
  };
}

function userMessageForCode(code: string): string {
  switch (code) {
    case "INVALID_SHARE_URL":
      return "올바른 ChatGPT 공유 URL이 아닙니다.";
    case "SHARE_LINK_DELETED":
      return "삭제된 공유 대화입니다.";
    case "SHARE_LINK_NOT_ACCESSIBLE":
    case "HTML_FETCH_FAILED":
      return "공유 대화에 접근하지 못했습니다.";
    case "NO_MESSAGES_FOUND":
    case "LINEAR_CONVERSATION_NOT_FOUND":
      return "복원 가능한 대화 메시지를 찾지 못했습니다.";
    default:
      return "대화를 복원하지 못했습니다.";
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker()
    )
  );
  return output;
}
