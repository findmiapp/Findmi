"use client";

import { useState } from "react";
import { DateTimeField, DateTimeRangeField, SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import { RelationField, type SearchResult } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABELS, type PricingMode } from "@/lib/opportunity-listings-domain";

/** The listing fields exactly as the form needs them (client-safe). */
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

const PRICING_OPTIONS: { value: PricingMode; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "starting_at", label: "Starting At" },
  { value: "complimentary", label: "Complimentary" },
  { value: "custom", label: "Custom" },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/10 bg-white/60 p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-ink/50">{hint}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function centsToInput(cents: number | null): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Opportunities V1 Pass 2 — create/edit form (sections A–G). Pricing is
 * the only interactive part: the Amount only shows for Fixed / Starting
 * At, and Credits Eligible is forced off (and disabled) for Complimentary.
 * The server re-validates everything (validateListingInput). */
export default function OpportunityForm({
  listing,
  initialLocation,
  initialEvent,
  action,
  saveLabel,
  cancelHref,
}: {
  listing: OpportunityFormValues | null;
  initialLocation: SearchResult | null;
  initialEvent: SearchResult | null;
  action: (formData: FormData) => void | Promise<void>;
  saveLabel: string;
  cancelHref: string;
}) {
  const [pricingMode, setPricingMode] = useState<PricingMode>(listing?.pricing_mode ?? "fixed");
  const [credits, setCredits] = useState<boolean>(listing?.credits_eligible ?? false);
  const needsAmount = pricingMode === "fixed" || pricingMode === "starting_at";
  const complimentary = pricingMode === "complimentary";

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

      <Section title="Investment">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Pricing Mode</span>
          <select
            name="pricing_mode"
            value={pricingMode}
            onChange={(e) => {
              const next = e.target.value as PricingMode;
              setPricingMode(next);
              if (next === "complimentary") setCredits(false);
            }}
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none"
          >
            {PRICING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {needsAmount && (
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <TextField
              label={pricingMode === "starting_at" ? "Starting Amount" : "Amount"}
              name="price"
              defaultValue={centsToInput(listing?.price_cents ?? null)}
              placeholder="750"
              required
              hint="In dollars, e.g. 750 or 1,500.00."
            />
            <TextField label="Currency" name="currency" defaultValue={listing?.currency ?? "USD"} />
          </div>
        )}
        {!needsAmount && <input type="hidden" name="currency" value={listing?.currency ?? "USD"} />}
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

      <Section title="Internal" hint="Admin only — never shown to Businesses.">
        <TextareaField label="Internal Notes" name="internal_notes" defaultValue={listing?.internal_notes} rows={3} />
      </Section>

      <SubmitBar cancelHref={cancelHref} saveLabel={saveLabel} />
    </form>
  );
}
