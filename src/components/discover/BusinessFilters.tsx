import type { Category } from "@/lib/types";

/**
 * Business archive filter fields (Discovery/Archive V2 Part 5/15) — real
 * data only: category (business taxonomy), location (free-text city/
 * state — the only location data businesses actually have), Featured
 * and Founding Member (both real founder-set flags). No distance/open-
 * now/ratings/price-level — none of those fields exist on `businesses`.
 * Plain form fields, no client JS — submits with the page's own
 * <form method="get"> inside FilterSheet.
 */
export default function BusinessFilters({
  categories,
  defaultCategory,
  defaultLocation,
  defaultFeatured,
  defaultFounding,
}: {
  categories: Category[];
  defaultCategory?: string;
  defaultLocation?: string;
  defaultFeatured?: boolean;
  defaultFounding?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
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

      <div className="flex flex-col gap-2.5">
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" name="featured" value="1" defaultChecked={defaultFeatured} className="h-4 w-4 accent-findmi" />
          Featured Brands
        </label>
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" name="founding" value="1" defaultChecked={defaultFounding} className="h-4 w-4 accent-findmi" />
          Founding Members
        </label>
      </div>

      <button
        type="submit"
        className="mt-1 flex h-11 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Show Results
      </button>
    </div>
  );
}
