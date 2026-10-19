const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface LocationGeographyFieldsProps {
  defaultCity: string;
  defaultState: string;
  defaultPostalCode: string;
}

/**
 * Geography Foundation Pass 2 → Personal/Account UX Correction pass → this
 * pass's own Location Creation + Icon Consistency correction — a submitter
 * provides FACTUAL geography only: name (elsewhere on the form), address,
 * City, State, ZIP Code. No Findmi Market/Area (internal editorial
 * organization — Admin assigns it later from the real City/State on file;
 * createMemberLocation already omits market_id/market_area_id entirely
 * when this form doesn't submit them). No "exact place" picker either —
 * redundant immediately after City/State/ZIP and confusing on a basic
 * creation form; the underlying geocoding (resolveEntityGeography, still
 * run server-side from City/State alone) and Admin's own exact-geography
 * tools are completely untouched, only this one picker control is gone
 * from this one user-facing flow. A plain Server Component now — no
 * client state is needed once the picker is gone. */
export default function LocationGeographyFields({ defaultCity, defaultState, defaultPostalCode }: LocationGeographyFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">City</span>
          <input autoCapitalize="words" type="text" name="city" defaultValue={defaultCity} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">State</span>
          <input autoCapitalize="words" type="text" name="state" defaultValue={defaultState} className={inputClass} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">ZIP Code</span>
        <input autoCapitalize="none" type="text" inputMode="numeric" autoComplete="postal-code" name="postal_code" defaultValue={defaultPostalCode} className={inputClass} />
      </label>
    </>
  );
}
