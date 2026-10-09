import type { ReactNode } from "react";
import Link from "next/link";
import {
  OPPORTUNITY_SECTION_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  opportunityPriceParts,
  type PresentableOpportunity,
} from "@/lib/opportunity-listings-domain";
import { formatOpportunityDate, formatOpportunityDateTime } from "@/lib/opportunity-format";
import { imageVariantUrl } from "@/lib/image-variants";
import type { AdminOpportunityOption } from "@/lib/opportunity-listings";
import {
  IN_KIND_CATEGORY_LABELS,
  calculateInKindEstimatedValueCents,
  formatMonetaryPerUnitEquivalent,
  formatQuantityUnit,
  type OptionFields,
} from "@/lib/opportunity-commercial-terms-domain";
import { buildBusinessDeal, businessDealSummary, type DealFormatters, type DealHeadline, type DealItem, type DealPackage } from "@/lib/opportunity-business-deal";

// Business-facing presentation boundary: `commercialOptions` being OMITTED
// (undefined) means "render the legacy Investment fact/block exactly as
// before" (Admin's call sites never pass it). Business pages pass their
// listing's Options (even [] for a listing that predates them) and render
// The Deal (OpportunityDeal) — the Business never sees Admin's own
// rendering, and Admin never sees the Business wording.
const asOptionFields = (o: AdminOpportunityOption): OptionFields => o as unknown as OptionFields;

/** The canonical domain formatters, handed to the import-free Deal view
 * model (src/lib/opportunity-business-deal.ts). */
const DEAL_FORMATTERS: DealFormatters = {
  quantityUnit: formatQuantityUnit,
  perUnitEquivalent: formatMonetaryPerUnitEquivalent,
  estimatedValueCents: calculateInKindEstimatedValueCents,
  categoryLabel: (category) => IN_KIND_CATEGORY_LABELS[category],
};

// Opportunities V1 — the READ-ONLY commercial presentation of one
// Opportunity, shared by Admin (/admin/opportunities/[id]) and the future
// Business view. It only ever receives a PresentableOpportunity (built by
// toPresentableOpportunity, which never carries Admin-only columns) plus
// public Location/Event context. Admin controls — lifecycle actions, Edit,
// recipients, internal notes — are passed in as slots or live outside.

export interface PresentablePlace {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface PresentableEvent {
  name: string;
  start_at: string | null;
}

// ---------------------------------------------------------------- icons

type IconSize = "md" | "sm";

function Icon({ children, size = "md" }: { children: ReactNode; size?: IconSize }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700 ${size === "sm" ? "h-6 w-6" : "h-8 w-8"}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"}>
        {children}
      </svg>
    </span>
  );
}
export const TagIcon = ({ size }: { size?: IconSize } = {}) => (
  <Icon size={size}>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </Icon>
);
export const CreditIcon = ({ size }: { size?: IconSize } = {}) => (
  <Icon size={size}>
    <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9Z" />
  </Icon>
);
export const PinIcon = ({ size }: { size?: IconSize } = {}) => (
  <Icon size={size}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);
