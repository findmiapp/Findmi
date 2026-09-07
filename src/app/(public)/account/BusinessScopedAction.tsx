"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

interface BusinessOption {
  id: string;
  name: string;
}

const PILL_BASE = "flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center transition";
const PILL_NORMAL = `${PILL_BASE} border border-black/10 bg-white hover:border-findmi/40 hover:bg-findmi-50`;
const PILL_EMPHASIZED = `${PILL_BASE} bg-findmi text-white hover:bg-findmi-600`;
const PILL_ICON_NORMAL = "flex h-9 w-9 items-center justify-center rounded-full bg-findmi-50 text-findmi-700";
const PILL_ICON_EMPHASIZED = "flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white";
const PILL_LABEL_NORMAL = "text-[11px] font-bold leading-tight text-ink/70";
const PILL_LABEL_EMPHASIZED = "text-[11px] font-bold leading-tight text-white";

/**
 * Owner Action UX pass — a Business-scoped create action (Schedule,
 * Product) must never silently target whichever business happens to be
 * first in the account's own list. Exactly one managed business → link
 * straight there. Multiple → reveal a compact "Which business?" chooser
 * naming every business the account actually manages, then link to the
 * SAME existing route/tab — this component only decides which
 * business_id goes in the URL; requireAuthorizedBusinessMember on that
 * Business Manager page remains the sole real authorization check, never
 * duplicated here. Zero businesses → the real prerequisite (Add
 * Business), never a faked destination.
 *
 * Findmi Here Clarity / Action Hierarchy passes — this routing decision
 * (zero/one/many) is the one thing that must never change across
 * callers or variants. `variant` only changes presentation: "pill" is
 * the compact action-strip tile (optionally `emphasize`d — a filled
 * aqua tile for the single most important action in the row), "card" is
 * the larger, visually distinct Findmi Here CTA, "link" is a compact
 * secondary action (e.g. Add a product elsewhere). Same three branches,
 * same hrefs, same chooser — never re-decided per variant.
 */
