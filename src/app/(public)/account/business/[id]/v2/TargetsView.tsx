"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import PlaceFindOrCreate, { NotPublicBadge } from "@/components/places/PlaceFindOrCreate";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import {
  PLACEMENT_LIMITS,
  PLACEMENT_ACTIVITY_NOTE_MAX,
  PLACEMENT_PRIVACY_NOTE,
  PLACEMENT_SUMMARY_HINT,
  PLACEMENT_SUMMARY_LABEL,
  PLACEMENT_STATUSES,
  PLACEMENT_STATUS_HINTS,
  PLACEMENT_STATUS_LABELS,
  PLACEMENT_STATUS_TONE,
  formatPlacementDate,
  isEmptyPlacementFilter,
  type PlacementFilter,
  type PlacementStatus,
} from "@/lib/business-placements-domain";
import type { BusinessPlacementItem, PlacementActivityItem, PlacementActivityPage, PlacementCounts } from "@/lib/business-placements";
import {
  addTargetAction,
  addTargetNoteAction,
  createTargetPlaceAction,
  loadTargetActivityAction,
  saveTargetInternalNotesAction,
  searchTargetLocationsAction,
  updateTargetAction,
} from "../placement-actions";
import { Chip } from "../../../owner-ui";

/** Findmi Here → Find Us Here → Targets: the places this Business is privately
 * trying to get into, and where each pursuit stands (Target → In Conversation →
 * Placement Pending → Active, or Passed). Private to the Business's team and
 * Findmi — a Target is never public and never changes Find Us Here.
 *
 * One server-side page at a time, searchable and filterable by status; filters
 * live in the URL (tq / ts / tp) and an open Target is `pt`, so Back, Forward
 * and a shared link keep the same view. Owners and managers edit; staff read. */

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

type Param = "tq" | "ts" | "tp" | "pt";

function useTargetNav() {
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

function Privacy() {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-black/[0.03] px-3 py-2.5 text-metadata text-secondary">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <span>{PLACEMENT_PRIVACY_NOTE}</span>
    </p>
  );
}

function PlaceThumb({ imageUrl }: { imageUrl: string | null }) {
  return (
    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/[0.04] text-ink/25">
      {imageUrl ? <SupabaseImage src={imageUrl} alt="" fill sizes="56px" className="object-cover" /> : <NavIcon name="storefront" className="h-6 w-6" />}
    </span>
  );
}

