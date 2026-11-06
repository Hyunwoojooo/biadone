export class ApiError extends Error {
  constructor(status, code, message, { authUncertain = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.authUncertain = authUncertain;
  }
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
      Vary: 'Authorization, Origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

export function errorResponse(error) {
  const known = error instanceof ApiError;
  return jsonResponse({
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.',
    },
    ...(known && error.authUncertain ? { auth_uncertain: true } : {}),
  }, known ? error.status : 500);
}

export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if ((origin && origin !== new URL(request.url).origin)
      || fetchSite === 'cross-site' || fetchSite === 'same-site') {
    throw new ApiError(403, 'ORIGIN_FORBIDDEN', '이 대시보드에서 시작한 요청만 허용됩니다.');
  }
}

export function assertMethod(request, methods) {
  if (!methods.includes(request.method)) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식입니다.');
  }
}

export function assertQuery(url, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new ApiError(400, 'INVALID_QUERY', '지원하지 않거나 중복된 조회 조건입니다.');
    }
  }
}

export async function readJsonBody(request, maxBytes = 16_384) {
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'JSON 형식으로 입력해 주세요.');
  }
  const declaredSize = request.headers.get('Content-Length');
  if (declaredSize !== null && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) {
    throw new ApiError(413, 'BODY_TOO_LARGE', '입력 내용이 너무 큽니다.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON', '입력 내용을 확인해 주세요.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'BODY_TOO_LARGE', '입력 내용이 너무 큽니다.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', '입력 내용을 확인해 주세요.');
  } finally {
    reader.releaseLock();
  }
}

export async function requestJson(fetchImpl, url, init, kind) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const authRequest = kind === 'auth';
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new ApiError(503, authRequest ? 'AUTH_UNAVAILABLE' : 'DATA_SOURCE_UNAVAILABLE',
        authRequest ? '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.' : '데이터 원천에 연결하지 못했습니다. 다시 시도해 주세요.',
        { authUncertain: authRequest });
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new ApiError(401, 'UNAUTHORIZED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
      }
      if (response.status === 403) {
        throw new ApiError(authRequest ? 401 : 403, authRequest ? 'UNAUTHORIZED' : 'FORBIDDEN',
          authRequest ? '로그인을 확인할 수 없습니다. 다시 로그인해 주세요.' : '이 계정에는 대시보드 권한이 없습니다.');
      }
      if (authRequest && response.status === 400) {
        let code;
        try {
          const body = await response.json();
          code = body?.error_code ?? body?.code;
        } catch { /* Unrecognized Auth failures remain unavailable. */ }
        if (code === 'bad_jwt') {
          throw new ApiError(401, 'UNAUTHORIZED', '로그인을 확인할 수 없습니다. 다시 로그인해 주세요.');
        }
      }
      if (!authRequest) {
        let code;
        try { code = (await response.json())?.code; } catch { /* Never return upstream bodies. */ }
        if (code === '22023') throw new ApiError(400, 'INVALID_INPUT', '저장할 내용을 확인해 주세요.');
        if (code === 'P0002') throw new ApiError(404, 'POST_NOT_FOUND', '게시물 기록을 찾을 수 없습니다.');
        if (code === '42501') throw new ApiError(403, 'FORBIDDEN', '이 계정에는 대시보드 권한이 없습니다.');
      }
      if (!authRequest && response.status === 404) {
        throw new ApiError(503, 'DATA_SOURCE_UNAVAILABLE', '대시보드 조회 기능이 아직 연결되지 않았습니다.');
      }
      throw new ApiError(503, authRequest ? 'AUTH_UNAVAILABLE' : 'DATA_SOURCE_UNAVAILABLE',
        authRequest ? '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.' : '데이터 원천에 연결하지 못했습니다. 다시 시도해 주세요.',
        { authUncertain: authRequest });
    }
    try { return await response.json(); }
    catch {
      throw new ApiError(502, authRequest ? 'AUTH_UNAVAILABLE' : 'INVALID_SOURCE_DATA',
        authRequest ? '로그인 상태를 확인하지 못했습니다.' : '집계 응답을 확인하지 못했습니다.',
        { authUncertain: authRequest });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, authRequest ? 'AUTH_UNAVAILABLE' : 'DATA_SOURCE_UNAVAILABLE',
      authRequest ? '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.' : '데이터 원천에 연결하지 못했습니다. 다시 시도해 주세요.',
      { authUncertain: authRequest });
  } finally {
    clearTimeout(timer);
  }
}
