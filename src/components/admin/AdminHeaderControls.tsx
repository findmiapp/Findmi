"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import NavIcon from "@/components/NavIcon";

// Admin Header — Home + Back Controls pass. Both stay in the same tab —
// Home is a plain next/link Link (no target="_blank"), reusing the
// existing NavIcon "home" glyph (same icon set the public account nav
// already uses) rather than a new one-off SVG. Back is router.back(),
// same left-chevron SVG/aria-label="Back" convention MobileHeader.tsx
// already uses for the public site's own back control, just resized/
// recolored to match the admin header's compact, muted icon-button style
// instead of duplicating a new visual language.
//
// Back's fallback: window.history.length > 1 means this tab actually has
// somewhere to go back to; a fresh tab (e.g. opened directly to an admin
// URL) has length 1, where router.back() would just no-op, so that case
// falls back to /admin instead — a plain runtime check, not custom
// route-history infrastructure.
export default function AdminHeaderControls() {
  const router = useRouter();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
          } else {
            router.push("/admin");
          }
        }}
        aria-label="Back"
        title="Back"
        className="flex h-8 shrink-0 items-center gap-1 rounded-full px-1.5 text-ink/50 transition hover:bg-black/[0.04] hover:text-ink sm:px-2"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Icon-only on narrow mobile (task's explicit allowance) — the
            text label only shows once there's room, aria-label above
            still covers the icon-only case. */}
        <span className="hidden text-xs font-semibold sm:inline">Back</span>
      </button>
      <Link
        href="/"
        aria-label="Home"
        title="Home"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.04] hover:text-ink"
      >
        <NavIcon name="home" className="h-4 w-4" />
      </Link>
    </div>
  );
}
