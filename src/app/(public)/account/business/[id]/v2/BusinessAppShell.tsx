import Link from "next/link";
import type { ReactNode } from "react";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import { Chip } from "../../../owner-ui";

/** /account V2, Pass 1 — the Business app shell. One persistent Business
 * context (logo + name + switcher) and one navigation model:
 *   mobile  — a fixed bottom tab bar: Home · Presence · Products · Opportunities · More
 *   desktop — a left rail: the same five plus Performance
 * Every destination is still the existing `?tab=` view of
 * /account/business/[id] underneath (no route migration), so every
 * deep link, server action redirect and authorization path is unchanged. */

export type BusinessSection = "home" | "presence" | "products" | "opportunities" | "performance" | "more";

/** Existing tab key -> V2 section. Anything not promoted to primary
 * navigation (Profile, QR, Settings, Inquiries, Orders, Referral) lives
 * under More, so its section highlights there. */
export function sectionForTab(tab: string): BusinessSection {
  switch (tab) {
    case "overview":
      return "home";
    case "findmi-here":
      return "presence";
    case "products":
      return "products";
    case "opportunities":
      return "opportunities";
    case "performance":
      return "performance";
    default:
      return "more";
  }
}

type NavItem = { section: BusinessSection; label: string; tab: string; icon: ReactNode; desktopOnly?: boolean };

function navItems(): NavItem[] {
  return [
    { section: "home", label: "Home", tab: "overview", icon: <NavIcon name="home" className="h-[22px] w-[22px]" /> },
    { section: "presence", label: "Presence", tab: "findmi-here", icon: <NavIcon name="pin" className="h-[22px] w-[22px]" /> },
    { section: "products", label: "Products", tab: "products", icon: <NavIcon name="tag" className="h-[22px] w-[22px]" /> },
    { section: "opportunities", label: "Opportunities", tab: "opportunities", icon: <SparkGlyph className="h-[22px] w-[22px]" /> },
    {
      section: "performance",
      label: "Performance",
      tab: "performance",
      icon: <NavIcon name="target" className="h-[22px] w-[22px]" />,
      desktopOnly: true,
    },
    { section: "more", label: "More", tab: "more", icon: <MoreGlyph className="h-[22px] w-[22px]" /> },
  ];
}

export default function BusinessAppShell({
  basePath,
  business,
  pro,
  isExpiredPro,
  managedBusinesses,
  switcherTab,
  activeSection,
  isAdminElevated,
  children,
}: {
  basePath: string;
  business: { id: string; name: string; slug: string | null; logoUrl: string | null };
  pro: boolean;
  isExpiredPro: boolean;
  managedBusinesses: { id: string; name: string }[];
  switcherTab: string;
  activeSection: BusinessSection;
  isAdminElevated: boolean;
  children: ReactNode;
}) {
  const items = navItems();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 lg:pb-12 lg:pt-6">
      {isAdminElevated && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-1.5 text-metadata">
          <span className="truncate font-semibold text-amber-800">Admin mode · Managing {business.name}</span>
          <Link href={`/admin/businesses/${business.id}`} className="shrink-0 font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900">
            Exit
          </Link>
        </div>
      )}

      <BusinessContextBar
        business={business}
        pro={pro}
        isExpiredPro={isExpiredPro}
        managedBusinesses={managedBusinesses}
        switcherTab={switcherTab}
      />

      <div className="mt-5 lg:grid lg:grid-cols-[200px_1fr] lg:items-start lg:gap-10">
        {/* Desktop rail */}
        <nav aria-label="Business" className="hidden lg:sticky lg:top-[4.25rem] lg:flex lg:flex-col lg:gap-0.5">
          {items.map((item) => {
            const active = item.section === activeSection;
            return (
              <Link
                key={item.section}
                href={`${basePath}?tab=${item.tab}`}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-button font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
                  active ? "bg-findmi-50 text-accent" : "text-muted hover:bg-black/[0.03] hover:text-primary"
                }`}
              >
                <span className={active ? "text-findmi-700" : "text-ink/40"}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">{children}</div>
      </div>

      {/* Mobile bottom tab bar — thumb-reachable, five equal columns (never
          a scrolling strip), safe-area aware. */}
      <nav
        aria-label="Business"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.07] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {items
            .filter((i) => !i.desktopOnly)
            .map((item) => {
              const active = item.section === activeSection || (item.section === "more" && activeSection === "performance");
              return (
                <Link
                  key={item.section}
                  href={`${basePath}?tab=${item.tab}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 text-[10.5px] font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40 ${
                    active ? "text-accent" : "text-ink/45 hover:text-ink/70"
                  }`}
                >
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active ? "bg-findmi-50" : ""}`}>
                    {item.icon}
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              );
            })}
        </div>
      </nav>
    </div>
  );
}

