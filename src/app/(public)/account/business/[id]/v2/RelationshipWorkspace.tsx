"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { NotPublicBadge } from "@/components/places/PlaceFindOrCreate";
import {
  AVAILABILITY_STATUS_LABELS,
  availabilityRelationshipsPhrase,
  availabilityWhenLabel,
} from "@/lib/business-availability-domain";
import {
  TARGET_ACTIVITY_NOTE_MAX,
  TARGET_LIMITS,
  TARGET_STATUSES,
  TARGET_STATUS_HINTS,
  TARGET_STATUS_LABELS,
  TARGET_STATUS_TONE,
  formatTargetDate,
  type TargetStatus,
} from "@/lib/business-targets-domain";
import { COMMERCIAL_INTENT_LABELS, type CommercialIntent } from "@/lib/commercial-intents";
import type { BusinessTargetItem, TargetActivityItem, TargetActivityPage } from "@/lib/business-targets";
import type { RelationshipWorkspaceData } from "@/lib/business-relationships";
import type { ProductSet } from "@/lib/business-product-sets-domain";
import { addTargetAction, addTargetNoteAction, loadTargetActivityAction, saveTargetInternalNotesAction, setTargetIntentsAction, updateTargetAction } from "../target-actions";
import { Chip } from "../../../owner-ui";
import { PlaceForm } from "./AvailableAtView";
import { IntentPicker, LockIcon, PlaceThumb, useTargetNav } from "./TargetsView";
import { OpportunityCards } from "./GeographyViews";

/** The Business ↔ Location relationship workspace — ONE page for one place,
 * whichever lens opened it (Find Us Here → Places / By Market / Targets, Growth
 * → Targets, later the Map). Addressed by the place (`loc`), so it opens even
 * when there's no Target yet; old `pt` links resolve to the same place.
 *
 * Reading order, phone first: the place and where things stand → NEXT (the
 * future) → Context (present understanding) → Presence (Find Us Here) →
 * Opportunities / Appearances (only when there are any) → Activity (the past) →
 * Findmi Internal (admin only, collapsed). State does the explaining; editing
 * opens only where you ask for it. Owners and managers edit; staff read. */

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20";
const primaryBtn = "flex h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50";
const quietBtn = "flex h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-metadata font-semibold text-muted hover:text-primary disabled:opacity-50";
const linkBtn = "inline-flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline disabled:opacity-50";
const sectionTitle = "text-label font-bold uppercase text-subtle";

export interface WorkspaceProps {
  businessId: string;
  data: RelationshipWorkspaceData;
  canEdit: boolean;
  /** A founder Admin session — the only viewer of Findmi Internal. */
  isFindmiAdmin: boolean;
  internalNotes: string | null;
  activity: TargetActivityPage | null;
  backHref: string;
  backLabel: string;
  products: { id: string; name: string }[];
  productSets: ProductSet[];
  productSetsAvailable: boolean;
}

