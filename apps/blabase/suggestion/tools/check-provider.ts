import { loadSharedLocalEnv } from "../src/localEnv";
import {
  generateTaskCandidates,
  readSuggestionProviderConfig,
  SuggestionProviderError
} from "../src/provider";
import { rawTaskOutputSchema } from "../src/schema";

loadSharedLocalEnv();
const provider = readSuggestionProviderConfig();
const compatibilityChecks =
  provider.id === "gemini"
    ? await checkGeminiCompatibility(provider)
    : [];

try {
  const response = await generateTaskCandidates(
    provider,
    [
      "This is a configuration health check.",
      "There is no conversation and therefore no task.",
      'Return exactly {"candidates":[]}.'
    ].join("\n")
  );
  const parsed = rawTaskOutputSchema.safeParse(JSON.parse(response.outputText));
  console.log(
    JSON.stringify({
      provider: provider.id,
      model: response.responseModel ?? provider.model,
      compatibilityChecks,
      requestSucceeded: true,
      schemaSucceeded: parsed.success,
      schemaIssuePaths: parsed.success
        ? []
        : parsed.error.issues.map((issue) => issue.path.join("."))
    })
  );
} catch (error) {
  console.log(
    JSON.stringify({
      provider: provider.id,
      model: provider.model,
      compatibilityChecks,
      requestSucceeded: false,
      errorCode:
        error instanceof SuggestionProviderError
          ? error.code
          : "UNKNOWN_ERROR",
      errorMessage:
        error instanceof Error ? error.message : "Unknown provider error"
    })
  );
  process.exitCode = 1;
}

async function checkGeminiCompatibility(config: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}) {
  const variants = [
    { name: "base", format: false, generation: false },
    { name: "response_format", format: true, generation: false },
    { name: "generation_config", format: false, generation: true },
    { name: "format_and_generation", format: true, generation: true }
  ];
  const results = [];
  for (const variant of variants) {
    results.push({
      name: variant.name,
      ...(await checkGeminiVariant(config, variant))
    });
  }
  return results;
}

async function checkGeminiVariant(
  config: {
    apiKey: string;
    model: string;
    baseUrl?: string;
  },
  variant: { format: boolean; generation: boolean }
) {
  const baseUrl = (
    config.baseUrl ?? "https://generativelanguage.googleapis.com/v1"
  ).replace(/\/+$/, "");
  const body: Record<string, unknown> = {
    model: config.model,
    input: 'Return exactly {"candidates":[]}.',
    system_instruction: "Return only JSON.",
    store: false
  };
  if (variant.format) {
    body.response_format = {
      type: "text",
      mime_type: "application/json",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["candidates"],
        properties: {
          candidates: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    };
  }
  if (variant.generation) {
    body.generation_config = {
      thinking_level: "minimal",
      thinking_summaries: "none"
    };
  }
  const response = await fetch(`${baseUrl}/interactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.apiKey
    },
    body: JSON.stringify(body)
  });
  return { ok: response.ok, status: response.status };
}