function NextActionLine({ item }: { item: Pick<BusinessPlacementItem, "nextAction" | "nextActionAt"> }) {
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
  open,
  openMissing,
  isFindmiAdmin,
  internalNotes,
  activity,
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
  /** The Target open in the URL (`pt`), when it's this Business's own. */
  open: BusinessPlacementItem | null;
  /** `pt` was set but isn't one of this Business's Targets. */
  openMissing: boolean;
  /** A founder Admin session — the only viewer that sees internal notes. */
  isFindmiAdmin: boolean;
  /** Findmi-only notes for the open Target; only ever passed for isFindmiAdmin. */
  internalNotes: string | null;
  /** The open Target's first Activity page (never loaded for the list). */
  activity: PlacementActivityPage | null;
}) {
  return (
    <BusinessIdContext.Provider value={businessId}>
      {open ? (
        <TargetDetail key={open.id} businessId={businessId} item={open} canEdit={canEdit} isFindmiAdmin={isFindmiAdmin} internalNotes={internalNotes} activity={activity} />
      ) : (
        <TargetList businessId={businessId} available={available} items={items} total={total} page={page} pageSize={pageSize} counts={counts} filter={filter} canEdit={canEdit} openMissing={openMissing} />
      )}
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
      // Open the Target — a place already in the pipeline opens its existing row (never a duplicate).
      go({ pt: result.id, ...(result.existing ? {} : { tq: null, ts: null, tp: null }) });
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
              <Link href={href({ pt: i.id })} scroll={false} className="flex items-start gap-3 py-3 transition hover:bg-black/[0.02]">
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

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20";

function TargetDetail({
  businessId,
  item,
  canEdit,
  isFindmiAdmin,
  internalNotes,
  activity,
}: {
  businessId: string;
  item: BusinessPlacementItem;
  canEdit: boolean;
  isFindmiAdmin: boolean;
  internalNotes: string | null;
  activity: PlacementActivityPage | null;
}) {
  const { href, refresh } = useTargetNav();
  const [status, setStatus] = useState<PlacementStatus>(item.status);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [nextAction, setNextAction] = useState(item.nextAction ?? "");
  const [nextActionAt, setNextActionAt] = useState(item.nextActionAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = status !== item.status || notes.trim() !== (item.notes ?? "") || nextAction.trim() !== (item.nextAction ?? "") || nextActionAt !== (item.nextActionAt ?? "");

  const save = (overrides?: { status?: PlacementStatus }) =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      const result = await updateTargetAction(businessId, item.id, { status: overrides?.status ?? status, notes, nextAction, nextActionAt: nextActionAt || null });
      if (!result.ok) return setError(result.error);
      if (overrides?.status) setStatus(overrides.status);
      setSaved(true);
      refresh();
    });

  const back = href({ pt: null });

  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <Link href={back} scroll={false} className="-my-2 inline-flex min-h-10 w-fit items-center gap-1 text-metadata font-semibold text-accent hover:underline">
        <span aria-hidden="true">←</span> All Targets
      </Link>

      <div className="flex items-start gap-3">
        <PlaceThumb imageUrl={item.imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 font-display text-card-title-lg font-bold text-primary">{item.locationName}</h2>
            <Chip tone={PLACEMENT_STATUS_TONE[item.status]}>{PLACEMENT_STATUS_LABELS[item.status]}</Chip>
            {item.locationUnlisted && <NotPublicBadge />}
          </div>
          <p className="text-metadata text-muted">{[item.address, [item.city, item.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
          <p className="text-microcopy text-subtle">
            {PLACEMENT_STATUS_LABELS[item.status]} since {formatPlacementDate(item.statusChangedAt.slice(0, 10))}
            {item.source === "admin" ? " · Added by Findmi" : ""}
          </p>
        </div>
      </div>

      <Privacy />
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}

      {canEdit ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-white p-4">
          {item.status === "passed" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/[0.03] px-3 py-2.5">
              <span className="text-metadata text-secondary">You passed on this place. Reopen it to pursue it again.</span>
              <button type="button" disabled={pending} onClick={() => save({ status: "target" })} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50">
                Reopen As Target
              </button>
            </div>
          )}

          <fieldset>
            <legend className="text-metadata font-semibold text-secondary">Status</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Status">
              {PLACEMENT_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => { setStatus(s); setSaved(false); }}
                  className={`flex h-9 items-center rounded-full px-3.5 text-metadata font-semibold transition ${status === s ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`}
                >
                  {PLACEMENT_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-microcopy text-subtle">{PLACEMENT_STATUS_HINTS[status]}</p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <label className="block">
              <span className="mb-1 block text-metadata font-semibold text-secondary">Next Action</span>
              <textarea autoCapitalize="sentences" rows={2} value={nextAction} maxLength={PLACEMENT_LIMITS.nextAction} onChange={(e) => { setNextAction(e.target.value.replace(/\s*\n\s*/g, " ")); setSaved(false); }} placeholder="e.g. Drop off samples" className={`${inputClass} resize-none`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-metadata font-semibold text-secondary">Next Action Date</span>
              <input type="date" autoCapitalize="none" value={nextActionAt} onChange={(e) => { setNextActionAt(e.target.value); setSaved(false); }} className={inputClass} />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-metadata font-semibold text-secondary">{PLACEMENT_SUMMARY_LABEL}</span>
            <textarea autoCapitalize="sentences" value={notes} maxLength={PLACEMENT_LIMITS.notes} rows={4} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} placeholder="e.g. Independent café. Sarah is the owner. Introduced through Derek." className={inputClass} />
            <span className="mt-1 block text-microcopy text-subtle">{PLACEMENT_SUMMARY_HINT}</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={pending || !dirty} onClick={() => save()} className="flex h-10 items-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
            {saved && !dirty && <span role="status" className="text-metadata font-semibold text-findmi-700">Saved</span>}
          </div>
        </div>
      ) : (
        <dl className="flex flex-col gap-3 rounded-2xl border border-black/[0.08] bg-white p-4 text-body">
          <div>
            <dt className="text-metadata font-semibold text-secondary">Next Action</dt>
            <dd className="text-primary">{[item.nextAction, item.nextActionAt ? formatPlacementDate(item.nextActionAt) : null].filter(Boolean).join(" · ") || "None"}</dd>
          </div>
          <div>
            <dt className="text-metadata font-semibold text-secondary">{PLACEMENT_SUMMARY_LABEL}</dt>
            <dd className="whitespace-pre-line text-primary">{item.notes || "None"}</dd>
          </div>
          <p className="text-microcopy text-subtle">Only owners and managers can change Targets.</p>
        </dl>
      )}

      <ActivityFeed businessId={businessId} placementId={item.id} canAdd={canEdit} initial={activity} />

      <p className="text-microcopy text-subtle">Find Us Here is managed separately. Changing a Target never changes what&rsquo;s public.</p>

      {isFindmiAdmin && <InternalNotes businessId={businessId} placementId={item.id} initial={internalNotes} />}
    </div>
  );
}

/** Findmi-only (managed service). Rendered only for a founder Admin session; the
 * page reads these notes only for that session, and the save action re-checks it. */
function InternalNotes({ businessId, placementId, initial }: { businessId: string; placementId: string; initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [baseline, setBaseline] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== baseline;
  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await saveTargetInternalNotesAction(businessId, placementId, value);
      if (!result.ok) return setError(result.error);
      setBaseline(value.trim());
      setSaved(true);
    });
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-black/15 bg-black/[0.02] p-4">
      <p className="text-metadata font-bold uppercase text-muted">Findmi Internal Notes</p>
      <p className="text-microcopy text-subtle">Findmi only — never shown to the Business.</p>
      {error && <p role="alert" className="text-metadata font-semibold text-red-700">{error}</p>}
      <textarea autoCapitalize="sentences" value={value} maxLength={PLACEMENT_LIMITS.internalNotes} rows={3} onChange={(e) => { setValue(e.target.value); setSaved(false); }} className={inputClass} />
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending || !dirty} onClick={save} className="flex h-9 items-center rounded-full border border-black/10 bg-white px-4 text-metadata font-semibold text-primary disabled:opacity-50">
          {pending ? "Saving…" : "Save Internal Notes"}
        </button>
        {saved && !dirty && <span role="status" className="text-metadata font-semibold text-findmi-700">Saved</span>}
      </div>
    </div>
  );
}

