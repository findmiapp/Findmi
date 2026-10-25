"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import EventSaveButton from "@/components/EventSaveButton";
import LocationSaveButton from "@/components/LocationSaveButton";
import SaveButton from "@/components/SaveButton";
import type { MapResultCard as Card } from "@/lib/discovery/map-server";

// One discovery result — the Feed row, the desktop results row and the
// selected-marker preview. Same card language as DiscoveryTile (white
// card, rounded-2xl, small uppercase kicker, Inter display title, the
// red LIVE pill). Status is always words, never color alone.

const KIND: Record<Card["kind"], string> = { event: "Event", appearance: "Pop-Up", place: "Place" };
const VIEW: Record<Card["kind"], string> = { event: "View Event", appearance: "View Brand", place: "View Place" };

export function StatusPill({ status, when }: { status: Card["status"]; when?: string }) {
  if (status.live)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />
        Live
        <span className="font-semibold normal-case tracking-normal">· {status.text}</span>
      </span>
    );
  const text = status.text || when;
  if (!text) return null;
  const tone = status.tone === "soon" || status.tone === "today" ? "bg-findmi-50 text-findmi-700" : status.tone === "place" ? "bg-black/[0.04] text-ink/70" : "bg-black/[0.04] text-ink/60";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${tone}`}>{text}</span>;
}

function Save({ card }: { card: Card }) {
  const s = card.save;
  if (!s || !s.slug) return null;
  if (s.type === "event") return <EventSaveButton slug={s.slug} id={s.id} layout="icon" />;
  if (s.type === "location") return <LocationSaveButton slug={s.slug} id={s.id} layout="icon" />;
  return <SaveButton slug={s.slug} id={s.id} />;
}

const km = (d: number | null) => (d === null ? null : d < 0.16 ? "Here" : `${(d * 0.621371).toFixed(d < 16 ? 1 : 0)} mi`);

export default function MapResultCard({
  card,
  selected = false,
  onSelect,
  variant = "row",
  showDistance = false,
}: {
  card: Card;
  selected?: boolean;
  onSelect?: (card: Card) => void;
  variant?: "row" | "preview";
  showDistance?: boolean;
}) {
  const preview = variant === "preview";
  const distance = showDistance ? km(card.distanceKm) : null;
  const perks = [...(card.free ? ["Free"] : []), ...card.perks.filter((p) => p !== "Free Admission")].slice(0, preview ? 4 : 2);
  const sub = [card.brand && card.brand.name !== card.title ? card.brand.name : null, card.place.name !== card.title ? card.place.name : null].filter(Boolean).join(" · ");
  return (
    <article
      data-result-key={card.key}
      aria-current={selected ? "true" : undefined}
      className={`relative flex gap-3 rounded-2xl border bg-white p-2.5 transition ${selected ? "border-findmi shadow-[0_0_0_3px_rgba(20,176,188,0.18)]" : "border-black/5 hover:border-black/10"} ${preview ? "shadow-sm" : ""}`}
    >
      <div className={`relative shrink-0 overflow-hidden rounded-xl bg-black/5 ${preview ? "h-24 w-24" : "h-[4.5rem] w-[4.5rem]"}`}>
        {card.image ? (
          <SupabaseImage src={card.image} alt="" fill sizes="96px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-findmi-700 to-ink">
            <span className="font-display text-xl font-bold text-white/30">{card.title.slice(0, 1)}</span>
          </div>
        )}
        {card.logo && card.image !== card.logo && (
          <div className="absolute bottom-1 left-1 h-6 w-6 overflow-hidden rounded-md border border-black/[0.06] bg-white p-0.5">
            <SupabaseImage src={card.logo} alt="" fill sizes="24px" className="object-contain" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusPill status={card.status} when={card.when} />
          <span className="truncate text-[10px] font-bold uppercase tracking-wide text-ink/40">{KIND[card.kind]}</span>
        </div>
        {onSelect ? (
          <button type="button" onClick={() => onSelect(card)} aria-pressed={selected} className="min-w-0 text-left after:absolute after:inset-0 after:rounded-2xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-findmi">
            <span className="line-clamp-2 font-display text-sm font-bold leading-snug text-ink">{card.title}</span>
          </button>
        ) : (
          <Link href={card.href} className="line-clamp-2 font-display text-sm font-bold leading-snug text-ink hover:underline">
            {card.title}
          </Link>
        )}
        {sub && <p className="truncate text-xs text-ink/55">{sub}</p>}
        {card.kind !== "place" && card.when && !card.status.live && card.status.text !== card.when && <p className="truncate text-xs text-ink/55">{card.when}</p>}
        {(perks.length > 0 || distance || card.moreDates > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {perks.map((p) => (
              <span key={p} className="rounded-full bg-findmi-50 px-1.5 py-px text-[10px] font-semibold text-findmi-700">
                {p}
              </span>
            ))}
            {card.moreDates > 0 && <span className="text-[10px] font-semibold text-ink/50">+{card.moreDates} more {card.moreDates === 1 ? "date" : "dates"}</span>}
            {distance && <span className="text-[10px] font-semibold text-ink/50">{distance}</span>}
          </div>
        )}
        {card.reason && <p className="truncate text-[11px] text-ink/45">{card.reason}</p>}
        {preview && (
          <div className="relative z-10 mt-1.5 flex items-center gap-2">
            <Link href={card.href} className="inline-flex min-h-9 items-center rounded-full bg-findmi px-3.5 text-xs font-bold text-white hover:bg-findmi-600">
              {VIEW[card.kind]}
            </Link>
            {card.place.href && card.kind !== "place" && (
              <Link href={card.place.href} className="inline-flex min-h-9 items-center rounded-full border border-black/10 px-3 text-xs font-semibold text-ink/75 hover:border-black/20">
                Place
              </Link>
            )}
            <Save card={card} />
          </div>
        )}
      </div>
      {!preview && (
        <div className="relative z-10 flex shrink-0 flex-col items-end justify-between">
          <Save card={card} />
          <Link href={card.href} aria-label={`${VIEW[card.kind]}: ${card.title}`} className="rounded-full px-1.5 py-1 text-[11px] font-bold text-findmi-700 hover:underline">
            View
          </Link>
        </div>
      )}
    </article>
  );
}
