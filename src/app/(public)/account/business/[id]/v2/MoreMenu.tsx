import Link from "next/link";
import type { ReactNode } from "react";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";

/** /account V2, Pass 1 — "More": every secondary destination that no longer
 * competes for primary navigation, grouped by job. Only real, existing
 * destinations are listed (each is an existing ?tab= view or /account
 * route) — nothing here is new functionality. */

type MoreLink = { href: string; label: string; description?: string; icon: ReactNode };

export default function MoreMenu({
  basePath,
  businessSlug,
  ordersRelevant,
  showReferral,
}: {
  basePath: string;
  businessSlug: string | null;
  ordersRelevant: boolean;
  showReferral: boolean;
}) {
  const yourBusiness: MoreLink[] = [
    { href: `${basePath}?tab=profile`, label: "Business Profile", description: "Identity, photos, contact & links", icon: <NavIcon name="storefront" className="h-5 w-5" /> },
    { href: `${basePath}?tab=performance`, label: "Performance", description: "Views, actions and how people find you", icon: <NavIcon name="target" className="h-5 w-5" /> },
    ...(businessSlug
      ? [{ href: `/business/${businessSlug}`, label: "View Public Page", icon: <NavIcon name="compass" className="h-5 w-5" /> }]
      : []),
  ];
  const tools: MoreLink[] = [
    { href: `${basePath}?tab=qr`, label: "QR Campaigns", description: "Create and track QR codes", icon: <QrGlyph className="h-5 w-5" /> },
    { href: `${basePath}?tab=inquiries`, label: "Inquiry Settings", description: "How customers can contact you", icon: <ChatGlyph className="h-5 w-5" /> },
    ...(ordersRelevant
      ? [{ href: `${basePath}?tab=orders`, label: "Orders", description: "Marketplace orders to fulfill", icon: <NavIcon name="cart" className="h-5 w-5" /> }]
      : []),
    { href: "/account/messages", label: "Inbox", description: "Messages and opportunities", icon: <InboxGlyph className="h-5 w-5" /> },
  ];
  // Business Account Correction Pass (#12) — this group used to be one
  // "Account" bucket mixing Business-context destinations (Plan &
  // settings, Referral program) with genuinely personal ones, which read
  // as "which account am I even in?" Split by actual context instead:
  // Business-plan destinations stay with Tools/Your business; everything
  // under /account's shared personal shell (PersonalAppShell) — Personal
  // account, Saved, Following, Your purchases, Your profile & sign out —
  // moves to its own group. Schedule looks Business-ish by name, but its
  // own page (account/schedule/page.tsx) renders inside PersonalAppShell
  // and aggregates Business appearances + organized Events + managed
  // Locations together — it's the unified personal view, not a
  // Business-scoped one, so it belongs here too. No route/data change.
  const businessPlan: MoreLink[] = [
    { href: `${basePath}?tab=settings`, label: "Plan & Settings", description: "Findmi Pro, areas and business settings", icon: <GearGlyph className="h-5 w-5" /> },
    ...(showReferral ? [{ href: `${basePath}?tab=referral`, label: "Referral Program", icon: <NavIcon name="person" className="h-5 w-5" /> }] : []),
  ];
  const yourAccount: MoreLink[] = [
    { href: "/account/schedule", label: "Schedule", icon: <NavIcon name="calendar" className="h-5 w-5" /> },
    { href: "/account/saved", label: "Saved", icon: <NavIcon name="bookmark" className="h-5 w-5" /> },
    { href: "/account/following", label: "Following", icon: <NavIcon name="person" className="h-5 w-5" /> },
    { href: "/account/orders", label: "Your Purchases", icon: <NavIcon name="cart" className="h-5 w-5" /> },
    { href: "/account/profile", label: "Your Profile & Sign Out", icon: <NavIcon name="person" className="h-5 w-5" /> },
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="font-display text-page-title-lg font-bold text-primary">More</h1>
      <MoreGroup title="Your Business" links={yourBusiness} />
      <MoreGroup title="Tools" links={tools} />
      <MoreGroup title="Business Plan" links={businessPlan} />
      <MoreGroup title="Your Account" links={yourAccount} />
    </div>
  );
}

function MoreGroup({ title, links }: { title: string; links: MoreLink[] }) {
  return (
    <section aria-label={title}>
      <h2 className="px-1 text-label font-bold uppercase text-subtle">{title}</h2>
      <ul className="mt-2 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-black/[0.02] focus-visible:bg-black/[0.03] focus-visible:outline-none"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-ink/60">{l.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-card-title font-semibold text-primary">{l.label}</span>
                {l.description && <span className="block truncate text-metadata text-muted">{l.description}</span>}
              </span>
              <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/25" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QrGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5z" fill="currentColor" />
    </svg>
  );
}

function ChatGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4.5 6.5a2 2 0 012-2h11a2 2 0 012 2v8a2 2 0 01-2 2H10l-4.5 3.5v-3.5h0a2 2 0 01-1-1.7V6.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
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
