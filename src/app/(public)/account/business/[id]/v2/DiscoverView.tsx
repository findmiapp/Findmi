"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { COMMERCIAL_ENTITIES, COMMERCIAL_ENTITY_LABELS, COMMERCIAL_PAGE_SIZE, COMMERCIAL_SEARCH_MIN_CHARS, CATEGORY_FAMILY, TARGET_KIND_FOR_ENTITY, type CommercialEntity } from "@/lib/discovery/commercial";
import type { CommercialDiscovery, CommercialResult } from "@/lib/discovery/commercial-server";
import { TARGET_STATUS_LABELS, formatTargetDate } from "@/lib/business-targets-domain";
import { DEFAULT_INTENTS_BY_KIND, type CommercialIntent } from "@/lib/commercial-intents";
import { addTargetAction } from "../target-actions";
import { IntentPicker, LockIcon, TargetThumb } from "./TargetsView";
import { Chip } from "../../../owner-ui";

/** Discover — Growth → Targets → Discover: find who or what to pursue, by
 *   Geography → Entity / Role → Category → Search,
 * and add it as a Target in place. Every filter lives in the URL
 * (dm / da / de / dc / dq / dp) and is applied server-side
 * (lib/discovery/commercial-server.ts); results are organic only — nothing
 * paid or featured — and each says why it matched. Targeting writes only the
 * private Target: no Conversation, Inquiry, notification, Opportunity, Find Us
 * Here or Appearance. Owners and managers can Target; staff browse. */

type Param = "dm" | "da" | "de" | "dc" | "dq" | "dp";

function useDiscoverNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const href = (patch: Partial<Record<Param, string | null>>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `${pathname}?${next.toString()}`;
  };
  const go = (patch: Partial<Record<Param, string | null>>, mode: "push" | "replace" = "push") => start(() => (mode === "push" ? router.push : router.replace)(href(patch), { scroll: false }));
  return { href, go, pending };
}