export default function RelationshipWorkspace(props: WorkspaceProps) {
  const { businessId, data, canEdit, backHref, backLabel } = props;
  const { place, target } = data;
  const geography = place.areaName ? [place.areaName, place.marketName].filter(Boolean).join(" · ") : [place.city, place.state].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <Link href={backHref} scroll={false} className="-my-2 inline-flex min-h-10 w-fit items-center gap-1 text-metadata font-semibold text-accent hover:underline">
        <span aria-hidden="true">←</span> {backLabel}
      </Link>

      {/* relative: on phones the status picker opens under the whole header, never off-screen. */}
      <header className="relative flex items-start gap-3">
        <PlaceThumb imageUrl={place.imageUrl} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-card-title-lg font-bold leading-snug text-primary">{place.name}</h2>
          {geography && <p className="text-metadata text-muted">{geography}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {data.ours && <Chip tone="aqua">Our Location</Chip>}
            {target && <StatusControl businessId={businessId} item={target} canEdit={canEdit} />}
            {place.unlisted && <NotPublicBadge />}
            {target && (
              <span className="inline-flex items-center gap-1 text-microcopy text-subtle" title="Private to your team and Findmi">
                <LockIcon className="h-3 w-3" /> Private
              </span>
            )}
          </div>
        </div>
      </header>

      {!target && !data.ours && canEdit && <TrackAsTarget businessId={businessId} locationId={place.id} />}

      {target && <NextCard businessId={businessId} item={target} canEdit={canEdit} />}
      {target && <SummaryBlock businessId={businessId} item={target} canEdit={canEdit} />}
      {target && <IntentsBlock businessId={businessId} item={target} canEdit={canEdit} />}
      {target && <ActivityFeed businessId={businessId} targetId={target.id} canAdd={canEdit} initial={props.activity} />}

      <Presence {...props} />

      {data.opportunities.length > 0 && (
        <section aria-labelledby="ws-opps" className="flex flex-col gap-2">
          <h3 id="ws-opps" className={sectionTitle}>Opportunities</h3>
          <OpportunityCards items={data.opportunities} />
        </section>
      )}

      {(data.nextAppearance || data.recentAppearance) && (
        <section aria-labelledby="ws-appear" className="flex flex-col gap-1.5">
          <h3 id="ws-appear" className={sectionTitle}>Appearances Here</h3>
          {[
            { label: "Next", a: data.nextAppearance },
            { label: "Last", a: data.recentAppearance },
          ]
            .filter((x) => x.a)
            .map(({ label, a }) => (
              <Link key={label} href={a!.href} className="flex min-h-10 items-baseline gap-2 text-body">
                <span className="shrink-0 text-metadata font-semibold text-muted">{label}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-primary hover:underline">{a!.title}</span>
                <span className="shrink-0 text-metadata text-muted">{formatTargetDate(a!.startAt.slice(0, 10))}</span>
              </Link>
            ))}
        </section>
      )}

      {target && props.isFindmiAdmin && <InternalNotes businessId={businessId} targetId={target.id} initial={props.internalNotes} />}
    </div>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────

/** The status pill; for editors it opens the picker (with each status's hint). */
export function StatusControl({ businessId, item, canEdit }: { businessId: string; item: BusinessTargetItem; canEdit: boolean }) {
  const { refresh } = useTargetNav();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canEdit) return <Chip tone={TARGET_STATUS_TONE[item.status]}>{TARGET_STATUS_LABELS[item.status]}</Chip>;
  const choose = (s: TargetStatus) =>
    startTransition(async () => {
      setError(null);
      if (s === item.status) return setOpen(false);
      const result = await updateTargetAction(businessId, item.id, { status: s, context: item.context, nextAction: item.nextAction, nextActionAt: item.nextActionAt });
      if (!result.ok) return setError(result.error);
      setOpen(false);
      refresh();
    });
  return (
    <span className="sm:relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex min-h-9 items-center gap-1 rounded-md">
        <Chip tone={TARGET_STATUS_TONE[item.status]}>{TARGET_STATUS_LABELS[item.status]} ▾</Chip>
        <span className="sr-only">Change status</span>
      </button>
      {open && (
        <span role="dialog" aria-label="Status" className="absolute inset-x-0 top-full z-20 mt-1 flex flex-col sm:right-auto sm:w-72 rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg">
          {TARGET_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === item.status}
              disabled={pending}
              onClick={() => choose(s)}
              className={`flex min-h-11 flex-col items-start rounded-xl px-3 py-2 text-left transition hover:bg-black/[0.03] ${s === item.status ? "bg-findmi-50" : ""}`}
            >
              <span className={`text-body font-semibold ${s === item.status ? "text-findmi-700" : "text-primary"}`}>{TARGET_STATUS_LABELS[s]}</span>
              <span className="text-microcopy text-muted">{TARGET_STATUS_HINTS[s]}</span>
            </button>
          ))}
          {error && <span role="alert" className="px-3 py-1 text-metadata font-semibold text-red-700">{error}</span>}
        </span>
      )}
    </span>
  );
}

function TrackAsTarget({ businessId, locationId }: { businessId: string; locationId: string }) {
  const { refresh } = useTargetNav();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-black/[0.03] px-3.5 py-3">
      <span className="min-w-0 flex-1 text-metadata text-secondary">Want to be here? Track it as a private Target.</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await addTargetAction(businessId, "location", locationId, ["placement"]);
            if (!result.ok) return setError(result.error);
            refresh();
          })
        }
        className={primaryBtn}
      >
        {pending ? "Adding…" : "Track As Target"}
      </button>
      {error && <p role="alert" className="w-full text-metadata font-semibold text-red-700">{error}</p>}
    </div>
  );
}

// ── Next / Context ─────────────────────────────────────────────────────────

const save = (businessId: string, item: BusinessTargetItem, patch: Partial<{ context: string | null; nextAction: string | null; nextActionAt: string | null }>) =>
  updateTargetAction(businessId, item.id, { status: item.status, context: item.context, nextAction: item.nextAction, nextActionAt: item.nextActionAt, ...patch });

