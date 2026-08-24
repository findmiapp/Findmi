import Link from "next/link";
import { getAllCategories } from "@/lib/admin/queries";
import SubmitBar from "@/components/admin/SubmitBar";
import { saveHomeCategories } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const categories = await getAllCategories();
  const sorted = [...categories].sort(
    (a, b) => (a.home_sort_order ?? 999) - (b.home_sort_order ?? 999) || a.name.localeCompare(b.name)
  );

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Homepage Categories
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        Choose which categories appear in the homepage&rsquo;s scrollable filter row, and in
        what order.
      </p>
      <Link
        href="/admin/categories/events"
        className="mt-4 flex items-center justify-between rounded-2xl border border-findmi/30 bg-findmi-50 px-4 py-3.5 transition hover:border-findmi/50"
      >
        <span>
          <span className="block text-sm font-semibold text-findmi-700">Event Categories</span>
          <span className="block text-xs text-ink/50">Add a new category to tag onto events.</span>
        </span>
        <span className="shrink-0 text-findmi-700">→</span>
      </Link>
      {saved && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <form action={saveHomeCategories} className="mt-5 flex flex-col gap-5">
        {categories.length === 0 ? (
          <p className="text-sm text-ink/50">No categories yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3"
              >
                <input type="hidden" name="all_category_ids" value={c.id} />
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    name={`show_${c.id}`}
                    defaultChecked={c.show_on_home}
                    className="h-5 w-5 shrink-0 accent-findmi"
                  />
                  <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                </label>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs text-ink/45">Order</span>
                  <input
                    type="number"
                    name={`order_${c.id}`}
                    defaultValue={c.home_sort_order ?? ""}
                    className="w-16 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <SubmitBar cancelHref="/admin" />
      </form>
    </div>
  );
}
