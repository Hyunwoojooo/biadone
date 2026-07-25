import type { SuggestionRequest } from "./schema";

const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com"]);

export type NormalizedSuggestionRequest = {
  shareUrls: string[];
  duplicateCount: number;
};

export class SuggestionRequestError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SHARE_URL"
      | "NOT_ENOUGH_UNIQUE_URLS"
      | "TOO_MANY_URLS",
    message: string
  ) {
    super(message);
    this.name = "SuggestionRequestError";
  }
}

export function normalizeSuggestionRequest(
  input: SuggestionRequest
): NormalizedSuggestionRequest {
  const normalized = input.shareUrls.map(normalizeChatGptShareUrl);
  const unique = [...new Set(normalized)];

  if (unique.length < 3) {
    throw new SuggestionRequestError(
      "NOT_ENOUGH_UNIQUE_URLS",
      "중복을 제외한 ChatGPT 공유 URL이 3개 이상 필요합니다."
    );
  }
  if (unique.length > 10) {
    throw new SuggestionRequestError(
      "TOO_MANY_URLS",
      "ChatGPT 공유 URL은 최대 10개까지 입력할 수 있습니다."
    );
  }

  return {
    shareUrls: unique,
    duplicateCount: normalized.length - unique.length
  };
}

export function normalizeChatGptShareUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SuggestionRequestError(
      "INVALID_SHARE_URL",
      "올바른 ChatGPT 공유 URL을 입력해주세요."
    );
  }

  if (
    url.protocol !== "https:" ||
    !CHATGPT_HOSTS.has(url.hostname.toLowerCase()) ||
    !/^\/share\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new SuggestionRequestError(
      "INVALID_SHARE_URL",
      "지원되는 형식은 https://chatgpt.com/share/... 입니다."
    );
  }

  url.hostname = "chatgpt.com";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}