/** Date + time in the viewer's own time zone ("Oct 22, 10:34 AM"). Rendered on
 * the server first, so the text may differ by time zone — the browser's wins. */
function When({ iso }: { iso: string }) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const label = d.toLocaleString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" });
  return (
    <time dateTime={iso} suppressHydrationWarning className="text-microcopy text-subtle">
      {label}
    </time>
  );
}

function ActivityEntry({ entry }: { entry: PlacementActivityItem }) {
  if (entry.type === "status_change") {
    return (
      <li className="relative pl-5">
        <span aria-hidden="true" className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-findmi bg-white" />
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-metadata font-semibold text-primary">Status Changed</span>
          <When iso={entry.createdAt} />
        </p>
        <p className="mt-0.5 text-metadata text-secondary">
          {entry.from ? PLACEMENT_STATUS_LABELS[entry.from] : "—"} <span aria-label="to">→</span> {entry.to ? PLACEMENT_STATUS_LABELS[entry.to] : "—"}
          {entry.author ? <span className="text-muted"> · {entry.author}</span> : null}
        </p>
      </li>
    );
  }
  return (
    <li className="relative pl-5">
      <span aria-hidden="true" className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-findmi" />
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-metadata font-semibold text-primary">{entry.author ?? "Note"}</span>
        <When iso={entry.createdAt} />
      </p>
      <p className="mt-0.5 whitespace-pre-line break-words text-body text-primary">{entry.body}</p>
    </li>
  );
}

