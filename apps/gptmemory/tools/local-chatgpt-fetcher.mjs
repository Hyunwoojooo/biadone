import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";

const ENDPOINT_PATH = "/fetch-chatgpt-share";
const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const MAX_REDIRECTS = 5;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

export async function startLocalChatGPTFetcher({
  host = "127.0.0.1",
  port = 0,
  secret,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  maxBodyBytes = 12 * 1024 * 1024,
} = {}) {
  assertServerOptions({ host, port });
  const handler = createLocalChatGPTFetcherHandler({
    secret,
    fetchImpl,
    timeoutMs,
    maxBodyBytes,
  });
  const server = createServer((request, response) => {
    void forwardNodeRequest(request, response, handler);
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  let resolveClosed;
  let rejectClosed;
  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  // Keep the returned rejecting promise observable without creating an
  // unhandled-rejection hazard when a caller only uses close().
  void closed.catch(() => undefined);
  server.once("close", () => resolveClosed());
  server.on("error", (error) => rejectClosed(error));

  await listen(server, host, port);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("The local ChatGPT fetcher did not bind to a TCP port.");
  }

  const urlHost = host.includes(":") ? `[${host}]` : host;
  let closeRequested = false;
  return {
    url: `http://${urlHost}:${address.port}${ENDPOINT_PATH}`,
    closed,
    async close() {
      if (closeRequested) return closed;
      closeRequested = true;
      await closeServer(server);
      return closed;
    },
  };
}

/**
 * Dependency-free request core used by the TCP bridge and unit tests. It is
 * exported so the complete auth/SSRF/fetch contract remains testable in
 * sandboxes that prohibit binding even to a loopback port.
 */
export function createLocalChatGPTFetcherHandler({
  secret,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  maxBodyBytes = 12 * 1024 * 1024,
} = {}) {
  assertHandlerOptions({ secret, fetchImpl, timeoutMs, maxBodyBytes });

  return async function handle(request) {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname !== ENDPOINT_PATH || requestUrl.search) {
        return jsonResponse(404, failurePayload(404, "NOT_FOUND"));
      }
      if (request.method !== "POST") {
        return jsonResponse(405, failurePayload(405, "METHOD_NOT_ALLOWED"), {
          allow: "POST",
        });
      }
      if (!isAuthorized(request.headers.get("authorization"), secret)) {
        return jsonResponse(401, failurePayload(401, "UNAUTHORIZED"));
      }
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        await request.body?.cancel();
        return jsonResponse(415, failurePayload(415, "JSON_REQUIRED"));
      }

      const body = await readRequestJson(request);
      const validated = validateShareRequest(body);
      const upstream = await fetchShareHtml(validated, {
        fetchImpl,
        timeoutMs,
        maxBodyBytes,
      });
      return jsonResponse(200, {
        ok: true,
        status: upstream.status,
        finalUrl: upstream.finalUrl,
        contentType: upstream.contentType,
        html: upstream.html,
      });
    } catch (error) {
      if (error instanceof BridgeError) {
        return jsonResponse(
          error.httpStatus,
          failurePayload(
            error.upstreamStatus ?? error.httpStatus,
            error.code,
            error.finalUrl,
            error.contentType,
          ),
        );
      }
      return jsonResponse(502, failurePayload(502, "UPSTREAM_FETCH_FAILED"));
    }
  };
}

async function forwardNodeRequest(nodeRequest, nodeResponse, handler) {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(nodeRequest.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }
    const method = nodeRequest.method ?? "GET";
    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = Readable.toWeb(nodeRequest);
      init.duplex = "half";
    }
    const request = new Request(
      new URL(nodeRequest.url ?? "/", "http://localhost"),
      init,
    );
    const response = await handler(request);
    await writeNodeResponse(nodeResponse, response);
  } catch {
    if (!nodeResponse.headersSent && !nodeResponse.destroyed) {
      await writeNodeResponse(
        nodeResponse,
        jsonResponse(500, failurePayload(500, "LOCAL_BRIDGE_FAILURE")),
      );
    }
  }
}

async function writeNodeResponse(nodeResponse, response) {
  if (nodeResponse.destroyed) return;
  const headers = {};
  for (const [name, value] of response.headers) headers[name] = value;
  nodeResponse.writeHead(response.status, headers);
  if (!response.body) {
    nodeResponse.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!nodeResponse.write(Buffer.from(chunk.value))) {
        await new Promise((resolve) => nodeResponse.once("drain", resolve));
      }
    }
    nodeResponse.end();
  } finally {
    reader.releaseLock();
  }
}

