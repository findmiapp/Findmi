// Opportunities — Business "The Deal" view model (first Business UX pass).
//
// THE DATABASE DESCRIBES THE COMMERCIAL STRUCTURE; THE UI DESCRIBES THE
// DEAL. This module turns stored Options/Components (and, for a listing
// that predates them, the legacy pricing columns) into what a Business
// reads: one headline (the primary commercial term), what YOU PROVIDE,
// and what's INCLUDED. It never emits schema vocabulary (Structured,
// Commercial Terms, In-Kind, component, Option N, provider enums) and
// never changes stored data — presentation only.
//
// Rules are deterministic and documented on each function. The Free to
// Participate / No Participation Fee distinction uses the same
// "required contribution from the recipient Business" rule as the
// classification correction (isRequiredBrandContribution in the domain
// module, the DB triggers): Findmi / host / partner items, optional
// Business items, estimated values and prose never affect it.
//
// Type-only imports, with the canonical domain formatters passed in as
// `fmt` (see DEAL_FORMATTERS in OpportunityPresentation.tsx), so plain
// `node --test` can import this module — same pattern as
// opportunity-commercial-terms-builder.ts.

import type { ComponentFields, InKindCategory, OptionFields } from "./opportunity-commercial-terms-domain";

export interface DealFormatters {
  /** formatQuantityUnit — "200 Samples", or null when no quantity/unit. */
  quantityUnit: (c: Pick<ComponentFields, "quantity" | "unit" | "custom_unit_label">) => string | null;
  /** formatMonetaryPerUnitEquivalent — "Equivalent to $250 / appearance". */
  perUnitEquivalent: (c: Pick<ComponentFields, "amount_mode" | "amount_min_cents" | "currency" | "quantity" | "unit" | "custom_unit_label">) => string | null;
  /** calculateInKindEstimatedValueCents. */
  estimatedValueCents: (c: Pick<ComponentFields, "quantity" | "unit_value_cents" | "estimated_value_cents">) => number | null;
  /** IN_KIND_CATEGORY_LABELS lookup. */
  categoryLabel: (category: InKindCategory) => string;
}

export type DealOption = Pick<OptionFields, "name" | "description" | "commercial_mode" | "custom_terms_note" | "components">;

export interface DealListing {
  pricing_mode: string;
  price_cents: number | null;
  currency: string;
  host_name: string | null;
  whats_included: string | null;
  requirements: string | null;
}

export type DealHeadlineKind =
  | "participation_fee"
  | "compensation"
  | "project_budget"
  | "free"
  | "no_participation_fee"
  | "terms_discussed"
  | "legacy_price";

/** The one primary commercial statement at the top of The Deal. */
export interface DealHeadline {
  kind: DealHeadlineKind;
  /** "$750 Participation Fee", "You Receive $1,500", "Free to Participate"… */
  text: string;
  /** Secondary line under the headline, e.g. "Covers 3 Appearances · Equivalent to $250 / appearance". */
  detail: string | null;
  /** Staff's own note for a Terms Discussed With Findmi package. */
  note: string | null;
}

export interface DealItem {
  title: string;
  /** "1 Staff · Provided by Findmi", "Est. value $400"… */
  detail: string | null;
  optional: boolean;
}

export interface DealPackage {
  /** Stored name, else a derived headline when safe, else "Package N". */
  heading: string;
  /** True when `heading` was derived from this package's own primary term —
   * the card then shows the term itself as its title rather than saying
   * the same thing twice. */
  headingFromTerms: boolean;
  /** Stored package description, when any. */
  description: string | null;
  headline: DealHeadline;
  youProvide: DealItem[];
  included: DealItem[];
}

export type BusinessDeal =
  | {
      kind: "single";
      package: DealPackage;
      /** `requirements` prose — supplemental content inside You Provide. */
      provideNote: string | null;
      /** `whats_included` prose — supplemental content inside Included. */
      includedNote: string | null;
    }
  | { kind: "packages"; packages: DealPackage[]; provideNote: string | null; includedNote: string | null }
  | { kind: "legacy"; headline: DealHeadline; provideNote: string | null; includedNote: string | null };

// ---------------------------------------------------------------- money formatting

