import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * The request-scoped Supabase client for middleware's /account gate.
 * Same rule as ./server.ts's getServerSupabase(): built fresh inside
 * middleware() on every single request, never module-cached. `request`
 * captured here is that one request's object — reusing this client
 * across requests would mix one visitor's cookies into another's
 * response on a warm Vercel instance.
 *
 * Calling supabase.auth.getUser() against the returned client both
 * validates the current session AND refreshes it when the access token
 * is near/past expiry, writing any refreshed sb-* cookies onto the
 * returned `response` — the caller must return that same response
 * object (or one built from it) for the refreshed cookies to actually
 * reach the browser.
 */
export function getMiddlewareSupabase(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );
  return { supabase, response };
}
