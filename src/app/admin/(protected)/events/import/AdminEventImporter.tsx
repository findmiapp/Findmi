"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import MultiEventImport, { type OperatorBusiness, type OperatorImportMode } from "@/app/(public)/account/business/[id]/import-event/MultiEventImport";
import { AttendanceEditor, inputClass, sectionClass } from "@/app/(public)/account/business/[id]/import-event/ReviewParts";
import { RelationField } from "@/components/admin/RelationPicker";
import { EVENT_IMPORT_FAILURE_COPY, type EventImportAnalysis, type EventImportReview, type ImportSource, type SourceEventAnalysis } from "@/lib/event-import/types";
import { EVENT_DESCRIPTION_MAX } from "@/lib/event-import/description";
import { fillReviewGaps, operatorReviewDefaults, segmentTextByKey } from "@/lib/event-import/operator";
import { safePreviewSrc, type ImagePreviewState } from "@/lib/event-import/preview-src";
import { ImagePreviewView } from "./preview-view";
import { runWithConcurrency } from "@/lib/admin/brand-import-runner";
import type { Category } from "@/lib/types";
import {
  adminAnalyzeEventText,
  adminAnalyzeEventUrl,
  adminApplyExistingEvent,
  adminCommitEventImportBatch,
  adminCompareExistingEvent,
  adminCreateBusinessFromRead,
  adminCreateImportBusiness,
  adminCreateImportLocation,
  adminEnrichPastedEvent,
  adminLoadBusinessRead,
  adminPreviewBusinessRead,
  adminPreviewEventImage,
  adminProcessBusinessRead,
  adminStartBusinessReads,
  type BusinessReadView,
} from "./actions";

/** Admin Event Import — the operator orchestration over Findmi's existing
 * import systems:
 *   paste (one Event, or up to 25 marked EVENT n … === END EVENT n ===)
 *   → structured reading (instant, no network)
 *   → each Event's own Event Link read by the existing Event URL importer,
 *     one request per Event, a few at a time (explicit values win)
 *   → each missing Business's website read by the existing Brand Import
 *     (match first; name, description, logo, cover, category), two at a time
 *   → the existing several-Events Review (operator mode): Business per
 *     Event (match, Create & Review Business, or minimal Quick Create),
 *     Location matching + Quick Create, Category / Formats, and Review
 *     Existing Event for Events already on Findmi.
 * Nothing is created before Admin confirms it in Review. */

type Method = "text" | "link";
const PASTE_MAX = 60000;
/** This tab's in-progress paste (sessionStorage — cleared with the tab). */
const PASTE_DRAFT_KEY = "findmi:admin-event-import:paste";
/** Event Link reads in flight at once (each is its own bounded request). */
const EVENT_SOURCE_CONCURRENCY = 3;
/** Business website reads in flight (Brand Import's own runner setting). */
const BUSINESS_READ_CONCURRENCY = 2;
const PENDING_READ = new Set(["queued", "processing"]);

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";
const smallPrimary = "rounded-lg bg-findmi px-3 py-2 text-metadata font-bold text-white disabled:opacity-60";
const labelText = "text-metadata font-semibold text-secondary";

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).host.replace(/^www\./, "") : "";
  } catch {
    return url ?? "";
  }
};

// ── What this Review actually created (for Import Complete) ──────────────
// Recorded ONLY where a creation succeeded — choosing an existing Business
// or Location ("Use This …", a website match) is never counted.
type RecordKind = "business" | "location" | "event";
const RecordContext = createContext<(kind: RecordKind, id: string) => void>(() => {});
type CreatedRecords = Record<RecordKind, Record<string, true>>;
const NO_RECORDS: CreatedRecords = { business: {}, location: {}, event: {} };

// ── Image previews ─────────────────────────────────────────────────────────
// The page's CSP only allows Findmi's own / data: images, so a third-party
// image URL never renders directly. Previews come from the server as small
// re-encoded data URIs of images that passed the SAME verification the save
// path uses. A preview is display only: nothing is stored until save, and
// the save path verifies the image again.

const eventPreviewCache = new Map<string, ImagePreviewState>();
const PREVIEW_REASON: Record<string, string> = {
  fetch_failed: "the image couldn’t be fetched",
  invalid_file: "it isn’t a valid image file",
  type_mismatch: "it isn’t a supported image type",
  unreadable: "the image couldn’t be read",
  unsuitable: "it’s too small or the wrong shape for an Event image",
  preview_failed: "the preview couldn’t be made",
};

/** At most this many preview requests at once (a 25-Event list asks for
 * up to 25 thumbnails; each is a bounded server fetch + verification). */
const PREVIEW_CONCURRENCY = 3;
let previewsInFlight = 0;
const previewQueue: (() => void)[] = [];
async function limitedPreview(url: string): Promise<ImagePreviewState> {
  if (previewsInFlight >= PREVIEW_CONCURRENCY) await new Promise<void>((resolve) => previewQueue.push(resolve));
  previewsInFlight += 1;
  try {
    const r = await adminPreviewEventImage(url);
    const src = safePreviewSrc(r.preview);
    return src ? { status: "ok", src } : { status: "failed", reason: PREVIEW_REASON[r.reason ?? "preview_failed"] ?? "unavailable" };
  } catch {
    return { status: "failed", reason: PREVIEW_REASON.fetch_failed };
  } finally {
    previewsInFlight -= 1;
    previewQueue.shift()?.();
  }
}

