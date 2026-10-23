"use client";

import { useState } from "react";
import Link from "next/link";
import { NotPublicBadge } from "@/components/places/PlaceFindOrCreate";
import { AVAILABILITY_STATUS_LABELS, availabilityRelationshipsPhrase } from "@/lib/business-availability-domain";
import { TARGET_STATUSES, TARGET_STATUS_LABELS, TARGET_STATUS_TONE, formatTargetDate, type TargetStatus } from "@/lib/business-targets-domain";
import type { GeographyCard, GeographyDetail, GeographyOverview, RelationshipCounts, RelationshipRow } from "@/lib/business-relationships";
import type { RelevantOpportunity } from "@/lib/relevant-opportunities";
import { Chip } from "../../../owner-ui";
import { PlaceThumb, useTargetNav } from "./TargetsView";

/** Find Us Here → By Market — the geography lens over the SAME relationships
 * every other lens shows (lib/business-relationships.ts). Each geography keeps
 * three separate ideas side by side:
 *   CURRENT FOOTPRINT  — where customers can find you now (Our Locations + live,
 *                        in-date Find Us Here). A Target alone is never footprint.
 *   GROWTH PIPELINE    — the private Place Targets you're pursuing there
 *                        (Business and Event Targets have no place, so they
 *                        never appear in a geography).
 *   OPPORTUNITIES      — commercial Opportunities relevant there.
 * A Business's own geography stays its own words ("Jersey City"), with the
 * Findmi Market only as quiet context. Every place opens the one relationship
 * workspace (`loc`). */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const title = "text-label font-bold uppercase text-subtle";

function pipelineLine(c: RelationshipCounts): string | null {
  const parts = (["in_conversation", "agreed", "active"] as const).filter((s) => c.byStatus[s] > 0).map((s) => `${c.byStatus[s]} ${TARGET_STATUS_LABELS[s]}`);
  return parts.length ? parts.join(" · ") : null;
}

const geoHref = (basePath: string, g: { marketSlug: string | null; areaSlug: string | null }) =>
  `${basePath}?tab=findmi-here&view=find-us&fv=markets&fm=${g.marketSlug ?? "none"}${g.areaSlug ? `&fa=${g.areaSlug}` : ""}`;

