"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";
import type { MomentPick } from "@/lib/moment-composer";

export type MomentObjectType = "location" | "event" | "business" | "product";

export interface MomentSearchResult extends MomentPick {
  type: MomentObjectType;
}

export const MOMENT_TYPE_LABEL: Record<MomentObjectType, string> = {
  location: "Location",
  event: "Event",
  business: "Business",
  product: "Product",
};

export const MOMENT_TYPE_ICON: Record<MomentObjectType, NavIconKey> = {
  location: "pin",
  event: "calendar",
  business: "storefront",
  product: "tag",
};

/** Moments V2 — one search box across several Findmi object types, so a
 * person never has to decide which database type they're looking for:
 *   mode "where" → Locations + Events
 *   mode "who"   → Businesses + Products + Events
 * Every row says what it is. Picking a result hands it up, clears the
 * query and keeps the box ready for the next search (search → add →
 * search again), and already-picked objects never reappear. */
export default function MomentSearch({
  mode,
  placeholder,
  excludeIds,
  onPick,
}: {
  mode: "where" | "who";
  placeholder: string;
  excludeIds: string[];
  onPick: (result: MomentSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MomentSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/account/search?entity=${mode}&q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data: { results?: MomentSearchResult[] }) => setResults(data.results ?? []))
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, mode]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const excluded = new Set(excludeIds);
  const visible = results.filter((r) => !excluded.has(r.value));
  const showPanel = open && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          // Keep the results visible above a phone keyboard.
          window.setTimeout(() => inputRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
        }}
        placeholder={placeholder}
        enterKeyHint="search"
        className="h-11 w-full scroll-mt-24 rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
      />
      {showPanel && (
        <div className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-black/10 bg-white py-1 shadow-lg">
          {loading && visible.length === 0 && <p className="px-3.5 py-2.5 text-xs text-ink/40">Searching…</p>}
          {!loading && visible.length === 0 && <p className="px-3.5 py-2.5 text-xs text-ink/40">No matches.</p>}
          {visible.map((r) => (
            <button
              key={`${r.type}-${r.value}`}
              type="button"
              onClick={() => {
                onPick(r);
                setQuery("");
                setResults([]);
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-findmi-50/60"
            >
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/5 text-ink/35">
                {r.image_url ? (
                  <Image src={r.image_url} alt="" fill unoptimized sizes="36px" className="object-cover" />
                ) : (
                  <NavIcon name={MOMENT_TYPE_ICON[r.type]} className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{r.label}</span>
                <span className="flex min-w-0 items-center gap-1 text-xs text-ink/50">
                  <span className="shrink-0 font-semibold text-findmi-700">{MOMENT_TYPE_LABEL[r.type]}</span>
                  {r.sublabel && <span className="truncate">· {r.sublabel}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