/** A source Event image in Admin Review: ONLY the server-made, verified
 * data-URI preview reaches the browser (never `url` itself — that stays
 * persistence input for recoverEventImage). */
function VerifiedEventImagePreview({ url, className, compact = false }: { url: string; className: string; compact?: boolean }) {
  const [state, setState] = useState<ImagePreviewState>(() => eventPreviewCache.get(url) ?? { status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const cached = eventPreviewCache.get(url);
    if (cached && cached.status !== "loading") {
      setState(cached);
      return;
    }
    setState({ status: "loading" });
    eventPreviewCache.set(url, { status: "loading" });
    limitedPreview(url).then((next) => {
      eventPreviewCache.set(url, next);
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url, attempt]);
  return (
    <ImagePreviewView
      onRetry={() => {
        eventPreviewCache.delete(url);
        setAttempt((n) => n + 1);
      }}
      state={state}
      className={className}
      alt="Event image preview"
      compact={compact}
      onError={() => {
        const failed: ImagePreviewState = { status: "failed", reason: "the preview couldn’t be displayed" };
        eventPreviewCache.set(url, failed);
        setState(failed);
      }}
    />
  );
}

// ── Business ───────────────────────────────────────────────────────────────

/** Missing-Business Quick Create without a website: the minimal record. */
function QuickCreateBusiness({ idPrefix, evidence, onCreated }: { idPrefix: string; evidence: string | null; onCreated: (b: OperatorBusiness) => void }) {
  const record = useContext(RecordContext);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; name: string; isPublic: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(force: boolean) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("name", name);
    form.set("website_url", website);
    if (force) form.set("force", "1");
    try {
      const result = await adminCreateImportBusiness(form);
      if (result.status === "created") {
        setOpen(false);
        record("business", result.business.id);
        onCreated(result.business);
      } else if (result.status === "duplicates") setDuplicates(result.duplicates);
      else setError(result.error);
    } catch {
      setError("Couldn't add this Business. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(evidence ?? "");
          setWebsite("");
          setDuplicates([]);
          setError(null);
          setOpen(true);
        }}
        className="mt-1 w-fit py-1 text-metadata font-semibold text-accent hover:underline"
      >
        + Create New Business
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-black/[0.08] bg-black/[0.02] p-3">
      <p className="text-microcopy text-muted">Adds the Business to Findmi for review (not public yet). No one is made its owner.</p>
      <label htmlFor={`${idPrefix}-new-name`} className={labelText}>
        Business Name
      </label>
      <input id={`${idPrefix}-new-name`} value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="words" maxLength={160} className={inputClass} />
      <label htmlFor={`${idPrefix}-new-site`} className={labelText}>
        Website (Optional)
      </label>
      <input id={`${idPrefix}-new-site`} type="url" inputMode="url" autoCapitalize="none" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className={inputClass} />
      {duplicates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-metadata text-amber-900">This Business may already be on Findmi:</p>
          {duplicates.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
              <span className="min-w-0 truncate text-metadata text-primary">
                {d.name}
                {!d.isPublic && <span className="text-muted"> · Not public</span>}
              </span>
              <button type="button" onClick={() => onCreated({ id: d.id, name: d.name })} className="shrink-0 text-metadata font-semibold text-accent hover:underline">
                Use This Business
              </button>
            </div>
          ))}
          <button type="button" onClick={() => create(true)} disabled={busy} className="w-fit text-metadata font-semibold text-muted hover:text-secondary">
            Create Anyway
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-metadata text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => create(false)} disabled={busy || !name.trim()} className={smallPrimary}>
          {busy ? "Adding…" : "Create Business"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-metadata font-semibold text-muted hover:text-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Create & Review Business — the existing Brand Import candidate for this
 * Business's website (name, description, logo, cover, category), reviewed
 * here and created through Brand Import's own Create Business path. */
function BrandReviewCard({
  idPrefix,
  read,
  businessCategories,
  onCreated,
}: {
  idPrefix: string;
  read: BusinessReadView;
  businessCategories: Category[];
  onCreated: (b: OperatorBusiness) => void;
}) {
  const record = useContext(RecordContext);
  const p = read.proposal;
  const [name, setName] = useState(p?.name ?? "");
  const [categoryId, setCategoryId] = useState(p?.cat ?? "");
  const [shortDescription, setShortDescription] = useState(p?.sd ?? "");
  const [about, setAbout] = useState(p?.about ?? "");
  const [useLogo, setUseLogo] = useState(p?.useLogo !== false && Boolean(p?.logo));
  const [useCover, setUseCover] = useState(p?.useCover !== false && Boolean(p?.cover));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Brand Import's own verified previews (data URIs) for the candidate's
  // stored logo / cover. As on Admin → Businesses → Import, an image that
  // can't be previewed starts unselected.
  const [previews, setPreviews] = useState<{ logo: string | null; cover: string | null; loaded: boolean }>({ logo: null, cover: null, loaded: false });
  useEffect(() => {
    let live = true;
    adminPreviewBusinessRead(read.batchId, read.candidateId)
      .catch(() => null)
      .then((r) => {
        if (!live) return;
        // Brand Import's own verified data-URI previews — nothing else is shown.
        const logo = safePreviewSrc(r?.logo.preview);
        const cover = safePreviewSrc(r?.cover.preview);
        setPreviews({ logo, cover, loaded: true });
        if (!logo) setUseLogo(false);
        if (!cover) setUseCover(false);
      });
    return () => {
      live = false;
    };
  }, [read.batchId, read.candidateId]);
  if (!p) return null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await adminCreateBusinessFromRead(read.batchId, read.candidateId, read.updatedAt, {
        name,
        categoryId,
        website: p!.site,
        instagram: p!.ig ?? "",
        shortDescription,
        about,
        useLogo,
        useCover,
      });
      if (result.ok) {
        if (!result.existing) record("business", result.business.id);
        onCreated(result.business);
      }
      else setError(result.error);
    } catch {
      setError("Creation didn't finish. It's safe to try again — no duplicate will be created.");
    } finally {
      setBusy(false);
    }
  }

  const parents = businessCategories.filter((c) => !c.parent_id);
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-findmi/30 bg-findmi-50/40 p-3">
      <p className="text-label font-bold uppercase text-subtle">Create &amp; Review Business</p>
      <p className="-mt-1 text-microcopy text-muted">Read from {hostOf(p.finalUrl || p.site)} by Brand Import. Created for review (not public yet); no owner, claim or Pro.</p>
      {(p.logo || p.cover) && (
        <div className="flex flex-wrap gap-3">
          {p.logo && (
            <label className="flex items-center gap-2 text-metadata text-secondary">
              {previews.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- verified, re-encoded data URI preview (re-verified on create)
                <img src={previews.logo} alt="Logo candidate" className="h-12 w-12 rounded-lg bg-white object-contain" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-center text-microcopy text-muted">{previews.loaded ? "No preview" : "…"}</span>
              )}
              <input type="checkbox" checked={useLogo} disabled={previews.loaded && !previews.logo} onChange={(e) => setUseLogo(e.target.checked)} className="accent-findmi" />
              Use Logo
            </label>
          )}
          {p.cover && (
            <label className="flex items-center gap-2 text-metadata text-secondary">
              {previews.cover ? (
                // eslint-disable-next-line @next/next/no-img-element -- verified, re-encoded data URI preview (re-verified on create)
                <img src={previews.cover} alt="Cover candidate" className="h-12 w-20 rounded-lg bg-white object-cover" />
              ) : (
                <span className="flex h-12 w-20 items-center justify-center rounded-lg bg-white text-center text-microcopy text-muted">{previews.loaded ? "No preview" : "…"}</span>
              )}
              <input type="checkbox" checked={useCover} disabled={previews.loaded && !previews.cover} onChange={(e) => setUseCover(e.target.checked)} className="accent-findmi" />
              Use Cover
            </label>
          )}
        </div>
      )}
      <label htmlFor={`${idPrefix}-brand-name`} className={labelText}>
        Business Name
      </label>
      <input id={`${idPrefix}-brand-name`} value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="words" maxLength={200} className={inputClass} />
      <label htmlFor={`${idPrefix}-brand-cat`} className={labelText}>
        Category
      </label>
      <select id={`${idPrefix}-brand-cat`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
        <option value="">Choose a category</option>
        {parents.map((parent) => (
          <optgroup key={parent.id} label={parent.name}>
            <option value={parent.id}>{parent.name}</option>
            {businessCategories
              .filter((c) => c.parent_id === parent.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <label htmlFor={`${idPrefix}-brand-sd`} className={labelText}>
        Short Description
      </label>
      <input id={`${idPrefix}-brand-sd`} value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} autoCapitalize="sentences" maxLength={160} className={inputClass} />
      <label htmlFor={`${idPrefix}-brand-about`} className={labelText}>
        About
      </label>
      <textarea id={`${idPrefix}-brand-about`} value={about} onChange={(e) => setAbout(e.target.value)} autoCapitalize="sentences" maxLength={600} rows={3} className={inputClass} />
      {error && (
        <p role="alert" className="text-metadata text-red-700">
          {error}
        </p>
      )}
      <button type="button" onClick={create} disabled={busy || !name.trim() || !categoryId} className={`${smallPrimary} w-fit`}>
        {busy ? "Creating…" : "Create Business"}
      </button>
    </div>
  );
}

function BusinessField({
  id,
  initial,
  evidence,
  website,
  read,
  businessCategories,
  onSelect,
  onCreated,
  onRetryRead,
}: {
  id: string;
  initial: OperatorBusiness | null;
  evidence: string | null;
  website: string | null;
  read: BusinessReadView | undefined;
  businessCategories: Category[];
  onSelect: (b: OperatorBusiness | null) => void;
  onCreated: (b: OperatorBusiness) => void;
  /** Re-run Brand Import for THIS website only (same action, bounded attempts). */
  onRetryRead?: (read: BusinessReadView) => Promise<string | null>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  // The website already belongs to a Business on Findmi (Brand Import's
  // match-first step): select it — never recreate it.
  const applied = useRef(false);
  const existing = read?.matchedBusiness ?? read?.createdBusiness ?? null;
  useEffect(() => {
    if (!initial && existing && !applied.current) {
      applied.current = true;
      onCreated(existing);
    }
  }, [initial, existing, onCreated]);

  return (
    <>
      <RelationField
        // Remounts when the Business is set from elsewhere (batch reuse).
        key={`${id}-${initial?.id ?? "none"}`}
        label="Business at This Event"
        name={id}
        entity="businesses"
        placeholder="Search Businesses…"
        clearLabel="No Business"
        initial={initial ? { value: initial.id, label: initial.name } : null}
        onSelect={(r) => onSelect(r ? { id: r.value, name: r.label } : null)}
      />
      {!initial && website && !existing && read && PENDING_READ.has(read.status) && (
        <p className="mt-1 text-microcopy text-muted">Reading {hostOf(website)} with Brand Import…</p>
      )}
      {!initial && website && !existing && !read && <p className="mt-1 text-microcopy text-muted">Waiting to read {hostOf(website)}…</p>}
      {!initial && read?.status === "ready" && !existing && (
        <BrandReviewCard key={read.updatedAt} idPrefix={id} read={read} businessCategories={businessCategories} onCreated={onCreated} />
      )}
      {!initial && read?.status === "failed" && (
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-microcopy text-amber-900">
            Couldn&rsquo;t read {hostOf(website)} ({read.failureCode ?? "unavailable"}). Retry, or create the Business without it:
          </p>
          {onRetryRead && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={retrying}
                onClick={async () => {
                  setRetrying(true);
                  setRetryNote(null);
                  setRetryNote(await onRetryRead(read).catch(() => "Still couldn’t read the website."));
                  setRetrying(false);
                }}
                className="w-fit text-metadata font-semibold text-accent hover:underline disabled:opacity-60"
              >
                {retrying ? "Reading the website…" : "Retry Business Website"}
              </button>
              {retryNote && <span className="text-microcopy text-muted">{retryNote}</span>}
            </div>
          )}
        </div>
      )}
      {!initial && (!website || read?.status === "failed") && <QuickCreateBusiness idPrefix={id} evidence={evidence} onCreated={onCreated} />}
    </>
  );
}

// ── Event details: source evidence + Review Existing Event ─────────────────

function ExistingEventReview({ eventId, review, business }: { eventId: string; review: EventImportReview; business: OperatorBusiness | null }) {
  const record = useContext(RecordContext);
  type Compare = Extract<Awaited<ReturnType<typeof adminCompareExistingEvent>>, { ok: true }>;
  const [data, setData] = useState<Compare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, "fill" | "replace" | "keep">>({});
  const [applied, setApplied] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    setApplied(null);
    try {
      const result = await adminCompareExistingEvent(eventId, review, business);
      if (!result.ok) return setError(result.error);
      setData(result);
      setChoices(Object.fromEntries(result.comparisons.map((c) => [c.field, c.kind === "fill" ? "fill" : "keep"])));
    } catch {
      setError("Couldn't load the Event on Findmi.");
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const chosen = Object.fromEntries(Object.entries(choices).filter(([, v]) => v !== "keep")) as Record<string, "fill" | "replace">;
      const result = await adminApplyExistingEvent(eventId, review, business, chosen);
      if (!result.ok) setError(result.error);
      else {
        setApplied(result.applied);
        if (result.applied.length > 0) record("event", eventId);
        setData(null);
      }
    } catch {
      setError("Couldn't update the Event. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const LABEL: Record<string, string> = { image: "Image", description: "Description", link: "Event Link", attendance: "RSVP / Tickets", organizer: "Organizer", category: "Category", formats: "Formats", business: "Business" };
  const REPLACEABLE = new Set(["image", "description", "link", "attendance", "organizer"]);
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-black/[0.08] bg-black/[0.02] p-3">
      <p className="text-label font-bold uppercase text-subtle">Review Existing Event</p>
      <p className="-mt-1 text-microcopy text-muted">
        No duplicate is created. Empty fields can be filled from this import; a populated field changes only if you choose to replace it.{" "}
        <Link href={`/admin/events/${eventId}`} className="font-semibold text-accent hover:underline">
          Open Event
        </Link>
      </p>
      {applied && <p className="text-metadata text-findmi-700">{applied.length > 0 ? `Updated: ${applied.map((f) => LABEL[f] ?? f).join(", ")}.` : "Nothing was changed."}</p>}
      {!data ? (
        <button type="button" onClick={load} className="w-fit text-metadata font-semibold text-accent hover:underline">
          {applied ? "Compare Again" : "Compare With Findmi"}
        </button>
      ) : (
        <>
          <p className="text-microcopy text-muted">
            On Findmi: {data.snapshot.occurrenceCount} {data.snapshot.occurrenceCount === 1 ? "date" : "dates"}
            {data.snapshot.occurrencesWithoutLocation > 0 ? ` (${data.snapshot.occurrencesWithoutLocation} without a Findmi Location — edit those in the Event)` : ""}. Dates and places aren&rsquo;t changed from here.
          </p>
          {data.comparisons.length === 0 && <p className="text-metadata text-muted">This import has nothing to add.</p>}
          <ul className="flex flex-col gap-2">
            {data.comparisons.map((c) => (
              <li key={c.field} className="rounded-lg bg-white px-3 py-2">
                <p className="text-metadata font-semibold text-primary">{LABEL[c.field]}</p>
                {c.kind === "same" && <p className="text-microcopy text-muted">Already the same.</p>}
                {c.field === "image" && c.kind !== "same" && <VerifiedEventImagePreview url={c.proposed} className="mt-1 h-20 w-28 rounded-lg bg-black/[0.04] object-cover" />}
                {c.kind === "fill" && (
                  <label className="mt-1 flex items-start gap-2 text-microcopy text-secondary">
                    <input type="checkbox" className="mt-0.5 accent-findmi" checked={choices[c.field] === "fill"} onChange={(e) => setChoices((prev) => ({ ...prev, [c.field]: e.target.checked ? "fill" : "keep" }))} />
                    <span className="min-w-0 break-words">Empty on Findmi — add: {c.field === "category" || c.field === "formats" ? "the reviewed value" : c.proposed.slice(0, 160)}</span>
                  </label>
                )}
                {c.kind === "conflict" &&
                  (REPLACEABLE.has(c.field) ? (
                    <div className="mt-1 flex flex-col gap-1 text-microcopy text-secondary">
                      <label className="flex items-start gap-2">
                        <input type="radio" className="mt-0.5 accent-findmi" checked={choices[c.field] !== "replace"} onChange={() => setChoices((prev) => ({ ...prev, [c.field]: "keep" }))} />
                        <span className="min-w-0 break-words">Keep: {(c.existing ?? "").slice(0, 160)}</span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="radio" className="mt-0.5 accent-findmi" checked={choices[c.field] === "replace"} onChange={() => setChoices((prev) => ({ ...prev, [c.field]: "replace" }))} />
                        <span className="min-w-0 break-words">Replace with: {c.proposed.slice(0, 160)}</span>
                      </label>
                    </div>
                  ) : (
                    <p className="text-microcopy text-muted">Already set on Findmi ({c.existing}). Change it in the Event if needed.</p>
                  ))}
              </li>
            ))}
          </ul>
          <button type="button" onClick={apply} disabled={busy || !Object.values(choices).some((v) => v !== "keep")} className={`${smallPrimary} w-fit`}>
            {busy ? "Updating…" : "Apply To Existing Event"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-metadata text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

function EventDetails({
  id,
  candidate,
  review,
  set,
  existingEventId,
  business,
  onRetrySource,
}: Parameters<OperatorImportMode["renderEventDetails"]>[0] & { onRetrySource?: () => Promise<string | null> }) {
  const s = candidate.structured;
  const source = s?.source;
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const canRetry = Boolean(onRetrySource && candidate.sourceUrl && source && (source.status === "failed" || source.status === "not_read"));
  return (
    <div className="flex flex-col gap-3">
      {source && source.status !== "not_read" && (
        <p className={`text-microcopy ${source.status === "read" ? "text-findmi-700" : "text-amber-900"}`}>
          {source.status === "read"
            ? source.filled.length > 0
              ? `From the Event Link: ${source.filled.join(", ")}.`
              : "Event Link read — your values already covered everything it offered."
            : `Event Link not read: ${source.detail ?? "unavailable"}`}
        </p>
      )}
      {canRetry && (
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              setRetryNote(null);
              setRetryNote(await onRetrySource!().catch(() => "The Event Link still couldn’t be read."));
              setRetrying(false);
            }}
            className="text-metadata font-semibold text-accent hover:underline disabled:opacity-60"
          >
            {retrying ? "Reading the Event Link…" : "Retry Event Link"}
          </button>
          {retryNote && <span className="text-microcopy text-muted">{retryNote}</span>}
        </div>
      )}
      {review.imageUrl && (
        <div className="flex items-center gap-3">
          <VerifiedEventImagePreview url={review.imageUrl} className="h-20 w-28 shrink-0 rounded-lg bg-black/[0.04] object-cover" />
          <button type="button" onClick={() => set({ imageUrl: null })} className="text-metadata font-semibold text-muted hover:text-red-600">
            Don&rsquo;t Use Image
          </button>
        </div>
      )}
      {!review.imageUrl && !candidate.imageUrl && candidate.imageGuard && (
        <p className="rounded-lg border border-black/[0.08] bg-black/[0.02] px-3 py-2 text-microcopy text-secondary" data-image-guard="generic">
          <span className="font-semibold text-primary">No Event Image Found</span> · Generic Brand/Site Image Ignored. The Event Link&rsquo;s only image is the site&rsquo;s standard {candidate.imageGuard.evidence === "page_logo" ? "logo" : "image"}, not Event creative. Add an Event image later in the Event if you have one.
        </p>
      )}
      {!review.imageUrl && candidate.imageUrl && (
        <button type="button" onClick={() => set({ imageUrl: candidate.imageUrl })} className="w-fit text-metadata font-semibold text-accent hover:underline">
          Use the Event Link&rsquo;s Image
        </button>
      )}
      <div>
        <label htmlFor={`${id}-description`} className="mb-1 block text-label font-bold uppercase text-subtle">
          Description
        </label>
        <textarea
          id={`${id}-description`}
          value={review.description ?? ""}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={EVENT_DESCRIPTION_MAX}
          rows={4}
          autoCapitalize="sentences"
          className={`${inputClass} resize-y`}
        />
      </div>
      <AttendanceEditor review={review} set={set} evidence={candidate.attendance} idPrefix={`${id}-`} />
      {(s?.otherBusinesses?.length ?? 0) > 0 && (
        <p className="text-microcopy text-muted">Also named (Featured / Participating): {s!.otherBusinesses!.join(", ")}. Not linked — add them to the Event afterwards if they take part.</p>
      )}
      {(s?.programming?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-dashed border-black/15 p-3">
          <p className="text-label font-bold uppercase text-subtle">Programming · Not Currently Saved To Findmi</p>
          {s!.programming!.map((p, i) => (
            <div key={i} className="mt-1.5">
              <p className="text-microcopy font-semibold text-secondary">{p.label}</p>
              <p className="whitespace-pre-line text-microcopy text-muted">{p.text}</p>
            </div>
          ))}
        </section>
      )}
      {existingEventId && <ExistingEventReview eventId={existingEventId} review={review} business={business} />}
    </div>
  );
}

/** A website Brand Import matched to an existing Business → that Business
 * is the suggestion for every Event with that Business Website (unless
 * the Event already has one). */
function withWebsiteBusiness(events: SourceEventAnalysis[], website: string, business: OperatorBusiness): SourceEventAnalysis[] {
  return events.map((e) =>
    e.candidate.structured?.businessWebsite === website && !e.matches.organizerBusiness ? { ...e, matches: { ...e.matches, organizerBusiness: business } } : e
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

type Result = { source: ImportSource; events: SourceEventAnalysis[]; warnings: string[]; run: number };

export default function AdminEventImporter({ categories, formats, businessCategories }: { categories: Category[]; formats: Category[]; businessCategories: Category[] }) {
  const [method, setMethod] = useState<Method>("text");
  const [pasted, setPasted] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [reads, setReads] = useState<Record<string, BusinessReadView>>({});
  const [created, setCreated] = useState<CreatedRecords>(NO_RECORDS);
  const record = useCallback((kind: RecordKind, id: string) => {
    setCreated((prev) => (prev[kind][id] ? prev : { ...prev, [kind]: { ...prev[kind], [id]: true } }));
  }, []);
  const [analyzing, startAnalyze] = useTransition();
  const runRef = useRef(0);

  // Durability (phone sleep / accidental refresh): the pasted text is kept
  // in this tab's sessionStorage, so a reload never loses the paste itself
  // (Review choices live only in this page; created Businesses / Locations
  // are already saved and are found again by matching on re-analysis).
  useEffect(() => {
    try {
      const draft = window.sessionStorage.getItem(PASTE_DRAFT_KEY);
      if (draft) setPasted((current) => current || draft);
    } catch {
      // storage unavailable (private mode) — nothing to restore
    }
  }, []);
  useEffect(() => {
    try {
      if (pasted) window.sessionStorage.setItem(PASTE_DRAFT_KEY, pasted);
      else window.sessionStorage.removeItem(PASTE_DRAFT_KEY);
    } catch {
      // storage unavailable or full — the paste still works, just isn't kept
    }
  }, [pasted]);
  // Leaving mid-batch (reading sources, or an unsaved Review) asks first.
  const inProgress = Boolean(progress || result);
  useEffect(() => {
    if (!inProgress) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [inProgress]);

  /** Brand Import for every Business website whose Business isn't matched. */
  async function readBusinesses(events: SourceEventAnalysis[], run: number) {
    const websites = [...new Set(events.flatMap((e) => (!e.matches.organizerBusiness && e.candidate.structured?.businessWebsite ? [e.candidate.structured.businessWebsite] : [])))];
    if (websites.length === 0) return;
    const started = await adminStartBusinessReads(websites).catch(() => null);
    if (!started?.ok || runRef.current !== run) return;
    setReads(Object.fromEntries(started.reads.map((r) => [r.website, r])));
    const byCandidate = new Map(started.reads.map((r) => [r.candidateId, r]));
    await runWithConcurrency(
      started.reads.filter((r) => r.status === "queued").map((r) => r.candidateId),
      BUSINESS_READ_CONCURRENCY,
      async (candidateId) => {
        const outcome = await adminProcessBusinessRead(candidateId);
        if (outcome.outcome === "busy") return "retry_later";
        const r = byCandidate.get(candidateId)!;
        const view = await adminLoadBusinessRead(r.batchId, candidateId);
        if (view && runRef.current === run) {
          setReads((prev) => ({ ...prev, [r.website]: { ...view } }));
          // The website already belongs to a Business on Findmi: it becomes
          // the suggestion for every Event naming that website.
          if (view.matchedBusiness) setResult((prev) => (prev && prev.run === run ? { ...prev, events: withWebsiteBusiness(prev.events, r.website, view.matchedBusiness!) } : prev));
        }
        return "done";
      },
      { shouldStop: () => runRef.current !== run }
    );
  }

  /** Each Event with an Event Link: read through the existing Event URL
   * importer, one request per Event, a few at a time. A failure keeps the
   * Event (explicit reading) with the reason — never drops it. */
  async function enrich(base: Result, text: string) {
    const run = base.run;
    const segments = segmentTextByKey(text);
    const todo = base.events.filter((e) => e.candidate.structured && e.candidate.sourceUrl && segments.has(e.key));
    let events = base.events;
    if (todo.length > 0) {
      setProgress({ done: 0, total: todo.length, failed: 0 });
      let done = 0;
      let failed = 0;
      await runWithConcurrency(
        todo.map((e) => e.key),
        EVENT_SOURCE_CONCURRENCY,
        async (key) => {
          let read: EventImportAnalysis;
          try {
            read = await adminEnrichPastedEvent(segments.get(key)!);
          } catch {
            read = { ok: false, code: "server" };
          }
          events = events.map((e) => {
            if (e.key !== key) return e;
            if (read.ok && read.kind === "single") {
              const past = read.candidate.occurrences.length > 0 && read.candidate.occurrences.every((o) => o.past);
              if (read.candidate.structured?.source?.status === "failed") failed += 1;
              return { ...e, candidate: read.candidate, matches: read.matches, warnings: read.warnings, past };
            }
            failed += 1;
            const detail = read.ok ? "unexpected result" : EVENT_IMPORT_FAILURE_COPY[read.code];
            return { ...e, candidate: { ...e.candidate, structured: { ...e.candidate.structured!, source: { status: "failed", filled: [], detail } } } };
          });
          done += 1;
          if (runRef.current === run) setProgress({ done, total: todo.length, failed });
          return "done";
        },
        { shouldStop: () => runRef.current !== run }
      );
    }
    if (runRef.current !== run) return;
    const sourceWarnings = events.flatMap((e, i) =>
      e.candidate.structured?.source?.status === "failed" || e.candidate.structured?.source?.status === "several_events"
        ? [`${e.key.startsWith("pasted-event-") ? `EVENT ${e.key.slice(13)}` : `Event ${i + 1}`}: Event Link not read — ${e.candidate.structured.source.detail ?? "unavailable"}`]
        : []
    );
    setProgress(null);
    setResult({ ...base, events, warnings: [...base.warnings, ...sourceWarnings] });
    void readBusinesses(events, run);
  }

  /** Retry Event Link — ONE Event, the same server action as the batch
   * read. The row's reading is replaced, and the operator's Review values
   * keep every edit: only gaps are filled (fillReviewGaps). */
  async function retrySource(eventKey: string, review: EventImportReview, set: (patch: Partial<EventImportReview>) => void, hadImage: boolean): Promise<string | null> {
    const text = segmentTextByKey(pasted).get(eventKey);
    if (!text) return "This Event's pasted details are no longer on this page.";
    const run = runRef.current;
    const read = await adminEnrichPastedEvent(text);
    if (runRef.current !== run) return null;
    if (!read.ok || read.kind !== "single") return read.ok ? "The Event Link still couldn’t be read." : EVENT_IMPORT_FAILURE_COPY[read.code];
    const status = read.candidate.structured?.source?.status;
    setResult((prev) =>
      prev && prev.run === run
        ? {
            ...prev,
            events: prev.events.map((e) =>
              e.key === eventKey ? { ...e, candidate: read.candidate, matches: read.matches, warnings: read.warnings, past: read.candidate.occurrences.length > 0 && read.candidate.occurrences.every((o) => o.past) } : e
            ),
          }
        : prev
    );
    if (status !== "read") return `Still not read: ${read.candidate.structured?.source?.detail ?? "unavailable"}`;
    const filled = fillReviewGaps(review, operatorReviewDefaults(read.candidate, read.matches, { categories, formats }), { hadImage });
    set({ description: filled.description, organizer: filled.organizer, attendance: filled.attendance, imageUrl: filled.imageUrl, occurrences: filled.occurrences });
    return "Event Link read. Only empty fields were filled — your edits were kept.";
  }

  /** Retry Business Website — the same Brand Import processing action for
   * this ONE candidate (Brand Import's own attempt limit applies). */
  async function retryRead(read: BusinessReadView): Promise<string | null> {
    const run = runRef.current;
    const outcome = await adminProcessBusinessRead(read.candidateId);
    if (outcome.outcome === "busy") return "Findmi is reading other websites — try again in a moment.";
    if (outcome.outcome === "not_eligible") return "This website has been retried too many times. Create the Business without it.";
    const view = await adminLoadBusinessRead(read.batchId, read.candidateId);
    if (!view || runRef.current !== run) return null;
    const website = Object.keys(reads).find((w) => reads[w].candidateId === read.candidateId);
    if (website) setReads((prev) => ({ ...prev, [website]: { ...view } }));
    if (view.matchedBusiness && website) setResult((prev) => (prev && prev.run === run ? { ...prev, events: withWebsiteBusiness(prev.events, website, view.matchedBusiness!) } : prev));
    return view.status === "failed" ? `Still couldn’t read it (${view.failureCode ?? "unavailable"}).` : null;
  }

  function show(a: EventImportAnalysis, text: string | null) {
    if (!a.ok) {
      setError(a.detail ? `${EVENT_IMPORT_FAILURE_COPY[a.code]} ${a.detail}` : EVENT_IMPORT_FAILURE_COPY[a.code]);
      return;
    }
    if (a.kind !== "multi") {
      setError(EVENT_IMPORT_FAILURE_COPY.server);
      return;
    }
    const run = (runRef.current += 1);
    setReads({});
    setCreated(NO_RECORDS);
    const base: Result = { source: a.source, events: a.events, warnings: a.warnings, run };
    if (text) void enrich(base, text);
    else {
      setResult(base);
      void readBusinesses(base.events, run);
    }
  }

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (method === "text" && !pasted.trim()) return setError(EVENT_IMPORT_FAILURE_COPY.text_no_event);
    if (method === "link" && !url.trim()) return setError(EVENT_IMPORT_FAILURE_COPY.invalid_url);
    startAnalyze(async () => {
      try {
        if (method === "text") show(await adminAnalyzeEventText(pasted), pasted);
        else show(await adminAnalyzeEventUrl(url), null);
      } catch {
        setError(EVENT_IMPORT_FAILURE_COPY.server);
      }
    });
  }

  const operator: OperatorImportMode = {
    commit: adminCommitEventImportBatch,
    createLocation: async (form) => {
      const result = await adminCreateImportLocation(form);
      if (result.status === "created") record("location", result.location.id);
      return result;
    },
    stats: {
      businessesCreated: Object.keys(created.business).length,
      locationsCreated: Object.keys(created.location).length,
      existingEventsUpdated: Object.keys(created.event).length,
    },
    renderBusinessPicker: ({ id, initial, evidence, website, onSelect, onCreated }) => (
      <BusinessField
        id={id}
        initial={initial}
        evidence={evidence}
        website={website}
        read={website ? reads[website] : undefined}
        businessCategories={businessCategories}
        onSelect={onSelect}
        onRetryRead={retryRead}
        onCreated={(b) => {
          onCreated(b);
          // Every other Event with this Business Website gets the same Business.
          if (website) setReads((prev) => (prev[website] ? { ...prev, [website]: { ...prev[website], createdBusiness: b } } : prev));
        }}
      />
    ),
    renderEventDetails: (props) => <EventDetails {...props} onRetrySource={() => retrySource(props.eventKey, props.review, props.set, Boolean(props.candidate.imageUrl))} />,
    renderThumbnail: (url) => <VerifiedEventImagePreview url={url} compact className="h-12 w-12 shrink-0 rounded-lg bg-black/[0.04] object-cover" />,
    doneHref: "/admin/events?new=1",
  };

  const header = (
    <header>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Import Events</h1>
      <p className="mt-1 text-sm text-ink/55">Add public Events from other sources for discovery. Each Event keeps its own Business. Findmi is never shown as the organizer.</p>
    </header>
  );

  if (progress) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <section role="status" className={`${sectionClass} flex flex-col gap-2`}>
          <p className="text-card-title font-semibold text-primary">
            Reading Event Links · {progress.done} of {progress.total}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full bg-findmi transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <p className="text-metadata text-muted">
            Each Event&rsquo;s page is read on its own ({EVENT_SOURCE_CONCURRENCY} at a time). {progress.failed > 0 ? `${progress.failed} couldn’t be read so far — they stay in Review with your details.` : "Keep this page open."}
          </p>
        </section>
      </div>
    );
  }

  if (result) {
    return (
      <RecordContext.Provider value={record}>
      <MultiEventImport
        key={result.run}
        businessId=""
        businessName=""
        intent="participating"
        source={result.source}
        events={result.events}
        warnings={result.warnings}
        header={header}
        manualHref="/admin/events/new"
        businessHome="/admin/events"
        onTryAnother={() => {
          runRef.current += 1;
          setResult(null);
          setReads({});
        }}
        categories={categories}
        formats={formats}
        operator={operator}
      />
      </RecordContext.Provider>
    );
  }

  const errorId = "admin-event-import-error";
  return (
    <div className="flex flex-col gap-4">
      {header}
      <form onSubmit={analyze} noValidate className={`${sectionClass} flex flex-col gap-3`}>
        <div role="group" aria-label="How to import" className="grid grid-cols-2 gap-1 rounded-xl bg-black/[0.04] p-1">
          {(
            [
              { key: "text", label: "Paste Details" },
              { key: "link", label: "From Link" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={method === m.key}
              onClick={() => {
                setMethod(m.key);
                setError(null);
              }}
              disabled={analyzing}
              className={`h-10 min-w-0 truncate rounded-lg px-1 text-metadata font-semibold transition ${method === m.key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-secondary"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {method === "text" ? (
          <>
            <label htmlFor="admin-event-details" className="text-metadata text-muted">
              Paste one Event&rsquo;s details, or up to 25 Events with each one between <span className="font-semibold text-secondary">EVENT 1</span> and{" "}
              <span className="font-semibold text-secondary">=== END EVENT 1 ===</span> (numbering each Event). Each Event Link and Business Website is read automatically.
            </label>
            <textarea
              id="admin-event-details"
              rows={12}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              autoCapitalize="sentences"
              maxLength={PASTE_MAX}
              placeholder={"EVENT 1\nEvent Name: …\nPrimary Business: …\nBusiness Website: https://…\nEvent Link: https://…\nDates: …\nStart Time: …\nEnd Time: …\nLocation Name: …\nStreet Address: …\n=== END EVENT 1 ==="}
              className={`${inputClass} min-h-[14rem] resize-y`}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              disabled={analyzing}
            />
            <p className="text-right text-microcopy text-subtle">
              {pasted.length.toLocaleString()} / {PASTE_MAX.toLocaleString()}
            </p>
          </>
        ) : (
          <>
            <label htmlFor="admin-event-link" className="text-metadata text-muted">
              The Event&rsquo;s page, or an organizer&rsquo;s calendar that lists several Events.
            </label>
            <input
              id="admin-event-link"
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
        {error && (
          <p id={errorId} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-metadata text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={analyzing} className={primaryButtonClass}>
          {analyzing ? (method === "text" ? "Reading the Details…" : "Reading the Page…") : "Find Event Details"}
        </button>
      </form>
      <Link href="/admin/events/new" className="py-1 text-center text-metadata font-semibold text-muted hover:text-secondary">
        Add an Event Manually
      </Link>
    </div>
  );
}
