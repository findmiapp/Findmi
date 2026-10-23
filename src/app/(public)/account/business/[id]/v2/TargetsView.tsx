"use client";

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";
import { NotPublicBadge, PlaceCreatePanel } from "@/components/places/PlaceFindOrCreate";
import FindOrCreatePicker from "@/components/find-or-create/FindOrCreatePicker";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import {
  ADD_TARGET_SCOPES,
  ADD_TARGET_SCOPE_LABELS,
  type AddTargetScope,
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
import type { BusinessTargetItem, TargetCounts, TargetKindCounts } from "@/lib/business-targets";
import type { TargetCandidate } from "@/lib/target-search";
import { addTargetAction, createTargetPlaceAction, searchTargetCandidatesAction } from "../target-actions";
import { Chip } from "../../../owner-ui";
import { IntentPicker } from "@/components/relationships/IntentPicker";
import { relationshipParams, relationshipRefFor } from "@/lib/relationship-links";

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

const PickerContext = createContext<{ businessId: string; scope: AddTargetScope }>({ businessId: "", scope: "all" });

/** Debounced, Business-authorized counterparty search (so a founder Admin
 * session works too). Nothing is listed until the query is long enough — the
 * picker never dumps every place, Business or Event on Findmi. */
function useDebounced<T>(query: string, load: (q: string) => Promise<T[]>, scopeKey = ""): { results: T[]; loading: boolean } {
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
    // A new scope never shows the previous scope's results while it re-runs.
    setResults([]);
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
  }, [query, scopeKey]);
  return { results, loading };
}

/** One bounded server search for the current scope; re-runs when the scope changes. */
function useTargetCandidateResults(query: string) {
  const { businessId, scope } = useContext(PickerContext);
  return useDebounced<TargetCandidate>(query, (q) => searchTargetCandidatesAction(businessId, scope, q), scope);
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
export const targetHref = (t: Pick<BusinessTargetItem, "id" | "locationId">) =>
  relationshipParams(t.locationId ? { kind: "location", locationId: t.locationId } : { kind: "business", targetId: t.id });

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

/** Why — the compatible intents for one counterparty kind (shared component). */
export { IntentPicker };

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
  discoverHref,
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
  /** Growth door only: Commercial Discovery (find who to target). */
  discoverHref?: string;
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

      {available && !adding && discoverHref && (
        // Targets = your private working list; Discover = finding new ones. Two
        // ways in to ONE set of relationships: you already know who or where
        // (Add To Targets), or you want to find new ones (Discover).
        <div className="flex flex-col gap-2">
          <p className="text-metadata text-muted">Your commercial working list — the Places, Businesses and Events you&rsquo;re tracking.</p>
          <div className={`grid gap-2 ${canEdit ? "grid-cols-2" : "grid-cols-1"}`}>
            {canEdit && (
              <button type="button" onClick={() => setAdding(true)} className="flex min-h-[60px] flex-col items-start justify-center rounded-2xl bg-findmi px-4 py-2.5 text-left text-white transition hover:bg-findmi-600">
                <span className="text-button font-bold">Add To Targets</span>
                <span className="text-microcopy text-white/85">I already know who or where</span>
              </button>
            )}
            <Link href={discoverHref} className="flex min-h-[60px] flex-col items-start justify-center rounded-2xl border border-findmi/40 bg-white px-4 py-2.5 text-left text-findmi-700 transition hover:bg-findmi-50">
              <span className="text-button font-bold">Discover</span>
              <span className="text-microcopy text-muted">Find new Places, Businesses and Events</span>
            </Link>
          </div>
          <p className="flex items-start gap-1.5 text-microcopy text-subtle" title={TARGET_PRIVACY_NOTE}>
            <LockIcon className="mt-0.5 h-3 w-3" /> Targets are private. Your Targets, Context, Next Steps and Activity are never shared with them.
          </p>
        </div>
      )}
      {available && !adding && !discoverHref && (
        <div className="flex min-h-10 items-center justify-between gap-3">
          {canEdit && (
            <button type="button" onClick={() => setAdding(true)} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
              Add To Targets
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
          {/* Status is one compact selector, not a second chip rail. */}
          <label className="flex items-center gap-2 self-start">
            <span className="text-metadata font-semibold text-muted">Status</span>
            <select
              value={filter.status}
              onChange={(e) => go({ ts: e.target.value || null, tp: null })}
              className={`h-9 rounded-full border px-3 text-metadata font-semibold focus:outline-none focus:ring-2 focus:ring-findmi/20 ${filter.status ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-primary"}`}
            >
              <option value="">All ({counts.all.toLocaleString()})</option>
              {TARGET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TARGET_STATUS_LABELS[s]} ({counts[s].toLocaleString()})
                </option>
              ))}
            </select>
          </label>
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
                <span className="shrink-0 py-1 text-metadata font-semibold text-accent">Open Relationship</span>
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

type Picked = Pick<TargetCandidate, "kind" | "id" | "name" | "imageUrl" | "category" | "place" | "area" | "nextDate" | "noUpcoming" | "notPublic">;

const fromPlace = (p: SelectedLocationDetail): Picked => ({ kind: "location", id: p.id, name: p.name, imageUrl: null, category: p.category, place: [p.city, p.state].filter(Boolean).join(", ") || null, area: null, nextDate: null, noUpcoming: false, notPublic: p.is_public === false });

/** The identity line(s) every Add Target result and the picked row share. */
function CandidateIdentity({ c }: { c: Picked }) {
  const where = c.kind === "event" ? [c.nextDate ? formatTargetDate(c.nextDate) : "No Upcoming Dates", c.place] : [c.place, c.area];
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body font-semibold text-primary">{c.name}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-metadata text-muted">{[TARGET_KIND_LABELS[c.kind], c.category].filter(Boolean).join(" · ")}</span>
        {c.notPublic && <NotPublicBadge />}
      </span>
      {where.some(Boolean) && <span className="block truncate text-metadata text-secondary">{where.filter(Boolean).join(" · ")}</span>}
    </span>
  );
}

/** One Add Target search result: thumbnail, identity, and Targeted / Yours. */
export function CandidateRow({ c }: { c: TargetCandidate }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <TargetThumb imageUrl={c.imageUrl} kind={c.kind} />
      <CandidateIdentity c={c} />
      {c.target ? (
        // Already in your Targets: its state, and it opens — never a second one.
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <Chip tone={TARGET_STATUS_TONE[c.target.status]}>{TARGET_STATUS_LABELS[c.target.status]}</Chip>
          <span className="text-microcopy font-semibold text-accent">Open Relationship</span>
        </span>
      ) : c.ownLocation ? (
        <span className="shrink-0 text-microcopy text-subtle">Yours</span>
      ) : null}
    </span>
  );
}

