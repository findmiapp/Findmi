"use client";

import { useState } from "react";
import Image from "next/image";
import JournalSearchSelect, { type JournalSearchResult } from "./JournalSearchSelect";
import { getEventOccurrencesForJournal, type JournalOccurrenceOption } from "@/app/(public)/my-world/journal/actions";
import type { JournalOccurrenceRef } from "@/lib/journal";

type ConnectionKind = "business" | "product" | "event";

/** Shared by both the "candidate to pick" shape (JournalOccurrenceOption,
 * fresh from the server) and the "already attached" shape (JournalOccurrenceRef,
 * loaded with the entry) — only the fields this file actually renders. */
function formatOccurrenceDate(occ: { start_at: string; timezone: string }): string {
  return new Date(occ.start_at).toLocaleDateString("en-US", { timeZone: occ.timezone, weekday: "short", month: "short", day: "numeric" });
}

function formatOccurrenceTime(occ: { start_at: string; end_at: string; timezone: string }): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: occ.timezone, hour: "numeric", minute: "2-digit" });
  return `${fmt(occ.start_at)}–${fmt(occ.end_at)}`;
}

/** Journal V1.1 — progressive-disclosure replacement for three
 * always-visible search boxes (Businesses/Products/Events) in Create
 * Step 3 and Edit's Connections section. The three persisted relationship
 * types are unchanged (still Business/Product/Event rows in
 * journal_entry_connections, via the same saveJournalConnections action
 * and the same JournalSearchSelect/`/api/account/search` route) — only
 * the UI collapses to compact "+ Brand or business / + Product / + Event"
 * triggers, expanding ONE inline search at a time, with everything
 * already added shown together in one "Added to This Experience" list
 * rather than three separate always-expanded group sections.
 *
 * Journal V2 Pass 2B — Event Occurrence selection. Picking an Event via
 * search no longer just attaches the parent Event: it also resolves that
 * Event's real occurrences (past included — see getEventOccurrencesForJournal's
 * own note on why retrospective retrieval is a first-class Journal
 * requirement, never upcoming-only). Exactly one real occurrence attaches
 * deterministically; two or more show an inline "Which date was this
 * experience?" chooser rather than guessing. The same chooser is reachable
 * for an already-connected Event with no resolved occurrence yet (e.g. one
 * created from the Event page's own "Document Your Experience" CTA, which
 * leaves occurrence null exactly when it's genuinely ambiguous) via a small
 * "Which date was this?" link — one picker model, two entry points, never
 * two competing implementations. */