export const ClockIcon = ({ size }: { size?: IconSize } = {}) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const DeadlineIcon = ({ size }: { size?: IconSize } = {}) => (
  <Icon size={size}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

// ---------------------------------------------------------------- helpers

function placeLine(place: PresentablePlace | null): string | null {
  if (!place) return null;
  const cityState = [place.city, place.state].filter(Boolean).join(", ");
  return [place.address, cityState].filter(Boolean).join(" · ") || null;
}

function dateRange(o: PresentableOpportunity): string | null {
  if (!o.starts_at && !o.ends_at) return null;
  const start = formatOpportunityDateTime(o.starts_at);
  const end = formatOpportunityDateTime(o.ends_at);
  return start && end ? `${start} – ${end}` : start || end;
}

/** The price-like line on a card / facts row. `commercialOptions`
 * undefined (Admin) keeps the exact legacy price + qualifier. Present
 * (Business, even []) uses the Business Deal summary — "$750
 * Participation Fee", "Free to Participate", "Packages from $750"… */
export function commercialCardLine(
  commercialOptions: AdminOpportunityOption[] | undefined,
  legacy: { amount: string; qualifier: string | null },
  listing: Pick<PresentableOpportunity, "pricing_mode" | "price_cents" | "currency">
): { title: string; detail: string | null } {
  if (!commercialOptions) return { title: legacy.amount, detail: legacy.qualifier };
  return { title: businessDealSummary(listing, commercialOptions.map(asOptionFields), DEAL_FORMATTERS), detail: null };
}

function Fact({ icon, title, detail, children }: { icon: ReactNode; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      {icon}
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-semibold leading-snug text-ink">{title}</p>
        {detail && <p className="text-xs leading-snug text-ink/55">{detail}</p>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- hero

/** Key commercial facts: investment, credits, place/host, timing, deadline.
 * `showCredits` (default true) gates the Credits Eligible fact — Opportunity
 * Credits are dormant infrastructure with no working redemption mechanism
 * (Opportunities Cleanup Pass A), so Business-facing call sites pass
 * `showCredits={false}` while Admin keeps seeing it. */
export { placeLine as formatPlaceLine };

export function OpportunityFacts({
  o,
  place,
  showCredits = true,
  commercialOptions,
  showCommercialFact = true,
}: {
  o: PresentableOpportunity;
  place: PresentablePlace | null;
  showCredits?: boolean;
  /** See the module-level comment on this prop's semantics. */
  commercialOptions?: AdminOpportunityOption[];
  /** Business detail pages pass false: The Deal follows the introduction,
   * so the price never appears twice. */
  showCommercialFact?: boolean;
}) {
  const price = opportunityPriceParts(o);
  const fact = commercialCardLine(commercialOptions, price, o);
  const isLegacyFact = !commercialOptions;
  const factDetail = fact.detail ? `${fact.detail}${isLegacyFact && o.pricing_mode !== "custom" && o.currency !== "USD" ? ` · ${o.currency}` : ""}` : null;
  const placeName = place?.name ?? o.place_text;
  const placeDetail = [o.host_name ? `Hosted by ${o.host_name}` : null, place ? placeLine(place) : null].filter(Boolean).join(" · ");
  const timing = o.timing_note ?? dateRange(o);
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
      {showCommercialFact && <Fact icon={<TagIcon />} title={fact.title} detail={factDetail} />}
      {showCredits && o.credits_eligible && <Fact icon={<CreditIcon />} title="Credits Eligible" detail="Opportunity Credits can be applied" />}
      {(placeName || o.host_name) && <Fact icon={<PinIcon />} title={placeName ?? `Hosted by ${o.host_name}`} detail={placeName ? placeDetail || null : null} />}
      {timing && <Fact icon={<ClockIcon />} title={timing} detail={o.timing_note && dateRange(o) ? dateRange(o) : null} />}
      {o.response_deadline && <Fact icon={<DeadlineIcon />} title={`Respond by ${formatOpportunityDate(o.response_deadline)}`} />}
    </div>
  );
}

/** Image (only when one exists — never a stand-in), type badge, title,
 * summary and facts. `badges` and `actions` are caller slots (Admin passes
 * the status badge and lifecycle/Edit actions). */
export function OpportunityHero({
  o,
  place,
  badges,
  actions,
  showCredits = true,
  commercialOptions,
  showCommercialFact = true,
}: {
  o: PresentableOpportunity;
  place: PresentablePlace | null;
  badges?: ReactNode;
  actions?: ReactNode;
  showCredits?: boolean;
  /** See the module-level comment on this prop's semantics. */
  commercialOptions?: AdminOpportunityOption[];
  /** Business detail pages pass false (see OpportunityFacts). */
  showCommercialFact?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
      <div className={o.image_url ? "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : ""}>
        {o.image_url && (
          // Admin-uploaded Storage URL of arbitrary host — same reasoning as
          // ImageField's preview for not using next/image here.
          <div className="relative md:min-h-[16rem]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageVariantUrl(o.image_url, "large")} alt="" className="h-44 w-full object-cover sm:h-56 md:absolute md:inset-0 md:h-full" />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
                {OPPORTUNITY_TYPE_LABELS[o.opportunity_type]}
              </span>
              {badges}
            </div>
            <h1 className="mt-2 break-words font-display text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-[1.75rem]">{o.title}</h1>
            {o.summary && <p className="mt-1.5 break-words text-[15px] leading-relaxed text-ink/65">{o.summary}</p>}
          </div>
          <OpportunityFacts o={o} place={place} showCredits={showCredits} commercialOptions={commercialOptions} showCommercialFact={showCommercialFact} />
          {actions}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- sections

export function OpportunitySection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Prose({ text }: { text: string }) {
  return <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink/75">{text}</p>;
}

/** Long-form content: About, What Findmi Provides (whats_included), What
 * Your Brand Provides (requirements). Empty sections are omitted. Text is
 * shown as written (multiline respected, never re-parsed into bullets).
 * Business pages pass includeDealProse={false}: those two texts are then
 * rendered inside The Deal (You Provide / Included) instead — never lost. */
export function OpportunityMainSections({ o, includeDealProse = true }: { o: PresentableOpportunity; includeDealProse?: boolean }) {
  return (
    <>
      {o.description && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.description}>
          <Prose text={o.description} />
        </OpportunitySection>
      )}
      {includeDealProse && o.whats_included && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.whats_included}>
          <Prose text={o.whats_included} />
        </OpportunitySection>
      )}
      {includeDealProse && o.requirements && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.requirements}>
          <Prose text={o.requirements} />
        </OpportunitySection>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-black/5 py-2 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-xs text-ink/50">{label}</dt>
      <dd className="break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- Business: The Deal

const subheading = "text-xs font-semibold uppercase tracking-wide text-ink/50";

function DealHeadlineBlock({ headline }: { headline: DealHeadline }) {
  return (
    <div>
      <p className="break-words text-xl font-semibold tracking-tight text-ink">{headline.text}</p>
      {headline.detail && <p className="mt-0.5 text-xs text-ink/55">{headline.detail}</p>}
      {headline.note && <p className="mt-1 whitespace-pre-line break-words text-sm text-ink/70">{headline.note}</p>}
    </div>
  );
}

function DealItems({ items }: { items: DealItem[] }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-words font-medium text-ink">{item.title}</span>
            {item.optional && <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/45">Optional</span>}
          </div>
          {item.detail && <p className="break-words text-xs text-ink/55">{item.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

/** "You Provide" / "Included": structured items first, then the listing's
 * own prose (requirements / whats_included) as supplemental content —
 * under "More Details" when items exist, as the body when they don't.
 * Renders nothing only when there is neither. */
function DealSide({ title, items, note }: { title: string; items: DealItem[]; note: string | null }) {
  if (items.length === 0 && !note) return null;
  return (
    <div>
      <p className={subheading}>{title}</p>
      {items.length > 0 && <DealItems items={items} />}
      {note && (
        <div className={items.length > 0 ? "mt-2.5" : "mt-1.5"}>
          {items.length > 0 && <p className="text-[11px] font-semibold text-ink/45">More Details</p>}
          <Prose text={note} />
        </div>
      )}
    </div>
  );
}

function DealPackageBody({ pkg, provideNote, includedNote }: { pkg: DealPackage; provideNote: string | null; includedNote: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <DealHeadlineBlock headline={pkg.headline} />
      {pkg.description && <p className="-mt-2 break-words text-sm text-ink/65">{pkg.description}</p>}
      <DealSide title="You Provide" items={pkg.youProvide} note={provideNote} />
      <DealSide title="Included" items={pkg.included} note={includedNote} />
    </div>
  );
}

/** Business-facing "The Deal" — directly after the introduction and before
 * any response control. One package: its terms directly (no package
 * chrome). Several: "Packages" as comparable cards (no selection here —
 * see opportunity-package-policy.ts). A listing that predates packages:
 * its legacy price, plus its prose. */
export function OpportunityDeal({ o, options }: { o: PresentableOpportunity; options: AdminOpportunityOption[] }) {
  const deal = buildBusinessDeal(o, options.map(asOptionFields), DEAL_FORMATTERS);
  return (
    <section aria-labelledby="the-deal-heading" className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5">
      <h2 id="the-deal-heading" className="text-base font-semibold text-ink">
        The Deal
      </h2>
      <div className="mt-3">
        {deal.kind === "single" && <DealPackageBody pkg={deal.package} provideNote={deal.provideNote} includedNote={deal.includedNote} />}
        {deal.kind === "legacy" && (
          <div className="flex flex-col gap-4">
            <DealHeadlineBlock headline={deal.headline} />
            <DealSide title="You Provide" items={[]} note={deal.provideNote} />
            <DealSide title="Included" items={[]} note={deal.includedNote} />
          </div>
        )}
        {deal.kind === "packages" && (
          <div className="flex flex-col gap-4">
            <p className={subheading}>Packages</p>
            <div className="-mt-2 grid gap-3 sm:grid-cols-2">
              {deal.packages.map((pkg, i) => (
                <div key={i} className="min-w-0 rounded-xl border border-black/10 bg-black/[0.02] p-3.5">
                  {/* A heading derived from the package's own terms would repeat its headline — the headline is the title then. */}
                  {!pkg.headingFromTerms && <h3 className="mb-2 break-words text-sm font-semibold text-ink">{pkg.heading}</h3>}
                  <DealPackageBody pkg={pkg} provideNote={null} includedNote={null} />
                </div>
              ))}
            </div>
            <DealSide title="You Provide" items={[]} note={deal.provideNote} />
            <DealSide title="Included" items={[]} note={deal.includedNote} />
          </div>
        )}
      </div>
    </section>
  );
}

/** The Business's response area, placed after The Deal. */
export function OpportunityResponseSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="opportunity-response-heading" className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5">
      <h2 id="opportunity-response-heading" className="text-base font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Structured facts: Location & Host, Timing, Investment, Related Event. */
export function OpportunityAsideSections({
  o,
  place,
  locationHref,
  event,
  eventHref,
  showCredits = true,
  showInvestment = true,
}: {
  o: PresentableOpportunity;
  place: PresentablePlace | null;
  locationHref?: string | null;
  event: PresentableEvent | null;
  eventHref?: string | null;
  showCredits?: boolean;
  /** Admin keeps its legacy "Investment" block (default). Business pages
   * pass false — their commercial content is The Deal (OpportunityDeal). */
  showInvestment?: boolean;
}) {
  const price = opportunityPriceParts(o);
  const range = dateRange(o);
  return (
    <>
      {(place || o.place_text || o.host_name) && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.location}>
          {place && (
            <div>
              <p className="text-sm font-semibold text-ink">{place.name}</p>
              {placeLine(place) && <p className="text-sm text-ink/60">{placeLine(place)}</p>}
              {locationHref && (
                <Link href={locationHref} className="mt-1 inline-block text-xs font-semibold text-findmi-700 hover:underline">
                  View Location
                </Link>
              )}
            </div>
          )}
          <dl className={place ? "mt-3" : ""}>
            {o.place_text && <Row label="Place">{o.place_text}</Row>}
            {o.host_name && <Row label="Hosted By">{o.host_name}</Row>}
          </dl>
        </OpportunitySection>
      )}

      {(range || o.timing_note || o.response_deadline) && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.timing}>
          <dl>
            {o.starts_at && <Row label="Starts">{formatOpportunityDateTime(o.starts_at)}</Row>}
            {o.ends_at && <Row label="Ends">{formatOpportunityDateTime(o.ends_at)}</Row>}
            {o.timing_note && <Row label="When">{o.timing_note}</Row>}
            {o.response_deadline && <Row label="Respond By">{formatOpportunityDateTime(o.response_deadline)}</Row>}
          </dl>
        </OpportunitySection>
      )}

      {showInvestment && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.investment}>
          <p className="text-xl font-semibold tracking-tight text-ink">
            {price.amount}
            {o.price_cents != null && <span className="ml-1 text-xs font-semibold text-ink/45">{o.currency}</span>}
          </p>
          {price.qualifier && <p className="text-xs text-ink/55">{price.qualifier}</p>}
          {showCredits && o.credits_eligible && (
            <span className="mt-2 inline-block rounded-full border border-findmi/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
              Credits Eligible
            </span>
          )}
        </OpportunitySection>
      )}

      {event && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.event}>
          {eventHref ? (
            <Link href={eventHref} className="text-sm font-semibold text-ink hover:underline">
              {event.name}
            </Link>
          ) : (
            <p className="text-sm font-semibold text-ink">{event.name}</p>
          )}
          {event.start_at && <p className="text-xs text-ink/55">{formatOpportunityDate(event.start_at)}</p>}
        </OpportunitySection>
      )}
    </>
  );
}
