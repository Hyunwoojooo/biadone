export const ATTENTION_LOCAL_URL = "http://localhost:3102";

const LOCAL_ATTENTION_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1"
]);

export function isLocalAttentionRequest(request: Request): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    LOCAL_ATTENTION_HOSTNAMES.has(new URL(request.url).hostname)
  );
}

export function hasSafeReadOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

export function hasSameAttentionOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
