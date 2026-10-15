"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import { commitEventImportBatch } from "./actions";
import type { EventImportIntent, EventImportReview, ImportSource, ReviewOccurrence, SourceEventAnalysis } from "@/lib/event-import/types";
import { BATCH_STATUS_LABEL, applyCreatedLocation, batchItemStatus, datesMissingTime, batchSummary, decidePlace, defaultSelection, occurrenceSummary, persistNote, pastReviewOccurrences, reviewDateFor, reviewDefaults, withCreatedLocations, type BatchStatusKind, type ReviewCreatedLocation } from "@/lib/event-import/review";
import { EventCategoryEditor, EventFormatEditor, Choice, LocationMatchCard, WhenWhereEditor, inputClass, labelClass, sectionClass, type InlinePlaceAction } from "./ReviewParts";
import { businessEvidenceKey, eventBusinessEvidence, operatorImportSummary, operatorReviewDefaults, resolveStructuredTaxonomy, suggestedEventBusiness, type OperatorSessionStats } from "@/lib/event-import/operator";
import type { Category } from "@/lib/types";

/** Event Import V1C — a link that lists MANY distinct Events (an organizer
 * calendar, a venue's events page). Step 1: choose Events (upcoming ones,
 * not already on the schedule, are pre-chosen when participating). Step 2:
 * review them as a compact list — each Event keeps its own name, link,
 * image, dates and places, and is matched on its own; anything incomplete
 * is clearly marked and not added. Every Event goes through the same
 * validated save path as a single import. */

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "flex h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-findmi/40";

const STATUS_STYLE: Record<BatchStatusKind, string> = {
  ready: "bg-findmi-50 text-findmi-700",
  joins_existing: "bg-findmi-50 text-findmi-700",
  possible_match: "bg-amber-50 text-amber-800",
  needs_details: "bg-red-50 text-red-700",
};

function firstSummary(e: SourceEventAnalysis): { when: string; where: string; more: number } {
  const upcoming = e.candidate.occurrences.filter((o) => !o.past);
  const list = upcoming.length > 0 ? upcoming : e.candidate.occurrences;
  const o = list[0];
  if (!o) return { when: "Date not listed", where: "", more: 0 };
  const sum = occurrenceSummary(reviewDateFor(o));
  return { when: [sum.day, sum.time].filter(Boolean).join(" · ") || "Date not listed", where: [o.venue.name, o.venue.city].filter(Boolean).join(", "), more: list.length - 1 };
}

type Result = Awaited<ReturnType<typeof commitEventImportBatch>>;

export type OperatorBusiness = { id: string; name: string };

/** Admin Event Import (operator context): no initiating Business. Each
 * Event carries its OWN reviewed Business (or none), saved through the
 * caller's admin-authorized actions. Omitted by the Business importer,
 * whose behavior is unchanged. */
export interface OperatorImportMode {
  commit: (items: { review: EventImportReview; businessId: string | null }[]) => Promise<Result>;
  createLocation: InlinePlaceAction;
  /** Renders the searchable Business picker for one Event. `evidence` is
   * the Business the source names (for Quick Create); `onCreated` reports a
   * Business the operator just created there, offered to every other Event
   * in this Review naming the same Business. */
  renderBusinessPicker: (props: {
    id: string;
    initial: OperatorBusiness | null;
    evidence: string | null;
    /** "Business Website:" — read by the existing Brand Import. */
    website: string | null;
    onSelect: (b: OperatorBusiness | null) => void;
    onCreated: (b: OperatorBusiness) => void;
  }) => React.ReactNode;
  /** Renders the import's own evidence for one Event (Event Link status,
   * image, description, RSVP / tickets, other named Businesses,
   * programming) and — for an Event already on Findmi — Review Existing
   * Event. */
  renderEventDetails: (props: {
    id: string;
    candidate: SourceEventAnalysis["candidate"];
    review: EventImportReview;
    set: (patch: Partial<EventImportReview>) => void;
    existingEventId: string | null;
    business: OperatorBusiness | null;
  }) => React.ReactNode;
  /** The Events Found thumbnail for a source image URL — Admin renders only
   * a verified preview (never the remote URL; the page CSP blocks it). */
  renderThumbnail: (imageUrl: string) => React.ReactNode;
  doneHref: string;
  /** Businesses / Locations created and existing Events updated in this Review. */
  stats: OperatorSessionStats;
}

