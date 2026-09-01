import Link from "next/link";
import HomepageRowCard from "@/components/admin/HomepageRowCard";
import { TextField } from "@/components/admin/Fields";
import { getAllCategories, getCuratedItemPreviews } from "@/lib/admin/queries";
import { getAdminHomepageRows } from "@/lib/homepage-rows";
import { createHomepageRow, deleteHomepageRow, moveHomepageRowDown, moveHomepageRowUp, saveHomepageRow } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomepageRowsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const [rows, businessCategories, eventCategories, productCategories] = await Promise.all([
    getAdminHomepageRows(),
    getAllCategories("business"),
    getAllCategories("event"),
    getAllCategories("product"),
  ]);
  const categoriesByKind = { business: businessCategories, event: eventCategories, product: productCategories };

  // Curated previews only make sense for content types the search picker
  // supports (business_showcase rows never have curated_ids) — fetched
  // once here, one query per pickable row, rather than inside each card.
  const previews = await Promise.all(
    rows.map((row) =>
      row.mode === "curated" && row.content_type !== "business_showcase" && row.curated_ids.length > 0
        ? getCuratedItemPreviews(row.content_type, row.curated_ids)
        : Promise.resolve([])
    )
  );

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/site/homepage" className="hover:underline">
          Homepage
        </Link>
        <span>/</span>
        <span>Homepage Rows</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Homepage Rows</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Add, rename, reorder, hide, or delete discovery rows on the public homepage — no code change
        needed. Each row can pull in real Businesses, Events, or Products automatically by filter
        (Dynamic), or you can hand-pick exactly what shows (Curated).
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {saved === "created" ? "New row added — edit it below to configure it." : "Saved."}
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Add a new row</p>
        <form action={createHomepageRow} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField label="Row Title" name="title" placeholder="e.g. Coffee Around You" />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Add Row
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink/45">No homepage rows yet — add one above.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {rows.map((row, i) => (
            <HomepageRowCard
              key={row.id}
              row={row}
              categoriesByKind={categoriesByKind}
              curatedPreview={previews[i]}
              saveAction={saveHomepageRow.bind(null, row.id)}
              deleteAction={deleteHomepageRow.bind(null, row.id)}
              moveUpAction={moveHomepageRowUp.bind(null, row.id)}
              moveDownAction={moveHomepageRowDown.bind(null, row.id)}
              canMoveUp={i > 0}
              canMoveDown={i < rows.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
