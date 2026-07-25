import { NextRequest, NextResponse } from "next/server";

import { hasValidBasicAuthorization } from "./src/accessControl";

export function middleware(request: NextRequest) {
  const password = process.env.SUGGESTION_ACCESS_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === "development") {
      return NextResponse.next();
    }
    return new NextResponse("접근 설정을 확인하고 있습니다.", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }

  if (
    hasValidBasicAuthorization(
      request.headers.get("authorization"),
      password
    )
  ) {
    return NextResponse.next();
  }

  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="blabase suggestion"'
    }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
