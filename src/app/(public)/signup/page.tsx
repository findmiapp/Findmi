import type { Metadata } from "next";
import Link from "next/link";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { signUp } from "./actions";
import SignupForm from "./SignupForm";

export const metadata: Metadata = {
  title: "Sign Up",
  robots: { index: false },
};
// Session-sensitive — must never be statically or ISR-cached.
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; display_name?: string; email?: string; phone?: string }>;
}) {
  const { error, next, display_name: displayName, email, phone } = await searchParams;
  const safeNext = getSafeRedirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Get started</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Create your Findmi account</h1>
      <p className="mt-2 text-sm text-ink/60">
        Save your favorite finds, follow businesses, and keep track of what you discover.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <SignupForm action={signUp} next={safeNext} defaultDisplayName={displayName} defaultEmail={email} defaultPhone={phone} />
      </div>

      <p className="mt-6 text-center text-sm text-ink/50">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(safeNext)}`} className="font-semibold text-ink hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
