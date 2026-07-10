export type LlmProviderId = "openai" | "qwen" | "gemini";

export type LlmProviderRequest = {
  apiKey: string;
  model: string;
  prompt: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
};

export interface LlmShadowProvider {
  readonly id: LlmProviderId;
  generateJson(request: LlmProviderRequest): Promise<string>;
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
