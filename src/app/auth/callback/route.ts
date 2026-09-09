import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { syncEmailVerifiedAt } from "@/lib/auth/sync-email-verified";

// Session-sensitive — must never be cached (a stale cached redirect here
// would replay someone else's exchange/redirect).
export const dynamic = "force-dynamic";

/**
 * The one PKCE code-exchange endpoint for signup confirmation, password
 * recovery, AND (Progressive Email Verification — Callback/Link Fix)
 * this app's own already-authenticated "verify your email" link — see
 * the account foundation pass's report for the original design. `type`
 * distinguishes which flow initiated the code (`signup` from
 * signup/actions.ts's emailRedirectTo, `recovery` from
 * forgot-password/actions.ts's redirectTo, `email_verification` from
 * account/verify-email/actions.ts's requestEmailVerification) so a
 * failed exchange gets the right specific failure page rather than one
 * falling through to another flow's handling — and none of them ever
 * fall through to /login silently. Every successful exchange also
 * synchronizes profiles.email_verified_at from Supabase Auth's own
 * authoritative user.email_confirmed_at (see lib/auth/sync-email-
 * verified.ts) — signup confirmation and this app's own verification
 * link both prove control of the inbox, so both now correctly clear it.
 *
 * A failed exchange here is EXPECTED, not just an error case: PKCE's
 * code-verifier cookie is set on the browser that initiated signup/reset,
 * so an already-used code, an expired code, OR (for the `code` branch
 * specifically) a link opened on a different browser/device than the one
 * that started signup/reset will all legitimately fail
 * exchangeCodeForSession.
 *
 * Signup + Email Confirmation UX Correction pass — that same-device
 * failure mode for the `code` branch is a consequence of the Supabase
 * project's "Confirm signup"/"Reset password" email templates still
 * using the default `{{ .ConfirmationURL }}` (Supabase's own hosted
 * verify endpoint, which redirects back here with a PKCE `?code=`), NOT
 * a fundamental Supabase limitation — the `token_hash` branch directly
 * below already proves this: verifyOtp() is a pure server-side token
 * check with no browser-bound state, cross-device-safe today for every
 * admin-triggered link. Making self-service signup confirmation
 * cross-device-safe the same way requires changing the "Confirm signup"
 * email template in the Supabase dashboard to link straight at
 * `{{ .RedirectTo }}&token_hash={{ .TokenHash }}` instead of
 * `{{ .ConfirmationURL }}` — see this pass's own report for the exact
 * template text; that's an external dashboard change, not a code change,
 * and this route needs no modification to support it once made.
 *
 * ADMIN USERS PASS 2 addition: admin-triggered links (Create User's "Send
 * Setup Email" → inviteUserByEmail(), and the user-detail page's "Send
 * Password Reset Email" → resetPasswordForEmail() called from the
 * service-role client, which defaults to flowType "implicit" —
 * lib/admin/supabase-admin.ts's getAdminSupabase() never opts into
 * "pkce") can NEVER go through the `code` branch above: the browser that
 * completes the exchange (the invited/reset user's) is never the same
 * one that triggered it (the admin's browser, or no browser at all for a
 * server-side Server Action). Supabase's own SDK documents PKCE as
 * unsupported for inviteUserByEmail() for exactly this reason. Those
 * links carry `token_hash` + `type` instead, completed below via
 * verifyOtp() — a one-time server-side token check with no
 * browser-bound secret, safe for a different browser to complete. This
 * is fully additive: the `code` branch and every existing self-service
 * caller are unchanged.
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

// Progressive Email Verification — Callback/Link Fix. account/verify-
// email/actions.ts's requestEmailVerification sends its magic link with
// `&type=email_verification` (a value this app invents for its own
// branching below — GoTrue itself doesn't need or inspect it for the
// `code`/PKCE exchange). A failed exchange for this flow must never fall
// through to /signup/confirm-failed (that page's own resend form asks an
// unauthenticated visitor for their email and calls the signup-specific
// resend action — wrong on every count for an already-signed-in visitor
// re-proving their inbox). It goes back to the same verify-email screen
// instead, which already has its own session-aware resend action.
function emailVerificationFailUrl(request: NextRequest, next: string): URL {
  const failUrl = new URL("/account/verify-email", request.url);
  failUrl.searchParams.set("next", next);
  failUrl.searchParams.set("error", "That verification link is invalid or expired. Send a new one below.");
  return failUrl;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type"); // "signup" | "recovery" | "invite" | "email_verification" | null
  const next = getSafeRedirect(url.searchParams.get("next"));

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Authoritative sync, every successful exchange — signup
      // confirmation and this app's own email-verification link both
      // prove control of the inbox, so both should clear
      // profiles.email_verified_at the same way (see
      // lib/auth/sync-email-verified.ts's own doc comment on why this is
      // always safe/idempotent to call here).
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) await syncEmailVerifiedAt(user);
      return redirectNoStore(new URL(next, request.url));
    }

    // Never log the code itself — only GoTrue's own error shape (message/
    // status), which carries no secret/PII, same pattern as
    // signup/actions.ts's existing signUp failure log.
    console.error("[auth/callback] exchangeCodeForSession failed", {
      error: error.message,
      status: error.status,
    });

    if (type === "recovery") {
      const failUrl = new URL("/forgot-password", request.url);
      failUrl.searchParams.set("error", "expired");
      return redirectNoStore(failUrl);
    }

    // A near-duplicate confirmation request (the same link visited twice —
    // a prefetch, a double-tap) can legitimately fail this exchange even
    // though an earlier request in the same flow already succeeded and set
    // a valid session on this exact browser. Check for that before
    // treating it as a real failure: only show "expired" if this browser
    // genuinely has no session either.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await syncEmailVerifiedAt(user);
      return redirectNoStore(new URL(next, request.url));
    }

    if (type === "email_verification") {
      return redirectNoStore(emailVerificationFailUrl(request, next));
    }

    // Default to the signup-confirmation failure state — this endpoint
    // currently only serves signup and recovery, and an unrecognized/
    // missing `type` on a failed exchange is far more likely a
    // confirmation link than anything else.
    const failUrl = new URL("/signup/confirm-failed", request.url);
    failUrl.searchParams.set("next", next);
    return redirectNoStore(failUrl);
  }

  // Admin-triggered invite/reset link — see the ADMIN USERS PASS 2 note
  // above. `type` here is always "invite" or "recovery" in practice
  // (the only two admin-triggered flows this app sends), but any
  // EmailOtpType GoTrue hands back is passed through unchanged.
  if (tokenHash && type) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) await syncEmailVerifiedAt(user);
      return redirectNoStore(new URL(next, request.url));
    }

    // Same safe error-shape-only logging as the code branch above —
    // logged for both outcomes below; neither redirect's behavior changes.
    console.error("[auth/callback] verifyOtp failed", {
      error: error.message,
      status: error.status,
    });

    if (type === "recovery") {
      const failUrl = new URL("/forgot-password", request.url);
      failUrl.searchParams.set("error", "expired");
      return redirectNoStore(failUrl);
    }

    if (type === "email_verification") {
      return redirectNoStore(emailVerificationFailUrl(request, next));
    }

    const failUrl = new URL("/signup/confirm-failed", request.url);
    failUrl.searchParams.set("next", next);
    return redirectNoStore(failUrl);
  }

  // Neither a code nor a token_hash — a malformed or directly-visited
  // URL, not a failed exchange. Nothing to recover from; send to login
  // rather than either failure page, which would misstate what happened.
  return redirectNoStore(new URL("/login", request.url));
}