function BusinessContextBar({
  business,
  pro,
  isExpiredPro,
  managedBusinesses,
  switcherTab,
}: {
  business: { id: string; name: string; slug: string | null; logoUrl: string | null };
  pro: boolean;
  isExpiredPro: boolean;
  managedBusinesses: { id: string; name: string }[];
  switcherTab: string;
}) {
  const others = managedBusinesses.filter((b) => b.id !== business.id);

  const identity = (
    <>
      {business.logoUrl ? (
        <SupabaseImage
          src={business.logoUrl}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-xl border border-black/[0.06] bg-white object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-findmi-50 font-display text-card-title font-bold text-accent">
          {business.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-section-title-lg font-bold text-primary">{business.name}</span>
          {others.length > 0 && <ChevronGlyph className="h-4 w-4 shrink-0 text-ink/40 transition-transform group-open:rotate-180" />}
        </span>
        <span className="mt-0.5 block">
          <Chip tone={pro ? "aqua" : isExpiredPro ? "amber" : "neutral"}>{pro ? "Pro" : isExpiredPro ? "Pro Expired" : "Free"}</Chip>
        </span>
      </span>
    </>
  );

  return (
    <div className="flex items-center justify-between gap-3">
      {others.length > 0 ? (
        <details className="group relative min-w-0 flex-1">
          <summary
            aria-label={`${business.name} — switch business`}
            className="flex cursor-pointer list-none items-center gap-3 rounded-xl py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 [&::-webkit-details-marker]:hidden"
          >
            {identity}
          </summary>
          <div className="absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-black/[0.07] bg-white p-1.5 shadow-lg">
            <p className="px-2.5 pb-1 pt-1.5 text-label font-bold uppercase text-subtle">Switch business</p>
            {managedBusinesses.map((b) => (
              <Link
                key={b.id}
                href={`/account/business/${b.id}?tab=${switcherTab}`}
                aria-current={b.id === business.id ? "page" : undefined}
                className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 text-body font-semibold transition hover:bg-black/[0.03] ${
                  b.id === business.id ? "text-accent" : "text-primary"
                }`}
              >
                <span className="truncate">{b.name}</span>
                {b.id === business.id && <CheckGlyph className="h-4 w-4 shrink-0" />}
              </Link>
            ))}
            <div className="mt-1 border-t border-black/[0.06] pt-1">
              <Link href="/account/business/new" className="block rounded-xl px-2.5 py-2.5 text-body font-semibold text-muted transition hover:bg-black/[0.03] hover:text-primary">
                + Add a business
              </Link>
            </div>
          </div>
        </details>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}

      {business.slug && (
        <Link
          href={`/business/${business.slug}`}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 text-metadata font-semibold text-secondary transition hover:border-black/20 hover:text-primary"
        >
          <EyeGlyph className="h-4 w-4" />
          <span className="hidden sm:inline">View public page</span>
          <span className="sm:hidden">View</span>
        </Link>
      )}
    </div>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Same 24px / 1.8-stroke family as NavIcon. */
export function SparkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 3.5l2.1 5.4 5.4 2.1-5.4 2.1L12 18.5l-2.1-5.4L4.5 11l5.4-2.1L12 3.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" fill="currentColor" />
    </svg>
  );
}

export function MoreGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
