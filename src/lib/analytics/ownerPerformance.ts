// Findmi Owner Performance V1 — the dedicated server-side query/
// aggregation layer for the owner-facing Performance tab
// (src/app/(public)/account/business/[id]/PerformanceTab.tsx). Turns the
// canonical analytics_events log (Phases 1/2A/2B) into a Business-scoped
// summary. No new instrumentation, no rollup tables — every number here
// is computed fresh from existing rows, same "authorize-then-elevate"
// shape as lib/business-orders.ts/lib/business-followers.ts: every export
// takes an already-service-role `admin` client and MUST only be called
// after the page's own requireBusinessMember(businessId) check.
//
// Business ecosystem scope: an analytics row counts toward this Business
// when it carries business_id = this Business OR belongs to one of this
// Business's own Products/Appearances (product_id/appearance_id
// membership) — see buildBusinessEcosystemFilter below. That widening
// exists because one real instrumentation gap was found while building
// this: a Product save/unsave (lib/useAccountSaved.ts's shared emit())
// only stamps product_id, not business_id, since that hook is shared
// across 4 saveable entity types with only one FK column each. Rather
// than touching that shared, working instrumentation (out of this pass's
// scope), the gap is closed here, at the query layer, by also treating
// this Business's own product/appearance ids as ecosystem membership.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsEventName } from "./taxonomy";

// Same fixed display timezone format.ts's own (private) APP_TIMEZONE
// uses, and the same zone-correct "YYYY-MM-DD" derivation as format.ts's
// own (private, unexported) dateKeyInZone — kept as a deliberate small
// duplicate rather than exporting something new out of a file this pass
// doesn't otherwise need to touch (same precedent as
// lib/business-dashboard.ts's own EVENT_PARTICIPATION_LABEL).
const OWNER_PERF_TIMEZONE = "America/New_York";

function dateKeyInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ── Date range ───────────────────────────────────────────────────────
export const OWNER_PERFORMANCE_RANGES = ["7", "30", "90", "all"] as const;
export type OwnerPerformanceRange = (typeof OWNER_PERFORMANCE_RANGES)[number];
export const DEFAULT_OWNER_PERFORMANCE_RANGE: OwnerPerformanceRange = "30";

export function isOwnerPerformanceRange(value: unknown): value is OwnerPerformanceRange {
  return typeof value === "string" && (OWNER_PERFORMANCE_RANGES as readonly string[]).includes(value);
}

const RANGE_LABELS: Record<OwnerPerformanceRange, string> = {
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "90": "Last 90 Days",
  all: "All Time",
};

interface RangeBounds {
  /** null only for "all" — no lower bound on the query at all. */
  currentStartIso: string | null;
  currentEndIso: string;
  previousStartIso: string | null;
  previousEndIso: string | null;
  hasPreviousPeriod: boolean;
  days: number | null;
}

function computeRangeBounds(range: OwnerPerformanceRange, now: Date): RangeBounds {
  const currentEndIso = now.toISOString();
  if (range === "all") {
    return { currentStartIso: null, currentEndIso, previousStartIso: null, previousEndIso: null, hasPreviousPeriod: false, days: null };
  }
  const days = Number(range);
  const currentStart = new Date(now.getTime() - days * 86_400_000);
  const previousStart = new Date(currentStart.getTime() - days * 86_400_000);
  return {
    currentStartIso: currentStart.toISOString(),
    currentEndIso,
    previousStartIso: previousStart.toISOString(),
    previousEndIso: currentStart.toISOString(),
    hasPreviousPeriod: true,
    days,
  };
}

// ── Meaningful "Actions Taken" — the ONE central definition (task's own
// "document the exact action set centrally" instruction). Deliberately
// excludes unsave/unfollow/filter_change/search/section or entity
// impressions/page views — those answer "did they see it," not "did they
// act on it." ─────────────────────────────────────────────────────────
export const OWNER_ACTION_EVENT_NAMES: readonly AnalyticsEventName[] = [
  "click_contact_channel",
  "click_directions",
  "click_rsvp",
  "click_tickets",
  "click_apply_to_vend",
  "click_contact_organizer",
  "product_external_click",
  "save",
  "follow",
  "share",
];
const ACTION_SET = new Set<string>(OWNER_ACTION_EVENT_NAMES);

