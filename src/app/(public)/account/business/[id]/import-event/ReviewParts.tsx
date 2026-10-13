// Event Import — Review building blocks shared by the single-Event Review
// and the V1C several-Events review: each date with its own place (V1B),
// compact rows, an existing-Location choice per place.
import { useState } from "react";
import ChevronIcon from "@/components/ChevronIcon";
import type { EventImportMatches, EventImportReview, ReviewOccurrence, ReviewPlace } from "@/lib/event-import/types";
import { emptyReviewOccurrence, occurrenceSummary } from "@/lib/event-import/review";

export const MAX_DATES = 60;

export const inputClass =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/15";
export const sectionClass = "rounded-2xl border border-black/[0.07] bg-white p-4";
export const labelClass = "mb-1 block text-metadata font-semibold text-secondary";

/** When (& Where): every date with its own place, or one shared Where.
 * Keeps its own open rows and left-out earlier dates; remount (key) for a
 * fresh review. */
export function WhenWhereEditor({
  review,
  set,
  matches,
  initialPast,
  idPrefix = "",
}: {
  review: EventImportReview;
  set: (patch: Partial<EventImportReview>) => void;
  matches: EventImportMatches;
  initialPast: ReviewOccurrence[];
  idPrefix?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(() => initiallyOpen(review.occurrences));
  const [pastDates, setPastDates] = useState<ReviewOccurrence[]>(initialPast);
  const setOccurrence = (id: string | undefined, patch: Partial<ReviewOccurrence>) =>
    set({ occurrences: review.occurrences.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const toggle = (id: string | undefined) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (id && next.has(id)) next.delete(id);
      else if (id) next.add(id);
      return next;
    });
  const removeOccurrence = (id: string | undefined) => set({ occurrences: review.occurrences.filter((d) => d.id !== id) });
  const addOccurrence = () => {
    const row = emptyReviewOccurrence();
    set({ occurrences: [...review.occurrences, row] });
    setOpen((prev) => new Set(prev).add(row.id!));
  };
  const addBack = (row: ReviewOccurrence) => {
    setPastDates((prev) => prev.filter((d) => d.id !== row.id));
    set({ occurrences: [...review.occurrences, row].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)) });
  };
  // Switching layouts keeps every value: one place → copied to each date;
  // each date's own place → the first one becomes the shared place.
  const usePlacePerDate = () => set({ sharedPlace: false, occurrences: review.occurrences.map((d) => ({ ...d, place: { ...review.place } })) });
  const useOnePlace = () => set({ sharedPlace: true, place: { ...(review.occurrences[0]?.place ?? review.place) } });
  const many = review.occurrences.length > 1;

  return (
    <>
          {/* When (& Where) — each date is reviewed with its own place. */}
          <section aria-labelledby={`${idPrefix}when`} className={`${sectionClass} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id={`${idPrefix}when`} className="text-label font-bold uppercase text-subtle">
                {review.sharedPlace ? "When" : "When & Where"}
                {many ? ` · ${review.occurrences.length} Dates` : ""}
              </h2>
              {many && (
                <button type="button" onClick={review.sharedPlace ? usePlacePerDate : useOnePlace} className="text-metadata font-semibold text-accent hover:underline">
                  {review.sharedPlace ? "Different Place Each Date" : "Same Place for All Dates"}
                </button>
              )}
            </div>
            <ol className="flex flex-col gap-2">
              {review.occurrences.map((d, i) => (
                <OccurrenceRow
                  key={d.id}
                  index={i}
                  numbered={many}
                  occurrence={d}
                  showPlace={!review.sharedPlace}
                  expanded={!many || open.has(d.id ?? "")}
                  collapsible={many}
                  matches={matches}
                  onToggle={() => toggle(d.id)}
                  onChange={(patch) => setOccurrence(d.id, patch)}
                  onRemove={many ? () => removeOccurrence(d.id) : null}
                />
              ))}
            </ol>
            {review.occurrences.length < MAX_DATES && (
              <button type="button" onClick={addOccurrence} className="w-fit py-1 text-metadata font-semibold text-accent hover:underline">
                + Add a Date
              </button>
            )}
            {pastDates.length > 0 && (
              <details className="rounded-xl border border-black/[0.06] bg-black/[0.015] px-3 py-2">
                <summary className="cursor-pointer text-metadata font-semibold text-secondary">
                  {pastDates.length} Earlier {pastDates.length === 1 ? "Date" : "Dates"} Not Included
                </summary>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {pastDates.map((d) => {
                    const sum = occurrenceSummary(d);
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-2 text-metadata text-muted">
                        <span className="min-w-0 truncate">
                          {sum.day}
                          {sum.time ? ` · ${sum.time}` : ""}
                          {d.place.venueName ? ` · ${d.place.venueName}` : ""}
                        </span>
                        <button type="button" onClick={() => addBack(d)} className="shrink-0 font-semibold text-accent hover:underline">
                          Add
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            <p className="text-microcopy text-subtle">Times are Eastern Time. An end time earlier than the start means it ends after midnight.</p>
          </section>

          {/* Where — one place for every date. */}
          {review.sharedPlace && (
            <section aria-labelledby={`${idPrefix}where`} className={`${sectionClass} flex flex-col gap-3`}>
              <h2 id={`${idPrefix}where`} className="text-label font-bold uppercase text-subtle">
                Where
              </h2>
              <PlaceFields idPrefix={`${idPrefix}place`} place={review.place} matches={matches} onChange={(patch) => set({ place: { ...review.place, ...patch } })} />
            </section>
          )}
    </>
  );
}

export function Choice({ checked, onChange, title, line }: { checked: boolean; onChange: () => void; title: string; line: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${checked ? "border-findmi/50 bg-findmi-50/50" : "border-black/[0.08] bg-white"}`}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-1 h-4 w-4 accent-findmi" />
      <span className="min-w-0">
        <span className="block text-body font-semibold text-primary">{title}</span>
        <span className="block text-metadata text-muted">{line}</span>
      </span>
    </label>
  );
}

