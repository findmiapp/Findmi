import Link from "next/link";
import {
  AVAILABILITY_RELATIONSHIPS,
  AVAILABILITY_RELATIONSHIP_LABELS,
  AVAILABILITY_STATUS_LABELS,
  availabilityRelationshipsPhrase,
  availabilityWhenLabel,
} from "@/lib/business-availability-domain";
import type { MarketDetail, MarketFootprint, MarketRow } from "@/lib/business-market-footprint";
import { NO_MARKET } from "@/lib/business-market-footprint";
import { Chip } from "../../../owner-ui";

const STATUS_TONE = { live: "aqua", pending: "amber", declined: "neutral" } as const;

/** Segmented switch between the place list and the Market view. Plain links, so Back /
 * Forward and shared URLs keep the same view. */
export function FindUsViewSwitch({ basePath, active }: { basePath: string; active: "places" | "markets" }) {
  const item = (key: "places" | "markets", label: string, href: string) => (
    <Link
      key={key}
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`flex h-9 flex-1 items-center justify-center rounded-full px-4 text-metadata font-semibold transition ${active === key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Find Us Here views" className="flex w-full max-w-xs gap-1 rounded-full bg-black/[0.05] p-1">
      {item("places", "Places", `${basePath}?tab=findmi-here&view=find-us`)}
      {item("markets", "By Market", `${basePath}?tab=findmi-here&view=find-us&fv=markets`)}
    </nav>
  );
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function RelationshipChips({ counts }: { counts: MarketFootprint["relationships"] }) {
  const present = AVAILABILITY_RELATIONSHIPS.filter((r) => (counts[r] ?? 0) > 0);
  if (present.length === 0) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      {present.map((r) => (
        <span key={r} className="rounded-full bg-black/[0.05] px-2.5 py-1 text-microcopy font-semibold text-secondary">
          {AVAILABILITY_RELATIONSHIP_LABELS[r].replace(/ Here$/, "")} · {counts[r]}
        </span>
      ))}
    </span>
  );
}

function MarketCard({ basePath, f }: { basePath: string; f: MarketFootprint }) {
  const key = f.market?.slug ?? NO_MARKET;
  const total = f.ours + f.findUs;
  return (
    <li>
      <Link href={`${basePath}?tab=findmi-here&view=find-us&fv=markets&fm=${key}`} className="block rounded-2xl border border-black/[0.06] bg-white p-4 transition hover:border-findmi/40">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-card-title font-semibold text-primary">{f.market?.name ?? "No Market Yet"}</span>
          {f.intents.includes("priority") && <Chip tone="aqua">Priority Market</Chip>}
          {f.intents.includes("current") && !f.intents.includes("priority") && <Chip tone="aquaSoft">Current Market</Chip>}
        </span>
        <span className="mt-1 block text-metadata text-secondary">
          {total === 0 ? "No places here yet" : (
            <>
              {f.ours > 0 ? `${f.ours.toLocaleString()} Our ${f.ours === 1 ? "Location" : "Locations"}` : ""}
              {f.ours > 0 && f.findUs > 0 ? " · " : ""}
              {f.findUs > 0 ? `${f.findUs.toLocaleString()} Find Us Here (${f.live.toLocaleString()} Live${f.pending > 0 ? ` · ${f.pending.toLocaleString()} Pending` : ""}${f.declined > 0 ? ` · ${f.declined.toLocaleString()} Declined` : ""})` : ""}
            </>
          )}
        </span>
        <RelationshipChips counts={f.relationships} />
        {f.areaLabels.length > 0 && <span className="mt-2 block text-microcopy text-subtle">Focus: {f.areaLabels.join(", ")}</span>}
        {f.upcomingAppearances > 0 && <span className="mt-1 block text-microcopy text-subtle">{f.upcomingAppearances} upcoming {f.upcomingAppearances === 1 ? "appearance" : "appearances"}</span>}
      </Link>
    </li>
  );
}

/** Where is this Business now? The footprint grouped by Market, from real rows only. */
export function MarketOverview({
  basePath,
  data,
}: {
  basePath: string;
  data: { available: boolean; markets: MarketFootprint[]; others: MarketRow[]; noMarket: MarketFootprint };
}) {
  if (!data.available) return <p className="text-body text-muted">This isn&rsquo;t available yet. Please check back soon.</p>;
  const nothing = data.markets.length === 0 && data.noMarket.ours + data.noMarket.findUs === 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted">Your footprint by Findmi Market: the places you operate and the places that carry you. Counts come from what’s on Findmi today — there are no estimates or scores here.</p>
      {nothing && <p className="text-body text-muted">Nothing on your footprint yet. Add places under Places, or tell Findmi your Priority Markets in Growth.</p>}
      {data.markets.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.markets.map((f) => (
            <MarketCard key={f.market?.id} basePath={basePath} f={f} />
          ))}
        </ul>
      )}
      {data.noMarket.ours + data.noMarket.findUs > 0 && (
        <section aria-labelledby="mf-none">
          <h3 id="mf-none" className="font-display text-card-title font-bold text-primary">Not In A Market Yet</h3>
          <p className="mt-0.5 text-metadata text-muted">These Locations haven’t been assigned to a Findmi Market — including places added by an import. Findmi assigns Markets, so they’re listed here instead of being guessed from a city name.</p>
          <ul className="mt-2 flex flex-col gap-2">
            <MarketCard basePath={basePath} f={data.noMarket} />
          </ul>
        </section>
      )}
      {data.others.length > 0 && (
        <details className="rounded-2xl border border-black/[0.06] bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-card-title font-semibold text-primary">Other Markets · {data.others.length}</summary>
          <ul className="flex flex-col divide-y divide-black/[0.06] border-t border-black/[0.06]">
            {data.others.map((m) => (
              <li key={m.id}>
                <Link href={`${basePath}?tab=findmi-here&view=find-us&fv=markets&fm=${m.slug}`} className="flex items-center justify-between px-4 py-2.5 text-body text-primary hover:bg-black/[0.02]">
                  {m.name}
                  <span className="text-metadata text-muted">No places yet</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** One Market: Our Locations, Find Us Here entries (with relationships and products),
 * which Products are placed here and where, and upcoming Appearances. */
export function MarketDetailView({ basePath, detail, marketKey }: { basePath: string; detail: MarketDetail; marketKey: string }) {
  const back = `${basePath}?tab=findmi-here&view=find-us&fv=markets`;
  if (!detail.available) {
    return (
      <div className="flex flex-col gap-3">
        <Link href={back} className="w-fit text-metadata font-semibold text-accent hover:underline">All Markets</Link>
        <p className="text-body text-muted">That Market isn’t available.</p>
      </div>
    );
  }
  const pages = Math.max(1, Math.ceil(detail.entriesTotal / detail.pageSize));
  const link = (p: number) => `${back}&fm=${marketKey}${p > 1 ? `&fp=${p}` : ""}`;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={back} className="text-metadata font-semibold text-accent hover:underline">All Markets</Link>
        <h2 className="mt-1 font-display text-section-title font-bold text-primary">{detail.market?.name ?? "Not In A Market Yet"}</h2>
        <p className="text-metadata text-muted">
          {detail.ours.length.toLocaleString()} Our {detail.ours.length === 1 ? "Location" : "Locations"} · {detail.entriesTotal.toLocaleString()} Find Us Here {detail.entriesTotal === 1 ? "place" : "places"}
        </p>
      </div>

      {detail.ours.length > 0 && (
        <section aria-labelledby="md-ours">
          <h3 id="md-ours" className="font-display text-card-title font-bold text-primary">Our Locations</h3>
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white">
            {detail.ours.map((l) => (
              <li key={l.id} className="px-3.5 py-2.5">
                <Link href={`/location/${l.slug}`} className="block truncate text-body font-semibold text-primary hover:underline">{l.name}</Link>
                <span className="block truncate text-metadata text-muted">{[l.city, l.state].filter(Boolean).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="md-find">
        <h3 id="md-find" className="font-display text-card-title font-bold text-primary">Find Us Here</h3>
        {detail.entries.length === 0 ? (
          <p className="mt-1 text-body text-muted">No places in this Market yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white">
            {detail.entries.map((e) => (
              <li key={e.id} className="px-3.5 py-2.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/location/${e.locationSlug}`} className="min-w-0 truncate text-body font-semibold text-primary hover:underline">{e.locationName}</Link>
                  <Chip tone={STATUS_TONE[e.status]}>{AVAILABILITY_STATUS_LABELS[e.status]}</Chip>
                </span>
                <span className="block truncate text-metadata text-muted">{[e.city, e.state].filter(Boolean).join(", ")}</span>
                <span className="block text-metadata text-secondary">{availabilityRelationshipsPhrase(e.relationships)} · {availabilityWhenLabel(e.startsOn, e.endsOn)}</span>
                <span className="block text-metadata text-muted">{e.products.length > 0 ? e.products.map((p) => p.name).join(", ") : "Your Brand"}</span>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-metadata font-semibold">
            {detail.page > 1 ? <Link href={link(detail.page - 1)} className="text-accent hover:underline">Previous</Link> : <span />}
            <span className="text-muted">Page {detail.page} of {pages}</span>
            {detail.page < pages ? <Link href={link(detail.page + 1)} className="text-accent hover:underline">Next</Link> : <span />}
          </nav>
        )}
      </section>

      {detail.entriesTotal > 0 && (
        <section aria-labelledby="md-products">
          <h3 id="md-products" className="font-display text-card-title font-bold text-primary">Products Here</h3>
          {detail.productCoverage.length === 0 && detail.brandWidePlaces === 0 ? (
            <p className="mt-1 text-body text-muted">No products placed in this Market yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white">
              {detail.productCoverage.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-body">
                  <span className="min-w-0 truncate text-primary">{p.name}</span>
                  <span className="shrink-0 text-metadata text-muted">{p.places.toLocaleString()} {p.places === 1 ? "place" : "places"}</span>
                </li>
              ))}
              {detail.brandWidePlaces > 0 && (
                <li className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-body">
                  <span className="text-primary">Your Brand (no specific products)</span>
                  <span className="shrink-0 text-metadata text-muted">{detail.brandWidePlaces.toLocaleString()} {detail.brandWidePlaces === 1 ? "place" : "places"}</span>
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {!detail.isNoMarket && (
        <section aria-labelledby="md-appear">
          <h3 id="md-appear" className="font-display text-card-title font-bold text-primary">Upcoming Appearances</h3>
          {detail.appearances.length === 0 ? (
            <p className="mt-1 text-body text-muted">Nothing scheduled in this Market.</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white">
              {detail.appearances.map((a) => (
                <li key={a.id} className="px-3.5 py-2.5">
                  <span className="block truncate text-body font-semibold text-primary">{a.title}</span>
                  <span className="block truncate text-metadata text-muted">{when(a.startAt)}{a.venue ? ` · ${a.venue}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
