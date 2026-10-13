"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import { analyzeEventImport, commitEventImport } from "./actions";
import {
  EVENT_IMPORT_FAILURE_COPY,
  type EventCandidate,
  type EventImportIntent,
  type EventImportMatches,
  type EventImportReview,
  type ReviewOccurrence,
  type ReviewPlace,
} from "@/lib/event-import/types";
import { emptyReviewOccurrence, occurrenceSummary, pastReviewOccurrences, reviewDefaults, successMessage } from "@/lib/event-import/review";

/** Event Import V1 — Business importer: paste a link → Findmi reads it →
 * Review (everything editable, existing Findmi records clearly marked) →
 * Add. Nothing is saved before the Business confirms Review.
 *
 * V1B: each date is reviewed together with its own place. When every date
 * shares one place there is a single Where section; when places differ the
 * dates become compact "When & Where" rows (date · time · place at a
 * glance, tap to edit). */

const MAX_DATES = 60;

const inputClass =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/15";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "flex h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-findmi/40";
const sectionClass = "rounded-2xl border border-black/[0.07] bg-white p-4";
const labelClass = "mb-1 block text-metadata font-semibold text-secondary";

const INTENT_COPY: Record<EventImportIntent, { title: string; line: string; badge: string }> = {
  participating: { title: "Where I’ll Be", line: "Add something your Business is participating in.", badge: "Participating" },
  hosting: { title: "Host an Event", line: "Create something your Business is organizing.", badge: "Hosting" },
};

type Step =
  | { kind: "url"; error: string | null }
  | { kind: "review"; candidate: EventCandidate; matches: EventImportMatches; warnings: string[] }
  | { kind: "done"; message: string; viewHref: string };

function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
}

