import Link from "next/link";
import type { ReactNode } from "react";
import NavIcon from "@/components/NavIcon";
import { QrGlyph } from "./CreateActionIcon";
import ChevronIcon from "@/components/ChevronIcon";
import SignOutConfirm from "@/components/SignOutConfirm";
import { signOut } from "@/app/(public)/account/profile/actions";
import { BUSINESS_MORE_TABS as T } from "./business-nav";
import { managerHref } from "@/lib/manager-links";
import { SparkGlyph } from "./BusinessAppShell";

/** More — the complete, predictable Business Manager directory, grouped by
 * job: MANAGE (what this Business shows and offers), WORK (communication and
 * things to handle), TOOLS, BUSINESS (plan), then the person's own account.
 * Every row is an existing destination of THIS Business (lib/manager-links),
 * so nothing here leaves the Business Manager except "Your Account". */

type MoreLink = {
  href: string;
  label: string;
  description?: string;
  icon: ReactNode;
  /** Hidden at lg+, where the desktop rail already lists this destination. */
  desktopHidden?: boolean;
};

export default function MoreMenu({
  businessId,
  businessSlug,
  ordersRelevant,
}: {
  businessId: string;
  businessSlug: string | null;
  ordersRelevant: boolean;
}) {
  const to = (d: Parameters<typeof managerHref>[1]) => managerHref(businessId, d);
  const manage: MoreLink[] = [
    { href: to("profile"), label: T.profile.label, description: T.profile.description, icon: <NavIcon name="storefront" className="h-5 w-5" /> },
    { href: to("gallery"), label: T.gallery.label, description: T.gallery.description, icon: <PhotosGlyph className="h-5 w-5" /> },
    { href: to("products"), label: T.products.label, description: T.products.description, icon: <NavIcon name="tag" className="h-5 w-5" />, desktopHidden: true },
    { href: to("schedule"), label: "Schedule", description: "Your upcoming appearances and Events", icon: <NavIcon name="calendar" className="h-5 w-5" /> },
    { href: to("find-us"), label: "Findmi Here", description: "Where customers can find you, and the places you track", icon: <NavIcon name="pin" className="h-5 w-5" /> },
    { href: to("growth"), label: T.growth.label, description: T.growth.description, icon: <SparkGlyph className="h-5 w-5" />, desktopHidden: true },
    ...(businessSlug ? [{ href: `/business/${businessSlug}`, label: "View Public Page", description: "Open your profile as visitors see it", icon: <NavIcon name="compass" className="h-5 w-5" /> }] : []),
  ];
  const work: MoreLink[] = [
    { href: to("inbox"), label: "Inbox", description: "Conversations with customers, Businesses, organizers and Findmi", icon: <InboxGlyph className="h-5 w-5" /> },
    { href: to("opportunities"), label: "Opportunities", description: "Commercial opportunities for your Business", icon: <SparkGlyph className="h-5 w-5" /> },
    ...(ordersRelevant ? [{ href: to("orders"), label: T.orders.label, description: T.orders.description, icon: <NavIcon name="cart" className="h-5 w-5" /> }] : []),
    { href: to("inquiry-settings"), label: T.inquiries.label, description: T.inquiries.description, icon: <ChatGlyph className="h-5 w-5" /> },
  ];
  const tools: MoreLink[] = [
    { href: to("qr"), label: T.qr.label, description: T.qr.description, icon: <QrGlyph className="h-5 w-5" /> },
    { href: to("search"), label: "Search", description: "Find anything in this Business", icon: <SearchGlyph className="h-5 w-5" /> },
    { href: to("map"), label: "Map", description: "Your places, Targets, Conversations and Opportunities on the map", icon: <NavIcon name="pin" className="h-5 w-5" /> },
  ];
  const business: MoreLink[] = [
    { href: to("settings"), label: T.settings.label, description: T.settings.description, icon: <GearGlyph className="h-5 w-5" /> },
  ];
  // Personal destinations (Saved, Following, Purchases, Profile & Sign Out)
  // live in the personal account shell — one clear entry, not five links.
  const yourAccount: MoreLink[] = [
    { href: "/account", label: "Your Account", description: "Saved, Following, Purchases, Profile & Sign Out", icon: <NavIcon name="person" className="h-5 w-5" /> },
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="font-display text-page-title-lg font-bold text-primary">More</h1>
      <MoreGroup title="Manage" links={manage} />
      <MoreGroup title="Work" links={work} />
      <MoreGroup title="Tools" links={tools} />
      <MoreGroup title="Business" links={business} />
      <MoreGroup title="Your Account" links={yourAccount} />
      {/* A direct Sign Out — the same confirm-then-signOut action every
          other sign-out trigger uses; no separate auth flow. */}
      <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
        <SignOutConfirm
          action={signOut}
          className="flex min-h-[56px] w-full items-center px-4 py-3 text-left text-card-title font-semibold text-subtle transition hover:bg-black/[0.02] hover:text-primary focus-visible:bg-black/[0.03] focus-visible:outline-none"
        >
          Sign Out
        </SignOutConfirm>
      </div>
    </div>
  );
}

function MoreGroup({ title, links }: { title: string; links: MoreLink[] }) {
  return (
    <section aria-label={title}>
      <h2 className="px-1 text-label font-bold uppercase text-subtle">{title}</h2>
      <ul className="mt-2 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
        {links.map((l) => (
          <li key={l.href} className={l.desktopHidden ? "lg:hidden" : undefined}>
            <Link
              href={l.href}
              className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-black/[0.02] focus-visible:bg-black/[0.03] focus-visible:outline-none"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-ink/60">{l.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-card-title font-semibold text-primary">{l.label}</span>
                {l.description && <span className="line-clamp-2 block text-metadata text-muted">{l.description}</span>}
              </span>
              <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/25" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChatGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4.5 6.5a2 2 0 012-2h11a2 2 0 012 2v8a2 2 0 01-2 2H10l-4.5 3.5v-3.5h0a2 2 0 01-1-1.7V6.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function PhotosGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 17l5-4.5 3.5 3 3-2.5L20 17" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function InboxGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 13l2.5-7.5h11L20 13v5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18v-5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function GearGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
