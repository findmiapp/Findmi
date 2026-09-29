import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import { formatDateShort, formatTime } from "@/lib/format";
import { Chip } from "../../owner-ui";
import QrCampaignCreator from "./QrCampaignCreator";
import FindmiUrlCard from "@/components/FindmiUrlCard";
import type { DashboardAppearance, NeedsAttentionItem } from "@/lib/business-dashboard";
import type { BusinessOrderListItem } from "@/lib/business-orders";

// Business Overview V2 — the command-center recomposition of the
// per-business Overview tab (Business Overview V2 pass). Presentation
// only: every number/row here comes from data the caller (page.tsx)
// already resolved via already-locked, unmodified functions
// (getOwnerBusinessPerformance, resolveDashboardAppearances,
// getBusinessOrderList, buildNeedsAttentionItems, the QR Campaigns V1
// query already added to this page). This file introduces no new
// authorization, no new entitlement check, no new analytics definition,
// no new QR behavior, and no database writes — it only arranges already-
// resolved props. Deep management stays exactly where it already lives
// (?tab=findmi-here / ?tab=qr / ?tab=products / ?tab=performance /
// ?tab=orders); every "View All" link below points there, never a new
// destination.
//
// Visual Correction Pass — this is ONE cohesive brand surface, not a
// stack of individually bordered white cards. Only the Hero and the
// Performance+Discovery module are real bordered containers; everything
// else below them reads through typography, spacing, dividers and
// photography rather than a fifth/sixth/seventh white rounded box.

export interface OverviewPulseMetric {
  value: number;
  /** Pre-formatted comparison string ("+18%", "-7%", "New", "No change")
   * from the existing OwnerPerformanceMetric — never recomputed here.
   * Only ever passed (and only ever rendered) for a Pro business; a Free
   * business's tile shows `value` alone. */
  changeLabel: string | null;
}

export interface OverviewDiscoverySource {
  label: string;
  impressions: number;
}

export interface OverviewQrCampaign {
  id: string;
  name: string;
  destinationLabel: string;
  scans: number;
  isActive: boolean;
}

export interface OverviewProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  priceLabel: string | null;
  isActive: boolean;
}

