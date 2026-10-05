"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "./NavIcon";
import { PlusGlyph, type BusinessOption } from "@/app/(public)/account/BusinessScopedAction";

/**
 * The global "+" — "What do you want to add to Findmi?" One menu, shared
 * by the mobile and desktop headers, routing into the canonical creation
 * flows (never duplicating them):
 *
 *   Add Moment      /my-world/journal/new   (Moments V2 cold composer)
 *   Add An Event    /account/event/new
 *   Add A Business  /account/business/new
 *   Add A Location  /account/location/new
 *
 * Signed-out visitors can open it and see what can be added; choosing an
 * action is still a plain Link to the real route. Every one of those
 * routes sits behind the existing middleware gate (/account/:path*,
 * /my-world/journal/:path*), which sends a signed-out visitor to
 * /login?next=<that exact route>; the login, signup and email-confirmation
 * flows all carry that same `next` (validated by getSafeRedirect) back to
 * the intended creation flow. One mechanism, no second redirect system.
 *
 * Deliberately NOT here: Findmi Here (a Business's real-world presence,
 * created from its own workspace — Host Something / Go Somewhere) and
 * Product (always created inside a specific Business; there's no general
 * Add Product flow).
 */
export default function QuickCreateMenu({
  authenticated,
}: {
  authenticated: boolean;
  /** Unused since the Business-scoped rows moved to the Business
   * workspace; kept so both headers' props stay unchanged. */
  businesses?: BusinessOption[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // This header persists across navigations, so a chosen action must
  // close the menu itself.
  function handleNavigate() {
    setOpen(false);
  }

  // Auth-flow pages already show their own sign-in/sign-up UI.
  if (pathname === "/login" || pathname.startsWith("/signup")) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Add to Findmi"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi text-white transition active:scale-90"
      >
        <PlusGlyph className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Add to Findmi"
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg"
        >
          <MenuLink
            href="/my-world/journal/new"
            label="Add Moment"
            description="Capture something you experienced."
            icon={<PencilGlyph className="h-4 w-4" />}
            onNavigate={handleNavigate}
          />
          <MenuLink
            href="/account/event/new"
            label="Add An Event"
            description="Share something that's happening."
            icon={<NavIcon name="calendar" className="h-4 w-4" />}
            onNavigate={handleNavigate}
          />
          <MenuLink
            href="/account/business/new"
            label="Add A Business"
            description="Bring a business onto Findmi."
            icon={<NavIcon name="storefront" className="h-4 w-4" />}
            onNavigate={handleNavigate}
          />
          <MenuLink
            href="/account/location/new"
            label="Add A Location"
            description="Add a place people can find."
            icon={<NavIcon name="pin" className="h-4 w-4" />}
            onNavigate={handleNavigate}
          />
          {!authenticated && <p className="px-3 pb-1.5 pt-2 text-xs text-ink/50">You&rsquo;ll sign in first, then pick up right here.</p>}
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  label,
  description,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} role="menuitem" onClick={onNavigate} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-black/[0.03]">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-xs text-ink/55">{description}</span>
      </span>
    </Link>
  );
}

// Same pencil silhouette every existing Add Moment entry point uses
// (NavDesktop, HamburgerMenu), redrawn locally per this codebase's
// per-file glyph convention.
function PencilGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M17 3a2.1 2.1 0 013 3L8.5 17.5 4 19l1.5-4.5L17 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
