"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, MapGeoJSONFeature, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bbox, MapFeature } from "@/lib/discovery/map-core";
import { MAP_LABEL_FONT, MAP_LABEL_FONT_BOLD, MAP_STYLE_URL } from "@/lib/map-config";
import { labelShift, LOGO_IMAGE_SIZE, logoPlaceholder, placeFallbackImage, secondaryLine, SELECTED_ANCHOR_OFFSET } from "./marker-images";

// Discovery Map renderer. Population rendering is entirely native MapLibre
// layers on ONE clustered GeoJSON source (no React/DOM marker per result):
//   far   → clusters (count = qualifying results under the current query)
//   mid   → standardized Findmi markers (white shell, Aqua ring; LIVE ring
//           in red AND a "LIVE" word in the label — never color alone)
//   close → Brand/Place logo inside the shell + identity label
//   closer→ identity + status/time label ("Lavazza · LIVE · Ends 4 PM")
// Only the SELECTED result gets a rich DOM marker. The canvas never fetches
// on pan/zoom; it reports the viewport and the page decides (Search This
// Area).

const AQUA = "#14B0BC";
const INK = "#111111";
const LIVE = "#DC2626";
const SRC = "fm-results";
const USER_SRC = "fm-user";
const POINT_LAYERS = ["fm-point", "fm-logo", "fm-label", "fm-promo"];
// fm-point styling inputs: does a logo sit on this marker, and its ring/fill
// color (red when LIVE, Aqua otherwise).
const HAS_LOGO: ExpressionSpecification = ["!=", ["get", "logo"], ""];
const RING: ExpressionSpecification = ["case", ["==", ["get", "liveN"], 1], LIVE, AQUA];

export interface CanvasProps {
  features: MapFeature[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onViewportChange: (bbox: Bbox, byUser: boolean) => void;
  initialBbox: Bbox;
  /** Fit to these bounds whenever `fit.key` changes. */
  fit?: { bbox: Bbox; key: number } | null;
  /** Pan to this point whenever `focus.key` changes. */
  focus?: { lng: number; lat: number; key: number } | null;
  /** The viewer's own position — only when they chose Near Me; held in
   * memory, never stored. */
  userPosition?: { lat: number; lng: number } | null;
  /** Padding (px) the bottom sheet / side panel covers. */
  padding?: { top: number; bottom: number; left: number; right: number };
  label?: string;
  /** In-page maps (detail pages): one finger scrolls the page, two pan
   * the map; on desktop the wheel needs a modifier. Off for /map. */
  cooperativeGestures?: boolean;
  /** Archive and contextual maps: MapLibre's own compact attribution is
   * shown when the map first appears and then folded back to its ⓘ
   * button after a few seconds (as it already does on the first drag) —
   * by pressing that control's own toggle, never by hiding it. Off for
   * /map. */
  autoCollapseAttribution?: boolean;
}

/** How long the full credits stay open on a map that set
 * autoCollapseAttribution. */
export const ATTRIBUTION_OPEN_MS = 5000;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function toGeoJSON(features: MapFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      id: undefined,
      geometry: { type: "Point", coordinates: [f.lng, f.lat] },
      properties: {
        id: f.id,
        count: f.count,
        liveN: f.live ? 1 : 0,
        label: f.count > 1 && !f.plainLabel ? `${f.label} +${f.count - 1}` : f.label,
        statusLine: f.live ? (f.status && f.status !== "LIVE" ? `LIVE · ${f.status}` : "LIVE") : f.status,
        logo: f.logo ? `logo:${f.logo}` : "",
        initial: f.pinText ?? (f.label || f.place || "?").slice(0, 1).toUpperCase(),
        // Archive maps (Map Everywhere) may promote a few results to rich
        // labels at city zoom; /map never sets it.
        promoted: f.promoted ? 1 : 0,
        rank: f.rank ?? 999,
      },
    })),
  };
}

