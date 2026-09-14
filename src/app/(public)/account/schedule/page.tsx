import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getUpcomingAppearancesForBusiness, getPastAppearancesForBusiness, type AppearanceWithEventSlug } from "@/lib/data";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { formatDateShort, formatTime } from "@/lib/format";
import AccountNav from "../AccountNav";
import BusinessScopedAction, { PlusGlyph } from "../BusinessScopedAction";
import AppearanceFieldsForm from "../business/[id]/AppearanceFieldsForm";
import { updateOwnerAppearance, removeOwnerAppearance } from "../business/actions";

export const metadata: Metadata = {
  title: "Schedule",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

interface ScheduleRow {
  appearance: AppearanceWithEventSlug;
  businessId: string;
  businessName: string;
}

/** Launch V2 Pass 1 — the dedicated Schedule surface (Section 5/6). The
 * user job: "manage everywhere you'll be." Upcoming/Past, no calendar —
 * both lists are the SAME per-business queries the Business Manager's own
 * Findmi Here tab already uses (getUpcomingAppearancesForBusiness, plus
 * the new mirrored getPastAppearancesForBusiness this pass adds), just
 * aggregated across every business this account manages and sorted into
 * one chronological list. Edit/Remove reuse the exact same Server
 * Actions (updateOwnerAppearance/removeOwnerAppearance) and the same
 * AppearanceFieldsForm component the Business Manager uses — no
 * duplicate mutation logic. "Apply to an existing Event" is NOT
 * reimplemented here (that flow needs a per-business list of open
 * Events, which already lives in the Findmi Here tab) — the dominant +
 * Add Where I'll Be CTA below routes straight there via
 * BusinessScopedAction, the same zero/one/many routing Home's own CTA
 * uses. */
export default async function AccountSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section: sectionParam } = await searchParams;
  const section = sectionParam === "past" ? "past" : "upcoming";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/schedule");

  const { data: businessMemberships } = await supabase
    .from("business_members")
    .select("business_id, businesses(id, name)")
    .eq("user_id", user.id);

  type Row = { business_id: string; businesses: { id: string; name: string } | { id: string; name: string }[] | null };
  const businesses = ((businessMemberships ?? []) as Row[])
    .map((m) => {
      const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return b ? { id: b.id, name: b.name } : null;
    })
    .filter((b): b is { id: string; name: string } => Boolean(b));

  const perBusinessLimit = 20;
  const [upcomingByBusiness, pastByBusiness] = await Promise.all([
    Promise.all(businesses.map((b) => getUpcomingAppearancesForBusiness(b.id, perBusinessLimit))),
    Promise.all(businesses.map((b) => getPastAppearancesForBusiness(b.id, perBusinessLimit))),
  ]);

  const upcoming: ScheduleRow[] = businesses
    .flatMap((b, i) => upcomingByBusiness[i].map((appearance) => ({ appearance, businessId: b.id, businessName: b.name })))
    .sort((a, b) => new Date(a.appearance.start_at).getTime() - new Date(b.appearance.start_at).getTime());
  const past: ScheduleRow[] = businesses
    .flatMap((b, i) => pastByBusiness[i].map((appearance) => ({ appearance, businessId: b.id, businessName: b.name })))
    .sort((a, b) => new Date(b.appearance.start_at).getTime() - new Date(a.appearance.start_at).getTime());

  const rows = section === "upcoming" ? upcoming : past;
  const multiBusiness = businesses.length > 1;

  // Correctness fix — getUpcomingAppearancesForBusiness/
  // getPastAppearancesForBusiness (reused above, unmodified) don't join
  // the linked Findmi Location's name/city the way the Business Manager's
  // own richer Findmi Here-tab query does; only appearances.location_id
  // (the real FK) comes through on a plain `*` select. Resolving it here
  // — scoped to this page only, never touching the shared functions used
  // elsewhere (including the public Business page) — matters for
  // correctness, not just display: AppearanceFieldsForm's location field
  // round-trips through parseAppearanceFields' `location_id` on every
  // save, so an unresolved (null) initial value here would silently
  // UNLINK an appearance's real Location the moment an owner edits it
  // from Schedule without re-picking it.
  const upcomingLocationIds = [...new Set(upcoming.map((r) => r.appearance.location_id).filter((v): v is string => Boolean(v)))];
  const locationById = new Map<string, { id: string; name: string; city: string | null }>();
  if (upcomingLocationIds.length > 0) {
    const { data: locationRows } = await supabase.from("locations").select("id, name, city").in("id", upcomingLocationIds);
    for (const l of (locationRows ?? []) as { id: string; name: string; city: string | null }[]) locationById.set(l.id, l);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Schedule</h1>
      <p className="mt-1.5 text-sm text-ink/50">Manage everywhere you&rsquo;ll be.</p>

      <div className="mt-4">
        <BusinessScopedAction
          variant="full"
          businesses={businesses}
          tab="findmi-here"
          icon={<PlusGlyph className="h-4 w-4" />}
          label="Add Where I'll Be"
        />
      </div>

      <div className="mt-5 flex gap-1.5">
        <Link
          href="/account/schedule?section=upcoming"
          className={`rounded-full px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition ${
            section === "upcoming" ? "bg-ink text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
          }`}
        >
          Upcoming
        </Link>
        <Link
          href="/account/schedule?section=past"
          className={`rounded-full px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition ${
            section === "past" ? "bg-ink text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
          }`}
        >
          Past
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-black/5 bg-white p-6 text-center text-sm text-ink/50">
            {section === "upcoming" ? "Nothing on your schedule yet." : "No past appearances yet."}
          </p>
        ) : (
          rows.map(({ appearance: a, businessId, businessName }) => {
            const [storedDate, storedStartTime] = isoToLocalDateTime(a.start_at).split("T");
            const storedEndTime = a.end_at ? isoToLocalDateTime(a.end_at).split("T")[1] : "";
            const linkedLocation = a.location_id ? (locationById.get(a.location_id) ?? null) : null;
            return (
              <div key={a.id} className="rounded-2xl border border-black/10 bg-white p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                      <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">
                        {a.event_id ? "Findmi Event" : "Added by you"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink/60">
                      {formatDateShort(a.start_at)} · {formatTime(a.start_at)}
                      {a.end_at ? `–${formatTime(a.end_at)}` : ""}
                    </p>
                    {(a.venue_name || a.city) && (
                      <p className="mt-0.5 text-xs text-ink/50">
                        {[a.venue_name, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {multiBusiness && <p className="mt-0.5 text-xs font-semibold text-findmi-700">{businessName}</p>}
                  </div>
                </div>

                {section === "upcoming" && (
                  <div className="mt-2 flex items-center gap-3">
                    <details className="flex-1">
                      <summary className="cursor-pointer text-xs font-semibold text-findmi-700">Edit</summary>
                      <div className="mt-3">
                        <AppearanceFieldsForm
                          businessId={businessId}
                          action={updateOwnerAppearance.bind(null, businessId, a.id)}
                          defaultValues={{
                            title: a.title,
                            date: storedDate,
                            start_time: storedStartTime,
                            end_time: storedEndTime,
                            venue_name: a.venue_name ?? "",
                            address: a.address ?? "",
                            city: a.city ?? "",
                            state: a.state ?? "",
                            external_url: a.external_url ?? "",
                            flyer_image_url: a.flyer_image_url,
                            location: linkedLocation ? { value: linkedLocation.id, label: linkedLocation.name, sublabel: linkedLocation.city ?? undefined } : null,
                          }}
                          submitLabel="Save"
                        />
                      </div>
                    </details>
                    <form action={removeOwnerAppearance.bind(null, businessId, a.id)}>
                      <button type="submit" className="shrink-0 text-xs font-semibold text-red-600 hover:underline">
                        Remove
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
