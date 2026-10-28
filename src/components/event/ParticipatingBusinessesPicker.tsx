"use client";

import { useState } from "react";
import { useAccountSearch, type AccountSearchResult } from "@/components/account/useAccountSearch";

/** Host An Event Quick Create — Participating Businesses / Brands. Searches
 * EXISTING Findmi Businesses only (the same bounded /api/account/search the
 * Event Manager's participant search uses) — no duplicate Business is ever
 * created here. Each chosen Business is invited through the ONE participant
 * write (event_businesses 'invited') when the Event is created, and shows
 * on the Event once it confirms. Hidden inputs: participant_business_ids. */
export const MAX_QUICK_PARTICIPANTS = 12;

export default function ParticipatingBusinessesPicker({ hostBusinessId, inputClass }: { hostBusinessId: string | null; inputClass: string }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<AccountSearchResult[]>([]);
  const { results, loading } = useAccountSearch("businesses", query.trim().length >= 2 ? query : "");
  const options = results.filter((r) => r.value !== hostBusinessId && !chosen.some((c) => c.value === r.value)).slice(0, 6);
  const add = (r: AccountSearchResult) => {
    if (chosen.length >= MAX_QUICK_PARTICIPANTS) return;
    setChosen((c) => [...c, r]);
    setQuery("");
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 block text-body font-medium text-primary">
        Participating Businesses <span className="font-normal text-subtle">(optional)</span>
      </legend>
      <p className="-mt-1 text-metadata text-muted">Brands, vendors or partners taking part. Each one is invited and shows on the Event once they confirm.</p>
      {chosen.map((c) => (
        <input key={c.value} type="hidden" name="participant_business_ids" value={c.value} />
      ))}
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((c) => (
            <li key={c.value} className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white py-1 pl-3 pr-1 text-metadata font-semibold text-primary">
              {c.label}
              <button type="button" onClick={() => setChosen((all) => all.filter((x) => x.value !== c.value))} aria-label={`Remove ${c.label}`} className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-black/[0.05] hover:text-primary">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen.length < MAX_QUICK_PARTICIPANTS && (
        <input
          type="search"
          autoCapitalize="words"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          placeholder="Search Findmi Businesses"
          autoComplete="off"
          className={inputClass}
        />
      )}
      {query.trim().length >= 2 && (
        <ul className="flex flex-col divide-y divide-black/[0.06] rounded-xl border border-black/[0.08] bg-white">
          {loading && options.length === 0 && <li className="px-3 py-2 text-metadata text-muted">Searching…</li>}
          {!loading && options.length === 0 && <li className="px-3 py-2 text-metadata text-muted">No Findmi Business matches. You can add more from the Event Manager later.</li>}
          {options.map((r) => (
            <li key={r.value}>
              <button type="button" onClick={() => add(r)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.02]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-primary">{r.label}</span>
                  {r.sublabel && <span className="block truncate text-metadata text-muted">{r.sublabel}</span>}
                </span>
                <span className="shrink-0 text-metadata font-bold text-accent">Add</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
