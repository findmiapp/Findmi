import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { Panel } from "../../owner-ui";
import { setFeaturedEvent } from "../actions";

/** Featured Event System — the smallest coherent owner control: a plain
 * native select of this Business's own APPROVED event_businesses
 * participations (never any other Business's Events, never a free-text
 * id), defaulting to "Automatic" (clears the override — see
 * lib/featured-event.ts for what automatic selection means). Fetches its
 * own small, self-contained data set rather than threading through the
 * page's much larger existing data pipeline. */
export default async function FeaturedEventControl({
  businessId,
  currentFeaturedEventId,
}: {
  businessId: string;
  currentFeaturedEventId: string | null;
}) {
  const admin = getAdminSupabase();
  if (!admin) return null;

  const { data } = await admin
    .from("event_businesses")
    .select("event:events(id, name, start_at)")
    .eq("business_id", businessId)
    .eq("status", "approved");

  type JoinedEvent = { id: string; name: string; start_at: string };
  const eligibleEvents = (data ?? [])
    .map((row) => (Array.isArray(row.event) ? row.event[0] : row.event) as JoinedEvent | null)
    .filter((e): e is JoinedEvent => Boolean(e))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  if (eligibleEvents.length === 0) return null;

  const action = setFeaturedEvent.bind(null, businessId);

  return (
    <Panel title="Featured Event" meta={<span className="text-metadata text-subtle">What shows on your public page</span>}>
      <form action={action} className="flex flex-col gap-2">
        <label className="block">
          <span className="mb-1.5 block text-body font-medium text-primary">Featured Event</span>
          <select
            name="event_id"
            defaultValue={currentFeaturedEventId ?? ""}
            className="block w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-findmi focus:outline-none focus:ring-1 focus:ring-findmi"
          >
            <option value="">Automatic (recommended)</option>
            {eligibleEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-metadata text-subtle">
          Automatic shows the soonest live or upcoming Event you&rsquo;re part of. Choose one here to always feature it
          instead, regardless of date.
        </p>
        <button
          type="submit"
          className="self-start rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
        >
          Save
        </button>
      </form>
    </Panel>
  );
}