export default function MultiEventImport({
  businessId,
  businessName,
  intent,
  source,
  events,
  warnings,
  header,
  manualHref,
  businessHome,
  onTryAnother,
  categories,
  formats,
  operator,
}: {
  businessId: string;
  businessName: string;
  intent: EventImportIntent;
  source: ImportSource;
  events: SourceEventAnalysis[];
  warnings: string[];
  header: React.ReactNode;
  manualHref: string;
  businessHome: string;
  onTryAnother: () => void;
  /** Event Taxonomy V1 — the kind='event' categories (parents + children). */
  categories: Category[];
  /** Event Formats V1 — the kind='event_format' vocabulary. */
  formats: Category[];
  /** Admin Event Import only — see OperatorImportMode. */
  operator?: OperatorImportMode;
}) {
  const upcoming = events.filter((e) => !e.past);
  const pastEvents = events.filter((e) => e.past);
  const [phase, setPhase] = useState<"select" | "review" | "done">("select");
  // Participating: upcoming Events not already on the schedule start chosen.
  // Hosting: nothing is pre-chosen — a calendar listing an Event doesn't
  // mean this Business organizes it.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelection(events, intent)));
  const [showPast, setShowPast] = useState(false);
  const [reviews, setReviews] = useState<Record<string, EventImportReview>>({});
  // Operator only: each Event's own Business (never one for the batch).
  const [businessFor, setBusinessFor] = useState<Record<string, OperatorBusiness | null>>({});
  // Businesses created during this Review, by the source's Business name.
  const [createdBusinesses, setCreatedBusinesses] = useState<Record<string, OperatorBusiness>>({});
  const evidenceKeyOf = (e: SourceEventAnalysis) => businessEvidenceKey(eventBusinessEvidence(e.candidate));
  function onBusinessCreated(fromKey: string, b: OperatorBusiness) {
    const evKey = evidenceKeyOf(byKey.get(fromKey)!);
    if (evKey) setCreatedBusinesses((prev) => ({ ...prev, [evKey]: b }));
    setBusinessFor((prev) => {
      const next = { ...prev, [fromKey]: b };
      // Same Business named elsewhere in this batch, not yet linked → the same one.
      if (evKey) for (const e of events) if (e.key !== fromKey && !next[e.key] && evidenceKeyOf(e) === evKey) next[e.key] = b;
      return next;
    });
  }
  // Locations created (or chosen from duplicates) during this Review, by
  // place key — every Event at that same place resolves to the same one.
  const [createdLocations, setCreatedLocations] = useState<ReviewCreatedLocation[]>([]);
  const matchesOf = (e: SourceEventAnalysis) => withCreatedLocations(e.matches, createdLocations);
  function onLocationCreated(location: ReviewCreatedLocation) {
    setCreatedLocations((prev) => [...prev.filter((c) => c.key !== location.key), location]);
    setReviews((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = applyCreatedLocation(next[k], location);
      return next;
    });
  }
  const [initialPast, setInitialPast] = useState<Record<string, ReviewOccurrence[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ result: Extract<Result, { ok: true }>; skipped: number; existingRows: number } | null>(null);
  const [saving, startSave] = useTransition();

  const byKey = new Map(events.map((e) => [e.key, e]));
  const chosen = events.filter((e) => selected.has(e.key));
  const visible = showPast ? [...upcoming, ...pastEvents] : upcoming;

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function startReview() {
    // Build each chosen Event's own review once (edits are kept if the
    // Business goes back to the list).
    const nextReviews = { ...reviews };
    const nextPast = { ...initialPast };
    const nextBusiness = { ...businessFor };
    for (const e of chosen) {
      if (!nextReviews[e.key]) {
        nextReviews[e.key] = operator ? operatorReviewDefaults(e.candidate, e.matches, { categories, formats }) : reviewDefaults(e.candidate, e.matches, intent, businessName);
        nextPast[e.key] = pastReviewOccurrences(e.candidate, e.matches);
        if (operator) nextBusiness[e.key] = suggestedEventBusiness(e.matches) ?? createdBusinesses[evidenceKeyOf(e)] ?? null;
      }
    }
    setReviews(nextReviews);
    setBusinessFor(nextBusiness);
    setInitialPast(nextPast);
    setExpanded(null);
    setError(null);
    setPhase("review");
  }

  // Places across the chosen Events that Findmi may already have: each is
  // answered ONCE here for every Event at that place (any single Event can
  // still be changed when opened). Different places stay separate.
  const placeGroups = (() => {
    const groups = new Map<string, { key: string; venue: string; match: SourceEventAnalysis["matches"]["locations"][number]; events: Set<string>; decisions: Set<string> }>();
    for (const e of chosen) {
      const review = reviews[e.key];
      if (!review || review.useEventId) continue;
      const places = review.sharedPlace ? [review.place] : review.occurrences.map((o) => o.place);
      for (const p of places) {
        const match = p.matchKey ? matchesOf(e).locations.find((l) => l.key === p.matchKey) : undefined;
        if (!match || !p.matchKey) continue;
        const g = groups.get(p.matchKey) ?? { key: p.matchKey, venue: p.venueName ?? match.name, match, events: new Set<string>(), decisions: new Set<string>() };
        g.events.add(e.key);
        g.decisions.add(p.useLocationId === match.id ? "use" : p.matchDecision === "reject" ? "reject" : "none");
        groups.set(p.matchKey, g);
      }
    }
    return [...groups.values()];
  })();

  function decideForAll(matchKey: string, decision: "use" | "reject", locationId: string) {
    setReviews((prev) => {
      const next = { ...prev };
      for (const e of chosen) if (next[e.key]) next[e.key] = decidePlace(next[e.key], matchKey, decision, locationId);
      return next;
    });
  }

  const statusOf = (key: string) => batchItemStatus(reviews[key], matchesOf(byKey.get(key)!));
  const ready = chosen.filter((e) => reviews[e.key] && statusOf(e.key).kind !== "needs_details");
  const incomplete = chosen.length - ready.length;
  // Operator: an Event resolved as already on Findmi is updated only by its
  // own "Apply To Existing Event" — never counted or saved as a new Event.
  const existingRows = operator ? chosen.filter((e) => reviews[e.key]?.useEventId) : [];
  const toSave = operator ? ready.filter((e) => !reviews[e.key].useEventId) : ready;

  function save() {
    setError(null);
    startSave(async () => {
      try {
        const result = operator
          ? await operator.commit(toSave.map((e) => ({ review: reviews[e.key], businessId: businessFor[e.key]?.id ?? null })))
          : await commitEventImportBatch(
              businessId,
              ready.map((e) => reviews[e.key])
            );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOutcome({ result, skipped: incomplete, existingRows: existingRows.length });
        setPhase("done");
      } catch {
        setError("Couldn’t save them. Please try again.");
      }
    });
  }

  // ── Done ──
  if (phase === "done" && outcome) {
    const summary = batchSummary(outcome.result.results, outcome.skipped, operator ? "Findmi" : businessName);
    const group = (label: string, titles: string[]) =>
      titles.length > 0 && (
        <div>
          <p className="text-label font-bold uppercase text-subtle">
            {label} · {titles.length}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {titles.map((t, i) => (
              <li key={`${t}-${i}`} className="truncate text-metadata text-secondary">
                {t}
              </li>
            ))}
          </ul>
        </div>
      );
    if (operator) {
      const s = operatorImportSummary(outcome.result.results, outcome.existingRows, operator.stats);
      const rows: [string, number, string | null][] = [
        ["New Events", s.newEvents, null],
        ["Existing Events Reviewed / Skipped", s.existingEvents, null],
        ["Existing Events Updated", s.existingEventsUpdated, null],
        ["Businesses Created · Awaiting Review", s.businessesCreated, "/admin/businesses?published=pending_review"],
        ["Locations Created · Awaiting Review", s.locationsCreated, "/admin/locations?review=1"],
      ];
      return (
        <div className="flex flex-col gap-4">
          {header}
          <section role="status" className="flex flex-col gap-3 rounded-2xl border border-findmi/30 bg-findmi-50 p-4">
            <p className="text-card-title font-semibold text-findmi-700">Import Complete</p>
            <dl className="flex flex-col gap-1">
              {rows.map(([label, count]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 text-metadata">
                  <dt className="text-secondary">{label}</dt>
                  <dd className="font-bold tabular-nums text-primary">{count}</dd>
                </div>
              ))}
            </dl>
            {group("New Events", summary.added)}
            {summary.attention.length > 0 && (
              <div>
                <p className="text-label font-bold uppercase text-subtle">Not Saved · {summary.attention.length}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {summary.attention.map((a, i) => (
                    <li key={`${a.title}-${i}`} className="text-metadata text-red-700">
                      <span className="font-semibold">{a.title || "Untitled"}</span> — {a.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.skipped > 0 && (
              <p className="text-metadata text-muted">
                {summary.skipped} {summary.skipped === 1 ? "Event was" : "Events were"} skipped because details were missing.
              </p>
            )}
          </section>
          <div className="flex flex-col gap-2">
            <Link href={operator.doneHref} className={primaryButtonClass}>
              View Events
            </Link>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/admin/businesses?published=pending_review" className={secondaryButtonClass}>
                Review Businesses
              </Link>
              <Link href="/admin/locations?review=1" className={secondaryButtonClass}>
                Review Locations
              </Link>
            </div>
            <button type="button" onClick={onTryAnother} className={secondaryButtonClass}>
              Import More
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {header}
        <section role="status" className="flex flex-col gap-3 rounded-2xl border border-findmi/30 bg-findmi-50 p-4">
          <p className="text-card-title font-semibold text-findmi-700">{summary.headline}</p>
          {group("Added", summary.added)}
          {group("Requests Sent", summary.connected)}
          {group(operator ? "Already on Findmi" : "Already on Your Schedule", summary.already)}
          {summary.attention.length > 0 && (
            <div>
              <p className="text-label font-bold uppercase text-subtle">Needs Attention · {summary.attention.length}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {summary.attention.map((a, i) => (
                  <li key={`${a.title}-${i}`} className="text-metadata text-red-700">
                    <span className="font-semibold">{a.title || "Untitled"}</span> — {a.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.skipped > 0 && (
            <p className="text-metadata text-muted">
              {summary.skipped} {summary.skipped === 1 ? "Event was" : "Events were"} skipped because details were missing.
            </p>
          )}
        </section>
        <div className="flex flex-col gap-2">
          <Link href={`${businessHome}?tab=findmi-here`} className={primaryButtonClass}>
            View Schedule
          </Link>
          <button type="button" onClick={onTryAnother} className={secondaryButtonClass}>
            Import More
          </button>
          <Link href={businessHome} className="py-2 text-center text-metadata font-semibold text-accent hover:underline">
            Back To {businessName}
          </Link>
        </div>
      </div>
    );
  }

  // ── Step 2: review the chosen Events ──
  if (phase === "review") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <section aria-labelledby="batch-review" className={`${sectionClass} flex flex-col gap-3`}>
          <div>
            <h2 id="batch-review" className="text-label font-bold uppercase text-subtle">
              Review {chosen.length} {chosen.length === 1 ? "Event" : "Events"}
            </h2>
            <p className="mt-1 text-metadata text-muted">
              {operator
                ? "Tap an Event to check or edit it. Each is added to Findmi on its own, with its own Business. Findmi is never shown as the organizer."
                : `Tap an Event to check or edit it. Each is added to ${businessName} on its own.`}
            </p>
          </div>
          {placeGroups.length > 0 && (
            <div aria-labelledby="batch-places" className="flex flex-col gap-2">
              <h3 id="batch-places" className="text-label font-bold uppercase text-subtle">
                Places
              </h3>
              <p className="-mt-1 text-metadata text-muted">Confirm each place once — it applies to every Event there.</p>
              {placeGroups.map((g) => {
                const decision = g.decisions.size === 1 ? ([...g.decisions][0] as "use" | "reject" | "none") : "mixed";
                return (
                  <div key={g.key}>
                    <LocationMatchCard
                      match={g.match}
                      decision={decision === "use" || decision === "reject" ? decision : null}
                      onDecide={(d) => decideForAll(g.key, d, g.match.id)}
                      pageText={`The page says “${g.venue}” · ${g.events.size} ${g.events.size === 1 ? "Event" : "Events"}`}
                    />
                    {decision === "mixed" && <p className="mt-1 text-microcopy text-muted">Some Events are set differently. Choosing here sets them all.</p>}
                  </div>
                );
              })}
            </div>
          )}
          <ol className="flex flex-col gap-2">
            {chosen.map((e) => {
              const review = reviews[e.key];
              if (!review) return null;
              const status = statusOf(e.key);
              const isOpen = expanded === e.key;
              const sum = review.occurrences[0] ? occurrenceSummary(review.occurrences[0]) : null;
              const set = (patch: Partial<EventImportReview>) => setReviews((prev) => ({ ...prev, [e.key]: { ...prev[e.key], ...patch } }));
              const match = e.matches.event;
              const joining = Boolean(review.useEventId);
              function setIntent(k: EventImportIntent) {
                // Hosting never takes over another organizer's Event.
                set({ intent: k, useEventId: k === "hosting" && match && !match.hostedByThisBusiness ? null : review.useEventId });
              }
              return (
                <li key={e.key} className="rounded-xl border border-black/[0.08] bg-white">
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <button type="button" onClick={() => setExpanded(isOpen ? null : e.key)} aria-expanded={isOpen} aria-controls={`batch-${e.key}`} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-body font-semibold text-primary">{review.title || "Untitled Event"}</span>
                        <span className="block text-metadata text-secondary">
                          {joining ? "Dates from the Event on Findmi" : sum ? [sum.day, sum.time].filter(Boolean).join(" · ") || "Add a date" : "Add a date"}
                          {!joining && review.occurrences.length > 1 ? ` · +${review.occurrences.length - 1} more` : ""}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-microcopy font-semibold ${STATUS_STYLE[status.kind]}`}>{BATCH_STATUS_LABEL[status.kind]}</span>
                          {operator ? (
                            <span className="inline-flex max-w-full truncate rounded-full bg-black/[0.05] px-2 py-0.5 text-microcopy font-semibold text-secondary">
                              {joining ? "Already on Findmi" : businessFor[e.key] ? `Business: ${businessFor[e.key]!.name}` : "No Business Linked"}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-black/[0.05] px-2 py-0.5 text-microcopy font-semibold text-secondary">{persistNote(review, businessName).label}</span>
                          )}
                        </span>
                        {status.missing.length > 0 && (
                          <span className="mt-0.5 block text-microcopy text-red-700">
                            Missing: {status.missing.map((m) => (m === "Start and end time" ? `Start and end time (${datesMissingTime(review).join(", ")})` : m)).join(", ")}
                          </span>
                        )}
                      </span>
                      <ChevronIcon direction={isOpen ? "up" : "down"} className="mt-1 h-4 w-4 shrink-0 text-subtle" />
                    </button>
                    <button type="button" onClick={() => toggle(e.key, false)} aria-label={`Remove ${review.title || "this Event"}`} className="shrink-0 py-0.5 text-metadata font-semibold text-muted hover:text-red-600">
                      Remove
                    </button>
                  </div>
                  {isOpen && (
                    <div id={`batch-${e.key}`} className="flex flex-col gap-3 border-t border-black/[0.05] px-3 pb-3 pt-2.5">
                      {operator ? (
                        (
                          <div>
                            {operator.renderBusinessPicker({
                              id: `batch-${e.key}-business`,
                              initial: businessFor[e.key] ?? null,
                              evidence: eventBusinessEvidence(e.candidate),
                              website: e.candidate.structured?.businessWebsite ?? null,
                              onSelect: (b) => setBusinessFor((prev) => ({ ...prev, [e.key]: b })),
                              onCreated: (b) => onBusinessCreated(e.key, b),
                            })}
                            <p className="mt-1 text-microcopy text-muted">
                              {businessFor[e.key]
                                ? `${businessFor[e.key]!.name} is shown at this Event (Who You’ll Find Here). It isn’t made the host.`
                                : `No Business is linked. ${review.organizer ? `The source’s organizer, “${review.organizer}”, is kept as text only.` : "Choose one only if the source names it."}`}
                            </p>
                            {e.candidate.structured &&
                              (() => {
                                const open = resolveStructuredTaxonomy(e.candidate.structured, categories, formats).unresolved;
                                return open.length > 0 ? <p className="mt-1 text-microcopy text-amber-900">Not a Findmi Category or Format: {open.join(", ")}. Choose one below.</p> : null;
                              })()}
                          </div>
                        )
                      ) : (
                      <>
                      <p className="text-metadata text-muted">{persistNote(review, businessName).line}</p>
                      <div>
                        <span className={labelClass}>{businessName} Is</span>
                        <div role="radiogroup" aria-label={`How ${businessName} is involved`} className="grid grid-cols-2 gap-1 rounded-lg bg-black/[0.04] p-0.5">
                          {(["participating", "hosting"] as const).map((k) => (
                            <label key={k} className={`flex h-8 cursor-pointer items-center justify-center rounded-md text-metadata font-semibold transition ${review.intent === k ? "bg-white text-primary shadow-sm" : "text-muted"}`}>
                              <input type="radio" className="sr-only" checked={review.intent === k} onChange={setIntent.bind(null, k)} />
                              {k === "participating" ? "Participating" : "Hosting"}
                            </label>
                          ))}
                        </div>
                      </div>
                      </>
                      )}
                      {match && (review.intent === "participating" || match.hostedByThisBusiness) && (
                        <fieldset className="flex flex-col gap-2">
                          <legend className="mb-1 text-metadata text-secondary">
                            {match.confidence === "strong" ? "Already on Findmi: " : "Possibly on Findmi: "}
                            <span className="font-semibold text-primary">{match.name}</span>
                          </legend>
                          <Choice checked={review.useEventId === match.id} onChange={() => set({ useEventId: match.id })} title="Yes, It’s This Event" line={operator ? "No copy is added. Review what this import can add to it below." : review.intent === "participating" ? "We’ll ask the organizer to confirm your Business." : "It’s already on your schedule."} />
                          <Choice checked={review.useEventId === null} onChange={() => set({ useEventId: null })} title="No, It’s Different" line="Add it with the details below." />
                        </fieldset>
                      )}
                      <div>
                        <label htmlFor={`batch-${e.key}-title`} className={labelClass}>
                          Name
                        </label>
                        <input id={`batch-${e.key}-title`} value={review.title} onChange={(ev) => set({ title: ev.target.value })} className={inputClass} autoCapitalize="words" maxLength={200} />
                      </div>
                      <div>
                        <label htmlFor={`batch-${e.key}-link`} className={labelClass}>
                          Event Link
                        </label>
                        <input id={`batch-${e.key}-link`} type="url" inputMode="url" autoCapitalize="none" value={review.sourceUrl ?? ""} onChange={(ev) => set({ sourceUrl: ev.target.value })} className={inputClass} />
                      </div>
                      {!joining && (
                        <WhenWhereEditor
                          review={review}
                          set={set}
                          matches={matchesOf(e)}
                          initialPast={initialPast[e.key] ?? []}
                          idPrefix={`batch-${e.key}-`}
                          quickCreate={{ online: Boolean(e.candidate.online), onCreated: onLocationCreated, createAction: operator?.createLocation }}
                        />
                      )}
                      {(!joining || operator) && (review.intent === "hosting" || review.asEvent) && <EventCategoryEditor categories={categories} review={review} set={set} />}
                      {(!joining || operator) && (review.intent === "hosting" || review.asEvent) && <EventFormatEditor formats={formats} review={review} set={set} />}
                      {operator?.renderEventDetails({
                        id: `batch-${e.key}`,
                        candidate: e.candidate,
                        review,
                        set,
                        existingEventId: joining ? review.useEventId : null,
                        business: businessFor[e.key] ?? null,
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-metadata text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 pb-4">
          {incomplete > 0 && (
            <p className="text-center text-metadata text-muted">
              {incomplete} {incomplete === 1 ? "Event needs" : "Events need"} details and won&rsquo;t be added until completed.
            </p>
          )}
          {existingRows.length > 0 && (
            <p className="text-center text-metadata text-muted">
              {existingRows.length} {existingRows.length === 1 ? "Existing Event is" : "Existing Events are"} already on Findmi — update {existingRows.length === 1 ? "it" : "each"} with Apply To Existing Event. {existingRows.length === 1 ? "It isn’t" : "They aren’t"} added again.
            </p>
          )}
          <button type="button" onClick={save} disabled={saving || toSave.length === 0} className={primaryButtonClass}>
            {saving
              ? "Adding…"
              : operator
                ? toSave.length === 0
                  ? "No New Events To Add"
                  : `Add ${toSave.length} New ${toSave.length === 1 ? "Event" : "Events"}`
                : `Add ${ready.length} ${ready.length === 1 ? "Event" : "Events"}`}
          </button>
          <button type="button" onClick={() => setPhase("select")} className="py-2 text-center text-metadata font-semibold text-accent hover:underline">
            Back To Events
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: choose Events ──
  return (
    <div className="flex flex-col gap-4">
      {header}
      <section aria-labelledby="events-found" className={`${sectionClass} flex flex-col gap-3`}>
        <div>
          <h2 id="events-found" className="text-label font-bold uppercase text-subtle">
            Events Found
          </h2>
          <p className="mt-1 text-body text-primary">
            We found {upcoming.length} upcoming {upcoming.length === 1 ? "Event" : "Events"}
            {source.name ? ` from ${source.name}` : " from this page"}.
          </p>
          {warnings.map((w) => (
            <p key={w} className="mt-1 text-metadata text-amber-900">
              {w}
            </p>
          ))}
        </div>
        {intent === "hosting" && (
          <p className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-3 py-2 text-metadata text-amber-900">
            These will be added as Events {businessName} hosts. Only choose Events {businessName} organizes.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={() => setSelected(new Set(visible.filter((e) => !e.alreadyOnSchedule).map((e) => e.key)))} className="text-metadata font-semibold text-accent hover:underline">
            Select All
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-metadata font-semibold text-accent hover:underline">
            Clear All
          </button>
          <span className="ml-auto text-metadata text-muted">{selected.size} Selected</span>
        </div>
        <ul className="flex flex-col gap-2">
          {visible.map((e) => {
            const s = firstSummary(e);
            const checked = selected.has(e.key);
            const match = e.matches.event;
            return (
              <li key={e.key}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${checked ? "border-findmi/50 bg-findmi-50/40" : "border-black/[0.08] bg-white"}`}>
                  <input type="checkbox" checked={checked} onChange={(ev) => toggle(e.key, ev.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-findmi" aria-label={e.candidate.title ?? "Event"} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-body font-semibold text-primary">{e.candidate.title}</span>
                    <span className="block text-metadata text-secondary">
                      {s.when}
                      {s.more > 0 ? ` · +${s.more} more ${s.more === 1 ? "date" : "dates"}` : ""}
                    </span>
                    {s.where && <span className="block truncate text-metadata text-muted">{s.where}</span>}
                    {(e.alreadyOnSchedule || match || e.past) && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {e.alreadyOnSchedule && <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-microcopy font-semibold text-secondary">On Your Schedule</span>}
                        {match && !e.alreadyOnSchedule && (
                          <span className={`rounded-full px-2 py-0.5 text-microcopy font-semibold ${match.confidence === "strong" ? "bg-findmi-50 text-findmi-700" : "bg-amber-50 text-amber-800"}`}>
                            {match.confidence === "strong" ? "Already on Findmi" : "Possible Match"}
                          </span>
                        )}
                        {e.past && <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-microcopy font-semibold text-muted">Past</span>}
                      </span>
                    )}
                  </span>
                  {e.candidate.imageUrl &&
                    (operator ? (
                      operator.renderThumbnail(e.candidate.imageUrl)
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- remote event-page image, preview only
                      <img src={e.candidate.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-lg bg-black/[0.04] object-cover" />
                    ))}
                </label>
              </li>
            );
          })}
        </ul>
        {pastEvents.length > 0 && (
          <button type="button" onClick={() => setShowPast((v) => !v)} className="w-fit text-metadata font-semibold text-secondary hover:text-primary">
            {showPast ? "Hide Past Events" : `Show Past Events (${pastEvents.length})`}
          </button>
        )}
      </section>
      <div className="flex flex-col gap-2 pb-4">
        <button type="button" onClick={startReview} disabled={selected.size === 0} className={primaryButtonClass}>
          Review Selected ({selected.size})
        </button>
        <button type="button" onClick={onTryAnother} className="py-2 text-center text-metadata font-semibold text-accent hover:underline">
          {operator ? "Start Over" : "Try Another Link"}
        </button>
        <Link href={manualHref} className="py-1 text-center text-metadata font-semibold text-muted hover:text-secondary">
          {intent === "hosting" ? "Create Manually Instead" : "Add Manually Instead"}
        </Link>
      </div>
    </div>
  );
}