// Secondary action grid (task section 8) — click_contact_channel is
// deliberately excluded here since it gets its own, more useful
// per-channel breakdown (section 9) instead of one lumped "Contact" tile.
const SECONDARY_ACTION_DEFS: { eventName: AnalyticsEventName; label: string }[] = [
  { eventName: "click_directions", label: "Directions" },
  { eventName: "save", label: "Saves" },
  { eventName: "follow", label: "Follows" },
  { eventName: "share", label: "Shares" },
  { eventName: "product_external_click", label: "Product Clicks" },
  { eventName: "click_rsvp", label: "RSVP" },
  { eventName: "click_tickets", label: "Tickets" },
  { eventName: "click_apply_to_vend", label: "Vendor Applications" },
  { eventName: "click_contact_organizer", label: "Organizer Contacts" },
];

const CONTACT_CHANNEL_LABELS: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

// page_type -> owner-friendly discovery-source label (task section 10/17
// — never expose the raw code). "business/event/location/product" cover
// the rarer case of an impression recorded on another entity's own detail
// page (e.g. a related item); "qr" is excluded entirely here since a
// qr_scan is never entity_impression/entity_click and gets its own
// section (13/14) instead.
const PAGE_TYPE_LABELS: Record<string, string> = {
  home: "Homepage",
  discover: "Discover",
  find: "Findmi Here",
  events: "Events",
  businesses: "Businesses",
  locations: "Locations",
  marketplace: "Marketplace",
  business: "Business Profile",
  event: "Event Page",
  location: "Location Page",
  product: "Product Page",
};

// ── Public shapes ────────────────────────────────────────────────────
export interface OwnerPerformanceMetric {
  value: number;
  /** null when this range has no previous-period comparison (All Time). */
  previousValue: number | null;
  /** "+18%", "-7%", "New", "No change", or null (All Time — no claim made). */
  changeLabel: string | null;
}

export interface OwnerPerformanceBreakdownItem {
  label: string;
  count: number;
}

export interface OwnerPerformanceChannelItem {
  channel: string;
  label: string;
  count: number;
}

export interface OwnerPerformanceDiscoverySource {
  label: string;
  impressions: number;
  clicks: number;
  /** 0..1, or null when there were zero impressions to divide by. */
  clickRate: number | null;
}

export interface OwnerPerformanceAppearance {
  id: string;
  title: string;
  eventName: string | null;
  startAt: string;
  location: string | null;
  impressions: number;
  clicks: number;
  directions: number;
  saves: number;
  qrScans: number;
}

export interface OwnerPerformanceProduct {
  id: string;
  name: string;
  impressions: number;
  views: number;
  cardClicks: number;
  externalClicks: number;
  saves: number;
}

export interface OwnerPerformanceQrCampaign {
  id: string;
  name: string;
  placement: string | null;
  scans: number;
  uniqueVisitors: number;
  actions: number;
}

export interface OwnerPerformanceTrendPoint {
  label: string;
  value: number;
}

export interface OwnerPerformanceData {
  range: OwnerPerformanceRange;
  rangeLabel: string;
  hasPreviousPeriod: boolean;
  previousRangeDays: number | null;
  isEmpty: boolean;
  headline: {
    impressions: OwnerPerformanceMetric;
    profileViews: OwnerPerformanceMetric;
    actionsTaken: OwnerPerformanceMetric;
  };
  secondaryActions: OwnerPerformanceBreakdownItem[];
  contactChannels: OwnerPerformanceChannelItem[];
  discoverySources: OwnerPerformanceDiscoverySource[];
  appearances: OwnerPerformanceAppearance[];
  products: OwnerPerformanceProduct[];
  qr: { totalScans: number; uniqueSessions: number; actionsFromQr: number } | null;
  qrCampaigns: OwnerPerformanceQrCampaign[];
  trend: { metricLabel: string; points: OwnerPerformanceTrendPoint[] };
}

// ── Row shapes read from analytics_events (only the columns each query
// actually needs — never select("*") against an events table). ────────
interface EcosystemRow {
  event_name: string;
  subject_type: string | null;
  business_id: string | null;
  appearance_id: string | null;
  product_id: string | null;
  discovery_section_id: string | null;
  page_type: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}
interface QrScanRow {
  qr_campaign_id: string | null;
  session_id: string;
  occurred_at: string;
}
interface QrActionRow {
  acquisition_qr_campaign_id: string | null;
  occurred_at: string;
}

