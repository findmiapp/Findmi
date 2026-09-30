import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { setLocationFeaturedEvent } from "../actions";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-11 items-center justify-center rounded-2xl bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

/** Featured Event System — the smallest coherent owner control: a plain
 * native select of Events that have a real event_occurrences row at this
 * Location (never any other Location's Events), defaulting to
 * "Automatic" (clears the override — see lib/featured-event.ts for what
 * automatic selection means). Fetches its own small, self-contained data
 * set rather than threading through the page's larger existing data
 * pipeline. Renders nothing at all when there's nothing eligible yet. */
export default async function FeaturedEventControl({
  locationId,
  currentFeaturedEventId,
}: {
  locationId: string;
  currentFeaturedEventId: string | null;
}) {
  const admin = getAdminSupabase();
  if (!admin) return null;

  const { data } = await admin
    .from("event_occurrences")
    .select("event:events(id, name, start_at)")
    .eq("location_id", locationId)
    .eq("status", "scheduled");

  type JoinedEvent = { id: string; name: string; start_at: string };
  const byId = new Map<string, JoinedEvent>();
  for (const row of data ?? []) {
    const e = Array.isArray(row.event) ? row.event[0] : row.event;
    if (e) byId.set(e.id, e as JoinedEvent);
  }
  const eligibleEvents = Array.from(byId.values()).sort((a, b) => a.start_at.localeCompare(b.start_at));

  if (eligibleEvents.length === 0) return null;

  const action = setLocationFeaturedEvent.bind(null, locationId);

  return (
    <div className="border-t border-black/5 pt-6">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Featured Event</p>
      <p className="mt-1 text-xs text-ink/40">What shows on your public page.</p>
      <form action={action} className="mt-3 flex flex-col items-start gap-3">
        <select name="event_id" defaultValue={currentFeaturedEventId ?? ""} className={inputClass}>
          <option value="">Automatic (recommended)</option>
          {eligibleEvents.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink/40">
          Automatic shows the soonest live or upcoming Event happening here. Choose one here to always feature it
          instead, regardless of date.
        </p>
        <button type="submit" className={`w-fit ${primaryButtonClass}`}>
          Save
        </button>
      </form>
    </div>
  );
}
