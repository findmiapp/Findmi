"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import SupabaseImage from "@/components/SupabaseImage";
import SignOutConfirm from "@/components/SignOutConfirm";
import { signOut } from "@/app/(public)/account/profile/actions";
import type { AccountBusinessContext } from "@/lib/accountContext";

/** Global Account Context Switcher V1 — the ONE shared control for
 * moving between PERSONAL and any Business a signed-in person actually
 * manages (a real business_members row — see getAccountContexts). This
 * is account CONTEXT only: it never touches navigation-within-a-context,
 * Event/Location management (those aren't contexts), or authorization —
 * selecting a row is just a Link to that context's existing canonical
 * Home (`/account` or `/account/business/{id}`), nothing more.
 *
 * Mounted three places, each supplying its own trigger/identity markup
 * but sharing this exact menu: PersonalAppShell (replaces its old
 * "Businesses" link), BusinessAppShell (replaces its old Business-to-
 * Business <details> dropdown — `trigger` is its existing logo/name/plan
 * identity block), and EntityManagerContextBar (Event/Location Manager —
 * compact default trigger, since those pages have no existing identity
 * block of their own). Renders a mobile bottom sheet and a desktop
 * popover from the same `SwitcherMenu`, CSS-breakpoint-gated — no second
 * markup to keep in sync, no new modal framework. */
export type SwitcherCurrent = { kind: "personal" } | { kind: "business"; id: string };

const ROLE_LABEL: Record<AccountBusinessContext["role"], string> = { owner: "Owner", manager: "Manager", staff: "Staff" };

export default function AccountContextSwitcher({
  current,
  personalLabel,
  businesses,
  trigger,
  triggerClassName,
  currentBusinessSlug,
}: {
  current: SwitcherCurrent;
  personalLabel: string;
  businesses: AccountBusinessContext[];
  /** Custom trigger content (Business's logo+name+plan-chip identity).
   * Omit for the default compact "name · Personal/Business" pill (used
   * by Personal and both Entity Managers). This component always adds
   * its own chevron outside `trigger` — never part of it. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Business's own already-known slug, authoritative for whether "View
   * Public Profile" renders — passed explicitly rather than looked up
   * from `businesses` so it still works for an admin-elevated session
   * with no real business_members row of its own. Omit on Personal/
   * Entity Manager callers; this falls back to a `businesses` lookup. */
  currentBusinessSlug?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  const currentBusiness = current.kind === "business" ? businesses.find((b) => b.id === current.id) ?? null : null;
  const resolvedSlug = currentBusinessSlug !== undefined ? currentBusinessSlug : currentBusiness?.slug ?? null;
  const currentLabel = current.kind === "personal" ? personalLabel : currentBusiness?.name ?? "Business";
  const kindLabel = current.kind === "personal" ? "Personal" : "Business";

  function close() {
    setOpen(false);
  }

  const defaultTrigger = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-metadata font-semibold text-secondary">{currentLabel}</span>
      <span className="shrink-0 rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-bold uppercase text-subtle">{kindLabel}</span>
    </span>
  );

  return (
    <div ref={containerRef} className={`relative ${triggerClassName ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${currentLabel} — switch account context`}
        className={
          trigger
            ? "flex w-full min-w-0 items-center gap-2 rounded-xl py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
            : "flex h-10 w-fit shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 text-metadata font-semibold text-secondary transition hover:border-black/20 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
        }
      >
        {trigger ?? defaultTrigger}
        <ChevronGlyph className={`h-3.5 w-3.5 shrink-0 text-ink/40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {/* Mobile bottom sheet — same backdrop/rounded-sheet/drag-handle/
              Escape convention as PersonalAppShell's own MorePanel. */}
          <div className="fixed inset-0 z-[60] flex items-end justify-center lg:hidden" role="presentation">
            <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Switch account context"
              className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl"
            >
              <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10" />
              <SwitcherMenu
                current={current}
                personalLabel={personalLabel}
                businesses={businesses}
                resolvedSlug={resolvedSlug}
                onNavigate={close}
              />
            </div>
          </div>

          {/* Desktop popover — compact anchored panel, same shape/shadow
              language as the old BusinessContextBar <details> dropdown. */}
          <div
            role="menu"
            aria-label="Switch account context"
            className="absolute left-0 top-full z-50 mt-2 hidden w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-black/[0.07] bg-white p-1.5 shadow-lg lg:block"
          >
            <SwitcherMenu
              current={current}
              personalLabel={personalLabel}
              businesses={businesses}
              resolvedSlug={resolvedSlug}
              onNavigate={close}
            />
          </div>
        </>
      )}
    </div>
  );
}

function rowClass(active: boolean) {
  return `flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-black/[0.03] ${active ? "bg-findmi-50/60" : ""}`;
}

const utilityRowClass =
  "flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-body font-semibold text-primary transition hover:bg-black/[0.03]";

/** Shared menu body — identical in the mobile sheet and desktop popover.
 * IA (Section 8): SWITCH TO (Personal + each Business, then Add Business
 * grouped with them) → divider → context utilities (View Public Profile
 * when applicable, View Findmi) → divider → Sign Out. Never the whole
 * Business "More" menu — just these. */
function SwitcherMenu({
  current,
  personalLabel,
  businesses,
  resolvedSlug,
  onNavigate,
}: {
  current: SwitcherCurrent;
  personalLabel: string;
  businesses: AccountBusinessContext[];
  resolvedSlug: string | null;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2.5 pb-1 pt-1.5 text-label font-bold uppercase text-subtle">Switch To</p>

      <Link href="/account" onClick={onNavigate} className={rowClass(current.kind === "personal")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
          <NavIcon name="home" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-primary">{personalLabel}</span>
          <span className="block text-metadata text-subtle">Personal</span>
        </span>
        {current.kind === "personal" && <CheckGlyph className="h-4 w-4 shrink-0 text-findmi-700" />}
      </Link>

      {businesses.map((b) => {
        const isCurrent = current.kind === "business" && current.id === b.id;
        return (
          <Link key={b.id} href={`/account/business/${b.id}`} onClick={onNavigate} className={rowClass(isCurrent)}>
            {b.logoUrl ? (
              <SupabaseImage
                src={b.logoUrl}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 rounded-full border border-black/[0.06] bg-white object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi-50 font-display text-metadata font-bold text-findmi-700">
                {b.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-primary">{b.name}</span>
              <span className="block text-metadata text-subtle">Business · {ROLE_LABEL[b.role]}</span>
            </span>
            {isCurrent && <CheckGlyph className="h-4 w-4 shrink-0 text-findmi-700" />}
          </Link>
        );
      })}

      <Link href="/account/business/new" onClick={onNavigate} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-body font-semibold text-muted transition hover:bg-black/[0.03] hover:text-primary">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-metadata font-bold text-muted">+</span>
        Add Business
      </Link>

      <div className="my-1 border-t border-black/[0.06]" />

      {current.kind === "business" && resolvedSlug && (
        <Link href={`/business/${resolvedSlug}`} onClick={onNavigate} className={utilityRowClass}>
          <EyeGlyph className="h-4 w-4 shrink-0 text-ink/50" />
          View Public Profile
        </Link>
      )}

      <Link href="/" onClick={onNavigate} className={utilityRowClass}>
        <NavIcon name="compass" className="h-4 w-4 shrink-0 text-ink/50" />
        View Findmi
      </Link>

      <div className="my-1 border-t border-black/[0.06]" />

      <SignOutConfirm action={signOut} className={utilityRowClass}>
        Sign Out
      </SignOutConfirm>
    </div>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