export default function EventImporter({
  businessId,
  businessName,
  initialIntent,
  manualHrefs,
  businessHome,
}: {
  businessId: string;
  businessName: string;
  initialIntent: EventImportIntent | null;
  manualHrefs: Record<EventImportIntent, string>;
  businessHome: string;
}) {
  const [intent, setIntent] = useState<EventImportIntent | null>(initialIntent);
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>({ kind: "url", error: null });
  const [review, setReview] = useState<EventImportReview | null>(null);
  const [useImage, setUseImage] = useState(true);
  const [pastDates, setPastDates] = useState<ReviewOccurrence[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [saving, startSave] = useTransition();
  const urlRef = useRef<HTMLInputElement>(null);

  // ── How is the Business involved? (only when no entry point decided it) ──
  if (!intent) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="font-display text-page-title font-bold text-primary">Import an Event</h1>
          <p className="mt-1 text-body text-muted">Paste a link and Findmi fills in the details.</p>
        </header>
        <section aria-labelledby="involvement" className="flex flex-col gap-2">
          <h2 id="involvement" className="text-card-title font-semibold text-primary">
            How Is {businessName} Involved?
          </h2>
          {(["participating", "hosting"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setIntent(key)}
              className="flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-white p-3.5 text-left transition hover:border-findmi/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                <NavIcon name={key === "participating" ? "compass" : "calendar"} className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-card-title font-semibold text-primary">{INTENT_COPY[key].badge}</span>
                <span className="block text-metadata text-muted">
                  {key === "participating" ? "We’re participating in something someone else is organizing." : "We’re organizing or hosting this Event."}
                </span>
              </span>
            </button>
          ))}
        </section>
      </div>
    );
  }

  const copy = INTENT_COPY[intent];

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.invalid_url });
      return;
    }
    startAnalyze(async () => {
      try {
        const result = await analyzeEventImport(businessId, url);
        if (!result.ok) {
          setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY[result.code] });
          return;
        }
        const defaults = reviewDefaults(result.candidate, result.matches, intent!, businessName);
        setReview(defaults);
        setPastDates(pastReviewOccurrences(result.candidate, result.matches));
        setOpen(initiallyOpen(defaults.occurrences));
        setUseImage(Boolean(result.candidate.imageUrl));
        setSaveError(null);
        setStep({ kind: "review", candidate: result.candidate, matches: result.matches, warnings: result.warnings });
      } catch {
        setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.server });
      }
    });
  }

  function save() {
    if (!review) return;
    setSaveError(null);
    startSave(async () => {
      try {
        const outcome = await commitEventImport(businessId, { ...review, intent: intent!, imageUrl: useImage ? review.imageUrl : null });
        if (!outcome.ok) {
          setSaveError(outcome.error);
          return;
        }
        setStep({ kind: "done", message: successMessage(outcome.kind, outcome.title, businessName, intent!), viewHref: outcome.viewHref });
      } catch {
        setSaveError("Couldn’t save it. Please try again.");
      }
    });
  }

  function addAnother() {
    setUrl("");
    setReview(null);
    setSaveError(null);
    setStep({ kind: "url", error: null });
    requestAnimationFrame(() => urlRef.current?.focus());
  }

  const header = (
    <header>
      <h1 className="font-display text-page-title font-bold text-primary">{copy.title}</h1>
      <p className="mt-1 text-body text-muted">{copy.line}</p>
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-findmi-50 px-2.5 py-1 text-metadata font-semibold text-findmi-700">
        Adding To {businessName} · {copy.badge}
      </p>
    </header>
  );

  // ── Success ──
  if (step.kind === "done") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <section role="status" className="rounded-2xl border border-findmi/30 bg-findmi-50 p-4">
          <p className="text-card-title font-semibold text-findmi-700">{step.message}</p>
        </section>
        <div className="flex flex-col gap-2">
          <Link href={step.viewHref} className={primaryButtonClass}>
            View
          </Link>
          <button type="button" onClick={addAnother} className={secondaryButtonClass}>
            Add Another
          </button>
          <Link href={businessHome} className="py-2 text-center text-metadata font-semibold text-accent hover:underline">
            Back To {businessName}
          </Link>
        </div>
      </div>
    );
  }

  // ── Paste a link ──
  if (step.kind === "url" || !review) {
    const error = step.kind === "url" ? step.error : null;
    return (
      <div className="flex flex-col gap-4">
        {header}
        <form onSubmit={analyze} noValidate className={`${sectionClass} flex flex-col gap-3`}>
          <label htmlFor="event-link" className="text-card-title font-semibold text-primary">
            Import From Link
          </label>
          <p className="-mt-2 text-metadata text-muted">Paste the event&rsquo;s page, for example on Eventbrite, Luma or the organizer&rsquo;s website. You&rsquo;ll review everything before it&rsquo;s added.</p>
          <input
            ref={urlRef}
            id="event-link"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className={inputClass}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "event-link-error" : undefined}
            disabled={analyzing}
          />
          {error && (
            <p id="event-link-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-metadata text-red-700">
              {error}
            </p>
          )}
          <button type="submit" disabled={analyzing} className={primaryButtonClass}>
            {analyzing ? "Reading the Page…" : "Find Event Details"}
          </button>
        </form>
        <Link href={manualHrefs[intent]} className={secondaryButtonClass}>
          {intent === "hosting" ? "Create Manually" : "Add Manually"}
        </Link>
      </div>
    );
  }

  // ── Review ──
  const { matches, warnings, candidate } = step;
  const set = (patch: Partial<EventImportReview>) => setReview((r) => (r ? { ...r, ...patch } : r));
  const joiningExisting = intent === "participating" && Boolean(review.useEventId);
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
    <div className="flex flex-col gap-4">
      {header}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-2xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
          {warnings.map((w) => (
            <li key={w} className="text-metadata text-amber-900">
              {w}
            </li>
          ))}
        </ul>
      )}

      {/* Your Business — the relationship that will be created. */}
      <section aria-labelledby="your-business" className={sectionClass}>
        <h2 id="your-business" className="text-label font-bold uppercase text-subtle">
          Your Business
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-card-title font-semibold text-primary">
            {businessName} · {copy.badge}
          </p>
          <button
            type="button"
            onClick={() => {
              const next = intent === "hosting" ? "participating" : "hosting";
              setIntent(next);
              const defaults = reviewDefaults(candidate, matches, next, businessName);
              setReview(defaults);
              setPastDates(pastReviewOccurrences(candidate, matches));
              setOpen(initiallyOpen(defaults.occurrences));
            }}
            className="text-metadata font-semibold text-accent hover:underline"
          >
            {intent === "hosting" ? "We’re Participating Instead" : "We’re Hosting Instead"}
          </button>
        </div>
      </section>

      {/* Existing Findmi Event? */}
      {matches.event && (
        <section aria-labelledby="match-event" className={sectionClass}>
          <h2 id="match-event" className="text-label font-bold uppercase text-subtle">
            {matches.event.confidence === "strong" ? "Already on Findmi" : "Possible Match"}
          </h2>
          <p className="mt-1.5 text-card-title font-semibold text-primary">
            {matches.event.name}
          </p>
          <p className="text-metadata text-muted">
            {prettyDate(matches.event.startAt)}
            {matches.event.venueName ? ` · ${matches.event.venueName}` : ""}
            {matches.event.city ? ` · ${matches.event.city}` : ""}
          </p>
          <fieldset className="mt-3 flex flex-col gap-2">
            <legend className="sr-only">Is this the same Event?</legend>
            {intent === "participating" ? (
              <>
                <Choice checked={review.useEventId === matches.event.id} onChange={() => set({ useEventId: matches.event!.id })} title="Yes, It’s This Event" line="We’ll ask the organizer to confirm your Business." />
                <Choice checked={review.useEventId === null} onChange={() => set({ useEventId: null })} title="No, It’s Different" line="Add it to your schedule with the details below." />
              </>
            ) : matches.event.hostedByThisBusiness ? (
              <>
                <Choice checked={review.useEventId === matches.event.id} onChange={() => set({ useEventId: matches.event!.id })} title="Yes, It’s Our Event" line="It’s already on your schedule." />
                <Choice checked={review.useEventId === null} onChange={() => set({ useEventId: null })} title="No, It’s a Different Event" line="Create a new Event with the details below." />
              </>
            ) : (
              <>
                <Choice checked={review.useEventId === null} onChange={() => set({ useEventId: null })} title="It’s a Different Event" line="Create a new Event with the details below." />
                <Choice checked={review.useEventId === matches.event.id} onChange={() => set({ useEventId: matches.event!.id })} title="It’s This Event" line="Findmi will help connect it to your Business." />
              </>
            )}
          </fieldset>
        </section>
      )}

      {/* Event */}
      <section aria-labelledby="event-details" className={`${sectionClass} flex flex-col gap-3`}>
        <h2 id="event-details" className="text-label font-bold uppercase text-subtle">
          Event
        </h2>
        <div>
          <label htmlFor="title" className={labelClass}>
            Name
          </label>
          <input id="title" value={review.title} onChange={(e) => set({ title: e.target.value })} className={inputClass} autoCapitalize="words" maxLength={200} />
        </div>
        {!joiningExisting && (
          <div>
            <label htmlFor="description" className={labelClass}>
              Description
            </label>
            <textarea
              id="description"
              rows={4}
              value={review.description ?? ""}
              onChange={(e) => set({ description: e.target.value })}
              className={inputClass}
              autoCapitalize="sentences"
              maxLength={2000}
            />
          </div>
        )}
        {review.imageUrl && !joiningExisting && (
          <label className="flex items-center gap-2 text-metadata text-secondary">
            <input type="checkbox" checked={useImage} onChange={(e) => setUseImage(e.target.checked)} className="h-5 w-5 accent-findmi" />
            Use the event image from the page
          </label>
        )}
        <div>
          <label htmlFor="source" className={labelClass}>
            Event Link
          </label>
          <input id="source" type="url" inputMode="url" autoCapitalize="none" value={review.sourceUrl ?? ""} onChange={(e) => set({ sourceUrl: e.target.value })} className={inputClass} />
          {candidate.platform && <p className="mt-1 text-microcopy text-subtle">From {candidate.platform}</p>}
        </div>
      </section>

      {joiningExisting ? (
        <p className="rounded-2xl border border-black/[0.07] bg-white px-4 py-3 text-metadata text-muted">
          Dates and place come from the Event already on Findmi.
        </p>
      ) : (
        <>
          {/* When (& Where) — each date is reviewed with its own place. */}
          <section aria-labelledby="when" className={`${sectionClass} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="when" className="text-label font-bold uppercase text-subtle">
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
            <section aria-labelledby="where" className={`${sectionClass} flex flex-col gap-3`}>
              <h2 id="where" className="text-label font-bold uppercase text-subtle">
                Where
              </h2>
              <PlaceFields idPrefix="place" place={review.place} matches={matches} onChange={(patch) => set({ place: { ...review.place, ...patch } })} />
            </section>
          )}
        </>
      )}

      {/* Organizer */}
      <section aria-labelledby="organizer" className={sectionClass}>
        <h2 id="organizer" className="text-label font-bold uppercase text-subtle">
          Organizer
        </h2>
        <p className="mt-1.5 text-body text-primary">
          {intent === "hosting"
            ? businessName
            : matches.organizerBusiness
              ? `${matches.organizerBusiness.name} (on Findmi)`
              : (review.organizer ?? "Not listed on the page")}
        </p>
      </section>

      {matches.existingAppearance && !joiningExisting && (
        <p className="rounded-2xl border border-black/[0.07] bg-white px-4 py-3 text-metadata text-muted">
          Something similar is already on your schedule: <span className="font-semibold text-primary">{matches.existingAppearance.title}</span> ({prettyDate(matches.existingAppearance.startAt)}). Dates already on your schedule won&rsquo;t be added twice.
        </p>
      )}

      {saveError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-metadata text-red-700">
          {saveError}
        </p>
      )}
      <div className="flex flex-col gap-2 pb-4">
        <button type="button" onClick={save} disabled={saving} className={primaryButtonClass}>
          {saving ? "Adding…" : `Add To ${businessName}`}
        </button>
        <button type="button" onClick={addAnother} className="py-2 text-center text-metadata font-semibold text-accent hover:underline">
          Try Another Link
        </button>
        <Link href={manualHrefs[intent]} className="py-1 text-center text-metadata font-semibold text-muted hover:text-secondary">
          {intent === "hosting" ? "Create Manually Instead" : "Add Manually Instead"}
        </Link>
      </div>
    </div>
  );
}

function Choice({ checked, onChange, title, line }: { checked: boolean; onChange: () => void; title: string; line: string }) {
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
function initiallyOpen(rows: ReviewOccurrence[]): Set<string> {
  return new Set(rows.filter((d) => rows.length === 1 || !d.date || !d.startTime || !d.endTime).map((d) => d.id ?? ""));
}

function placeLine(p: ReviewPlace, matches: EventImportMatches): string {
  const loc = p.useLocationId ? matches.locations.find((l) => l.id === p.useLocationId) : null;
  if (loc) return [loc.name, loc.address].filter(Boolean).join(" · ");
  return [p.venueName, p.address].filter(Boolean).join(" · ");
}

function OccurrenceRow({
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

function PlaceFields({
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
