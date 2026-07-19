import { createServer } from "node:http";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3201", 10);
const secret = process.env.CHATGPT_SHARE_FETCHER_SECRET;
const maxBodyBytes = Number.parseInt(
  process.env.CHATGPT_SHARE_FETCHER_MAX_BODY_BYTES ?? String(20 * 1024 * 1024),
  10
);

if (!secret) {
  console.error("CHATGPT_SHARE_FETCHER_SECRET is required.");
  process.exit(1);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== "POST" || requestUrl.pathname !== "/fetch-chatgpt-share") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    if (request.headers.authorization !== `Bearer ${secret}`) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    const body = await readJsonBody(request, 64 * 1024);
    const shareUrl = validateShareUrl(String(body.url ?? ""));

    const startedAt = Date.now();
    const upstream = await fetch(shareUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ko;q=0.8",
        "cache-control": "no-cache",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      },
      redirect: "follow"
    });
    const html = await readResponseText(upstream, maxBodyBytes);

    sendJson(response, upstream.ok ? 200 : 502, {
      ok: upstream.ok,
      status: upstream.status,
      finalUrl: upstream.url,
      contentType: upstream.headers.get("content-type"),
      elapsedMs: Date.now() - startedAt,
      html
    });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "unknown_error"
    });
  }
});

server.listen(port, host, () => {
  console.log(`chatgpt-fetcher listening on http://${host}:${port}`);
});

function validateShareUrl(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("invalid_url");
  }

  if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") {
    throw new Error("unsupported_url");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "share" || !parts[1]) {
    throw new Error("unsupported_path");
  }

  return `https://chatgpt.com/share/${encodeURIComponent(parts[1])}`;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, limitBytes) {
  let bytes = 0;
  const chunks = [];

  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limitBytes) {
      throw new Error("request_body_too_large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

async function readResponseText(response, limitBytes) {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  let bytes = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > limitBytes) {
      throw new Error("upstream_body_too_large");
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(concatUint8Arrays(chunks, bytes));
}

function concatUint8Arrays(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
