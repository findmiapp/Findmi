"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { analyzeEventImport, analyzeEventImportImage, analyzeEventImportText, commitEventImport } from "./actions";
import MultiEventImport from "./MultiEventImport";
import { EVENT_DESCRIPTION_MAX } from "@/lib/event-import/description";
import { AttendanceEditor, Choice, WhenWhereEditor, inputClass, labelClass, sectionClass } from "./ReviewParts";
import {
  EVENT_IMPORT_FAILURE_COPY,
  EVENT_IMPORT_IMAGE_ACCEPT,
  EVENT_IMPORT_IMAGE_MAX_BYTES,
  type EventCandidate,
  type EventImportAnalysis,
  type EventImportIntent,
  type EventImportMatches,
  type EventImportReview,
  type ImportSource,
  type ReviewOccurrence,
  type SourceEventAnalysis,
} from "@/lib/event-import/types";
import { pastReviewOccurrences, persistNote, reviewDefaults, successMessage } from "@/lib/event-import/review";

/** Event Import V1 — Business importer: a link, pasted details or an
 * uploaded flyer/screenshot → Findmi reads it →
 * Review (everything editable, existing Findmi records clearly marked) →
 * Add. Nothing is saved before the Business confirms Review.
 *
 * V1B: each date is reviewed together with its own place. When every date
 * shares one place there is a single Where section; when places differ the
 * dates become compact "When & Where" rows (date · time · place at a
 * glance, tap to edit).
 *
 * V1C: a link that lists many distinct Events (an organizer calendar)
 * opens the several-Events flow instead (MultiEventImport) — never just
 * its first Event.
 *
 * Unified Import: From Link / Paste Details / Upload are three INPUTS to the
 * same engine — each returns the same analysis, reviewed here with the same
 * Review and saved through the same commit. */

type ImportMethod = "link" | "text" | "image";
const METHODS: { key: ImportMethod; label: string }[] = [
  { key: "link", label: "From Link" },
  { key: "text", label: "Paste Details" },
  { key: "image", label: "Upload" },
];
const PASTE_MAX = 12000;

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "flex h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-findmi/40";

const INTENT_COPY: Record<EventImportIntent, { title: string; line: string; badge: string }> = {
  participating: { title: "Where I’ll Be", line: "Add something your Business is participating in.", badge: "Participating" },
  hosting: { title: "Host an Event", line: "Create something your Business is organizing.", badge: "Hosting" },
};

