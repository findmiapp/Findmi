import Link from "next/link";
import { TextField } from "@/components/admin/Fields";
import { getAllCategories, getCategoryUsageCounts } from "@/lib/admin/queries";
import { createCategory } from "./actions";

export const dynamic = "force-dynamic";

// Event Categories — the categories table is shared with businesses (see
// getCategoryUsageCounts), but this screen is deliberately scoped to the
// event side of it: creating a new category (the one real admin gap —
// assigning categories to an event already worked, from that event's own
// edit page's "Categories / Experience" checklist) and showing how many
// events each one is actually tagged on, without also exposing the
// business-homepage show_on_home/order controls that live at
// /admin/categories. Not a parallel taxonomy system — same table, a
// narrower, event-focused view of it.
export default async function EventCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const [categories, usage] = await Promise.all([getAllCategories(), getCategoryUsageCounts()]);
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/categories" className="hover:underline">
          Categories
        </Link>
        <span>/</span>
        <span>Event Categories</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Event Categories</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Create categories here, then assign them to a specific event from that event&rsquo;s own edit
        page (Categories / Experience). This list is shared with Business Categories — a category can
        be used for both — but nothing here changes homepage business-filter settings.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Category added — assign it to an event from that event&rsquo;s edit page.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Add Category</p>
        <form action={createCategory} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField label="Name" name="name" placeholder="e.g. Live Music" />
          </div>
          <div className="flex-1">
            <TextField label="Slug" name="slug" placeholder="e.g. live-music" hint="Used in filter URLs." />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Add Category
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-ink/40">All Categories</p>
      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-ink/45">No categories yet — add one above.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {sorted.map((c) => {
            const count = usage.get(c.id) ?? { events: 0, businesses: 0 };
            return (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3"
              >
                <span className="min-w-0 truncate text-sm font-medium text-ink">{c.name}</span>
                <span className="shrink-0 text-xs text-ink/45">
                  {count.events} event{count.events === 1 ? "" : "s"} · {count.businesses} business
                  {count.businesses === 1 ? "" : "es"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
