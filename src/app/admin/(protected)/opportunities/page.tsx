import Link from "next/link";
import { getAdminOpportunityListingSummaries, type AdminOpportunityListingSummary } from "@/lib/opportunity-listings";
import {
  LISTING_STATUSES,
  LISTING_STATUS_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  RECIPIENT_STATUS_LABELS,
  formatOpportunityPrice,
  isListingStatus,
  type ListingStatus,
  type RecipientStatus,
} from "@/lib/opportunity-listings-domain";
import { ChevronRightGlyph } from "@/components/admin/shell/AdminIcons";
import OpportunitiesAdminTabs from "./OpportunitiesAdminTabs";
import { STATUS_BADGE, formatOpportunityDate, formatOpportunityTiming } from "./format";

export const dynamic = "force-dynamic";

/** Recipient counts on each row: Interested and Confirmed always (the two
 * operational numbers), the rest only when non-zero. Withdrawn is
 * housekeeping and only counted in the total. */
const COUNTED_STATUSES: RecipientStatus[] = ["offered", "interested", "not_interested", "confirmed", "completed", "cancelled"];
const ALWAYS_SHOWN = new Set<RecipientStatus>(["interested", "confirmed"]);

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold tabular-nums text-ink">{value}</span> {label}
    </span>
  );
}

function OpportunityRow({ o }: { o: AdminOpportunityListingSummary }) {
  const place = o.location?.name ?? o.place_text;
  const timing = formatOpportunityTiming(o);
  return (
    <Link
      href={`/admin/opportunities/${o.id}`}
      className="flex items-start gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-findmi-700">{OPPORTUNITY_TYPE_LABELS[o.opportunity_type]}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[o.status]}`}>
            {LISTING_STATUS_LABELS[o.status]}
          </span>
          {o.credits_eligible && (
            <span className="shrink-0 rounded-full border border-findmi/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
              Credits Eligible
            </span>
          )}
          {o.visibility === "discoverable" && (
            <span className="shrink-0 rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">Discoverable</span>
          )}
        </span>
        <span className="mt-1 block text-sm font-semibold text-ink">{o.title}</span>
        <span className="mt-0.5 block text-sm text-ink/70">
          {formatOpportunityPrice(o)}
          {place ? ` · ${place}` : ""}
        </span>
        {timing && <span className="mt-0.5 block text-xs text-ink/55">{timing}</span>}
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/55">
          <Stat label={o.counts.total === 1 ? "Recipient" : "Recipients"} value={o.counts.total} />
          {COUNTED_STATUSES.map((st) =>
            ALWAYS_SHOWN.has(st) || o.counts[st] > 0 ? <Stat key={st} label={RECIPIENT_STATUS_LABELS[st]} value={o.counts[st]} /> : null
          )}
        </span>
        <span className="mt-1 block text-xs text-ink/45">
          {o.response_deadline ? `Respond by ${formatOpportunityDate(o.response_deadline)} · ` : ""}
          Updated {formatOpportunityDate(o.updated_at)}
        </span>
      </span>
      <ChevronRightGlyph className="mt-1 h-4 w-4 shrink-0 text-ink/30" />
    </Link>
  );
}

/** Opportunities V1 Pass 2 — Admin list of Findmi-authored commercial
 * Opportunities, filterable by status, with recipient counts (one grouped
 * recipient read for the whole page — see getAdminOpportunityListingSummaries). */
export default async function OpportunitiesListPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusParam } = await searchParams;
  const status = isListingStatus(statusParam) ? statusParam : undefined;
  const listings = await getAdminOpportunityListingSummaries(status);

  const filters: { value?: ListingStatus; label: string }[] = [{ label: "All" }, ...LISTING_STATUSES.map((s) => ({ value: s, label: LISTING_STATUS_LABELS[s] }))];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Opportunities</h1>
          <p className="mt-1 max-w-xl text-sm text-ink/50">Commercial Opportunities Findmi recommends to Businesses.</p>
        </div>
        <Link
          href="/admin/opportunities/new"
          className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
        >
          + Add Opportunity
        </Link>
      </div>

      <OpportunitiesAdminTabs active="listings" />

      <nav aria-label="Filter by status" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {filters.map((f) => {
          const active = f.value === status;
          return (
            <Link
              key={f.label}
              href={f.value ? `/admin/opportunities?status=${f.value}` : "/admin/opportunities"}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                active ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink/65 hover:border-black/20 hover:text-ink"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 flex flex-col gap-2">
        {listings.length === 0 && (
          <p className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-center text-sm text-ink/45">
            {status ? `No ${LISTING_STATUS_LABELS[status]} Opportunities.` : "No Opportunities yet."}
          </p>
        )}
        {listings.map((o) => (
          <OpportunityRow key={o.id} o={o} />
        ))}
      </div>
    </div>
  );
}
