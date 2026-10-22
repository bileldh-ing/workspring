import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast path only: requests to the workspace without any session cookie get a real 307 to /signin.
 * This is NOT the authorization check: every page/action/service still validates the session in the database.
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.get("ws_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url, 307);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/admin/:path*", "/admin", "/test-provider/:path*"] };
