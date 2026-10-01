"use client";

import { useState } from "react";
import Image from "next/image";
import JournalSearchSelect, { type JournalSearchResult } from "./JournalSearchSelect";

type ConnectionKind = "business" | "product" | "event";

/** Journal V1.1 — progressive-disclosure replacement for three
 * always-visible search boxes (Businesses/Products/Events) in Create
 * Step 3 and Edit's Connections section. The three persisted relationship
 * types are unchanged (still Business/Product/Event rows in
 * journal_entry_connections, via the same saveJournalConnections action
 * and the same JournalSearchSelect/`/api/account/search` route) — only
 * the UI collapses to compact "+ Brand or business / + Product / + Event"
 * triggers, expanding ONE inline search at a time, with everything
 * already added shown together in one "Added to This Experience" list
 * rather than three separate always-expanded group sections. */
export default function JournalConnectionsPicker({
  businesses,
  products,
  events,
  onAddBusiness,
  onRemoveBusiness,
  onAddProduct,
  onRemoveProduct,
  onAddEvent,
  onRemoveEvent,
}: {
  businesses: JournalSearchResult[];
  products: JournalSearchResult[];
  events: JournalSearchResult[];
  onAddBusiness: (r: JournalSearchResult) => void;
  onRemoveBusiness: (id: string) => void;
  onAddProduct: (r: JournalSearchResult) => void;
  onRemoveProduct: (id: string) => void;
  onAddEvent: (r: JournalSearchResult) => void;
  onRemoveEvent: (id: string) => void;
}) {
  const [active, setActive] = useState<ConnectionKind | null>(null);

  const added = [
    ...businesses.map((r) => ({ ...r, kind: "business" as const, typeLabel: "Business" })),
    ...products.map((r) => ({ ...r, kind: "product" as const, typeLabel: "Product" })),
    ...events.map((r) => ({ ...r, kind: "event" as const, typeLabel: "Event" })),
  ];

  function remove(kind: ConnectionKind, id: string) {
    if (kind === "business") onRemoveBusiness(id);
    else if (kind === "product") onRemoveProduct(id);
    else onRemoveEvent(id);
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
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink/40">{r.typeLabel}</p>
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
            placeholder={active === "business" ? "Search businesses…" : active === "product" ? "Search products…" : "Search events…"}
            excludeIds={activeExcludeIds}
            onSelect={(r) => {
              if (active === "business") onAddBusiness(r);
              else if (active === "product") onAddProduct(r);
              else onAddEvent(r);
              setActive(null);
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
