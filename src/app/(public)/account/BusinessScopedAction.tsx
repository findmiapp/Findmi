"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export interface BusinessOption {
  id: string;
  name: string;
}

/** Global Quick-Create pass — the exact zero/one/many routing decision
 * BusinessScopedAction itself makes below, pulled out so a second caller
 * (QuickCreateMenu) can reuse it without re-deciding it. Returns a real
 * href for zero (Add Business) or one (straight to that Business's tab);
 * null means "ambiguous" — the caller must render a chooser (see
 * WhichBusinessPanel) instead of navigating directly, same as this
 * component's own "many" branches do. */
export function resolveBusinessScopedHref(businesses: BusinessOption[], tab: string): string | null {
  if (businesses.length === 0) return "/account/business/new";
  if (businesses.length === 1) return `/account/business/${businesses[0].id}?tab=${tab}`;
  return null;
}

// Account Action Button Cleanup pass — the default ("pill") variant used
// to be a vertical icon-badge-over-label tile that, at a glance, read like
// one of the page's own rounded filter/nav pills (Events/Businesses/
// Products/Venues above it) rather than a button that DOES something.
// These are the account's CREATE/ADD actions, so they now render as
// compact, rectangular (modestly rounded, never capsule/rounded-full)
// buttons with a leading "+" — the same shape language as a real button,
// distinct from every passive navigation pill elsewhere on this page.
// This component is only ever used from account/page.tsx (verified —
// nothing public reuses it), so this change can't affect any consumer-
// facing filter pill.
// Account Create Strip Wrapping fix — `whitespace-nowrap` is the actual
// guarantee against a two-word label ("Findmi Here") breaking onto a
// second line inside the horizontally-scrolling strip; `shrink-0` alone
// only stops the BUTTON from flex-shrinking, it doesn't stop its own text
// from wrapping if anything upstream ever constrains its width. Preferred
// outcome is exactly what the live QA asked for: complete buttons plus a
// peek of the next one, never squeezed/wrapped text.
const ACTION_BUTTON_CLASS =
  "flex h-10 w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 bg-white px-3.5 text-xs font-bold text-ink transition hover:border-findmi/40 hover:bg-findmi-50 active:scale-[0.98]";

/** Small circular "+" badge used inside every create/add action button —
 * filled Findmi aqua, plus centered inside — distinct from the outer
 * button's own rectangular/modestly-rounded shape (never a pill). Kept
 * separate from PlusGlyph itself so the outer button markup stays plain
 * (`<CirclePlus /> {label}`) at every call site. */