/** A logo drawn into a round white shell, as a map image. */
async function loadLogoImage(url: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const size = LOGO_IMAGE_SIZE;
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d")!;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.save();
        ctx.clip();
        const s = Math.min(img.width, img.height) || 1;
        const pad = 9;
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, pad, pad, size - pad * 2, size - pad * 2);
        ctx.restore();
        resolve(ctx.getImageData(0, 0, size, size));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function selectedElement(f: MapFeature): HTMLElement {
  const el = document.createElement("div");
  el.className = "pointer-events-none flex -translate-y-1/2 items-center gap-2 rounded-full border border-black/10 bg-white py-1 pl-1 pr-3 shadow-[0_6px_20px_rgba(20,176,188,0.35)] ring-2 " + (f.live ? "ring-red-600" : "ring-findmi");
  const mark = document.createElement("div");
  mark.className = "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-findmi-50 text-xs font-bold text-findmi-700";
  if (f.logo) {
    const img = document.createElement("img");
    img.src = f.logo;
    img.alt = "";
    img.className = "h-full w-full object-contain";
    mark.appendChild(img);
  } else mark.textContent = f.pinText ?? (f.label || "?").slice(0, 1).toUpperCase();
  const text = document.createElement("div");
  text.className = "flex min-w-0 flex-col leading-tight";
  const name = document.createElement("span");
  name.className = "max-w-[11rem] truncate text-[13px] font-bold text-ink";
  name.textContent = f.label;
  text.append(name);
  // The second line (status / category / place) only when it adds
  // something — never the name again.
  const second = secondaryLine(f);
  if (second) {
    const status = document.createElement("span");
    status.className = "max-w-[11rem] truncate text-[11px] font-semibold " + (f.live ? "text-red-600" : "text-findmi-700");
    status.textContent = second;
    text.append(status);
  }
  el.append(mark, text);
  return el;
}

