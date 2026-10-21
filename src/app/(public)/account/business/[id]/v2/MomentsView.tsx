import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import { momentHref, newMomentHref, type BusinessMoment } from "@/lib/business-moments";
import { Chip } from "../../../owner-ui";

const momentDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function MomentTile({ moment: m, compact = false }: { moment: BusinessMoment; compact?: boolean }) {
  return (
    <Link href={momentHref(m)} className="group block focus-visible:outline-none">
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
    </Link>
  );
}

/** Moments — what this Business has shared as itself, media-first. Seeing,
 * creating and managing all reuse the existing Moments infrastructure: the
 * composer (`/my-world/journal/new` posted as this Business), the Moment
 * page for a published entry, the editor for a draft. */
export default function MomentsView({ businessId, moments, canPost }: { businessId: string; moments: BusinessMoment[]; canPost: boolean }) {
  return (
    <div className="flex flex-col gap-5 lg:max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Moments</h1>
          <p className="mt-1 text-body text-muted">Photos and stories your Business shares with people who follow it.</p>
        </div>
        {canPost && (
          <Link href={newMomentHref(businessId)} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
            Add A Moment
          </Link>
        )}
      </div>

      {moments.length === 0 ? (
        <p className="text-body text-muted">
          No Moments yet.{canPost ? " Share a photo from an Event, a new Product or a day at a Location." : " Only a Business owner or manager can post Moments."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {moments.map((m) => (
            <li key={m.id} className="min-w-0">
              <MomentTile moment={m} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Home's compact strip — the latest few Moments as a swipe rail with a
 * link into the full Moments view. Renders nothing when there are none. */
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
