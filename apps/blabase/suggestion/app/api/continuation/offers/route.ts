import { isPreserveCaptureError } from "../../../../src/attention/preserveCapture";
import {
  continuationSetupActionIssueInputSchema,
  continuationSetupActionIssueResponseSchema,
  ContinuationSetupActionGatewayError,
  ContinuationSetupActionStoreError,
  issueLiveContinuationSetupOffer
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
  const parsed = continuationSetupActionIssueInputSchema.safeParse(
    body.value
  );
  if (!parsed.success) {
    return setupActionError("INVALID_REQUEST", 400);
  }

  try {
    const response = continuationSetupActionIssueResponseSchema.parse(
      await issueLiveContinuationSetupOffer({ itemRef: parsed.data.itemRef })
    );
    return setupActionJson(response, 201);
  } catch (error) {
    return mapIssueFailure(error);
  }
}

function mapIssueFailure(error: unknown) {
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
