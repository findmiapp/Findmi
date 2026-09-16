import Link from "next/link";
import Logo from "./Logo";

/** Findmi Owner Product visual system (Sept 2026) — the authenticated
 * shell's one header. The 2px Aqua top strip is the product's own
 * signature (distinct from the public site's plain header, distinct
 * from Admin, present nowhere else) — a small, deliberate, load-bearing
 * brand device rather than a flood of color. Logo can't invert onto a
 * dark bar (its wordmark is solid near-black — see public/logo-
 * lockup.png), so the bar itself stays light/paper, tightened instead
 * of darkened for the "workspace" signal. */
export default function OwnerHeader({ isAdmin }: { isAdmin: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-paper/95 backdrop-blur">
      <div className="h-[3px] bg-findmi" />
      <div className="flex h-11 items-center justify-between px-3 pt-[env(safe-area-inset-top)] sm:px-6">
        <Logo heightClassName="h-7" />
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-md border border-black/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/55 transition hover:border-black/20 hover:text-ink"
            >
              Admin
            </Link>
          )}
          <Link href="/find" className="text-[12px] font-semibold text-ink/45 transition hover:text-ink">
            Discover
          </Link>
        </div>
      </div>
    </header>
  );
}
