import Link from "next/link";
import Logo from "./Logo";

/** Owner Command Center V4.1 — the authenticated Owner shell's ONLY
 * header, replacing AdminToolbar + MobileHeader + NavDesktop (the public
 * site's three-layer chrome) on every /account/* route (see SiteChrome,
 * which makes that swap). One compact bar at every width: Findmi
 * identity (Logo already links back to "/", covering "a way back to
 * public/discovery Findmi"), a quiet Discover link for the same reason
 * spelled out, and — only for a real founder/admin session — a compact
 * Admin entry point so Admin access never disappears, it just stops
 * permanently occupying Owner screen space. AccountNav (rendered by each
 * /account/* page itself) remains the actual Owner navigation mechanism
 * (Home/Schedule/Business/Inbox + More/Sign Out); this header does not
 * duplicate it. */
export default function OwnerHeader({ isAdmin }: { isAdmin: boolean }) {
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-black/5 bg-paper/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-6">
      <Logo heightClassName="h-8" />
      <div className="flex items-center gap-3">
        {isAdmin && (
          <Link
            href="/admin"
            className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Admin
          </Link>
        )}
        <Link href="/find" className="text-xs font-semibold text-ink/50 transition hover:text-ink">
          Discover
        </Link>
      </div>
    </header>
  );
}
