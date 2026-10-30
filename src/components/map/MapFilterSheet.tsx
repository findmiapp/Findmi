"use client";

import { useEffect, useRef, useState } from "react";
import { AUDIENCE_LABELS, BENEFIT_LABELS, ENTRY_LABELS, EVENT_AUDIENCES, EVENT_BENEFITS, ENTRY_MODES, type EventBenefit } from "@/lib/discovery/attributes";
import { clearedRefinements, isUneditableRefinement, lensNoun, MAP_LENSES, MAP_TIME_SHORTCUTS, MAP_WHEN_LABELS, mapLens, mapRefinements, withLens, type MapFacets } from "@/lib/discovery/map-filters";
import { TIME_OF_DAY_LABELS, TIMES_OF_DAY, type DiscoveryQuery, type MatchMode } from "@/lib/discovery/query";

export interface TaxonomyOption {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
}

export interface FilterOptions {
  categories: TaxonomyOption[];
  formats: { slug: string; name: string }[];
}

type DateMode = "quick" | "date" | "range" | "month" | "year";

function Chip({ on, children, onClick, disabled }: { on: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold transition ${on ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-ink/75 hover:border-black/25"} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-black/5 py-4 last:border-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="font-display text-[15px] font-bold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ModeToggle({ value, onChange, label }: { value: MatchMode; onChange: (m: MatchMode) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-black/[0.05] p-0.5 text-[11px] font-bold">
      {(["any", "all"] as MatchMode[]).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)} className={`rounded-full px-2.5 py-1 ${value === m ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}>
          {m === "any" ? "Any Of These" : "All Of These"}
        </button>
      ))}
    </div>
  );
}

const toggle = <T,>(list: T[] | undefined, v: T): T[] | undefined => {
  const has = list?.includes(v);
  const next = has ? list!.filter((x) => x !== v) : [...(list ?? []), v];
  return next.length ? next : undefined;
};

const clearTime = (q: DiscoveryQuery): DiscoveryQuery => {
  const { when: _w, date: _d, from: _f, to: _t, month: _m, year: _y, ...rest } = q;
  return rest;
};

/** A draft count: the total, plus what the draft's candidates can satisfy. */
export interface DraftCount {
  total: number;
  facets?: MapFacets;
}

/** Offered = available in the candidate set OR already chosen (a chosen
 * value always stays visible and removable). No facets → everything. */
const offer = <T extends string>(all: readonly T[], available: readonly string[] | undefined, chosen: readonly string[] | undefined): T[] =>
  available ? all.filter((v) => available.includes(v) || chosen?.includes(v)) : [...all];

export default function MapFilterSheet({
  initial,
  options,
  onApply,
  onClose,
  count,
  facets: initialFacets,
  labels = {},
}: {
  initial: DiscoveryQuery;
  options: FilterOptions;
  onApply: (q: DiscoveryQuery) => void;
  onClose: () => void;
  /** Result count (+ availability) for a draft (debounced + cached by the
   * caller). */
  count: (q: DiscoveryQuery, signal: AbortSignal) => Promise<DraftCount | null>;
  /** Availability for the applied query, until the draft's own arrives. */
  facets?: MapFacets;
  /** Display names for applied chips (Topics, Brands…) by chip key. */
  labels?: Record<string, string>;
}) {
  const [draft, setDraft] = useState<DiscoveryQuery>(() => ({ ...initial, offset: undefined }));
  const [dateMode, setDateMode] = useState<DateMode>(initial.date ? "date" : initial.from || initial.to ? "range" : initial.month ? "month" : initial.year ? "year" : "quick");
  const [customTime, setCustomTime] = useState(Boolean(initial.tfrom || initial.tto));
  const [showFormats, setShowFormats] = useState(Boolean(initial.formats?.length));
  const [n, setN] = useState<number | null>(null);
  const [facets, setFacets] = useState<MapFacets | undefined>(initialFacets);
  const [counting, setCounting] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<DiscoveryQuery>) => setDraft((d) => {
    const next = { ...d, ...patch };
    for (const k of Object.keys(next) as (keyof DiscoveryQuery)[]) if (next[k] === undefined) delete next[k];
    return next;
  });

  useEffect(() => {
    const ctl = new AbortController();
    setCounting(true);
    const t = setTimeout(() => {
      count(draft, ctl.signal)
        // Keep the last known count on screen until the new one arrives.
        .then((v) => {
          if (ctl.signal.aborted || v === null) return;
          setN(v.total);
          if (v.facets) setFacets(v.facets);
        })
        .finally(() => !ctl.signal.aborted && setCounting(false));
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [draft, count]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const lens = mapLens(draft);
  const noun = `${lensNoun(draft)}s`;
  const happening = lens === "happening";
  const chooseLens = (next: typeof lens) => {
    if (next === lens) return;
    setDateMode("quick");
    setCustomTime(false);
    setDraft((d) => withLens(d, next));
  };

  // Offered options: what the candidates can satisfy, plus what's chosen.
  const chosenCats = draft.categories ?? [];
  const catOffered = (slug: string) => !facets || facets.categories.includes(slug) || chosenCats.includes(slug);
  const categories = options.categories
    .map((c) => ({ ...c, children: c.children.filter((k) => catOffered(k.slug)) }))
    .filter((c) => catOffered(c.slug) || c.children.length > 0);
  const formats = options.formats.filter((f) => !facets || facets.formats.includes(f.slug) || draft.formats?.includes(f.slug));
  const selectedTop = categories.filter((c) => chosenCats.includes(c.slug) || c.children.some((k) => chosenCats.includes(k.slug)));
  // A child chosen with its own parent narrows nothing extra — it isn't a
  // second value to combine Any / All.
  const parentOf = new Map(options.categories.flatMap((c) => c.children.map((k) => [k.slug, c.slug] as const)));
  const taxCount = chosenCats.filter((s) => !chosenCats.includes(parentOf.get(s) ?? "")).length + (draft.formats?.length ?? 0);
  const showFree = !facets || facets.free || Boolean(draft.free);
  const showPaid = !facets || facets.paid || Boolean(draft.paid);
  const benefits = offer(EVENT_BENEFITS.filter((b) => b !== "free_admission"), facets?.benefits, draft.benefits);
  const audiences = offer(EVENT_AUDIENCES, facets?.audience, draft.audience);
  const entries = offer(ENTRY_MODES, facets?.entry, draft.entry);
  const showOpen = !facets || facets.open || Boolean(draft.open);
  const alsoApplied = mapRefinements(draft).filter((c) => isUneditableRefinement(c.key));

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 lg:items-stretch lg:justify-end" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-filters-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-xl lg:max-h-none lg:w-[440px] lg:rounded-none"
      >
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <button type="button" onClick={onClose} className="min-h-10 rounded-full px-2 text-sm font-semibold text-ink/60 hover:text-ink">
            Cancel
          </button>
          <h2 id="map-filters-title" className="font-display text-base font-bold text-ink">
            Filters
          </h2>
          <button
            type="button"
            onClick={() => {
              // Refinements go; the lens, geography and the search stay.
              setDraft(clearedRefinements(draft));
              setDateMode("quick");
              setCustomTime(false);
            }}
            className="min-h-10 rounded-full px-2 text-sm font-semibold text-findmi-700 hover:underline"
          >
            Clear
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4">
          <Section title="Show">
            <div className="flex flex-wrap gap-2">
              {MAP_LENSES.map((l) => (
                <Chip key={l.lens} on={lens === l.lens} onClick={() => chooseLens(l.lens)}>
                  {l.label}
                </Chip>
              ))}
            </div>
            {lens === "all" && <p className="mt-2.5 text-sm text-ink/60">Choose what you want to explore to see more filters.</p>}
            {lens === "place" && showOpen && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Chip on={draft.open === "now"} onClick={() => set({ open: draft.open ? undefined : "now" })}>Open Now</Chip>
              </div>
            )}
          </Section>

          {alsoApplied.length > 0 && (
            <Section title="Also Applied">
              <div className="flex flex-wrap gap-2">
                {alsoApplied.map((c) => (
                  <button key={c.key} type="button" onClick={() => setDraft(() => {
                    const { offset: _o, ...next } = c.without;
                    return next;
                  })} aria-label={`Remove ${labels[c.key] ?? c.label}`} className="flex min-h-9 items-center gap-1.5 rounded-full border border-findmi/40 bg-findmi-50 px-3 text-[13px] font-semibold text-findmi-700 hover:border-findmi">
                    {labels[c.key] ?? c.label}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" className="h-3 w-3" aria-hidden>
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {happening && (
            <Section title="When">
              <div className="flex flex-wrap gap-2">
                {MAP_TIME_SHORTCUTS.filter((w) => !facets?.when || facets.when.includes(w) || draft.when === w).map((w) => (
                  <Chip key={w} on={dateMode === "quick" && draft.when === w} onClick={() => { setDateMode("quick"); setDraft((d) => ({ ...clearTime(d), ...(d.when === w ? {} : { when: w }) })); }}>
                    {MAP_WHEN_LABELS[w]}
                  </Chip>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["date", "range", "month", "year"] as DateMode[]).map((m) => (
                  <Chip key={m} on={dateMode === m} onClick={() => { setDateMode(m); setDraft((d) => clearTime(d)); }}>
                    {m === "date" ? "Choose Date" : m === "range" ? "Date Range" : m === "month" ? "Browse Month" : "Browse Year"}
                  </Chip>
                ))}
              </div>
              {dateMode === "date" && (
                <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-ink/60">
                  Date
                  <input type="date" value={draft.date ?? ""} onChange={(e) => set({ date: e.target.value || undefined })} className="min-h-11 rounded-xl border border-black/10 px-3 text-sm text-ink" />
                </label>
              )}
              {dateMode === "range" && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
                    From
                    <input type="date" value={draft.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} className="min-h-11 rounded-xl border border-black/10 px-3 text-sm text-ink" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
                    To
                    <input type="date" value={draft.to ?? ""} min={draft.from} onChange={(e) => set({ to: e.target.value || undefined })} className="min-h-11 rounded-xl border border-black/10 px-3 text-sm text-ink" />
                  </label>
                </div>
              )}
              {dateMode === "month" && (
                <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-ink/60">
                  Month
                  <input type="month" value={draft.month ?? ""} onChange={(e) => set({ month: e.target.value || undefined })} className="min-h-11 rounded-xl border border-black/10 px-3 text-sm text-ink" />
                </label>
              )}
              {dateMode === "year" && (
                <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-ink/60">
                  Year
                  <select value={draft.year ?? ""} onChange={(e) => set({ year: e.target.value || undefined })} className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink">
                    <option value="">Choose a year</option>
                    {[0, 1].map((k) => {
                      const y = String(new Date().getFullYear() + k);
                      return (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}
              {draft.when !== "now" && draft.when !== "upnext" && (
                <>
                  <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-ink/45">Time</h4>
                  <div className="flex flex-wrap gap-2">
                    <Chip on={!draft.tod && !customTime} onClick={() => { setCustomTime(false); set({ tod: undefined, tfrom: undefined, tto: undefined }); }}>Any Time</Chip>
                    {TIMES_OF_DAY.map((t) => (
                      <Chip key={t} on={!customTime && draft.tod === t} onClick={() => { setCustomTime(false); set({ tod: draft.tod === t ? undefined : t, tfrom: undefined, tto: undefined }); }}>
                        {TIME_OF_DAY_LABELS[t]}
                      </Chip>
                    ))}
                    <Chip on={customTime} onClick={() => { setCustomTime(true); set({ tod: undefined }); }}>Custom</Chip>
                  </div>
                  {customTime && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
                        Starting
                        <input type="time" step={900} value={draft.tfrom ?? ""} onChange={(e) => set({ tfrom: e.target.value || undefined })} className="min-h-11 rounded-xl border border-black/10 px-3 text-sm text-ink" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
                        Until
                        <input type="time" step={900} value={draft.tto ?? ""} onChange={(e) => set({ tto: e.target.value || undefined })} className="min-h-11 rounded-xl border border-black/10 px-3 text-sm text-ink" />
                      </label>
                    </div>
                  )}
                </>
              )}
            </Section>
          )}

          {happening && (categories.length > 0 || formats.length > 0 || (draft.brands?.length ?? 0) > 1) && (
            <Section title="What" aside={taxCount > 1 ? <ModeToggle label="Match categories" value={draft.catMode ?? "any"} onChange={(m) => set({ catMode: m === "any" ? undefined : m })} /> : null}>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <Chip key={c.slug} on={Boolean(draft.categories?.includes(c.slug))} onClick={() => set({ categories: toggle(draft.categories, c.slug) })}>
                    {c.name}
                  </Chip>
                ))}
              </div>
              {selectedTop.filter((c) => c.children.length).map((c) => (
                <div key={c.slug} className="mt-3">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/45">{c.name}</h4>
                  <div className="flex flex-wrap gap-2">
                    {c.children.map((k) => (
                      <Chip key={k.slug} on={Boolean(draft.categories?.includes(k.slug))} onClick={() => set({ categories: toggle(draft.categories, k.slug) })}>
                        {k.name}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
              {formats.length > 0 && (
                <div className="mt-3">
                  <button type="button" aria-expanded={showFormats} onClick={() => setShowFormats((v) => !v)} className="text-xs font-bold text-findmi-700 hover:underline">
                    {showFormats ? "Fewer Types" : "More Types"}
                  </button>
                  {showFormats && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formats.map((f) => (
                        <Chip key={f.slug} on={Boolean(draft.formats?.includes(f.slug))} onClick={() => set({ formats: toggle(draft.formats, f.slug) })}>
                          {f.name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(draft.brands?.length ?? 0) > 1 && (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink/60">{draft.brands!.length} Brands</span>
                  <ModeToggle label="Match brands" value={draft.brandMode ?? "any"} onChange={(m) => set({ brandMode: m === "any" ? undefined : m })} />
                </div>
              )}
            </Section>
          )}

          {happening && (showFree || showPaid || benefits.length > 0) && (
            <Section title="Cost & Perks" aside={(draft.benefits?.length ?? 0) > 1 ? <ModeToggle label="Match perks" value={draft.benefitMode ?? "all"} onChange={(m) => set({ benefitMode: m === "all" ? undefined : m })} /> : null}>
              {(showFree || showPaid) && (
                <div className="flex flex-wrap gap-2">
                  <Chip on={!draft.free && !draft.paid} onClick={() => set({ free: undefined, paid: undefined })}>Any</Chip>
                  {showFree && <Chip on={Boolean(draft.free)} onClick={() => set({ free: draft.free ? undefined : true, paid: undefined })}>Free</Chip>}
                  {showPaid && <Chip on={Boolean(draft.paid)} onClick={() => set({ paid: draft.paid ? undefined : true, free: undefined })}>Paid</Chip>}
                </div>
              )}
              <div className={`flex flex-wrap gap-2 ${showFree || showPaid ? "mt-3" : ""}`}>
                {benefits.map((b: EventBenefit) => (
                  <Chip key={b} on={Boolean(draft.benefits?.includes(b))} onClick={() => set({ benefits: toggle(draft.benefits, b) })}>
                    {BENEFIT_LABELS[b]}
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          {happening && (audiences.length > 0 || entries.length > 0) && (
            <Section title="Who & How">
              <div className="flex flex-wrap gap-2">
                {audiences.map((a) => (
                  <Chip key={a} on={Boolean(draft.audience?.includes(a))} onClick={() => set({ audience: toggle(draft.audience, a) })}>
                    {AUDIENCE_LABELS[a]}
                  </Chip>
                ))}
              </div>
              <div className={`flex flex-wrap gap-2 ${audiences.length ? "mt-3" : ""}`}>
                {entries.map((m) => (
                  <Chip key={m} on={Boolean(draft.entry?.includes(m))} onClick={() => set({ entry: toggle(draft.entry, m) })}>
                    {ENTRY_LABELS[m]}
                  </Chip>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="border-t border-black/5 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {n === 0 && !counting && <p className="mb-2 text-center text-xs text-ink/60">Nothing matches all of these. Remove a filter to see results.</p>}
          <button
            type="button"
            onClick={() => onApply(draft)}
            disabled={n === 0 && !counting}
            aria-live="polite"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-findmi text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(20,176,188,0.35)] hover:bg-findmi-600 disabled:bg-black/[0.08] disabled:text-ink/45 disabled:shadow-none"
          >
            {n === null ? `Show ${noun}` : n === 0 ? `0 ${noun}` : `Show ${n.toLocaleString()} ${n === 1 ? noun.replace(/s$/, "") : noun}`}
            {counting && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" />}
          </button>
        </div>
      </div>
    </div>
  );
}
