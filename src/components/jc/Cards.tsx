import Link from "next/link";
import { jcHref } from "@/lib/jc/config";
import { whenLabel } from "@/lib/jc/format";
import type { JcEvent, JcNeighborhood, JcPlace } from "@/lib/jc/types";
import JcMedia from "./JcMedia";

// JC browse cards — image first, at most two short lines of metadata.
// Everything else waits for the detail page.

export function WhenText({ e, className = "" }: { e: Pick<JcEvent, "startAt" | "endAt" | "date" | "timezone">; className?: string }) {
  const w = whenLabel(e);
  return (
    <span className={`inline-flex items-center gap-1.5 ${w.soon ? "text-[color:var(--jc-accent)]" : "text-neutral-500"} ${className}`}>
      {w.live && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--jc-accent)] opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--jc-accent)]" />
        </span>
      )}
      {w.text}
    </span>
  );
}

/** Large overlay card — the lead rail on Home ("Happening Today"). */
export function SpotlightCard({ e, priority = false }: { e: JcEvent; priority?: boolean }) {
  return (
    <Link href={jcHref(`/events/${e.slug}`)} className="group relative block active:scale-[0.99] transition-transform">
      <JcMedia src={e.image} alt={e.title} sizes="(min-width: 768px) 420px, 86vw" priority={priority} className="aspect-[4/3] md:aspect-[5/4]" rounded="rounded-[22px]" />
      <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <span className="inline-flex rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-medium">
          <WhenText e={e} />
        </span>
        <h3 className="mt-2 line-clamp-2 text-[19px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">{e.title}</h3>
        {(e.venue || e.neighborhood) && (
          <p className="mt-1 line-clamp-1 text-[13px] text-white/80">{[e.venue, e.neighborhood?.name].filter(Boolean).join(" · ")}</p>
        )}
      </div>
    </Link>
  );
}

export function EventCard({ e }: { e: JcEvent }) {
  return (
    <Link href={jcHref(`/events/${e.slug}`)} className="group block active:opacity-80">
      <JcMedia src={e.image} alt={e.title} sizes="(min-width: 768px) 240px, 62vw" className="aspect-[4/5]" />
      <p className="mt-2.5 text-[12.5px] font-medium">
        <WhenText e={e} />
      </p>
      <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{e.title}</h3>
    </Link>
  );
}

export function PlaceCard({ p, wide = false }: { p: JcPlace; wide?: boolean }) {
  return (
    <Link href={jcHref(`/places/${p.slug}`)} className="group block active:opacity-80">
      <JcMedia src={p.image} alt={p.name} sizes="(min-width: 768px) 260px, 62vw" className={wide ? "aspect-[4/3]" : "aspect-square"} />
      <h3 className="mt-2.5 line-clamp-1 text-[15px] font-semibold tracking-[-0.01em]">{p.name}</h3>
      <p className="line-clamp-1 text-[13px] text-neutral-500">{[p.categoryLabel, p.neighborhood?.name].filter(Boolean).join(" · ")}</p>
    </Link>
  );
}

export function NeighborhoodCard({ n }: { n: JcNeighborhood }) {
  return (
    <Link href={jcHref(`/n/${n.slug}`)} className="relative block active:opacity-80">
      <JcMedia src={n.image} alt={n.name} sizes="40vw" className="aspect-[3/4]" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-t from-black/55 to-transparent" />
      <span className="absolute bottom-3 left-3 right-3 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">{n.name}</span>
    </Link>
  );
}

/** Compact list row — Events feed and search results. */
export function EventRow({ e }: { e: JcEvent }) {
  return (
    <Link href={jcHref(`/events/${e.slug}`)} className="flex items-center gap-3.5 py-2.5 active:opacity-70">
      <JcMedia src={e.image} alt={e.title} sizes="80px" className="h-[76px] w-[76px] shrink-0" rounded="rounded-[14px]" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium">
          <WhenText e={e} />
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{e.title}</h3>
        {(e.venue || e.neighborhood) && <p className="mt-0.5 line-clamp-1 text-[13px] text-neutral-500">{e.venue ?? e.neighborhood?.name}</p>}
      </div>
    </Link>
  );
}

export function PlaceRow({ p }: { p: JcPlace }) {
  return (
    <Link href={jcHref(`/places/${p.slug}`)} className="flex items-center gap-3.5 py-2.5 active:opacity-70">
      <JcMedia src={p.image} alt={p.name} sizes="80px" className="h-[60px] w-[60px] shrink-0" rounded="rounded-[14px]" />
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-1 text-[15px] font-semibold tracking-[-0.01em]">{p.name}</h3>
        <p className="line-clamp-1 text-[13px] text-neutral-500">{[p.categoryLabel, p.neighborhood?.name].filter(Boolean).join(" · ")}</p>
      </div>
    </Link>
  );
}
