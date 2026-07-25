import { loadSharedLocalEnv } from "../src/localEnv";
import { readSuggestionProviderConfig } from "../src/provider";

loadSharedLocalEnv();
const provider = readSuggestionProviderConfig();

console.log(
  JSON.stringify({
    provider: provider.id,
    model: provider.model,
    apiKeyConfigured: provider.apiKey.length > 0,
    shareFetcherUrlConfigured: Boolean(process.env.CHATGPT_SHARE_FETCHER_URL),
    shareFetcherSecretConfigured: Boolean(
      process.env.CHATGPT_SHARE_FETCHER_SECRET
    )
  })
);
