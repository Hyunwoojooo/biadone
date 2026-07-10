import type { LlmTokenUsage } from "../../types/semantic";

export type LlmProviderId = "openai" | "qwen" | "gemini";

export type LlmProviderRequest = {
  apiKey: string;
  model: string;
  prompt: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
};

export type LlmProviderResponse = {
  outputText: string;
  requestId: string | null;
  responseModel: string | null;
  usage: LlmTokenUsage;
};

export interface LlmShadowProvider {
  readonly id: LlmProviderId;
  generateJson(request: LlmProviderRequest): Promise<LlmProviderResponse>;
}

export class LlmProviderError extends Error {
  constructor(
    public readonly provider: LlmProviderId,
    public readonly status: number | null,
    message: string
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
