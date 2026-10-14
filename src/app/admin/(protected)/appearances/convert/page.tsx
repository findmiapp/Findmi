import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getBusinessOptionById } from "@/lib/admin/queries";
import { RelationField } from "@/components/admin/RelationPicker";
import type { LegacyConversionRow } from "@/lib/admin/legacy-conversion";
import LegacyConversionBatch from "./LegacyConversionBatch";

export const dynamic = "force-dynamic";
// The batch runs ONE conversion per request from this page; each request
// re-reads a source page, re-hosts its image and writes the Event — same
// budget as the Edit Appearance page's own Convert To Event.
export const maxDuration = 60;

/** Admin-only (the (protected) layout + each action's requireAdminSupabase):
 * convert a Business's legacy schedule items into Events, one at a time,
 * through the existing convertLegacyAppearanceToEvent. Nothing runs until
 * the Admin starts it. */
export default async function ConvertLegacyAppearancesPage({ searchParams }: { searchParams: Promise<{ business_id?: string }> }) {
  const { business_id: businessId } = await searchParams;
  const business = businessId ? await getBusinessOptionById(businessId) : null;

  let rows: LegacyConversionRow[] = [];
  if (business) {
    const supabase = getAdminSupabase();
    const { data } = supabase
      ? await supabase
          .from("appearances")
          .select("id, title, external_url, start_at, end_at, location_id, event_id, event_occurrence_id, status, venue_name, location:locations(name)")
          .eq("business_id", business.value)
          .not("external_url", "is", null)
          .order("start_at", { ascending: true })
          .limit(100)
      : { data: [] };
    rows = ((data ?? []) as unknown as (LegacyConversionRow & { location: { name: string } | { name: string }[] | null })[]).map(({ location, ...r }) => ({
      ...r,
      location_name: (Array.isArray(location) ? location[0]?.name : location?.name) ?? null,
    }));
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Convert To Events</h1>
      <p className="mt-1 text-sm text-ink/60">
        Upgrade a Business&rsquo;s schedule items that have their own Event link into Findmi Events — one at a time, each re-read from its
        own source. The same schedule item is kept and linked; the Business stays a participant. New Events go live and appear under
        Events → New Events. Items whose source can&rsquo;t be read are skipped, never created thin.
      </p>

      <form method="get" className="mt-4 flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <RelationField label="Business" name="business_id" entity="businesses" initial={business} clearLabel={null} placeholder="Search Businesses…" />
        </div>
        <button type="submit" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-semibold text-ink hover:border-black/30">
          Show Items
        </button>
      </form>

      {business && <LegacyConversionBatch key={business.value} businessName={business.label} rows={rows} />}
    </div>
  );
}
