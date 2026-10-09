"use client";

import { useState } from "react";
import { DateTimeField, DateTimeRangeField, SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import { RelationField, type SearchResult } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABELS, type PricingMode } from "@/lib/opportunity-listings-domain";
import CommercialTermsBuilder, { type InitialOption } from "./CommercialTermsBuilder";

/** The listing fields exactly as the form needs them (client-safe).
 * pricing_mode/price_cents/currency are still read (for a legacy-
 * unclassified listing's own read-only notice — see `legacyUnclassified`
 * below — and because the server projects a SAFE compatibility value from
 * Commercial Terms once Options exist; see
 * src/lib/opportunity-commercial-terms-bridge.ts) but are never directly
 * editable here; only credits_eligible keeps its own control. */
export interface OpportunityFormValues {
  opportunity_type: string;
  title: string;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  place_text: string | null;
  host_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timing_note: string | null;
  response_deadline: string | null;
  pricing_mode: PricingMode;
  price_cents: number | null;
  currency: string;
  credits_eligible: boolean;
  whats_included: string | null;
  requirements: string | null;
  internal_notes: string | null;
}

function Section({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-black/10 bg-white/60 p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-ink/50">{hint}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Opportunities V1 Pass 2 — create/edit form (sections A–G). Commercial
 * Terms Admin Builder (Pass 2) — Section F ("Investment") is now the
 * CommercialTermsBuilder, shown only when this Opportunity already has
 * Commercial Terms (`legacyUnclassified === false` — always true for a new
 * Opportunity). A legacy-unclassified listing (zero Option rows) shows a
 * read-only notice instead: editing its OTHER fields must never require
 * filling in Commercial Terms, and must never write an Option row as a
 * side effect — only the detail page's explicit "Add Commercial Terms"
 * action does that (Pass 2 review correction). Credits Eligible is its own
 * independent control (forced off/disabled when the FIRST Option is
 * Complimentary — or, for a legacy-unclassified listing, when its existing
 * legacy pricing_mode already is — since credits_eligible has no meaning
 * without SOME amount to apply credits to, the same rule the old Pricing
 * Mode dropdown enforced). The server re-validates everything
 * (validateListingInput + validateOption/validateComponent, unchanged from
 * Pass 1). */
export default function OpportunityForm({
  listing,
  initialOptions,
  legacyUnclassified,
  initialLocation,
  initialEvent,
  action,
  saveLabel,
  cancelHref,
}: {
  listing: OpportunityFormValues | null;
  initialOptions: InitialOption[];
  /** True only for an existing Opportunity with zero Option rows that has
   * never been converted to the new Commercial Terms model. Always false
   * for a new Opportunity (the builder always applies) and false once any
   * Option exists. */
  legacyUnclassified: boolean;
  initialLocation: SearchResult | null;
  initialEvent: SearchResult | null;
  action: (formData: FormData) => void | Promise<void>;
  saveLabel: string;
  cancelHref: string;
}) {
  const [credits, setCredits] = useState<boolean>(listing?.credits_eligible ?? false);
  const firstOptionComplimentary = legacyUnclassified
    ? listing?.pricing_mode === "complimentary"
    : (initialOptions[0]?.commercial_mode ?? "structured") === "complimentary";
  const [complimentary, setComplimentary] = useState<boolean>(firstOptionComplimentary);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Section title="Basics">
        <SelectField
          label="Type"
          name="opportunity_type"
          defaultValue={listing?.opportunity_type ?? "activation"}
          options={OPPORTUNITY_TYPES.map((t) => ({ value: t, label: OPPORTUNITY_TYPE_LABELS[t] }))}
        />
        <TextField label="Title" name="title" defaultValue={listing?.title} placeholder="e.g. Tabli Resident Demo — Jersey City" required />
        <TextareaField label="Summary" name="summary" defaultValue={listing?.summary} rows={2} hint="One or two sentences. Up to 280 characters." />
        <TextareaField label="Description" name="description" defaultValue={listing?.description} rows={5} />
        <ImageField label="Image (optional)" name="image_url" defaultValue={listing?.image_url} />
      </Section>

      <Section title="Place & Host">
        <RelationField
          label="Location"
          name="location_id"
          entity="locations"
          initial={initialLocation}
          clearLabel="No Findmi Location"
          placeholder="Search Findmi places…"
        />
        <TextField label="Place" name="place_text" defaultValue={listing?.place_text} placeholder="e.g. Jersey City, NJ" hint="Shown when there's no Location, or to add detail." />
        <TextField label="Host Name" name="host_name" defaultValue={listing?.host_name} placeholder="e.g. 3 Acres" />
      </Section>

      <Section title="Timing">
        <DateTimeRangeField
          startLabel="Starts At"
          endLabel="Ends At"
          startName="starts_at"
          endName="ends_at"
          defaultStart={isoToLocalDateTime(listing?.starts_at ?? null) || null}
          defaultEnd={isoToLocalDateTime(listing?.ends_at ?? null) || null}
        />
        <TextField label="Timing Note" name="timing_note" defaultValue={listing?.timing_note} placeholder="e.g. Two Saturdays in November, dates flexible" />
        <DateTimeField
          label="Response Deadline"
          name="response_deadline"
          defaultValue={isoToLocalDateTime(listing?.response_deadline ?? null)}
          hint="Optional. Times are Eastern."
        />
      </Section>

      <Section id="commercial-terms" title="Commercial Terms" hint="Structured amounts and/or In-Kind terms, or Complimentary, or a Custom negotiated arrangement.">
        {legacyUnclassified ? (
          <div className="rounded-xl border border-dashed border-black/15 bg-white/60 px-3.5 py-3 text-sm text-ink/60">
            This Opportunity still uses its original pricing and hasn&rsquo;t been set up with structured Commercial Terms yet. Add Commercial Terms from the
            Opportunity&rsquo;s detail page — this form never changes the original pricing on its own.
          </div>
        ) : (
          <CommercialTermsBuilder initialOptions={initialOptions} onFirstOptionModeChange={setComplimentary} />
        )}
        <label className={`flex items-start gap-3 rounded-xl border border-black/10 bg-white px-3.5 py-3 ${complimentary ? "opacity-60" : ""}`}>
          <input
            type="checkbox"
            name="credits_eligible"
            checked={credits && !complimentary}
            disabled={complimentary}
            onChange={(e) => setCredits(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-findmi"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Credits Eligible</span>
            <span className="block text-xs text-ink/45">
              {complimentary
                ? "Not available for a Complimentary Opportunity — there's nothing to apply credits to."
                : "Opportunity Credits can be applied to this Opportunity."}
            </span>
          </span>
        </label>
      </Section>

      <Section title="Details">
        <TextareaField label="What's Included" name="whats_included" defaultValue={listing?.whats_included} rows={4} />
        <TextareaField label="Requirements" name="requirements" defaultValue={listing?.requirements} rows={4} />
      </Section>

      <Section title="Relationships">
        <RelationField
          label="Event"
          name="event_id"
          entity="events"
          initial={initialEvent}
          clearLabel="No related Event"
          placeholder="Search Events…"
          hint="Optional. Context only — this doesn't add anyone to the Event."
        />
      </Section>

      <Section id="internal" title="Internal" hint="Admin only — never shown to Businesses.">
        <TextareaField label="Internal Notes" name="internal_notes" defaultValue={listing?.internal_notes} rows={3} />
      </Section>

      <SubmitBar cancelHref={cancelHref} saveLabel={saveLabel} />
    </form>
  );
}
