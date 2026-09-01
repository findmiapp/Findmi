import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "./actions";

export const metadata: Metadata = {
  title: "Reset Password",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <div className="mx-auto max-w-md px-6 py-14">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Password reset</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Reset your password</h1>
      <p className="mt-3 text-sm text-ink/60">
        Enter your email and we&rsquo;ll send a reset link — open it on this same browser/device to finish.
      </p>

      {sent && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          If that address has a FindMi account, a reset link is on its way.
        </p>
      )}
      {error === "expired" && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          That reset link expired or was opened on a different device. Enter your email again for a new one.
        </p>
      )}
      {error && error !== "expired" && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <form action={requestPasswordReset} className="mt-6 flex flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
          <input type="email" name="email" required autoComplete="email" className={inputClass} />
        </label>
        <button
          type="submit"
          className="mt-2 rounded-full bg-findmi px-5 py-3 text-sm font-bold text-white transition hover:bg-findmi-600"
        >
          Send Reset Link
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink/50">
        <Link href="/login" className="font-semibold text-ink hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
