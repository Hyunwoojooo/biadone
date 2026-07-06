import type { AnalysisErrorCode } from "../../types/errors";

export class ChatGPTShareAdapterError extends Error {
  readonly code: AnalysisErrorCode;
  readonly causeValue?: unknown;

  constructor(code: AnalysisErrorCode, message: string, causeValue?: unknown) {
    super(message);
    this.name = "ChatGPTShareAdapterError";
    this.code = code;
    this.causeValue = causeValue;
  }
}

export function adapterError(
  code: AnalysisErrorCode,
  message: string,
  causeValue?: unknown
): ChatGPTShareAdapterError {
  return new ChatGPTShareAdapterError(code, message, causeValue);
}