async function fetchShareHtml(source, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let currentUrl = source.normalizedUrl;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await options.fetchImpl(currentUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9",
          "accept-language": "ko,en-US;q=0.9,en;q=0.8",
          "cache-control": "no-cache",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/126.0.0.0 Safari/537.36",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      const observedFinalUrl = response.url || currentUrl;
      const finalSource = validateShareUrl(observedFinalUrl);
      if (!finalSource || finalSource.shareId !== source.shareId) {
        await cancelResponseBody(response);
        throw new BridgeError("UNSAFE_REDIRECT", 502);
      }

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          await cancelResponseBody(response);
          throw new BridgeError("INVALID_REDIRECT", 502);
        }
        let nextUrl;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          await cancelResponseBody(response);
          throw new BridgeError("INVALID_REDIRECT", 502);
        }
        const nextSource = validateShareUrl(nextUrl);
        if (!nextSource || nextSource.shareId !== source.shareId) {
          await cancelResponseBody(response);
          throw new BridgeError("UNSAFE_REDIRECT", 502);
        }
        if (redirectCount === MAX_REDIRECTS) {
          await cancelResponseBody(response);
          throw new BridgeError("TOO_MANY_REDIRECTS", 502);
        }
        await cancelResponseBody(response);
        currentUrl = nextSource.normalizedUrl;
        continue;
      }

      const upstreamContentType = response.headers.get("content-type");
      if (response.status < 200 || response.status >= 300) {
        await cancelResponseBody(response);
        throw new BridgeError(
          "UPSTREAM_STATUS",
          response.status,
          response.status,
          finalSource.normalizedUrl,
          upstreamContentType,
        );
      }
      if (!isHtmlContentType(upstreamContentType)) {
        await cancelResponseBody(response);
        throw new BridgeError(
          "UPSTREAM_NOT_HTML",
          502,
          undefined,
          finalSource.normalizedUrl,
          upstreamContentType,
        );
      }

      const html = await readUpstreamText(response, options.maxBodyBytes);
      return {
        status: response.status,
        finalUrl: finalSource.normalizedUrl,
        contentType: upstreamContentType,
        html,
      };
    }
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      throw new BridgeError("UPSTREAM_TIMEOUT", 504);
    }
    throw new BridgeError("UPSTREAM_FETCH_FAILED", 502);
  } finally {
    clearTimeout(timeout);
  }

  throw new BridgeError("TOO_MANY_REDIRECTS", 502);
}

async function readRequestJson(request) {
  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    await request.body?.cancel();
    throw new BridgeError("REQUEST_TOO_LARGE", 413);
  }
  if (!request.body) throw new BridgeError("INVALID_JSON", 400);

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new BridgeError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BridgeError("INVALID_JSON", 400);
  }
}

async function readUpstreamText(response, maxBodyBytes) {
  const contentLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    await cancelResponseBody(response);
    throw new BridgeError("UPSTREAM_TOO_LARGE", 413);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBodyBytes) {
      throw new BridgeError("UPSTREAM_TOO_LARGE", 413);
    }
    return new TextDecoder().decode(bytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let html = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel();
        throw new BridgeError("UPSTREAM_TOO_LARGE", 413);
      }
      html += decoder.decode(chunk.value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort and must not replace the primary error.
  }
}

function validateShareRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BridgeError("INVALID_REQUEST", 400);
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "url" || typeof body.url !== "string") {
    throw new BridgeError("INVALID_REQUEST", 400);
  }
  const source = validateShareUrl(body.url);
  if (!source) throw new BridgeError("INVALID_SHARE_URL", 400);
  return source;
}

function validateShareUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "chatgpt.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  const match = /^\/share\/([^/]+)\/?$/.exec(url.pathname);
  const shareId = match?.[1] ?? "";
  if (!SHARE_ID_PATTERN.test(shareId)) return null;
  return {
    shareId,
    normalizedUrl: `https://chatgpt.com/share/${shareId}`,
  };
}

function isAuthorized(authorization, secret) {
  if (typeof authorization !== "string") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function isHtmlContentType(contentType) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("text/html") ||
    normalized.includes("application/xhtml+xml")
  );
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

function failurePayload(status, code, finalUrl, contentType) {
  return {
    ok: false,
    status,
    ...(finalUrl ? { finalUrl } : {}),
    ...(contentType ? { contentType } : {}),
    error: { code },
  };
}

function jsonResponse(status, payload, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function assertServerOptions({ host, port }) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new TypeError("host must be an explicit loopback address.");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("port must be an integer from 0 through 65535.");
  }
}

function assertHandlerOptions({ secret, fetchImpl, timeoutMs, maxBodyBytes }) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("secret is required.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer.");
  }
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new TypeError("maxBodyBytes must be a positive integer.");
  }
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port, exclusive: true });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeIdleConnections?.();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

class BridgeError extends Error {
  constructor(
    code,
    httpStatus,
    upstreamStatus,
    finalUrl,
    contentType,
  ) {
    super(code);
    this.name = "BridgeError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.upstreamStatus = upstreamStatus;
    this.finalUrl = finalUrl;
    this.contentType = contentType;
  }
}
