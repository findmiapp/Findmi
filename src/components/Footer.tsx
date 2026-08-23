import Link from "next/link";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-black/5 bg-white pb-24 pt-10 md:pb-10">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo heightClassName="h-7" />
            <p className="mt-3 max-w-xs text-sm text-ink/55">
              Find what you&rsquo;re looking for. And where it&rsquo;ll be next.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
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
                <li><Link href="/join" className="hover:text-ink">Join Findmi</Link></li>
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
        <p className="mt-10 text-xs text-ink/40">
          © {new Date().getFullYear()} Findmi. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