export default function BusinessScopedAction({
  label,
  icon,
  businesses,
  tab,
  variant = "pill",
  emphasize = false,
  eyebrow,
  headline,
  description,
  cta,
}: {
  label: string;
  icon: ReactNode;
  businesses: BusinessOption[];
  tab: string;
  variant?: "pill" | "card" | "link";
  emphasize?: boolean;
  eyebrow?: string;
  headline?: string;
  description?: string;
  cta?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const zeroHref = "/account/business/new";
  const oneHref = businesses.length === 1 ? `/account/business/${businesses[0].id}?tab=${tab}` : undefined;

  if (variant === "card") {
    const content = <CardContent icon={icon} eyebrow={eyebrow ?? label} headline={headline ?? label} description={description} cta={cta} />;
    if (businesses.length === 0) {
      return (
        <Link href={zeroHref} className="block">
          {content}
        </Link>
      );
    }
    if (businesses.length === 1) {
      return (
        <Link href={oneHref!} className="block">
          {content}
        </Link>
      );
    }
    return (
      <div ref={containerRef} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block w-full text-left">
          {content}
        </button>
        {open && <WhichBusinessPanel businesses={businesses} tab={tab} className="left-0 right-0" />}
      </div>
    );
  }

  if (variant === "link") {
    const linkClass = "inline-flex items-center gap-1.5 text-xs font-semibold text-ink/50 transition hover:text-findmi-700";
    if (businesses.length === 0) {
      return (
        <Link href={zeroHref} className={linkClass}>
          {icon}
          {label}
        </Link>
      );
    }
    if (businesses.length === 1) {
      return (
        <Link href={oneHref!} className={linkClass}>
          {icon}
          {label}
        </Link>
      );
    }
    return (
      <div ref={containerRef} className="relative inline-block">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={linkClass}>
          {icon}
          {label}
        </button>
        {open && <WhichBusinessPanel businesses={businesses} tab={tab} className="right-0 w-52" />}
      </div>
    );
  }

  // Default "pill" variant.
  if (businesses.length === 0) {
    return <ActionStripLink href={zeroHref} icon={icon} label={label} emphasize={emphasize} />;
  }
  if (businesses.length === 1) {
    return <ActionStripLink href={oneHref!} icon={icon} label={label} emphasize={emphasize} />;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={emphasize ? PILL_EMPHASIZED : PILL_NORMAL}
      >
        <span className={emphasize ? PILL_ICON_EMPHASIZED : PILL_ICON_NORMAL}>{icon}</span>
        <span className={emphasize ? PILL_LABEL_EMPHASIZED : PILL_LABEL_NORMAL}>{label}</span>
      </button>
      {open && <WhichBusinessPanel businesses={businesses} tab={tab} className="left-1/2 w-52 -translate-x-1/2" />}
    </div>
  );
}

/** Same compact vertical icon+label shape as the chooser button above, so
 * every action-strip item (plain-link or business-scoped) is visually
 * identical regardless of which behavior it has underneath. `emphasize`
 * gives one tile in the row (e.g. + Schedule) the filled-aqua treatment
 * that marks it as the primary action, per the brand rule that
 * aqua-filled elements use white icon/text — never a flood background
 * across the whole row. */
export function ActionStripLink({
  href,
  icon,
  label,
  emphasize = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  emphasize?: boolean;
}) {
  return (
    <Link href={href} className={emphasize ? PILL_EMPHASIZED : PILL_NORMAL}>
      <span className={emphasize ? PILL_ICON_EMPHASIZED : PILL_ICON_NORMAL}>{icon}</span>
      <span className={emphasize ? PILL_LABEL_EMPHASIZED : PILL_LABEL_NORMAL}>{label}</span>
    </Link>
  );
}

function WhichBusinessPanel({ businesses, tab, className }: { businesses: BusinessOption[]; tab: string; className?: string }) {
  return (
    <div className={`absolute top-full z-20 mt-2 rounded-2xl border border-black/10 bg-white p-2 shadow-lg ${className ?? ""}`}>
      <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/40">Which business?</p>
      <div className="flex flex-col">
        {businesses.map((b) => (
          <Link
            key={b.id}
            href={`/account/business/${b.id}?tab=${tab}`}
            className="truncate rounded-xl px-2 py-2 text-left text-sm font-semibold text-ink transition hover:bg-black/[0.03]"
          >
            {b.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Filled-aqua icon badge + eyebrow/headline/description/cta stack — the
 * Findmi Here card's content, reused across all three routing branches
 * above so the card looks and reads identically regardless of which one
 * fires. The filled badge (not a pale tint) plus the bold cta line are
 * what make the whole card read as tappable, not just informational. */
function CardContent({
  icon,
  eyebrow,
  headline,
  description,
  cta,
}: {
  icon: ReactNode;
  eyebrow: string;
  headline: string;
  description?: string;
  cta?: string;
}) {
  return (
    <div className="flex items-start gap-3 transition active:scale-[0.99]">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-findmi text-white shadow-sm">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">{eyebrow}</p>
        <p className="mt-0.5 text-sm font-bold text-ink">{headline}</p>
        {description && <p className="mt-0.5 text-xs text-ink/60">{description}</p>}
        {cta && <p className="mt-1.5 text-xs font-bold text-findmi-700">{cta}</p>}
      </div>
    </div>
  );
}

/** One-off "+" glyph, same 24x24/currentColor/rounded-stroke language as
 * NavIcon's curated set (see src/components/NavIcon.tsx) — not added to
 * that admin-configurable set since this is a fixed, code-only usage
 * (Schedule pill + Findmi Here card), same pattern as the custom
 * show/hide glyphs in PasswordField.tsx. No new dependency. */
export function PlusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
