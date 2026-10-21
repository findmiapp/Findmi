import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { cookies } from "next/headers";

/**
 * The request-scoped Supabase client for the new consumer auth system
 * (Server Components, Server Actions, Route Handlers under /login,
 * /signup, /account, /auth/callback, etc.) — this IS the current
 * request's session, bound to that request's cookies() via the closures
 * the cookie handlers below capture.
 *
 * Deliberately NOT a module-level singleton, unlike lib/supabase.ts's
 * getSupabase() or lib/admin/supabase-admin.ts's getAdminSupabase()
 * (both cache their client — safe there because persistSession is false
 * and every call is anon-tier or service-role, carrying no per-user
 * session at all). Caching THIS client would leak one request's
 * session/cookies into every later request served by the same warm
 * Vercel serverless instance — a real cross-user session leak, not a
 * style preference. A fresh client is created on every call, with no
 * exceptions — never hoist the result of this function to module scope.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render (not a Server Action
            // or Route Handler) — cookies() is read-only there. Safe to
            // ignore: middleware's own client (./middleware.ts) refreshes
            // the session on every request to /account regardless, so a
            // missed write here is never the only chance to persist a
            // refreshed token.
          }
        },
      },
    }
  );
}

/**
 * The signed-in user for THIS request, validated once.
 *
 * `supabase.auth.getUser()` is a network round trip to Supabase Auth, and a
 * single Business Manager request used to make it several times (the page,
 * `requireBusinessMember`, the shell loader). React's per-request `cache()`
 * collapses those to one. The memo is scoped to one server render/action —
 * never shared across requests or users — so it carries none of the
 * cross-request leak risk `getServerSupabase()` above warns about.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