const chipClass = (on: boolean) => `flex h-9 items-center rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;
const selectClass =
  "h-11 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-input text-primary focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20 disabled:opacity-50";

export default function DiscoverView({ businessId, data, canEdit, targetsHref }: { businessId: string; data: CommercialDiscovery; canEdit: boolean; targetsHref: string }) {
  const { href, go, pending } = useDiscoverNav();
  const q = data.query;
  const [text, setText] = useState(q.q);
  const family = CATEGORY_FAMILY[q.entity];
  const areas = data.options.areas.filter((a) => a.marketSlug === q.market);
  const firstShown = data.total === 0 ? 0 : (data.page - 1) * COMMERCIAL_PAGE_SIZE + 1;

  // Debounced search: the URL (and so the server read) changes once typing pauses.
  useEffect(() => {
    if (text.trim() === q.q) return;
    const t = window.setTimeout(() => go({ dq: text.trim() || null, dp: null }, "replace"), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Link href={targetsHref} className="inline-flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline">
          ← Targets
        </Link>
        <span className="inline-flex shrink-0 items-center gap-1 text-microcopy text-subtle" title="Only your team sees what you search and target here.">
          <LockIcon className="h-3 w-3" /> Private
        </span>
      </div>

      <div className="flex flex-col gap-3" role="search" aria-label="Discover">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-metadata font-semibold text-muted">Market</span>
            <select value={q.market} onChange={(e) => go({ dm: e.target.value || null, da: null, dp: null })} className={selectClass}>
              <option value="">Choose a Market</option>
              {data.options.markets.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-metadata font-semibold text-muted">Area</span>
            <select value={q.area} disabled={!q.market || areas.length === 0} onChange={(e) => go({ da: e.target.value || null, dp: null })} className={selectClass}>
              <option value="">{q.market ? "All of the Market" : "Choose a Market first"}</option>
              {areas.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {`${"  ".repeat(a.depth)}${a.name}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Looking For">
          {COMMERCIAL_ENTITIES.map((e) => (
            <button key={e} type="button" aria-pressed={q.entity === e} onClick={() => go({ de: e === "places" ? null : e, dc: CATEGORY_FAMILY[e] === family ? q.category || null : null, dp: null })} className={chipClass(q.entity === e)}>
              {COMMERCIAL_ENTITY_LABELS[e]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-metadata font-semibold text-muted">Category</span>
            <select value={q.category} onChange={(e) => go({ dc: e.target.value || null, dp: null })} className={selectClass}>
              <option value="">Any Category</option>
              {family === "location" && data.options.categories.location.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              {family === "business" && data.options.categories.business.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              {family === "event" && (
                <>
                  <optgroup label="Format">
                    {data.options.categories.eventFormat.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="Category">
                    {data.options.categories.eventCategory.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </optgroup>
                </>
              )}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-metadata font-semibold text-muted">Search</span>
            <input
              type="search"
              autoCapitalize="none"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={q.market ? `Search ${COMMERCIAL_ENTITY_LABELS[q.entity]}` : "Search by name"}
              className="h-11 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
            />
          </label>
        </div>
      </div>

      {data.state === "prompt" && <p className="text-body text-muted">Choose a Market to browse {COMMERCIAL_ENTITY_LABELS[q.entity]}, or search by name ({COMMERCIAL_SEARCH_MIN_CHARS}+ characters).</p>}
      {data.state === "unknown_geography" && (
        <p className="text-body text-muted">
          That Market or Area isn&rsquo;t on Findmi.{" "}
          <Link href={href({ dm: null, da: null, dp: null })} className="font-semibold text-accent hover:underline">
            Choose Another
          </Link>
        </p>
      )}

      {data.state === "results" && (
        <p role="status" className="text-metadata text-muted">
          {data.total === 0
            ? null
            : `${firstShown.toLocaleString()}–${Math.min(data.total, data.page * COMMERCIAL_PAGE_SIZE).toLocaleString()} of ${data.total.toLocaleString()} ${COMMERCIAL_ENTITY_LABELS[q.entity]}${data.scopeLabel ? ` in ${data.scopeLabel}` : ""}`}
          {data.truncated && " · Showing the first matches — add a Category or search to narrow."}
        </p>
      )}

      {data.state === "results" && data.empty && (
        <div className="rounded-xl bg-black/[0.03] px-3.5 py-3">
          <p className="text-body text-secondary">{data.empty.title}</p>
          {data.empty.hint && <p className="mt-1 text-metadata text-muted">{data.empty.hint}</p>}
        </div>
      )}

      {data.items.length > 0 && (
        <ul className={`flex flex-col divide-y divide-black/[0.06] transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
          {data.items.map((r) => (
            <ResultRow key={r.id} businessId={businessId} result={r} entity={q.entity} canEdit={canEdit} />
          ))}
        </ul>
      )}

      {data.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {data.page > 1 ? (
            <Link href={href({ dp: data.page - 1 > 1 ? String(data.page - 1) : null })} scroll={false} className="inline-flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-metadata text-muted">
            Page {data.page} of {data.pages}
          </span>
          {data.page < data.pages ? (
            <Link href={href({ dp: String(data.page + 1) })} scroll={false} className="inline-flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

function ResultRow({ businessId, result: r, entity, canEdit }: { businessId: string; result: CommercialResult; entity: CommercialEntity; canEdit: boolean }) {
  const kind = TARGET_KIND_FOR_ENTITY[entity];
  const [picking, setPicking] = useState(false);
  const [intents, setIntents] = useState<CommercialIntent[]>([...DEFAULT_INTENTS_BY_KIND[kind]]);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; status: keyof typeof TARGET_STATUS_LABELS } | null>(null);
  const target = r.target ?? added;
  const openHref = target ? `/account/business/${businessId}?tab=growth&view=targets&${kind === "location" ? `loc=${r.id}` : `tgt=${target.id}`}` : null;

  const save = () =>
    startSave(async () => {
      setError(null);
      const res = await addTargetAction(businessId, kind, r.id, intents);
      if (!res.ok) return setError(res.error);
      setAdded({ id: res.id, status: res.status });
      setPicking(false);
    });

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <TargetThumb imageUrl={r.imageUrl} kind={kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-card-title font-semibold text-primary">{r.name}</p>
          <p className="truncate text-metadata text-muted">{[r.role, r.category].filter(Boolean).join(" · ")}</p>
          <p className="truncate text-metadata text-secondary">{[r.date ? formatTargetDate(r.date) : null, r.context].filter(Boolean).join(" · ")}</p>
          {r.reasons.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {r.reasons.map((reason) => (
                <Chip key={reason} tone="aquaSoft">
                  {reason}
                </Chip>
              ))}
            </div>
          )}
          {r.opportunityCount > 0 && (
            <p className="mt-1 text-metadata text-muted">
              {r.opportunities.map((o, i) => (
                <span key={o.path}>
                  {i > 0 && " · "}
                  <Link href={o.path} className="font-semibold text-accent hover:underline">
                    {o.title}
                  </Link>{" "}
                  <span className="text-subtle">({o.reason})</span>
                </span>
              ))}
              {r.opportunityCount > r.opportunities.length && ` · ${r.opportunityCount - r.opportunities.length} more Opportunit${r.opportunityCount - r.opportunities.length === 1 ? "y" : "ies"}`}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-[4.25rem]">
        {r.href && (
          <Link href={r.href} target="_blank" className="flex h-9 items-center rounded-full bg-black/[0.04] px-3.5 text-metadata font-semibold text-primary transition hover:bg-black/[0.07]">
            View
          </Link>
        )}
        {r.ownLocation ? (
          <span className="text-metadata text-muted">Your Location</span>
        ) : target && openHref ? (
          <Link href={openHref} className="flex h-9 items-center gap-1.5 rounded-full bg-findmi-50 px-3.5 text-metadata font-semibold text-findmi-700 transition hover:bg-findmi-100">
            Targeted · {TARGET_STATUS_LABELS[target.status]} · Open
          </Link>
        ) : canEdit && !picking ? (
          <button type="button" onClick={() => setPicking(true)} className="flex h-9 items-center rounded-full bg-findmi px-3.5 text-metadata font-bold text-white transition hover:bg-findmi-600">
            Target
          </button>
        ) : null}
      </div>

      {picking && !target && (
        <div className="ml-[4.25rem] flex flex-col gap-2 rounded-xl bg-black/[0.03] p-3">
          <span className="text-metadata font-semibold text-muted">Why</span>
          <IntentPicker kind={kind} value={intents} onChange={setIntents} disabled={saving} />
          {error && (
            <p role="alert" className="text-metadata text-red-600">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={saving || intents.length === 0} className="flex h-9 items-center rounded-full bg-findmi px-3.5 text-metadata font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50">
              {saving ? "Adding…" : "Add Target"}
            </button>
            <button type="button" onClick={() => setPicking(false)} disabled={saving} className="flex h-9 items-center rounded-full px-3.5 text-metadata font-semibold text-muted hover:text-primary">
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
