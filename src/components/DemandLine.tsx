import { demandSentence } from "@/lib/product-wants-domain";
import type { ProductDemand } from "@/lib/product-wants";

/** Aggregate demand only — counts, never who. Shared by Business Manager
 * and Admin. Interest, not orders. */
export default function DemandLine({ demand, marketplaceEligible }: { demand: ProductDemand; marketplaceEligible: boolean }) {
  const sentence = demandSentence(demand.wantCount, marketplaceEligible);
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-ink/60">Demand</p>
      <p className="mt-0.5 text-metadata text-ink/75">{sentence ?? "No one has said they want this yet."}</p>
      {demand.wantCount > 0 && (
        <p className="mt-0.5 text-[11px] text-subtle">
          {demand.wantCount} total · {demand.recentCount} in the last 30 days — interest, not orders.
        </p>
      )}
    </div>
  );
}
