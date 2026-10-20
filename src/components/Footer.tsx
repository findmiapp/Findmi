import Link from "next/link";
import Logo from "./Logo";
import { getSite } from "@/lib/site";

export default function Footer() {
  const { footer } = getSite();
  return (
    <footer className="mt-16 border-t border-black/5 bg-white pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 md:pb-10 md:pt-10">
      <div className="mx-auto max-w-6xl px-6">
        {/* Desktop: full footer. Mobile: the hamburger drawer is primary
            navigation (the fixed bottom nav was removed — live-QA fix
            pass, Part 9), so this stays to compact secondary links only.
            The extra bottom padding this footer used to reserve for that
            bar's height is gone too, down to just the safe-area inset. */}
        <div className="hidden md:flex md:flex-row md:items-start md:justify-between md:gap-8">
          <div>
            <Logo heightClassName="h-7" />
            <p className="mt-3 max-w-xs text-sm text-ink/55">
              {footer.tagline}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-8">
            {footer.columns.map((col) => (
              <div key={col.title}>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                  {col.title}
                </p>
                <ul className="mt-3 space-y-2 text-sm text-ink/65">
                  {col.links.map((l) => (
                    <li key={l.href}><Link href={l.href} className="hover:text-ink">{l.label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile: compact secondary links only — bottom nav handles primary. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink/55 md:hidden">
          {footer.mobileLinks.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink">{l.label}</Link>
          ))}
        </div>

        <p className="mt-6 text-xs text-ink/40 md:mt-10">
          © {new Date().getFullYear()} {footer.legalName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
