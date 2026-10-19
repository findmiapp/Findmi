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

  // --- Journal V1 — the same consumer Supabase Auth gate as /account,
  // scoped narrowly to /my-world/journal (creating/managing/listing one's
  // OWN entries) rather than all of /my-world, which stays exactly as it
  // already was (a guest-visible, client-rendered page). The public,
  // potentially-anonymous-readable single-entry route (/journal/[id]) is
  // deliberately NOT covered here — its own RLS-backed read already
  // decides what a given visitor may see. ---
  if (pathname.startsWith("/my-world/journal")) {
    const { supabase, response } = getMiddlewareSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Guest-First Experience Completion pass — the cold composer entry
    // point alone lets a signed-out visitor begin a real Moment
    // immediately; identity is only established at the actual Save &
    // Publish / Save Without Publishing (MomentComposer's own guest
    // draft + contextual auth prompt, never silently here). Every other
    // /my-world/journal/* route — the archive, editing an existing
    // entry — is unaffected and still redirects below exactly as before.
    if (!user && pathname === "/my-world/journal/new") return response;

    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", getSafeRedirect(pathname + request.nextUrl.search));
      return NextResponse.redirect(loginUrl);
    }
    return response;
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

    // Guest-First Creation pass — these three native creation entry
    // points let a signed-out visitor begin filling the real form
    // immediately; identity is required only at actual submission (each
    // page's own server action re-checks and bounces through login with
    // the full draft preserved, never silently here). Every other
    // /account/* route — including these same entities' own management
    // pages — is unaffected and still redirects below exactly as before.
    const GUEST_ACCESSIBLE_PATHS = new Set(["/account/business/new", "/account/location/new", "/account/event/new"]);
    if (!user && GUEST_ACCESSIBLE_PATHS.has(pathname)) return response;

    if (!user) {
      const loginUrl = new URL("/login", request.url);
      // Preserve the full original destination — not just its pathname —
      // so a query string carrying real intent (?plan=pro, ?invite=CODE,
      // ?ref=CODE) survives the round trip through /login instead of
      // silently reverting to whatever the target page defaults to.
      // getSafeRedirect re-validates/reconstructs this the same safe way
      // it already does for every other caller (login/signup/auth
      // callback) — passing it the query string here doesn't weaken that.
      loginUrl.searchParams.set("next", getSafeRedirect(pathname + request.nextUrl.search));
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/account/:path*", "/my-world/journal/:path*"],
};
