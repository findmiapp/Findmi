"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Bbox } from "@/lib/discovery/map-core";
import { bboxParam, boundsOf, geoFeatures, type GeoResponse, type GeoResult, type ViewMode } from "@/lib/geo-results";
import { DEFAULT_MAP_BBOX } from "@/lib/map-config";
import GeoResultCard from "./GeoResultCard";
import ViewModeSwitch from "./ViewModeSwitch";
import { movedMeaningfully, nextOnTap, sheetHeights, snapAfterDrag, type SheetState } from "./sheet";

// Map Everywhere — an archive's List / Map / Split.
//
// List is a content browsing surface: compact heading (with the Map
// action), one search + Refine row, only the quick lenses that earn their
// space, then the page's own server-rendered results (crawlable, keyboard
// accessible, the default and lightest state — MapLibre never loads).
//
// Map is a geographic browsing surface, not a map inside the List page: on
// phones the archive becomes a screen below the Findmi header — compact
// controls, the map filling the rest of the dynamic viewport, and /map's
// own Peek / Browse / Expanded sheet model (components/map/sheet.ts) for
// the results, with a persistent List action. Desktop keeps List / Map /
// Split (sticky map beside the List, hover ↔ marker sync).
//
// Both draw the SAME result set (/api/geo/<surface> reads the archive's own
// URL). The map never queries while it moves: Search This Area puts the
// view into the URL (`bbox`), narrowing List and Map together.

const DiscoveryMapCanvas = dynamic(() => import("./DiscoveryMapCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#eef0ef] motion-reduce:animate-none" />,
});

/** The List item a map result belongs to ("br:<id>@<loc>" → "br:<id>"). */
export const entityOf = (key: string) => key.split("@")[0];
const PRESENTATION = ["view", "limit"];
/** Rich labels shown before any click (the map's story, not label soup). */
const PROMOTED_LABELS = 6;

