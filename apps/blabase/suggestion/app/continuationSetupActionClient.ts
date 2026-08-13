const ISSUE_ENDPOINT = "/api/continuation/offers";
const OPEN_ENDPOINT = "/api/continuation/open";
const MAX_RESPONSE_BYTES = 4_096;
const ACTION_API_CONTRACT = "continuation-setup-action-api-v0.1";
const PUBLIC_ITEM_REF_PATTERN = /^item_ref_[A-Za-z0-9_-]{22,128}$/u;
const SETUP_OFFER_ID_PATTERN = /^continuation_setup_offer_[a-f0-9]{64}$/u;

type ContinuationSetupOfferResponse = {
  contract: typeof ACTION_API_CONTRACT;
  status: "issued";
  offerId: string;
  expiresAt: string;
};

export type ContinuationSetupOpenedResponse = {
  contract: typeof ACTION_API_CONTRACT;
  status: "opened";
  destination: "project_mappings";
  navigateTo: "/projects";
};

export class ContinuationSetupActionRequestError extends Error {
  constructor() {
    super("CONTINUATION_SETUP_ACTION_UNAVAILABLE");
    this.name = "ContinuationSetupActionRequestError";
  }
}

/**
 * Issues and consumes one setup-only action offer after an explicit click.
 * The private offer handle remains scoped to this call and is never returned.
 */
export async function requestContinuationSetupAction(input: {
  itemRef: string;
  explicitUserAction: true;
}): Promise<ContinuationSetupOpenedResponse> {
  if (
    input.explicitUserAction !== true ||
    !PUBLIC_ITEM_REF_PATTERN.test(input.itemRef)
  ) {
    throw new ContinuationSetupActionRequestError();
  }

  const issued = parseIssuedResponse(
    await postJson(ISSUE_ENDPOINT, 201, {
      itemRef: input.itemRef,
      explicitUserAction: true
    })
  );
  const opened = parseOpenedResponse(
    await postJson(OPEN_ENDPOINT, 200, {
      offerId: issued.offerId,
      explicitUserAction: true
    })
  );
  return opened;
}

export function isContinuationSetupOpenedResponse(
  value: unknown
): value is ContinuationSetupOpenedResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["contract", "destination", "navigateTo", "status"]) &&
    value.contract === ACTION_API_CONTRACT &&
    value.status === "opened" &&
    value.destination === "project_mappings" &&
    value.navigateTo === "/projects"
  );
}

async function postJson(
  endpoint: string,
  expectedStatus: number,
  body: Record<string, unknown>
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new ContinuationSetupActionRequestError();
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (
    response.status !== expectedStatus ||
    !/^application\/json(?:\s*;|$)/iu.test(contentType)
  ) {
    throw new ContinuationSetupActionRequestError();
  }
  return readBoundedJson(response);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_RESPONSE_BYTES
    ) {
      throw new ContinuationSetupActionRequestError();
    }
  }
  if (response.body === null) {
    throw new ContinuationSetupActionRequestError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ContinuationSetupActionRequestError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ContinuationSetupActionRequestError) throw error;
    throw new ContinuationSetupActionRequestError();
  } finally {
    reader.releaseLock();
  }
}

function parseIssuedResponse(value: unknown): ContinuationSetupOfferResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["contract", "expiresAt", "offerId", "status"]) ||
    value.contract !== ACTION_API_CONTRACT ||
    value.status !== "issued" ||
    typeof value.offerId !== "string" ||
    !SETUP_OFFER_ID_PATTERN.test(value.offerId) ||
    !isCanonicalTimestamp(value.expiresAt)
  ) {
    throw new ContinuationSetupActionRequestError();
  }
  return value as ContinuationSetupOfferResponse;
}

function parseOpenedResponse(value: unknown): ContinuationSetupOpenedResponse {
  if (!isContinuationSetupOpenedResponse(value)) {
    throw new ContinuationSetupActionRequestError();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
