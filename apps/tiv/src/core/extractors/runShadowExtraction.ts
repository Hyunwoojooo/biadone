import type { CanonicalConversation } from "../types/conversation";
import type { HybridExtractionResult } from "../types/semantic";
import type { MockStructureResult } from "../types/structures";
import { extractLlmShadow, type LlmShadowExtractorOptions } from "./llmShadowExtractor";
import { convertRuleResultToSemanticItems } from "./ruleSemanticAdapter";

export async function runShadowExtraction(input: {
  conversation: CanonicalConversation;
  ruleResult: MockStructureResult;
  llmOptions?: LlmShadowExtractorOptions;
  now?: () => string;
}): Promise<HybridExtractionResult> {
  const ruleItems = convertRuleResultToSemanticItems(input.ruleResult);
  const llmResult = await extractLlmShadow(input.conversation, input.llmOptions);

  return {
    mode: "shadow",
    createdAt: input.now?.() ?? new Date().toISOString(),
    ruleResult: {
      extractorVersion: input.ruleResult.extractor.version,
      items: ruleItems
    },
    llmResult
  };
}
