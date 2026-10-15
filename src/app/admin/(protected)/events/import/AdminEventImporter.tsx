"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import MultiEventImport, { type OperatorBusiness, type OperatorImportMode } from "@/app/(public)/account/business/[id]/import-event/MultiEventImport";
import { inputClass, sectionClass } from "@/app/(public)/account/business/[id]/import-event/ReviewParts";
import { RelationField } from "@/components/admin/RelationPicker";
import { EVENT_IMPORT_FAILURE_COPY, type EventImportAnalysis, type ImportSource, type SourceEventAnalysis } from "@/lib/event-import/types";
import type { Category } from "@/lib/types";
import { adminAnalyzeEventText, adminAnalyzeEventUrl, adminCommitEventImportBatch, adminCreateImportBusiness, adminCreateImportLocation } from "./actions";

/** Admin Event Import — the operator entry to the existing importer:
 * Paste Details (one Event, or several marked EVENT 1 … === END EVENT 1 ===)
 * or From Link → the existing several-Events Review (MultiEventImport, in
 * its operator mode) → each Event saved with its own Business, or none. */

type Method = "text" | "link";
const PASTE_MAX = 60000;
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";

const OPERATOR: OperatorImportMode = {
  commit: adminCommitEventImportBatch,
  createLocation: adminCreateImportLocation,
  renderBusinessPicker: ({ id, initial, evidence, onSelect, onCreated }) => (
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
      {!initial && <QuickCreateBusiness idPrefix={id} evidence={evidence} onCreated={onCreated} />}
    </>
  ),
  doneHref: "/admin/events?new=1",
};

/** Missing-Business Quick Create — the Business counterpart of the Review's
 * "+ Create New Location": prefilled from the Business the source names,
 * created only when the Admin confirms (adminCreateImportBusiness: pending
 * review, no owner or membership). A likely existing Business is offered
 * instead; "Create Anyway" is the explicit override. */
function QuickCreateBusiness({ idPrefix, evidence, onCreated }: { idPrefix: string; evidence: string | null; onCreated: (b: OperatorBusiness) => void }) {
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
      <label htmlFor={`${idPrefix}-new-name`} className="text-metadata font-semibold text-secondary">
        Business Name
      </label>
      <input id={`${idPrefix}-new-name`} value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="words" maxLength={160} className={inputClass} />
      <label htmlFor={`${idPrefix}-new-site`} className="text-metadata font-semibold text-secondary">
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
        <button type="button" onClick={() => create(false)} disabled={busy || !name.trim()} className="rounded-lg bg-findmi px-3 py-2 text-metadata font-bold text-white disabled:opacity-60">
          {busy ? "Adding…" : "Create Business"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-metadata font-semibold text-muted hover:text-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function AdminEventImporter({ categories, formats }: { categories: Category[]; formats: Category[] }) {
  const [method, setMethod] = useState<Method>("text");
  const [pasted, setPasted] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ source: ImportSource; events: SourceEventAnalysis[]; warnings: string[]; run: number } | null>(null);
  const [analyzing, startAnalyze] = useTransition();

  function show(a: EventImportAnalysis) {
    if (!a.ok) {
      setError(a.detail ? `${EVENT_IMPORT_FAILURE_COPY[a.code]} ${a.detail}` : EVENT_IMPORT_FAILURE_COPY[a.code]);
      return;
    }
    if (a.kind !== "multi") {
      setError(EVENT_IMPORT_FAILURE_COPY.server);
      return;
    }
    setResult((prev) => ({ source: a.source, events: a.events, warnings: a.warnings, run: (prev?.run ?? 0) + 1 }));
  }

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (method === "text" && !pasted.trim()) return setError(EVENT_IMPORT_FAILURE_COPY.text_no_event);
    if (method === "link" && !url.trim()) return setError(EVENT_IMPORT_FAILURE_COPY.invalid_url);
    startAnalyze(async () => {
      try {
        show(method === "text" ? await adminAnalyzeEventText(pasted) : await adminAnalyzeEventUrl(url));
      } catch {
        setError(EVENT_IMPORT_FAILURE_COPY.server);
      }
    });
  }

  const header = (
    <header>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Import Events</h1>
      <p className="mt-1 text-sm text-ink/55">Add public Events from other sources for discovery. Each Event keeps its own Business. Findmi is never shown as the organizer.</p>
    </header>
  );

  if (result) {
    return (
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
        onTryAnother={() => setResult(null)}
        categories={categories}
        formats={formats}
        operator={OPERATOR}
      />
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
              <span className="font-semibold text-secondary">=== END EVENT 1 ===</span> (numbering each Event).
            </label>
            <textarea
              id="admin-event-details"
              rows={12}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              autoCapitalize="sentences"
              maxLength={PASTE_MAX}
              placeholder={"EVENT 1\nEvent name\nDate and time\nVenue and address\n=== END EVENT 1 ===\n\nEVENT 2\n…\n=== END EVENT 2 ==="}
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
