"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { bboxAround, type Bbox, type MapFeature } from "@/lib/discovery/map-core";
import type { MapResponse, MapResultCard as Card } from "@/lib/discovery/map-server";
import { mapHref, paramsToQuery, queryKey, queryToParams, type DiscoveryQuery, type DiscoveryWhen } from "@/lib/discovery/query";
import { lensNoun, MAP_LENSES, MAP_WHEN_LABELS, mapLens, mapRefinements, normalizeMapLens, withLens, type MapLens } from "@/lib/discovery/map-filters";
import { clearedQuery, derivedFrom, hasGeo } from "@/lib/discovery/search-state";
import { NEAR_ME_RADIUS_MILES } from "@/lib/map-config";
import MapResultCard from "./MapResultCard";
import MapFilterSheet, { type DraftCount, type FilterOptions } from "./MapFilterSheet";
import { movedMeaningfully, nextOnTap, sheetHeights, snapAfterDrag, type SheetState } from "./sheet";

// Discovery Map + Feed — ONE Discovery Query, one result set, two
// renderers. The map never fetches while it moves: panning only reveals
// "Search This Area"; any filter / chip / search change re-runs the same
// query for both the markers and the list. Selection is shared: a marker
// selects its results, a result highlights and pans to its marker.

const DiscoveryMapCanvas = dynamic(() => import("./DiscoveryMapCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#eef0ef] motion-reduce:animate-none" />,
});

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

type Quick = { label: string; when?: DiscoveryWhen; flag?: "free" | "near" | "open" };
// Quick filters follow the lens. Under All the time / Free shortcuts are
// Happening refinements: tapping one moves the VISIBLE lens to Happening.
// "Starting Soon" = not started, begins within 4 hours (MAP_WHEN_LABELS).
const QUICK_TIME: Quick[] = (["now", "upnext", "today", "weekend"] as const).map((when) => ({ label: MAP_WHEN_LABELS[when], when }));
const FREE: Quick = { label: "Free", flag: "free" };
const OPEN: Quick = { label: "Open Now", flag: "open" };
const NEAR: Quick = { label: "Near Me", flag: "near" };

