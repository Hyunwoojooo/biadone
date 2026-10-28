import { publicConfig } from './auth.mjs';
import { assertMethod, assertQuery, assertSameOrigin, errorResponse, jsonResponse } from './http.mjs';

export async function handleConfig(context) {
  try {
    assertSameOrigin(context.request);
    assertMethod(context.request, ['GET']);
    assertQuery(new URL(context.request.url), []);
    return jsonResponse(publicConfig(context.env));
  } catch (error) {
    return errorResponse(error);
  }
}