/** NEXT — what needs to happen, and when. Prominent; edits inline. */
export function NextCard({ businessId, item, canEdit }: { businessId: string; item: BusinessTargetItem; canEdit: boolean }) {
  const { refresh } = useTargetNav();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState(item.nextAction ?? "");
  const [date, setDate] = useState(item.nextActionAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const has = Boolean(item.nextAction || item.nextActionAt);
  const submit = (clear = false) =>
    startTransition(async () => {
      setError(null);
      const result = await save(businessId, item, clear ? { nextAction: null, nextActionAt: null } : { nextAction: action, nextActionAt: date || null });
      if (!result.ok) return setError(result.error);
      if (clear) {
        setAction("");
        setDate("");
      }
      setEditing(false);
      refresh();
    });

  if (editing) {
    return (
      <section aria-label="Next" className="flex flex-col gap-2.5 rounded-2xl border border-findmi/30 bg-white p-3.5">
        <h3 className={sectionTitle}>Next</h3>
        <label className="sr-only" htmlFor="ws-next-action">Next Action</label>
        <textarea id="ws-next-action" autoCapitalize="sentences" rows={2} autoFocus value={action} maxLength={TARGET_LIMITS.nextAction} onChange={(e) => setAction(e.target.value.replace(/\s*\n\s*/g, " "))} placeholder="e.g. Drop off samples" className={`${inputClass} resize-none`} />
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-metadata font-semibold text-secondary">Date</span>
          <input type="date" autoCapitalize="none" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
        {error && <p role="alert" className="text-metadata font-semibold text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" disabled={pending} onClick={() => submit()} className={primaryBtn}>{pending ? "Saving…" : "Save"}</button>
          <button type="button" disabled={pending} onClick={() => { setEditing(false); setAction(item.nextAction ?? ""); setDate(item.nextActionAt ?? ""); }} className={quietBtn}>Cancel</button>
          {has && <button type="button" disabled={pending} onClick={() => submit(true)} className={`${quietBtn} ml-auto`}>Clear</button>}
        </div>
      </section>
    );
  }
  if (!has) {
    return canEdit ? (
      <button type="button" onClick={() => setEditing(true)} className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-dashed border-findmi/40 bg-findmi-50/40 px-3.5 text-left text-body font-semibold text-findmi-700">
        Add Next Step <span aria-hidden="true">+</span>
      </button>
    ) : null;
  }
  return (
    <section aria-label="Next" className="flex items-start gap-3 rounded-2xl border border-findmi/30 bg-findmi-50/40 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-label font-bold uppercase text-findmi-700">{item.nextActionAt ? `Next · ${formatTargetDate(item.nextActionAt)}` : "Next"}</p>
        {item.nextAction && <p className="mt-0.5 break-words text-body font-semibold text-primary">{item.nextAction}</p>}
      </div>
      {canEdit && <button type="button" onClick={() => setEditing(true)} className={linkBtn}>Edit</button>}
    </section>
  );
}

/** CONTEXT — the Target's `context` field: present understanding, read first;
 * Edit when needed. */
export function SummaryBlock({ businessId, item, canEdit }: { businessId: string; item: BusinessTargetItem; canEdit: boolean }) {
  const { refresh } = useTargetNav();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.context ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!item.context && !canEdit) return null;
  if (editing) {
    return (
      <section aria-label="Context" className="flex flex-col gap-2">
        <h3 className={sectionTitle}>Context</h3>
        <textarea autoCapitalize="sentences" rows={4} autoFocus value={text} maxLength={TARGET_LIMITS.context} onChange={(e) => setText(e.target.value)} placeholder="e.g. Independent café. Sarah is the owner. Introduced through Derek." className={inputClass} />
        {error && <p role="alert" className="text-metadata font-semibold text-red-700">{error}</p>}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await save(businessId, item, { context: text || null });
                if (!result.ok) return setError(result.error);
                setEditing(false);
                refresh();
              })
            }
            className={primaryBtn}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={pending} onClick={() => { setEditing(false); setText(item.context ?? ""); }} className={quietBtn}>Cancel</button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Context" className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className={sectionTitle}>Context</h3>
        {canEdit && <button type="button" onClick={() => setEditing(true)} className={linkBtn}>{item.context ? "Edit" : "Add Context"}</button>}
      </div>
      {item.context && <p className="whitespace-pre-line break-words text-body text-primary">{item.context}</p>}
    </section>
  );
}