function isCurrentPeriod(occurredAt: string, bounds: RangeBounds): boolean {
  return bounds.currentStartIso === null || occurredAt >= bounds.currentStartIso;
}
function isPreviousPeriod(occurredAt: string, bounds: RangeBounds): boolean {
  return (
    bounds.hasPreviousPeriod &&
    bounds.previousStartIso !== null &&
    bounds.previousEndIso !== null &&
    occurredAt >= bounds.previousStartIso &&
    occurredAt < bounds.previousEndIso
  );
}

function changeLabel(value: number, previous: number | null, days: number | null): string | null {
  if (previous === null || days === null) return null;
  if (previous === 0) return value === 0 ? "No change" : "New";
  const percent = Math.round(((value - previous) / previous) * 100);
  if (percent === 0) return "No change";
  return `${percent > 0 ? "+" : ""}${percent}% vs previous ${days} days`;
}

function metric(current: number, previous: number, bounds: RangeBounds): OwnerPerformanceMetric {
  return {
    value: current,
    previousValue: bounds.hasPreviousPeriod ? previous : null,
    changeLabel: bounds.hasPreviousPeriod ? changeLabel(current, previous, bounds.days) : null,
  };
}

/** Owner-facing trend granularity — daily for short ranges, coarser as the
 * window (or, for All Time, the actual observed span) grows, so a mobile
 * SVG sparkline never has to plot hundreds of points. */
function chooseTrendGranularity(range: OwnerPerformanceRange, spanDays: number): "day" | "week" | "month" {
  if (range === "90") return "week";
  if (range !== "all") return "day";
  if (spanDays <= 31) return "day";
  if (spanDays <= 180) return "week";
  return "month";
}