export default function DiscoveryMapCanvas({ features, selectedId, onSelect, onViewportChange, initialBbox, fit, focus, userPosition, padding, label = "Map of results", cooperativeGestures = false, autoCollapseAttribution = false }: CanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const cb = useRef({ onSelect, onViewportChange });
  cb.current = { onSelect, onViewportChange };
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const paddingRef = useRef(padding);
  paddingRef.current = padding;

  // Keep the selected label wholly inside the usable map area: clear of
  // the screen edges, the top controls / results sheet (`padding`) and the
  // map's own controls. Pans only by what's needed (never for a label
  // that already fits).
  const checkPending = useRef(false);
  const keepSelectedVisible = useCallback(() => {
    const map = mapRef.current;
    const el = markerRef.current?.getElement();
    const box = container.current;
    if (!map || !el || !box) return;
    // Mid-move (a focus pan, a fit): check once it has settled — never
    // interrupt it.
    if (map.isMoving()) {
      if (!checkPending.current) {
        checkPending.current = true;
        map.once("moveend", () => {
          checkPending.current = false;
          keepSelectedVisibleRef.current();
        });
      }
      return;
    }
    const c = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!r.width || !c.width) return;
    const pad = paddingRef.current ?? { top: 16, bottom: 16, left: 16, right: 16 };
    const edge = 12;
    const safe = { left: c.left + Math.max(edge, pad.left), right: c.right - Math.max(edge, pad.right), top: c.top + Math.max(edge, pad.top), bottom: c.bottom - Math.max(edge, pad.bottom) };
    const obstacles = [...box.querySelectorAll(".maplibregl-ctrl-group, .maplibregl-ctrl-attrib-button")].map((o) => o.getBoundingClientRect()).filter((o) => o.width > 0);
    const [dx, dy] = labelShift(r, safe, obstacles);
    if (dx || dy) map.panBy([dx, dy], { duration: prefersReducedMotion() ? 0 : 300 });
  }, []);
  const keepSelectedVisibleRef = useRef(keepSelectedVisible);
  keepSelectedVisibleRef.current = keepSelectedVisible;

  // ---- mount once
  useEffect(() => {
    let disposed = false;
    let map: MLMap | null = null;
    (async () => {
      const lib = await import("maplibre-gl");
      if (disposed || !container.current) return;
      libRef.current = lib;
      map = new lib.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        bounds: initialBbox as [number, number, number, number],
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 19,
        fadeDuration: prefersReducedMotion() ? 0 : 200,
        ...(cooperativeGestures ? { cooperativeGestures: true } : {}),
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new lib.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("error", (e) => {
        if (!map?.isStyleLoaded() && /style|Failed to fetch|NetworkError/i.test(String((e as { error?: Error }).error?.message ?? ""))) setFailed(true);
      });
      map.on("styleimagemissing", (e) => {
        const id = (e as { id: string }).id;
        if (!id.startsWith("logo:") || !map) return;
        // Placeholder first (stops repeat events), then the logo — or the
        // Findmi Place mark when it can't be drawn. All three share one
        // size: updateImage rejects an image of different dimensions.
        map.addImage(id, logoPlaceholder(), { pixelRatio: 2 });
        void loadLogoImage(id.slice(5)).then((data) => {
          const image = data ?? placeFallbackImage();
          if (image && map?.hasImage(id)) map.updateImage(id, image);
        });
      });
      map.on("load", () => {
        if (!map) return;
        map.addSource(SRC, {
          type: "geojson",
          data: toGeoJSON(featuresRef.current),
          cluster: true,
          clusterRadius: 46,
          clusterMaxZoom: 16,
          clusterProperties: { total: ["+", ["get", "count"]], live: ["max", ["get", "liveN"]] },
        });
        map.addSource(USER_SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "fm-cluster",
          type: "circle",
          source: SRC,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": ["step", ["get", "total"], 15, 10, 19, 50, 24, 200, 29],
            "circle-stroke-width": 2.5,
            "circle-stroke-color": AQUA,
          },
        });
        // A cluster holding something live gets a small red dot — a hint,
        // not a red flood (at city zoom most clusters hold something live).
        map.addLayer({
          id: "fm-cluster-live",
          type: "circle",
          source: SRC,
          filter: ["all", ["has", "point_count"], [">", ["get", "live"], 0]],
          paint: {
            "circle-color": LIVE,
            "circle-radius": 4,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            // (circle-translate can't be data-driven; this sits on the rim
            // of every cluster size.)
            "circle-translate": [12, -12],
          },
        });
        map.addLayer({
          id: "fm-cluster-count",
          type: "symbol",
          source: SRC,
          filter: ["has", "point_count"],
          layout: { "text-field": ["to-string", ["get", "total"]], "text-font": MAP_LABEL_FONT_BOLD, "text-size": 13, "text-allow-overlap": true },
          paint: { "text-color": INK },
        });
        map.addLayer({
          id: "fm-point",
          type: "circle",
          source: SRC,
          filter: ["!", ["has", "point_count"]],
          // Two looks: once a logo is drawn on top (zoom ≥ 12.5, logo set)
          // this is the white shell + Aqua/LIVE ring under it; otherwise
          // it's a compact FILLED Aqua/LIVE dot with a white edge — never a
          // big hollow white circle (expanded cluster children used to read
          // as empty rings).
          paint: {
            "circle-color": ["step", ["zoom"], RING, 12.5, ["case", HAS_LOGO, "#ffffff", RING]],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 12.5, ["case", HAS_LOGO, 8.5, 7.5], 16, ["case", HAS_LOGO, 14, 10]],
            "circle-stroke-width": ["step", ["zoom"], 2, 12.5, ["case", HAS_LOGO, 3, 2]],
            "circle-stroke-color": ["step", ["zoom"], "#ffffff", 12.5, ["case", HAS_LOGO, RING, "#ffffff"]],
          },
        });
        map.addLayer({
          id: "fm-initial",
          type: "symbol",
          source: SRC,
          minzoom: 12.5,
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "logo"], ""]],
          layout: { "text-field": ["get", "initial"], "text-font": MAP_LABEL_FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 9, 16, 11], "text-allow-overlap": true },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: "fm-logo",
          type: "symbol",
          source: SRC,
          minzoom: 12.5,
          filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "logo"], ""]],
          layout: { "icon-image": ["get", "logo"], "icon-size": ["interpolate", ["linear"], ["zoom"], 12.5, 0.42, 16, 0.62], "icon-allow-overlap": true },
        });
        map.addLayer({
          id: "fm-label",
          type: "symbol",
          source: SRC,
          minzoom: 13.5,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["step", ["zoom"], ["format", ["get", "label"], { "text-font": ["literal", MAP_LABEL_FONT_BOLD] }], 15.5, ["format", ["get", "label"], { "text-font": ["literal", MAP_LABEL_FONT_BOLD] }, "\n", {}, ["get", "statusLine"], { "font-scale": 0.9 }]],
            "text-font": MAP_LABEL_FONT,
            "text-size": 12,
            "text-anchor": "top",
            "text-offset": [0, 1.25],
            "text-max-width": 11,
            "text-optional": true,
            "symbol-sort-key": ["-", 1, ["get", "liveN"]],
          },
          paint: { "text-color": INK, "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
        });
        // Promoted results (archive maps only): identity + status before any
        // click, from city zoom — LIVE first, then the archive's own order
        // (rank); symbol collision keeps only as many as fit.
        map.addLayer({
          id: "fm-promo",
          type: "symbol",
          source: SRC,
          minzoom: 11,
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "promoted"], 1]],
          layout: {
            "text-field": ["format", ["get", "label"], { "text-font": ["literal", MAP_LABEL_FONT_BOLD] }, "\n", {}, ["get", "statusLine"], { "font-scale": 0.88 }],
            "text-font": MAP_LABEL_FONT,
            "text-size": 12,
            "text-anchor": "top",
            "text-offset": [0, 1.25],
            "text-max-width": 12,
            "text-optional": true,
            "symbol-sort-key": ["get", "rank"],
          },
          paint: { "text-color": INK, "text-halo-color": "#ffffff", "text-halo-width": 1.8 },
        });
        map.addLayer({ id: "fm-user-halo", type: "circle", source: USER_SRC, paint: { "circle-radius": 18, "circle-color": INK, "circle-opacity": 0.12 } });
        map.addLayer({ id: "fm-user", type: "circle", source: USER_SRC, paint: { "circle-radius": 7, "circle-color": INK, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });

        map.on("click", "fm-cluster", async (e) => {
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          if (!f || !map) return;
          const src = map.getSource(SRC) as GeoJSONSource;
          const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
          map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: Math.min(zoom, 17), duration: prefersReducedMotion() ? 0 : 500 });
        });
        for (const layer of [...POINT_LAYERS, "fm-initial"]) {
          map.on("click", layer, (e) => {
            const id = e.features?.[0]?.properties?.id as string | undefined;
            if (id) cb.current.onSelect(id);
          });
          map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => map && (map.getCanvas().style.cursor = ""));
        }
        map.on("mouseenter", "fm-cluster", () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "fm-cluster", () => map && (map.getCanvas().style.cursor = ""));
        map.on("click", (e) => {
          if (!map) return;
          const hit = map.queryRenderedFeatures(e.point, { layers: ["fm-cluster", "fm-initial", ...POINT_LAYERS] });
          if (hit.length === 0) cb.current.onSelect(null);
        });
        setReady(true);
        if (autoCollapseAttribution) {
          window.setTimeout(() => {
            // The attribution control's own ⓘ toggle (a <summary>), exactly
            // what a tap does; it stays one tap away, credits unchanged.
            const open = !disposed && container.current?.querySelector<HTMLElement>(".maplibregl-ctrl-attrib.maplibregl-compact.maplibregl-compact-show .maplibregl-ctrl-attrib-button");
            if (open) open.click();
          }, ATTRIBUTION_OPEN_MS);
        }
      });
      map.on("moveend", (e) => {
        if (!map) return;
        const b = map.getBounds();
        cb.current.onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], Boolean((e as { originalEvent?: unknown }).originalEvent));
      });
    })().catch(() => setFailed(true));
    return () => {
      disposed = true;
      markerRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // The map mounts once; later bounds arrive through `fit`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- data
  useEffect(() => {
    const src = ready ? (mapRef.current?.getSource(SRC) as GeoJSONSource | undefined) : undefined;
    src?.setData(toGeoJSON(features));
  }, [features, ready]);

  // ---- selection: the one rich marker; its population marker is hidden
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const notSelected: ["!=", ["get", string], string] = ["!=", ["get", "id"], selectedId ?? ""];
    map.setFilter("fm-point", ["all", ["!", ["has", "point_count"]], notSelected]);
    map.setFilter("fm-logo", ["all", ["!", ["has", "point_count"]], ["!=", ["get", "logo"], ""], notSelected]);
    map.setFilter("fm-initial", ["all", ["!", ["has", "point_count"]], ["==", ["get", "logo"], ""], notSelected]);
    map.setFilter("fm-label", ["all", ["!", ["has", "point_count"]], ["!=", ["get", "promoted"], 1], notSelected]);
    map.setFilter("fm-promo", ["all", ["!", ["has", "point_count"]], ["==", ["get", "promoted"], 1], notSelected]);
    markerRef.current?.remove();
    markerRef.current = null;
    const f = selectedId ? features.find((x) => x.id === selectedId) : null;
    if (f) {
      markerRef.current = new lib.Marker({ element: selectedElement(f), anchor: "left", offset: [-SELECTED_ANCHOR_OFFSET, 0] }).setLngLat([f.lng, f.lat]).addTo(map);
      requestAnimationFrame(keepSelectedVisible);
    }
  }, [selectedId, features, ready, keepSelectedVisible]);

  // ---- programmatic camera moves
  useEffect(() => {
    if (!ready || !fit || !mapRef.current) return;
    mapRef.current.fitBounds(fit.bbox as [number, number, number, number], { padding: padding ?? 40, maxZoom: 15.5, duration: prefersReducedMotion() ? 0 : 600 });
    // `padding` is read at the moment of the move; later changes don't re-fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key, ready]);
  useEffect(() => {
    if (!ready || !focus || !mapRef.current) return;
    const map = mapRef.current;
    // Focusing the selected result: center its whole label (it hangs to the
    // right of the point), not the point — then make sure it fits.
    const marker = markerRef.current;
    const at = marker?.getLngLat();
    const width = marker && at && Math.abs(at.lng - focus.lng) < 1e-9 && Math.abs(at.lat - focus.lat) < 1e-9 ? marker.getElement().getBoundingClientRect().width : 0;
    map.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 14), ...(padding ? { padding } : {}), offset: [width ? -(width / 2 - SELECTED_ANCHOR_OFFSET) : 0, 0], duration: prefersReducedMotion() ? 0 : 500 });
    if (width) keepSelectedVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, ready]);
  useEffect(() => {
    const src = ready ? (mapRef.current?.getSource(USER_SRC) as GeoJSONSource | undefined) : undefined;
    src?.setData({ type: "FeatureCollection", features: userPosition ? [{ type: "Feature", geometry: { type: "Point", coordinates: [userPosition.lng, userPosition.lat] }, properties: {} }] : [] });
  }, [userPosition, ready]);

  return (
    <div className="relative h-full w-full bg-[#eef0ef]">
      {/* h-full, not absolute: maplibre-gl.css makes .maplibregl-map position: relative. */}
      <div ref={container} className="h-full w-full" role="region" aria-label={`${label}. Every result is also listed in the results panel.`} />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-xs rounded-2xl bg-white/95 px-4 py-3 text-sm text-ink/70 shadow-sm">The map couldn&rsquo;t load right now. Every result is still listed below.</p>
        </div>
      )}
    </div>
  );
}
