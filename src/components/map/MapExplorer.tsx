"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { bboxAround, type Bbox, type MapFeature } from "@/lib/discovery/map-core";
import type { MapResponse, MapResultCard as Card } from "@/lib/discovery/map-server";
import { mapHref, paramsToQuery, queryKey, queryToParams, type DiscoveryQuery, type DiscoveryWhen } from "@/lib/discovery/query";
import { NEAR_ME_RADIUS_MILES } from "@/lib/map-config";
import MapResultCard from "./MapResultCard";
import MapFilterSheet, { type FilterOptions } from "./MapFilterSheet";

// Discovery Map + Feed — ONE Discovery Query, one result set, two
// renderers. The map never fetches while it moves: panning only reveals
// "Search This Area"; any filter / chip / search change re-runs the same
// query for both the markers and the list. Selection is shared: a marker
// selects its results, a result highlights and pans to its marker.

const DiscoveryMapCanvas = dynamic(() => import("./DiscoveryMapCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#eef0ef] motion-reduce:animate-none" />,
});

type Sheet = "peek" | "half" | "full";
type View = "map" | "feed";

const GEO_KEYS: (keyof DiscoveryQuery)[] = ["bbox", "area", "market", "census", "place", "near", "radius"];
const withoutGeo = (q: DiscoveryQuery): DiscoveryQuery => {
  const next = { ...q };
  for (const k of GEO_KEYS) delete next[k];
  return next;
};
const fromHref = (href: string): { query: DiscoveryQuery; view: View } => {
  const p = new URLSearchParams(href.split("?")[1] ?? "");
  return { query: paramsToQuery(p), view: p.get("view") === "feed" ? "feed" : "map" };
};
const bboxOf = (features: MapFeature[]): Bbox | null => {
  if (!features.length) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const f of features) {
    w = Math.min(w, f.lng);
    e = Math.max(e, f.lng);
    s = Math.min(s, f.lat);
    n = Math.max(n, f.lat);
  }
  const pad = 0.004;
  return [w - pad, s - pad, e + pad, n + pad];
};
const movedEnough = (a: Bbox | undefined, b: Bbox) => {
  if (!a) return true;
  const span = Math.max(a[2] - a[0], a[3] - a[1]);
  return a.some((v, i) => Math.abs(v - b[i]) > span * 0.12);
};

const QUICK: { label: string; when?: DiscoveryWhen; flag?: "free" | "near" }[] = [
  { label: "Happening Now", when: "now" },
  { label: "Up Next", when: "upnext" },
  { label: "Today", when: "today" },
  { label: "This Weekend", when: "weekend" },
  { label: "Free", flag: "free" },
  { label: "Near Me", flag: "near" },
];
const QUICK_CHIP_KEYS = new Set(["when", "free", "near"]);

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}
const SEARCH = "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35";
const SLIDERS = "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4";
const LIST = "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01";
const MAP = "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14";
const CLOSE = "M6 6l12 12M18 6 6 18";
const LOCATE = "M12 2v3m0 14v3M2 12h3m14 0h3M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z";

export interface MapExplorerProps {
  initialQuery: DiscoveryQuery;
  initialView: View;
  initialData: MapResponse | null;
  defaultBbox: Bbox;
  options: FilterOptions;
  /** The shared link asked for Near Me; the viewer hasn't granted it here. */
  nearRequested?: boolean;
}

