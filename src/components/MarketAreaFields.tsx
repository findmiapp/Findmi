"use client";

import { useState } from "react";

const selectClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none disabled:bg-black/[0.03] disabled:text-ink/40";

export interface MarketAreaOption {
  id: string;
  name: string;
}

export interface MarketWithAreaOptions extends MarketAreaOption {
  areas: MarketAreaOption[];
}

/**
 * Event + Appearance Geography Completion pass — the one place Market ->
 * Area cascading selection is implemented, shared by the Admin Event form
 * and the owner Event Manager's Market/Area tab (same pattern as
 * lib/admin/business-markets.ts already being imported from a public
 * account page — admin-namespaced helpers/components with no auth logic
 * of their own are already reused publicly elsewhere in this codebase).
 *
 * Changing Market always clears the Area selection client-side — an Area
 * can never silently keep pointing at a different Market's Area. This is
 * a UX safety net only; the authoritative guard is server-side (each
 * caller's own save action re-validates that the submitted market_area_id
 * actually belongs to the submitted market_id before writing either).
 *
 * Renders two plain named <select> elements (`marketFieldName`/
 * `areaFieldName`, default "market_id"/"market_area_id") — works with any
 * plain <form action={serverAction}>, no client-side submit handling.
 */
export default function MarketAreaFields({
  markets,
  defaultMarketId,
  defaultAreaId,
  marketFieldName = "market_id",
  areaFieldName = "market_area_id",
  marketLabel = "Market",
  areaLabel = "Area",
}: {
  markets: MarketWithAreaOptions[];
  defaultMarketId: string | null;
  defaultAreaId: string | null;
  marketFieldName?: string;
  areaFieldName?: string;
  marketLabel?: string;
  areaLabel?: string;
}) {
  const [marketId, setMarketId] = useState(defaultMarketId ?? "");
  const [areaId, setAreaId] = useState(defaultAreaId ?? "");

  const selectedMarket = markets.find((m) => m.id === marketId);
  const areaOptions = selectedMarket?.areas ?? [];
  // Never render an Area as "selected" if it doesn't belong to the
  // currently-selected Market (covers both an explicit Market change and
  // a stale defaultAreaId that no longer matches defaultMarketId).
  const effectiveAreaId = areaOptions.some((a) => a.id === areaId) ? areaId : "";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">{marketLabel}</span>
        <select
          name={marketFieldName}
          value={marketId}
          onChange={(e) => {
            setMarketId(e.target.value);
            setAreaId("");
          }}
          className={selectClass}
        >
          <option value="">Unassigned</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">{areaLabel}</span>
        <select
          name={areaFieldName}
          value={effectiveAreaId}
          onChange={(e) => setAreaId(e.target.value)}
          disabled={areaOptions.length === 0}
          className={selectClass}
        >
          <option value="">{areaOptions.length === 0 ? "No Areas for this Market" : "No specific Area"}</option>
          {areaOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
