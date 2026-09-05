// Gates every request behind a valid signed session cookie, except the login page
// and the login API route.
//
// This is the app's actual access control — not the RLS in
// supabase/migrations/0002_enable_rls.sql, which exists to make the anon key
// useless if it ever leaks.
//
// NOTE: in Next.js 16 this file is `proxy.ts`, not `middleware.ts`. Same idea,
// renamed. It runs in the edge runtime, which is why src/lib/session.ts uses
// Web Crypto rather than node:crypto.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/api/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (isPublicPath) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isAuthenticated = await verifySessionToken(token);

  if (!isAuthenticated) {
    // API routes get a 401 so fetch() callers see a real error rather than a
    // redirect to an HTML login page that they would try to parse as JSON.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
