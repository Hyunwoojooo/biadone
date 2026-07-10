import { geminiProvider } from "./geminiProvider";
import { openAiProvider } from "./openaiProvider";
import { qwenProvider } from "./qwenProvider";
import type { LlmProviderId, LlmShadowProvider } from "./types";

const providers: Record<LlmProviderId, LlmShadowProvider> = {
  gemini: geminiProvider,
  openai: openAiProvider,
  qwen: qwenProvider
};

export function getLlmProvider(id: LlmProviderId): LlmShadowProvider {
  return providers[id];
}

export { LlmProviderError } from "./types";
export type {
  LlmProviderId,
  LlmProviderRequest,
  LlmProviderResponse,
  LlmShadowProvider
} from "./types";
