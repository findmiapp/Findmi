import OptimisticTabs from "./OptimisticTabs";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import {
  MOMENT_FILTERS,
  MOMENT_FILTER_LABELS,
  filterMoments,
  momentHref,
  newMomentHref,
  type BusinessMoment,
  type BusinessMomentsResult,
  type MomentFilter,
} from "@/lib/business-moments";
import { Chip } from "../../../owner-ui";
import MomentProfileControl from "./MomentProfileControl";

const momentDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Where this Moment comes from, in one short label: By Us, or the canonical
 * author (a Person, Findmi, another Business) — never implying this Business
 * owns it. */
function sourceLabel(m: BusinessMoment): string {
  if (m.byUs) return "By Us";
  if (m.mine) return "By You";
  return m.author?.name ?? "Connected";
}

/** Why it is connected to this Business. */
function connectionLabel(m: BusinessMoment): string | null {
  if (m.byUs) return null;
  if (m.relations.includes("tagged")) return "Tagged Us";
  if (m.relations.includes("event")) return "From An Event";
  if (m.relations.includes("location")) return "At Our Location";
  return null;
}

function MomentTile({ moment: m, compact = false, businessId, canManageDisplay = false }: { moment: BusinessMoment; compact?: boolean; businessId?: string; canManageDisplay?: boolean }) {
  const canOpen = m.status === "published" || m.byUs || m.mine;
  const inner = (
    <>
      <span className={`relative block overflow-hidden ${compact ? "aspect-square" : "aspect-[4/5]"} rounded-2xl bg-black/[0.05] group-focus-visible:ring-2 group-focus-visible:ring-findmi/40`}>
        {m.coverUrl ? (
          <SupabaseImage src={m.coverUrl} alt="" fill sizes="(min-width: 1024px) 220px, 45vw" className="object-cover transition duration-200 group-hover:scale-[1.02]" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink/20">
            <NavIcon name="moments" className="h-9 w-9" />
          </span>
        )}
        {m.status !== "published" && (
          <span className="absolute left-2 top-2">
            <Chip tone="amber">Draft</Chip>
          </span>
        )}
      </span>
      <span className="mt-1.5 block truncate text-card-title font-semibold text-primary">{m.title}</span>
      <span className="block truncate text-metadata text-muted">
        {momentDate(m.entryDate)}
        {m.locationName ? ` · ${m.locationName}` : ""}
      </span>
      {!compact && (
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-microcopy text-subtle">
          <span className={`font-semibold ${m.byUs ? "text-findmi-700" : "text-secondary"}`}>{sourceLabel(m)}</span>
          {connectionLabel(m) && <span>· {connectionLabel(m)}</span>}
        </span>
      )}
    </>
  );
  const tile = canOpen ? (
    <Link href={momentHref(m)} className="group block focus-visible:outline-none">
      {inner}
    </Link>
  ) : (
    <div className="group block">{inner}</div>
  );
  // Profile display: only a Moment that can appear on this Business's public
  // profile has a choice to make, and only a manager can make it.
  if (compact || !businessId || !m.profileEligible) return tile;
  return (
    <div>
      {tile}
      {canManageDisplay ? (
        <MomentProfileControl businessId={businessId} entryId={m.id} initialHidden={m.profileHidden} initialFeatured={m.profileFeatured} />
      ) : (
        <p className="mt-1 text-microcopy text-subtle">{m.profileHidden ? "Hidden from your profile" : "On your profile"}</p>
      )}
    </div>
  );
}

/** Moments — everything connected to this Business, media-first: what it
 * posted itself, what Findmi or others posted about it, and what came from
 * its Events and Locations. Seeing, creating and managing reuse the
 * existing Moments infrastructure (composer, Moment page, editor). Canonical
 * authorship never changes here: opening a connected Moment shows it on its
 * own page; only the Business's own Moments are editable by it. */
export default function MomentsView({
  basePath,
  businessId,
  data,
  filter,
  canPost,
  canManageDisplay = false,
}: {
  basePath: string;
  businessId: string;
  data: BusinessMomentsResult;
  filter: MomentFilter;
  canPost: boolean;
  /** Owner/manager (or elevated Admin): may show/hide Moments on the profile. */
  canManageDisplay?: boolean;
}) {
  const moments = filterMoments(data.moments, filter);
  const href = (f: MomentFilter) => (f === "all" ? `${basePath}?tab=moments` : `${basePath}?tab=moments&show=${f}`);
  // Only filters that have something in them (plus All and By Us) are offered.
  const chips = MOMENT_FILTERS.filter((f) => f === "all" || f === "us" || data.counts[f] > 0 || f === filter);

  return (
    <div className="flex flex-col gap-5 lg:max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Moments</h1>
          <p className="mt-1 text-body text-muted">Everything connected to your Business — what you post, and what others share about you.</p>
        </div>
        {canPost && (
          <Link href={newMomentHref(businessId)} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
            Add A Moment
          </Link>
        )}
      </div>

      {data.moments.length > 0 && (
        <OptimisticTabs
          ariaLabel="Moments filter"
          navClass="flex flex-wrap gap-1.5"
          linkClass="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-metadata font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
          activeClass="bg-findmi-50 text-findmi-700"
          inactiveClass="bg-black/[0.04] text-muted hover:text-primary"
          active={filter}
          items={chips.map((f) => ({
            key: f,
            href: href(f),
            label: (
              <>
                {MOMENT_FILTER_LABELS[f]}
                <span className="text-[11px] font-bold opacity-70">{data.counts[f]}</span>
              </>
            ),
          }))}
        />
      )}

      {moments.length === 0 ? (
        <p className="text-body text-muted">
          {data.moments.length === 0
            ? `No Moments yet.${canPost ? " Share a photo from an Event, a new Product or a day at a Location — Moments others share about you will show up here too." : " Moments connected to this Business will show up here."}`
            : "Nothing in this view yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {moments.map((m) => (
            <li key={m.id} className="min-w-0">
              <MomentTile moment={m} businessId={businessId} canManageDisplay={canManageDisplay} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Home's compact strip — the latest few connected Moments as a swipe rail
 * with a link into the full Moments view. Renders nothing when there are none. */
export function MomentsStrip({ basePath, moments }: { basePath: string; moments: BusinessMoment[] }) {
  if (moments.length === 0) return null;
  return (
    <section id="home-moments" aria-labelledby="home-moments-title" className="scroll-mt-[104px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-moments-title" className="font-display text-section-title font-bold text-primary">
          Recent Moments
        </h2>
        <Link href={`${basePath}?tab=moments`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          See All
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>
      <ul className="-mx-4 mt-2.5 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {moments.map((m) => (
          <li key={m.id} className="w-[28vw] max-w-[7.5rem] shrink-0 snap-start">
            <MomentTile moment={m} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
