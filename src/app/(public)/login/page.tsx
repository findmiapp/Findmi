import type { Metadata } from "next";
import Link from "next/link";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { signIn } from "./actions";

export const metadata: Metadata = {
  title: "Log In",
  robots: { index: false },
};
// Session-sensitive — must never be statically or ISR-cached.
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const safeNext = getSafeRedirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Log in</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Welcome back</h1>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={signIn} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={safeNext} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
            <input type="email" name="email" required autoComplete="email" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Password</span>
            <input type="password" name="password" required autoComplete="current-password" className={inputClass} />
          </label>
          <div className="-mt-1 text-right">
            <Link href="/forgot-password" className="text-xs font-semibold text-ink/50 hover:text-ink">
              Forgot password?
            </Link>
          </div>
          <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
            Sign In
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-ink/50">
        New to FindMi?{" "}
        <Link href={`/signup?next=${encodeURIComponent(safeNext)}`} className="font-semibold text-ink hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
