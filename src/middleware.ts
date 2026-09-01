import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyToken } from "@/lib/admin/auth";
import { getMiddlewareSupabase } from "@/lib/supabase/middleware";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";

// Gates two completely independent trust boundaries in one file (Next.js
// only supports one root middleware): founder /admin (unchanged, its own
// branch below) and the new consumer /account auth (its own branch,
// added by the account foundation pass). The two never share a cookie,
// a verification function, or a redirect target — see that pass's report
// for why they're deliberately kept fully separate.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Founder /admin — untouched from before this pass ---
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return NextResponse.next();

    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (await verifyToken(token)) return NextResponse.next();

    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // --- Consumer /account (Supabase Auth) — new in this pass ---
  if (pathname.startsWith("/account")) {
    const { supabase, response } = getMiddlewareSupabase(request);
    // getUser() both validates and, if needed, refreshes the session —
    // the refreshed sb-* cookies are written onto `response` by the
    // cookie handlers in getMiddlewareSupabase, so returning `response`
    // (not a fresh NextResponse.next()) is what actually persists them.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", getSafeRedirect(pathname));
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/account/:path*"],
};
