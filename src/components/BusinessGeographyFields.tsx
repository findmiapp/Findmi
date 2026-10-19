const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface BusinessGeographyFieldsProps {
  defaultCity: string;
  defaultState: string;
}

/**
 * Business Creation UX Cleanup pass — a submitter provides FACTUAL
 * geography only: City, State. No Findmi Market/Area UI of any kind
 * (internal editorial organization — createMemberBusiness already best-
 * effort auto-assigns a Market from canonical City/State geography after
 * creation when one resolves, with no market_id/requested_market_text
 * submitted here; Admin's own Market/Area tools remain the way to adjust
 * it afterward). Same reasoning this pass already applied to
 * LocationGeographyFields.tsx: the live suggestion banner and manual
 * "Choose an area" override were a second, confusing geography decision
 * on a basic creation form, not something a visitor should have to
 * weigh. A plain Server Component now — no client state is needed once
 * the live matching UI is gone.
 *
 * City/State remain required (createMemberBusiness still enforces this
 * server-side) — still plain text fields, no geocoding, no country field
 * added.
 */
export default function BusinessGeographyFields({ defaultCity, defaultState }: BusinessGeographyFieldsProps) {
  return (
    <div>
      {/* Business Account Correction Pass (#18) — "Business location"
          read as the same concept as Findmi Here -> Locations (a real
          Findmi Location relationship), which this isn't: it's just the
          city/state this business is based in. Copy-only fix. */}
      <span className="mb-1.5 block text-sm font-medium text-ink">Where is your business based?</span>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink/60">City</span>
          <input autoCapitalize="words"
            type="text"
            name="city"
            required
            defaultValue={defaultCity}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink/60">State</span>
          <input autoCapitalize="words"
            type="text"
            name="state"
            required
            defaultValue={defaultState}
            className={inputClass}
          />
        </label>
      </div>
      <p className="mt-1.5 text-xs text-ink/45">
        Enter where your business is based. Findmi will determine the best area for discovery.
      </p>
    </div>
  );
}
