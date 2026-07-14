import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public routes that never require auth
const PUBLIC_PREFIXES = ["/login", "/api/auth", "/_next", "/favicon.ico"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Home page is always public
  if (pathname === "/") return NextResponse.next();

  // Static assets and auth routes are always public
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sitePassword = process.env.SITE_PASSWORD;

  // If no password is configured, allow access
  if (!sitePassword) return NextResponse.next();

  const cookie = request.cookies.get("site_auth")?.value;

  if (cookie !== sitePassword) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:jpg|jpeg|png|gif|svg|webp|ico)).*)"],
};