/** ACTIVITY — newest first: the team's dated notes and every status change.
 * Append-only: there is no edit or delete; a mistake is fixed with a new note.
 * The first page comes with the opened Target; older pages load on demand. */
function ActivityFeed({ businessId, placementId, canAdd, initial }: { businessId: string; placementId: string; canAdd: boolean; initial: PlacementActivityPage | null }) {
  const { refresh } = useTargetNav();
  const [older, setOlder] = useState<PlacementActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const [loading, startLoading] = useTransition();

  // A refresh (after a save or a new note) brings a new first page: start over from it.
  useEffect(() => {
    setOlder([]);
    setCursor(initial?.nextCursor ?? null);
  }, [initial]);

  const first = initial?.items ?? [];
  const seen = new Set(first.map((e) => e.id));
  const entries = [...first, ...older.filter((e) => !seen.has(e.id))];

  const addNote = () =>
    startAdding(async () => {
      setError(null);
      const result = await addTargetNoteAction(businessId, placementId, draft);
      if (!result.ok) return setError(result.error);
      setDraft("");
      refresh();
    });

  const loadMore = () =>
    startLoading(async () => {
      if (!cursor) return;
      const next = await loadTargetActivityAction(businessId, placementId, cursor);
      if (!next.available) return setError("Couldn’t load more activity. Please try again.");
      setOlder((prev) => [...prev, ...next.items]);
      setCursor(next.nextCursor);
    });

  return (
    <section aria-labelledby="target-activity" className="flex flex-col gap-3">
      <h3 id="target-activity" className="font-display text-card-title font-bold text-primary">Activity</h3>
      {initial && !initial.available && <p className="text-metadata text-muted">Activity isn&rsquo;t available yet. Please check back soon.</p>}
      {canAdd && initial?.available !== false && (
        <div className="flex flex-col gap-2">
          <label htmlFor="target-add-note" className="sr-only">Add Note</label>
          <textarea
            id="target-add-note"
            autoCapitalize="sentences"
            rows={3}
            value={draft}
            maxLength={PLACEMENT_ACTIVITY_NOTE_MAX}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What happened? e.g. Called the GM — send samples Friday."
            className={inputClass}
          />
          <div className="flex items-center gap-3">
            <button type="button" disabled={adding || !draft.trim()} onClick={addNote} className="flex h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50">
              {adding ? "Adding…" : "Add Note"}
            </button>
            <span className="text-microcopy text-subtle">Notes are kept in order and can&rsquo;t be edited.</span>
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}
      {initial?.available !== false && entries.length === 0 && <p className="text-metadata text-muted">No activity yet. Notes and status changes will appear here.</p>}
      {entries.length > 0 && <ol className="flex flex-col gap-4 border-l border-black/[0.08] pl-0 [&>li]:-ml-[5px]">{entries.map((e) => <ActivityEntry key={e.id} entry={e} />)}</ol>}
      {cursor && (
        <button type="button" disabled={loading} onClick={loadMore} className="flex h-10 w-fit items-center rounded-full border border-black/10 bg-white px-4 text-metadata font-semibold text-primary disabled:opacity-50">
          {loading ? "Loading…" : "Load More"}
        </button>
      )}
    </section>
  );
}
