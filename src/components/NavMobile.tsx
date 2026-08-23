"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/discover", label: "Discover", icon: CompassIcon },
  { href: "/events", label: "Events", icon: CalendarIcon },
  { href: "/businesses", label: "Search", icon: SearchIcon },
  { href: "/join", label: "Join", icon: PlusIcon },
];

export default function NavMobile() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-6xl items-stretch justify-between px-2 pb-[env(safe-area-inset-bottom)]">
        {links.map((link) => {
          const active =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition active:scale-95"
            >
              <span
                className={`flex h-8 w-11 items-center justify-center rounded-full transition ${
                  active ? "bg-findmi-50" : ""
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "text-findmi-500" : "text-ink/40"}`} />
              </span>
              <span className={active ? "text-ink" : "text-ink/40"}>
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

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="3.5"
        y="5"
        width="17"
        height="15.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.5 9.5h17M8 3v3.5M16 3v3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M20 20l-4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 8v8M8 12h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
