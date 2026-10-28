import { CATALOG_BLOCKERS, MARKETPLACE_INELIGIBILITY_COPY, type MarketplaceReadiness } from "@/lib/commerce/marketplace-eligibility";
import { adminMarketplaceSummary } from "@/lib/commerce/marketplace-presentation";
import type { ProductDemand } from "@/lib/product-wants";
import DemandLine from "./DemandLine";

/** Admin — Marketplace diagnostics: Marketplace Review, Checkout and
 * Marketplace Listing as three separate rows (listing = the canonical
 * engine's eligibility, never inferred), every exact blocker, and
 * aggregate demand. Business owners see OwnerMarketplacePanel instead. */
export default function MarketplaceReadinessPanel({ readiness, demand }: { readiness: MarketplaceReadiness; demand: ProductDemand }) {
  const { rows, summary, listingLive } = adminMarketplaceSummary(readiness);
  const blockers = [...readiness.blockers.filter((b) => CATALOG_BLOCKERS.includes(b)), ...readiness.commerceBlockers];
  return (
    <section aria-label="Marketplace readiness" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm">
      <p className={`text-xs font-bold uppercase tracking-wide ${listingLive ? "text-findmi-700" : "text-ink/60"}`}>{listingLive ? "Live In Marketplace" : "Not Live In Marketplace"}</p>
      <p className="mt-1 text-metadata text-muted">{summary}</p>
      <dl className="mt-3 grid gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-metadata text-ink/60">{row.label}</dt>
            <dd className={`text-metadata font-semibold ${row.ok ? "text-findmi-700" : "text-amber-800"}`}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {blockers.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-metadata text-amber-900">
          {blockers.map((b) => (
            <li key={b}>{MARKETPLACE_INELIGIBILITY_COPY[b]}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 border-t border-black/5 pt-2">
        <DemandLine demand={demand} marketplaceEligible={readiness.eligible} />
      </div>
    </section>
  );
}
