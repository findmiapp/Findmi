"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

interface BusinessOption {
  id: string;
  name: string;
}

/**
 * Owner Action UX pass — a Business-scoped create action (Findmi Here,
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
 * Findmi Here Clarity pass — this routing decision (zero/one/many) is
 * the one thing that must never change across callers. `variant` only
 * changes presentation: "pill" is the original compact action-strip
 * tile (Create on Findmi strip is Business/Event/Venue only now, but
 * other pill usages could still exist), "card" is the larger, visually
 * distinct Findmi Here CTA, "link" is the compact secondary Product
 * action. Same three branches, same hrefs, same chooser — never
 * re-decided per variant.
 */
export default function BusinessScopedAction({
  label,
  icon,
  businesses,
  tab,
  variant = "pill",
  eyebrow,
  headline,
  subtext,
}: {
  label: string;
  icon: ReactNode;
  businesses: BusinessOption[];
  tab: string;
  variant?: "pill" | "card" | "link";
  eyebrow?: string;
  headline?: string;
  subtext?: string;
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
    const content = <CardContent icon={icon} eyebrow={eyebrow ?? label} headline={headline ?? label} subtext={subtext} />;
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

  // Default "pill" variant — unchanged from the Owner Action UX pass.
  if (businesses.length === 0) {
    return <ActionStripLink href={zeroHref} icon={icon} label={label} />;
  }
  if (businesses.length === 1) {
    return <ActionStripLink href={oneHref!} icon={icon} label={label} />;
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-[76px] flex-col items-center gap-1.5 rounded-2xl border border-black/10 bg-white px-2 py-3 text-center transition hover:border-findmi/40 hover:bg-findmi-50"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">{icon}</span>
        <span className="text-[11px] font-bold leading-tight text-ink/70">{label}</span>
      </button>
      {open && <WhichBusinessPanel businesses={businesses} tab={tab} className="left-1/2 w-52 -translate-x-1/2" />}
    </div>
  );
}

/** Same compact vertical icon+label shape as the chooser button above, so
 * every action-strip item (plain-link or business-scoped) is visually
 * identical regardless of which behavior it has underneath. */
export function ActionStripLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-black/10 bg-white px-2 py-3 text-center transition hover:border-findmi/40 hover:bg-findmi-50"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">{icon}</span>
      <span className="text-[11px] font-bold leading-tight text-ink/70">{label}</span>
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

function CardContent({ icon, eyebrow, headline, subtext }: { icon: ReactNode; eyebrow: string; headline: string; subtext?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-findmi-700 shadow-sm">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">{eyebrow}</p>
        <p className="mt-0.5 text-sm font-bold text-ink">{headline}</p>
        {subtext && <p className="mt-0.5 text-xs text-ink/60">{subtext}</p>}
      </div>
    </div>
  );
}
