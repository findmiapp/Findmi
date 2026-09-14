import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getUnifiedSchedule, getUnifiedPastSchedule, type ScheduleItem } from "@/lib/dashboard";
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

const SCHEDULE_LIMIT = 50;

/** Launch V2 Pass 1.1 — live QA fix. Pass 1's Schedule only aggregated
 * getUpcomingAppearancesForBusiness (Business appearances), so an
 * organized Event that appeared on Home's Next Up (sourced from the
 * unified getAccountCommandCenter/getUnifiedSchedule graph) was silently
 * missing here. Schedule now calls the SAME getUnifiedSchedule Home
 * calls internally — Business appearances, organized Event occurrences,
 * and managed Location happenings, FK-deduplicated — just with a much
 * higher limit for its own full Upcoming list. Past uses the narrower
 * getUnifiedPastSchedule (Business + Location appearances only — see
 * that function's own doc comment for the one deliberate, reported
 * limitation: no past Event occurrences yet). */
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

  const [{ data: businessMemberships }, { data: eventMemberships }, { data: locationMemberships }] = await Promise.all([
    supabase.from("business_members").select("business_id, businesses(id, name)").eq("user_id", user.id),
    supabase.from("event_members").select("event_id, events(id, name, is_demo)").eq("user_id", user.id),
    supabase.from("location_members").select("location_id, locations(id, name, is_demo)").eq("user_id", user.id),
  ]);

  type BusinessRow = { business_id: string; businesses: { id: string; name: string } | { id: string; name: string }[] | null };
  const businesses = ((businessMemberships ?? []) as BusinessRow[])
    .map((m) => {
      const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return b ? { id: b.id, name: b.name, pendingReview: false } : null;
    })
    .filter((b): b is { id: string; name: string; pendingReview: boolean } => Boolean(b));

  type EventRow = { event_id: string; events: { id: string; name: string; is_demo: boolean } | { id: string; name: string; is_demo: boolean }[] | null };
  const events = ((eventMemberships ?? []) as EventRow[])
    .map((m) => {
      const e = Array.isArray(m.events) ? m.events[0] : m.events;
      return e ? { id: e.id, name: e.name, isDemo: e.is_demo } : null;
    })
    .filter((e): e is { id: string; name: string; isDemo: boolean } => Boolean(e));

  type LocationRow = { location_id: string; locations: { id: string; name: string; is_demo: boolean } | { id: string; name: string; is_demo: boolean }[] | null };
  const locations = ((locationMemberships ?? []) as LocationRow[])
    .map((m) => {
      const l = Array.isArray(m.locations) ? m.locations[0] : m.locations;
      return l ? { id: l.id, name: l.name, isDemo: l.is_demo } : null;
    })
    .filter((l): l is { id: string; name: string; isDemo: boolean } => Boolean(l));

  const admin = getAdminSupabase();
  const [upcoming, past] = admin
    ? await Promise.all([
        getUnifiedSchedule(admin, { businesses, events, locations }, SCHEDULE_LIMIT),
        getUnifiedPastSchedule(admin, { businesses, events, locations }, SCHEDULE_LIMIT),
      ])
    : [[], []];

  const rows = section === "upcoming" ? upcoming : past;

  // Correctness fix (unchanged reasoning from Pass 1) — ScheduleItem
  // deliberately doesn't carry raw Appearance fields (venue_name/address/
  // city/state/location_id/external_url/flyer_image_url) since Event- and
  // Location-sourced items have no such columns at all; only Upcoming
  // rows with actionKind 'business_appearance' need them, for the inline
  // Edit form's defaults. Resolved here, scoped to this page only, never
  // touching the shared getUnifiedSchedule/ScheduleItem shape. Skipping
  // this (defaulting to blank) would silently UNLINK a real Findmi
  // Location the moment an owner edits from Schedule without re-picking
  // it — same risk this fix already addressed in Pass 1.
  const editableAppearanceIds = upcoming.filter((i) => i.actionKind === "business_appearance" && i.appearanceId).map((i) => i.appearanceId!);
  const appearanceById = new Map<
    string,
    { id: string; venue_name: string | null; address: string | null; city: string | null; state: string | null; external_url: string | null; flyer_image_url: string | null; location_id: string | null }
  >();
  const locationById = new Map<string, { id: string; name: string; city: string | null }>();
  if (admin && editableAppearanceIds.length > 0) {
    const { data: appearanceRows } = await admin
      .from("appearances")
      .select("id, venue_name, address, city, state, external_url, flyer_image_url, location_id")
      .in("id", editableAppearanceIds);
    for (const a of (appearanceRows ?? []) as { id: string; venue_name: string | null; address: string | null; city: string | null; state: string | null; external_url: string | null; flyer_image_url: string | null; location_id: string | null }[]) {
      appearanceById.set(a.id, a);
    }
    const locationIds = [...new Set([...appearanceById.values()].map((a) => a.location_id).filter((v): v is string => Boolean(v)))];
    if (locationIds.length > 0) {
      const { data: locationRows } = await admin.from("locations").select("id, name, city").in("id", locationIds);
      for (const l of (locationRows ?? []) as { id: string; name: string; city: string | null }[]) locationById.set(l.id, l);
    }
  }

  function actionLabel(item: ScheduleItem): string {
    return item.actionKind === "business_appearance" ? "Edit" : item.actionKind === "event" ? "Manage Event" : "View";
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
          rows.map((item) => {
            const rawAppearance = item.appearanceId ? appearanceById.get(item.appearanceId) : undefined;
            const linkedLocation = rawAppearance?.location_id ? (locationById.get(rawAppearance.location_id) ?? null) : null;
            const [storedDate, storedStartTime] = isoToLocalDateTime(item.startAt).split("T");
            const storedEndTime = item.endAt ? isoToLocalDateTime(item.endAt).split("T")[1] : "";

            return (
              <div key={item.key} className="rounded-2xl border border-black/10 bg-white p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                      <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">
                        {item.actionKind === "event" ? "Findmi Event" : item.actionKind === "business_appearance" ? "Added by you" : "At a venue you manage"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink/60">
                      {formatDateShort(item.startAt)} · {formatTime(item.startAt)}
                      {item.endAt ? `–${formatTime(item.endAt)}` : ""}
                    </p>
                    {item.where && <p className="mt-0.5 text-xs text-ink/50">{item.where}</p>}
                    <p className="mt-0.5 text-xs font-semibold text-findmi-700">{item.relatedTo.join(" · ")}</p>
                  </div>
                  {/* Launch V2 Pass 1.1, Section 6 — context-correct action:
                      only a real owner Appearance is ever edited inline
                      here; an organized Event or a Location happening you
                      don't otherwise own links to its own real Manage/
                      View destination instead — no invented mutation
                      path for either. */}
                  {item.actionKind !== "business_appearance" && (
                    <Link
                      href={item.href}
                      className="shrink-0 rounded-full border border-black/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
                    >
                      {actionLabel(item)}
                    </Link>
                  )}
                </div>

                {section === "upcoming" && item.actionKind === "business_appearance" && item.appearanceId && item.appearanceBusinessId && (
                  <div className="mt-2 flex items-center gap-3">
                    <details className="flex-1">
                      <summary className="cursor-pointer text-xs font-semibold text-findmi-700">Edit</summary>
                      <div className="mt-3">
                        <AppearanceFieldsForm
                          businessId={item.appearanceBusinessId}
                          action={updateOwnerAppearance.bind(null, item.appearanceBusinessId, item.appearanceId)}
                          defaultValues={{
                            title: item.title,
                            date: storedDate,
                            start_time: storedStartTime,
                            end_time: storedEndTime,
                            venue_name: rawAppearance?.venue_name ?? "",
                            address: rawAppearance?.address ?? "",
                            city: rawAppearance?.city ?? "",
                            state: rawAppearance?.state ?? "",
                            external_url: rawAppearance?.external_url ?? "",
                            flyer_image_url: rawAppearance?.flyer_image_url ?? null,
                            location: linkedLocation ? { value: linkedLocation.id, label: linkedLocation.name, sublabel: linkedLocation.city ?? undefined } : null,
                          }}
                          submitLabel="Save"
                        />
                      </div>
                    </details>
                    <form action={removeOwnerAppearance.bind(null, item.appearanceBusinessId, item.appearanceId)}>
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

      {section === "past" && (
        <p className="mt-4 text-xs text-ink/40">
          Past organized Events aren&rsquo;t included here yet — view an Event&rsquo;s own dates from its Event Manager.
        </p>
      )}
    </div>
  );
}