type Step =
  | { kind: "url"; error: string | null }
  | { kind: "review"; candidate: EventCandidate; matches: EventImportMatches; warnings: string[] }
  | { kind: "multi"; source: ImportSource; events: SourceEventAnalysis[]; warnings: string[] }
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
  const [method, setMethod] = useState<ImportMethod>("link");
  const [pasted, setPasted] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: "url", error: null });
  const [review, setReview] = useState<EventImportReview | null>(null);
  const [useImage, setUseImage] = useState(true);
  const [initialPast, setInitialPast] = useState<ReviewOccurrence[]>([]);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [saving, startSave] = useTransition();
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The local preview of a chosen image (never uploaded anywhere but the
  // one analysis request). A data: URL — the site's CSP allows data: images,
  // not blob:.
  useEffect(() => {
    setImagePreview(null);
    if (!imageFile) return;
    let live = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (live && typeof reader.result === "string") setImagePreview(reader.result);
    };
    reader.readAsDataURL(imageFile);
    return () => {
      live = false;
      reader.abort();
    };
  }, [imageFile]);

  // ── How is the Business involved? (only when no entry point decided it) ──
  if (!intent) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="font-display text-page-title font-bold text-primary">Import an Event</h1>
          <p className="mt-1 text-body text-muted">Add a link, paste the details or upload a flyer, and Findmi fills in the details.</p>
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

  /** Every input method lands here: the same analysis → the same Review. */
  function showAnalysis(result: EventImportAnalysis) {
    if (!result.ok) {
      setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY[result.code] });
      return;
    }
    if (result.kind === "multi") {
      setReview(null);
      setSaveError(null);
      setStep({ kind: "multi", source: result.source, events: result.events, warnings: result.warnings });
      return;
    }
    const defaults = reviewDefaults(result.candidate, result.matches, intent!, businessName);
    setReview(defaults);
    setInitialPast(pastReviewOccurrences(result.candidate, result.matches));
    setReviewVersion((v) => v + 1);
    setUseImage(Boolean(result.candidate.imageUrl));
    setSaveError(null);
    setStep({ kind: "review", candidate: result.candidate, matches: result.matches, warnings: result.warnings });
  }

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (method === "link" && !url.trim()) {
      setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.invalid_url });
      return;
    }
    if (method === "text" && !pasted.trim()) {
      setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.text_no_event });
      return;
    }
    if (method === "image" && !imageFile) {
      setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.unsupported_image });
      return;
    }
    startAnalyze(async () => {
      try {
        if (method === "link") showAnalysis(await analyzeEventImport(businessId, url));
        else if (method === "text") showAnalysis(await analyzeEventImportText(businessId, pasted));
        else {
          const form = new FormData();
          form.append("image", imageFile!);
          showAnalysis(await analyzeEventImportImage(businessId, form));
        }
      } catch {
        setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.server });
      }
    });
  }

  function chooseMethod(next: ImportMethod) {
    setMethod(next);
    setStep({ kind: "url", error: null });
  }

  function chooseImage(file: File | null) {
    if (!file) return;
    // Quick checks here; the server re-checks the real bytes.
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setImageFile(null);
      setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.unsupported_image });
      return;
    }
    if (file.size > EVENT_IMPORT_IMAGE_MAX_BYTES) {
      setImageFile(null);
      setStep({ kind: "url", error: EVENT_IMPORT_FAILURE_COPY.image_too_large });
      return;
    }
    setImageFile(file);
    setStep({ kind: "url", error: null });
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
        setStep({ kind: "done", message: successMessage(outcome.kind, outcome.title, businessName, intent!, outcome.kind === "scheduled" && outcome.newEvent === true), viewHref: outcome.viewHref });
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
    setPasted("");
    setImageFile(null);
    requestAnimationFrame(() => (method === "link" ? urlRef.current?.focus() : undefined));
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

  // ── Several Events from one link ──
  if (step.kind === "multi") {
    return (
      <MultiEventImport
        key={step.source.url}
        businessId={businessId}
        businessName={businessName}
        intent={intent}
        source={step.source}
        events={step.events}
        warnings={step.warnings}
        header={header}
        manualHref={manualHrefs[intent]}
        businessHome={businessHome}
        onTryAnother={addAnother}
      />
    );
  }

  // ── Import Event: From Link / Paste Details / Upload ──
  if (step.kind === "url" || !review) {
    const error = step.kind === "url" ? step.error : null;
    const errorId = "event-import-error";
    return (
      <div className="flex flex-col gap-4">
        {header}
        <form onSubmit={analyze} noValidate className={`${sectionClass} flex flex-col gap-3`}>
          <h2 className="text-card-title font-semibold text-primary">Import Event</h2>
          <div role="group" aria-label="How to import" className="grid grid-cols-3 gap-1 rounded-xl bg-black/[0.04] p-1">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={method === m.key}
                onClick={() => chooseMethod(m.key)}
                disabled={analyzing}
                className={`h-10 min-w-0 truncate rounded-lg px-1 text-metadata font-semibold transition ${
                  method === m.key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-secondary"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {method === "link" && (
            <>
              <label htmlFor="event-link" className="sr-only">
                Event Link
              </label>
              <p className="text-metadata text-muted">Paste the event&rsquo;s page, for example on Eventbrite, Luma or the organizer&rsquo;s website. You&rsquo;ll review everything before it&rsquo;s added.</p>
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
                aria-describedby={error ? errorId : undefined}
                disabled={analyzing}
              />
            </>
          )}

          {method === "text" && (
            <>
              <label htmlFor="event-details" className="text-metadata text-muted">
                Paste the event details from a caption, email, newsletter or listing. Include the name, date, time and place if you have them.
              </label>
              <textarea
                id="event-details"
                rows={9}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                maxLength={PASTE_MAX}
                autoCapitalize="sentences"
                placeholder={"Event name\nDate and time\nVenue and address\n\nDescription…"}
                className={`${inputClass} min-h-[12rem] resize-y`}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                disabled={analyzing}
              />
            </>
          )}

          {method === "image" && (
            <>
              <p className="text-metadata text-muted">Upload a flyer, invitation or screenshot. Findmi reads the event details from it. The image is only used to read the details.</p>
              <input
                ref={fileRef}
                id="event-image"
                type="file"
                accept={EVENT_IMPORT_IMAGE_ACCEPT}
                onChange={(e) => {
                  chooseImage(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
                className="sr-only"
                disabled={analyzing}
              />
              <label
                htmlFor="event-image"
                aria-describedby={error ? errorId : undefined}
                className="flex min-h-[9rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-findmi/40 bg-findmi-50/40 p-4 text-center transition hover:border-findmi"
              >
                {imagePreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
                  <img src={imagePreview} alt="Chosen image" className="max-h-56 w-auto max-w-full rounded-xl object-contain" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-findmi-700">
                    <NavIcon name="calendar" className="h-6 w-6" />
                  </span>
                )}
                <span className="text-body font-semibold text-primary">{imageFile ? "Choose a Different Image" : "Choose an Image"}</span>
                <span className="max-w-full truncate text-microcopy text-subtle">{imageFile ? imageFile.name : "JPG, PNG or WebP · up to 5MB"}</span>
              </label>
            </>
          )}

          {error && (
            <p id={errorId} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-metadata text-red-700">
              {error}
            </p>
          )}
          <button type="submit" disabled={analyzing} className={primaryButtonClass}>
            {analyzing ? (method === "link" ? "Reading the Page…" : method === "text" ? "Reading the Details…" : "Reading the Image…") : "Find Event Details"}
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
              setInitialPast(pastReviewOccurrences(candidate, matches));
              setReviewVersion((v) => v + 1);
            }}
            className="text-metadata font-semibold text-accent hover:underline"
          >
            {intent === "hosting" ? "We’re Participating Instead" : "We’re Hosting Instead"}
          </button>
        </div>
        {/* How this will be saved — Business words, never database ones. */}
        <p className="mt-1.5 text-metadata text-muted">{persistNote(review, businessName).line}</p>
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
              maxLength={EVENT_DESCRIPTION_MAX}
            />
          </div>
        )}
        {candidate.origin === "image" && !joiningExisting && (
          <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-metadata text-muted">
            Your uploaded image was only used to read these details. It won&rsquo;t be shown as the Event image.
          </p>
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
          <WhenWhereEditor key={reviewVersion} review={review} set={set} matches={matches} initialPast={initialPast} />
          {/* Attendance is saved with a NEW Event (hosting, or a genuine
              Event the Business takes part in) — never on a plain schedule item. */}
          {(intent === "hosting" || review.asEvent) && <AttendanceEditor review={review} set={set} evidence={candidate.attendance} />}
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
              : (review.organizer ?? (candidate.origin === "text" || candidate.origin === "image" ? "Not listed" : "Not listed on the page"))}
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
          {candidate.origin === "text" || candidate.origin === "image" ? "Start Over" : "Try Another Link"}
        </button>
        <Link href={manualHrefs[intent]} className="py-1 text-center text-metadata font-semibold text-muted hover:text-secondary">
          {intent === "hosting" ? "Create Manually Instead" : "Add Manually Instead"}
        </Link>
      </div>
    </div>
  );
}
