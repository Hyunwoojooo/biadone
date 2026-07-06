import { adapterError } from "./errors";

export type FetchShareHtmlInput = {
  url: string;
  timeoutMs?: number;
  userAgent?: string;
  maxBodyBytes?: number;
};

export type FetchShareHtmlOutput = {
  finalUrl: string;
  statusCode: number;
  html: string;
  fetchedAt: string;
  contentLength: number;
};

export async function fetchShareHtml(
  input: FetchShareHtmlInput
): Promise<FetchShareHtmlOutput> {
  if (process.env.CHATGPT_SHARE_FETCHER_URL) {
    return fetchShareHtmlViaFetcher(input);
  }

  return fetchShareHtmlDirect(input);
}

async function fetchShareHtmlViaFetcher(
  input: FetchShareHtmlInput
): Promise<FetchShareHtmlOutput> {
  const fetcherUrl = process.env.CHATGPT_SHARE_FETCHER_URL;
  const fetcherSecret = process.env.CHATGPT_SHARE_FETCHER_SECRET;

  if (!fetcherUrl) {
    throw adapterError("HTML_FETCH_FAILED", "CHATGPT_SHARE_FETCHER_URL is empty");
  }

  if (!fetcherSecret) {
    throw adapterError("HTML_FETCH_FAILED", "CHATGPT_SHARE_FETCHER_SECRET is required");
  }

  try {
    const response = await fetch(fetcherUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fetcherSecret}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ url: input.url }),
      redirect: "follow"
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      status?: number;
      finalUrl?: string;
      contentType?: string | null;
      html?: string;
      error?: string;
    };

    if (!response.ok || payload.ok === false) {
      throw adapterError(
        payload.status === 404 ? "SHARE_LINK_DELETED" : "SHARE_LINK_NOT_ACCESSIBLE",
        `ChatGPT share fetcher returned ${payload.status ?? response.status}: ${
          payload.error ?? "upstream fetch failed"
        }`
      );
    }

    if (typeof payload.html !== "string" || !payload.html.trim()) {
      throw adapterError("HTML_FETCH_FAILED", "Fetcher response did not include HTML");
    }

    return validateFetchedHtml({
      finalUrl: payload.finalUrl ?? input.url,
      statusCode: payload.status ?? response.status,
      html: payload.html,
      fetchedAt: new Date().toISOString(),
      contentType: payload.contentType ?? ""
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ChatGPTShareAdapterError") {
      throw error;
    }
    throw adapterError("HTML_FETCH_FAILED", "Failed to fetch share HTML via fetcher", error);
  }
}

async function fetchShareHtmlDirect(
  input: FetchShareHtmlInput
): Promise<FetchShareHtmlOutput> {
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxBodyBytes = input.maxBodyBytes ?? 20 * 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input.url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ko;q=0.8",
        "cache-control": "no-cache",
        "user-agent":
          input.userAgent ??
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw adapterError(
        response.status === 404 ? "SHARE_LINK_DELETED" : "SHARE_LINK_NOT_ACCESSIBLE",
        `ChatGPT share link returned HTTP ${response.status}`
      );
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (
      contentLengthHeader &&
      Number.parseInt(contentLengthHeader, 10) > maxBodyBytes
    ) {
      throw adapterError("HTML_FETCH_FAILED", "Response body is too large");
    }

    const html = await response.text();
    const contentLength = new TextEncoder().encode(html).byteLength;
    if (contentLength > maxBodyBytes) {
      throw adapterError("HTML_FETCH_FAILED", "Response body is too large");
    }

    return validateFetchedHtml({
      finalUrl: response.url,
      statusCode: response.status,
      html,
      fetchedAt: new Date().toISOString(),
      contentType: response.headers.get("content-type") ?? "",
      contentLength
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw adapterError("HTML_FETCH_FAILED", "Timed out fetching share HTML", error);
    }
    if (error instanceof Error && error.name === "ChatGPTShareAdapterError") {
      throw error;
    }
    throw adapterError("HTML_FETCH_FAILED", "Failed to fetch share HTML", error);
  } finally {
    clearTimeout(timeout);
  }
}

function validateFetchedHtml(input: {
  finalUrl: string;
  statusCode: number;
  html: string;
  fetchedAt: string;
  contentType: string;
  contentLength?: number;
}): FetchShareHtmlOutput {
  if (input.contentType && !input.contentType.includes("text/html")) {
    throw adapterError("HTML_FETCH_FAILED", "Response is not HTML");
  }

  if (!input.html.trim()) {
    throw adapterError("HTML_FETCH_FAILED", "HTML response is empty");
  }

  const contentLength =
    input.contentLength ?? new TextEncoder().encode(input.html).byteLength;

  return {
    finalUrl: input.finalUrl,
    statusCode: input.statusCode,
    html: input.html,
    fetchedAt: input.fetchedAt,
    contentLength
  };
}
