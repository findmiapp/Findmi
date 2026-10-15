"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import MultiEventImport, { type OperatorImportMode } from "@/app/(public)/account/business/[id]/import-event/MultiEventImport";
import { inputClass, sectionClass } from "@/app/(public)/account/business/[id]/import-event/ReviewParts";
import { RelationField } from "@/components/admin/RelationPicker";
import { EVENT_IMPORT_FAILURE_COPY, type EventImportAnalysis, type ImportSource, type SourceEventAnalysis } from "@/lib/event-import/types";
import type { Category } from "@/lib/types";
import { adminAnalyzeEventText, adminAnalyzeEventUrl, adminCommitEventImportBatch, adminCreateImportLocation } from "./actions";

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
  renderBusinessPicker: ({ id, initial, onSelect }) => (
    <RelationField
      key={id}
      label="Business at This Event"
      name={id}
      entity="businesses"
      placeholder="Search Businesses…"
      clearLabel="No Business"
      initial={initial ? { value: initial.id, label: initial.name } : null}
      onSelect={(r) => onSelect(r ? { id: r.value, name: r.label } : null)}
    />
  ),
  doneHref: "/admin/events?new=1",
};

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
