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
import { summarizeOptionsForCard, type OptionFields } from "@/lib/opportunity-commercial-terms-domain";
import {
  buildBusinessCommercialTerms,
  buildBusinessPrimaryTerm,
  summarizeOptionForCard,
  type BusinessContributionGroup,
  type BusinessPrimaryTerm,
} from "@/lib/opportunity-business-commercial-terms";

// Pass 3 — every function below that takes `commercialOptions`/`options`
// follows one rule: the prop being OMITTED (undefined) means "render the
// legacy Investment block exactly as before" (Admin's call sites never
// pass it); the prop being PRESENT, even as an empty array for a legacy-
// unclassified listing, switches to the new Business-facing "Commercial
// Terms" experience. This is the one presentation-boundary switch — never
// a second copy of Admin's own rendering.
const asOptionFields = (o: AdminOpportunityOption): OptionFields => o as unknown as OptionFields;

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

/** The Hero quick-facts row's price-like tag, direction-aware once
 * Options exist — never the raw legacy projection for a Compensation/
 * Project Budget/multi-direction Option, which projectSafeLegacyPricing
 * never populates a comparable amount for anyway. `commercialOptions`
 * undefined/omitted (Admin) or empty (legacy-unclassified) both fall back
 * to the exact legacy price/qualifier. */
export function commercialCardLine(commercialOptions: AdminOpportunityOption[] | undefined, legacy: { amount: string; qualifier: string | null }): { title: string; detail: string | null } {
  if (!commercialOptions || commercialOptions.length === 0) return { title: legacy.amount, detail: legacy.qualifier };
  if (commercialOptions.length === 1) {
    const primary = buildBusinessPrimaryTerm(asOptionFields(commercialOptions[0]));
    if (!primary) return { title: "Commercial Terms", detail: null };
    if (primary.kind === "complimentary") return { title: "Complimentary", detail: primary.helper };
    if (primary.kind === "custom") return { title: "Custom Terms", detail: null };
    return { title: primary.amount, detail: primary.label };
  }
  return { title: summarizeOptionsForCard(commercialOptions.map(asOptionFields)), detail: null };
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
}: {
  o: PresentableOpportunity;
  place: PresentablePlace | null;
  showCredits?: boolean;
  /** Pass 3 — see the module-level comment on this prop's semantics. */
  commercialOptions?: AdminOpportunityOption[];
}) {
  const price = opportunityPriceParts(o);
  const fact = commercialCardLine(commercialOptions, price);
  const isLegacyFact = !commercialOptions || commercialOptions.length === 0;
  const factDetail = fact.detail ? `${fact.detail}${isLegacyFact && o.pricing_mode !== "custom" && o.currency !== "USD" ? ` · ${o.currency}` : ""}` : null;
  const placeName = place?.name ?? o.place_text;
  const placeDetail = [o.host_name ? `Hosted by ${o.host_name}` : null, place ? placeLine(place) : null].filter(Boolean).join(" · ");
  const timing = o.timing_note ?? dateRange(o);
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
      <Fact icon={<TagIcon />} title={fact.title} detail={factDetail} />
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
}: {
  o: PresentableOpportunity;
  place: PresentablePlace | null;
  badges?: ReactNode;
  actions?: ReactNode;
  showCredits?: boolean;
  /** Pass 3 — see the module-level comment on this prop's semantics. */
  commercialOptions?: AdminOpportunityOption[];
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
          <OpportunityFacts o={o} place={place} showCredits={showCredits} commercialOptions={commercialOptions} />
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
 * shown as written (multiline respected, never re-parsed into bullets). */
export function OpportunityMainSections({ o }: { o: PresentableOpportunity }) {
  return (
    <>
      {o.description && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.description}>
          <Prose text={o.description} />
        </OpportunitySection>
      )}
      {o.whats_included && (
        <OpportunitySection title={OPPORTUNITY_SECTION_LABELS.whats_included}>
          <Prose text={o.whats_included} />
        </OpportunitySection>
      )}
      {o.requirements && (
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

// ---------------------------------------------------------------- Pass 3: Business Commercial Terms

/** One Option's safe headline for a multi-Option <summary> — never an
 * arbitrary-first-component guess, the same classification the card
 * summary uses. */
function optionHeadline(option: AdminOpportunityOption): string {
  const summary = summarizeOptionForCard(asOptionFields(option));
  if (summary.kind === "monetary") return `${summary.label} · ${summary.amount}`;
  if (summary.kind === "complimentary") return "Complimentary";
  if (summary.kind === "custom") return "Custom Terms";
  return "Commercial Terms";
}

function PrimaryTermBlock({ primary }: { primary: BusinessPrimaryTerm | null }) {
  if (!primary) return null;
  if (primary.kind === "complimentary") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Participation Cost</p>
        <p className="text-xl font-semibold tracking-tight text-ink">Complimentary</p>
        <p className="text-xs text-ink/55">{primary.helper}</p>
      </div>
    );
  }
  if (primary.kind === "custom") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Commercial Terms</p>
        <p className="text-xl font-semibold tracking-tight text-ink">Custom</p>
        {primary.note && <p className="mt-1 whitespace-pre-line break-words text-sm text-ink/70">{primary.note}</p>}
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{primary.label}</p>
      <p className="text-xl font-semibold tracking-tight text-ink">{primary.amount}</p>
      <p className="text-xs text-ink/55">{primary.helper}</p>
      {primary.quantityUnit && (
        <p className="mt-0.5 text-xs text-ink/55">
          {primary.quantityUnit}
          {primary.perUnitEquivalent ? ` · ${primary.perUnitEquivalent}` : ""}
        </p>
      )}
    </div>
  );
}