const LIST_ICON = "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01";
const MAP_ICON = "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14";
const Glyph = ({ d, className = "h-4 w-4" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d={d} />
  </svg>
);

const isPhone = () => typeof window !== "undefined" && !(window.matchMedia?.("(min-width: 1024px)").matches ?? false);

export default function ArchiveGeoShell({
  surface,
  initialView,
  bbox,
  noun,
  allowSplit = true,
  title,
  subtitle,
  count,
  controls,
  lenses,
  chips,
  children,
}: {
  surface: "events" | "locations" | "brands" | "find";
  initialView: ViewMode;
  /** The archive's intentional map area (Search This Area), if any. */
  bbox: Bbox | null;
  /** ["Event", "Events"] */
  noun: [string, string];
  allowSplit?: boolean;
  /** The archive heading (rendered as the page's h1). */
  title: string;
  /** Desktop-only supporting line under the heading. */
  subtitle?: string;
  /** The List's own result count ("8 events this week") — sits beside the
   * heading instead of costing a row; the Map states its own count. */
  count?: ReactNode;
  /** The search + Refine row (the page's own GET form). */
  controls: ReactNode;
  /** Quick lenses worth their space (Events / Pop-Ups time lenses). */
  lenses?: ReactNode;
  /** Compact active-filter chips. */
  chips?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const normalize = (v: ViewMode) => (v === "split" && !allowSplit ? "map" : v);
  const [view, setViewState] = useState<ViewMode>(normalize(initialView));
  const [data, setData] = useState<{ key: string; body: GeoResponse } | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** Sheet strip browsing highlights a marker without selecting it. */
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Bbox | null>(null);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [fit, setFit] = useState<{ bbox: Bbox; key: number } | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const queried = useRef<Bbox | null>(bbox);
  const bboxRef = useRef(bbox);
  bboxRef.current = bbox;
  const awaitingFit = useRef(true);
  /** The last map view for this query — re-entering Map keeps it. */
  const lastView = useRef<{ key: string; bbox: Bbox } | null>(null);
  /** List item to bring into view when returning from the Map. */
  const pendingListFocus = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Back / forward between modes (the URL is the source of truth).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setViewState(normalize(initialView)), [initialView, allowSplit]);

  // The archive query, minus presentation — the identity of the result set.
  const queryKey = useMemo(() => {
    const p = new URLSearchParams(search.toString());
    for (const k of PRESENTATION) p.delete(k);
    p.sort();
    return p.toString();
  }, [search]);

  const hrefWith = useCallback(
    (edit: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(search.toString());
      edit(p);
      const qs = p.toString();
      return `${pathname}${qs ? `?${qs}` : ""}`;
    },
    [pathname, search]
  );

  const geoMode = view !== "list";

  const setView = (v: ViewMode) => {
    if (v === "list" && selected && results) {
      // Map → List keeps context: the selected place's first result.
      const f = features.find((x) => x.id === selected);
      pendingListFocus.current = f?.keys[0] ? entityOf(f.keys[0]) : null;
      // The navigation may remount the archive: keep the hint for one read.
      try {
        if (pendingListFocus.current) window.sessionStorage.setItem(`findmi-geo-focus:${surface}`, pendingListFocus.current);
      } catch {
        /* storage unavailable — in-memory hint only */
      }
    }
    setViewState(v);
    setSelected(null);
    setBrowsing(null);
    setSheet("peek");
    // A real navigation (pushed, so Back returns to the previous mode) —
    // every filter link the server renders then carries the mode too.
    startTransition(() => router.push(hrefWith((p) => (v === "list" ? p.delete("view") : p.set("view", v))), { scroll: false }));
  };

  // Phones: the Map is a screen — the page under it doesn't scroll.
  useEffect(() => {
    if (!geoMode || !isPhone()) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [geoMode]);

  // Returning to the List near the place last selected on the Map.
  useEffect(() => {
    if (view !== "list") return;
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(`findmi-geo-focus:${surface}`);
      window.sessionStorage.removeItem(`findmi-geo-focus:${surface}`);
    } catch {
      /* storage unavailable */
    }
    const key = pendingListFocus.current ?? stored;
    pendingListFocus.current = null;
    if (!key) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-geo-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.toggleAttribute("data-geo-selected", true);
    const t = setTimeout(() => el.toggleAttribute("data-geo-selected", false), 2400);
    return () => clearTimeout(t);
  }, [view, surface]);

  // ---- geo results: fetched only when a map is showing, once per query.
  useEffect(() => {
    if (!geoMode || data?.key === queryKey) return;
    const c = new AbortController();
    setFailed(false);
    fetch(`/api/geo/${surface}?${queryKey}`, { signal: c.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: GeoResponse) => {
        if (c.signal.aborted) return;
        setData({ key: queryKey, body });
        setSelected(null);
        setBrowsing(null);
        setShowSearchArea(false);
        // What was queried: the URL's map area, or the results' extent the
        // map opens on (the canvas reports no move for its first view).
        queried.current = bbox ?? boundsOf(body.results);
        lastView.current = null;
        if (!bbox) {
          const b = boundsOf(body.results);
          if (b) {
            awaitingFit.current = true;
            setFit({ bbox: b, key: Date.now() });
          }
        }
      })
      .catch(() => !c.signal.aborted && setFailed(true));
    return () => c.abort();
  }, [geoMode, queryKey, surface, bbox, data?.key]);

  const results = data?.key === queryKey ? data.body.results : null;
  const features = useMemo(() => (results ? geoFeatures(results, { promote: PROMOTED_LABELS }) : []), [results]);
  const featureOfKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of features) for (const k of f.keys) m.set(k, f.id);
    return m;
  }, [features]);
  const featureByEntity = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of features) for (const k of f.keys) m.set(entityOf(k), f.id);
    return m;
  }, [features]);
  const selectedFeature = features.find((f) => f.id === selected) ?? null;
  const selectedResults = useMemo(() => (selectedFeature && results ? results.filter((r) => selectedFeature.keys.includes(r.key)) : []), [selectedFeature, results]);
  const initialBbox = useMemo<Bbox>(
    () => (lastView.current?.key === queryKey ? lastView.current.bbox : null) ?? bbox ?? (results ? boundsOf(results) : null) ?? DEFAULT_MAP_BBOX,
    // Only the first view of a mounted map matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bbox, results, queryKey, view]
  );

  const selectFeature = (id: string | null) => {
    setSelected(id);
    setBrowsing(null);
    setSheet("peek");
    stripRef.current?.scrollTo?.({ left: 0 });
  };
  const selectResult = (r: GeoResult) => {
    const id = featureOfKey.get(r.key);
    if (!id) return;
    selectFeature(id);
    setFocus({ lng: r.place.lng, lat: r.place.lat, key: Date.now() });
  };

  // ---- Split: List ↔ Map selection
  useEffect(() => {
    const list = listRef.current;
    if (!list || view === "list") return;
    const keys = new Set(selectedFeature?.keys.map(entityOf) ?? []);
    let first: Element | null = null;
    for (const el of list.querySelectorAll<HTMLElement>("[data-geo-key]")) {
      const on = keys.has(el.dataset.geoKey ?? "");
      el.toggleAttribute("data-geo-selected", on);
      if (on && !first) first = el;
    }
    if (first && view === "split" && !isPhone()) first.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedFeature, view]);
  const onListPointer = (e: React.PointerEvent | React.FocusEvent) => {
    if (view !== "split") return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-geo-key]");
    const f = el?.dataset.geoKey ? featureByEntity.get(el.dataset.geoKey) : undefined;
    if (f && f !== selected) setSelected(f);
  };

  const onViewportChange = useCallback(
    (b: Bbox, byUser: boolean) => {
      setViewport(b);
      lastView.current = { key: queryKey, bbox: b };
      if (!byUser) {
        // The map just placed itself (first view, or fitted to the results):
        // that view is what was queried — unless the URL names a map area.
        // Only that one placement counts (a drag's inertia also ends
        // without a user event and must not move the queried bounds).
        if (awaitingFit.current && !bboxRef.current) queried.current = b;
        awaitingFit.current = false;
        return;
      }
      setShowSearchArea(movedMeaningfully(queried.current, b));
    },
    [queryKey]
  );
  const searchThisArea = () => {
    if (!viewport) return;
    setShowSearchArea(false);
    queried.current = viewport;
    startTransition(() =>
      router.push(
        hrefWith((p) => {
          p.set("bbox", bboxParam(viewport));
          p.delete("limit");
        }),
        { scroll: false }
      )
    );
  };
  const clearAreaHref = hrefWith((p) => {
    p.delete("bbox");
    p.delete("limit");
  });

  const total = data?.key === queryKey ? data.body.total : null;
  // Counted in List items (a Brand at three places is one Brand on the map).
  const mapped = useMemo(() => (results ? new Set(results.map((r) => entityOf(r.key))).size : 0), [results]);
  const [one, many] = noun;
  const unmapped = total !== null ? Math.max(0, total - mapped) : 0;
  const mappedLine = results ? `${mapped.toLocaleString()} ${mapped === 1 ? one : many} on the map` : "Finding…";
  const partialLine = results && unmapped > 0 ? `${unmapped.toLocaleString()} without ${unmapped === 1 ? "a location" : "locations"}${data?.body.truncated ? " · zoom in for more" : ""}` : null;

  // ---------------------------------------------------------------- mobile sheet (the /map model)
  const [sheet, setSheet] = useState<SheetState>("peek");
  const [dragH, setDragH] = useState<number | null>(null);
  const sheetDrag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ column: 0, head: 0, peekBody: 0, contentBody: 0 });
  const sheetResults = selectedFeature ? selectedResults : (results ?? []);
  useEffect(() => {
    if (!geoMode || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = {
        column: bodyRef.current?.offsetHeight ?? 0,
        head: headRef.current?.offsetHeight ?? 0,
        peekBody: stripRef.current ? stripRef.current.offsetHeight + 12 : 0,
        // The vertical list: measured when shown, else its natural size.
        contentBody: contentRef.current ? contentRef.current.offsetHeight + 12 : sheetResults.length * 86 + 12,
      };
      setMetrics((m) => (Object.keys(next).every((k) => Math.abs(m[k as keyof typeof m] - next[k as keyof typeof next]) < 1) ? m : next));
    };
    const ro = new ResizeObserver(measure);
    for (const r of [bodyRef, headRef, stripRef, contentRef]) if (r.current) ro.observe(r.current);
    measure();
    return () => ro.disconnect();
  });
  const heights = sheetHeights({ ...metrics, topReserve: 64 });
  const measured = metrics.column > 0 && metrics.head > 0;
  const sheetPx = dragH ?? heights[sheet];
  const onSheetDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    sheetDrag.current = { y: e.clientY, h: heights[sheet], moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onSheetMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = sheetDrag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setDragH(Math.max(heights.peek, Math.min(heights.expanded, d.h - dy)));
  };
  const onSheetUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    if (!d) return;
    const released = dragH ?? heights[sheet];
    setDragH(null);
    setSheet(d.moved ? snapAfterDrag(sheet, heights, released, e.clientY - d.y) : nextOnTap(sheet, heights));
  };
  // Browsing the Peek strip highlights each result's place on the map.
  const onStripScroll = () => {
    const strip = stripRef.current;
    if (!strip || selectedFeature) return;
    const cards = [...strip.querySelectorAll<HTMLElement>("[data-geo-card]")];
    const left = strip.getBoundingClientRect().left;
    const near = cards.reduce<HTMLElement | null>((best, c) => (!best || Math.abs(c.getBoundingClientRect().left - left) < Math.abs(best.getBoundingClientRect().left - left) ? c : best), null);
    const id = near?.dataset.geoCard ? featureOfKey.get(near.dataset.geoCard) : undefined;
    if (id && id !== browsing) setBrowsing(id);
  };

  const sheetTitle = selectedFeature ? `${selectedFeature.place} · ${selectedResults.length} ${selectedResults.length === 1 ? one : many}` : mappedLine;

  // ---------------------------------------------------------------- pieces
  const viewAction = (
    <>
      <button
        type="button"
        onClick={() => setView(geoMode ? "list" : "map")}
        aria-label={geoMode ? `Show ${many} as a List` : `Show ${many} on a Map`}
        className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3.5 text-sm font-semibold text-ink shadow-sm hover:border-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi lg:hidden"
      >
        <Glyph d={geoMode ? LIST_ICON : MAP_ICON} />
        {geoMode ? "List" : "Map"}
      </button>
      <ViewModeSwitch value={view} onChange={setView} allowSplit={allowSplit} className="hidden lg:inline-flex" />
    </>
  );

  const searchAreaButton = showSearchArea ? (
    <button type="button" onClick={searchThisArea} className="pointer-events-auto rounded-full border border-black/[0.08] bg-white/95 px-3.5 py-1.5 text-[13px] font-bold text-ink shadow-[0_4px_14px_rgba(0,0,0,0.12)] backdrop-blur">
      Search This Area
    </button>
  ) : null;

  const mapCanvas =
    results && mapped > 0 ? (
      <DiscoveryMapCanvas
        features={features}
        selectedId={selected ?? browsing}
        onSelect={selectFeature}
        onViewportChange={onViewportChange}
        initialBbox={initialBbox}
        fit={fit}
        focus={focus}
        padding={isPhone() ? { top: 56, bottom: (measured ? heights[sheet] : 140) + 12, left: 28, right: 28 } : undefined}
        label={`Map of ${many}`}
      />
    ) : results ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 pb-40 text-center lg:pb-6">
        <p className="font-display text-[15px] font-bold text-ink">{total ? `None of these ${many} are on the map yet.` : `No ${many} match these filters.`}</p>
        <p className="max-w-xs text-sm text-ink/60">{total ? `Only ${many} at a placed Findmi Location appear here. All ${total.toLocaleString()} are in the List.` : "Try changing a filter."}</p>
        <button type="button" onClick={() => setView("list")} className="rounded-full bg-findmi px-4 py-2 text-sm font-bold text-white">
          Show List
        </button>
      </div>
    ) : failed ? (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink/60">The map couldn&rsquo;t load. The List still has every result.</div>
    ) : (
      <div className="h-full w-full animate-pulse bg-[#eef0ef] motion-reduce:animate-none" />
    );

  const mobileSheet = (
    <section
      aria-label={`${many} on the map`}
      style={measured ? { height: sheetPx } : undefined}
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] lg:hidden ${dragH === null ? "transition-[height] duration-300 ease-out motion-reduce:transition-none" : ""} ${measured ? "" : "h-[9.5rem]"}`}
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
          <span className="min-w-0">
            <span className="block truncate font-display text-[15px] font-bold text-ink">{sheetTitle}</span>
            {!selectedFeature && partialLine && <span className="block truncate text-[11px] font-semibold text-ink/50">{partialLine}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {selectedFeature && (
              <button type="button" onClick={() => selectFeature(null)} aria-label="Show all results" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.05] text-ink/70">
                <Glyph d="M6 6l12 12M18 6 6 18" className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setView("list")} className="flex min-h-9 items-center gap-1.5 rounded-full bg-black/[0.05] px-3 text-xs font-bold text-ink/75">
              <Glyph d={LIST_ICON} className="h-3.5 w-3.5" />
              List
            </button>
          </span>
        </span>
      </div>
      <div className={`min-h-0 flex-1 overscroll-contain ${sheet === "peek" ? "overflow-hidden" : "overflow-y-auto"}`}>
        {sheet === "peek" ? (
          sheetResults.length > 0 && (
            <div ref={stripRef} onScroll={onStripScroll} className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sheetResults.slice(0, 30).map((r) => (
                <div key={r.key} className="w-[84%] max-w-[22rem] shrink-0 snap-start">
                  <GeoResultCard result={r} compact selected={selectedFeature !== null || browsing === featureOfKey.get(r.key)} onSelect={selectResult} />
                </div>
              ))}
            </div>
          )
        ) : (
          <div ref={contentRef} className="flex flex-col gap-2 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {sheetResults.map((r) => (
              <GeoResultCard key={r.key} result={r} compact selected={selected !== null && featureOfKey.get(r.key) === selected} onSelect={selectResult} />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  const desktopSelection =
    view === "map" && selectedResults.length > 0 ? (
      <div className="absolute bottom-3 left-3 hidden max-h-[45%] w-96 flex-col gap-2 overflow-y-auto rounded-2xl bg-white/95 p-2 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] backdrop-blur lg:flex">
        <div className="flex items-center justify-between px-1">
          <p className="truncate text-xs font-bold text-ink/60">{sheetTitle}</p>
          <button type="button" onClick={() => selectFeature(null)} aria-label="Close" className="rounded-full p-1 text-ink/50 hover:text-ink">
            <Glyph d="M6 6l12 12M18 6 6 18" />
          </button>
        </div>
        {selectedResults.map((r) => (
          <GeoResultCard key={r.key} result={r} compact />
        ))}
      </div>
    ) : null;

  const areaChip = bbox ? (
    <Link href={clearAreaHref} scroll={false} aria-label="Remove Map Area" className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-findmi/40 bg-findmi-50 px-3 text-xs font-semibold text-findmi-700 hover:border-findmi">
      Map Area
      <Glyph d="M6 6l12 12M18 6 6 18" className="h-3 w-3" />
    </Link>
  ) : null;

  const hasChips = Boolean(chips) || Boolean(areaChip);

  return (
    <div data-geo-shell={surface} data-view={view} className={geoMode ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-[calc(3.5rem+var(--admin-bar-h))] max-lg:z-30 max-lg:flex max-lg:flex-col max-lg:bg-paper" : ""}>
      {/* Controls: heading + view action, search + Refine, lenses, chips. */}
      <div className={`flex flex-col ${geoMode ? "gap-2 max-lg:shrink-0 max-lg:px-4 max-lg:pb-2 max-lg:pt-2" : "gap-2 sm:gap-3"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className={`min-w-0 truncate font-display font-bold tracking-tight text-ink ${geoMode ? "text-lg lg:text-3xl" : "text-[1.375rem] leading-tight sm:text-3xl"}`}>{title}</h1>
            {count && !geoMode && <p className="shrink-0 truncate text-xs font-medium text-ink/45">{count}</p>}
          </div>
          {viewAction}
        </div>
        {subtitle && !geoMode && <p className="-mt-2 hidden text-sm text-ink/60 sm:block sm:text-base">{subtitle}</p>}
        {controls}
        {lenses}
        {hasChips && (
          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {areaChip}
            {chips}
          </div>
        )}
        {geoMode && (countNoteDesktop(mappedLine, partialLine, results !== null))}
      </div>

      {/* Body */}
      <div className={view === "split" ? "max-lg:relative max-lg:min-h-0 max-lg:flex-1 lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-5" : geoMode ? "max-lg:relative max-lg:min-h-0 max-lg:flex-1 lg:mt-4" : ""}>
        <div
          ref={listRef}
          onPointerOver={onListPointer}
          onFocus={onListPointer}
          className={`${view === "map" ? "hidden" : view === "split" ? "hidden lg:block lg:[&_[data-geo-grid]]:grid-cols-1 xl:[&_[data-geo-grid]]:grid-cols-2" : ""} [&_[data-geo-selected]]:rounded-2xl [&_[data-geo-selected]]:ring-2 [&_[data-geo-selected]]:ring-findmi`}
        >
          {children}
        </div>
        {geoMode && (
          <div
            ref={bodyRef}
            style={{ ["--sheet-h" as string]: `${measured ? sheetPx : 152}px` }}
            className={`relative overflow-hidden bg-[#eef0ef] max-lg:absolute max-lg:inset-0 max-lg:[&_.maplibregl-ctrl-bottom-right]:!bottom-[calc(var(--sheet-h)+0.25rem)] ${sheet !== "peek" || dragH !== null ? "max-lg:[&_.maplibregl-ctrl-bottom-right]:hidden max-lg:[&_[data-search-area]]:hidden" : ""} lg:rounded-2xl lg:border lg:border-black/5 ${view === "split" ? "lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:min-h-[420px]" : "lg:h-[calc(100vh-12rem)] lg:min-h-[480px]"}`}
          >
            {mapCanvas}
            <div data-search-area className="pointer-events-none absolute inset-x-0 top-3 z-[5] flex justify-center px-3">{searchAreaButton}</div>
            {desktopSelection}
            {mobileSheet}
          </div>
        )}
      </div>
    </div>
  );
}

/** Desktop only: the quiet mapped / partial note under the controls (on
 * phones it lives in the sheet header). */
function countNoteDesktop(mappedLine: string, partialLine: string | null, ready: boolean) {
  if (!ready) return null;
  return (
    <p className="hidden text-xs font-semibold text-ink/55 lg:block">
      {mappedLine}
      {partialLine ? ` · ${partialLine}` : ""}
    </p>
  );
}
