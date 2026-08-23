import Link from "next/link";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-black/5 bg-white pb-[calc(6rem+env(safe-area-inset-bottom))] pt-8 md:pb-10 md:pt-10">
      <div className="mx-auto max-w-6xl px-6">
        {/* Desktop: full footer. Mobile: bottom nav is primary navigation,
            so this stays to compact secondary links only. */}
        <div className="hidden md:flex md:flex-row md:items-start md:justify-between md:gap-8">
          <div>
            <Logo heightClassName="h-7" />
            <p className="mt-3 max-w-xs text-sm text-ink/55">
              Find what you&rsquo;re looking for. And where it&rsquo;ll be next.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                Discover
              </p>
              <ul className="mt-3 space-y-2 text-sm text-ink/65">
                <li><Link href="/discover" className="hover:text-ink">Discover</Link></li>
                <li><Link href="/businesses" className="hover:text-ink">Businesses</Link></li>
                <li><Link href="/events" className="hover:text-ink">Events</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                Business
              </p>
              <ul className="mt-3 space-y-2 text-sm text-ink/65">
                <li><Link href="/join" className="hover:text-ink">Join FindMi</Link></li>
                <li><Link href="/about" className="hover:text-ink">About</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                Legal
              </p>
              <ul className="mt-3 space-y-2 text-sm text-ink/65">
                <li><Link href="/privacy" className="hover:text-ink">Privacy</Link></li>
                <li><Link href="/terms" className="hover:text-ink">Terms</Link></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Mobile: compact secondary links only — bottom nav handles primary. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink/55 md:hidden">
          <Link href="/about" className="hover:text-ink">About</Link>
          <Link href="/join" className="hover:text-ink">For Business</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
        </div>

        <p className="mt-6 text-xs text-ink/40 md:mt-10">
          © {new Date().getFullYear()} FindMi. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
