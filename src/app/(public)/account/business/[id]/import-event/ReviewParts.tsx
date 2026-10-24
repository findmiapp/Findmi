// Event Import — Review building blocks shared by the single-Event Review
// and the V1C several-Events review: each date with its own place (V1B),
// compact rows, an existing-Location choice per place.
import { attendanceSlots, fromAttendanceSlots, type AttendanceSlots } from "@/lib/event-import/attendance-links";
import { useState } from "react";
import ChevronIcon from "@/components/ChevronIcon";
import CategorySubcategoryField from "@/components/admin/CategorySubcategoryField";
import EventFormatField from "@/components/admin/EventFormatField";
import type { Category } from "@/lib/types";
import type { EventCandidate, EventImportMatches, EventImportReview, ReviewOccurrence, ReviewPlace } from "@/lib/event-import/types";
import { createInlinePlace } from "@/app/(public)/account/location/actions";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";
import { OCCURRENCE_DETAILS_MAX } from "@/lib/event-import/occurrence-details";
import {
  canOfferLocationCreate,
  canResearchLocation,
  decidePlaceFrom,
  emptyReviewOccurrence,
  occurrenceSummary,
  REVIEW_TIME_NOT_LISTED,
  placeKeyFor,
  placesDiffer,
  selectCreatedLocation,
  type ReviewCreatedLocation,
} from "@/lib/event-import/review";

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
  quickCreate,
}: {
  review: EventImportReview;
  set: (patch: Partial<EventImportReview>) => void;
  matches: EventImportMatches;
  initialPast: ReviewOccurrence[];
  idPrefix?: string;
  /** Missing-Location Quick Create: `online` feeds the eligibility check;
   * `onCreated` lets the parent show the new Location as a match and reuse
   * it for the same place elsewhere (other Events in a batch). */
  quickCreate?: { online: boolean; onCreated: (location: ReviewCreatedLocation) => void; createAction?: InlinePlaceAction; render?: LocationCreateRenderer };
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
  // Quick Create for one place (target = "shared" or a date id): select the
  // new Location there (and on the same unanswered place on other dates),
  // then tell the parent. Review state only — the Event isn't saved here.
  const quickCreateFor = (target: string, place: ReviewPlace): PlaceQuickCreate | undefined =>
    quickCreate
      ? {
          // A `render`-based picker (Admin's EventLocationCreate) does its
          // OWN research before ever creating anything, so it only needs
          // canResearchLocation's looser bar; the plain inline Quick Create
          // below (no render) skips research and writes the given fields
          // directly, so it keeps canOfferLocationCreate's stricter,
          // already-a-real-address requirement.
          eligible: quickCreate.render
            ? canResearchLocation(place, { locationVisibility: review.locationVisibility, online: quickCreate.online })
            : canOfferLocationCreate(place, { locationVisibility: review.locationVisibility, online: quickCreate.online }),
          onSelected: (location) => {
            set(selectCreatedLocation(review, target, location));
            quickCreate.onCreated(location);
          },
          createAction: quickCreate.createAction,
          render: quickCreate.render,
        }
      : undefined;

  return (
    <>
          {/* When (& Where) — each date is reviewed with its own place. */}
          <section aria-labelledby={`${idPrefix}when`} className={`${sectionClass} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id={`${idPrefix}when`} className="text-label font-bold uppercase text-subtle">
                {review.sharedPlace ? "When" : "When & Where"}
                {many ? ` · ${review.occurrences.length} Dates` : ""}
              </h2>
              {/* "Different Place Each Date" is a STATUS shown only when the
                  dates really are at different places; switching layouts is
                  a separate, plainly worded action. */}
              {many && placesDiffer(review) && <span className="text-metadata font-semibold text-secondary">Different Place Each Date</span>}
              {many && (
                <button type="button" onClick={review.sharedPlace ? usePlacePerDate : useOnePlace} className="text-metadata font-semibold text-accent hover:underline">
                  {review.sharedPlace ? "Set a Place per Date" : "Same Place for All Dates"}
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
                  onDecidePlace={(decision, locationId) => set(decidePlaceFrom(review, d.id ?? "", decision, locationId))}
                  quickCreate={quickCreateFor(d.id ?? "", d.place)}
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
            <p className="text-microcopy text-subtle">Times are Eastern Time. An end time earlier than the start means it ends after midnight; a span into a later day keeps its own end date.</p>
          </section>

          {/* Where — one place for every date. */}
          {review.sharedPlace && (
            <section aria-labelledby={`${idPrefix}where`} className={`${sectionClass} flex flex-col gap-3`}>
              <h2 id={`${idPrefix}where`} className="text-label font-bold uppercase text-subtle">
                Where
              </h2>
              <PlaceFields
                idPrefix={`${idPrefix}place`}
                place={review.place}
                matches={matches}
                onChange={(patch) => set({ place: { ...review.place, ...patch } })}
                onDecide={(decision, locationId) => set(decidePlaceFrom(review, "shared", decision, locationId))}
                quickCreate={quickCreateFor("shared", review.place)}
              />
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
  // A date with no published time is complete; only a missing day or an
  // end with no start needs attention.
  return new Set(rows.filter((d) => rows.length === 1 || !d.date || (d.endTime && !d.startTime)).map((d) => d.id ?? ""));
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
  onDecidePlace,
  quickCreate,
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
  onDecidePlace?: (decision: "use" | "reject", locationId: string) => void;
  quickCreate?: PlaceQuickCreate;
}) {
  const id = d.id ?? String(index);
  const sum = occurrenceSummary(d);
  const where = placeLine(d.place, matches);
  const label = numbered ? `Date ${index + 1}` : "Date";
  const endsLaterDay = Boolean(d.endDate && d.endDate > d.date);
  const endsAfterMidnight = Boolean(!endsLaterDay && d.startTime && d.endTime && d.endTime < d.startTime);
  return (
    <li className={collapsible ? "rounded-xl border border-black/[0.08] bg-white" : ""}>
      {collapsible && (
        <div className="flex items-start gap-2 px-3 py-2.5">
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`occ-${id}`} className="flex min-w-0 flex-1 items-start gap-2 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-primary">{sum.day || <span className="text-amber-700">Add a date</span>}</span>
              <span className="block text-metadata text-secondary">{sum.time || <span className="text-amber-700">Add a start time</span>}</span>
              {d.details && <span className="block truncate text-microcopy text-muted">{d.details}</span>}
              {showPlace && (
                <span className="flex min-w-0 items-center gap-1.5 text-metadata text-muted">
                  <span className="min-w-0 truncate">{where || <span className="text-amber-700">Add a place</span>}</span>
                  {d.place.useLocationId && <span className="shrink-0 rounded-full bg-findmi-50 px-1.5 py-0.5 text-microcopy font-semibold text-findmi-700">On Findmi</span>}
                  {!d.place.useLocationId && !d.place.matchDecision && d.place.matchKey && matches.locations.some((l) => l.key === d.place.matchKey) && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-microcopy font-semibold text-amber-800">Confirm Place</span>
                  )}
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
            {/* Optional — blank means no time is published (never guessed). */}
            <input id={`start-${id}`} type="time" value={d.startTime} onChange={(e) => onChange({ startTime: e.target.value, ...(e.target.value ? {} : { endTime: "", endDate: null }) })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`end-${id}`} className={labelClass}>
              Ends
            </label>
            <input id={`end-${id}`} type="time" value={d.endTime} disabled={!d.startTime} onChange={(e) => onChange({ endTime: e.target.value, ...(e.target.value ? {} : { endDate: null }) })} className={`${inputClass} disabled:opacity-50`} />
          </div>
          {d.startTime && d.endTime && (
            <div className="col-span-2">
              <label htmlFor={`end-date-${id}`} className={labelClass}>
                Ends On (If A Later Day)
              </label>
              {/* One continuous span into a later day — never split into made-up per-day dates. */}
              <input id={`end-date-${id}`} type="date" value={d.endDate ?? ""} min={d.date || undefined} onChange={(e) => onChange({ endDate: e.target.value || null })} className={inputClass} />
            </div>
          )}
          {endsAfterMidnight && <p className="col-span-2 text-microcopy text-subtle">Ends after midnight.</p>}
          {endsLaterDay && <p className="col-span-2 text-microcopy text-subtle">Runs continuously until {sum.time.split(" – ")[1] ?? "the end time"}.</p>}
          {!d.startTime && <p className="col-span-2 text-microcopy text-subtle">{REVIEW_TIME_NOT_LISTED} — leave blank when no time is published.</p>}
          {d.startTime && !d.endTime && <p className="col-span-2 text-microcopy text-subtle">No end time listed — Findmi won&rsquo;t show a closing time.</p>}
          {showPlace && (
            <div className="col-span-2 flex flex-col gap-2 pt-1">
              <PlaceFields idPrefix={`place-${id}`} place={d.place} matches={matches} onChange={(patch) => onChange({ place: { ...d.place, ...patch } })} onDecide={onDecidePlace} quickCreate={quickCreate} />
            </div>
          )}
          <div className="col-span-2">
            <label htmlFor={`details-${id}`} className={labelClass}>
              Details For This Date
            </label>
            <textarea
              id={`details-${id}`}
              value={d.details ?? ""}
              onChange={(e) => onChange({ details: e.target.value })}
              maxLength={OCCURRENCE_DETAILS_MAX}
              rows={2}
              autoCapitalize="sentences"
              placeholder="Optional — who appears, what’s happening that day"
              className={`${inputClass} resize-y`}
            />
          </div>
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
  onDecide,
  quickCreate,
}: {
  idPrefix: string;
  place: ReviewPlace;
  matches: EventImportMatches;
  onChange: (patch: Partial<ReviewPlace>) => void;
  /** Answer the Findmi Location question (lets the caller apply it to the same place elsewhere). */
  onDecide?: (decision: "use" | "reject", locationId: string) => void;
  quickCreate?: PlaceQuickCreate;
}) {
  const match = place.matchKey ? matches.locations.find((l) => l.key === place.matchKey) : undefined;
  return (
    <>
      {match && (
        <LocationMatchCard
          match={match}
          decision={place.useLocationId === match.id ? "use" : place.matchDecision === "reject" ? "reject" : null}
          onDecide={(decision) => (onDecide ? onDecide(decision, match.id) : onChange({ matchDecision: decision, useLocationId: decision === "use" ? match.id : null }))}
        />
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
      {!place.useLocationId && quickCreate?.eligible && !quickCreate.render && <QuickCreateLocation idPrefix={idPrefix} place={place} onSelected={quickCreate.onSelected} createAction={quickCreate.createAction} />}
      {/* Admin Event Import: Location Import V1's create step (match before
          create, website enrichment, review) — under the SAME eligibility
          rule as Quick Create (no vague, hidden, online or linked place). */}
      {!place.useLocationId && quickCreate?.eligible && quickCreate.render ? quickCreate.render({ idPrefix, place, placeKey: placeKeyFor(place), onSelected: quickCreate.onSelected }) : null}
    </>
  );
}

/** The server action that creates the Location — the member-facing
 * createInlinePlace by default; Admin Event Import passes its admin-session
 * counterpart (same shared rules, lib/places/inline-place.ts). */
export type InlinePlaceAction = (formData: FormData) => Promise<CreateInlineLocationResult>;

export interface PlaceQuickCreate {
  eligible: boolean;
  onSelected: (location: ReviewCreatedLocation) => void;
  createAction?: InlinePlaceAction;
  /** Replaces the bare Quick Create (Admin Event Import → Location Import V1). */
  render?: LocationCreateRenderer;
}

/** Renders a caller's own missing-Location step for one place. It reports
 * the chosen/created Location keyed by `placeKey`, so every other place
 * with the same key in this Review (and batch) reuses it. */
export type LocationCreateRenderer = (props: {
  idPrefix: string;
  place: ReviewPlace;
  placeKey: string;
  onSelected: (location: ReviewCreatedLocation) => void;
}) => React.ReactNode;

const toCreated = (key: string, l: SelectedLocationDetail): ReviewCreatedLocation => ({
  key,
  id: l.id,
  name: l.name,
  address: l.address,
  city: l.city,
  state: l.state,
  postalCode: l.postal_code,
});

/** Missing-Location Quick Create — the existing inline place creation
 * (createInlinePlace: name + street + city + state, ZIP optional; unlisted,
 * no membership, duplicate-checked server-side) prefilled from the
 * reviewed place. A likely duplicate is offered instead of creating;
 * "Create Anyway" is the same explicit force path. Selecting either only
 * changes Review — the Event is saved later, as always. */
export function QuickCreateLocation({
  idPrefix,
  place,
  onSelected,
  createAction = createInlinePlace,
}: {
  idPrefix: string;
  place: ReviewPlace;
  onSelected: (location: ReviewCreatedLocation) => void;
  createAction?: InlinePlaceAction;
}) {
  const key = placeKeyFor(place);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ name: "", address: "", city: "", state: "", postal_code: "" });
  const [duplicates, setDuplicates] = useState<SelectedLocationDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function start() {
    setFields({ name: place.venueName ?? "", address: place.address ?? "", city: place.city ?? "", state: place.state ?? "", postal_code: place.postalCode ?? "" });
    setDuplicates([]);
    setError(null);
    setOpen(true);
  }

  async function create(force: boolean) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (force) form.set("force", "1");
    try {
      const result = await createAction(form);
      if (result.status === "created") {
        setOpen(false);
        onSelected(toCreated(key, result.location));
      } else if (result.status === "duplicates") {
        setDuplicates(result.duplicates);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Couldn't add this place. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={start} className="w-fit py-1 text-metadata font-semibold text-accent hover:underline">
        + Create New Location
      </button>
    );
  }

  const field = (name: keyof typeof fields, label: string, span = "col-span-2") => (
    <div className={span}>
      <label htmlFor={`${idPrefix}-new-${name}`} className={labelClass}>
        {label}
      </label>
      <input id={`${idPrefix}-new-${name}`} value={fields[name]} onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))} className={inputClass} autoCapitalize="words" />
    </div>
  );

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-black/[0.08] bg-black/[0.015] p-3">
      <p className="text-label font-bold uppercase text-subtle">New Findmi Location</p>
      {duplicates.length > 0 ? (
        <>
          <p className="text-metadata text-secondary">This place may already be on Findmi.</p>
          <ul className="flex flex-col gap-2">
            {duplicates.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-2 rounded-lg border border-black/[0.08] bg-white p-2.5">
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-primary">{d.name}</span>
                  <span className="block text-metadata text-secondary">{[d.address, [d.city, d.state].filter(Boolean).join(", "), d.postal_code].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" onClick={() => onSelected(toCreated(key, d))} className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-metadata font-semibold text-white">
                  Use This Location
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy} onClick={() => create(true)} className="text-metadata font-semibold text-accent hover:underline disabled:opacity-50">
              {busy ? "Creating…" : "Create Anyway"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-metadata font-semibold text-muted hover:underline">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {field("name", "Location Name")}
            {field("address", "Street Address")}
            {field("city", "City", "")}
            {field("state", "State", "")}
            {field("postal_code", "ZIP Code", "")}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={() => create(false)} className="rounded-full bg-findmi px-4 py-2 text-metadata font-semibold text-white disabled:opacity-50">
              {busy ? "Creating…" : "Create Location"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-metadata font-semibold text-muted hover:underline">
              Cancel
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-metadata text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

type LocationMatch = EventImportMatches["locations"][number];

/** A Findmi Location the page's place appears to be. Strong matches start
 * linked (and say so); possible ones wait for an answer. Either can be
 * changed before saving. */
export function LocationMatchCard({
  match,
  decision,
  onDecide,
  pageText,
}: {
  match: LocationMatch;
  decision: "use" | "reject" | null;
  onDecide: (decision: "use" | "reject") => void;
  /** e.g. "The page says Corgi Cafe · 6 Events". */
  pageText?: string;
}) {
  const locality = [[match.city, match.state].filter(Boolean).join(", "), match.postalCode].filter(Boolean).join(" ");
  return (
    <fieldset className={`flex flex-col gap-2 rounded-xl border p-3 ${decision === null ? "border-amber-200 bg-amber-50/40" : "border-black/[0.08] bg-white"}`}>
      <legend className="sr-only">Is this {match.name}?</legend>
      <p className={`text-label font-bold uppercase ${match.confidence === "strong" ? "text-findmi-700" : "text-amber-800"}`}>
        {match.confidence === "strong" ? "On Findmi" : "Possible Findmi Location"}
      </p>
      {pageText && <p className="-mt-1 text-metadata text-muted">{pageText}</p>}
      <div>
        <p className="text-body font-semibold text-primary">{match.name}</p>
        {match.address && <p className="text-metadata text-secondary">{match.address}</p>}
        {locality && <p className="text-metadata text-secondary">{locality}</p>}
      </div>
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <Choice checked={decision === "use"} onChange={() => onDecide("use")} title="Use This Location" line="Show it on this Location’s page." />
        <Choice checked={decision === "reject"} onChange={() => onDecide("reject")} title="Not the Same Place" line="Keep the place as written." />
      </div>
    </fieldset>
  );
}

const PRICING_NOTE: Record<"free" | "paid" | "unknown", string> = {
  free: "The page says it's free.",
  paid: "The page lists a price.",
  unknown: "The page doesn't say whether it's free.",
};

/** Attendance + location privacy for a NEW Event. Starts from what the
 * page evidenced (never guessed); the person can change the action, fix
 * the link, or turn it off. "Register"/"RSVP" label the Event's RSVP
 * action; "Get Tickets" its tickets action. */
export function AttendanceEditor({
  review,
  set,
  evidence,
  idPrefix = "",
}: {
  review: EventImportReview;
  set: (patch: Partial<EventImportReview>) => void;
  evidence: EventCandidate["attendance"];
  idPrefix?: string;
}) {
  // Two separate, visible slots — RSVP / Registration and Tickets are
  // different actions (events.rsvp_url / events.tickets_url). Each shows
  // what the operator pasted or the Event Link evidenced, else blank.
  const slots = attendanceSlots(review);
  const setSlots = (next: AttendanceSlots) => set(fromAttendanceSlots(next));
  const pricing = evidence?.pricing ?? "unknown";
  return (
    <section aria-labelledby={`${idPrefix}attendance`} className={`${sectionClass} flex flex-col gap-3`}>
      <h2 id={`${idPrefix}attendance`} className="text-label font-bold uppercase text-subtle">
        Attendance
      </h2>
      {review.locationVisibility === "hidden" && (
        <p className="rounded-lg bg-findmi-50 px-3 py-2 text-metadata text-findmi-700">
          Location shared after registration. The organizer hides the exact address, so Findmi won&rsquo;t show one.
        </p>
      )}
      <div>
        <label htmlFor={`${idPrefix}attendance-rsvp`} className={labelClass}>
          RSVP / Registration Link
        </label>
        <div className="flex gap-2">
          <select
            aria-label="RSVP button label"
            value={slots.rsvp?.cta ?? "register"}
            onChange={(e) => setSlots({ ...slots, rsvp: { cta: e.target.value as "rsvp" | "register", url: slots.rsvp?.url ?? "" } })}
            // Never the shared `w-full`: beside the URL it would squeeze the
            // link field to nothing on a phone (the URL looked missing).
            className={`${inputClass.replace("w-full ", "")} w-auto shrink-0`}
          >
            <option value="register">Register</option>
            <option value="rsvp">RSVP</option>
          </select>
          <input
            id={`${idPrefix}attendance-rsvp`}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            value={slots.rsvp?.url ?? ""}
            onChange={(e) => setSlots({ ...slots, rsvp: e.target.value || slots.rsvp ? { cta: slots.rsvp?.cta ?? "register", url: e.target.value } : null })}
            onBlur={(e) => {
              if (!e.target.value.trim()) setSlots({ ...slots, rsvp: null });
            }}
            placeholder="https://"
            className={`${inputClass} min-w-0 flex-1`}
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}attendance-tickets`} className={labelClass}>
          Ticket Link
        </label>
        <input
          id={`${idPrefix}attendance-tickets`}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          value={slots.tickets ?? ""}
          onChange={(e) => setSlots({ ...slots, tickets: e.target.value })}
          onBlur={(e) => {
            if (!e.target.value.trim()) setSlots({ ...slots, tickets: null });
          }}
          placeholder="https://"
          className={inputClass}
        />
        <p className="mt-1 text-microcopy text-subtle">
          {!slots.rsvp && !slots.tickets ? "No RSVP or ticket link found — the Event Link alone never becomes one. " : ""}
          {PRICING_NOTE[pricing]}
          {evidence?.price ? ` ${evidence.price}.` : ""}
          {evidence?.registration === "not_required" ? " It says no registration is needed." : ""}
        </p>
      </div>
    </section>
  );
}

/** Event Formats V1 — the NEW Event's Formats (zero to many), chosen by the
 * person; nothing is inferred. Same shared picker as Event Create/Edit. */
export function EventFormatEditor({
  formats,
  review,
  set,
}: {
  formats: Category[];
  review: EventImportReview;
  set: (patch: Partial<EventImportReview>) => void;
}) {
  if (formats.length === 0) return null;
  return (
    <section className={sectionClass}>
      <EventFormatField variant="compact" formats={formats} defaultSelectedIds={review.formatIds ?? []} onChange={(ids) => set({ formatIds: ids })} />
    </section>
  );
}

/** Event Taxonomy V1 — the NEW Event's one primary category (Category →
 * optional Subcategory), via the same shared picker Event Create/Edit
 * uses. Optional; nothing is inferred. */
export function EventCategoryEditor({
  categories,
  review,
  set,
}: {
  categories: Category[];
  review: EventImportReview;
  set: (patch: Partial<EventImportReview>) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <section className={sectionClass}>
      <CategorySubcategoryField
        variant="compact"
        categories={categories}
        defaultCategoryId={review.categoryId ?? null}
        emptyText="No Event categories yet."
        onChange={(id) => set({ categoryId: id || null })}
      />
    </section>
  );
}
