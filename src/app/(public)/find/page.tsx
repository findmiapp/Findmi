import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cityState, formatDateRange, getTemporalLabel } from "@/lib/format";
import { getFindMiHereFeed, type AppearanceFeedItem, type FindWindow } from "@/lib/data";
import PostCard from "@/components/PostCard";
import LiveDot from "@/components/LiveDot";

export const metadata: Metadata = {
  title: "FindMi Here",
  description: "Where FindMi businesses are, right now and coming up.",
};

const TABS: { value: FindWindow; label: string }[] = [
  { value: "live", label: "Now" },
  { value: "today", label: "Today" },
  { value: "weekend", label: "This Weekend" },
  { value: "anytime", label: "Anytime" },
];

export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ when?: string }>;
}) {
  const { when: whenParam } = await searchParams;
  const when: FindWindow = TABS.some((t) => t.value === whenParam)
    ? (whenParam as FindWindow)
    : "today";

  const items = await getFindMiHereFeed(when, 30);
  const [hero, ...rest] = items;
  const heroLabel = hero ? getTemporalLabel(hero.start_at, hero.end_at) : null;

  return (
    <div className="min-h-screen bg-ink pb-14">
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi">FindMi Here</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Where FindMi is, right now
        </h1>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={t.value === "today" ? "/find" : `/find?when=${t.value}`}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                when === t.value
                  ? "bg-findmi text-white"
                  : "border border-white/15 text-white/70 hover:border-white/30"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {items.length === 0 ? (
          <p className="mt-8 text-sm text-white/50">
            Nothing in this window yet — try Anytime, or check back soon.
          </p>
        ) : (
          <>
            {hero && (
              <div className="mt-6 max-w-sm">
                <PostCard
                  href={`/business/${hero.business.slug}`}
                  image={hero.business.cover_image_url ?? null}
                  kind="event"
                  badgeLabel={heroLabel!.label}
                  badgeVariant={heroLabel!.live ? "live" : "default"}
                  title={hero.business.name}
                  metaLines={[
                    { icon: "tag", text: hero.title },
                    ...(hero.city
                      ? [{ icon: "pin" as const, text: cityState(hero.city, hero.state) }]
                      : []),
                  ]}
                  cta="Find Them"
                />
              </div>
            )}

            {rest.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-bold uppercase tracking-wide text-white/40">
                  {when === "live" ? "Also Here Now" : "More"}
                </p>
                <div className="mt-2.5 flex flex-col gap-2">
                  {rest.map((item) => (
                    <DarkAppearanceRow key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DarkAppearanceRow({ item }: { item: AppearanceFeedItem }) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);
  const location = cityState(item.city, item.state);

  return (
    <Link
      href={`/business/${item.business.slug}`}
      className={`flex items-center gap-2.5 rounded-2xl border p-2.5 transition active:scale-[0.99] ${
        live ? "border-findmi/40 bg-findmi/10" : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/10">
        {item.business.logo_url && (
          <Image src={item.business.logo_url} alt={item.business.name} fill sizes="48px" className="object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${live ? "text-findmi" : "text-white/40"}`}>
          {live && <LiveDot className="text-findmi" />}
          {when}
        </p>
        <p className="truncate text-sm font-semibold text-white">{item.business.name}</p>
        <p className="truncate text-xs text-white/50">
          {item.title}
          {location && ` · ${location}`} · {formatDateRange(item.start_at, item.end_at)}
        </p>
      </div>
      <span className="shrink-0 text-[11px] font-bold uppercase text-findmi">Find Them</span>
    </Link>
  );
}
