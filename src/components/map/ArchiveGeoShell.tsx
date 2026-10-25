"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { Bbox } from "@/lib/discovery/map-core";
import { bboxParam, boundsOf, geoFeatures, type GeoResponse, type ViewMode } from "@/lib/geo-results";
import { DEFAULT_MAP_BBOX } from "@/lib/map-config";
import GeoResultCard from "./GeoResultCard";
import ViewModeSwitch from "./ViewModeSwitch";
import { movedMeaningfully } from "./sheet";

// Map Everywhere — an archive's List / Map / Split. The List is the page's
// own server-rendered results (crawlable, keyboard-accessible, the default
// and lightest state); Map and Split draw the SAME result set from
// /api/geo/<surface> with the archive's own URL, through the one shared
// renderer. The map never queries while it moves: Search This Area puts
// the view into the URL (`bbox`), which narrows the List and the Map
// together. Nothing loads MapLibre until Map or Split is chosen.

const DiscoveryMapCanvas = dynamic(() => import("./DiscoveryMapCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#eef0ef] motion-reduce:animate-none" />,
});

/** The List item a map result belongs to ("br:<id>@<loc>" → "br:<id>"). */
export const entityOf = (key: string) => key.split("@")[0];
const PRESENTATION = ["view", "limit"];