/** WHY — the Target's intents (only those its counterparty kind supports). */
export function IntentsBlock({ businessId, item, canEdit }: { businessId: string; item: BusinessTargetItem; canEdit: boolean }) {
  const { refresh } = useTargetNav();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<CommercialIntent[]>(item.intents);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (editing) {
    return (
      <section aria-label="Why" className="flex flex-col gap-2">
        <h3 className={sectionTitle}>Why</h3>
        <IntentPicker kind={item.kind} value={value} onChange={setValue} disabled={pending} />
        {error && <p role="alert" className="text-metadata font-semibold text-red-700">{error}</p>}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={pending || value.length === 0}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await setTargetIntentsAction(businessId, item.id, value);
                if (!result.ok) return setError(result.error);
                setEditing(false);
                refresh();
              })
            }
            className={primaryBtn}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={pending} onClick={() => { setEditing(false); setValue(item.intents); }} className={quietBtn}>Cancel</button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Why" className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className={sectionTitle}>Why</h3>
        {canEdit && <button type="button" onClick={() => setEditing(true)} className={linkBtn}>Edit</button>}
      </div>
      <p className="text-body text-primary">{item.intents.map((i) => COMMERCIAL_INTENT_LABELS[i]).join(", ") || "—"}</p>
    </section>
  );
}

// ── Presence (Find Us Here) ────────────────────────────────────────────────

const PRESENCE_TONE = { live: "aqua", pending: "amber", declined: "neutral" } as const;

/** Find Us Here at this place — the public fact, distinct from the private
 * pursuit. Active → Add To Find Us Here opens the EXISTING editor for this one
 * place (same save path, same review); an existing entry opens for editing —
 * never a duplicate. Nothing here publishes on its own. */
