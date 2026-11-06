import { createClient } from "@supabase/supabase-js";
import type { AccountOptions } from "./auth.ts";
import type { PublicConfig } from "./config.ts";

export function createAccountClient(config: PublicConfig) {
  return createClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      // The controller exchanges the callback code once and owns error handling.
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export function createOAuthOptions(config: PublicConfig, navigate: (url: string) => void, fetcher: typeof fetch = fetch): AccountOptions {
  return {
    authorizeUrl: new URL("/auth/v1/authorize", config.url).href,
    async isProviderEnabled(provider) {
      const response = await fetcher(new URL("/auth/v1/settings", config.url), {
        headers: { apikey: config.publishableKey },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Authentication settings unavailable");
      const settings: unknown = await response.json();
      if (!settings || typeof settings !== "object" || !("external" in settings)
        || !settings.external || typeof settings.external !== "object"
        || !(provider in settings.external) || typeof Reflect.get(settings.external, provider) !== "boolean") {
        throw new Error("Invalid authentication settings");
      }
      return Reflect.get(settings.external, provider) === true;
    },
    navigate,
  };
}
