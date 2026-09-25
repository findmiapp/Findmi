"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";
import SupabaseImage from "@/components/SupabaseImage";

export type ManagedEntityKind = "business" | "event" | "location";

export interface ManagedEntity {
  kind: ManagedEntityKind;
  id: string;
  name: string;
  pills: ({ label: string; tone: "warning" | "pro" } | null)[];
  href: string;
  cta: string;
  /** Mobile Command Center V2 — real entity imagery (see page.tsx's own
   * precedence comment at the managedEntities call site) so this row
   * reads as "that specific business/event/location," not a generic
   * type icon. Null falls back to the same NavIcon-in-a-circle treatment
   * this list always used. */
  imageUrl: string | null;
}

const FILTERS: { key: "all" | ManagedEntityKind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "business", label: "Businesses" },
  { key: "event", label: "Events" },
  { key: "location", label: "Locations" },
];

const ICON_BY_KIND: Record<ManagedEntityKind, NavIconKey> = {
  business: "storefront",
  event: "calendar",
  location: "pin",
};

const TYPE_LABEL_BY_KIND: Record<ManagedEntityKind, string> = {
  business: "Business",
  event: "Event",
  location: "Location",
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
      {/* Final Action-Bar Polish pass — real-device QA showed "Locations"
          clipped inside the old overflow-x-auto strip at ~360px. A 2x2
          grid below `sm` guarantees all four filters are fully visible
          and readable (no truncation, no shrunk tap targets, no
          scrolling required to discover the 4th option); from `sm` up
          there's ample width for the original single row. Same button
          styling/behavior either way — only the container layout
          changed. */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`w-full whitespace-nowrap rounded-full px-3.5 py-1.5 text-center text-xs font-bold uppercase tracking-wide transition sm:w-auto ${
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

/** Mobile Command Center V2 — the whole row is now the one, single
 * navigation target (previously only the small trailing CTA button
 * was tappable, a poor mobile target). The former CTA <Link> becomes a
 * plain <span> styled the same way, so this stays one valid anchor
 * rather than a nested/invalid <a> inside an <a>. Same href, same
 * visible action language, same badges/filtering — navigation
 * semantics unchanged. */
function EntityRow({ entity, showType }: { entity: ManagedEntity; showType: boolean }) {
  const activePills = entity.pills.filter((p): p is { label: string; tone: "warning" | "pro" } => Boolean(p));
  return (
    <Link
      href={entity.href}
      className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-2.5 shadow-sm transition hover:border-black/10 active:scale-[0.99]"
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-findmi-50 text-findmi-700">
        {entity.imageUrl ? (
          <SupabaseImage src={entity.imageUrl} alt={entity.name} fill sizes="40px" className="object-cover" />
        ) : (
          <NavIcon name={ICON_BY_KIND[entity.kind]} className="h-4 w-4" />
        )}
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
      <span className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white">
        {entity.cta} →
      </span>
    </Link>
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
