export interface PublicConfig {
  url: string;
  publishableKey: string;
}

export function readConfig(env: Record<string, string | undefined>): PublicConfig {
  const url = new URL(env.VITE_SUPABASE_URL?.trim() ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("VITE_SUPABASE_URL must be an HTTPS origin.");
  }
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error("A Supabase publishable key is required for the browser client.");
  }
  return { url: url.origin, publishableKey };
}

export interface AuthCallback {
  code: string | null;
  failed: boolean;
}

export function consumeCallback(url: URL, replaceUrl: (path: string) => void): AuthCallback {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get("code");
  const failed = ["error", "error_code", "error_description"].some((key) => url.searchParams.has(key) || fragment.has(key))
    || fragment.has("access_token") || url.searchParams.has("token_hash");
  if (url.search || url.hash) replaceUrl(url.pathname);
  return { code, failed };
}
