"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import PlaceFindOrCreate, { NotPublicBadge } from "@/components/places/PlaceFindOrCreate";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import {
  PLACEMENT_PRIVACY_NOTE,
  PLACEMENT_STATUSES,
  PLACEMENT_STATUS_LABELS,
  PLACEMENT_STATUS_TONE,
  formatPlacementDate,
  isEmptyPlacementFilter,
  type PlacementFilter,
} from "@/lib/business-placements-domain";
import type { BusinessPlacementItem, PlacementCounts } from "@/lib/business-placements";
import { addTargetAction, createTargetPlaceAction, searchTargetLocationsAction } from "../placement-actions";
import { Chip } from "../../../owner-ui";

/** Findmi Here → Find Us Here → Targets: the places this Business is privately
 * trying to get into, and where each pursuit stands (Target → In Conversation →
 * Placement Pending → Active, or Passed). Private to the Business's team and
 * Findmi — a Target is never public and never changes Find Us Here.
 *
 * One server-side page at a time, searchable and filterable by status; filters
 * live in the URL (tq / ts / tp). A row opens the place's relationship
 * workspace (`loc` — RelationshipWorkspace.tsx), the same one every lens opens,
 * so Back, Forward and a shared link keep the same view. Owners and managers
 * edit; staff read. */

const BusinessIdContext = createContext("");

/** The Add Target picker's search: linkable places, read through the
 * Business-authorized action (so a founder Admin session works too). A stable,
 * module-level hook; the Business comes from context. */
function useTargetPlaceResults(query: string): { results: SelectedLocationDetail[]; loading: boolean } {
  const businessId = useContext(BusinessIdContext);
  const [results, setResults] = useState<SelectedLocationDetail[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const found = await searchTargetLocationsAction(businessId, query);
      if (!cancelled) {
        setResults(found);
        setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [businessId, query]);
  return { results, loading };
}

type Param = "tq" | "ts" | "tp" | "pt" | "loc";

/** URL helpers that patch the CURRENT url, so whichever lens you came from
 * (Find Us Here, Growth, a Market) stays the context. */
export function useTargetNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const href = (patch: Partial<Record<Param, string | null>>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `${pathname}?${next.toString()}`;
  };
  const go = (patch: Partial<Record<Param, string | null>>, mode: "push" | "replace" = "push") =>
    startNav(() => (mode === "push" ? router.push : router.replace)(href(patch), { scroll: false }));
  return { href, go, navPending, refresh: () => router.refresh() };
}

export function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Privacy() {
  return (
    <p className="flex items-center gap-2 text-metadata text-muted">
      <LockIcon className="h-3.5 w-3.5" />
      <span>{PLACEMENT_PRIVACY_NOTE}</span>
    </p>
  );
}

export function PlaceThumb({ imageUrl }: { imageUrl: string | null }) {
  return (
    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/[0.04] text-ink/25">
      {imageUrl ? <SupabaseImage src={imageUrl} alt="" fill sizes="56px" className="object-cover" /> : <NavIcon name="storefront" className="h-6 w-6" />}
    </span>
  );
}

export function NextActionLine({ item }: { item: Pick<BusinessPlacementItem, "nextAction" | "nextActionAt"> }) {
  if (!item.nextAction && !item.nextActionAt) return null;
  return (
    <span className="mt-0.5 line-clamp-2 text-metadata text-secondary">
      {/* Date first, so a long action can never clip it. */}
      Next: {[item.nextActionAt ? formatPlacementDate(item.nextActionAt) : null, item.nextAction].filter(Boolean).join(" · ")}
    </span>
  );
}


export default function TargetsView({
  businessId,
  available,
  items,
  total,
  page,
  pageSize,
  counts,
  filter,
  canEdit,
  openMissing,
}: {
  businessId: string;
  /** false until the placements migration is applied. */
  available: boolean;
  items: BusinessPlacementItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: PlacementCounts;
  filter: PlacementFilter;
  canEdit: boolean;
  /** A `pt` / `loc` link that isn't a place this Business can open. */
  openMissing: boolean;
}) {
  return (
    <BusinessIdContext.Provider value={businessId}>
      <TargetList businessId={businessId} available={available} items={items} total={total} page={page} pageSize={pageSize} counts={counts} filter={filter} canEdit={canEdit} openMissing={openMissing} />
    </BusinessIdContext.Provider>
  );
}