function Presence({ businessId, data, canEdit, products, productSets, productSetsAvailable }: WorkspaceProps) {
  const { refresh } = useTargetNav();
  const [editing, setEditing] = useState(false);
  const { presence, target, place } = data;
  const fixedPlace = { id: place.id, name: place.name, address: place.address, city: place.city, state: place.state };
  const done = () => {
    setEditing(false);
    refresh();
  };

  if (data.ours) {
    return (
      <section aria-labelledby="ws-presence" className="flex flex-col gap-1">
        <h3 id="ws-presence" className={sectionTitle}>Presence</h3>
        <p className="text-body text-secondary">This is one of your own Locations.</p>
      </section>
    );
  }
  if (editing) {
    return <PlaceForm businessId={businessId} products={products} productSets={productSets} productSetsAvailable={productSetsAvailable} initial={presence ?? undefined} fixedPlace={fixedPlace} onDone={done} />;
  }
  const canAdd = canEdit && !presence && target?.status === "active";
  return (
    <section aria-labelledby="ws-presence" className="flex flex-col gap-1.5">
      <h3 id="ws-presence" className={sectionTitle}>Presence</h3>
      {presence ? (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-semibold text-primary">
              {availabilityRelationshipsPhrase(presence.relationships)}
              <Chip tone={PRESENCE_TONE[presence.status]}>{presence.status === "live" && !data.presencePublic ? "Outside Its Dates" : AVAILABILITY_STATUS_LABELS[presence.status]}</Chip>
            </p>
            <p className="text-metadata text-muted">
              {[availabilityWhenLabel(presence.startsOn, presence.endsOn), presence.products.length > 0 ? presence.products.map((p) => p.name).join(", ") : "Your Brand"].join(" · ")}
            </p>
          </div>
          {canEdit && <button type="button" onClick={() => setEditing(true)} className={linkBtn}>Manage</button>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-body font-semibold text-secondary">Not On Find Us Here</p>
            <p className="text-metadata text-muted">When you&rsquo;re available here, add this place to your public footprint.</p>
          </div>
          {canAdd && (
            <div>
              <button type="button" onClick={() => setEditing(true)} className={primaryBtn}>Add To Find Us Here</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Activity ───────────────────────────────────────────────────────────────

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

function ActivityEntry({ entry }: { entry: TargetActivityItem }) {
  if (entry.type === "status_change") {
    return (
      <li className="relative pl-5">
        <span aria-hidden="true" className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-findmi bg-white" />
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-metadata font-semibold text-primary">Status Changed</span>
          <When iso={entry.createdAt} />
        </p>
        <p className="mt-0.5 text-metadata text-secondary">
          {entry.from ? TARGET_STATUS_LABELS[entry.from] : "—"} <span aria-label="to">→</span> {entry.to ? TARGET_STATUS_LABELS[entry.to] : "—"}
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

/** ACTIVITY — the relationship's history, newest first: dated notes and every
 * status change (append-only). A one-line "Add a note…" opens the composer. */
export function ActivityFeed({ businessId, targetId, canAdd, initial }: { businessId: string; targetId: string; canAdd: boolean; initial: TargetActivityPage | null }) {
  const { refresh } = useTargetNav();
  const [older, setOlder] = useState<TargetActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [composing, setComposing] = useState(false);
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
      const result = await addTargetNoteAction(businessId, targetId, draft);
      if (!result.ok) return setError(result.error);
      setDraft("");
      setComposing(false);
      refresh();
    });

  const loadMore = () =>
    startLoading(async () => {
      if (!cursor) return;
      const next = await loadTargetActivityAction(businessId, targetId, cursor);
      if (!next.available) return setError("Couldn’t load more activity. Please try again.");
      setOlder((prev) => [...prev, ...next.items]);
      setCursor(next.nextCursor);
    });

  return (
    <section aria-labelledby="target-activity" className="flex flex-col gap-3">
      <h3 id="target-activity" className={sectionTitle}>Activity</h3>
      {initial && !initial.available && <p className="text-metadata text-muted">Activity isn&rsquo;t available yet. Please check back soon.</p>}
      {canAdd && initial?.available !== false && (
        composing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="target-add-note" className="sr-only">Add Note</label>
            <textarea
              id="target-add-note"
              autoCapitalize="sentences"
              rows={3}
              autoFocus
              value={draft}
              maxLength={TARGET_ACTIVITY_NOTE_MAX}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What happened? e.g. Called the GM — send samples Friday."
              className={inputClass}
            />
            <div className="flex items-center gap-1">
              <button type="button" disabled={adding || !draft.trim()} onClick={addNote} className={primaryBtn}>
                {adding ? "Adding…" : "Add Note"}
              </button>
              <button type="button" disabled={adding} onClick={() => { setComposing(false); setDraft(""); }} className={quietBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setComposing(true)} className="flex min-h-11 w-full items-center rounded-xl border border-black/10 bg-white px-3 text-left text-input text-subtle">
            Add a note…
          </button>
        )
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}
      {initial?.available !== false && entries.length === 0 && <p className="text-metadata text-muted">No activity yet.</p>}
      {entries.length > 0 && <ol className="flex flex-col gap-4 border-l border-black/[0.08] pl-0 [&>li]:-ml-[5px]">{entries.map((e) => <ActivityEntry key={e.id} entry={e} />)}</ol>}
      {cursor && (
        <button type="button" disabled={loading} onClick={loadMore} className="flex h-10 w-fit items-center rounded-full border border-black/10 bg-white px-4 text-metadata font-semibold text-primary disabled:opacity-50">
          {loading ? "Loading…" : "Load More"}
        </button>
      )}
    </section>
  );
}

// ── Findmi Internal ────────────────────────────────────────────────────────

/** Findmi-only (managed service), collapsed by default; a dot shows when it has
 * content. Rendered only for a founder Admin session — the page reads these notes
 * only for that session, and the save action re-checks it. */
export function InternalNotes({ businessId, targetId, initial }: { businessId: string; targetId: string; initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [baseline, setBaseline] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== baseline;
  const persist = () =>
    startTransition(async () => {
      setError(null);
      const result = await saveTargetInternalNotesAction(businessId, targetId, value);
      if (!result.ok) return setError(result.error);
      setBaseline(value.trim());
      setSaved(true);
    });
  return (
    <details className="rounded-2xl border border-dashed border-black/15 bg-black/[0.02]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 text-metadata font-bold uppercase text-muted">
        Findmi Internal
        {baseline && <span aria-label="Has notes" className="h-2 w-2 rounded-full bg-findmi" />}
        <span className="ml-auto text-microcopy font-normal normal-case text-subtle">Never shown to the Business</span>
      </summary>
      <div className="flex flex-col gap-2 px-3.5 pb-3.5">
        {error && <p role="alert" className="text-metadata font-semibold text-red-700">{error}</p>}
        <textarea autoCapitalize="sentences" value={value} maxLength={TARGET_LIMITS.internalNotes} rows={3} onChange={(e) => { setValue(e.target.value); setSaved(false); }} className={inputClass} />
        <div className="flex items-center gap-3">
          <button type="button" disabled={pending || !dirty} onClick={persist} className="flex h-10 items-center rounded-full border border-black/10 bg-white px-4 text-metadata font-semibold text-primary disabled:opacity-50">
            {pending ? "Saving…" : "Save Internal Notes"}
          </button>
          {saved && !dirty && <span role="status" className="text-metadata font-semibold text-findmi-700">Saved</span>}
        </div>
      </div>
    </details>
  );
}
