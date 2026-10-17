const CACHE_KEY = "blabee.landing-attribution.v1";
const CACHE_TTL_MS = 30 * 60 * 1000;
const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
const ATTRIBUTION_FIELDS = [...UTM_FIELDS, "referrer_host"];
const SLUG = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function emptyAttribution() {
  return Object.fromEntries(ATTRIBUTION_FIELDS.map((field) => [field, ""]));
}

function normalizeSlug(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return SLUG.test(normalized) ? normalized : "";
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// Capture attribution first, then remove only our tags from the visible URL.
export function getCleanLandingPath(url) {
  const parsed = parseUrl(url);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)
    || !UTM_FIELDS.some((field) => parsed.searchParams.has(field))) return null;
  for (const field of UTM_FIELDS) parsed.searchParams.delete(field);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function canonicalHost(host) {
  return host.toLowerCase().replace(/\.$/, "");
}

function externalHost(host, currentHost) {
  const normalized = canonicalHost(host);
  const labels = normalized.split(".");
  if (!normalized || normalized.length > 253 || labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return "";
  const parsed = parseUrl(`https://${normalized}/`);
  if (!parsed || canonicalHost(parsed.hostname) !== normalized) return "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return "";
  if (["localhost", "local", "internal", "biadone.com", "www.biadone.com", currentHost].includes(normalized)) return "";
  if ([".localhost", ".local", ".internal"].some((suffix) => normalized.endsWith(suffix))) return "";
  return normalized;
}

function referrerHost(referrer, currentHost) {
  const parsed = parseUrl(referrer);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return "";
  return externalHost(parsed.hostname, currentHost);
}

function validateAttribution(value, currentHost = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (fields.length !== ATTRIBUTION_FIELDS.length || fields.some((field) => !ATTRIBUTION_FIELDS.includes(field))) return null;
  const result = emptyAttribution();
  for (const field of UTM_FIELDS) {
    if (typeof value[field] !== "string" || (value[field] && normalizeSlug(value[field]) !== value[field])) return null;
    result[field] = value[field];
  }
  if (typeof value.referrer_host !== "string") return null;
  if (value.referrer_host && externalHost(value.referrer_host, currentHost) !== value.referrer_host) return null;
  result.referrer_host = value.referrer_host;
  return result;
}

function removeCache(storage) {
  try {
    storage?.removeItem(CACHE_KEY);
  } catch {
    // Storage can be unavailable in privacy modes.
  }
}

function restoreCache(storage, now, currentHost) {
  try {
    const raw = storage?.getItem(CACHE_KEY);
    if (raw == null) return null;
    const cached = JSON.parse(raw);
    const fields = cached && typeof cached === "object" ? Object.keys(cached) : [];
    if (fields.length !== 2 || !fields.includes("attribution") || !fields.includes("expiresAt")) throw new Error("Invalid cache");
    if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= now || cached.expiresAt > now + CACHE_TTL_MS) throw new Error("Expired cache");
    const attribution = validateAttribution(cached.attribution, currentHost);
    if (!attribution || !Object.values(attribution).some(Boolean)) throw new Error("Invalid attribution");
    return attribution;
  } catch {
    removeCache(storage);
    return null;
  }
}

// Only approved campaign slugs and an external hostname survive this boundary.
export function getLandingAttribution({ url, referrer = "", storage = null, now = Date.now(), privacyEnabled = false, navigationType = "navigate" } = {}) {
  if (privacyEnabled) {
    removeCache(storage);
    return null;
  }
  const timestamp = Number.isFinite(now) ? now : Date.now();
  const parsed = parseUrl(url);
  const currentHost = parsed ? canonicalHost(parsed.hostname) : "";
  const attribution = emptyAttribution();
  for (const field of UTM_FIELDS) attribution[field] = normalizeSlug(parsed?.searchParams.get(field));
  // Reload/history can retain the original external referrer after URL cleanup.
  // Reuse valid campaign metadata instead of replacing it with that hostname.
  if (!UTM_FIELDS.some((field) => attribution[field]) && ["reload", "back_forward"].includes(navigationType)) {
    const cached = restoreCache(storage, timestamp, currentHost);
    if (cached) return cached;
  }
  attribution.referrer_host = referrerHost(referrer, currentHost);

  if (Object.values(attribution).some(Boolean)) {
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify({ attribution, expiresAt: timestamp + CACHE_TTL_MS }));
    } catch {
      // Attribution still works when sessionStorage is blocked or full.
    }
    return attribution;
  }
  return restoreCache(storage, timestamp, currentHost) ?? attribution;
}

// No automatic retry: the server increments a view count for each accepted call.
export async function recordLandingView(attribution, {
  endpoint,
  publishableKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000,
} = {}) {
  if (attribution === null) return;
  const destination = typeof endpoint === "string" ? parseUrl(endpoint) : null;
  if (!destination || destination.protocol !== "https:" || destination.username || destination.password
    || typeof publishableKey !== "string" || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)
    || typeof fetchImpl !== "function") {
    throw new Error("Landing view tracking is not configured");
  }
  const validated = validateAttribution(attribution);
  if (!validated) throw new Error("Invalid landing attribution");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid request timeout");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey,
      },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      body: JSON.stringify({ p_attribution: validated }),
    });
    if (!response.ok) throw new Error("Landing view request failed");
    const result = await response.json();
    if (result?.accepted !== true) throw new Error("Landing view was not confirmed");
  } finally {
    clearTimeout(timer);
  }
}