export function formatDealMoney(cents: number, currency: string | null): string {
  const amount = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

type AmountShape = { kind: "fixed" | "starting_at"; amount: string } | { kind: "range"; amount: string } | { kind: "undisclosed" };

function amountShape(c: Pick<ComponentFields, "amount_mode" | "amount_min_cents" | "amount_max_cents" | "currency">): AmountShape {
  const currency = c.currency ?? "USD";
  if (c.amount_mode === "range" && c.amount_min_cents != null && c.amount_max_cents != null) {
    return { kind: "range", amount: `${formatDealMoney(c.amount_min_cents, currency)}–${formatDealMoney(c.amount_max_cents, currency)}` };
  }
  if ((c.amount_mode === "fixed" || c.amount_mode === "starting_at") && c.amount_min_cents != null) {
    return { kind: c.amount_mode, amount: formatDealMoney(c.amount_min_cents, currency) };
  }
  return { kind: "undisclosed" };
}

// ---------------------------------------------------------------- headline

const isMonetary = (t: string) => t === "participation_fee" || t === "compensation" || t === "project_budget";

/** Same rule as isRequiredBrandContribution (domain) and the DB triggers:
 * required, In-Kind, provided by the recipient Business — a missing
 * provider counts as the Business. */
export function isRequiredBusinessContribution(c: Pick<ComponentFields, "component_type" | "in_kind_required" | "in_kind_provider">): boolean {
  return c.component_type === "in_kind" && c.in_kind_required && (c.in_kind_provider ?? "recipient_business") === "recipient_business";
}

/** The primary commercial term for one package, first match wins:
 *   1. Terms discussed (custom)          -> "Terms Discussed With Findmi" (+ staff note)
 *   2. participation_fee                 -> "$750 Participation Fee" · "Participation Fee from $750"
 *                                           · "$500–$1,000 Participation Fee" · "Participation Fee: Contact Findmi"
 *   3. compensation                      -> "You Receive $1,500" · "You Receive from $1,500"
 *                                           · "You Receive $1,000–$2,000" · "You Receive: Contact Findmi"
 *   4. project_budget                    -> "Project Budget: $5,000" · "Project Budget: from $5,000"
 *                                           · "Project Budget: $5,000–$10,000" · "Project Budget: Contact Findmi"
 *   5. no money, nothing REQUIRED from the Business -> "Free to Participate"
 *   6. no money, something REQUIRED from the Business -> "No Participation Fee"
 * Inclusions (Findmi / host / partner), optional Business items,
 * estimated values and prose never change 5 vs 6. */
export function buildDealHeadline(option: DealOption, fmt: DealFormatters): DealHeadline {
  if (option.commercial_mode === "custom") {
    return { kind: "terms_discussed", text: "Terms Discussed With Findmi", detail: "Contact Findmi for details.", note: option.custom_terms_note?.trim() || null };
  }
  const money = option.components.find((c) => isMonetary(c.component_type));
  if (money) {
    const shape = amountShape(money);
    const covers = fmt.quantityUnit(money);
    const detail = [covers ? `Covers ${covers}` : null, fmt.perUnitEquivalent(money)].filter(Boolean).join(" · ") || null;
    if (money.component_type === "participation_fee") {
      const text =
        shape.kind === "fixed" ? `${shape.amount} Participation Fee`
        : shape.kind === "starting_at" ? `Participation Fee from ${shape.amount}`
        : shape.kind === "range" ? `${shape.amount} Participation Fee`
        : "Participation Fee: Contact Findmi";
      return { kind: "participation_fee", text, detail, note: null };
    }
    if (money.component_type === "compensation") {
      const text =
        shape.kind === "fixed" ? `You Receive ${shape.amount}`
        : shape.kind === "starting_at" ? `You Receive from ${shape.amount}`
        : shape.kind === "range" ? `You Receive ${shape.amount}`
        : "You Receive: Contact Findmi";
      return { kind: "compensation", text, detail, note: null };
    }
    const text =
      shape.kind === "fixed" ? `Project Budget: ${shape.amount}`
      : shape.kind === "starting_at" ? `Project Budget: from ${shape.amount}`
      : shape.kind === "range" ? `Project Budget: ${shape.amount}`
      : "Project Budget: Contact Findmi";
    return { kind: "project_budget", text, detail, note: null };
  }
  if (option.components.some(isRequiredBusinessContribution)) {
    return { kind: "no_participation_fee", text: "No Participation Fee", detail: null, note: null };
  }
  return { kind: "free", text: "Free to Participate", detail: null, note: null };
}

/** A listing that predates structured packages: its legacy pricing had
 * no direction, so it never claims "Participation Fee" — "$750 to
 * Participate" / "From $750 to Participate" / "Free to Participate" /
 * "Terms Discussed With Findmi". */
export function buildLegacyDealHeadline(listing: Pick<DealListing, "pricing_mode" | "price_cents" | "currency">): DealHeadline {
  if (listing.pricing_mode === "complimentary") return { kind: "free", text: "Free to Participate", detail: null, note: null };
  if ((listing.pricing_mode === "fixed" || listing.pricing_mode === "starting_at") && listing.price_cents != null) {
    const amount = formatDealMoney(listing.price_cents, listing.currency);
    return { kind: "legacy_price", text: listing.pricing_mode === "fixed" ? `${amount} to Participate` : `From ${amount} to Participate`, detail: null, note: null };
  }
  return { kind: "terms_discussed", text: "Terms Discussed With Findmi", detail: "Contact Findmi for details.", note: null };
}

// ---------------------------------------------------------------- items

/** "Provided by Findmi" / "Provided by {host_name}" (else "Provided by the
 * Host") / "Provided by a Partner". Never a raw provider value. */
export function attributionFor(provider: string | null, hostName: string | null): string {
  if (provider === "findmi") return "Provided by Findmi";
  if (provider === "organizer") return hostName?.trim() ? `Provided by ${hostName.trim()}` : "Provided by the Host";
  return "Provided by a Partner";
}

/** Title = the staff description; else the quantity + unit; else the
 * category label. The quantity moves to the detail line whenever the
 * description took the title — never merged ("24 Tost" would garble a
 * custom "Bottles" unit). Detail: quantity · estimated value · attribution. */
function buildItem(c: ComponentFields, fmt: DealFormatters, attribution: string | null): DealItem {
  const qty = fmt.quantityUnit(c);
  const description = c.in_kind_description?.trim() || null;
  const title = description ?? qty ?? (c.in_kind_category ? fmt.categoryLabel(c.in_kind_category) : "Contribution");
  const valueCents = fmt.estimatedValueCents(c);
  const detail = [description && qty ? qty : null, valueCents != null ? `Est. value ${formatDealMoney(valueCents, "USD")}` : null, attribution].filter(Boolean).join(" · ") || null;
  return { title, detail, optional: !c.in_kind_required };
}

const requiredFirst = (items: { item: DealItem; order: number }[]) =>
  items.sort((a, b) => Number(a.item.optional) - Number(b.item.optional) || a.order - b.order).map((x) => x.item);

/** You Provide = In-Kind from the recipient Business (or a missing
 * provider); Included = everything from Findmi / the host / a partner, in
 * ONE section with attribution as secondary metadata. Required before
 * optional; otherwise stored order. */
export function splitDealItems(option: DealOption, hostName: string | null, fmt: DealFormatters): { youProvide: DealItem[]; included: DealItem[] } {
  const provide: { item: DealItem; order: number }[] = [];
  const included: { item: DealItem; order: number }[] = [];
  option.components.forEach((c, order) => {
    if (c.component_type !== "in_kind") return;
    const fromBusiness = (c.in_kind_provider ?? "recipient_business") === "recipient_business";
    if (fromBusiness) provide.push({ item: buildItem(c, fmt, null), order });
    else included.push({ item: buildItem(c, fmt, attributionFor(c.in_kind_provider, hostName)), order });
  });
  return { youProvide: requiredFirst(provide), included: requiredFirst(included) };
}

// ---------------------------------------------------------------- packages

/** A short, useful heading for an UNNAMED package, derived from its
 * primary term ("$750 Participation", "From $1,500 Participation",
 * "Free to Participate"…), or null when nothing safe can be said. */
export function derivedPackageHeading(headline: DealHeadline): string | null {
  if (headline.kind === "participation_fee") {
    const m = headline.text.match(/^(.*) Participation Fee$/);
    if (m) return `${m[1]} Participation`;
    const from = headline.text.match(/^Participation Fee from (.*)$/);
    if (from) return `From ${from[1]} Participation`;
    return null; // undisclosed — nothing distinguishing to say
  }
  if (headline.kind === "compensation" || headline.kind === "project_budget") {
    return /Contact Findmi/.test(headline.text) ? null : headline.text;
  }
  return headline.text; // Free to Participate / No Participation Fee / Terms Discussed With Findmi
}

/** Stored name always wins. Otherwise a derived heading — but only when it
 * is unique among this listing's packages (two "$750 Participation" cards
 * would be ambiguous); otherwise "Package N" as the final fallback. */
export function packageHeadings(packages: { name: string | null; headline: DealHeadline }[]): string[] {
  const derived = packages.map((p) => (p.name?.trim() ? null : derivedPackageHeading(p.headline)));
  const counts = new Map<string, number>();
  for (const d of derived) if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  return packages.map((p, i) => {
    if (p.name?.trim()) return p.name.trim();
    const d = derived[i];
    return d && counts.get(d) === 1 ? d : `Package ${i + 1}`;
  });
}

// ---------------------------------------------------------------- the whole deal

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function buildBusinessDeal(listing: DealListing, options: readonly DealOption[], fmt: DealFormatters): BusinessDeal {
  const provideNote = blank(listing.requirements);
  const includedNote = blank(listing.whats_included);
  if (options.length === 0) {
    return { kind: "legacy", headline: buildLegacyDealHeadline(listing), provideNote, includedNote };
  }
  const built = options.map((o) => {
    const headline = buildDealHeadline(o, fmt);
    const { youProvide, included } = splitDealItems(o, listing.host_name, fmt);
    return { name: o.name, description: blank(o.description), headline, youProvide, included };
  });
  if (built.length === 1) {
    const b = built[0];
    return { kind: "single", package: { heading: "", headingFromTerms: false, description: b.description, headline: b.headline, youProvide: b.youProvide, included: b.included }, provideNote, includedNote };
  }
  const headings = packageHeadings(built);
  return {
    kind: "packages",
    packages: built.map((b, i) => ({
      heading: headings[i],
      headingFromTerms: !b.name?.trim() && headings[i] !== `Package ${i + 1}`,
      description: b.description,
      headline: b.headline,
      youProvide: b.youProvide,
      included: b.included,
    })),
    provideNote,
    includedNote,
  };
}

/** One line for Business cards and the Explore list:
 *   0 packages -> the legacy headline; 1 -> its headline;
 *   N, all Participation Fee Fixed/Starting At in one currency -> "Packages from $X";
 *   N, all Free to Participate -> "Free to Participate";
 *   otherwise "N Packages" (never a number that could mean two things). */
export function businessDealSummary(listing: Pick<DealListing, "pricing_mode" | "price_cents" | "currency">, options: readonly DealOption[], fmt: DealFormatters): string {
  if (options.length === 0) return buildLegacyDealHeadline(listing).text;
  const headlines = options.map((o) => buildDealHeadline(o, fmt));
  if (options.length === 1) return headlines[0].text;
  if (headlines.every((h) => h.kind === "free")) return "Free to Participate";
  const floors: { cents: number; currency: string }[] = [];
  for (const o of options) {
    if (o.commercial_mode === "custom") return `${options.length} Packages`;
    const fee = o.components.find((c) => isMonetary(c.component_type));
    if (!fee || fee.component_type !== "participation_fee" || (fee.amount_mode !== "fixed" && fee.amount_mode !== "starting_at") || fee.amount_min_cents == null) {
      return `${options.length} Packages`;
    }
    floors.push({ cents: fee.amount_min_cents, currency: fee.currency ?? "USD" });
  }
  if (!floors.every((f) => f.currency === floors[0].currency)) return `${options.length} Packages`;
  const lowest = floors.reduce((min, f) => (f.cents < min.cents ? f : min));
  return `Packages from ${formatDealMoney(lowest.cents, lowest.currency)}`;
}
