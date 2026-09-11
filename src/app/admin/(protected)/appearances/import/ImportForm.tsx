"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { RelationField, type SearchResult } from "@/components/admin/RelationPicker";
import { analyzeAppearances, createAppearancesBulk, type CreateRowInput, type DraftRow } from "./actions";

// Appearance UX Cleanup pass — the server (lib/admin/appearance-import.ts,
// `import "server-only"`, so a client component can't import its constant
// directly) still architecturally supports up to MAX_IMPORT_IMAGES (6);
// that's deliberately untouched. This is a narrower, UI-only input
// constraint: real production use showed one screenshot per analysis is
// substantially more reliable and easier to review, so this selector caps
// at 1 regardless of what the server would still accept.
const MAX_IMAGES = 1;
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const smallInputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

interface EditableRow {
  key: string;
  selected: boolean;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  time_tbd: boolean;
  venue_name: string;
  address: string;
  city: string;
  state: string;
  status: "confirmed" | "tentative" | "canceled";
  event_id: string | null;
  eventInitial: SearchResult | null;
  needs_review: boolean;
  review_reason: string | null;
  source_excerpt: string;
  eventMatch: DraftRow["eventMatch"];
  duplicateMatch: DraftRow["duplicateMatch"];
}

let keySeq = 0;
function rowFromDraft(row: DraftRow): EditableRow {
  const strongEvent = row.eventMatch?.confidence === "strong" ? row.eventMatch : null;
  const strongDuplicate = row.duplicateMatch?.confidence === "strong";
  return {
    key: `d${keySeq++}`,
    // Item: "selected likely duplicates should require an intentional
    // decision before creation" — a strong duplicate starts unchecked;
    // everything else starts checked (the common, expected case).
    selected: !strongDuplicate,
    title: row.draft.title,
    date: row.draft.date,
    start_time: row.draft.start_time ?? "",
    end_time: row.draft.end_time ?? "",
    time_tbd: row.draft.time_tbd,
    venue_name: row.draft.venue_name ?? "",
    address: row.draft.address ?? "",
    city: row.draft.city ?? "",
    state: row.draft.state ?? "",
    status: "confirmed",
    event_id: strongEvent?.id ?? null,
    eventInitial: strongEvent ? { value: strongEvent.id, label: strongEvent.name, sublabel: strongEvent.venue_name ?? undefined } : null,
    needs_review: row.draft.needs_review,
    review_reason: row.draft.review_reason,
    source_excerpt: row.draft.source_excerpt,
    eventMatch: row.eventMatch,
    duplicateMatch: row.duplicateMatch,
  };
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

export default function ImportForm({ initialBusiness }: { initialBusiness: SearchResult | null }) {
  const [business, setBusiness] = useState<SearchResult | null>(initialBusiness);
  const [text, setText] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<EditableRow[] | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isAnalyzing, startAnalyzing] = useTransition();
  const [isCreating, startCreating] = useTransition();

  const readyCount = rows?.filter((r) => !r.needs_review).length ?? 0;
  const needsReviewCount = rows?.filter((r) => r.needs_review).length ?? 0;
  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;

  // Hardening pass, item 5 — the Possible Event Match / Possible Duplicate
  // banners are computed once, at analysis time, from a row's date/title/
  // venue. If the admin corrects one of those (a wrong date, a typo)
  // afterward, the banner would otherwise keep showing a suggestion based
  // on the OLD, now-wrong values — materially misleading rather than just
  // outdated. Editing any of those three fields clears both banners
  // (never automatically re-suggests one); it never touches event_id/
  // eventInitial, so an event the admin already explicitly picked stays
  // picked.
  const STALE_ON_CHANGE: (keyof EditableRow)[] = ["date", "title", "venue_name"];
  function updateRow(key: string, patch: Partial<EditableRow>) {
    setRows((prev) =>
      prev?.map((r) => {
        if (r.key !== key) return r;
        const changedStaleField = STALE_ON_CHANGE.some((field) => field in patch && patch[field] !== r[field]);
        return {
          ...r,
          ...patch,
          ...(changedStaleField ? { eventMatch: null, duplicateMatch: null } : {}),
        };
      }) ?? null
    );
  }

  function removeRow(key: string) {
    setRows((prev) => prev?.filter((r) => r.key !== key) ?? null);
  }

  function addImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    // One image at a time (see MAX_IMAGES above) — a new selection
    // replaces whatever was previously chosen rather than accumulating.
    setImageFiles([files[0]]);
  }

  function handleAnalyze() {
    if (!business) {
      setAnalyzeError("Choose a business first.");
      return;
    }
    if (!text.trim() && imageFiles.length === 0) {
      setAnalyzeError("Paste some schedule text or upload at least one image.");
      return;
    }
    setAnalyzeError(null);
    const fd = new FormData();
    fd.set("business_id", business.value);
    fd.set("text", text);
    imageFiles.forEach((f) => fd.append("images", f));

    startAnalyzing(async () => {
      // Appearance Importer Multi-Image Crash pass — analyzeAppearances
      // already catches every error it can predict and returns a plain
      // { error } string (see that function's own try/catch), but a
      // production 6-image import proved the Server Action invocation
      // itself can still fail outside that — a Vercel function timeout,
      // a dropped connection, an oversized request — which throws here
      // instead of resolving. Previously nothing caught that: an
      // unhandled rejection inside this transition crashed the whole
      // admin page to Next's generic client-exception screen. Caught now
      // and shown as a normal, in-page error instead.
      try {
        const result = await analyzeAppearances(fd);
        if (result.error) {
          setAnalyzeError(result.error);
          return;
        }
        setRows(result.rows.map(rowFromDraft));
      } catch (err) {
        unstable_rethrow(err);
        setAnalyzeError(
          "Something went wrong reaching the server — the request may have timed out or the connection was interrupted. Try again, or with fewer/smaller images."
        );
      }
    });
  }

  function handleCreate() {
    if (!business || !rows) return;
    setCreateError(null);
    const payload: CreateRowInput[] = rows
      .filter((r) => r.selected)
      .map((r) => ({
        title: r.title,
        date: r.date,
        start_time: r.time_tbd ? null : r.start_time || null,
        end_time: r.time_tbd ? null : r.end_time || null,
        venue_name: r.venue_name || null,
        address: r.address || null,
        city: r.city || null,
        state: r.state || null,
        status: r.status,
        event_id: r.event_id,
      }));
    startCreating(async () => {
      // Same reasoning as handleAnalyze's own try/catch above —
      // createAppearancesBulk succeeds via redirect() (which Next.js
      // implements by throwing a special, framework-internal error that
      // MUST keep propagating — unstable_rethrow re-throws exactly that
      // case unchanged), so this only ever catches a genuine failure
      // (timeout, dropped connection) and shows it in-page instead of
      // crashing.
      try {
        await createAppearancesBulk(business.value, payload);
      } catch (err) {
        unstable_rethrow(err);
        setCreateError(
          "Something went wrong reaching the server while creating these appearances — the request may have timed out or the connection was interrupted. Please try again."
        );
      }
    });
  }

  const canAnalyze = useMemo(() => Boolean(business) && !isAnalyzing, [business, isAnalyzing]);

  return (
    <div className="flex flex-col gap-6">
      {analyzeError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{analyzeError}</p>
      )}

      {/* Step 1 — business + source material. Stays visible/editable even
          after analysis so the admin can tweak the source and re-analyze. */}
      <div className="flex flex-col gap-4 rounded-2xl border border-black/10 p-4">
        <div className="max-w-sm">
          <RelationField
            label="Business"
            name="business_id"
            entity="businesses"
            initial={initialBusiness}
            clearLabel={null}
            placeholder="Search businesses…"
            onSelect={setBusiness}
          />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Paste Schedule</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="Paste a text message, email, Instagram caption, or a list of upcoming dates…"
            className={`${inputClass} resize-y font-mono text-xs leading-relaxed`}
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink">Flyer / Screenshot</span>
          <p className="mb-2 text-xs text-ink/55">Upload one schedule screenshot at a time for the most reliable results.</p>
          {imageFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {imageFiles.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white py-1 pl-3 pr-1.5 text-xs text-ink/70"
                >
                  {f.name}
                  <button
                    type="button"
                    onClick={() => setImageFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-ink/40 hover:bg-black/[0.06] hover:text-ink"
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          {imageFiles.length < MAX_IMAGES && (
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink/70 transition hover:border-ink/30">
              Add Image
              <input
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                className="hidden"
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <p className="mt-1 text-xs text-ink/40">
            JPG, PNG, GIF, or WEBP, up to 5MB. Not saved permanently — used only to analyze this screenshot.
          </p>
        </div>

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          className="self-start rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAnalyzing ? "Analyzing…" : "Analyze Appearances"}
        </button>
      </div>

      {/* Step 2 — review. */}
      {rows && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-black/10 bg-mist/40 px-4 py-3">
            <p className="text-sm font-semibold text-ink">
              {rows.length} Appearance{rows.length === 1 ? "" : "s"} detected
            </p>
            <p className="mt-0.5 text-xs text-ink/55">
              {readyCount} Ready · {needsReviewCount} Need Review
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <div
                key={row.key}
                className={`rounded-2xl border p-4 ${row.needs_review ? "border-amber-300 bg-amber-50/40" : "border-black/10 bg-white"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => updateRow(row.key, { selected: e.target.checked })}
                    className="mt-1 h-5 w-5 shrink-0 accent-findmi"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={row.title}
                        onChange={(e) => updateRow(row.key, { title: e.target.value })}
                        className={`${smallInputClass} min-w-0 flex-1 font-semibold`}
                      />
                      {row.needs_review && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                          Needs Review
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        className="shrink-0 text-xs font-semibold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>

                    {row.review_reason && <p className="mt-1.5 text-xs text-amber-800">{row.review_reason}</p>}
                    <p className="mt-1 truncate text-xs text-ink/40" title={row.source_excerpt}>
                      Source: &ldquo;{row.source_excerpt}&rdquo;
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-ink/50">Date</span>
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) => updateRow(row.key, { date: e.target.value })}
                          className={`${smallInputClass} w-full`}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-ink/50">Start</span>
                        <input
                          type="time"
                          value={row.start_time}
                          disabled={row.time_tbd}
                          onChange={(e) => updateRow(row.key, { start_time: e.target.value })}
                          className={`${smallInputClass} w-full disabled:bg-black/[0.03] disabled:text-ink/30`}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-ink/50">End</span>
                        <input
                          type="time"
                          value={row.end_time}
                          disabled={row.time_tbd}
                          onChange={(e) => updateRow(row.key, { end_time: e.target.value })}
                          className={`${smallInputClass} w-full disabled:bg-black/[0.03] disabled:text-ink/30`}
                        />
                      </label>
                      <label className="flex items-end gap-1.5 pb-2 text-xs text-ink/60">
                        <input
                          type="checkbox"
                          checked={row.time_tbd}
                          onChange={(e) => updateRow(row.key, { time_tbd: e.target.checked })}
                          className="h-4 w-4 accent-findmi"
                        />
                        Time TBD
                      </label>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <input
                        type="text"
                        value={row.venue_name}
                        onChange={(e) => updateRow(row.key, { venue_name: e.target.value })}
                        placeholder="Venue"
                        className={`${smallInputClass} col-span-2 sm:col-span-1`}
                      />
                      <input
                        type="text"
                        value={row.address}
                        onChange={(e) => updateRow(row.key, { address: e.target.value })}
                        placeholder="Address"
                        className={smallInputClass}
                      />
                      <input
                        type="text"
                        value={row.city}
                        onChange={(e) => updateRow(row.key, { city: e.target.value })}
                        placeholder="City"
                        className={smallInputClass}
                      />
                      <input
                        type="text"
                        value={row.state}
                        onChange={(e) => updateRow(row.key, { state: e.target.value })}
                        placeholder="State"
                        className={smallInputClass}
                      />
                    </div>

                    <div className="mt-2">
                      <select
                        value={row.status}
                        onChange={(e) => updateRow(row.key, { status: e.target.value as EditableRow["status"] })}
                        className={smallInputClass}
                      >
                        <option value="confirmed">Confirmed</option>
                        <option value="tentative">Tentative</option>
                        <option value="canceled">Canceled (hidden from the public)</option>
                      </select>
                    </div>

                    {/* Event matching — never auto-forced; a strong match
                        pre-fills the picker (still changeable/clearable), a
                        weak one is shown as a hint only, left empty. */}
                    {row.eventMatch && (
                      <div className="mt-3 rounded-xl border border-findmi/20 bg-findmi-50/60 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">
                          Possible Event Match{row.eventMatch.confidence === "weak" ? " (weak)" : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-ink/60">
                          {row.eventMatch.name} — {formatEventDate(row.eventMatch.start_at)}
                        </p>
                        <div className="mt-2 max-w-xs">
                          <RelationField
                            label="Link to Findmi Event"
                            name={`event_id_${row.key}`}
                            entity="events"
                            initial={row.eventInitial}
                            clearLabel="No event — link to Maps instead"
                            onSelect={(v) => updateRow(row.key, { event_id: v?.value ?? null, eventInitial: v })}
                          />
                        </div>
                      </div>
                    )}

                    {/* Duplicate detection — the row's own checkbox above is
                        the Skip/Create Anyway control (strong duplicates
                        start unchecked); this link lets the admin inspect
                        the existing record before deciding. */}
                    {row.duplicateMatch && (
                      <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                          Possible Duplicate{row.duplicateMatch.confidence === "weak" ? " (weak)" : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-ink/70">
                          {row.duplicateMatch.title} on {formatEventDate(row.duplicateMatch.start_at)}
                          {row.duplicateMatch.venue_name ? ` at ${row.duplicateMatch.venue_name}` : ""} already exists
                          for this business.
                        </p>
                        <Link
                          href={`/admin/appearances/${row.duplicateMatch.id}`}
                          target="_blank"
                          className="mt-1 inline-block text-xs font-semibold text-amber-800 hover:underline"
                        >
                          View existing appearance →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {createError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{createError}</p>
          )}

          <button
            type="button"
            onClick={handleCreate}
            disabled={selectedCount === 0 || isCreating}
            className="self-start rounded-full bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? "Creating…" : `Create Selected Appearances (${selectedCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
