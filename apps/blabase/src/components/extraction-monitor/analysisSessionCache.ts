import type { AnalysisMonitorPayload } from "@/core/transport/analysisMonitorPayload";

const storagePrefix = "blabase.analysis.";
const memoryCache = new Map<string, AnalysisMonitorPayload>();

export function cacheAnalysisMonitorPayload(
  analysisId: string,
  payload: AnalysisMonitorPayload
) {
  memoryCache.set(analysisId, payload);

  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      `${storagePrefix}${analysisId}`,
      JSON.stringify(payload)
    );
  } catch {
    // Large conversations can exceed sessionStorage. The in-page cache still
    // preserves the payload across the client-side navigation.
  }
}

export function readAnalysisMonitorPayload(
  analysisId: string
): AnalysisMonitorPayload | null {
  const cached = memoryCache.get(analysisId);
  if (cached) return cached;

  if (typeof window === "undefined") return null;

  const storageKey = `${storagePrefix}${analysisId}`;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;

    const payload = JSON.parse(raw) as AnalysisMonitorPayload;
    if (
      payload.result?.analysisId !== analysisId ||
      payload.messages?.analysisId !== analysisId
    ) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    memoryCache.set(analysisId, payload);
    return payload;
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return null;
  }
}
