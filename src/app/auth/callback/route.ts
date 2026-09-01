import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";

// Session-sensitive — must never be cached (a stale cached redirect here
// would replay someone else's exchange/redirect).
export const dynamic = "force-dynamic";

/**
 * The one PKCE code-exchange endpoint for both signup confirmation and
 * password recovery — see the account foundation pass's report for the
 * full design. `type` distinguishes which flow initiated the code
 * (`signup` from signup/actions.ts's emailRedirectTo, `recovery` from
 * forgot-password/actions.ts's redirectTo) so a failed exchange gets the
 * right specific failure page rather than one falling through to the
 * other's handling — and neither ever falls through to /login silently.
 *
 * A failed exchange here is EXPECTED, not just an error case: PKCE's
 * code-verifier cookie is set on the browser that initiated signup/reset,
 * so a link opened on a different browser/device, an already-used code,
 * or an expired code will all legitimately fail exchangeCodeForSession —
 * this is the same-browser/device constraint documented in the account
 * foundation pass's report, not a bug to work around.
 */
// A code exchange is single-use and session-mutating — the redirect it
// produces must never be cached/replayed by a browser or intermediary
// for a second visitor, hence the explicit no-store on every branch
// below (on top of `dynamic = "force-dynamic"` above).
function redirectNoStore(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const type = url.searchParams.get("type"); // "signup" | "recovery" | null
  const next = getSafeRedirect(url.searchParams.get("next"));

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return redirectNoStore(new URL(next, request.url));
    }

    if (type === "recovery") {
      const failUrl = new URL("/forgot-password", request.url);
      failUrl.searchParams.set("error", "expired");
      return redirectNoStore(failUrl);
    }

    // Default to the signup-confirmation failure state — this endpoint
    // currently only serves signup and recovery, and an unrecognized/
    // missing `type` on a failed exchange is far more likely a
    // confirmation link than anything else.
    const failUrl = new URL("/signup/confirm-failed", request.url);
    failUrl.searchParams.set("next", next);
    return redirectNoStore(failUrl);
  }

  // No code at all — a malformed or directly-visited URL, not a failed
  // exchange. Nothing to recover from; send to login rather than either
  // failure page, which would misstate what happened.
  return redirectNoStore(new URL("/login", request.url));
}
