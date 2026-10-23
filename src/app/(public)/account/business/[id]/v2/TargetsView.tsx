"use client";

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";
import PlaceFindOrCreate, { NotPublicBadge } from "@/components/places/PlaceFindOrCreate";
import FindOrCreatePicker from "@/components/find-or-create/FindOrCreatePicker";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import {
  TARGET_KIND_FILTERS,
  TARGET_KIND_FILTER_LABELS,
  TARGET_KIND_LABELS,
  TARGET_PRIVACY_NOTE,
  TARGET_SEARCH_MIN_CHARS,
  TARGET_STATUSES,
  TARGET_STATUS_LABELS,
  TARGET_STATUS_TONE,
  formatTargetDate,
  isEmptyTargetFilter,
  type TargetFilter,
} from "@/lib/business-targets-domain";
import { COMMERCIAL_INTENT_LABELS, DEFAULT_INTENTS_BY_KIND, INTENTS_BY_KIND, TARGET_KINDS, type CommercialIntent, type TargetKind } from "@/lib/commercial-intents";
import type { BusinessTargetItem, TargetCounts, TargetKindCounts, TargetSearchResult } from "@/lib/business-targets";
import { addTargetAction, createTargetPlaceAction, searchTargetCounterpartiesAction, searchTargetLocationsAction } from "../target-actions";
import { Chip } from "../../../owner-ui";

/** Targets — the places, Businesses and Events this Business is privately
 * pursuing, and where each pursuit stands (Target → In Conversation → Agreed →
 * Active, or Passed). Private to the Business's team and Findmi — a Target is
 * never public, never seen by its counterparty, and never changes Find Us Here.
 *
 * Two lenses over the SAME business_targets records:
 *   Growth → Targets              — every kind (All / Places / Businesses / Events);
 *   Find Us Here → Targets        — Places only (`placesOnly`).
 * One server-side page at a time, searchable and filterable; filters live in
 * the URL (tq / ts / tk / tp). A Place row opens the place's relationship
 * workspace (`loc` — RelationshipWorkspace.tsx); a Business or Event row opens
 * its Target workspace (`tgt` — TargetWorkspace.tsx). Owners and managers edit;
 * staff read. */

const PickerContext = createContext<{ businessId: string; kind: TargetKind }>({ businessId: "", kind: "location" });

/** Debounced, Business-authorized counterparty search (so a founder Admin
 * session works too). Nothing is listed until the query is long enough — the
 * picker never dumps every place, Business or Event on Findmi. */
function useDebounced<T>(query: string, load: (q: string) => Promise<T[]>): { results: T[]; loading: boolean } {
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < TARGET_SEARCH_MIN_CHARS) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = window.setTimeout(async () => {
      const found = await load(query);
      if (!cancelled) {
        setResults(found);
        setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return { results, loading };
}

function useTargetPlaceResults(query: string) {
  const { businessId } = useContext(PickerContext);
  return useDebounced<SelectedLocationDetail>(query, (q) => searchTargetLocationsAction(businessId, q));
}

function useTargetCounterpartyResults(query: string) {
  const { businessId, kind } = useContext(PickerContext);
  return useDebounced<TargetSearchResult>(query, (q) => searchTargetCounterpartiesAction(businessId, kind, q));
}

type Param = "tq" | "ts" | "tk" | "tp" | "pt" | "loc" | "tgt";

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

/** Where a Target opens: a place's relationship workspace, or the Target itself. */
export const targetHref = (t: Pick<BusinessTargetItem, "id" | "locationId">) => (t.locationId ? { loc: t.locationId, tgt: null, pt: null } : { tgt: t.id, loc: null, pt: null });

export function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** A restrained marker, not a paragraph — the full note is its tooltip and
 * the empty state's second line. */
function Privacy() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-microcopy text-subtle" title={TARGET_PRIVACY_NOTE}>
      <LockIcon className="h-3 w-3" /> Private
    </span>
  );
}

/** Places keep the storefront mark they always had. */
const KIND_ICON: Record<TargetKind, NavIconKey> = { location: "storefront", business: "tag", event: "calendar" };

export function TargetThumb({ imageUrl, kind = "location" }: { imageUrl: string | null; kind?: TargetKind }) {
  return (
    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/[0.04] text-ink/25">
      {imageUrl ? <SupabaseImage src={imageUrl} alt="" fill sizes="56px" className="object-cover" /> : <NavIcon name={KIND_ICON[kind]} className="h-6 w-6" />}
    </span>
  );
}

export function PlaceThumb({ imageUrl }: { imageUrl: string | null }) {
  return <TargetThumb imageUrl={imageUrl} kind="location" />;
}

export function NextActionLine({ item }: { item: Pick<BusinessTargetItem, "nextAction" | "nextActionAt"> }) {
  if (!item.nextAction && !item.nextActionAt) return null;
  return (
    <span className="mt-0.5 line-clamp-2 text-metadata text-secondary">
      {/* Date first, so a long action can never clip it. */}
      Next: {[item.nextActionAt ? formatTargetDate(item.nextActionAt) : null, item.nextAction].filter(Boolean).join(" · ")}
    </span>
  );
}

