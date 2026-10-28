import { CATALOG_BLOCKERS, MARKETPLACE_INELIGIBILITY_COPY, type MarketplaceApprovalStatus, type MarketplaceReadiness } from "@/lib/commerce/marketplace-eligibility";
import { demandSentence } from "@/lib/product-wants-domain";
import type { ProductDemand } from "@/lib/product-wants";

const APPROVAL_LABEL: Record<"owner" | "admin", Record<MarketplaceApprovalStatus, string>> = {
  owner: {
    catalog_only: "Not requested",
    submitted: "Requested — awaiting Findmi review",
    approved: "Approved by Findmi",
    rejected: "Not approved",
    paused: "Paused by Findmi",
  },
  admin: {
    catalog_only: "Not requested (catalog only)",
    submitted: "Requested — awaiting review",
    approved: "Approved",
    rejected: "Rejected",
    paused: "Paused",
  },
};

/** Catalog vs Marketplace, at a glance — the ONE Marketplace rule's two
 * gates (approval, commerce readiness) reported separately with their
 * exact blockers, plus aggregate demand. Shared by Business Manager
 * (owner) and Admin so both read the same truth. Never shown publicly. */
export default function MarketplaceReadinessPanel({
  readiness,
  demand,
  audience,
}: {
  readiness: MarketplaceReadiness;
  demand: ProductDemand;
  audience: "owner" | "admin";
}) {
  const catalogBlockers = readiness.blockers.filter((b) => CATALOG_BLOCKERS.includes(b));
  const demandLine = demandSentence(demand.wantCount, readiness.eligible);
  return (
    <section aria-label="Marketplace readiness" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm">
      <p className={`text-xs font-bold uppercase tracking-wide ${readiness.eligible ? "text-findmi-700" : "text-ink/60"}`}>
        {readiness.eligible ? "Available In Findmi Marketplace" : readiness.catalogVisible ? "Listed In Your Catalog" : "Not Public Yet"}
      </p>
      <p className="mt-1 text-metadata text-muted">
        {readiness.eligible
          ? "Customers can buy this through Findmi checkout."
          : readiness.catalogVisible
            ? "Shown on your Findmi profile. It reaches the Marketplace once it's approved AND ready for checkout."
            : "Not publicly visible yet."}
      </p>

      <dl className="mt-3 grid gap-2">
        <Gate ok={readiness.approved} label="Marketplace approval" value={APPROVAL_LABEL[audience][readiness.approval]} />
        <Gate ok={readiness.commerceReady} label="Checkout readiness" value={readiness.commerceReady ? "Ready" : "Not ready"} />
      </dl>

      {readiness.commerceBlockers.length + catalogBlockers.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-metadata text-amber-900">
          {[...catalogBlockers, ...readiness.commerceBlockers].map((b) => (
            <li key={b}>{MARKETPLACE_INELIGIBILITY_COPY[b]}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-black/5 pt-2">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/60">Demand</p>
        <p className="mt-0.5 text-metadata text-ink/75">
          {demandLine ?? "No one has said they want this yet."}
          {demand.recentCount > 0 && demand.recentCount !== demand.wantCount && ` ${demand.recentCount} in the last 30 days.`}
        </p>
        {demand.wantCount > 0 && <p className="mt-0.5 text-[11px] text-subtle">Interest, not orders — people who said they want it.</p>}
      </div>
    </section>
  );
}

function Gate({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-metadata text-ink/60">{label}</dt>
      <dd className={`flex items-center gap-1.5 text-metadata font-semibold ${ok ? "text-findmi-700" : "text-amber-800"}`}>
        <span aria-hidden="true">{ok ? "✓" : "•"}</span>
        {value}
      </dd>
    </div>
  );
}
