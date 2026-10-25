import { AUDIENCE_LABELS, BENEFIT_LABELS, ENTRY_LABELS, EVENT_AUDIENCES, EVENT_BENEFITS, ENTRY_MODES, normalizeAudience, normalizeBenefits, normalizeEntryModes } from "@/lib/discovery/attributes";

/** Admin Event editor — Discovery Details: the structured facts the
 * Discovery Engine filters on (Free, perks, audience, entry). Only what
 * the organizer actually offers; nothing here is inferred from the
 * description. "Free Admission" and "Free Food" are separate facts. */
export default function EventDiscoveryFields({ event }: { event: Record<string, unknown> | null }) {
  const benefits = normalizeBenefits(event?.benefits);
  const audience = normalizeAudience(event?.audience);
  const entry = normalizeEntryModes(event?.entry_modes);
  const free = event?.is_free === true ? "free" : event?.is_free === false ? "paid" : "";
  const box = "flex min-h-9 items-center gap-2 rounded-full border border-black/10 bg-white px-3 text-sm text-ink/80 has-[:checked]:border-findmi has-[:checked]:bg-findmi-50 has-[:checked]:text-findmi-700";
  return (
    <div className="flex flex-col gap-5">
      <input type="hidden" name="discovery_fields" value="1" />
      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/50">Admission</legend>
        <select name="is_free" defaultValue={free} className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm sm:max-w-xs">
          <option value="">Not Specified</option>
          <option value="free">Free Admission</option>
          <option value="paid">Paid Admission</option>
        </select>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/50">Perks Offered</legend>
        <div className="flex flex-wrap gap-2">
          {EVENT_BENEFITS.filter((b) => b !== "free_admission").map((b) => (
            <label key={b} className={box}>
              <input type="checkbox" name="benefits" value={b} defaultChecked={benefits.includes(b)} className="accent-findmi" />
              {BENEFIT_LABELS[b]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/50">Audience</legend>
        <label className={`${box} mb-2 w-fit`}>
          <input type="checkbox" name="family_friendly" defaultChecked={event?.family_friendly === true} className="accent-findmi" />
          Family Friendly
        </label>
        <div className="flex flex-wrap gap-2">
          {EVENT_AUDIENCES.map((a) => (
            <label key={a} className={box}>
              <input type="checkbox" name="audience" value={a} defaultChecked={audience.includes(a)} className="accent-findmi" />
              {AUDIENCE_LABELS[a]}
            </label>
          ))}
        </div>
        <div className="mt-3 grid max-w-xs grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/55">
            Minimum Age
            <input autoCapitalize="none" name="min_age" inputMode="numeric" pattern="\d{1,2}" defaultValue={typeof event?.min_age === "number" ? String(event.min_age) : ""} className="min-h-10 rounded-xl border border-black/10 px-3 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/55">
            Maximum Age
            <input autoCapitalize="none" name="max_age" inputMode="numeric" pattern="\d{1,2}" defaultValue={typeof event?.max_age === "number" ? String(event.max_age) : ""} className="min-h-10 rounded-xl border border-black/10 px-3 text-sm text-ink" />
          </label>
        </div>
        <p className="mt-1.5 text-xs text-ink/45">Only set an age rule or 21+ when the organizer states it.</p>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/50">Entry</legend>
        <div className="flex flex-wrap gap-2">
          {ENTRY_MODES.map((m) => (
            <label key={m} className={box}>
              <input type="checkbox" name="entry_modes" value={m} defaultChecked={entry.includes(m)} className="accent-findmi" />
              {ENTRY_LABELS[m]}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
