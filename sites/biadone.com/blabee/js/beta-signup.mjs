// A publishable key identifies this public form; database grants protect the data.
export async function requestBetaAccess(email, {
  endpoint,
  publishableKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
}, attribution = null) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254) {
    throw new Error("Invalid email address");
  }
  if (!endpoint?.startsWith("https://") || !publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("Beta signup is not configured");
  }

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
      body: JSON.stringify({
        p_email: normalizedEmail,
        ...(attribution === null ? {} : { p_attribution: attribution }),
      }),
    });
    if (!response.ok) throw new Error("Beta request failed");
    const result = await response.json();
    if (result?.accepted !== true) throw new Error("Beta request was not confirmed");
  } finally {
    clearTimeout(timer);
  }
}