function CirclePlus({ className }: { className?: string }) {
  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-findmi text-white ${className ?? ""}`}>
      <PlusGlyph className="h-2.5 w-2.5" />
    </span>
  );
}

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
 * the compact action-strip tile, "card" is the larger, visually distinct
 * Findmi Here CTA, "link" is a compact secondary action (e.g. Add a
 * product elsewhere), "full" is a full-width standalone button. Same
 * three branches, same hrefs, same chooser — never re-decided per
 * variant.
 *
 * Account Hub Live QA pass — the "Which business?" chooser renders via
 * `position: absolute`, which only works when no ancestor clips
 * overflow. The old emphasized "+ Schedule" pill lived first inside the
 * horizontally-scrolling "Create on Findmi" row (`overflow-x-auto`) —
 * per the CSS spec, setting overflow-x to anything but `visible` forces
 * overflow-y to compute as `auto` too, so that row silently clipped the
 * chooser panel below it (and, being the lead item in a swipeable
 * strip, was also prone to mobile Safari treating a tap as an aborted
 * scroll gesture). "+ Where I'll Be" now renders via this "full" variant
 * *outside* any scrolling container (see account/page.tsx) — same
 * component, same routing, just no clipping ancestor and a much larger
 * tap target.
 */
export default function BusinessScopedAction({
  label,
  icon,
  businesses,
  tab,
  variant = "pill",
  eyebrow,
  headline,
  description,
  cta,
}: {
  label: string;
  icon: ReactNode;
  businesses: BusinessOption[];
  tab: string;
  variant?: "pill" | "card" | "link" | "full";
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

  if (variant === "full") {
    // min-h (not a fixed h-12) + text-center — the CTA copy is long
    // enough on some accounts' locales that it can wrap to two lines on
    // narrow screens; a fixed height would clip or overlap it there.
    const fullClass =
      "flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-findmi px-4 py-3 text-center text-sm font-bold uppercase text-white transition hover:bg-findmi-600 active:scale-[0.99]";
    if (businesses.length === 0) {
      return (
        <Link href={zeroHref} className={fullClass}>
          {icon}
          {label}
        </Link>
      );
    }
    if (businesses.length === 1) {
      return (
        <Link href={oneHref!} className={fullClass}>
          {icon}
          {label}
        </Link>
      );
    }
    return (
      <div ref={containerRef} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={fullClass}>
          {icon}
          {label}
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
    return <ActionStripLink href={zeroHref} label={label} />;
  }
  if (businesses.length === 1) {
    return <ActionStripLink href={oneHref!} label={label} />;
  }

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={ACTION_BUTTON_CLASS}>
        <CirclePlus />
        {label}
      </button>
      {open && (
        <StripChooser anchorRef={containerRef} businesses={businesses} tab={tab} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

/** Compact rectangular create/add button — every action-strip item
 * (plain-link or business-scoped) shares this shape regardless of which
 * behavior it has underneath. `icon` is still accepted (other variants of
 * BusinessScopedAction use it) but intentionally not rendered here: every
 * create action gets the same leading "+", per this pass's own
 * requirement that only genuine create/add actions carry that prefix. */
export function ActionStripLink({ href, label }: { href: string; icon?: ReactNode; label: string }) {
  return (
    <Link href={href} className={ACTION_BUTTON_CLASS}>
      <CirclePlus />
      {label}
    </Link>
  );
}

function ChooserList({ businesses, tab, onSelect }: { businesses: BusinessOption[]; tab: string; onSelect?: () => void }) {
  return (
    <>
      <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/40">Which business?</p>
      <div className="flex flex-col">
        {businesses.map((b) => (
          <Link
            key={b.id}
            href={`/account/business/${b.id}?tab=${tab}`}
            onClick={onSelect}
            className="truncate rounded-xl px-2 py-2 text-left text-sm font-semibold text-ink transition hover:bg-black/[0.03]"
          >
            {b.name}
          </Link>
        ))}
      </div>
    </>
  );
}

export function WhichBusinessPanel({ businesses, tab, className }: { businesses: BusinessOption[]; tab: string; className?: string }) {
  return (
    <div className={`absolute top-full z-20 mt-2 rounded-2xl border border-black/10 bg-white p-2 shadow-lg ${className ?? ""}`}>
      <ChooserList businesses={businesses} tab={tab} />
    </div>
  );
}

/** Account Create-Strip Correction pass — the compact "pill" variant's
 * many-Business branch is the ONLY one of these four that renders inside
 * a horizontally-scrolling ancestor (the /account "Create on Findmi"
 * strip's `overflow-x-auto` row — see account/page.tsx). Per the CSS
 * overflow spec, `overflow-x: auto` with `overflow-y` otherwise `visible`
 * forces `overflow-y` to compute as `auto` too, so an ordinary
 * `position: absolute` descendant like WhichBusinessPanel gets silently
 * clipped by the row's own box the instant it extends below it — the
 * click still toggled `open` (nothing was actually broken in the click
 * handler itself), the chooser was just invisible. Portaling to
 * document.body with a `fixed` position computed from the trigger's real
 * screen position sidesteps that clipping entirely, the same reasoning
 * HamburgerMenu's own portal already uses for an ancestor whose overflow
 * can't be trusted. Repositions on scroll/resize since the strip itself
 * can be scrolled horizontally while this is open. `stopPropagation` on
 * mousedown keeps the outside-click listener (which checks DOM
 * containment against `anchorRef`, and a portaled node is never a DOM
 * descendant of it) from treating a click inside this panel as "outside"
 * and closing it out from under the very tap meant to select a Business. */
function StripChooser({
  anchorRef,
  businesses,
  tab,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  businesses: BusinessOption[];
  tab: string;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function updatePosition() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 8, left: rect.left });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", top: pos.top, left: pos.left }}
      className="z-50 w-52 rounded-2xl border border-black/10 bg-white p-2 shadow-lg"
    >
      <ChooserList businesses={businesses} tab={tab} onSelect={onClose} />
    </div>,
    document.body
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
 * (+ Where I'll Be button + Findmi Here card), same pattern as the
 * custom show/hide glyphs in PasswordField.tsx. No new dependency. */
export function PlusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
