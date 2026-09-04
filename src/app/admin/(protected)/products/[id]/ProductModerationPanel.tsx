import type { AdminProduct } from "@/lib/admin/queries";
import type { Category, ProductPendingChanges } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { approveProduct, rejectProduct } from "../actions";

/** Product Moderation pass — the admin-side review surface for
 * owner-submitted Product content. Renders three states:
 *   1. moderation_status = "pending_review" — a brand-new product,
 *      never public. No "current" to compare against, just the
 *      submitted values and Approve/Reject.
 *   2. moderation_status = "live" with pending_changes set — an
 *      already-approved/public product with a standing proposed edit.
 *      Shows Current vs Proposed for every field the proposal touches;
 *      Approve copies the proposal onto the live row, Reject discards
 *      the proposal and leaves the live content untouched (see
 *      ../actions.ts's approveProduct/rejectProduct).
 *   3. Anything else ("live" with no pending_changes, or "rejected")
 *      — nothing to review, renders nothing so this panel doesn't
 *      clutter an ordinary admin-authored product's edit page. */
export default function ProductModerationPanel({
  product,
  categories,
  currentCategoryId,
}: {
  product: AdminProduct;
  categories: Category[];
  currentCategoryId: string | null;
}) {
  const moderationStatus = product.moderation_status ?? "live";
  const pendingChanges = product.pending_changes ?? null;

  if (moderationStatus !== "pending_review" && !pendingChanges) return null;

  const categoryName = (categoryId: string | null | undefined) =>
    categoryId ? (categories.find((c) => c.id === categoryId)?.name ?? "—") : "No category";

  const rows: { label: string; current?: string; proposed: string }[] = moderationStatus === "pending_review"
    ? [
        { label: "Name", proposed: product.name },
        { label: "Description", proposed: product.description || "—" },
        { label: "Price", proposed: formatPrice(product.price, product.price_label) || "—" },
        { label: "External URL", proposed: product.external_purchase_url || "—" },
      ]
    : buildProposedRows(product, pendingChanges as ProductPendingChanges, currentCategoryId, categoryName);

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
      <p className="text-sm font-bold text-amber-800">
        {moderationStatus === "pending_review" ? "Awaiting first approval" : "Edit awaiting approval"}
      </p>
      <p className="mt-0.5 text-xs text-amber-900/70">
        {moderationStatus === "pending_review"
          ? "This product was submitted by the business owner and is not yet public."
          : "The business owner proposed changes below. The current live version stays public until you approve or reject."}
      </p>

      {product.image_url && (
        <div className="mt-3 h-16 w-16 overflow-hidden rounded-lg border border-black/10 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- small review preview only */}
          <img src={product.image_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-amber-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-amber-100 text-[11px] font-bold uppercase tracking-wide text-ink/40">
              <th className="px-3 py-2">Field</th>
              {moderationStatus !== "pending_review" && <th className="px-3 py-2">Current</th>}
              <th className="px-3 py-2">{moderationStatus === "pending_review" ? "Submitted" : "Proposed"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-amber-50 last:border-0">
                <td className="px-3 py-2 font-semibold text-ink/70">{row.label}</td>
                {moderationStatus !== "pending_review" && (
                  <td className="px-3 py-2 text-ink/60">{row.current}</td>
                )}
                <td className="px-3 py-2 font-medium text-ink">{row.proposed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <form action={approveProduct.bind(null, product.id)}>
          <button
            type="submit"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600"
          >
            Approve
          </button>
        </form>
        <form action={rejectProduct.bind(null, product.id)}>
          <button
            type="submit"
            className="rounded-full border border-red-300 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-700 hover:bg-red-50"
          >
            Reject
          </button>
        </form>
      </div>
    </div>
  );
}

function buildProposedRows(
  product: AdminProduct,
  changes: ProductPendingChanges,
  currentCategoryId: string | null,
  categoryName: (id: string | null | undefined) => string
): { label: string; current: string; proposed: string }[] {
  const rows: { label: string; current: string; proposed: string }[] = [];
  if (changes.name !== undefined && changes.name !== product.name) {
    rows.push({ label: "Name", current: product.name, proposed: changes.name });
  }
  if (changes.description !== undefined && changes.description !== product.description) {
    rows.push({ label: "Description", current: product.description || "—", proposed: changes.description || "—" });
  }
  if (
    (changes.price !== undefined && changes.price !== product.price) ||
    (changes.price_label !== undefined && changes.price_label !== product.price_label)
  ) {
    rows.push({
      label: "Price",
      current: formatPrice(product.price, product.price_label) || "—",
      proposed: formatPrice(changes.price ?? product.price, changes.price_label ?? product.price_label) || "—",
    });
  }
  if (changes.product_type !== undefined && changes.product_type !== product.product_type) {
    rows.push({ label: "Type", current: product.product_type, proposed: changes.product_type });
  }
  if (changes.external_purchase_url !== undefined && changes.external_purchase_url !== product.external_purchase_url) {
    rows.push({
      label: "External URL",
      current: product.external_purchase_url || "—",
      proposed: changes.external_purchase_url || "—",
    });
  }
  if (changes.category_id !== undefined && changes.category_id !== currentCategoryId) {
    rows.push({
      label: "Category",
      current: categoryName(currentCategoryId),
      proposed: categoryName(changes.category_id),
    });
  }
  return rows;
}
