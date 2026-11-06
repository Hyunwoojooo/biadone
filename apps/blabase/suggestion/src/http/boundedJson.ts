export type BoundedJsonReadFailureCode =
  | "INVALID_CONTENT_TYPE"
  | "MISSING_CONTENT_LENGTH"
  | "CONTENT_LENGTH_TOO_LARGE"
  | "CONTENT_LENGTH_MISMATCH"
  | "INVALID_JSON";

export type BoundedJsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; code: BoundedJsonReadFailureCode };

const EXACT_JSON_CONTENT_TYPE =
  /^application\/json(?:\s*;\s*charset=utf-8)?$/u;

export async function readBoundedJsonRequest(
  request: Request,
  maxBytes: number
): Promise<BoundedJsonReadResult> {
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (
    contentType === undefined ||
    !EXACT_JSON_CONTENT_TYPE.test(contentType)
  ) {
    return { ok: false, code: "INVALID_CONTENT_TYPE" };
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength === null ||
    !/^[1-9][0-9]{0,6}$/u.test(contentLength)
  ) {
    return { ok: false, code: "MISSING_CONTENT_LENGTH" };
  }
  const declaredLength = Number(contentLength);
  if (declaredLength > maxBytes) {
    return { ok: false, code: "CONTENT_LENGTH_TOO_LARGE" };
  }
  if (request.body === null) return { ok: false, code: "INVALID_JSON" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return { ok: false, code: "CONTENT_LENGTH_TOO_LARGE" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (bytesRead !== declaredLength) {
      return { ok: false, code: "CONTENT_LENGTH_MISMATCH" };
    }
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: "INVALID_JSON" };
  } finally {
    reader.releaseLock();
  }
}