/** Add Target — "I already know who I want": one search box across Places,
 * Businesses and Events (All by default, or narrowed to one; the query is kept
 * when switching) → the result, with its identity → why (only intents that fit
 * its kind) → Add. Something already targeted opens instead of duplicating. A
 * place not on Findmi yet can be created inline (unlisted). Find Us Here's lens
 * searches Places only. Finding who to pursue by geography / Category is
 * Discover's job, not this one's. */
function AddTarget({ businessId, placesOnly, onClose }: { businessId: string; placesOnly: boolean; onClose: () => void }) {
  const { go } = useTargetNav();
  const [scope, setScope] = useState<AddTargetScope>(placesOnly ? "location" : "all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [intents, setIntents] = useState<CommercialIntent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (kind: TargetKind, id: string, locationId: string | null) => {
    onClose();
    go(relationshipParams(relationshipRefFor(kind, { targetId: id, locationId })));
  };
  const pick = (c: Picked) => {
    setError(null);
    setPicked(c);
    setIntents([...DEFAULT_INTENTS_BY_KIND[c.kind]]);
  };
  const add = () =>
    startTransition(async () => {
      if (!picked) return;
      setError(null);
      const result = await addTargetAction(businessId, picked.kind, picked.id, intents);
      if (!result.ok) return setError(result.error);
      onClose();
      // Open the Target — one already in the pipeline opens its existing row (never a duplicate).
      go({ ...(result.locationId ? { loc: result.locationId, tgt: null } : { tgt: result.id, loc: null }), pt: null, ...(result.existing ? {} : { tq: null, ts: null, tk: null, tp: null }) });
    });

  const noun = scope === "location" ? "place" : scope === "business" ? "Business" : scope === "event" ? "Event" : "place, Business or Event";
  return (
    <PickerContext.Provider value={{ businessId, scope }}>
      <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.08] bg-white p-4">
        <div>
          <p className="font-display text-card-title-lg font-bold text-primary">Add To Targets</p>
          <p className="mt-0.5 text-metadata text-muted">I already know who or where. Private to your team and Findmi — they&rsquo;re never told.</p>
        </div>

        {!placesOnly && !picked && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Search">
            {ADD_TARGET_SCOPES.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={scope === k} onClick={() => setScope(k)} className={chipClass(scope === k)}>
                {ADD_TARGET_SCOPE_LABELS[k]}
              </button>
            ))}
          </div>
        )}

        {picked ? (
          <div className="flex items-start gap-3 rounded-xl bg-black/[0.03] px-3 py-3">
            <TargetThumb imageUrl={picked.imageUrl} kind={picked.kind} />
            <CandidateIdentity c={picked} />
            <button type="button" disabled={pending} onClick={() => setPicked(null)} className="min-h-10 shrink-0 text-metadata font-semibold text-accent hover:underline disabled:opacity-50">
              Change
            </button>
          </div>
        ) : (
          <FindOrCreatePicker<TargetCandidate>
            placeholder={scope === "location" ? "Search places — name, street or city" : scope === "business" ? "Search Businesses — name or city" : scope === "event" ? "Search Events — name, venue or city" : "Search Places, Businesses and Events"}
            useResults={useTargetCandidateResults}
            query={query}
            onQueryChange={setQuery}
            maxResults={20}
            getKey={(c) => `${c.kind}:${c.id}`}
            renderItem={(c) => <CandidateRow c={c} />}
            isExactMatch={(c, q) => c.name.trim().toLowerCase() === q.trim().toLowerCase()}
            onPick={(c) => {
              if (c.target) return open(c.kind, c.target.id, c.kind === "location" ? c.id : null);
              if (c.ownLocation) return setError("That’s one of your own Locations, so it can’t be a Target.");
              pick(c);
            }}
            renderCreate={
              scope === "all" || scope === "location"
                ? ({ initialName, onDone }) => (
                    <PlaceCreatePanel
                      initialName={initialName}
                      createAction={(fd) => createTargetPlaceAction(businessId, fd)}
                      onCancel={onDone}
                      onSelected={(p) => {
                        pick(fromPlace(p));
                        onDone();
                      }}
                    />
                  )
                : undefined
            }
            createLabel={(q) => `Add “${q}” as a new place`}
            autoFocus
          />
        )}

        {!picked && <p className="text-microcopy text-subtle">Type at least {TARGET_SEARCH_MIN_CHARS} letters to find a {noun}.</p>}

        {picked && (
          <div className="flex flex-col gap-2">
            <p className="text-label font-bold uppercase text-subtle">Why</p>
            <IntentPicker kind={picked.kind} value={intents} onChange={setIntents} disabled={pending} />
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
