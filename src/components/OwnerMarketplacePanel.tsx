import type { ReactNode } from "react";
import type { MarketplaceReadiness } from "@/lib/commerce/marketplace-eligibility";
import { ownerMarketplaceState } from "@/lib/commerce/marketplace-presentation";
import type { ProductDemand } from "@/lib/product-wants";
import DemandLine from "./DemandLine";

/** Business Manager — Marketplace, in owner language: one headline that
 * names the next step, three compact status rows, and only the action
 * that can actually succeed (`actions` is rendered only when the state
 * allows one — never a button that's known to fail). Read straight from
 * the canonical readiness engine via ownerMarketplaceState. Incomplete
 * setup is a normal state, never an error banner. */
export default function OwnerMarketplacePanel({ readiness, demand, actions }: { readiness: MarketplaceReadiness; demand: ProductDemand; actions?: ReactNode }) {
  const state = ownerMarketplaceState(readiness);
  return (
    <section aria-label="Marketplace" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm">
      <p className={`text-body font-semibold ${state.step === "live" ? "text-findmi-700" : "text-primary"}`}>{state.headline}</p>
      <p className="mt-0.5 text-metadata text-muted">{state.body}</p>
      <dl className="mt-3 grid gap-1.5">
        {state.rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-metadata text-ink/60">{row.label}</dt>
            <dd className={`text-metadata font-semibold ${row.ok ? "text-findmi-700" : "text-ink/70"}`}>
              {row.ok ? "✓ " : ""}
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {actions && <div className="mt-3">{actions}</div>}
      <div className="mt-3 border-t border-black/5 pt-2">
        <DemandLine demand={demand} marketplaceEligible={readiness.eligible} />
      </div>
    </section>
  );
}
