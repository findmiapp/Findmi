import type { AdminProduct } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/format";
import { resolveMarketplaceFeePercent } from "@/lib/commerce/fees";
import { approveMarketplaceSubmission, pauseMarketplaceListing, rejectMarketplaceSubmission, resumeMarketplaceListing } from "../actions";

/** Product Marketplace Distribution pass — the admin-side review surface
 * for an owner's Marketplace/discovery placement request. Entirely
 * separate from ProductModerationPanel (content approval): that panel
 * decides whether the Product's content is approved at all; this one
 * decides whether an approved Product may ALSO appear in broader FindMi
 * Marketplace/discovery surfaces, never merged into the same Approve/
 * Reject actions. Renders only for states that need a decision or offer a
 * follow-up action — "catalog_only" (nothing requested) and "rejected"
 * (nothing pending) render nothing, same "don't clutter an ordinary
 * product's page" rule ProductModerationPanel already follows. */
export default function MarketplaceReviewPanel({
  product,
  businessName,
  categoryName,
  businessFeePercent,
}: {
  product: AdminProduct;
  businessName: string;
  categoryName: string | null;
  businessFeePercent: number | null;
}) {
  const marketplaceStatus = product.marketplace_status ?? "catalog_only";
  if (marketplaceStatus !== "submitted" && marketplaceStatus !== "approved" && marketplaceStatus !== "paused") {
    return null;
  }

  const contentLive = (product.moderation_status ?? "live") === "live";
  // Business.marketplace_fee_percent is typed as a required `number`, but
  // the underlying column is nullable (unset = use the platform default) —
  // resolveMarketplaceFeePercent's own `!= null` check already relies on
  // that at runtime, so this cast matches the existing precedent rather
  // than widening the shared Business type for one caller.
  const { percent, source } = resolveMarketplaceFeePercent(
    { marketplace_fee_percent: businessFeePercent as number },
    { marketplace_fee_override_percent: product.marketplace_fee_override_percent }
  );
  const sourceLabel =
    source === "product_override" ? "product override" : source === "business_override" ? "business override" : "platform default";

  return (
    <div className="rounded-2xl border border-sky-300 bg-sky-50 p-4 sm:p-5">
      <p className="text-sm font-bold text-sky-800">
        {marketplaceStatus === "submitted"
          ? "Marketplace Submission — Awaiting Review"
          : marketplaceStatus === "approved"
            ? "Marketplace: Approved"
            : "Marketplace: Paused"}
      </p>
      <p className="mt-0.5 text-xs text-sky-900/70">
        {marketplaceStatus === "submitted"
          ? "The owner requested broader FindMi Marketplace/discovery placement for this product."
          : marketplaceStatus === "approved"
            ? "This product may appear in broader FindMi Marketplace/discovery surfaces, in addition to its own business profile."
            : "Marketplace/discovery visibility is temporarily paused. The product remains visible on its own business profile."}
      </p>

      {product.image_url && (
        <div className="mt-3 h-16 w-16 overflow-hidden rounded-lg border border-black/10 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- small review preview only */}
          <img src={product.image_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-sky-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            <tr className="border-b border-sky-50">
              <td className="px-3 py-2 font-semibold text-ink/70">Business</td>
              <td className="px-3 py-2 text-ink">{businessName}</td>
            </tr>
            <tr className="border-b border-sky-50">
              <td className="px-3 py-2 font-semibold text-ink/70">Product</td>
              <td className="px-3 py-2 text-ink">{product.name}</td>
            </tr>
            <tr className="border-b border-sky-50">
              <td className="px-3 py-2 font-semibold text-ink/70">Price</td>
              <td className="px-3 py-2 text-ink">{formatPrice(product.price, product.price_label) || "—"}</td>
            </tr>
            <tr className="border-b border-sky-50">
              <td className="px-3 py-2 font-semibold text-ink/70">Category</td>
              <td className="px-3 py-2 text-ink">{categoryName || "No category"}</td>
            </tr>
            <tr className="border-b border-sky-50">
              <td className="px-3 py-2 font-semibold text-ink/70">External URL</td>
              <td className="px-3 py-2 text-ink">{product.external_purchase_url || "—"}</td>
            </tr>
            <tr className="border-b border-sky-50">
              <td className="px-3 py-2 font-semibold text-ink/70">Content Status</td>
              <td className="px-3 py-2 text-ink">{contentLive ? "Live (approved)" : "Not yet live"}</td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-semibold text-ink/70">Marketplace Commission</td>
              <td className="px-3 py-2 text-ink">
                {percent}% <span className="text-xs text-ink/40">({sourceLabel})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {marketplaceStatus === "submitted" && !contentLive && (
        <p className="mt-3 text-xs font-semibold text-amber-700">
          Approve this product&rsquo;s content first — Marketplace approval is blocked until it&rsquo;s live.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {marketplaceStatus === "submitted" && (
          <>
            <form action={approveMarketplaceSubmission.bind(null, product.id)}>
              <button
                type="submit"
                disabled={!contentLive}
                className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Approve For Marketplace
              </button>
            </form>
            <form action={rejectMarketplaceSubmission.bind(null, product.id)}>
              <button
                type="submit"
                className="rounded-full border border-red-300 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-700 hover:bg-red-50"
              >
                Reject Marketplace Submission
              </button>
            </form>
          </>
        )}
        {marketplaceStatus === "approved" && (
          <form action={pauseMarketplaceListing.bind(null, product.id)}>
            <button
              type="submit"
              className="rounded-full border border-sky-300 px-4 py-2 text-xs font-bold uppercase tracking-wide text-sky-700 hover:bg-sky-100"
            >
              Pause Marketplace Visibility
            </button>
          </form>
        )}
        {marketplaceStatus === "paused" && (
          <>
            <form action={resumeMarketplaceListing.bind(null, product.id)}>
              <button
                type="submit"
                disabled={!contentLive}
                className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Resume Marketplace Visibility
              </button>
            </form>
            <form action={rejectMarketplaceSubmission.bind(null, product.id)}>
              <button
                type="submit"
                className="rounded-full border border-red-300 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-700 hover:bg-red-50"
              >
                Reject Marketplace Submission
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
