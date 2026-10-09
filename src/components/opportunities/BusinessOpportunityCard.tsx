import Link from "next/link";
import type { ReactNode } from "react";
import {
  OPPORTUNITY_TYPE_LABELS,
  opportunityPriceParts,
  type BusinessOpportunityTone,
  type BusinessOpportunityView,
  type PresentableOpportunity,
} from "@/lib/opportunity-listings-domain";
import { formatOpportunityDate } from "@/lib/opportunity-format";
import { ClockIcon, commercialCardLine, PinIcon, TagIcon, type PresentablePlace } from "./OpportunityPresentation";
import { imageVariantUrl } from "@/lib/image-variants";
import type { AdminOpportunityOption } from "@/lib/opportunity-listings";

// Business-facing cards for commercial Opportunities. They only ever
// receive Business-safe data: a PresentableOpportunity (field-picked, no
// Admin columns) plus public Location context.

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

function TypeBadge({ o }: { o: PresentableOpportunity }) {
  return (
    <span className="rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">{OPPORTUNITY_TYPE_LABELS[o.opportunity_type]}</span>
  );
}

/** One commercial Opportunity as an offer card. `compact` is the Home
 * preview: shorter image, no summary, facts on two tight lines. */
export function OpportunityCard({
  o,
  place,
  href,
  badge,
  prominent,
  compact = false,
  corner,
  commercialOptions,
}: {
  o: PresentableOpportunity;
  place: PresentablePlace | null;
  href: string;
  badge?: ReactNode;
  prominent: boolean;
  compact?: boolean;
  /** Optional top-right element on the image or header (e.g. "3 New"). */
  corner?: ReactNode;
  /** Pass 3 — this listing's structured Options, for a direction-aware
   * card summary (never the raw legacy projection once Options exist).
   * Omitted/empty falls back to the exact legacy price/qualifier. */
  commercialOptions?: AdminOpportunityOption[];
}) {
  const price = opportunityPriceParts(o);
  const commercial = commercialCardLine(commercialOptions, price);
  const placeName = place?.name ?? o.place_text;
  const placeDetail = place ? [place.city, place.state].filter(Boolean).join(", ") : null;
  const timing = o.timing_note ?? (o.starts_at ? formatOpportunityDate(o.starts_at) : null);

  return (
    <article className="relative overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
      {o.image_url && (
        // Admin-uploaded Storage URL (arbitrary host) — plain <img>, same as the detail hero.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageVariantUrl(o.image_url, "card")} alt="" className={`w-full object-cover ${compact ? "h-28 sm:h-32" : "h-36 sm:h-40"}`} />
      )}
      {corner && <div className="absolute right-3 top-3">{corner}</div>}
      <div className={`flex flex-col ${compact ? "gap-2.5 p-3.5" : "gap-3 p-4"}`}>
        <div>
          <div className={`flex flex-wrap items-center gap-1.5 ${corner && !o.image_url ? "pr-16" : ""}`}>
            <TypeBadge o={o} />
            {badge}
          </div>
          <h3 className="mt-2 break-words text-card-title font-semibold leading-snug text-primary">
            <Link href={href} className="hover:underline">
              {o.title}
            </Link>
          </h3>
          {!compact && o.summary && <p className="mt-1 line-clamp-2 text-metadata text-muted">{o.summary}</p>}
        </div>

        <div className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"}`}>
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
              <p className={`min-w-0 pt-0.5 text-metadata leading-snug text-secondary ${compact ? "line-clamp-1" : ""}`}>{timing}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <TagIcon size="sm" />
              <p className="text-metadata leading-snug">
                <span className="font-bold text-primary">{commercial.title}</span>
                {commercial.detail && <span className="text-muted"> · {commercial.detail}</span>}
              </p>
            </div>
          </div>
        </div>

        <Link
          href={href}
          className={`flex items-center justify-center gap-1.5 rounded-xl text-button font-bold transition ${compact ? "h-10" : "h-11"} ${
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

/** A Business's own relationship (recipient view model) as a card. */
export default function BusinessOpportunityCard({
  item,
  place,
  href,
  compact,
  corner,
  commercialOptions,
}: {
  item: BusinessOpportunityView;
  place: PresentablePlace | null;
  href: string;
  compact?: boolean;
  corner?: ReactNode;
  /** Pass 3 — see OpportunityCard's own prop comment. */
  commercialOptions?: AdminOpportunityOption[];
}) {
  return (
    <OpportunityCard
      o={item.opportunity}
      place={place}
      href={href}
      badge={<BusinessStateBadge tone={item.state.tone} label={item.state.label} />}
      prominent={item.state.answerable && item.status === "offered"}
      compact={compact}
      corner={corner}
      commercialOptions={commercialOptions}
    />
  );
}