function ContributionGroupBlock({ group }: { group: BusinessContributionGroup }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{group.heading}</p>
      <ul className="mt-1.5 flex flex-col gap-2">
        {group.items.map((item, i) => (
          <li key={i} className="text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="break-words font-medium text-ink">{item.title}</span>
              {!item.required && (
                <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/45">Optional</span>
              )}
            </div>
            {item.description && <p className="break-words text-xs text-ink/55">{item.description}</p>}
            {item.estimatedValue && <p className="text-xs text-ink/55">{item.estimatedValue}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One Option's full hierarchy: primary monetary term (if any) -> provider-
 * grouped contributions, in render order (Your Contribution -> Provided by
 * Findmi -> Provided by Organizer -> Provided by Another Party). Never
 * renders an empty group; a Structured Option with no monetary component
 * and no In-Kind groups (shouldn't normally occur) falls back to one
 * neutral line rather than an empty section. */
function StructuredOptionBody({ option }: { option: AdminOpportunityOption }) {
  const terms = buildBusinessCommercialTerms(asOptionFields(option));
  if (!terms.primary && terms.groups.length === 0) {
    return <p className="text-sm text-ink/55">Commercial terms for this Opportunity haven&rsquo;t been set yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <PrimaryTermBlock primary={terms.primary} />
      {terms.groups.map((g) => (
        <ContributionGroupBlock key={g.heading} group={g} />
      ))}
    </div>
  );
}

/** The Business-facing "Commercial Terms" section — the opt-in replacement
 * for the legacy "Investment" block below. Zero Options (legacy-
 * unclassified): the exact legacy amount/qualifier, new heading only. One
 * Option: its hierarchy directly — no "Option 1" chrome. >1 Option: native
 * <details>/<summary> per Option, first one `open` as static markup (never
 * React state) so a user may still close it; no comparison matrix, no
 * custom accordion. */
function OpportunityCommercialTerms({
  options,
  legacyAmount,
  legacyQualifier,
  currency,
  priceCents,
  showCredits,
  creditsEligible,
}: {
  options: AdminOpportunityOption[];
  legacyAmount: string;
  legacyQualifier: string | null;
  currency: string;
  priceCents: number | null;
  showCredits: boolean;
  creditsEligible: boolean;
}) {
  return (
    <OpportunitySection title="Commercial Terms">
      {options.length === 0 && (
        <>
          <p className="text-xl font-semibold tracking-tight text-ink">
            {legacyAmount}
            {priceCents != null && <span className="ml-1 text-xs font-semibold text-ink/45">{currency}</span>}
          </p>
          {legacyQualifier && <p className="text-xs text-ink/55">{legacyQualifier}</p>}
        </>
      )}
      {options.length === 1 && <StructuredOptionBody option={options[0]} />}
      {options.length > 1 && (
        <div className="flex flex-col gap-2">
          {options.map((o, i) => (
            <details key={o.id} open={i === 0} className="rounded-xl border border-black/10 bg-black/[0.02] p-3 open:bg-white">
              <summary className="cursor-pointer break-words text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {(o.name || `Option ${i + 1}`) + " · " + optionHeadline(o)}
              </summary>
              <div className="mt-3">
                <StructuredOptionBody option={o} />
              </div>
            </details>
          ))}
        </div>
      )}
      {showCredits && creditsEligible && (
        <span className="mt-2 inline-block rounded-full border border-findmi/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
          Credits Eligible
        </span>
      )}
    </OpportunitySection>
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
  commercialOptions,
}: {
  o: PresentableOpportunity;
  place: PresentablePlace | null;
  locationHref?: string | null;
  event: PresentableEvent | null;
  eventHref?: string | null;
  showCredits?: boolean;
  /** Pass 3 — see the module-level comment on this prop's semantics.
   * Omitted (undefined): Admin's existing legacy "Investment" block,
   * completely unchanged. Provided (even `[]` for a legacy-unclassified
   * listing): the new Business-facing "Commercial Terms" experience. */
  commercialOptions?: AdminOpportunityOption[];
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

      {commercialOptions === undefined ? (
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
      ) : (
        <OpportunityCommercialTerms
          options={commercialOptions}
          legacyAmount={price.amount}
          legacyQualifier={price.qualifier}
          currency={o.currency}
          priceCents={o.price_cents}
          showCredits={showCredits}
          creditsEligible={o.credits_eligible}
        />
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