function bucketKey(iso: string, granularity: "day" | "week" | "month"): string {
  const day = dateKeyInZone(new Date(iso), OWNER_PERF_TIMEZONE); // "YYYY-MM-DD", zone-correct
  if (granularity === "month") return day.slice(0, 7);
  if (granularity === "day") return day;
  // Week bucket — Monday of that calendar week, computed from the
  // already zone-correct day key (noon UTC anchor avoids any further
  // zone shift while just doing calendar arithmetic on the same date).
  const d = new Date(`${day}T12:00:00Z`);
  const isoDow = (d.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  d.setUTCDate(d.getUTCDate() - isoDow);
  return d.toISOString().slice(0, 10);
}

function bucketLabel(key: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    return new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const short = new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return granularity === "week" ? `Week of ${short}` : short;
}

/** Every bucket key in [startIso, endIso], even ones with zero events —
 * a trend line with real gaps reads as broken, not as "no activity." */
function bucketRange(startIso: string, endIso: string, granularity: "day" | "week" | "month"): string[] {
  const keys: string[] = [];
  const stepMs = granularity === "day" ? 86_400_000 : granularity === "week" ? 7 * 86_400_000 : 30 * 86_400_000;
  let cursor = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  let guard = 0;
  const seen = new Set<string>();
  while (cursor <= end && guard < 400) {
    const key = bucketKey(new Date(cursor).toISOString(), granularity);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor += stepMs;
    guard++;
  }
  const endKey = bucketKey(endIso, granularity);
  if (!seen.has(endKey)) keys.push(endKey);
  return keys;
}

/**
 * The one Performance query/aggregation entry point. Call ONLY after the
 * caller has already run requireBusinessMember(businessId) — this
 * function does no authorization of its own, same convention as every
 * other lib/business-*.ts read helper.
 */
export async function getOwnerBusinessPerformance(
  admin: SupabaseClient,
  businessId: string,
  range: OwnerPerformanceRange
): Promise<OwnerPerformanceData> {
  const bounds = computeRangeBounds(range, new Date());

  // This Business's own Products/Appearances — needed both to widen the
  // ecosystem filter (see module doc comment) and to resolve readable
  // names for sections 12/15. One query each, never per-item.
  const [{ data: productRows }, { data: appearanceRows }, { data: campaignRows }] = await Promise.all([
    admin.from("products").select("id, name").eq("business_id", businessId),
    admin
      .from("appearances")
      .select("id, title, start_at, venue_name, city, state, event_id")
      .eq("business_id", businessId),
    admin
      .from("qr_campaigns")
      .select("id, name, placement, appearance_id")
      .eq("business_id", businessId),
  ]);

  const products = (productRows ?? []) as { id: string; name: string }[];
  const appearancesBase = (appearanceRows ?? []) as {
    id: string;
    title: string;
    start_at: string;
    venue_name: string | null;
    city: string | null;
    state: string | null;
    event_id: string | null;
  }[];
  const campaigns = (campaignRows ?? []) as { id: string; name: string; placement: string | null; appearance_id: string | null }[];
  // Appearance id -> the set of this Business's own campaign ids
  // configured against that specific Appearance, for the per-Appearance
  // "QR scans" figure below.
  const campaignIdsByAppearanceId = new Map<string, string[]>();
  for (const c of campaigns) {
    if (!c.appearance_id) continue;
    const list = campaignIdsByAppearanceId.get(c.appearance_id) ?? [];
    list.push(c.id);
    campaignIdsByAppearanceId.set(c.appearance_id, list);
  }

  const productIds = products.map((p) => p.id);
  const appearanceIds = appearancesBase.map((a) => a.id);
  const campaignIds = campaigns.map((c) => c.id);

  const eventIdsToResolve = Array.from(new Set(appearancesBase.map((a) => a.event_id).filter((v): v is string => Boolean(v))));
  const eventNameById = new Map<string, string>();
  if (eventIdsToResolve.length > 0) {
    const { data: eventRows } = await admin.from("events").select("id, name").in("id", eventIdsToResolve);
    for (const row of (eventRows ?? []) as { id: string; name: string }[]) eventNameById.set(row.id, row.name);
  }

  // Main ecosystem query — business_id.eq is always present; product_id/
  // appearance_id membership only added when this Business actually has
  // any (an empty `.in.()` clause is invalid PostgREST syntax).
  const orParts = [`business_id.eq.${businessId}`];
  if (productIds.length > 0) orParts.push(`product_id.in.(${productIds.join(",")})`);
  if (appearanceIds.length > 0) orParts.push(`appearance_id.in.(${appearanceIds.join(",")})`);

  let ecosystemQuery = admin
    .from("analytics_events")
    .select("event_name, subject_type, business_id, appearance_id, product_id, discovery_section_id, page_type, metadata, occurred_at")
    .or(orParts.join(","));
  if (bounds.currentStartIso !== null) {
    // Non-"all" ranges: fetch from the START of the PREVIOUS period so one
    // query covers both periods' comparison — never two round trips.
    ecosystemQuery = ecosystemQuery.gte("occurred_at", bounds.previousStartIso ?? bounds.currentStartIso);
  }
  const { data: ecosystemRows } = await ecosystemQuery;
  const rows = (ecosystemRows ?? []) as EcosystemRow[];

  // QR reads are scoped by CAMPAIGN OWNERSHIP (qr_campaigns.business_id),
  // not by the ecosystem OR-filter above — a scan/downstream action
  // belongs to this Business's QR reporting because the campaign is
  // this Business's own, regardless of what the scan row's own business_id/
  // appearance_id happen to be.
  let scanRows: QrScanRow[] = [];
  let qrActionRows: QrActionRow[] = [];
  if (campaignIds.length > 0) {
    let scanQuery = admin
      .from("analytics_events")
      .select("qr_campaign_id, session_id, occurred_at")
      .eq("event_name", "qr_scan")
      .in("qr_campaign_id", campaignIds);
    let actionQuery = admin
      .from("analytics_events")
      .select("acquisition_qr_campaign_id, occurred_at")
      .eq("acquisition_source", "qr")
      .in("acquisition_qr_campaign_id", campaignIds)
      .in("event_name", [...OWNER_ACTION_EVENT_NAMES]);
    if (bounds.currentStartIso !== null) {
      const lower = bounds.previousStartIso ?? bounds.currentStartIso;
      scanQuery = scanQuery.gte("occurred_at", lower);
      actionQuery = actionQuery.gte("occurred_at", lower);
    }
    const [scanResult, actionResult] = await Promise.all([scanQuery, actionQuery]);
    scanRows = (scanResult.data ?? []) as QrScanRow[];
    qrActionRows = (actionResult.data ?? []) as QrActionRow[];
  }

  // Discovery-section titles (task section 10 — never show a raw id).
  const sectionIds = Array.from(new Set(rows.map((r) => r.discovery_section_id).filter((v): v is string => Boolean(v))));
  const sectionTitleById = new Map<string, string>();
  if (sectionIds.length > 0) {
    const { data: sectionRows } = await admin.from("homepage_rows").select("id, title").in("id", sectionIds);
    for (const row of (sectionRows ?? []) as { id: string; title: string }[]) sectionTitleById.set(row.id, row.title);
  }

  const currentRows = rows.filter((r) => isCurrentPeriod(r.occurred_at, bounds));
  const previousRows = rows.filter((r) => isPreviousPeriod(r.occurred_at, bounds));
  const currentScanRows = scanRows.filter((r) => isCurrentPeriod(r.occurred_at, bounds));
  const previousScanRows = scanRows.filter((r) => isPreviousPeriod(r.occurred_at, bounds));
  const currentQrActionRows = qrActionRows.filter((r) => isCurrentPeriod(r.occurred_at, bounds));

  const count = (list: EcosystemRow[], pred: (r: EcosystemRow) => boolean) => list.reduce((n, r) => n + (pred(r) ? 1 : 0), 0);

  // ── Headline ──
  const impressionsNow = count(currentRows, (r) => r.event_name === "entity_impression" && r.subject_type === "business");
  const impressionsPrev = count(previousRows, (r) => r.event_name === "entity_impression" && r.subject_type === "business");
  const profileViewsNow = count(currentRows, (r) => r.event_name === "page_view" && r.subject_type === "business");
  const profileViewsPrev = count(previousRows, (r) => r.event_name === "page_view" && r.subject_type === "business");
  const actionsNow = count(currentRows, (r) => ACTION_SET.has(r.event_name));
  const actionsPrev = count(previousRows, (r) => ACTION_SET.has(r.event_name));

  // ── Secondary actions ──
  const secondaryActions: OwnerPerformanceBreakdownItem[] = SECONDARY_ACTION_DEFS.map((def) => ({
    label: def.label,
    count: count(currentRows, (r) => r.event_name === def.eventName),
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  // ── Contact channel breakdown ──
  const channelCounts = new Map<string, number>();
  for (const r of currentRows) {
    if (r.event_name !== "click_contact_channel") continue;
    const channel = typeof r.metadata?.channel === "string" ? r.metadata.channel : "other";
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
  }
  const contactChannels: OwnerPerformanceChannelItem[] = Array.from(channelCounts.entries())
    .map(([channel, cnt]) => ({ channel, label: CONTACT_CHANNEL_LABELS[channel] ?? "Other", count: cnt }))
    .sort((a, b) => b.count - a.count);

  // ── Discovery sources ──
  const sourceStats = new Map<string, { impressions: number; clicks: number }>();
  for (const r of currentRows) {
    if (r.event_name !== "entity_impression" && r.event_name !== "entity_click") continue;
    const label = r.discovery_section_id
      ? (sectionTitleById.get(r.discovery_section_id) ?? "Findmi Discovery Section")
      : (PAGE_TYPE_LABELS[r.page_type ?? ""] ?? "Other");
    const entry = sourceStats.get(label) ?? { impressions: 0, clicks: 0 };
    if (r.event_name === "entity_impression") entry.impressions++;
    else entry.clicks++;
    sourceStats.set(label, entry);
  }
  const discoverySources: OwnerPerformanceDiscoverySource[] = Array.from(sourceStats.entries())
    .map(([label, s]) => ({ label, impressions: s.impressions, clicks: s.clicks, clickRate: s.impressions > 0 ? s.clicks / s.impressions : null }))
    .sort((a, b) => b.impressions - a.impressions);

  // ── Appearance performance (section 12) — first-class, never collapsed
  // into Event reporting. ──
  const appearances: OwnerPerformanceAppearance[] = appearancesBase
    .map((a) => {
      const impressions = count(currentRows, (r) => r.event_name === "entity_impression" && r.appearance_id === a.id);
      const clicks = count(currentRows, (r) => r.event_name === "entity_click" && r.appearance_id === a.id);
      const directions = count(currentRows, (r) => r.event_name === "click_directions" && r.appearance_id === a.id);
      const saves = count(currentRows, (r) => r.event_name === "save" && r.appearance_id === a.id);
      const appearanceCampaignIds = campaignIdsByAppearanceId.get(a.id) ?? [];
      const qrScans = currentScanRows.filter((r) => r.qr_campaign_id !== null && appearanceCampaignIds.includes(r.qr_campaign_id)).length;
      return {
        id: a.id,
        title: a.title,
        eventName: a.event_id ? (eventNameById.get(a.event_id) ?? null) : null,
        startAt: a.start_at,
        location: [a.venue_name, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
        impressions,
        clicks,
        directions,
        saves,
        qrScans,
      };
    })
    .filter((a) => a.impressions + a.clicks + a.directions + a.saves + a.qrScans > 0)
    .sort((a, b) => b.clicks + b.directions + b.saves + b.qrScans - (a.clicks + a.directions + a.saves + a.qrScans) || b.impressions - a.impressions)
    .slice(0, 10);

  // ── Product interest (section 15) ──
  const productPerf: OwnerPerformanceProduct[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      impressions: count(currentRows, (r) => r.event_name === "entity_impression" && r.product_id === p.id),
      views: count(currentRows, (r) => r.event_name === "page_view" && r.subject_type === "product" && r.product_id === p.id),
      cardClicks: count(currentRows, (r) => r.event_name === "entity_click" && r.product_id === p.id),
      externalClicks: count(currentRows, (r) => r.event_name === "product_external_click" && r.product_id === p.id),
      saves: count(currentRows, (r) => r.event_name === "save" && r.product_id === p.id),
    }))
    .filter((p) => p.impressions + p.views + p.cardClicks + p.externalClicks + p.saves > 0)
    .sort(
      (a, b) =>
        b.cardClicks + b.externalClicks + b.saves + b.views - (a.cardClicks + a.externalClicks + a.saves + a.views) || b.impressions - a.impressions
    )
    .slice(0, 10);

  // ── QR (sections 13/14) ──
  const qr =
    campaignIds.length > 0
      ? {
          totalScans: currentScanRows.length,
          uniqueSessions: new Set(currentScanRows.map((r) => r.session_id)).size,
          actionsFromQr: currentQrActionRows.length,
        }
      : null;
  const qrCampaigns: OwnerPerformanceQrCampaign[] = campaigns.map((c) => {
    const campaignScans = currentScanRows.filter((r) => r.qr_campaign_id === c.id);
    return {
      id: c.id,
      name: c.name,
      placement: c.placement,
      scans: campaignScans.length,
      uniqueVisitors: new Set(campaignScans.map((r) => r.session_id)).size,
      actions: currentQrActionRows.filter((r) => r.acquisition_qr_campaign_id === c.id).length,
    };
  });

  // ── Trend — Profile Views over time (section 16) ──
  const trendStart = bounds.currentStartIso ?? currentRows.reduce<string | null>((min, r) => (min === null || r.occurred_at < min ? r.occurred_at : min), null) ?? bounds.currentEndIso;
  const spanDays = Math.max(0, Math.round((new Date(bounds.currentEndIso).getTime() - new Date(trendStart).getTime()) / 86_400_000));
  const granularity = chooseTrendGranularity(range, spanDays);
  const bucketedViews = new Map<string, number>();
  for (const r of currentRows) {
    if (r.event_name !== "page_view" || r.subject_type !== "business") continue;
    const key = bucketKey(r.occurred_at, granularity);
    bucketedViews.set(key, (bucketedViews.get(key) ?? 0) + 1);
  }
  const trendKeys = bucketRange(trendStart, bounds.currentEndIso, granularity);
  const trend = {
    metricLabel: "Profile Views",
    points: trendKeys.map((key) => ({ label: bucketLabel(key, granularity), value: bucketedViews.get(key) ?? 0 })),
  };

  const isEmpty = currentRows.length === 0 && (!qr || qr.totalScans === 0);

  return {
    range,
    rangeLabel: RANGE_LABELS[range],
    hasPreviousPeriod: bounds.hasPreviousPeriod,
    previousRangeDays: bounds.days,
    isEmpty,
    headline: {
      impressions: metric(impressionsNow, impressionsPrev, bounds),
      profileViews: metric(profileViewsNow, profileViewsPrev, bounds),
      actionsTaken: metric(actionsNow, actionsPrev, bounds),
    },
    secondaryActions,
    contactChannels,
    discoverySources,
    appearances,
    products: productPerf,
    qr,
    qrCampaigns,
    trend,
  };
}
