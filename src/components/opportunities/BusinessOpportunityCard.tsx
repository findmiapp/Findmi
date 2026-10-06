import Link from "next/link";
import { OPPORTUNITY_TYPE_LABELS, opportunityPriceParts, type BusinessOpportunityTone, type BusinessOpportunityView } from "@/lib/opportunity-listings-domain";
import { formatOpportunityDate } from "@/lib/opportunity-format";
import { ClockIcon, CreditIcon, PinIcon, TagIcon, type PresentablePlace } from "./OpportunityPresentation";

// Business-facing card for one commercial Opportunity in the Business's
// Opportunities inbox. Receives only the Business-safe view model.

export const BUSINESS_STATE_BADGE: Record<BusinessOpportunityTone, string> = {
  aqua: "bg-findmi text-white",
  aquaSoft: "bg-findmi-50 text-findmi-700",
  positive: "bg-findmi-700 text-white",
  neutral: "bg-black/[0.07] text-ink/70",
  muted: "bg-black/[0.04] text-ink/45",
};

export function BusinessStateBadge({ tone, label }: { tone: BusinessOpportunityTone; label: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BUSINESS_STATE_BADGE[tone]}`}>{label}</span>;
}

export default function BusinessOpportunityCard({ item, place, href }: { item: BusinessOpportunityView; place: PresentablePlace | null; href: string }) {
  const o = item.opportunity;
  const price = opportunityPriceParts(o);
  const placeName = place?.name ?? o.place_text;
  const placeDetail = place ? [place.city, place.state].filter(Boolean).join(", ") : null;
  const timing = o.timing_note ?? (o.starts_at ? formatOpportunityDate(o.starts_at) : null);
  const prominent = item.state.answerable && item.status === "offered";

  return (
    <article className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
      {o.image_url && (
        // Admin-uploaded Storage URL (arbitrary host) — plain <img>, same as the detail hero.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.image_url} alt="" className="h-36 w-full object-cover sm:h-40" />
      )}
      <div className="flex flex-col gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
              {OPPORTUNITY_TYPE_LABELS[o.opportunity_type]}
            </span>
            <BusinessStateBadge tone={item.state.tone} label={item.state.label} />
          </div>
          <h3 className="mt-2 break-words text-card-title font-semibold leading-snug text-primary">
            <Link href={href} className="hover:underline">
              {o.title}
            </Link>
          </h3>
          {o.summary && <p className="mt-1 line-clamp-2 text-metadata text-muted">{o.summary}</p>}
        </div>

        <div className="flex flex-col gap-2">
          {placeName && (
            <div className="flex items-start gap-2">
              <PinIcon size="sm" />
              <p className="min-w-0 pt-0.5 text-metadata leading-snug">
                <span className="font-semibold text-primary">{placeName}</span>
                {placeDetail && <span className="text-muted"> · {placeDetail}</span>}
              </p>
            </div>
          )}
          {timing && (
            <div className="flex items-start gap-2">
              <ClockIcon size="sm" />
              <p className="min-w-0 pt-0.5 text-metadata leading-snug text-secondary">{timing}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <TagIcon size="sm" />
              <p className="text-metadata leading-snug">
                <span className="font-bold text-primary">{price.amount}</span>
                {price.qualifier && <span className="text-muted"> · {price.qualifier}</span>}
              </p>
            </div>
            {o.credits_eligible && (
              <div className="flex items-center gap-2">
                <CreditIcon size="sm" />
                <p className="text-metadata font-semibold text-primary">Credits Eligible</p>
              </div>
            )}
          </div>
        </div>

        <Link
          href={href}
          className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-button font-bold transition ${
            prominent ? "bg-findmi text-white hover:bg-findmi-600" : "border border-black/10 text-primary hover:border-black/20"
          }`}
        >
          View Opportunity
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}
