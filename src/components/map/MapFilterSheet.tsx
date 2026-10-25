"use client";

import { useEffect, useRef, useState } from "react";
import { AUDIENCE_LABELS, BENEFIT_LABELS, ENTRY_LABELS, EVENT_AUDIENCES, EVENT_BENEFITS, ENTRY_MODES, type EventBenefit } from "@/lib/discovery/attributes";
import { TIME_OF_DAY_LABELS, TIMES_OF_DAY, WHEN_LABELS, type DiscoveryQuery, type DiscoveryWhen, type MatchMode } from "@/lib/discovery/query";

export interface TaxonomyOption {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
}

export interface FilterOptions {
  categories: TaxonomyOption[];
  formats: { slug: string; name: string }[];
}

const QUICK_WHEN: DiscoveryWhen[] = ["now", "upnext", "today", "tomorrow", "weekend", "week", "next_week", "month", "next_month"];
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

export default function MapFilterSheet({
  initial,
  options,
  onApply,
  onClose,
  count,
}: {
  initial: DiscoveryQuery;
  options: FilterOptions;
  onApply: (q: DiscoveryQuery) => void;
  onClose: () => void;
  /** Result count for a draft (debounced + cached by the caller). */
  count: (q: DiscoveryQuery, signal: AbortSignal) => Promise<number | null>;
}) {
  const [draft, setDraft] = useState<DiscoveryQuery>(() => ({ ...initial, offset: undefined }));
  const [dateMode, setDateMode] = useState<DateMode>(initial.date ? "date" : initial.from || initial.to ? "range" : initial.month ? "month" : initial.year ? "year" : "quick");
  const [customTime, setCustomTime] = useState(Boolean(initial.tfrom || initial.tto));
  const [showFormats, setShowFormats] = useState(Boolean(initial.formats?.length));
  const [n, setN] = useState<number | null>(null);
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
        .then((v) => !ctl.signal.aborted && setN(v))
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

  const lens = draft.entities?.length === 1 ? draft.entities[0] : null;
  const noun = lens === "event" ? "Events" : lens === "place" ? "Places" : "Results";
  const selectedTop = options.categories.filter((c) => draft.categories?.includes(c.slug) || c.children.some((k) => draft.categories?.includes(k.slug)));
  const taxCount = (draft.categories?.length ?? 0) + (draft.formats?.length ?? 0);
  const placesOnly = lens === "place";

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
              const keep: DiscoveryQuery = {};
              for (const k of ["bbox", "area", "market", "census", "place", "near", "radius", "text", "brands"] as const) if (draft[k] !== undefined) (keep as Record<string, unknown>)[k] = draft[k];
              setDraft(keep);
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
              <Chip on={!lens} onClick={() => set({ entities: undefined, open: undefined })}>Everything</Chip>
              <Chip on={lens === "event"} onClick={() => set({ entities: ["event"], open: undefined })}>Events</Chip>
              <Chip on={lens === "appearance"} onClick={() => set({ entities: ["appearance"], open: undefined })}>Pop-Ups</Chip>
              <Chip on={lens === "place"} onClick={() => { setDateMode("quick"); setDraft((d) => ({ ...clearTime(d), entities: ["place"] })); }}>Places</Chip>
            </div>
            {placesOnly && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Chip on={draft.open === "now"} onClick={() => set({ open: draft.open ? undefined : "now" })}>Open Now</Chip>
              </div>
            )}
          </Section>

          {!placesOnly && (
            <Section title="When">
              <div className="flex flex-wrap gap-2">
                {QUICK_WHEN.map((w) => (
                  <Chip key={w} on={dateMode === "quick" && draft.when === w} onClick={() => { setDateMode("quick"); setDraft((d) => ({ ...clearTime(d), ...(d.when === w ? {} : { when: w }) })); }}>
                    {WHEN_LABELS[w]}
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

          {!placesOnly && (
            <Section title="What" aside={taxCount > 1 ? <ModeToggle label="Match categories" value={draft.catMode ?? "any"} onChange={(m) => set({ catMode: m === "any" ? undefined : m })} /> : null}>
              <div className="flex flex-wrap gap-2">
                {options.categories.map((c) => (
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
              {options.formats.length > 0 && (
                <div className="mt-3">
                  <button type="button" aria-expanded={showFormats} onClick={() => setShowFormats((v) => !v)} className="text-xs font-bold text-findmi-700 hover:underline">
                    {showFormats ? "Fewer Types" : "More Types"}
                  </button>
                  {showFormats && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {options.formats.map((f) => (
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

          {!placesOnly && (
            <Section title="Cost & Perks" aside={(draft.benefits?.length ?? 0) > 1 ? <ModeToggle label="Match perks" value={draft.benefitMode ?? "all"} onChange={(m) => set({ benefitMode: m === "all" ? undefined : m })} /> : null}>
              <div className="flex flex-wrap gap-2">
                <Chip on={!draft.free && !draft.paid} onClick={() => set({ free: undefined, paid: undefined })}>Any</Chip>
                <Chip on={Boolean(draft.free)} onClick={() => set({ free: draft.free ? undefined : true, paid: undefined })}>Free</Chip>
                <Chip on={Boolean(draft.paid)} onClick={() => set({ paid: draft.paid ? undefined : true, free: undefined })}>Paid</Chip>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {EVENT_BENEFITS.filter((b) => b !== "free_admission").map((b: EventBenefit) => (
                  <Chip key={b} on={Boolean(draft.benefits?.includes(b))} onClick={() => set({ benefits: toggle(draft.benefits, b) })}>
                    {BENEFIT_LABELS[b]}
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          {!placesOnly && (
            <Section title="Who & How">
              <div className="flex flex-wrap gap-2">
                {EVENT_AUDIENCES.map((a) => (
                  <Chip key={a} on={Boolean(draft.audience?.includes(a))} onClick={() => set({ audience: toggle(draft.audience, a) })}>
                    {AUDIENCE_LABELS[a]}
                  </Chip>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {ENTRY_MODES.map((m) => (
                  <Chip key={m} on={Boolean(draft.entry?.includes(m))} onClick={() => set({ entry: toggle(draft.entry, m) })}>
                    {ENTRY_LABELS[m]}
                  </Chip>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="border-t border-black/5 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => onApply(draft)} className="flex min-h-12 w-full items-center justify-center rounded-full bg-findmi text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(20,176,188,0.35)] hover:bg-findmi-600" aria-live="polite">
            {n === null ? (counting ? "Counting…" : `Show ${noun}`) : n === 0 ? `No ${noun} Match` : `Show ${n} ${n === 1 ? noun.replace(/s$/, "") : noun}`}
          </button>
        </div>
      </div>
    </div>
  );
}
