"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

interface BusinessOption {
  id: string;
  name: string;
}

/**
 * Owner Action UX pass — a Business-scoped create action (+ Findmi Here,
 * + Product) must never silently target whichever business happens to
 * be first in the account's own list. Exactly one managed business →
 * link straight there (Case C, no unnecessary friction). Multiple →
 * reveal a compact "Which business?" chooser naming every business the
 * account actually manages, then link to the SAME existing route/tab
 * (Cases A/B) — this component only decides which business_id goes in
 * the URL; requireAuthorizedBusinessMember on that Business Manager page
 * remains the sole real authorization check, never duplicated here.
 * Zero businesses → the real prerequisite (Add Business), never a faked
 * destination.
 */
export default function BusinessScopedAction({
  label,
  icon,
  businesses,
  tab,
}: {
  label: string;
  icon: ReactNode;
  businesses: BusinessOption[];
  tab: string;
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

  if (businesses.length === 0) {
    return <ActionStripLink href="/account/business/new" icon={icon} label={label} />;
  }
  if (businesses.length === 1) {
    return <ActionStripLink href={`/account/business/${businesses[0].id}?tab=${tab}`} icon={icon} label={label} />;
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
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-2 w-52 -translate-x-1/2 rounded-2xl border border-black/10 bg-white p-2 shadow-lg">
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
      )}
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
