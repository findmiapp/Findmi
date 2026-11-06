"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import EventSaveButton from "@/components/EventSaveButton";
import LocationSaveButton from "@/components/LocationSaveButton";
import SaveButton from "@/components/SaveButton";
import type { MapResultCard as Card } from "@/lib/discovery/map-server";

// One discovery result — the List row, the desktop results row and the
// selected-marker preview. Same card language as DiscoveryTile (white
// card, rounded-2xl, small uppercase kicker, Inter display title, the
// red LIVE pill). Status is always words, never color alone.
//
// Selection model (Map Discovery Batch 1): a row with `onSelect` (Map
// view) selects its marker on tap; the selected preview — and any row
// without `onSelect` (List view, "Happening Here") — is ONE link to the
// public page. Save / Place stay independently tappable above that link.

const KIND: Record<Card["kind"], string> = { event: "Event", appearance: "Pop-Up", place: "Place" };
const OPEN: Record<Card["kind"], string> = { event: "Open Event", appearance: "Open Brand", place: "Open Place" };

export function StatusPill({ status, when }: { status: Card["status"]; when?: string }) {
  // "● LIVE · Ends 9 PM" — the word carries the state, the color supports it.
  if (status.live)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
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
  // A selected row or the preview is the link; a Map row still selects.
  const linked = !onSelect || selected;
  const distance = showDistance ? km(card.distanceKm) : null;
  const perks = [...(card.free ? ["Free"] : []), ...card.perks.filter((p) => p !== "Free Admission")].slice(0, preview ? 4 : 2);
  const sub = [card.brand && card.brand.name !== card.title ? card.brand.name : null, card.place.name !== card.title ? card.place.name : null].filter(Boolean).join(" · ");
  // The preview has room for a third line, so long names read instead of
  // stopping after a word or two.
  const titleClass = `break-words font-display font-bold leading-snug text-ink ${preview ? "line-clamp-3 text-[15px]" : "line-clamp-2 text-sm"}`;
  const stretched = "after:absolute after:inset-0 after:rounded-2xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-findmi";
  return (
    <article
      data-result-key={card.key}
      aria-current={selected ? "true" : undefined}
      className={`relative flex rounded-2xl border bg-white transition ${preview ? "gap-3.5 p-3 shadow-sm" : "gap-3 p-2.5"} ${selected ? "border-findmi shadow-[0_0_0_3px_rgba(20,176,188,0.18)]" : "border-black/5 hover:border-black/10"} ${linked ? "hover:border-findmi/60" : ""}`}
    >
      <div className={`relative shrink-0 overflow-hidden rounded-xl bg-black/5 ${preview ? "h-28 w-28" : "h-[4.5rem] w-[4.5rem]"}`}>
        {card.image ? (
          <SupabaseImage src={card.image} alt="" fill sizes={preview ? "112px" : "72px"} className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-findmi-700 to-ink">
            <span className="font-display text-xl font-bold text-white/30">{card.title.slice(0, 1)}</span>
          </div>
        )}
        {card.logo && card.image !== card.logo && (
          <div className={`absolute bottom-1 left-1 overflow-hidden rounded-md border border-black/[0.06] bg-white p-0.5 ${preview ? "h-7 w-7" : "h-6 w-6"}`}>
            <SupabaseImage src={card.logo} alt="" fill sizes="28px" className="object-contain" />
          </div>
        )}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col ${preview ? "gap-1" : "gap-0.5"}`}>
        {/* 1. When / state first: one line, never the same fact twice. */}
        <div className="flex min-w-0 items-center gap-1.5">
          {card.status.live || card.status.tone === "soon" || card.status.tone === "today" || (card.kind === "place" && card.status.text) ? (
            <StatusPill status={card.status} />
          ) : card.when ? (
            <span className="truncate text-[11px] font-bold text-ink/60">{card.when}</span>
          ) : null}
          {card.kind !== "event" && <span className="truncate text-[10px] font-bold uppercase tracking-wide text-ink/40">{KIND[card.kind]}</span>}
        </div>
        {linked ? (
          <Link href={card.href} aria-label={`${OPEN[card.kind]}: ${card.title}`} className={`min-w-0 ${stretched}`}>
            <span className={titleClass}>{card.title}</span>
          </Link>
        ) : (
          <button type="button" onClick={() => onSelect?.(card)} aria-pressed={false} className={`min-w-0 text-left ${stretched}`}>
            <span className={titleClass}>{card.title}</span>
          </button>
        )}
        {sub && <p className="truncate text-xs text-ink/55">{sub}</p>}
        {card.kind === "place" && card.brandCount > 0 && (
          <p className="truncate text-xs text-ink/55">
            {card.brandCount} {card.brandCount === 1 ? "Brand" : "Brands"} Here
          </p>
        )}
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
        {preview && card.place.href && card.kind !== "place" && (
          <div className="relative z-10 mt-1 flex items-center gap-2">
            <Link href={card.place.href} className="inline-flex min-h-9 items-center rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink/75 hover:border-black/20">
              Place
            </Link>
          </div>
        )}
      </div>
      {/* Save sits above the card link: tapping it never navigates. */}
      <div className="relative z-10 flex shrink-0 flex-col items-end">
        <Save card={card} />
      </div>
    </article>
  );
}
