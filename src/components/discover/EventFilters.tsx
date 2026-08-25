import type { Category } from "@/lib/types";

/**
 * Event archive filter fields (Discovery/Archive V2 Part 9/10/15) —
 * category options come from EVENT taxonomy only (event_categories via
 * getEventCategories(), passed in by the page — never business
 * categories). Location is the same free-text city/state match events
 * already support. No popularity/attendance/capacity/distance/price —
 * none of those exist on `events`. Time (Up Next/Today/This
 * Weekend/All Events) is a separate, primary top-level control on the
 * page, not inside this sheet — it's the dominant axis for event
 * discovery, same treatment the homepage already uses.
 */
export default function EventFilters({
  categories,
  defaultCategory,
  defaultLocation,
}: {
  categories: Category[];
  defaultCategory?: string;
  defaultLocation?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {categories.length > 0 && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Category</span>
          <select
            name="category"
            defaultValue={defaultCategory ?? ""}
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Location</span>
        <input
          type="text"
          name="location"
          defaultValue={defaultLocation}
          placeholder="City or state"
          className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
        />
      </label>

      <button
        type="submit"
        className="mt-1 flex h-11 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Show Results
      </button>
    </div>
  );
}