export default function ArchiveGeoShell({
  surface,
  initialView,
  bbox,
  noun,
  allowSplit = true,
  children,
}: {
  surface: "events" | "locations" | "brands" | "find";
  initialView: ViewMode;
  /** The archive's intentional map area (Search This Area), if any. */
  bbox: Bbox | null;
  /** ["Event", "Events"] */
  noun: [string, string];
  allowSplit?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const [view, setViewState] = useState<ViewMode>(initialView === "split" && !allowSplit ? "map" : initialView);
  const [data, setData] = useState<{ key: string; body: GeoResponse } | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Bbox | null>(null);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [fit, setFit] = useState<{ bbox: Bbox; key: number } | null>(null);
  const queried = useRef<Bbox | null>(bbox);
  const bboxRef = useRef(bbox);
  const awaitingFit = useRef(true);
  bboxRef.current = bbox;
  const listRef = useRef<HTMLDivElement>(null);

  // Back / forward between modes (the URL is the source of truth).
  useEffect(() => setViewState(initialView === "split" && !allowSplit ? "map" : initialView), [initialView, allowSplit]);

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

  const setView = (v: ViewMode) => {
    setViewState(v);
    setSelected(null);
    // A real navigation (pushed, so Back returns to the previous mode) —
    // every filter link the server renders then carries the mode too.
    startTransition(() => router.push(hrefWith((p) => (v === "list" ? p.delete("view") : p.set("view", v))), { scroll: false }));
  };

  // ---- geo results: fetched only when a map is showing, once per query.
  const showingMap = view !== "list";
  useEffect(() => {
    if (!showingMap || data?.key === queryKey) return;
    const c = new AbortController();
    setFailed(false);
    fetch(`/api/geo/${surface}?${queryKey}`, { signal: c.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: GeoResponse) => {
        if (c.signal.aborted) return;
        setData({ key: queryKey, body });
        setSelected(null);
        setShowSearchArea(false);
        // What was queried: the URL's map area, or the results' extent the
        // map opens on (the canvas reports no move for its first view).
        queried.current = bbox ?? boundsOf(body.results);
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
  }, [showingMap, queryKey, surface, bbox, data?.key]);

  const results = data?.key === queryKey ? data.body.results : null;
  const features = useMemo(() => (results ? geoFeatures(results) : []), [results]);
  const featureByEntity = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of features) for (const k of f.keys) m.set(entityOf(k), f.id);
    return m;
  }, [features]);
  const selectedFeature = features.find((f) => f.id === selected) ?? null;
  const selectedResults = selectedFeature && results ? results.filter((r) => selectedFeature.keys.includes(r.key)) : [];
  const initialBbox = useMemo<Bbox>(() => bbox ?? (results ? boundsOf(results) : null) ?? DEFAULT_MAP_BBOX, [bbox, results]);

  // ---- Split: List ↔ Map selection
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const keys = new Set(selectedFeature?.keys.map(entityOf) ?? []);
    let first: Element | null = null;
    for (const el of list.querySelectorAll<HTMLElement>("[data-geo-key]")) {
      const on = keys.has(el.dataset.geoKey ?? "");
      el.toggleAttribute("data-geo-selected", on);
      if (on && !first) first = el;
    }
    if (first && view === "split") first.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedFeature, view]);
  const onListPointer = (e: React.PointerEvent | React.FocusEvent) => {
    if (view !== "split") return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-geo-key]");
    const f = el?.dataset.geoKey ? featureByEntity.get(el.dataset.geoKey) : undefined;
    if (f && f !== selected) setSelected(f);
  };

  const onViewportChange = useCallback((b: Bbox, byUser: boolean) => {
    setViewport(b);
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
  }, []);
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
  const countNote =
    results && total !== null && total > 0
      ? mapped === total
        ? `${total.toLocaleString()} ${total === 1 ? one : many} on the map`
        : `${mapped.toLocaleString()} of ${total.toLocaleString()} ${many} on the map${data?.body.truncated ? " — zoom in or Search This Area for more" : ""}`
      : null;

  const map = (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-black/5 bg-[#eef0ef]">
      {results && mapped > 0 ? (
        <DiscoveryMapCanvas features={features} selectedId={selected} onSelect={setSelected} onViewportChange={onViewportChange} initialBbox={initialBbox} fit={fit} label={`Map of ${many}`} />
      ) : results ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
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
      )}
      <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-2 px-3">
        {showSearchArea && (
          <button type="button" onClick={searchThisArea} className="pointer-events-auto rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[13px] font-bold text-ink shadow-[0_4px_18px_rgba(0,0,0,0.12)]">
            Search This Area
          </button>
        )}
      </div>
      {view !== "list" && selectedResults.length > 0 && (
        <div className={`absolute inset-x-2 bottom-2 flex ${view === "split" ? "lg:hidden" : ""} max-h-[45%] flex-col gap-2 overflow-y-auto rounded-2xl bg-white/95 p-2 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] backdrop-blur sm:inset-x-auto sm:left-3 sm:w-96`}>
          <div className="flex items-center justify-between px-1">
            <p className="truncate text-xs font-bold text-ink/60">{selectedFeature?.place}</p>
            <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="rounded-full p-1 text-ink/50 hover:text-ink">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {selectedResults.map((r) => (
            <GeoResultCard key={r.key} result={r} compact />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div data-geo-shell={surface} data-view={view}>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <ViewModeSwitch value={view} onChange={setView} allowSplit={allowSplit} />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {bbox && (
            <Link href={clearAreaHref} scroll={false} aria-label="Remove Map Area" className="flex min-h-9 items-center gap-1.5 rounded-full border border-findmi/40 bg-findmi-50 px-3.5 text-[13px] font-semibold text-findmi-700 hover:border-findmi">
              Map Area
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3 w-3" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </Link>
          )}
          {showingMap && countNote && <p className="text-xs font-semibold text-ink/55">{countNote}</p>}
        </div>
      </div>
      <div className={view === "split" ? "mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-5" : "mt-0"}>
        <div
          ref={listRef}
          onPointerOver={onListPointer}
          onFocus={onListPointer}
          className={`${view === "map" ? "hidden" : view === "split" ? "hidden lg:block lg:[&_[data-geo-grid]]:grid-cols-1 xl:[&_[data-geo-grid]]:grid-cols-2 [&_[data-geo-selected]]:rounded-2xl [&_[data-geo-selected]]:ring-2 [&_[data-geo-selected]]:ring-findmi" : ""}`}
        >
          {children}
        </div>
        {showingMap && <div className={view === "split" ? "mt-4 h-[calc(100dvh-11rem)] min-h-[420px] lg:sticky lg:top-24 lg:mt-0 lg:h-[calc(100vh-8rem)]" : "mt-4 h-[calc(100dvh-12rem)] min-h-[420px] lg:h-[calc(100vh-14rem)]"}>{map}</div>}
      </div>
    </div>
  );
}