const ORDER_STATUS_LABELS: Record<BusinessOrderListItem["status"], string> = {
  new: "New",
  confirmed: "Confirmed",
  ready: "Ready",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export default function BusinessOverviewV2({
  basePath,
  businessId,
  business,
  pro,
  isExpiredPro,
  categoryLabel,
  geographyLabel,
  businessHandle,
  updateHandleAction,
  managedBusinesses,
  switcherTab,
  pulse,
  pulseRangeLabel,
  discoverySources,
  appearances,
  qrCampaigns,
  qrCentralOptions,
  products,
  productCount,
  needsAttention,
  recentOrders,
}: {
  basePath: string;
  businessId: string;
  business: { name: string; slug: string | null; logoUrl: string | null; coverImageUrl: string | null; publicationStatus: string };
  pro: boolean;
  isExpiredPro: boolean;
  categoryLabel: string | null;
  geographyLabel: string | null;
  businessHandle: string | null;
  updateHandleAction: (formData: FormData) => void | Promise<void>;
  /** Owner Shell V3's persistent Business switcher — moved here (from the
   * page-level workspace band, suppressed on this tab) so Overview has
   * exactly ONE identity moment rather than two consecutive business
   * headers. Empty for a single-business owner or a pure admin-elevated
   * session, same as before. */
  managedBusinesses: { id: string; name: string }[];
  switcherTab: string;
  pulse: {
    profileViews: OverviewPulseMetric;
    qrScans: OverviewPulseMetric;
    actionsTaken: OverviewPulseMetric;
    followers: number;
  };
  /** The exact range label getOwnerBusinessPerformance already computed
   * ("Last 30 Days", etc.) — never re-derived here, so this always
   * matches what was actually queried. Same resolved range for both
   * tiers (defaults to 30 days) — Free/Pro differ in what's shown
   * alongside it (comparison, discovery breakdown), never the period
   * itself. */
  pulseRangeLabel: string | null;
  /** Pro-only — omitted (null) entirely for Free rather than shown locked. */
  discoverySources: OverviewDiscoverySource[] | null;
  appearances: DashboardAppearance[];
  qrCampaigns: OverviewQrCampaign[];
  qrCentralOptions: {
    businessId: string;
    businessName: string;
    appearances: { id: string; name: string }[];
    products: { id: string; name: string }[];
    events: { id: string; name: string }[];
    locations: { id: string; name: string }[];
  };
  products: OverviewProduct[];
  productCount: number;
  needsAttention: NeedsAttentionItem[];
  recentOrders: BusinessOrderListItem[];
}) {
  const totalDiscoveryImpressions = discoverySources?.reduce((sum, s) => sum + s.impressions, 0) ?? 0;
  const showSwitcher = managedBusinesses.length > 1;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Hero — the ONE business identity moment on this tab. Photo +
          identity in one block, actions integrated into a single attached
          footer strip below it (never floating over the image), the
          FindMi URL utility folded in here too instead of its own card. ── */}
      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
        {business.coverImageUrl ? (
          <div className="relative h-36 sm:h-44">
            <SupabaseImage src={business.coverImageUrl} alt="" fill sizes="100vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
              {business.logoUrl ? (
                <SupabaseImage
                  src={business.logoUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 shrink-0 rounded-xl border-2 border-white/80 bg-white object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-white/80 bg-white font-display text-card-title font-bold text-accent shadow-sm">
                  {business.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="truncate font-display text-section-title-lg font-bold text-white drop-shadow-sm">{business.name}</h2>
                  <Chip tone={pro ? "aqua" : isExpiredPro ? "amber" : "neutral"}>
                    {pro ? "Pro" : isExpiredPro ? "Pro Expired" : "Free"}
                  </Chip>
                  {showSwitcher && <BusinessSwitcher businessId={businessId} managedBusinesses={managedBusinesses} switcherTab={switcherTab} light />}
                </div>
                <p className="mt-0.5 truncate text-metadata text-white/80">
                  {[categoryLabel, geographyLabel].filter(Boolean).join(" · ") || "Add your category and area in Profile"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4">
            {business.logoUrl ? (
              <SupabaseImage
                src={business.logoUrl}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-xl border border-black/[0.06] object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-findmi-50 font-display text-card-title font-bold text-accent">
                {business.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="truncate font-display text-section-title-lg font-bold text-primary">{business.name}</h2>
                <Chip tone={pro ? "aqua" : isExpiredPro ? "amber" : "neutral"}>
                  {pro ? "Pro" : isExpiredPro ? "Pro Expired" : "Free"}
                </Chip>
                {showSwitcher && <BusinessSwitcher businessId={businessId} managedBusinesses={managedBusinesses} switcherTab={switcherTab} />}
              </div>
              <p className="mt-0.5 truncate text-metadata text-muted">
                {[categoryLabel, geographyLabel].filter(Boolean).join(" · ") || "Add your category and area in Profile"}
              </p>
            </div>
          </div>
        )}

        {business.publicationStatus === "pending_review" && (
          <div className="border-t border-amber-100 bg-amber-50 px-4 py-2">
            <p className="text-metadata font-semibold text-amber-900">
              Pending Review — visible to you now, live in discovery after Findmi reviews it.
            </p>
          </div>
        )}

        {/* Footer action strip — integrated, not floating over the photo. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-black/[0.06] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {business.slug && (
              <Link href={`/business/${business.slug}`} className="text-metadata font-bold text-accent">
                View Public Profile →
              </Link>
            )}
            <Link href={`${basePath}?tab=settings`} className="text-metadata font-semibold text-muted hover:text-primary">
              Settings
            </Link>
          </div>
          <div className="min-w-0">
            <FindmiUrlCard
              entityType="business"
              entityId={businessId}
              entityLabel={business.name}
              currentHandle={businessHandle}
              action={updateHandleAction}
              quiet
            />
          </div>
        </div>
      </div>

      {/* ── Performance — one dense strip, Discovery folded into the SAME
          module (a divider, not a second card). ── */}
      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
        <div className="grid grid-cols-4 divide-x divide-black/[0.06]">
          <PulseColumn label="Profile Views" metric={pulse.profileViews} pro={pro} />
          <PulseColumn label="QR Scans" metric={pulse.qrScans} pro={pro} />
          <PulseColumn label="Actions" metric={pulse.actionsTaken} pro={pro} />
          <PulseColumn label="Followers" metric={{ value: pulse.followers, changeLabel: null }} pro={pro} />
        </div>

        {pro && discoverySources && discoverySources.length > 0 && (
          <div className="border-t border-black/[0.06] px-4 py-3">
            <p className="text-label font-bold uppercase text-subtle">How People Find You</p>
            <div className="mt-2 flex flex-col gap-2">
              {discoverySources.slice(0, 4).map((s) => {
                const share = totalDiscoveryImpressions > 0 ? Math.round((s.impressions / totalDiscoveryImpressions) * 100) : 0;
                return (
                  <div key={s.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-metadata font-medium text-secondary">{s.label}</span>
                      <span className="shrink-0 text-microcopy font-semibold text-muted">{share}%</span>
                    </div>
                    <span className="h-1.5 rounded-full bg-black/[0.05]">
                      <span className="block h-1.5 rounded-full bg-findmi" style={{ width: `${share}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-black/[0.06] px-4 py-2">
          <p className="text-microcopy text-subtle">
            {pulseRangeLabel ?? "All time"}
            {pro ? " vs. previous period" : ""}
          </p>
          <Link href={`${basePath}?tab=performance`} className="text-microcopy font-bold text-accent">
            {pro ? "Full analytics →" : "Unlock full analytics →"}
          </Link>
        </div>
      </div>

      {/* ── Needs Attention — actionable problems come before passive
          inventory, so this sits directly below Performance. Light
          operational tint, no border/shadow. Renders nothing when empty. ── */}
      {needsAttention.length > 0 && (
        <div className="rounded-xl bg-black/[0.025] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-label font-bold uppercase text-subtle">Needs Attention</p>
            <Chip tone="amber">{needsAttention.length}</Chip>
          </div>
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.05]">
            {needsAttention.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
                <p className="min-w-0 text-metadata text-secondary">{item.message}</p>
                <Link href={item.actionHref} className="shrink-0 text-microcopy font-bold text-accent">
                  {item.actionLabel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Upcoming Appearances — a photographic rail when data exists;
          a single quiet line, never a large empty box, otherwise. ── */}
      <div>
        <SectionHeading title="Upcoming Appearances" href={`${basePath}?tab=findmi-here`} />
        {appearances.length > 0 ? (
          <div className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {appearances.slice(0, 6).map((a) => (
              <AppearanceCard key={a.id} appearance={a} />
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-metadata text-subtle">
            Nothing scheduled yet ·{" "}
            <Link href={`${basePath}?tab=findmi-here`} className="font-bold text-accent">
              + Add Where I&rsquo;ll Be
            </Link>
          </p>
        )}
      </div>

      {/* ── QR Campaigns — a compact, first-class operational list (icon
          chip + name + scans), not a bordered admin row, plus the always-
          available inline creator. ── */}
      <div>
        <SectionHeading title="QR Campaigns" href={`${basePath}?tab=qr`} />
        {qrCampaigns.length > 0 && (
          <div className="mt-1.5 flex flex-col divide-y divide-black/[0.05]">
            {qrCampaigns.slice(0, 3).map((c) => (
              <Link key={c.id} href={`/account/qr/${c.id}`} className="flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-findmi-50">
                  <QrGlyph className="h-4 w-4 text-findmi-700" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-card-title font-semibold text-primary">{c.name}</p>
                  <p className="truncate text-microcopy text-subtle">
                    {c.destinationLabel}
                    {!c.isActive && <span className="ml-1.5 font-semibold text-subtle">· Inactive</span>}
                  </p>
                </div>
                <span className="shrink-0 text-microcopy text-muted">
                  {c.scans.toLocaleString()} scan{c.scans === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </div>
        )}
        <div className="mt-2">
          <QrCampaignCreator centralOptions={qrCentralOptions} />
        </div>
      </div>

      {/* ── Products — a visual rail for products with imagery; a
          compact row (no reserved photo area) for products without one,
          so a single imageless product never leaves a tall dead area. ── */}
      {productCount > 0 && (
        <div>
          <SectionHeading title="Products" href={`${basePath}?tab=products`} />
          <div className="-mx-4 mt-2 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {products.slice(0, 4).map((p) =>
              p.imageUrl ? (
                <Link key={p.id} href={`${basePath}?tab=products`} className="w-28 shrink-0 overflow-hidden rounded-xl border border-black/[0.06]">
                  <div className="relative h-28 w-full bg-black/[0.03]">
                    <SupabaseImage src={p.imageUrl} alt={p.name} fill sizes="160px" className="object-cover" />
                  </div>
                  <div className="p-2">
                    <p className="truncate text-metadata font-semibold text-primary">{p.name}</p>
                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="text-microcopy text-muted">{p.priceLabel ?? ""}</span>
                      {!p.isActive && <span className="text-label font-semibold text-subtle">Inactive</span>}
                    </div>
                  </div>
                </Link>
              ) : (
                <Link
                  key={p.id}
                  href={`${basePath}?tab=products`}
                  className="flex w-40 shrink-0 items-center gap-2 rounded-xl border border-black/[0.06] px-2.5 py-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.03] text-ink/25">
                    <TagGlyph className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-metadata font-semibold text-primary">{p.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-microcopy text-muted">{p.priceLabel ?? ""}</span>
                      {!p.isActive && <span className="text-label font-semibold text-subtle">Inactive</span>}
                    </div>
                  </div>
                </Link>
              )
            )}
          </div>
        </div>
      )}

      {/* ── Recent Orders — after Products, last in the operational
          hierarchy. Light tint, conditional, never a giant empty module. ── */}
      {recentOrders.length > 0 && (
        <div className="rounded-xl bg-black/[0.025] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-label font-bold uppercase text-subtle">Recent Orders</p>
            <Link href={`${basePath}?tab=orders`} className="text-microcopy font-bold text-accent">
              View All →
            </Link>
          </div>
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.05]">
            {recentOrders.slice(0, 3).map((o) => (
              <li key={o.orderId}>
                <Link
                  href={`${basePath}?tab=orders&order=${o.orderId}`}
                  className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-metadata font-semibold text-primary">
                      #{o.orderNumber} <span className="font-normal text-subtle">· {o.itemCount} item{o.itemCount === 1 ? "" : "s"}</span>
                    </p>
                    <p className="text-microcopy text-subtle">{formatDateShort(o.createdAt)}</p>
                  </div>
                  <Chip tone={o.status === "new" ? "amber" : "neutral"}>{ORDER_STATUS_LABELS[o.status]}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SectionHeading({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-card-title font-bold text-primary">{title}</p>
      <Link href={href} className="text-microcopy font-bold text-accent">
        View All →
      </Link>
    </div>
  );
}

function PulseColumn({ label, metric, pro }: { label: string; metric: OverviewPulseMetric; pro: boolean }) {
  const showChange = pro && metric.changeLabel;
  const up = showChange && metric.changeLabel!.startsWith("+");
  const down = showChange && metric.changeLabel!.startsWith("-");
  return (
    <div className="min-w-0 px-1 py-3 text-center sm:px-3">
      <p className="font-display text-stat font-bold leading-none text-primary tabular-nums">
        {metric.value.toLocaleString()}
      </p>
      <p className="mt-1 text-label font-semibold uppercase leading-[1.15] text-subtle">
        {label}
      </p>
      {showChange && (
        <p className={`mt-0.5 truncate text-label font-bold ${up ? "text-accent" : "text-subtle"}`}>
          {up ? "↑" : down ? "↓" : ""}
          {metric.changeLabel}
        </p>
      )}
    </div>
  );
}

function AppearanceCard({ appearance }: { appearance: DashboardAppearance }) {
  const locationLine = appearance.geographyLabel ?? appearance.venueName ?? [appearance.city, appearance.state].filter(Boolean).join(", ");
  return (
    <Link href={appearance.managementHref} className="w-48 shrink-0 overflow-hidden rounded-xl border border-black/[0.06]">
      <div className="relative h-28 w-full bg-black/[0.04]">
        {appearance.flyerImageUrl ? (
          <SupabaseImage src={appearance.flyerImageUrl} alt={appearance.title} fill sizes="200px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink/20">
            <CalendarGlyphLarge className="h-8 w-8" />
          </div>
        )}
        <DateBadge iso={appearance.startAt} live={appearance.temporal.live} />
      </div>
      <div className="p-2">
        <p className="truncate text-metadata font-semibold text-primary">{appearance.title}</p>
        {locationLine && <p className="truncate text-microcopy text-muted">{locationLine}</p>}
        <p className="mt-0.5 flex items-center justify-between gap-1 text-microcopy text-subtle">
          <span className="truncate">
            {formatTime(appearance.startAt)}–{formatTime(appearance.endAt)}
          </span>
          <span
            className={`shrink-0 text-label font-bold ${
              appearance.participationStatus && appearance.participationStatus !== "approved" ? "text-amber-700" : "text-accent"
            }`}
          >
            {appearance.statusLabel}
          </span>
        </p>
      </div>
    </Link>
  );
}

/** Owner Shell V3's persistent Business switcher, moved from the page-
 * level workspace band into this hero (Visual Correction Pass) so a
 * multi-business owner keeps the same switch capability without Overview
 * showing two consecutive business headers. Same native <details>
 * disclosure, zero client JS, as the original. `light` renders it for
 * legibility against the cover-photo gradient. */
function BusinessSwitcher({
  businessId,
  managedBusinesses,
  switcherTab,
  light,
}: {
  businessId: string;
  managedBusinesses: { id: string; name: string }[];
  switcherTab: string;
  light?: boolean;
}) {
  return (
    <details className="group relative shrink-0">
      <summary
        aria-label="Switch business"
        className={`flex h-5 w-5 cursor-pointer list-none items-center justify-center rounded-full transition [&::-webkit-details-marker]:hidden ${
          light ? "text-white/70 hover:bg-white/15 hover:text-white" : "text-ink/35 hover:bg-black/[0.05] hover:text-ink"
        }`}
      >
        <ChevronGlyph className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-black/[0.07] bg-white p-1.5 text-left shadow-lg">
        <p className="px-2 py-1 text-label font-bold uppercase text-subtle">Switch Business</p>
        {managedBusinesses.map((b) => (
          <Link
            key={b.id}
            href={`/account/business/${b.id}?tab=${switcherTab}`}
            className={`block truncate rounded-lg px-2.5 py-2 text-body font-semibold transition hover:bg-black/[0.03] ${
              b.id === businessId ? "text-accent" : "text-primary"
            }`}
          >
            {b.name}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** Small, deliberate duplicate of page.tsx's own private ScheduleDateBadge
 * — kept local rather than importing from a route's page.tsx file (Next.js
 * App Router route files aren't meant to be import sources for other
 * modules), same "small deliberate duplicate" precedent already
 * established elsewhere in this codebase (e.g. lib/business-dashboard.ts's
 * own EVENT_PARTICIPATION_LABEL). */
function DateBadge({ iso, live }: { iso: string; live?: boolean }) {
  if (live) {
    return (
      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-findmi px-1.5 py-1 text-white shadow-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
        <span className="text-label font-bold uppercase">Now</span>
      </span>
    );
  }
  const d = new Date(iso);
  return (
    <span className="absolute left-2 top-2 flex flex-col items-center rounded-md bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur">
      <span className="text-label font-bold uppercase leading-none text-muted">
        {d.toLocaleDateString("en-US", { month: "short" })}
      </span>
      <span className="font-display text-card-title font-bold leading-none text-primary">{d.getDate()}</span>
    </span>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function QrGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 12h2.5M11 15.5h6M15.5 12h1.5v1.5M17 15.5v1.5h-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TagGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M11 4H6a2 2 0 00-2 2v5l9.5 9.5a2 2 0 002.8 0l5.2-5.2a2 2 0 000-2.8L12 4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="9" r="1.3" fill="currentColor" />
    </svg>
  );
}

function CalendarGlyphLarge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
