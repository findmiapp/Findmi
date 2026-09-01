import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { updatePassword } from "./actions";

export const metadata: Metadata = {
  title: "Set a New Password",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // This page only renders with a real recovery session already
  // established — /auth/callback is the only path that gets a visitor
  // here with one. Reached directly with no session (e.g. a stale
  // bookmark, or the recovery exchange failed and something still
  // linked here) → straight to /login, never a form that can't work.
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-md px-6 py-14">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Password reset</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Set a new password</h1>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <form action={updatePassword} className="mt-6 flex flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">New password</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Confirm password</span>
          <input
            type="password"
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          className="mt-2 rounded-full bg-findmi px-5 py-3 text-sm font-bold text-white transition hover:bg-findmi-600"
        >
          Update Password
        </button>
      </form>
    </div>
  );
}
