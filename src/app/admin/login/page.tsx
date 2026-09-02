import type { Metadata } from "next";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  // Admin Login Rate-Limit UX fix — error=rate_limited (temporarily
  // blocked, see loginRateLimit.ts) is a distinct, honest state from a
  // plain wrong password; the two must never show the same text, or a
  // founder who's actually correct-but-blocked gets told their password
  // is wrong (see the session-persistence trace report). Any other
  // truthy `error` value still means "wrong password" — unchanged.
  const rateLimited = error === "rate_limited";

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">FindMi</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Admin
        </h1>
        <p className="mt-2 text-sm text-ink/60">Founder-only. Enter the admin password.</p>

        <form action={login} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next ?? "/admin"} />
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-ink focus:border-ink/30 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              {rateLimited
                ? "Too many login attempts. Try again in a few minutes."
                : "That password isn't right. Try again."}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-full bg-findmi px-5 py-3 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