function TargetList({
  businessId,
  available,
  items,
  total,
  page,
  pageSize,
  counts,
  filter,
  canEdit,
  openMissing,
}: {
  businessId: string;
  available: boolean;
  items: BusinessPlacementItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: PlacementCounts;
  filter: PlacementFilter;
  canEdit: boolean;
  openMissing: boolean;
}) {
  const { href, go, navPending } = useTargetNav();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filter.q);
  const filtered = !isEmptyPlacementFilter(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;

  // Debounced search: the URL (and so the server read) changes once typing pauses.
  useEffect(() => {
    if (query.trim() === filter.q) return;
    const t = window.setTimeout(() => go({ tq: query.trim() || null, tp: null }, "replace"), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const add = (place: SelectedLocationDetail) =>
    startTransition(async () => {
      setError(null);
      const result = await addTargetAction(businessId, place.id);
      if (!result.ok) return setError(result.error);
      setAdding(false);
      // Open the place's workspace — a place already in the pipeline opens its existing row (never a duplicate).
      go({ loc: place.id, pt: null, ...(result.existing ? {} : { tq: null, ts: null, tp: null }) });
    });

  const chip = (on: boolean) => `flex h-9 items-center gap-1.5 rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;

  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <p className="text-body text-muted">Places you want to get into — a retailer, café, hotel or venue — and where each conversation stands.</p>
      <Privacy />

      {!available && <p className="text-body text-muted">This isn&rsquo;t available yet. Please check back soon.</p>}
      {openMissing && <p role="status" className="rounded-xl bg-black/[0.03] px-3.5 py-2.5 text-metadata text-secondary">That Target wasn&rsquo;t found.</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}

      {canEdit && available && !adding && (
        <div>
          <button type="button" onClick={() => setAdding(true)} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
            Add Target
          </button>
        </div>
      )}

      {adding && (
        <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.08] bg-white p-4">
          <div>
            <p className="font-display text-card-title-lg font-bold text-primary">Add Target</p>
            <p className="mt-0.5 text-metadata text-muted">Search Findmi first. If the place isn&rsquo;t here yet, you can add it.</p>
          </div>
          <PlaceFindOrCreate
            onSelect={add}
            useResults={useTargetPlaceResults}
            createAction={(fd) => createTargetPlaceAction(businessId, fd)}
            placeholder="Search places — name, street or city"
            autoFocus
          />
          <div className="flex items-center gap-3">
            {pending && <span className="text-metadata text-muted">Adding…</span>}
            <button type="button" disabled={pending} onClick={() => setAdding(false)} className="h-10 px-1 text-metadata font-semibold text-muted hover:text-primary disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {available && counts.all > 0 && !adding && (
        <div className="flex flex-col gap-2.5" role="search" aria-label="Find your Targets">
          <input
            type="search"
            autoCapitalize="none"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your Targets"
            aria-label="Search your Targets"
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
            <button type="button" aria-pressed={filter.status === ""} onClick={() => go({ ts: null, tp: null })} className={chip(filter.status === "")}>
              All <span className="font-normal opacity-80">{counts.all.toLocaleString()}</span>
            </button>
            {PLACEMENT_STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={filter.status === s} onClick={() => go({ ts: filter.status === s ? null : s, tp: null })} className={chip(filter.status === s)}>
                {PLACEMENT_STATUS_LABELS[s]} <span className="font-normal opacity-80">{counts[s].toLocaleString()}</span>
              </button>
            ))}
          </div>
          <p role="status" className="text-metadata text-muted">
            {total === 0 ? "No matching Targets" : `Showing ${firstShown.toLocaleString()}–${Math.min(total, page * pageSize).toLocaleString()} of ${total.toLocaleString()}`}
            {filtered && (
              <>
                {" · "}
                <button type="button" onClick={() => { setQuery(""); go({ tq: null, ts: null, tp: null }); }} className="font-semibold text-accent hover:underline">
                  Clear Filters
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {available && items.length === 0 && !adding && (
        <p className="text-body text-muted">
          {counts.all === 0 ? (canEdit ? "No Targets yet. Add a place you want to be stocked, sold, served or featured in." : "No Targets yet.") : "No Targets match. Try a different search or clear the filters."}
        </p>
      )}

      {items.length > 0 && !adding && (
        <ul className={`flex flex-col divide-y divide-black/[0.06] transition-opacity ${navPending ? "opacity-60" : ""}`} aria-busy={navPending}>
          {items.map((i) => (
            <li key={i.id}>
              <Link href={href({ loc: i.locationId, pt: null })} scroll={false} className="flex items-start gap-3 py-3 transition hover:bg-black/[0.02]">
                <PlaceThumb imageUrl={i.imageUrl} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-card-title font-semibold text-primary">{i.locationName}</span>
                    <Chip tone={PLACEMENT_STATUS_TONE[i.status]}>{PLACEMENT_STATUS_LABELS[i.status]}</Chip>
                    {i.locationUnlisted && <NotPublicBadge />}
                  </span>
                  <span className="block truncate text-metadata text-muted">{[i.city, i.state].filter(Boolean).join(", ")}</span>
                  <NextActionLine item={i} />
                </span>
                <span className="shrink-0 py-1 text-metadata font-semibold text-accent">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && !adding && (
        <nav aria-label="Pages" className="flex items-center justify-between text-metadata font-semibold">
          <button type="button" disabled={page <= 1 || navPending} onClick={() => go({ tp: page - 1 > 1 ? String(page - 1) : null })} className="h-10 rounded-full border border-black/10 bg-white px-4 text-primary disabled:opacity-40">
            Previous
          </button>
          <span className="text-muted">Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
          <button type="button" disabled={page >= pages || navPending} onClick={() => go({ tp: String(page + 1) })} className="h-10 rounded-full border border-black/10 bg-white px-4 text-primary disabled:opacity-40">
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

