import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import { getActiveMarkets } from "@/lib/data";
import { createMemberEvent } from "../actions";

/** Multi-Entity Self-Service V1, Stage 3 — Create Event From Venue. A
 * Location owner's "+ Add an Event Here" link (see the Location Manager's
 * Overview tab) lands here with ?location_id=<id>; that Location's own
 * name/address/city/state are copied onto the new event at creation
 * (see createMemberEvent's own comment) purely as a venue-fields autofill
 * convenience — it never grants the event's ownership to the Location
 * owner, and never grants the Location's ownership to the event creator.
 * The Location's ownership is looked up only to display its name here;
 * this deliberately does NOT require the current visitor to be a member
 * of that Location — anyone entitled to create an event may create one at
 * any existing FindMi venue, same as picking one from the existing
 * Location search on the Event Manager's own Location tab. */
async function getLocationHint(locationId: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!locationId) return null;
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("locations").select("id, name").eq("id", locationId).maybeSingle();
  return data ?? null;
}

export const metadata: Metadata = {
  title: "Add an Event",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

/** Multi-Entity Self-Service V1, Stage 2 — native Event creation entry
 * point. Only qualifying signed-in users may create an Event (see
 * canCurrentUserManageEvents — active Pro or a redeemed Pro Invite on
 * some business they belong to; no separate Event fee, ever). A
 * non-qualifying user sees the membership-required explainer directly on
 * this page instead of a broken/dead-end form — createMemberEvent itself
 * independently re-checks entitlement too, so this page's own gate is a
 * UX convenience, never the real authorization. */
export default async function AddEventPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; location_id?: string }>;
}) {
  const { error, location_id: locationIdHint } = await searchParams;
  const locationHint = await getLocationHint(locationIdHint);

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/account/event/new")}`);

  const admin = getAdminSupabase();
  const entitled = admin ? await canCurrentUserManageEvents(admin, user.id) : false;

  if (!entitled) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your FindMi</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Add an Event</h1>
        <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-sm font-semibold text-ink">Event management is included with qualifying FindMi membership.</p>
          <p className="mt-2 text-sm text-ink/60">
            Get FindMi Pro (or redeem a Pro Invite) on a business you manage to create and manage Events — no
            separate Event fee.
          </p>
          {locationHint && (
            <p className="mt-2 text-sm text-ink/60">
              Once you have Organizer Access, come back here to add your event at {locationHint.name} directly.
            </p>
          )}
          <Link href="/account/business/new" className={`mt-5 ${primaryButtonClass}`}>
            Add a Business
          </Link>
          <Link href="/join" className="mt-3 flex h-11 w-full items-center justify-center text-xs font-semibold text-ink/50 transition hover:text-ink">
            Learn about FindMi Pro
          </Link>
        </div>
      </div>
    );
  }

  const markets = await getActiveMarkets();

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your FindMi</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Add an Event</h1>
      <p className="mt-2 text-sm text-ink/60">
        You&rsquo;ll own and manage it right away in your Event Manager, and FindMi will review it before it appears
        in discovery.
      </p>

      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={createMemberEvent} className="flex flex-col gap-4">
          {locationHint && (
            <div className="rounded-xl border border-findmi/20 bg-findmi-50 px-3.5 py-2.5">
              <input type="hidden" name="location_id" value={locationHint.id} />
              <p className="text-xs font-semibold text-findmi-700">Venue: {locationHint.name}</p>
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Event name</span>
            <input type="text" name="name" required placeholder="Your event name" className={inputClass} />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Starts</span>
              <input type="datetime-local" name="start_at" required className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Ends</span>
              <input type="datetime-local" name="end_at" required className={inputClass} />
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
            <p className="mt-1.5 text-xs text-ink/45">You can add or change this later from your Event Manager.</p>
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
                Your event will still be created — FindMi will review your request and follow up once your Market is
                available.
              </p>
              <p className="mt-1 text-xs text-ink/40">
                If you fill this in, leave Market above set to &ldquo;Choose a market…&rdquo;.
              </p>
            </div>
          </details>

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            Create My Event
          </button>
          <p className="text-center text-xs text-ink/40">
            No separate Event fee — included with your qualifying FindMi membership.
          </p>
        </form>
      </div>
    </div>
  );
}
