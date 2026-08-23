"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Discover = general browse hub (categories, events, businesses). Find =
// FindMi's own signature time-based discovery (Now/Today/Weekend/Anytime)
// — FindMi is built around time + place discovery, so this is the
// flagship feature, not a redundant duplicate of Discover, and stays.
// "Businesses" (not "Nearby") is the honest label for what /businesses
// actually is today — a searchable directory, not geolocation-driven
// proximity. No map yet (see MAP NEXT STEP), so no "Map" label either.
const links = [
  { href: "/discover", label: "Discover", icon: CompassIcon },
  { href: "/businesses", label: "Businesses", icon: PinIcon },
  { href: "/find", label: "Find", icon: TargetIcon },
  { href: "/saved", label: "Saved", icon: BookmarkIcon },
  { href: "/you", label: "You", icon: PersonIcon },
];

export default function NavMobile() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-paper/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-6xl items-stretch justify-between px-2 pb-[env(safe-area-inset-bottom)]">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          const Icon = link.icon;

          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition active:scale-95"
            >
              <Icon className={`h-5 w-5 ${active ? "text-findmi" : "text-ink/40"}`} />
              <span className={active ? "font-semibold text-findmi-700" : "text-ink/40"}>
                {link.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function CompassIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M15 9l-4.5 1.5L9 15l4.5-1.5L15 9z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function TargetIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M4.5 20c1.3-3.5 4.3-5.5 7.5-5.5s6.2 2 7.5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
