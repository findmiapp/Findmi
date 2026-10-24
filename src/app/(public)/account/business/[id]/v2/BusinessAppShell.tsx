import Link from "next/link";
import type { ReactNode } from "react";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import AccountContextSwitcher from "@/components/account/AccountContextSwitcher";
import type { AccountBusinessContext } from "@/lib/accountContext";
import { Chip } from "../../../owner-ui";
import { BUSINESS_NAV, sectionForTab, type BusinessSection } from "./business-nav";
import { ManagerBottomBar, ManagerContentFrame, ManagerNavProvider, ManagerRail, type ManagerNavItem } from "./ManagerNav";
import { managerHref } from "@/lib/manager-links";

/** /account V2, Pass 1 — the Business app shell. One persistent Business
 * context (logo + name + switcher) and one navigation model:
 *   mobile  — a fixed bottom tab bar: Home · Findmi Here · Moments · Performance · More
 *   desktop — a left rail: the same plus Products and Growth
 * Every destination is still the existing `?tab=` view of
 * /account/business/[id] underneath (no route migration), so every
 * deep link, server action redirect and authorization path is unchanged. */

export type { BusinessSection };

// The tab -> section mapping is pure data in ./business-nav (the client
// navigation shares it); re-exported so existing imports keep working.
export { sectionForTab };


const NAV_ICONS: Record<BusinessSection, ReactNode> = {
  home: <NavIcon name="home" className="h-[22px] w-[22px]" />,
  presence: <NavIcon name="pin" className="h-[22px] w-[22px]" />,
  moments: <NavIcon name="moments" className="h-[22px] w-[22px]" />,
  products: <NavIcon name="tag" className="h-[22px] w-[22px]" />,
  growth: <SparkGlyph className="h-[22px] w-[22px]" />,
  performance: <InsightsGlyph className="h-[22px] w-[22px]" />,
  more: <MoreGlyph className="h-[22px] w-[22px]" />,
};

function navItems(): ManagerNavItem[] {
  return BUSINESS_NAV.map((n) => ({ ...n, icon: NAV_ICONS[n.section] }));
}

export default function BusinessAppShell({
  basePath,
  business,
  pro,
  isExpiredPro,
  personalLabel,
  managedBusinesses,
  activeSection,
  isAdminElevated,
  children,
}: {
  basePath: string;
  business: { id: string; name: string; slug: string | null; logoUrl: string | null };
  pro: boolean;
  isExpiredPro: boolean;
  /** Global Account Context Switcher V1 — the signed-in person's own
   * display label, for the switcher's "Switch To → Personal" row. Never
   * their email (see CLAUDE.md). */
  personalLabel: string;
  managedBusinesses: AccountBusinessContext[];
  /** Fixed highlight for a standalone sub-page. Omit it in the manager's own
   * layout: the client navigation derives it from the URL (and moves it the
   * instant a destination is tapped). */
  activeSection?: BusinessSection;
  isAdminElevated: boolean;
  children: ReactNode;
}) {
  const items = navItems();

  return (
    <ManagerNavProvider fixedSection={activeSection}>
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
          personalLabel={personalLabel}
          managedBusinesses={managedBusinesses}
        />

        <div className="mt-5 lg:grid lg:grid-cols-[200px_1fr] lg:items-start lg:gap-10">
          {/* Desktop rail */}
          <ManagerRail basePath={basePath} items={items} />

          <ManagerContentFrame>{children}</ManagerContentFrame>
        </div>

        {/* Mobile bottom tab bar — thumb-reachable, five equal columns. */}
        <ManagerBottomBar basePath={basePath} items={items} />
      </div>
    </ManagerNavProvider>
  );
}

function BusinessContextBar({
  business,
  pro,
  isExpiredPro,
  personalLabel,
  managedBusinesses,
}: {
  business: { id: string; name: string; slug: string | null; logoUrl: string | null };
  pro: boolean;
  isExpiredPro: boolean;
  personalLabel: string;
  managedBusinesses: AccountBusinessContext[];
}) {
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
        <span className="truncate font-display text-section-title-lg font-bold text-primary">{business.name}</span>
        <span className="mt-0.5 block">
          <Chip tone={pro ? "aqua" : isExpiredPro ? "amber" : "neutral"}>{pro ? "Pro" : isExpiredPro ? "Pro Expired" : "Free"}</Chip>
        </span>
      </span>
    </>
  );

  return (
    <div className="flex items-center justify-between gap-3">
      <AccountContextSwitcher
        current={{ kind: "business", id: business.id }}
        personalLabel={personalLabel}
        businesses={managedBusinesses}
        currentBusinessSlug={business.slug}
        trigger={identity}
        triggerClassName="min-w-0 flex-1"
      />
      {/* One tap from anywhere in this Manager: Search this Business, and its Inbox. */}
      <div className="flex shrink-0 items-center gap-1">
        <Link href={managerHref(business.id, "search")} aria-label={`Search ${business.name}`} title="Search" className="flex h-10 w-10 items-center justify-center rounded-full text-ink/60 transition hover:bg-black/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </Link>
        <Link href={managerHref(business.id, "inbox")} aria-label={`${business.name} Inbox`} title="Inbox" className="flex h-10 w-10 items-center justify-center rounded-full text-ink/60 transition hover:bg-black/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
            <path d="M4 13l2.5-7.5h11L20 13v5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18v-5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </div>
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

/** Performance / Insights — a rounded tile (the same rounded-square language
 * as the QR and More glyphs) holding three rising bars. Reads as an app's
 * "insights" tile rather than stock chart art, a radar or a flower. Same
 * 24px / 1.8-stroke family as NavIcon. */
export function InsightsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="7.3" y="12.2" width="2.4" height="4.3" rx="0.9" fill="currentColor" />
      <rect x="10.8" y="9.2" width="2.4" height="7.3" rx="0.9" fill="currentColor" />
      <rect x="14.3" y="6.9" width="2.4" height="9.6" rx="0.9" fill="currentColor" />
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
