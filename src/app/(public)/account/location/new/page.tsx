import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActiveMarkets } from "@/lib/data";
import { createMemberLocation } from "../actions";

export const metadata: Metadata = {
  title: "Add a Venue",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

/** Multi-Entity Self-Service V1, Stage 3 — native Location (venue) creation
 * entry point. FREE for every signed-in user — no Business Pro, no Event
 * Management entitlement, no Location subscription (see this stage's
 * Locked LOCATION ACCESS/ENTITLEMENT rule) — so unlike /account/event/new
 * this page has no membership-required explainer branch, only the plain
 * sign-in gate every native creation flow needs. */
export default async function AddLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; duplicate_slug?: string; duplicate_name?: string }>;
}) {
  const { error, duplicate_slug: duplicateSlug, duplicate_name: duplicateName } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/account/location/new")}`);

  const markets = await getActiveMarkets();

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your FindMi</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Add a Venue</h1>
      <p className="mt-2 text-sm text-ink/60">
        You&rsquo;ll own and manage it right away in your Location Manager, free — no separate Venue fee, ever.
      </p>

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{error}</p>
          {duplicateSlug && (
            <Link href={`/location/${duplicateSlug}`} className="mt-1.5 inline-block font-semibold underline underline-offset-2">
              View {duplicateName ?? "this venue"} &rarr;
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={createMemberLocation} className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Venue name</span>
            <input type="text" name="name" required placeholder="Your venue name" className={inputClass} />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Address</span>
            <input type="text" name="address" className={inputClass} />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">City</span>
              <input type="text" name="city" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">State</span>
              <input type="text" name="state" className={inputClass} />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">
              Market <span className="font-normal text-ink/40">(optional)</span>
            </span>
            <select name="market_id" defaultValue="" className={inputClass}>
              <option value="">Choose a market…</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink/45">You can add or change this later from your Location Manager.</p>
          </label>

          <details className="group -mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
              Don&rsquo;t see your Market?
            </summary>
            <div className="mt-2 rounded-xl border border-black/10 bg-mist/30 p-3.5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Request a Market</span>
                <input
                  type="text"
                  name="requested_market_text"
                  placeholder="e.g. Austin, TX"
                  className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                />
              </label>
              <p className="mt-1.5 text-xs text-ink/45">
                Your venue will still be created — FindMi will review your request and follow up once your Market is
                available.
              </p>
              <p className="mt-1 text-xs text-ink/40">
                If you fill this in, leave Market above set to &ldquo;Choose a market…&rdquo;.
              </p>
            </div>
          </details>

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            Create My Venue
          </button>
          <p className="text-center text-xs text-ink/40">Free — no separate Venue fee, ever.</p>
        </form>
      </div>
    </div>
  );
}
