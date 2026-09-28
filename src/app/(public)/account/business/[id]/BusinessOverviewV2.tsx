import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import { formatDateShort, formatTime } from "@/lib/format";
import { Chip, StatusDot, secondaryButtonClass } from "../../owner-ui";
import QrCampaignCreator from "./QrCampaignCreator";
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
  business,
  pro,
  isExpiredPro,
  categoryLabel,
  geographyLabel,
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
  business: { name: string; slug: string | null; logoUrl: string | null; coverImageUrl: string | null; publicationStatus: string };
  pro: boolean;
  isExpiredPro: boolean;
  categoryLabel: string | null;
  geographyLabel: string | null;
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

  return (
    <div className="flex flex-col gap-5">
      {/* ── Business Identity ──────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
        <div className={`relative ${business.coverImageUrl ? "h-32 sm:h-40" : "h-20 sm:h-24"} bg-findmi-50`}>
          {business.coverImageUrl && (
            <>
              <SupabaseImage src={business.coverImageUrl} alt="" fill sizes="100vw" className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
            </>
          )}
          <div className="absolute right-3 top-3 flex items-center gap-2">
            {business.slug && (
              <Link
                href={`/business/${business.slug}`}
                className={`${secondaryButtonClass("sm")} ${business.coverImageUrl ? "border-white/40 bg-white/90 backdrop-blur" : ""}`}
              >
                View Public Profile →
              </Link>
            )}
            <Link
              href={`${basePath}?tab=settings`}
              aria-label="Business settings"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${
                business.coverImageUrl
                  ? "border-white/40 bg-white/90 text-ink/70 backdrop-blur hover:bg-white"
                  : "border-black/10 bg-white text-ink/50 hover:border-black/20"
              }`}
            >
              <GearGlyph className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className={`relative flex items-end gap-3 px-4 pb-4 ${business.coverImageUrl ? "-mt-8" : "pt-4"}`}>
          {business.logoUrl ? (
            <SupabaseImage
              src={business.logoUrl}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-xl border-2 border-white bg-white object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-white bg-findmi-50 font-display text-lg font-bold text-findmi-700 shadow-sm">
              {business.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1 pb-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate font-display text-lg font-bold tracking-tight text-ink">{business.name}</h2>
              <Chip tone={pro ? "aqua" : isExpiredPro ? "amber" : "neutral"}>
                {pro ? "Pro" : isExpiredPro ? "Pro Expired" : "Free"}
              </Chip>
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-ink/50">
              {[categoryLabel, geographyLabel].filter(Boolean).join(" · ") || "Add your category and area in Profile"}
            </p>
          </div>
        </div>

        {business.publicationStatus === "pending_review" && (
          <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2">
            <StatusDot tone="attention" label="Pending Review — visible to you now, live in discovery after Findmi reviews it." />
          </div>
        )}
      </div>

      {/* ── Performance Pulse ───────────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PulseTile label="Profile Views" metric={pulse.profileViews} pro={pro} />
          <PulseTile label="QR Scans" metric={pulse.qrScans} pro={pro} />
          <PulseTile label="Actions Taken" metric={pulse.actionsTaken} pro={pro} />
          <PulseTile label="Followers" metric={{ value: pulse.followers, changeLabel: null }} pro={pro} />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-ink/35">
            {pulseRangeLabel ?? "All time"}
            {pro ? " vs. previous period" : ""}
          </p>
          <Link href={`${basePath}?tab=performance`} className="text-[11px] font-bold text-findmi-700">
            {pro ? "Full analytics →" : "Unlock full analytics →"}
          </Link>
        </div>
      </div>

      {/* ── Discovery Summary — Pro only, omitted entirely for Free
          rather than shown locked/teased (cleaner, no manipulative
          upgrade language). ── */}
      {pro && discoverySources && discoverySources.length > 0 && (
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <p className="text-[13px] font-bold text-ink">How People Find You</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {discoverySources.slice(0, 4).map((s) => {
              const share = totalDiscoveryImpressions > 0 ? Math.round((s.impressions / totalDiscoveryImpressions) * 100) : 0;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium text-ink/75">{s.label}</span>
                    <span className="font-semibold text-ink/50">{share}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-black/[0.05]">
                    <div className="h-1.5 rounded-full bg-findmi" style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Upcoming Appearances ────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-bold text-ink">Upcoming Appearances</p>
          <div className="flex items-center gap-3">
            <Link href={`${basePath}?tab=findmi-here`} className="text-[11px] font-bold text-findmi-700">
              View All →
            </Link>
          </div>
        </div>
        {appearances.length > 0 ? (
          <div className="-mx-4 mt-2.5 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
            {appearances.slice(0, 6).map((a) => (
              <AppearanceCard key={a.id} appearance={a} />
            ))}
          </div>
        ) : (
          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-black/10 px-4 py-3">
            <p className="text-[12.5px] text-ink/45">Nothing scheduled yet.</p>
            <Link href={`${basePath}?tab=findmi-here`} className="shrink-0 text-[12px] font-bold text-findmi-700">
              + Add Where I&rsquo;ll Be
            </Link>
          </div>
        )}
      </div>

      {/* ── QR Campaigns ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-bold text-ink">QR Campaigns</p>
          <Link href={`${basePath}?tab=qr`} className="text-[11px] font-bold text-findmi-700">
            View All →
          </Link>
        </div>
        {qrCampaigns.length > 0 && (
          <div className="mt-2.5 flex flex-col divide-y divide-black/[0.05] rounded-2xl border border-black/[0.06] bg-white">
            {qrCampaigns.slice(0, 3).map((c) => (
              <Link
                key={c.id}
                href={`/account/qr/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-black/[0.015]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{c.name}</p>
                  <p className="truncate text-[11px] text-ink/45">
                    {c.destinationLabel}
                    {!c.isActive && <span className="ml-1.5 font-semibold text-ink/35">· Inactive</span>}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink/50">{c.scans.toLocaleString()} scans</span>
              </Link>
            ))}
          </div>
        )}
        <div className="mt-2.5">
          <QrCampaignCreator centralOptions={qrCentralOptions} />
        </div>
      </div>

      {/* ── Products ─────────────────────────────────────────────────── */}
      {productCount > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-bold text-ink">Products</p>
            <Link href={`${basePath}?tab=products`} className="text-[11px] font-bold text-findmi-700">
              View All →
            </Link>
          </div>
          <div className="-mx-4 mt-2.5 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
            {products.slice(0, 4).map((p) => (
              <Link
                key={p.id}
                href={`${basePath}?tab=products`}
                className="w-28 shrink-0 overflow-hidden rounded-2xl border border-black/[0.06] bg-white sm:w-auto"
              >
                <div className="relative h-28 w-full bg-black/[0.03]">
                  {p.imageUrl ? (
                    <SupabaseImage src={p.imageUrl} alt={p.name} fill sizes="160px" className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-ink/20">
                      <TagGlyph className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-[12px] font-semibold text-ink">{p.name}</p>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="text-[11.5px] text-ink/55">{p.priceLabel ?? ""}</span>
                    {!p.isActive && <Chip tone="neutral">Inactive</Chip>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Owner Attention + Recent Orders — conditional, never a
          giant empty module. ── */}
      {(needsAttention.length > 0 || recentOrders.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {needsAttention.length > 0 && (
            <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-ink">Needs Attention</p>
                <Chip tone="amber">{needsAttention.length}</Chip>
              </div>
              <ul className="mt-2.5 flex flex-col divide-y divide-black/[0.05]">
                {needsAttention.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <p className="min-w-0 text-[12.5px] text-ink/70">{item.message}</p>
                    <Link href={item.actionHref} className="shrink-0 text-[11px] font-bold text-findmi-700">
                      {item.actionLabel}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recentOrders.length > 0 && (
            <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-ink">Recent Orders</p>
                <Link href={`${basePath}?tab=orders`} className="text-[11px] font-bold text-findmi-700">
                  View All →
                </Link>
              </div>
              <ul className="mt-2.5 flex flex-col divide-y divide-black/[0.05]">
                {recentOrders.slice(0, 3).map((o) => (
                  <li key={o.orderId}>
                    <Link
                      href={`${basePath}?tab=orders&order=${o.orderId}`}
                      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-semibold text-ink">
                          #{o.orderNumber} <span className="font-normal text-ink/45">· {o.itemCount} item{o.itemCount === 1 ? "" : "s"}</span>
                        </p>
                        <p className="text-[11px] text-ink/45">{formatDateShort(o.createdAt)}</p>
                      </div>
                      <Chip tone={o.status === "new" ? "amber" : "neutral"}>{ORDER_STATUS_LABELS[o.status]}</Chip>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PulseTile({ label, metric, pro }: { label: string; metric: OverviewPulseMetric; pro: boolean }) {
  const showChange = pro && metric.changeLabel;
  const up = showChange && metric.changeLabel!.startsWith("+");
  const down = showChange && metric.changeLabel!.startsWith("-");
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-3">
      <p className="font-display text-xl font-bold leading-none tracking-tight text-ink tabular-nums sm:text-2xl">
        {metric.value.toLocaleString()}
      </p>
      <p className="mt-1.5 truncate text-[10.5px] font-semibold uppercase tracking-wide text-ink/40">{label}</p>
      {showChange && (
        <p className={`mt-0.5 text-[11px] font-bold ${up ? "text-findmi-700" : down ? "text-ink/45" : "text-ink/35"}`}>
          {up ? "↑ " : down ? "↓ " : ""}
          {metric.changeLabel}
        </p>
      )}
    </div>
  );
}

function AppearanceCard({ appearance }: { appearance: DashboardAppearance }) {
  const locationLine = appearance.geographyLabel ?? appearance.venueName ?? [appearance.city, appearance.state].filter(Boolean).join(", ");
  return (
    <Link
      href={appearance.managementHref}
      className="w-56 shrink-0 overflow-hidden rounded-2xl border border-black/[0.06] bg-white sm:w-auto"
    >
      <div className="relative h-28 w-full bg-black/[0.04]">
        {appearance.flyerImageUrl ? (
          <SupabaseImage src={appearance.flyerImageUrl} alt={appearance.title} fill sizes="240px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink/20">
            <CalendarGlyphLarge className="h-8 w-8" />
          </div>
        )}
        <DateBadge iso={appearance.startAt} live={appearance.temporal.live} />
      </div>
      <div className="p-2.5">
        <p className="truncate text-[12.5px] font-semibold text-ink">{appearance.title}</p>
        {locationLine && <p className="truncate text-[11px] text-ink/50">{locationLine}</p>}
        <p className="mt-0.5 truncate text-[11px] text-ink/45">
          {formatTime(appearance.startAt)}–{formatTime(appearance.endAt)}
        </p>
        <div className="mt-1.5">
          <Chip tone={appearance.participationStatus && appearance.participationStatus !== "approved" ? "amber" : "aquaSoft"}>
            {appearance.statusLabel}
          </Chip>
        </div>
      </div>
    </Link>
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
        <span className="text-[9px] font-extrabold uppercase tracking-wide">Now</span>
      </span>
    );
  }
  const d = new Date(iso);
  return (
    <span className="absolute left-2 top-2 flex flex-col items-center rounded-md bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur">
      <span className="text-[8px] font-bold uppercase leading-none tracking-wide text-ink/50">
        {d.toLocaleDateString("en-US", { month: "short" })}
      </span>
      <span className="font-display text-[13px] font-bold leading-none text-ink">{d.getDate()}</span>
    </span>
  );
}

function GearGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
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
