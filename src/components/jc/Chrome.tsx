"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { JC_BASE, jcHref } from "@/lib/jc/config";

const TABS = [
  { href: jcHref(), label: "Home", icon: "home" },
  { href: jcHref("/discover"), label: "Discover", icon: "search" },
  { href: jcHref("/events"), label: "Events", icon: "calendar" },
  { href: jcHref("/places"), label: "Places", icon: "pin" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === JC_BASE) return pathname === JC_BASE || pathname === "/";
  return pathname.startsWith(href) || pathname.startsWith(href.slice(JC_BASE.length));
}

function Icon({ name, className = "" }: { name: (typeof TABS)[number]["icon"]; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={`h-[22px] w-[22px] ${className}`} aria-hidden>
      {name === "home" && <path {...common} d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />}
      {name === "search" && (
        <>
          <circle {...common} cx="11" cy="11" r="6.5" />
          <path {...common} d="m16 16 4 4" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect {...common} x="4" y="5.5" width="16" height="14.5" rx="3" />
          <path {...common} d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        </>
      )}
      {name === "pin" && (
        <>
          <path {...common} d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
          <circle {...common} cx="12" cy="10" r="2.3" />
        </>
      )}
    </svg>
  );
}

export function JcHeader({ preview }: { preview: boolean }) {
  const pathname = usePathname() ?? "";
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:h-16 md:px-8">
        <Link href={jcHref()} className="flex items-baseline text-[17px] font-semibold tracking-[-0.03em]">
          Jersey City<span className="text-neutral-400">.guide</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-full px-3.5 py-1.5 text-[14px] font-medium ${isActive(pathname, t.href) ? "bg-neutral-100 text-neutral-950" : "text-neutral-500 hover:text-neutral-950"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 md:hidden">
          {preview && <PreviewBadge />}
          <Link href={jcHref("/discover")} aria-label="Search" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 active:bg-neutral-100">
            <Icon name="search" />
          </Link>
        </div>
        {preview && (
          <div className="hidden md:block">
            <PreviewBadge />
          </div>
        )}
      </div>
    </header>
  );
}

function PreviewBadge() {
  return (
    <span title="Development preview fixture — not real Production content" className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
      Preview data
    </span>
  );
}

export function JcTabBar() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto grid h-[58px] max-w-md grid-cols-4">
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${active ? "text-neutral-950" : "text-neutral-400"}`}>
              <Icon name={t.icon} className={active ? "stroke-[2.2]" : ""} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