function GeoCard({ basePath, g }: { basePath: string; g: GeographyCard }) {
  const c = g.counts;
  const line = pipelineLine(c);
  return (
    <li>
      <Link href={geoHref(basePath, g)} className="block rounded-2xl border border-black/[0.08] bg-white p-4 transition hover:border-findmi/40">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display text-card-title font-bold text-primary">{g.label}</span>
          {g.priority && <Chip tone="aqua">Priority</Chip>}
          {!g.priority && g.current && <Chip tone="aquaSoft">Current</Chip>}
          {g.context && <span className="text-metadata text-muted">{g.context}</span>}
        </span>
        <span className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-metadata">
          <span className="text-muted">Current Footprint</span>
          <span className="font-semibold text-primary">{c.footprint > 0 ? plural(c.footprint, "Place") : "No Footprint Yet"}</span>
          <span className="text-muted">Growth Activity</span>
          <span className="text-primary">
            <span className="font-semibold">{c.pursuing > 0 ? plural(c.pursuing, "Target") : "No Targets Yet"}</span>
            {line && <span className="block text-secondary">{line}</span>}
          </span>
          {g.opportunities > 0 && (
            <>
              <span className="text-muted">Opportunities</span>
              <span className="font-semibold text-findmi-700">{g.opportunities.toLocaleString()} Relevant</span>
            </>
          )}
        </span>
        {(c.pendingReview > 0 || g.upcomingAppearances > 0) && (
          <span className="mt-2 block text-microcopy text-subtle">
            {[c.pendingReview > 0 ? `${c.pendingReview} Pending Review on Find Us Here` : null, g.upcomingAppearances > 0 ? plural(g.upcomingAppearances, "upcoming appearance") : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </Link>
    </li>
  );
}

export function GeographyOverviewView({ basePath, data }: { basePath: string; data: GeographyOverview | null }) {
  if (!data || !data.available) return <p className="text-body text-muted">This isn&rsquo;t available yet. Please check back soon.</p>;
  const nothing = data.growingIn.length === 0 && data.markets.length === 0 && !data.noMarket;
  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      {nothing && <p className="text-body text-muted">Nothing here yet. Add places under Places or Targets, or set your Priority Markets in Growth.</p>}
      {data.growingIn.length > 0 && (
        <section aria-labelledby="geo-growing" className="flex flex-col gap-2">
          <h3 id="geo-growing" className={title}>Growing In</h3>
          <ul className="flex flex-col gap-2">{data.growingIn.map((g) => <GeoCard key={g.key} basePath={basePath} g={g} />)}</ul>
        </section>
      )}
      {data.unmapped.length > 0 && <p className="-mt-2 text-microcopy text-subtle">Also growing in {data.unmapped.join(", ")} — not a Findmi Market yet.</p>}
      {data.markets.length > 0 && (
        <section aria-labelledby="geo-markets" className="flex flex-col gap-2">
          <h3 id="geo-markets" className={title}>{data.growingIn.length > 0 ? "Other Markets You’re In" : "Your Markets"}</h3>
          <ul className="flex flex-col gap-2">{data.markets.map((g) => <GeoCard key={g.key} basePath={basePath} g={g} />)}</ul>
        </section>
      )}
      {data.noMarket && (
        <section aria-labelledby="geo-none" className="flex flex-col gap-2">
          <h3 id="geo-none" className={title}>Not In A Findmi Market Yet</h3>
          <ul className="flex flex-col gap-2"><GeoCard basePath={basePath} g={data.noMarket} /></ul>
        </section>
      )}
      {data.others.length > 0 && (
        <details className="rounded-2xl border border-black/[0.06] bg-white">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-body font-semibold text-primary">Other Markets · {data.others.length}</summary>
          <ul className="flex flex-col divide-y divide-black/[0.06] border-t border-black/[0.06]">
            {data.others.map((m) => (
              <li key={m.marketSlug}>
                <Link href={geoHref(basePath, { marketSlug: m.marketSlug, areaSlug: null })} className="flex min-h-11 items-center justify-between px-4 text-body text-primary hover:bg-black/[0.02]">
                  {m.label}
                  <span className="text-metadata text-muted">Nothing here yet</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── One geography ──────────────────────────────────────────────────────────

const PRESENCE_TONE = { live: "aqua", pending: "amber", declined: "neutral" } as const;

/** One place in a geography — opens the relationship workspace. */
function PlaceRow({ row, show }: { row: RelationshipRow; show: "footprint" | "pipeline" }) {
  const { href } = useTargetNav();
  const p = row.target;
  return (
    <li>
      <Link href={href({ loc: row.place.id })} scroll={false} className="flex items-start gap-3 px-3.5 py-3 transition hover:bg-black/[0.02]">
        <PlaceThumb imageUrl={row.place.imageUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-primary">{row.place.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {row.ours && <Chip tone="aqua">Our Location</Chip>}
            {row.presence && (show === "footprint" || row.presence.public) && (
              <Chip tone={PRESENCE_TONE[row.presence.status]}>{row.presence.public ? availabilityRelationshipsPhrase(row.presence.relationships) : AVAILABILITY_STATUS_LABELS[row.presence.status]}</Chip>
            )}
            {p && (show === "pipeline" || p.status !== "passed") && <Chip tone={TARGET_STATUS_TONE[p.status]}>{TARGET_STATUS_LABELS[p.status]}</Chip>}
            {row.place.unlisted && <NotPublicBadge />}
          </span>
          {show === "pipeline" && p && (p.nextAction || p.nextActionAt) && (
            <span className="mt-0.5 line-clamp-2 text-metadata text-secondary">Next: {[p.nextActionAt ? formatTargetDate(p.nextActionAt) : null, p.nextAction].filter(Boolean).join(" · ")}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function List({ rows, show, total, emptyText }: { rows: RelationshipRow[]; show: "footprint" | "pipeline"; total: number; emptyText: string }) {
  if (rows.length === 0) return <p className="text-metadata text-muted">{emptyText}</p>;
  return (
    <>
      <ul className="flex flex-col divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
        {rows.map((r) => <PlaceRow key={r.place.id} row={r} show={show} />)}
      </ul>
      {total > rows.length && <p className="text-microcopy text-subtle">Showing {rows.length.toLocaleString()} of {total.toLocaleString()}.</p>}
    </>
  );
}

export function OpportunityCards({ items }: { items: RelevantOpportunity[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((o) => (
        <li key={o.listingId}>
          <Link href={o.path} className="block rounded-2xl border border-black/[0.08] bg-white px-3.5 py-3 transition hover:border-findmi/40">
            <span className="block text-body font-semibold text-primary">{o.title}</span>
            <span className="block text-metadata text-muted">{[o.typeLabel, o.placeName, o.startsAt ? formatTargetDate(o.startsAt.slice(0, 10)) : null].filter(Boolean).join(" · ")}</span>
            <span className="mt-1.5 flex flex-wrap gap-1">
              {o.reasons.map((r) => (
                <span key={r} className="rounded-full bg-findmi-50 px-2 py-0.5 text-microcopy font-semibold text-findmi-700">{r}</span>
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function GeographyDetailView({ basePath, detail }: { basePath: string; detail: GeographyDetail | null }) {
  const back = `${basePath}?tab=findmi-here&view=find-us&fv=markets`;
  const [stage, setStage] = useState<TargetStatus | "">("");
  if (!detail || !detail.available) {
    return (
      <div className="flex flex-col gap-3">
        <Link href={back} className="-my-2 inline-flex min-h-10 w-fit items-center text-metadata font-semibold text-accent hover:underline">← By Market</Link>
        <p className="text-body text-muted">That place isn&rsquo;t available.</p>
      </div>
    );
  }
  const c = detail.counts;
  const pipeline = stage ? detail.pipeline.filter((r) => r.target?.status === stage) : detail.pipeline;
  const chip = (on: boolean) => `flex h-9 items-center gap-1.5 rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;
  return (
    <div className="flex flex-col gap-6 lg:max-w-3xl">
      <div>
        <Link href={back} className="-my-2 inline-flex min-h-10 w-fit items-center text-metadata font-semibold text-accent hover:underline">← By Market</Link>
        <h2 className="mt-1 font-display text-section-title font-bold text-primary">{detail.label}</h2>
        {detail.context && <p className="text-metadata text-muted">{detail.context}</p>}
      </div>

      <section aria-labelledby="gd-footprint" className="flex flex-col gap-2">
        <h3 id="gd-footprint" className="flex items-baseline justify-between gap-3">
          <span className={title}>Current Footprint</span>
          <span className="text-metadata font-semibold text-primary">{c.footprint > 0 ? plural(c.footprint, "Place") : "None Yet"}</span>
        </h3>
        <List rows={detail.footprint} show="footprint" total={c.footprint} emptyText="No footprint here yet." />
        {detail.pendingReview.length > 0 && (
          <details className="rounded-2xl border border-black/[0.06] bg-white">
            <summary className="flex min-h-11 cursor-pointer list-none items-center px-3.5 text-metadata font-semibold text-secondary">{c.pendingReview} Pending Review on Find Us Here</summary>
            <ul className="flex flex-col divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {detail.pendingReview.map((r) => <PlaceRow key={r.place.id} row={r} show="footprint" />)}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="gd-pipeline" className="flex flex-col gap-2">
        <h3 id="gd-pipeline" className="flex items-baseline justify-between gap-3">
          <span className={title}>Growth Pipeline</span>
          <span className="text-metadata font-semibold text-primary">{c.pursuing > 0 ? plural(c.pursuing, "Target") : "None Yet"}</span>
        </h3>
        {c.pursuing > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stage">
            <button type="button" aria-pressed={stage === ""} onClick={() => setStage("")} className={chip(stage === "")}>All <span className="font-normal opacity-80">{c.pursuing}</span></button>
            {TARGET_STATUSES.filter((s) => s !== "passed" && c.byStatus[s] > 0).map((s) => (
              <button key={s} type="button" aria-pressed={stage === s} onClick={() => setStage(stage === s ? "" : s)} className={chip(stage === s)}>
                {TARGET_STATUS_LABELS[s]} <span className="font-normal opacity-80">{c.byStatus[s]}</span>
              </button>
            ))}
          </div>
        )}
        <List rows={pipeline} show="pipeline" total={stage ? c.byStatus[stage] : c.pursuing} emptyText={c.pursuing === 0 ? "No Targets here yet. Add one under Targets." : "No Targets at this stage."} />
      </section>

      {detail.opportunities.length > 0 && (
        <section aria-labelledby="gd-opps" className="flex flex-col gap-2">
          <h3 id="gd-opps" className="flex items-baseline justify-between gap-3">
            <span className={title}>Opportunities</span>
            <span className="text-metadata font-semibold text-findmi-700">{detail.opportunities.length} Relevant</span>
          </h3>
          <OpportunityCards items={detail.opportunities} />
        </section>
      )}

      {(detail.productCoverage.length > 0 || detail.brandWidePlaces > 0) && (
        <details className="rounded-2xl border border-black/[0.06] bg-white">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3.5 text-metadata font-semibold text-secondary">Products Here</summary>
          <ul className="flex flex-col divide-y divide-black/[0.06] border-t border-black/[0.06]">
            {detail.productCoverage.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-body">
                <span className="min-w-0 truncate text-primary">{p.name}</span>
                <span className="shrink-0 text-metadata text-muted">{plural(p.places, "place")}</span>
              </li>
            ))}
            {detail.brandWidePlaces > 0 && (
              <li className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-body">
                <span className="text-primary">Your Brand (no specific products)</span>
                <span className="shrink-0 text-metadata text-muted">{plural(detail.brandWidePlaces, "place")}</span>
              </li>
            )}
          </ul>
        </details>
      )}

      {detail.appearances.length > 0 && (
        <section aria-labelledby="gd-appear" className="flex flex-col gap-2">
          <h3 id="gd-appear" className={title}>Upcoming Appearances</h3>
          <ul className="flex flex-col divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white">
            {detail.appearances.map((a) => (
              <li key={a.id}>
                <Link href={`${basePath}?tab=findmi-here&editing=${a.id}`} className="block px-3.5 py-2.5">
                  <span className="block truncate text-body font-semibold text-primary">{a.title}</span>
                  <span className="block truncate text-metadata text-muted">{when(a.startAt)}{a.venue ? ` · ${a.venue}` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