export default function MapExplorer({ initialQuery, initialView, initialData, defaultBbox, options, nearRequested = false }: MapExplorerProps) {
  const [query, setQuery] = useState<DiscoveryQuery>(initialQuery);
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<MapResponse | null>(initialData);
  const [results, setResults] = useState<Card[]>(initialData?.results ?? []);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusCards, setFocusCards] = useState<Card[] | null>(null);
  const [extras, setExtras] = useState<{ brands: { name: string; slug: string }[]; moments: { id: string; title: string; href: string }[]; open: boolean | null } | null>(null);
  const [viewport, setViewport] = useState<Bbox>(initialQuery.bbox ?? defaultBbox);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [sheet, setSheet] = useState<Sheet>("peek");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [text, setText] = useState(initialQuery.text ?? "");
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(nearRequested ? "near" : null);
  const [fit, setFit] = useState<{ bbox: Bbox; key: number } | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const skipKey = useRef<string | null>(initialData ? queryKey({ ...initialQuery, offset: undefined }) : null);
  const ctl = useRef<AbortController | null>(null);
  const counts = useRef(new Map<string, number>());
  const listRef = useRef<HTMLDivElement>(null);
  const sheetDrag = useRef<number | null>(null);

  const key = queryKey({ ...query, offset: undefined });

  // What covers the map: on phones the top controls and the bottom sheet,
  // so a selected marker is panned into the part that's actually visible.
  const [screen, setScreen] = useState<{ h: number; desktop: boolean }>({ h: 800, desktop: false });
  useEffect(() => {
    const read = () => setScreen({ h: window.innerHeight, desktop: window.matchMedia?.("(min-width: 1024px)").matches ?? false });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // ---- fetch: one request per distinct query (never on map movement)
  useEffect(() => {
    if (skipKey.current === key) {
      skipKey.current = null;
      if (!query.bbox && data?.features.length) setFit({ bbox: bboxOf(data.features)!, key: Date.now() });
      return;
    }
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/discovery/map?${queryToParams({ ...query, offset: undefined }).toString()}${view === "feed" ? "&view=feed" : ""}`, { signal: c.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: MapResponse | null) => {
          if (!d || c.signal.aborted) return;
          setData(d);
          setResults(d.results);
          counts.current.set(key, d.total);
          if (!query.bbox) {
            const b = bboxOf(d.features);
            if (b) setFit({ bbox: b, key: Date.now() });
          }
        })
        .catch(() => undefined)
        .finally(() => !c.signal.aborted && setLoading(false));
    }, 120);
    return () => clearTimeout(t);
    // `key` is the query's canonical identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // ---- shareable URL (no history spam; never the viewer's own position)
  useEffect(() => {
    const shareable = query.near ? { ...query, bbox: undefined } : query;
    window.history.replaceState(window.history.state, "", mapHref({ ...shareable, offset: undefined }, view));
  }, [query, view]);

  const apply = useCallback((next: DiscoveryQuery) => {
    setSelected(null);
    setFocusCards(null);
    setExtras(null);
    setShowSearchArea(false);
    setQuery({ ...next, offset: undefined });
    listRef.current?.scrollTo({ top: 0 });
  }, []);
  const applyHref = (href: string) => {
    const r = fromHref(href);
    if (!r.query.bbox && query.bbox && !r.query.area && !r.query.market && !r.query.census && !r.query.place) r.query.bbox = query.bbox;
    apply(r.query);
  };

  // ---- selection (marker ↔ result, one state)
  const featureById = useMemo(() => new Map((data?.features ?? []).map((f) => [f.id, f])), [data]);
  const selectFeature = useCallback(
    (id: string | null) => {
      setSelected(id);
      setFocusCards(null);
      setExtras(null);
      if (!id) return;
      setSheet((s) => (s === "full" ? "half" : s));
      const f = featureById.get(id);
      if (!f) return;
      const have = results.filter((c) => f.keys.includes(c.key));
      if (have.length < Math.min(f.count, f.keys.length)) {
        fetch(`/api/discovery/map?${queryToParams({ ...query, offset: undefined }).toString()}&focus=${f.locationId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d: MapResponse | null) => d && setFocusCards(d.results.filter((c) => f.keys.includes(c.key)).length ? d.results.filter((c) => f.keys.includes(c.key)) : d.results))
          .catch(() => undefined);
      }
      fetch(`/api/discovery/map/preview?location=${f.locationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.location && setExtras({ brands: [...(d.operators ?? []), ...(d.brands ?? [])].slice(0, 6), moments: d.moments ?? [], open: d.location.open ?? null }))
        .catch(() => undefined);
      document.querySelector(`[data-result-key="${CSS.escape(f.keys[0] ?? "")}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [featureById, results, query]
  );
  const selectCard = (card: Card) => {
    setSelected(card.featureId);
    setFocusCards(null);
    setFocus({ lng: card.lng, lat: card.lat, key: Date.now() });
    if (view === "map") setSheet((s) => (s === "full" ? "half" : s));
  };
  const selectedFeature = selected ? (featureById.get(selected) ?? null) : null;
  const selectedCards = selectedFeature ? (focusCards ?? results.filter((c) => selectedFeature.keys.includes(c.key))) : [];

  // ---- viewport
  const onViewportChange = useCallback(
    (b: Bbox, byUser: boolean) => {
      setViewport(b);
      if (byUser) setShowSearchArea(movedEnough(query.bbox as Bbox | undefined, b));
    },
    [query.bbox]
  );

  // ---- search (natural language → the same structured query)
  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    const nl = text.trim();
    if (!nl) {
      const { text: _t, ...rest } = query;
      apply(rest);
      return;
    }
    const { text: _t, ...structured } = query;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    try {
      const r = await fetch(`/api/discovery/map?${queryToParams({ ...structured, bbox: structured.bbox ?? viewport, offset: undefined }).toString()}&nl=${encodeURIComponent(nl)}`, { signal: c.signal });
      const d = (await r.json()) as MapResponse & { interpretation?: { params: string } };
      const next: DiscoveryQuery = d.interpretation ? paramsToQuery(new URLSearchParams(d.interpretation.params)) : structured;
      skipKey.current = queryKey({ ...next, offset: undefined });
      setSelected(null);
      setData(d);
      setResults(d.results);
      setQuery(next);
      setText(next.text ?? "");
      if (!next.bbox) {
        const b = bboxOf(d.features);
        if (b) setFit({ bbox: b, key: Date.now() });
      }
      (document.activeElement as HTMLElement | null)?.blur?.();
      setSheet("half");
    } catch {
      /* aborted */
    } finally {
      setLoading(false);
    }
  };

  // ---- Near Me: only on an explicit tap; position kept in memory only,
  // coarsened to ~100 m before it shapes a viewport.
  const nearMe = () => {
    if (!("geolocation" in navigator)) {
      setNotice("Location isn’t available in this browser — showing this area instead.");
      return;
    }
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1000) / 1000;
        const lng = Math.round(pos.coords.longitude * 1000) / 1000;
        setUserPos({ lat, lng });
        const bbox = bboxAround(lat, lng, NEAR_ME_RADIUS_MILES);
        apply({ ...withoutGeo(query), near: true, bbox });
        setFit({ bbox, key: Date.now() });
      },
      () => setNotice("We couldn’t get your location — showing this area instead. You can search any neighborhood or city."),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 }
    );
  };

  const toggleQuick = (q: (typeof QUICK)[number]) => {
    if (q.when) apply({ ...query, when: query.when === q.when ? undefined : q.when, date: undefined, from: undefined, to: undefined, month: undefined, year: undefined });
    else if (q.flag === "free") apply({ ...query, free: query.free ? undefined : true });
    else if (query.near) {
      setUserPos(null);
      apply({ ...withoutGeo(query), bbox: viewport });
    } else nearMe();
  };
  const quickOn = (q: (typeof QUICK)[number]) => (q.when ? query.when === q.when && !query.date && !query.month : q.flag === "free" ? Boolean(query.free) : Boolean(query.near));

  const loadMore = () => {
    if (data?.nextOffset == null) return;
    fetch(`/api/discovery/map?${queryToParams({ ...query, offset: data.nextOffset }).toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MapResponse | null) => {
        if (!d) return;
        setResults((prev) => [...prev, ...d.results.filter((c) => !prev.some((p) => p.key === c.key))]);
        setData((prev) => (prev ? { ...prev, nextOffset: d.nextOffset } : d));
      })
      .catch(() => undefined);
  };

  const count = useCallback(async (q: DiscoveryQuery, signal: AbortSignal) => {
    const k = queryKey({ ...q, offset: undefined });
    if (counts.current.has(k)) return counts.current.get(k)!;
    const r = await fetch(`/api/discovery/map?${queryToParams({ ...q, offset: undefined }).toString()}&count=1`, { signal }).catch(() => null);
    if (!r?.ok) return null;
    const d = (await r.json()) as MapResponse;
    counts.current.set(k, d.total);
    return d.total;
  }, []);

  const searchThisArea = () => {
    setUserPos(null);
    apply({ ...withoutGeo(query), bbox: viewport });
  };

  const filterCount = useMemo(() => {
    const keys = ["categories", "formats", "benefits", "audience", "entry", "tod", "tfrom", "date", "from", "month", "year", "paid", "entities", "open", "family"] as const;
    return keys.filter((k) => {
      const v = query[k];
      return Array.isArray(v) ? v.length > 0 : Boolean(v);
    }).length;
  }, [query]);

  const total = data?.total ?? 0;
  const lens = query.entities?.length === 1 ? query.entities[0] : null;
  const noun = lens === "event" ? "Event" : lens === "place" ? "Place" : lens === "appearance" ? "Pop-Up" : "Result";
  const countLine = `${total.toLocaleString()} ${noun}${total === 1 ? "" : "s"}`;
  const serverChips = (data?.chips ?? []).filter((c) => !QUICK_CHIP_KEYS.has(c.key) || (c.key === "when" && !QUICK.some((q) => q.when === query.when)));

  // ---- pieces
  const searchBar = (
    <form role="search" onSubmit={onSearch} className="pointer-events-auto flex items-center gap-2">
      <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-black/[0.08] bg-white pl-4 pr-1.5 shadow-[0_4px_18px_rgba(0,0,0,0.08)] focus-within:border-findmi">
        <Icon d={SEARCH} className="h-[18px] w-[18px] shrink-0 text-ink/45" />
        <span className="sr-only">What do you want to find?</span>
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you want to find?"
          enterKeyHint="search"
          autoCapitalize="none"
          autoComplete="off"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink/40 focus:outline-none"
        />
        {loading && <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-findmi/30 border-t-findmi motion-reduce:animate-none" />}
      </label>
      <button type="button" onClick={() => setFiltersOpen(true)} aria-label={filterCount ? `Filters, ${filterCount} on` : "Filters"} className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white text-ink shadow-[0_4px_18px_rgba(0,0,0,0.08)] hover:border-black/20">
        <Icon d={SLIDERS} />
        {filterCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-findmi px-1 text-[11px] font-bold text-white">{filterCount}</span>}
      </button>
      <button type="button" onClick={() => setView(view === "map" ? "feed" : "map")} aria-label={view === "map" ? "Show as Feed" : "Show on Map"} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white text-ink shadow-[0_4px_18px_rgba(0,0,0,0.08)] hover:border-black/20 lg:hidden">
        <Icon d={view === "map" ? LIST : MAP} />
      </button>
    </form>
  );

  const chipRow = (
    <div className="pointer-events-auto -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
      {QUICK.map((q) => {
        const on = quickOn(q);
        return (
          <button
            key={q.label}
            type="button"
            aria-pressed={on}
            onClick={() => toggleQuick(q)}
            className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold shadow-sm transition ${on ? "border-findmi bg-findmi text-white" : "border-black/[0.08] bg-white text-ink/80 hover:border-black/20"}`}
          >
            {q.when === "now" && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${on ? "bg-white" : "bg-red-600"}`} />}
            {q.flag === "near" && <Icon d={LOCATE} className="h-3.5 w-3.5" />}
            {q.label}
            {on && <Icon d={CLOSE} className="h-3 w-3" />}
          </button>
        );
      })}
      {serverChips.map((c) => (
        <button key={c.key} type="button" onClick={() => applyHref(c.href)} aria-label={`Remove ${c.label}`} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-findmi/40 bg-findmi-50 px-3.5 text-[13px] font-semibold text-findmi-700 shadow-sm hover:border-findmi">
          {c.label}
          <Icon d={CLOSE} className="h-3 w-3" />
        </button>
      ))}
    </div>
  );

  const notices = (
    <>
      {notice === "near" && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-findmi-50 px-3 py-2.5 text-sm text-findmi-800">
          <span>This link shows what&rsquo;s near you. Share your location to see it — or browse this area.</span>
          <button type="button" onClick={nearMe} className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-xs font-bold text-white">
            Use My Location
          </button>
        </div>
      )}
      {notice && notice !== "near" && <p className="rounded-2xl bg-black/[0.04] px-3 py-2.5 text-sm text-ink/70">{notice}</p>}
      {data && !data.mapReady && <p className="rounded-2xl bg-black/[0.04] px-3 py-2.5 text-sm text-ink/70">Findmi places are still being placed on the map. Results will appear here as they&rsquo;re located.</p>}
      {data?.truncated && <p className="rounded-2xl bg-black/[0.04] px-3 py-2.5 text-sm text-ink/70">There&rsquo;s a lot here — zoom in or add a filter to see everything in this area.</p>}
    </>
  );

  const emptyState = data && total === 0 && data.mapReady && (
    <div className="rounded-2xl border border-black/5 bg-white p-4">
      <p className="font-display text-[15px] font-bold text-ink">Nothing matches all of these filters.</p>
      <p className="mt-1 text-sm text-ink/60">Findmi never loosens your search on its own. Try one of these:</p>
      {data.relaxations.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.relaxations.map((r) => (
            <button key={r.label} type="button" onClick={() => applyHref(r.href)} className="min-h-9 rounded-full border border-black/10 bg-white px-3 text-[13px] font-semibold text-ink/80 hover:border-findmi hover:text-findmi-700">
              {r.label} <span className="text-ink/45">({r.count})</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink/60">Nothing nearby either — try another area or remove a filter.</p>
      )}
    </div>
  );

  const list = (
    <div className="flex flex-col gap-2.5">
      {notices}
      {emptyState}
      {selectedFeature && view === "map" && results.length > selectedCards.length && <p className="text-xs font-bold uppercase tracking-wide text-ink/45">More Results</p>}
      <ul role="list" className={view === "feed" ? "grid gap-2.5 lg:grid-cols-2" : "flex flex-col gap-2.5"}>
        {results.filter((card) => !(view === "map" && selectedFeature?.keys.includes(card.key))).map((card) => (
          <li key={card.key}>
            <MapResultCard card={card} selected={selectedFeature?.keys.includes(card.key) ?? false} onSelect={view === "map" ? selectCard : undefined} showDistance={Boolean(query.near)} />
          </li>
        ))}
      </ul>
      {data?.overflow.map((o) => (
        <button key={o.slug} type="button" onClick={() => applyHref(o.href)} className="min-h-11 rounded-full border border-black/10 bg-white text-sm font-semibold text-ink/80 hover:border-findmi hover:text-findmi-700">
          View All {o.total} {o.name} Results
        </button>
      ))}
      {data?.nextOffset != null && (
        <button type="button" onClick={loadMore} className="min-h-11 rounded-full bg-black/[0.05] text-sm font-semibold text-ink/75 hover:bg-black/[0.08]">
          Show More
        </button>
      )}
    </div>
  );

  const preview = selectedFeature && (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-ink/45">
          {selectedFeature.place}
          {extras?.open === true ? " · Open Now" : extras?.open === false ? " · Closed Now" : ""}
          {selectedFeature.count > 1 ? ` · ${selectedFeature.count} Here` : ""}
        </p>
        <button type="button" onClick={() => selectFeature(null)} aria-label="Close preview" className="flex h-8 w-8 items-center justify-center rounded-full text-ink/50 hover:bg-black/5">
          <Icon d={CLOSE} className="h-4 w-4" />
        </button>
      </div>
      {selectedCards.slice(0, 1).map((c) => (
        <MapResultCard key={c.key} card={c} variant="preview" selected showDistance={Boolean(query.near)} />
      ))}
      {selectedCards.slice(1, 4).map((c) => (
        <MapResultCard key={c.key} card={c} showDistance={Boolean(query.near)} />
      ))}
      {selectedCards.length === 0 && <div className="h-24 animate-pulse rounded-2xl bg-black/[0.04] motion-reduce:animate-none" />}
      {extras && extras.brands.length > 0 && (
        <p className="text-xs text-ink/60">
          <span className="font-semibold text-ink/75">Brands Here: </span>
          {extras.brands.map((b) => b.name).join(", ")}
        </p>
      )}
      {extras && extras.moments.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink/45">Recent Moments Here</p>
          <ul className="flex flex-col gap-1">
            {extras.moments.map((m) => (
              <li key={m.id}>
                <a href={m.href} className="text-sm font-semibold text-findmi-700 hover:underline">
                  {m.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const searchAreaButton = showSearchArea && view === "map" && (
    <button type="button" onClick={searchThisArea} className="pointer-events-auto mx-auto flex min-h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-bold text-white shadow-lg">
      <Icon d={SEARCH} className="h-4 w-4" />
      Search This Area
    </button>
  );

  const cycleSheet = () => setSheet((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));
  const onSheetDown = (e: ReactPointerEvent) => {
    sheetDrag.current = e.clientY;
  };
  const onSheetUp = (e: ReactPointerEvent) => {
    if (sheetDrag.current === null) return;
    const dy = e.clientY - sheetDrag.current;
    sheetDrag.current = null;
    if (Math.abs(dy) < 8) return cycleSheet();
    setSheet((s) => (dy < -30 ? (s === "peek" ? "half" : "full") : dy > 30 ? (s === "full" ? "half" : "peek") : s));
  };

  return (
    <div className="relative flex h-[calc(100dvh-3.5rem-var(--admin-bar-h))] overflow-hidden bg-paper lg:h-[calc(100dvh-4.0625rem)]">
      <p className="sr-only" aria-live="polite">
        {loading ? "Updating results" : countLine}
      </p>

      {/* MAP column (mobile: whole surface in Map view; desktop: ~62%) */}
      <div className={`relative min-w-0 flex-1 ${view === "feed" ? "hidden" : ""}`}>
        <DiscoveryMapCanvas
          features={data?.features ?? []}
          selectedId={selected}
          onSelect={selectFeature}
          onViewportChange={onViewportChange}
          initialBbox={(query.bbox as Bbox | undefined) ?? defaultBbox}
          fit={fit}
          focus={focus}
          userPosition={userPos}
          padding={
            screen.desktop
              ? { top: 48, bottom: 48, left: 48, right: 48 }
              : { top: 150, bottom: sheet === "half" ? Math.round(screen.h * 0.52) : selected ? 250 : 120, left: 28, right: 28 }
          }
        />
        {/* mobile top controls over the map */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 lg:hidden">
          {searchBar}
          {chipRow}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-[8.25rem] flex justify-center lg:top-4">{searchAreaButton}</div>

        {/* mobile bottom sheet: Peek → Half → Expanded */}
        <section
          aria-label="Results"
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] transition-[height] duration-300 ease-out motion-reduce:transition-none lg:hidden ${
            sheet === "full" ? "h-[calc(100%-7.75rem)]" : sheet === "half" ? "h-[52%]" : selectedFeature ? "h-[15.5rem]" : "h-[6.75rem]"
          }`}
        >
          <button
            type="button"
            onPointerDown={onSheetDown}
            onPointerUp={onSheetUp}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), cycleSheet())}
            aria-label={sheet === "full" ? "Collapse results" : "Expand results"}
            aria-expanded={sheet !== "peek"}
            className="flex w-full shrink-0 touch-none flex-col items-center gap-2 px-4 pb-2 pt-2.5"
          >
            <span aria-hidden className="h-1.5 w-10 rounded-full bg-black/15" />
            <span className="flex w-full items-center justify-between">
              <span className="font-display text-[15px] font-bold text-ink">{loading && !data ? "Finding…" : countLine}</span>
              <span className="text-xs font-semibold text-ink/45">{sheet === "full" ? "Map" : "List"}</span>
            </span>
          </button>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {preview && <div className="mb-3">{preview}</div>}
            {(sheet !== "peek" || !preview) && (sheet !== "peek" ? list : (data?.mapReady === false || total === 0) && <div className="pt-1">{notices}{emptyState}</div>)}
          </div>
        </section>
      </div>

      {/* mobile FEED view */}
      {view === "feed" && (
        <div className="flex min-w-0 flex-1 flex-col lg:hidden">
          <div className="flex flex-col gap-2 border-b border-black/5 bg-paper p-3">
            {searchBar}
            {chipRow}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 font-display text-[15px] font-bold text-ink">{countLine}</p>
            {list}
          </div>
        </div>
      )}

      {/* DESKTOP results panel (~38%), independently scrolling */}
      <aside aria-label="Results" className={`hidden min-w-0 flex-col border-l border-black/5 bg-paper lg:flex ${view === "feed" ? "flex-1" : "w-[38%] min-w-[380px] max-w-[540px]"}`}>
        <div className={`flex flex-col gap-2.5 border-b border-black/5 p-4 ${view === "feed" ? "[&>*]:mx-auto [&>*]:w-full [&>*]:max-w-4xl" : ""}`}>
          {searchBar}
          {chipRow}
          <div className="flex items-center justify-between">
            <p className="font-display text-[15px] font-bold text-ink">{countLine}</p>
            <div role="radiogroup" aria-label="View" className="flex rounded-full bg-black/[0.05] p-0.5 text-xs font-bold">
              {(["map", "feed"] as View[]).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} className={`rounded-full px-3 py-1.5 ${view === v ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}>
                  {v === "map" ? "Map" : "Feed"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div ref={view === "feed" ? undefined : listRef} className={`min-h-0 flex-1 overflow-y-auto p-4 ${view === "feed" ? "mx-auto w-full max-w-4xl" : ""}`}>
          {preview && view === "map" && <div className="mb-4 rounded-2xl bg-findmi-50/60 p-3">{preview}</div>}
          {list}
        </div>
      </aside>

      {filtersOpen && <MapFilterSheet initial={query} options={options} count={count} onClose={() => setFiltersOpen(false)} onApply={(q) => { setFiltersOpen(false); apply(q); }} />}
    </div>
  );
}
