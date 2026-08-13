import { isPreserveCaptureError } from "../../../../src/attention/preserveCapture";
import {
  continuationSetupActionOpenInputSchema,
  continuationSetupActionOpenResponseSchema,
  ContinuationSetupActionGatewayError,
  ContinuationSetupActionStoreError,
  openLiveContinuationSetupOffer
} from "../../../../src/continuation/actions";
import {
  gateContinuationSetupActionPost,
  readContinuationSetupActionJson,
  setupActionError,
  setupActionJson
} from "../setupActionHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = gateContinuationSetupActionPost(request);
  if (gate !== null) return gate;

  const body = await readContinuationSetupActionJson(request);
  if (!body.ok) return body.response;
  const parsed = continuationSetupActionOpenInputSchema.safeParse(body.value);
  if (!parsed.success) {
    return setupActionError("INVALID_REQUEST", 400);
  }

  try {
    const response = continuationSetupActionOpenResponseSchema.parse(
      await openLiveContinuationSetupOffer({ offerId: parsed.data.offerId })
    );
    return setupActionJson(response);
  } catch (error) {
    return mapOpenFailure(error);
  }
}

function mapOpenFailure(error: unknown) {
  if (
    error instanceof ContinuationSetupActionGatewayError ||
    (error instanceof ContinuationSetupActionStoreError &&
      error.code === "OFFER_NOT_CURRENT")
  ) {
    return setupActionError("OFFER_NOT_CURRENT", 409);
  }
  if (isPreserveCaptureError(error)) {
    return setupActionError("CAPTURE_UNAVAILABLE", 503);
  }
  return setupActionError("FAILED", 500);
}