export default function JournalConnectionsPicker({
  businesses,
  products,
  events,
  occurrence,
  onAddBusiness,
  onRemoveBusiness,
  onAddProduct,
  onRemoveProduct,
  onAddEvent,
  onRemoveEvent,
  onSelectOccurrence,
  onClearOccurrence,
}: {
  businesses: JournalSearchResult[];
  products: JournalSearchResult[];
  events: JournalSearchResult[];
  occurrence: JournalOccurrenceRef | null;
  onAddBusiness: (r: JournalSearchResult) => void;
  onRemoveBusiness: (id: string) => void;
  onAddProduct: (r: JournalSearchResult) => void;
  onRemoveProduct: (id: string) => void;
  onAddEvent: (r: JournalSearchResult) => void;
  onRemoveEvent: (id: string) => void;
  onSelectOccurrence: (occ: JournalOccurrenceOption) => void;
  onClearOccurrence: () => void;
}) {
  const [active, setActive] = useState<ConnectionKind | null>(null);
  const [resolvingEventId, setResolvingEventId] = useState<string | null>(null);
  const [occurrenceChoices, setOccurrenceChoices] = useState<{ eventId: string; options: JournalOccurrenceOption[] } | null>(null);

  const added = [
    ...businesses.map((r) => ({ ...r, kind: "business" as const, typeLabel: "Business" })),
    ...products.map((r) => ({ ...r, kind: "product" as const, typeLabel: "Product" })),
    ...events.map((r) => ({
      ...r,
      kind: "event" as const,
      // Journal V2 Pass 2B — an Event with a resolved occurrence shows
      // its specific date/time instead of the generic "Event" label, so
      // the connected state reads as "A Cup of Love / Thu, Oct 1 ·
      // 11 AM–7 PM" rather than a confusing second "Event" entry.
      typeLabel: occurrence && occurrence.event_id === r.value ? `${formatOccurrenceDate(occurrence)} · ${formatOccurrenceTime(occurrence)}` : "Event",
    })),
  ];

  function remove(kind: ConnectionKind, id: string) {
    if (kind === "business") onRemoveBusiness(id);
    else if (kind === "product") onRemoveProduct(id);
    else {
      onRemoveEvent(id);
      // Removing the parent Event must never leave an orphaned occurrence
      // connection behind (see this pass's own locked removal semantics).
      if (occurrence?.event_id === id) onClearOccurrence();
    }
  }

  async function resolveOccurrencesFor(eventId: string) {
    setOccurrenceChoices(null);
    setResolvingEventId(eventId);
    const options = await getEventOccurrencesForJournal(eventId);
    setResolvingEventId(null);
    if (options.length === 0) return;
    if (options.length === 1) {
      onSelectOccurrence(options[0]);
      return;
    }
    setOccurrenceChoices({ eventId, options });
  }

  const activeEntity = active === "business" ? "businesses" : active === "product" ? "products" : "events";
  const activeExcludeIds = (active === "business" ? businesses : active === "product" ? products : events).map((r) => r.value);

  return (
    <div className="flex flex-col gap-3">
      {added.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/50">Added to This Experience</p>
          <div className="flex flex-col gap-1.5">
            {added.map((r) => (
              <div key={`${r.kind}-${r.value}`} className="flex items-center gap-2.5 rounded-xl border border-black/10 bg-white p-2.5">
                <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-black/5">
                  {r.image_url && <Image src={r.image_url} alt="" fill unoptimized sizes="36px" className="object-cover" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{r.label}</p>
                  <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink/40">{r.typeLabel}</p>
                  {/* Moment V1A — visibility-only upgrade: this was a
                      quiet inline text link easy to miss on an
                      Event-originated entry (the common ambiguous-
                      multi-date case the Event page's own Add Moment flow
                      deliberately leaves unresolved rather than guessing —
                      see journalCaptureActions.ts). Same handler, same
                      component, same "never guess" behavior — just a
                      small accent pill instead of plain text, so an
                      unresolved date reads as something to act on. */}
                  {r.kind === "event" && !occurrence && (
                    <button
                      type="button"
                      onClick={() => resolveOccurrencesFor(r.value)}
                      disabled={resolvingEventId === r.value}
                      className="mt-1 inline-flex items-center rounded-full border border-findmi/40 bg-findmi-50 px-2 py-0.5 text-[11px] font-bold text-findmi-700 transition hover:border-findmi/60 hover:bg-findmi-100 disabled:opacity-50"
                    >
                      {resolvingEventId === r.value ? "Checking dates…" : "Which date was this?"}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(r.kind, r.value)}
                  aria-label={`Remove ${r.label}`}
                  className="shrink-0 px-1 text-base leading-none text-ink/40 transition hover:text-ink"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {occurrenceChoices && (
        <div className="flex flex-col gap-2 rounded-2xl border border-findmi/30 bg-findmi-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/60">Which date was this experience?</p>
            <button type="button" onClick={() => setOccurrenceChoices(null)} className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
              Cancel
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {occurrenceChoices.options.map((occ) => (
              <button
                key={occ.id}
                type="button"
                onClick={() => {
                  onSelectOccurrence(occ);
                  setOccurrenceChoices(null);
                }}
                className="flex items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-left transition hover:border-findmi/40 hover:bg-findmi-50"
              >
                <span className="text-sm font-semibold text-ink">{formatOccurrenceDate(occ)}</span>
                <span className="text-xs text-ink/50">{formatOccurrenceTime(occ)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {active === null ? (
        <div className="flex flex-wrap gap-2">
          <AddTrigger label="Brand or business" onClick={() => setActive("business")} />
          <AddTrigger label="Product" onClick={() => setActive("product")} />
          <AddTrigger label="Event" onClick={() => setActive("event")} />
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl border border-black/10 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
              {active === "business" ? "Add a business" : active === "product" ? "Add a product" : "Add an event"}
            </p>
            <button type="button" onClick={() => setActive(null)} className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
              Close
            </button>
          </div>
          <JournalSearchSelect
            entity={activeEntity}
            placeholder={active === "business" ? "Search businesses…" : active === "product" ? "Search products…" : "Search events, past or upcoming…"}
            excludeIds={activeExcludeIds}
            onSelect={(r) => {
              if (active === "business") {
                onAddBusiness(r);
                setActive(null);
                return;
              }
              if (active === "product") {
                onAddProduct(r);
                setActive(null);
                return;
              }
              // Event — attach the parent Event immediately (always
              // meaningful on its own), then resolve its occurrences
              // asynchronously; the picker above handles 0/1/many.
              onAddEvent(r);
              setActive(null);
              resolveOccurrencesFor(r.value);
            }}
          />
        </div>
      )}
    </div>
  );
}

function AddTrigger({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-3.5 text-xs font-semibold text-ink/70 transition hover:border-findmi/40 hover:bg-findmi-50 hover:text-findmi-700"
    >
      + {label}
    </button>
  );
}