const chipClass = (on: boolean) => `flex h-9 items-center gap-1.5 rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;

/** Why — the compatible intents for one counterparty kind, as toggles. */
export function IntentPicker({ kind, value, onChange, disabled }: { kind: TargetKind; value: readonly CommercialIntent[]; onChange: (next: CommercialIntent[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Why">
      {INTENTS_BY_KIND[kind].map((i) => {
        const on = value.includes(i);
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== i) : INTENTS_BY_KIND[kind].filter((x) => x === i || value.includes(x)))}
            className={`${chipClass(on)} disabled:opacity-50`}
          >
            {COMMERCIAL_INTENT_LABELS[i]}
          </button>
        );
      })}
    </div>
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
  kindCounts,
  filter,
  canEdit,
  openMissing,
  placesOnly = false,
  context,
}: {
  businessId: string;
  /** false until the Targets migration is applied. */
  available: boolean;
  items: BusinessTargetItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: TargetCounts;
  kindCounts: TargetKindCounts;
  filter: TargetFilter;
  canEdit: boolean;
  /** A `pt` / `loc` / `tgt` link that isn't a Target this Business can open. */
  openMissing: boolean;
  /** Find Us Here → Targets: Place Targets only. */
  placesOnly?: boolean;
  /** Optional page context under Add Target (Growth's "Growing In" links). */
  context?: ReactNode;
}) {
  const { href, go, navPending } = useTargetNav();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState(filter.q);
  const filtered = !isEmptyTargetFilter(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const anyTargets = placesOnly ? counts.all > 0 : kindCounts.all > 0;

  // Debounced search: the URL (and so the server read) changes once typing pauses.
  useEffect(() => {
    if (query.trim() === filter.q) return;
    const t = window.setTimeout(() => go({ tq: query.trim() || null, tp: null }, "replace"), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      {!available && <p className="text-body text-muted">This isn&rsquo;t available yet. Please check back soon.</p>}
      {openMissing && <p role="status" className="rounded-xl bg-black/[0.03] px-3.5 py-2.5 text-metadata text-secondary">That Target wasn&rsquo;t found.</p>}

      {available && !adding && (
        <div className="flex min-h-10 items-center justify-between gap-3">
          {canEdit && (
            <button type="button" onClick={() => setAdding(true)} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
              Add Target
            </button>
          )}
          <span className="ml-auto">
            <Privacy />
          </span>
        </div>
      )}

      {context && !adding && context}

      {adding && <AddTarget businessId={businessId} placesOnly={placesOnly} onClose={() => setAdding(false)} />}

      {available && !placesOnly && anyTargets && !adding && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
          <button type="button" aria-pressed={filter.kind === ""} onClick={() => go({ tk: null, ts: null, tp: null })} className={chipClass(filter.kind === "")}>
            All <span className="font-normal opacity-80">{kindCounts.all.toLocaleString()}</span>
          </button>
          {TARGET_KIND_FILTERS.map((k) => (
            <button key={k} type="button" aria-pressed={filter.kind === k} onClick={() => go({ tk: filter.kind === k ? null : k, ts: null, tp: null })} className={chipClass(filter.kind === k)}>
              {TARGET_KIND_FILTER_LABELS[k]} <span className="font-normal opacity-80">{kindCounts[k].toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      {available && anyTargets && !adding && (
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
            <button type="button" aria-pressed={filter.status === ""} onClick={() => go({ ts: null, tp: null })} className={chipClass(filter.status === "")}>
              All <span className="font-normal opacity-80">{counts.all.toLocaleString()}</span>
            </button>
            {TARGET_STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={filter.status === s} onClick={() => go({ ts: filter.status === s ? null : s, tp: null })} className={chipClass(filter.status === s)}>
                {TARGET_STATUS_LABELS[s]} <span className="font-normal opacity-80">{counts[s].toLocaleString()}</span>
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
          {!anyTargets
            ? canEdit
              ? placesOnly
                ? "No Targets yet. Add a place you want to be stocked, sold, served or featured in."
                : "No Targets yet. Add a place, Business or Event you want to work with."
              : "No Targets yet."
            : "No Targets match. Try a different search or clear the filters."}
          {!anyTargets && <span className="mt-1 block text-metadata">{TARGET_PRIVACY_NOTE}</span>}
        </p>
      )}

      {items.length > 0 && !adding && (
        <ul className={`flex flex-col divide-y divide-black/[0.06] transition-opacity ${navPending ? "opacity-60" : ""}`} aria-busy={navPending}>
          {items.map((i) => (
            <li key={i.id}>
              <Link href={href(targetHref(i))} scroll={false} className="flex items-start gap-3 py-3 transition hover:bg-black/[0.02]">
                <TargetThumb imageUrl={i.counterparty.imageUrl} kind={i.kind} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-card-title font-semibold text-primary">{i.counterparty.name}</span>
                    <Chip tone={TARGET_STATUS_TONE[i.status]}>{TARGET_STATUS_LABELS[i.status]}</Chip>
                    {i.counterparty.notPublic && <NotPublicBadge />}
                  </span>
                  <span className="block truncate text-metadata text-muted">
                    {/* The kind is said once, only where kinds mix (Growth's All). */}
                    {[placesOnly || filter.kind ? null : TARGET_KIND_LABELS[i.kind], i.counterparty.subtitle].filter(Boolean).join(" · ")}
                  </span>
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

type Picked = { id: string; name: string; subtitle: string | null; notPublic: boolean };

/** Add Target: what kind → find it (search first; nothing listed until you type)
 * → why (only intents that fit that kind) → Add. A place not on Findmi yet can
 * be created inline (unlisted); Businesses and Events are search-only. */
function AddTarget({ businessId, placesOnly, onClose }: { businessId: string; placesOnly: boolean; onClose: () => void }) {
  const { go } = useTargetNav();
  const [kind, setKind] = useState<TargetKind>("location");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [intents, setIntents] = useState<CommercialIntent[]>([...DEFAULT_INTENTS_BY_KIND.location]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chooseKind = (k: TargetKind) => {
    setKind(k);
    setPicked(null);
    setIntents([...DEFAULT_INTENTS_BY_KIND[k]]);
    setError(null);
  };
  const add = () =>
    startTransition(async () => {
      if (!picked) return;
      setError(null);
      const result = await addTargetAction(businessId, kind, picked.id, intents);
      if (!result.ok) return setError(result.error);
      onClose();
      // Open the Target — one already in the pipeline opens its existing row (never a duplicate).
      go({ ...(result.locationId ? { loc: result.locationId, tgt: null } : { tgt: result.id, loc: null }), pt: null, ...(result.existing ? {} : { tq: null, ts: null, tk: null, tp: null }) });
    });

  const noun = kind === "location" ? "place" : kind === "business" ? "Business" : "Event";
  return (
    <PickerContext.Provider value={{ businessId, kind }}>
      <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.08] bg-white p-4">
        <div>
          <p className="font-display text-card-title-lg font-bold text-primary">Add Target</p>
          <p className="mt-0.5 text-metadata text-muted">Private to your team and Findmi — they&rsquo;re never told.</p>
        </div>

        {!placesOnly && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Target a">
            {TARGET_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => chooseKind(k)} className={chipClass(kind === k)}>
                {k === "location" ? "Place" : TARGET_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}

        {picked ? (
          <div className="flex items-start gap-3 rounded-xl bg-black/[0.03] px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-body font-semibold text-primary">{picked.name}</span>
                {picked.notPublic && <NotPublicBadge />}
              </span>
              {picked.subtitle && <span className="block truncate text-metadata text-muted">{picked.subtitle}</span>}
            </span>
            <button type="button" disabled={pending} onClick={() => setPicked(null)} className="min-h-10 shrink-0 text-metadata font-semibold text-accent hover:underline disabled:opacity-50">
              Change
            </button>
          </div>
        ) : kind === "location" ? (
          <PlaceFindOrCreate
            key="location"
            onSelect={(p) => setPicked({ id: p.id, name: p.name, subtitle: [p.city, p.state].filter(Boolean).join(", ") || null, notPublic: p.is_public === false })}
            useResults={useTargetPlaceResults}
            createAction={(fd) => createTargetPlaceAction(businessId, fd)}
            placeholder="Search places — name, street or city"
            autoFocus
          />
        ) : (
          <FindOrCreatePicker<TargetSearchResult>
            key={kind}
            placeholder={kind === "business" ? "Search Businesses — name or city" : "Search Events — name, venue or city"}
            useResults={useTargetCounterpartyResults}
            getKey={(r) => r.id}
            renderItem={(r) => (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-primary">{r.name}</span>
                {r.subtitle && <span className="block truncate text-metadata text-muted">{r.subtitle}</span>}
              </span>
            )}
            isExactMatch={(r, q) => r.name.trim().toLowerCase() === q.trim().toLowerCase()}
            onPick={(r) => setPicked({ id: r.id, name: r.name, subtitle: r.subtitle, notPublic: false })}
            autoFocus
          />
        )}

        {!picked && <p className="text-microcopy text-subtle">Type at least {TARGET_SEARCH_MIN_CHARS} letters to find a {noun}.</p>}

        {picked && (
          <div className="flex flex-col gap-2">
            <p className="text-label font-bold uppercase text-subtle">Why</p>
            <IntentPicker kind={kind} value={intents} onChange={setIntents} disabled={pending} />
          </div>
        )}

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center gap-1">
          {picked && (
            <button type="button" disabled={pending || intents.length === 0} onClick={add} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50">
              {pending ? "Adding…" : "Add Target"}
            </button>
          )}
          <button type="button" disabled={pending} onClick={onClose} className="h-10 px-3 text-metadata font-semibold text-muted hover:text-primary disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>
    </PickerContext.Provider>
  );
}
