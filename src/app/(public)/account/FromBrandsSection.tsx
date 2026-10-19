"use client";

import { useState } from "react";
import WorldTileCard, { WORLD_KIND_LABEL, type WorldTile } from "./WorldTileCard";

/** From Brands You Follow — Account Home UX Correction pass. The server
 * already fetched every truthful content type once (lib/account-home.ts's
 * fromBrandsTiles); this just filters that same already-fetched array by
 * kind client-side — no new query, no new ranking, one request per page
 * load exactly as before. Tabs render only for kinds the current data
 * model actually produced (never a tab promising a type with nothing
 * behind it), and only when there's more than one real kind to choose
 * between. */
const TAB_ORDER: WorldTile["kind"][] = ["moment", "event", "product", "location"];

export default function FromBrandsSection({ tiles }: { tiles: WorldTile[] }) {
  const [tab, setTab] = useState<"all" | WorldTile["kind"]>("all");
  const available = TAB_ORDER.filter((k) => tiles.some((t) => t.kind === k));
  const visible = tab === "all" ? tiles : tiles.filter((t) => t.kind === tab);

  return (
    <>
      {available.length > 1 && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
          <FilterPill label="All" active={tab === "all"} onClick={() => setTab("all")} />
          {available.map((k) => (
            <FilterPill key={k} label={`${WORLD_KIND_LABEL[k]}s`} active={tab === k} onClick={() => setTab(k)} />
          ))}
        </div>
      )}
      <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:scroll-px-0 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
        {visible.map((tile) => (
          <WorldTileCard key={tile.key} tile={tile} size="large" />
        ))}
      </div>
    </>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 shrink-0 rounded-full border px-3.5 text-metadata font-semibold leading-8 transition ${
        active ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-ink/65 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
