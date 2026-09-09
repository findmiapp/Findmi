"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";

export type ManagedEntityKind = "business" | "event" | "location";

export interface ManagedEntity {
  kind: ManagedEntityKind;
  id: string;
  name: string;
  pills: ({ label: string; tone: "warning" | "pro" } | null)[];
  href: string;
  cta: string;
}

const FILTERS: { key: "all" | ManagedEntityKind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "business", label: "Businesses" },
  { key: "event", label: "Events" },
  { key: "location", label: "Venues" },
];

const ICON_BY_KIND: Record<ManagedEntityKind, NavIconKey> = {
  business: "storefront",
  event: "calendar",
  location: "pin",
};

const TYPE_LABEL_BY_KIND: Record<ManagedEntityKind, string> = {
  business: "Business",
  event: "Event",
  location: "Venue",
};

/**
 * Owner Action UX pass — Manage on Findmi stays ONE unified list (never
 * three separate stacked dashboards), but is now filterable. Lightweight
 * client-side filtering of the entities /account already loaded and
 * passed down — no new query for this. Default "All" shows a small type
 * label next to the icon (an icon alone isn't always enough to tell
 * Business/Event/Venue apart at a glance); the type-specific tabs omit it
 * since it's already implied by the filter itself.
 */
/** Authenticated Menu Cleanup pass — the hamburger drawer's own Manage
 * section (Businesses/Events/Locations) needs a real destination for
 * each concept without inventing a new page; this list is already
 * "currently the only safe canonical route" for all three (Section 6's
 * own escape hatch), so it just needed to be deep-linkable. `?manage=`
 * only ever SEEDS the initial filter (same three ManagedEntityKind
 * values, or anything else/absent falls back to "all" exactly as
 * before) — the tab buttons below remain the same plain client-side
 * useState toggle, no URL sync on every click, no new fetch, no new
 * entity-management architecture. */
function initialFilterFromSearchParams(raw: string | null): "all" | ManagedEntityKind {
  return raw === "business" || raw === "event" || raw === "location" ? raw : "all";
}

export default function ManageOnFindmiList({ entities }: { entities: ManagedEntity[] }) {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<"all" | ManagedEntityKind>(() => initialFilterFromSearchParams(searchParams.get("manage")));
  const visible = filter === "all" ? entities : entities.filter((e) => e.kind === filter);

  return (
    <>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
              filter === f.key ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {visible.map((e) => (
          <EntityRow key={`${e.kind}-${e.id}`} entity={e} showType={filter === "all"} />
        ))}
      </div>
    </>
  );
}

function EntityRow({ entity, showType }: { entity: ManagedEntity; showType: boolean }) {
  const activePills = entity.pills.filter((p): p is { label: string; tone: "warning" | "pro" } => Boolean(p));
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-2.5 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
        <NavIcon name={ICON_BY_KIND[entity.kind]} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{entity.name}</p>
        {(showType || activePills.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {showType && <StatusPill tone="type">{TYPE_LABEL_BY_KIND[entity.kind]}</StatusPill>}
            {activePills.map((p) => (
              <StatusPill key={p.label} tone={p.tone}>
                {p.label}
              </StatusPill>
            ))}
          </div>
        )}
      </div>
      <Link
        href={entity.href}
        className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        {entity.cta} →
      </Link>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "warning" | "pro" | "type"; children: ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        tone === "pro" ? "bg-findmi-50 text-findmi-700" : tone === "type" ? "bg-black/[0.06] text-ink/50" : "bg-amber-100 text-amber-800"
      }`}
    >
      {children}
    </span>
  );
}