/** Near Me failure → what the viewer is told (never a silent no-op). */
export function nearMeError(e: { code?: number; message?: string } | null | undefined): string {
  if (e?.code === 1 && /permissions? policy/i.test(e.message ?? "")) return "We couldn’t get your location — location isn’t enabled on this page. Showing this area instead.";
  if (e?.code === 1) return "We couldn’t get your location — location access is off for Findmi. Allow it in your browser’s site settings, or browse this area.";
  if (e?.code === 2) return "We couldn’t get your location — your device couldn’t find it right now. Showing this area instead.";
  if (e?.code === 3) return "We couldn’t get your location in time. Try Near Me again, or browse this area.";
  return "We couldn’t get your location — showing this area instead. You can search any neighborhood or city.";
}

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
  // The visible lens is always the one that runs.
  const [start] = useState(() => normalizeMapLens(initialQuery));
  const [query, setQuery] = useState<DiscoveryQuery>(start.query);
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<MapResponse | null>(initialData);
  const [results, setResults] = useState<Card[]>(initialData?.results ?? []);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // The result the viewer picked from the list leads its marker's preview.
  const [leadKey, setLeadKey] = useState<string | null>(null);
  const [showAllHere, setShowAllHere] = useState(false);
  // The quick shortcut that moved All → Happening (so turning it off can
  // return to All).
  const shortcutFromAll = useRef<string | null>(null);
  const [focusCards, setFocusCards] = useState<Card[] | null>(null);
  const [extras, setExtras] = useState<{ brands: { name: string; slug: string }[]; moments: { id: string; title: string; href: string }[]; open: boolean | null } | null>(null);
  const [viewport, setViewport] = useState<Bbox>(initialQuery.bbox ?? defaultBbox);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [sheet, setSheet] = useState<SheetState>("peek");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [text, setText] = useState(initialQuery.text ?? "");
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  // Near Me is waiting on the browser (permission prompt / position fix).
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(nearRequested ? "near" : null);
  const [fit, setFit] = useState<{ bbox: Bbox; key: number } | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  // Which query the rendered results belong to. The fetch effect compares
  // against it (not a one-shot "skip" flag), so returning to a query whose
  // results aren't on screen always re-fetches.
  const dataKey = useRef<string | null>(initialData ? queryKey({ ...(start.sameResults ? start.query : initialQuery), offset: undefined }) : null);
  // Filters the last typed search contributed (cleared with the search).
  const derived = useRef<Partial<DiscoveryQuery>>({});
  const mounted = useRef(false);
  // Bumped by every search and every Clear: only the latest one may land.
  const searchSeq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const counts = useRef(new Map<string, DraftCount>());
  const listRef = useRef<HTMLDivElement>(null);
  const sheetDrag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  // Bounds the current results were queried for (Search This Area compares
  // against these): the query's own viewport, or — for an Area / place /
  // search query — the view the map fitted to its results.
  const queriedBounds = useRef<Bbox | null>((initialQuery.bbox as Bbox | undefined) ?? null);
  const awaitingFit = useRef(false);

  // ---- measured sheet geometry (content-driven heights)
  const columnRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLLIElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ column: 0, head: 0, peekBody: 0, contentBody: 0, topReserve: 0 });
  const measure = useCallback(() => {
    const content = contentRef.current;
    const pad = 16;
    let peekBody = 0;
    if (previewRef.current && content) peekBody = previewRef.current.offsetTop - content.offsetTop + previewRef.current.offsetHeight + pad;
    else if (firstRef.current && content) peekBody = firstRef.current.offsetTop - content.offsetTop + firstRef.current.offsetHeight + pad;
    else if (content) peekBody = content.offsetHeight;
    const next = {
      column: columnRef.current?.offsetHeight ?? 0,
      head: headRef.current?.offsetHeight ?? 0,
      peekBody,
      contentBody: content ? content.offsetHeight + pad : 0,
      topReserve: (topRef.current?.offsetHeight ?? 0) + 8,
    };
    setMetrics((m) => (Object.keys(next).every((k) => Math.abs(m[k as keyof typeof m] - next[k as keyof typeof next]) < 1) ? m : next));
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    for (const r of [columnRef, headRef, contentRef, topRef]) if (r.current) ro.observe(r.current);
    measure();
    return () => ro.disconnect();
  });

  const key = queryKey({ ...query, offset: undefined });
  const keyRef = useRef(key);
  keyRef.current = key;

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
    const first = !mounted.current;
    mounted.current = true;
    if (dataKey.current === key) {
      ctl.current?.abort();
      setLoading(false);
      // Server-rendered Area / place results: fit the map to them once.
      if (first && !query.bbox && data?.features.length) {
        awaitingFit.current = true;
        setFit({ bbox: bboxOf(data.features)!, key: Date.now() });
      }
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
          dataKey.current = key;
          setData(d);
          setResults(d.results);
          counts.current.set(key, { total: d.total, facets: d.facets });
          if (!query.bbox) {
            const b = bboxOf(d.features);
            if (b) {
              awaitingFit.current = true;
              setFit({ bbox: b, key: Date.now() });
            }
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

  const apply = useCallback((raw: DiscoveryQuery) => {
    const next = normalizeMapLens(raw).query;
    setSelected(null);
    setLeadKey(null);
    setFocusCards(null);
    setExtras(null);
    setShowSearchArea(false);
    if (next.bbox) queriedBounds.current = next.bbox as Bbox;
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
    (id: string | null, lead: string | null = null) => {
      setSelected(id);
      setLeadKey(lead);
      setShowAllHere(false);
      setFocusCards(null);
      setExtras(null);
      setPreviewLoading(false);
      // Selecting (or closing) always settles on the content-sized Peek:
      // the selected preview, with the map still in view.
      setSheet("peek");
      listRef.current?.scrollTo({ top: 0 });
      if (!id) return;
      const f = featureById.get(id);
      if (!f) return;
      const have = results.filter((c) => f.keys.includes(c.key));
      if (have.length < Math.min(f.count, f.keys.length)) {
        setPreviewLoading(true);
        fetch(`/api/discovery/map?${queryToParams({ ...query, offset: undefined }).toString()}&focus=${f.locationId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d: MapResponse | null) => {
            if (!d || keyRef.current !== key) return;
            const mine = d.results.filter((c) => f.keys.includes(c.key));
            setFocusCards(mine.length ? mine : d.results);
          })
          .catch(() => undefined)
          .finally(() => setPreviewLoading(false));
      }
      fetch(`/api/discovery/map/preview?location=${f.locationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.location && setExtras({ brands: [...(d.operators ?? []), ...(d.brands ?? [])].slice(0, 6), moments: d.moments ?? [], open: d.location.open ?? null }))
        .catch(() => undefined);
      document.querySelector(`[data-result-key="${CSS.escape(f.keys[0] ?? "")}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [featureById, results, query, key]
  );
  const selectCard = (card: Card) => {
    selectFeature(card.featureId, card.key);
    setFocus({ lng: card.lng, lat: card.lat, key: Date.now() });
  };
  const selectedFeature = selected ? (featureById.get(selected) ?? null) : null;
  const selectedCards = useMemo(() => {
    if (!selectedFeature) return [];
    const here = focusCards ?? results.filter((c) => selectedFeature.keys.includes(c.key));
    const lead = leadKey ? (here.find((c) => c.key === leadKey) ?? results.find((c) => c.key === leadKey)) : null;
    return lead ? [lead, ...here.filter((c) => c.key !== lead.key)] : here;
  }, [selectedFeature, focusCards, results, leadKey]);
  // Results shown in the preview leave the list (never both, never neither).
  const inPreview = (key: string) => view === "map" && Boolean(selectedFeature) && (selectedFeature!.keys.includes(key) || key === leadKey);

  // ---- viewport
  const onViewportChange = useCallback(
    (b: Bbox, byUser: boolean) => {
      setViewport(b);
      if (!byUser) {
        // The map just fitted itself to an Area / search result set: that
        // view is what was searched.
        if (awaitingFit.current || !queriedBounds.current) {
          queriedBounds.current = b;
          awaitingFit.current = false;
        }
        return;
      }
      setShowSearchArea(movedMeaningfully(queriedBounds.current, b));
    },
    []
  );

  // ---- search (natural language → the same structured query)
  // Clear removes the text AND whatever that text resolved into (a Brand,
  // "free", "today"…); geography, the viewer's time lens and their own
  // filters stay exactly as they were.
  const clearSearch = () => {
    searchSeq.current++;
    setText("");
    if (query.text === undefined && Object.keys(derived.current).length === 0) return;
    const next = clearedQuery(query, derived.current);
    derived.current = {};
    apply(next);
  };
  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    const nl = text.trim().replace(/\s+/g, " ");
    if (!nl) {
      clearSearch();
      return;
    }
    // A new search replaces the previous one — its derived filters too —
    // and runs inside the geography already queried (text never moves it).
    const seq = ++searchSeq.current;
    const base = clearedQuery(query, derived.current);
    const bbox = base.bbox ?? (hasGeo(base) ? undefined : (queriedBounds.current ?? viewport));
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    try {
      const r = await fetch(`/api/discovery/map?${queryToParams({ ...base, bbox, offset: undefined }).toString()}&nl=${encodeURIComponent(nl)}`, { signal: c.signal });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as MapResponse & { interpretation?: { params: string } };
      if (c.signal.aborted || seq !== searchSeq.current) return;
      const interpreted: DiscoveryQuery = d.interpretation ? paramsToQuery(new URLSearchParams(d.interpretation.params)) : base;
      // A search that resolved a Happening refinement ("today") shows the
      // Happening lens; the lens it set belongs to the search (Clear drops it).
      const lensed = normalizeMapLens(interpreted);
      const next = lensed.query;
      derived.current = derivedFrom(next, base);
      dataKey.current = queryKey({ ...(lensed.sameResults ? next : interpreted), offset: undefined });
      setSelected(null);
      setLeadKey(null);
      setData(d);
      setResults(d.results);
      setQuery(next);
      setText(nl);
      setShowSearchArea(false);
      if (next.bbox) queriedBounds.current = next.bbox as Bbox;
      if (!next.bbox) {
        const b = bboxOf(d.features);
        if (b) {
          awaitingFit.current = true;
          setFit({ bbox: b, key: Date.now() });
        }
      }
      (document.activeElement as HTMLElement | null)?.blur?.();
      setSheet("browse");
    } catch {
      /* aborted, or superseded by a newer request */
    } finally {
      if (ctl.current === c) setLoading(false);
    }
  };

  // ---- Near Me: only on an explicit tap; position kept in memory only,
  // coarsened to ~100 m before it shapes a viewport.
  const nearMe = () => {
    if (locating) return;
    if (!("geolocation" in navigator)) {
      setNotice("Location isn’t available in this browser — showing this area instead.");
      return;
    }
    setNotice(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = Math.round(pos.coords.latitude * 1000) / 1000;
        const lng = Math.round(pos.coords.longitude * 1000) / 1000;
        setUserPos({ lat, lng });
        const bbox = bboxAround(lat, lng, NEAR_ME_RADIUS_MILES);
        apply({ ...withoutGeo(query), near: true, bbox });
        setFit({ bbox, key: Date.now() });
      },
      (err) => {
        setLocating(false);
        setNotice(nearMeError(err));
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 }
    );
  };

  const lens = mapLens(query);
  const facets = data?.facets;
  // An option is offered when the candidates can satisfy it — or when it's
  // already on (always removable). No availability yet → offered.
  // Time shortcuts too: offered when something qualifies, or when on.
  const timeOffered = (q: Quick) => !facets?.when || facets.when.includes(q.when!) || query.when === q.when;
  const quick: Quick[] =
    lens === "place"
      ? [...(!facets || facets.open || query.open ? [OPEN] : []), NEAR]
      : [...QUICK_TIME.filter(timeOffered), ...(!facets || facets.free || query.free ? [FREE] : []), NEAR];
  // A lens change is always visible: bring the rail (scrolled sideways to
  // reach a quick filter on a phone) back to its start, where the lens is.
  useEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-map-rail]")) el.scrollTo?.({ left: 0, behavior: "smooth" });
  }, [lens]);
  const chooseLens = (next: MapLens) => {
    shortcutFromAll.current = null;
    if (next !== lens) apply(withLens(query, next));
  };
  const toggleQuick = (q: Quick) => {
    const happeningOnly = Boolean(q.when || q.flag === "free");
    // Under All a Happening refinement moves the visible lens to Happening;
    // turning that same shortcut off again (nothing else refined since)
    // returns to All — an undo, never a silent narrowing.
    const fromAll = lens === "all" && happeningOnly;
    const scoped = fromAll ? withLens(query, "happening") : query;
    const commit = (computed: DiscoveryQuery) => {
      let next = computed;
      if (fromAll) shortcutFromAll.current = q.label;
      else if (happeningOnly) {
        const undo = quickOn(q) && shortcutFromAll.current === q.label;
        shortcutFromAll.current = null;
        if (undo && mapRefinements(next).length === 0) next = withLens(next, "all");
      }
      apply(next);
    };
    if (q.when) commit({ ...scoped, when: query.when === q.when ? undefined : q.when, date: undefined, from: undefined, to: undefined, month: undefined, year: undefined });
    else if (q.flag === "free") commit({ ...scoped, free: query.free ? undefined : true });
    else if (q.flag === "open") apply({ ...query, open: query.open ? undefined : "now" });
    else if (query.near) {
      setUserPos(null);
      apply({ ...withoutGeo(query), bbox: viewport });
    } else nearMe();
  };
  const quickOn = (q: Quick) => (q.when ? query.when === q.when && !query.date && !query.month : q.flag === "free" ? Boolean(query.free) : q.flag === "open" ? Boolean(query.open) : Boolean(query.near));

  const loadMore = () => {
    if (data?.nextOffset == null) return;
    const forKey = key;
    fetch(`/api/discovery/map?${queryToParams({ ...query, offset: data.nextOffset }).toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MapResponse | null) => {
        // A page of an older query never lands in a newer result set.
        if (!d || keyRef.current !== forKey || dataKey.current !== forKey) return;
        setResults((prev) => [...prev, ...d.results.filter((c) => !prev.some((p) => p.key === c.key))]);
        setData((prev) => (prev ? { ...prev, nextOffset: d.nextOffset } : d));
      })
      .catch(() => undefined);
  };

  const count = useCallback(async (raw: DiscoveryQuery, signal: AbortSignal): Promise<DraftCount | null> => {
    const q = normalizeMapLens(raw).query;
    const k = queryKey({ ...q, offset: undefined });
    if (counts.current.has(k)) return counts.current.get(k)!;
    const r = await fetch(`/api/discovery/map?${queryToParams({ ...q, offset: undefined }).toString()}&count=1`, { signal }).catch(() => null);
    if (!r?.ok) return null;
    const d = (await r.json()) as MapResponse;
    const out = { total: d.total, facets: d.facets };
    counts.current.set(k, out);
    return out;
  }, []);

  const searchThisArea = () => {
    setUserPos(null);
    apply({ ...withoutGeo(query), bbox: viewport });
  };

  // ONE definition of "applied refinements" (badge, chip rail, Clear).
  const refinements = useMemo(() => mapRefinements(query), [query]);
  const filterCount = refinements.length;

  const total = data?.total ?? 0;
  const noun = lensNoun(query);
  const countLine = `${total.toLocaleString()} ${noun}${total === 1 ? "" : "s"}`;
  // Applied refinements a quick filter doesn't already show (the typed
  // search is already in the field; Near Me is always a quick filter).
  const shownByQuick = (key: string) =>
    key === "text" || key === "near" || (key === "when" && QUICK_TIME.some((q) => q.when === query.when)) || (key === "free" && lens !== "place") || (key === "open" && lens === "place");
  const serverChips = [
    ...refinements.filter((c) => c.key === "lens").map((c) => ({ key: c.key, label: c.label, href: "", without: c.without })),
    ...(data?.chips ?? []).filter((c) => !shownByQuick(c.key)).map((c) => ({ ...c, without: null as DiscoveryQuery | null })),
  ];
  const chipLabels = useMemo(() => Object.fromEntries((data?.chips ?? []).map((c) => [c.key, c.label])), [data]);

  // ---- pieces
  const searchBar = (
    <form role="search" onSubmit={onSearch} className="pointer-events-auto flex items-center gap-2">
      <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-black/[0.08] bg-white pl-4 pr-1.5 shadow-[0_4px_18px_rgba(0,0,0,0.08)] focus-within:border-findmi">
        <Icon d={SEARCH} className="h-[18px] w-[18px] shrink-0 text-ink/45" />
        <span className="sr-only">What do you want to find?</span>
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Emptying the field (backspace, the native clear control) clears the search.
            if (!e.target.value.trim() && (query.text !== undefined || Object.keys(derived.current).length)) clearSearch();
          }}
          placeholder="What do you want to find?"
          enterKeyHint="search"
          autoCapitalize="none"
          autoComplete="off"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink/40 focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
        />
        {text && (
          <button type="button" onClick={clearSearch} aria-label="Clear search" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/45 hover:text-ink">
            <Icon d={CLOSE} className="h-4 w-4" />
          </button>
        )}
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
    <div data-map-rail className="pointer-events-auto -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
      <div role="radiogroup" aria-label="Explore" className="flex shrink-0 items-center rounded-full border border-black/[0.08] bg-white p-0.5 shadow-sm">
        {MAP_LENSES.map((l) => (
          <button
            key={l.lens}
            type="button"
            role="radio"
            aria-checked={lens === l.lens}
            onClick={() => chooseLens(l.lens)}
            className={`min-h-8 rounded-full px-3 text-[13px] font-semibold transition ${lens === l.lens ? "bg-ink text-white" : "text-ink/70 hover:text-ink"}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      {quick.map((q) => {
        const on = quickOn(q);
        return (
          <button
            key={q.label}
            type="button"
            aria-pressed={on}
            aria-busy={q.flag === "near" && locating ? true : undefined}
            onClick={() => toggleQuick(q)}
            className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold shadow-sm transition ${on ? "border-findmi bg-findmi text-white" : "border-black/[0.08] bg-white text-ink/80 hover:border-black/20"}`}
          >
            {q.when === "now" && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${on ? "bg-white" : "bg-red-600"}`} />}
            {q.flag === "near" && locating && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-findmi/30 border-t-findmi motion-reduce:animate-none" />}
            {q.flag === "near" && !locating && <Icon d={LOCATE} className="h-3.5 w-3.5" />}
            {q.flag === "near" && locating ? "Locating…" : q.label}
            {on && <Icon d={CLOSE} className="h-3 w-3" />}
          </button>
        );
      })}
      {serverChips.map((c) => (
        <button key={c.key} type="button" onClick={() => (c.without ? apply(c.without) : applyHref(c.href))} aria-label={`Remove ${c.label}`} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-findmi/40 bg-findmi-50 px-3.5 text-[13px] font-semibold text-findmi-700 shadow-sm hover:border-findmi">
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

  // Near Me found the viewer but nothing qualifies within the radius: say
  // so (it isn't a filter conflict); Wider Area stays the next step.
  const nearEmpty = Boolean(query.near);
  const emptyState = data && total === 0 && data.mapReady && (
    <div className="rounded-2xl border border-black/5 bg-white p-4">
      <p className="font-display text-[15px] font-bold text-ink">{nearEmpty ? (filterCount ? "Nothing near you matches these filters." : "Nothing near you right now.") : "Nothing matches all of these filters."}</p>
      <p className="mt-1 text-sm text-ink/60">{nearEmpty ? `Findmi looked within ${NEAR_ME_RADIUS_MILES} mi of you. Try one of these:` : "Findmi never loosens your search on its own. Try one of these:"}</p>
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

  const renderList = (mobile: boolean) => (
    <div className="flex flex-col gap-2.5">
      {notices}
      {emptyState}
      {selectedFeature && view === "map" && results.length > selectedCards.length && <p className="text-xs font-bold uppercase tracking-wide text-ink/45">More Results</p>}
      <ul role="list" className={view === "feed" ? "grid gap-2.5 lg:grid-cols-2" : "flex flex-col gap-2.5"}>
        {results.filter((card) => !inPreview(card.key)).map((card, i) => (
          <li key={card.key} ref={mobile && i === 0 ? firstRef : undefined}>
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

  // Selected preview: what's happening there first, then useful context.
  // Every section renders only when it has something in it.
  const [primary, ...others] = selectedCards;
  const othersLive = others.some((c) => c.status.live);
  const renderPreview = (mobile: boolean) => selectedFeature && (
    <div ref={mobile ? previewRef : undefined} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-ink/45">
          {selectedFeature.place}
          {extras?.open === true ? " · Open Now" : extras?.open === false ? " · Closed Now" : ""}
          {selectedFeature.count > 1 ? ` · ${selectedFeature.count} Here` : ""}
        </p>
        <button type="button" onClick={() => selectFeature(null)} aria-label="Close preview" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/50 hover:bg-black/5">
          <Icon d={CLOSE} className="h-4 w-4" />
        </button>
      </div>
      {primary && <MapResultCard card={primary} variant="preview" selected showDistance={Boolean(query.near)} />}
      {!primary && previewLoading && <div className="h-24 animate-pulse rounded-2xl bg-black/[0.04] motion-reduce:animate-none" />}
      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/45">{othersLive ? "Happening Here" : "Coming Up Here"}</p>
          {(showAllHere ? others : others.slice(0, 3)).map((c) => (
            <MapResultCard key={c.key} card={c} showDistance={Boolean(query.near)} />
          ))}
          {!showAllHere && others.length > 3 && (
            <button type="button" onClick={() => setShowAllHere(true)} className="min-h-10 rounded-full bg-black/[0.05] text-sm font-semibold text-ink/75 hover:bg-black/[0.08]">
              Show All {selectedCards.length} Here
            </button>
          )}
        </div>
      )}
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

  // ---- sheet: content-sized snap heights, header-only drag (the list
  // scrolls, the header drags — they never fight).
  const heights = sheetHeights(metrics);
  const measured = metrics.column > 0 && metrics.head > 0;
  const sheetPx = dragH ?? heights[sheet];
  // Keep the selected marker in the visible part of the map: once the
  // preview has rendered and the sheet has settled at its new height, pan
  // the marker clear of it (marker taps near the bottom included).
  const settledSheet = measured ? heights[sheet] : 0;
  useEffect(() => {
    if (!selectedFeature || view !== "map" || screen.desktop) return;
    const t = setTimeout(() => setFocus({ lng: selectedFeature.lng, lat: selectedFeature.lat, key: Date.now() }), 180);
    return () => clearTimeout(t);
    // Re-run only when the selection or the settled sheet height changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFeature?.id, settledSheet]);

  const onSheetDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-sheet-action]")) return;
    sheetDrag.current = { y: e.clientY, h: heights[sheet], moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onSheetMove = (e: ReactPointerEvent) => {
    const d = sheetDrag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setDragH(Math.max(metrics.head, Math.min(heights.expanded, d.h - dy)));
  };
  const onSheetUp = (e: ReactPointerEvent) => {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    if (!d) return;
    const dy = e.clientY - d.y;
    const released = dragH ?? heights[sheet];
    setDragH(null);
    const next = d.moved ? snapAfterDrag(sheet, heights, released, dy) : nextOnTap(sheet, heights);
    if (next === "peek") listRef.current?.scrollTo({ top: 0 });
    setSheet(next);
  };
  const toggleList = () => {
    const next: SheetState = sheet === "peek" ? "browse" : "peek";
    if (next === "peek") listRef.current?.scrollTo({ top: 0 });
    setSheet(next);
  };

  return (
    <div className="relative flex h-[calc(100dvh-3.5rem-var(--admin-bar-h))] overflow-hidden bg-paper lg:h-[calc(100dvh-4.0625rem)]">
      <p className="sr-only" aria-live="polite">
        {locating ? "Finding your location" : loading ? "Updating results" : countLine}
      </p>

      {/* MAP column (mobile: whole surface in Map view; desktop: ~62%) */}
      <div ref={columnRef} className={`relative min-w-0 flex-1 ${view === "feed" ? "hidden" : ""}`}>
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
              : { top: (metrics.topReserve || 150) + 8, bottom: (measured ? heights[sheet] : 120) + 12, left: 28, right: 28 }
          }
        />
        {/* mobile top controls over the map */}
        <div ref={topRef} className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 lg:hidden">
          {searchBar}
          {chipRow}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-[8.25rem] flex justify-center lg:top-4">{searchAreaButton}</div>

        {/* mobile bottom sheet: Peek → Browse → Expanded, sized by content */}
        <section
          aria-label="Results"
          style={measured ? { height: sheetPx } : undefined}
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] lg:hidden ${dragH === null ? "transition-[height] duration-300 ease-out motion-reduce:transition-none" : ""} ${measured ? "" : "h-[7.5rem]"}`}
        >
          <div
            ref={headRef}
            role="button"
            tabIndex={0}
            onPointerDown={onSheetDown}
            onPointerMove={onSheetMove}
            onPointerUp={onSheetUp}
            onPointerCancel={() => {
              sheetDrag.current = null;
              setDragH(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSheet(nextOnTap(sheet, heights));
              }
            }}
            aria-label={sheet === "expanded" ? "Collapse results" : "Expand results"}
            aria-expanded={sheet !== "peek"}
            className="flex w-full shrink-0 cursor-grab touch-none select-none flex-col items-center gap-1.5 px-4 pb-2 pt-2 active:cursor-grabbing"
          >
            <span aria-hidden className="h-1.5 w-10 rounded-full bg-black/15" />
            <span className="flex w-full items-center justify-between gap-3">
              <span className="font-display text-[15px] font-bold text-ink">{loading && !data ? "Finding…" : countLine}</span>
              {total > 0 && (
                <button type="button" data-sheet-action onClick={toggleList} className="flex min-h-9 items-center gap-1.5 rounded-full bg-black/[0.05] px-3 text-xs font-bold text-ink/75">
                  <Icon d={sheet === "peek" ? LIST : MAP} className="h-3.5 w-3.5" />
                  {sheet === "peek" ? "List" : "Map"}
                </button>
              )}
            </span>
          </div>
          <div
            ref={listRef}
            className={`min-h-0 flex-1 overscroll-contain px-3 ${sheet === "peek" && !selectedFeature ? "overflow-hidden" : "overflow-y-auto"}`}
          >
            <div ref={contentRef} className="flex flex-col gap-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {renderPreview(true)}
              {renderList(true)}
            </div>
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
            {renderList(false)}
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
          {selectedFeature && view === "map" && <div className="mb-4 rounded-2xl bg-findmi-50/60 p-3">{renderPreview(false)}</div>}
          {renderList(false)}
        </div>
      </aside>

      {filtersOpen && <MapFilterSheet initial={query} options={options} count={count} facets={facets} labels={chipLabels} onClose={() => setFiltersOpen(false)} onApply={(q) => { setFiltersOpen(false); apply(q); }} />}
    </div>
  );
}