/** Rows open at first: a single date, or any date still missing its day or times. */
export function initiallyOpen(rows: ReviewOccurrence[]): Set<string> {
  return new Set(rows.filter((d) => rows.length === 1 || !d.date || !d.startTime || !d.endTime).map((d) => d.id ?? ""));
}

function placeLine(p: ReviewPlace, matches: EventImportMatches): string {
  const loc = p.useLocationId ? matches.locations.find((l) => l.id === p.useLocationId) : null;
  if (loc) return [loc.name, loc.address].filter(Boolean).join(" · ");
  return [p.venueName, p.address].filter(Boolean).join(" · ");
}

export function OccurrenceRow({
  index,
  numbered,
  occurrence: d,
  showPlace,
  expanded,
  collapsible,
  matches,
  onToggle,
  onChange,
  onRemove,
}: {
  index: number;
  numbered: boolean;
  occurrence: ReviewOccurrence;
  showPlace: boolean;
  expanded: boolean;
  collapsible: boolean;
  matches: EventImportMatches;
  onToggle: () => void;
  onChange: (patch: Partial<ReviewOccurrence>) => void;
  onRemove: (() => void) | null;
}) {
  const id = d.id ?? String(index);
  const sum = occurrenceSummary(d);
  const where = placeLine(d.place, matches);
  const label = numbered ? `Date ${index + 1}` : "Date";
  const endsAfterMidnight = Boolean(d.startTime && d.endTime && d.endTime < d.startTime);
  return (
    <li className={collapsible ? "rounded-xl border border-black/[0.08] bg-white" : ""}>
      {collapsible && (
        <div className="flex items-start gap-2 px-3 py-2.5">
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`occ-${id}`} className="flex min-w-0 flex-1 items-start gap-2 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-primary">{sum.day || <span className="text-amber-700">Add a date</span>}</span>
              <span className="block text-metadata text-secondary">{sum.time || <span className="text-amber-700">Add a time</span>}</span>
              {showPlace && (
                <span className="flex min-w-0 items-center gap-1.5 text-metadata text-muted">
                  <span className="min-w-0 truncate">{where || <span className="text-amber-700">Add a place</span>}</span>
                  {d.place.useLocationId && <span className="shrink-0 rounded-full bg-findmi-50 px-1.5 py-0.5 text-microcopy font-semibold text-findmi-700">On Findmi</span>}
                </span>
              )}
            </span>
            <ChevronIcon direction={expanded ? "up" : "down"} className="mt-1 h-4 w-4 shrink-0 text-subtle" />
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="shrink-0 py-0.5 text-metadata font-semibold text-muted hover:text-red-600">
              Remove
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div id={`occ-${id}`} className={`grid grid-cols-2 gap-2 ${collapsible ? "border-t border-black/[0.05] px-3 pb-3 pt-2.5" : ""}`}>
          <div className="col-span-2">
            <label htmlFor={`date-${id}`} className={labelClass}>
              {label}
            </label>
            <input id={`date-${id}`} type="date" value={d.date} onChange={(e) => onChange({ date: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`start-${id}`} className={labelClass}>
              Starts
            </label>
            <input id={`start-${id}`} type="time" value={d.startTime} onChange={(e) => onChange({ startTime: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`end-${id}`} className={labelClass}>
              Ends
            </label>
            <input id={`end-${id}`} type="time" value={d.endTime} onChange={(e) => onChange({ endTime: e.target.value })} className={inputClass} />
          </div>
          {endsAfterMidnight && <p className="col-span-2 text-microcopy text-subtle">Ends after midnight.</p>}
          {showPlace && (
            <div className="col-span-2 flex flex-col gap-2 pt-1">
              <PlaceFields idPrefix={`place-${id}`} place={d.place} matches={matches} onChange={(patch) => onChange({ place: { ...d.place, ...patch } })} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function PlaceFields({
  idPrefix,
  place,
  matches,
  onChange,
}: {
  idPrefix: string;
  place: ReviewPlace;
  matches: EventImportMatches;
  onChange: (patch: Partial<ReviewPlace>) => void;
}) {
  const match = place.matchKey ? matches.locations.find((l) => l.key === place.matchKey) : undefined;
  return (
    <>
      {match && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-metadata text-secondary">
            {match.confidence === "strong" ? "Findmi already has " : "Is this "}
            <span className="font-semibold text-primary">{match.name}</span>
            {match.address || match.city ? ` (${[match.address, match.city].filter(Boolean).join(", ")})` : ""}
            {match.confidence === "strong" ? "." : "?"}
          </legend>
          <Choice checked={place.useLocationId === match.id} onChange={() => onChange({ useLocationId: match.id })} title="Use This Place" line="Connect it to the place already on Findmi." />
          <Choice checked={place.useLocationId === null} onChange={() => onChange({ useLocationId: null })} title="Use the Details Below" line="It’s a different place." />
        </fieldset>
      )}
      {!place.useLocationId && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label htmlFor={`${idPrefix}-venue`} className={labelClass}>
              Place
            </label>
            <input id={`${idPrefix}-venue`} value={place.venueName ?? ""} onChange={(e) => onChange({ venueName: e.target.value })} className={inputClass} autoCapitalize="words" />
          </div>
          <div className="col-span-2">
            <label htmlFor={`${idPrefix}-address`} className={labelClass}>
              Street Address
            </label>
            <input id={`${idPrefix}-address`} value={place.address ?? ""} onChange={(e) => onChange({ address: e.target.value })} className={inputClass} autoCapitalize="words" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-city`} className={labelClass}>
              City
            </label>
            <input id={`${idPrefix}-city`} value={place.city ?? ""} onChange={(e) => onChange({ city: e.target.value })} className={inputClass} autoCapitalize="words" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-state`} className={labelClass}>
              State
            </label>
            <input id={`${idPrefix}-state`} value={place.state ?? ""} onChange={(e) => onChange({ state: e.target.value })} className={inputClass} autoCapitalize="words" />
          </div>
        </div>
      )}
    </>
  );
}
