// Findmi Analytics — canonical taxonomy + payload validation.
// This is the ONE place that decides which event names/metadata values
// the ingestion endpoint (src/app/api/analytics/track/route.ts) will
// accept.
//
// Phase 1 covered page views, Save/Follow, Business contact/social
// clicks, and Share. Phase 2A added viewport impressions, entity clicks,
// Directions, Event CTA clicks, Product outbound clicks, discovery-
// section attribution, and search/filter interactions. Phase 2B (this
// pass) adds exactly one new event — qr_scan — plus session acquisition
// attribution (see lib/analytics/session.ts's findmi_acq cookie) that
// rides along on every event's acquisition_source/acquisition_qr_
// campaign_id columns, not a new taxonomy concept. Still no generic
// "button_click", and no qr_click/qr_view/qr_open — one resolved request
// to /q/[code] is exactly one qr_scan. Experiential-reporting event names
// remain out of scope for a future pass.
//
// No dependency added for this — the validation this file needs (a fixed
// set of strings, uuid shape, length caps) doesn't warrant one.

export const ANALYTICS_EVENT_NAMES = [
  "page_view",
  "save",
  "unsave",
  "follow",
  "unfollow",
  "click_contact_channel",
  "share",
  // Phase 2A additions:
  "entity_impression",
  "entity_click",
  "click_directions",
  "click_rsvp",
  "click_tickets",
  "click_apply_to_vend",
  "click_contact_organizer",
  "product_external_click",
  "search",
  "filter_change",
  "discovery_section_impression",
  // Phase 2B addition:
  "qr_scan",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

// Phase 1 subject types — one per public entity a page_view/save/follow/
// click can be about. Kept in lockstep with the explicit FK columns on
// analytics_events (business_id/event_id/event_occurrence_id/
// appearance_id/location_id/product_id) — see the migration.
export const ANALYTICS_SUBJECT_TYPES = ["business", "event", "event_occurrence", "appearance", "location", "product"] as const;
export type AnalyticsSubjectType = (typeof ANALYTICS_SUBJECT_TYPES)[number];

export function isAnalyticsSubjectType(value: unknown): value is AnalyticsSubjectType {
  return typeof value === "string" && (ANALYTICS_SUBJECT_TYPES as readonly string[]).includes(value);
}

// click_contact_channel's metadata.channel — mirrors BusinessLinksRow's
// actual rendered actions (Call/Email/Website/Instagram/Facebook/TikTok)
// exactly, per the completed audit's taxonomy recommendation (one event
// name, parameterized by channel, rather than 6 near-identical events).
export const ANALYTICS_CONTACT_CHANNELS = ["phone", "email", "website", "instagram", "facebook", "tiktok"] as const;
export type AnalyticsContactChannel = (typeof ANALYTICS_CONTACT_CHANNELS)[number];

export function isAnalyticsContactChannel(value: unknown): value is AnalyticsContactChannel {
  return typeof value === "string" && (ANALYTICS_CONTACT_CHANNELS as readonly string[]).includes(value);
}

// share's metadata.method — the two real, existing completion paths both
// ShareButton and EventShareButton already implement (Web Share API, or
// the clipboard-copy fallback). No other method exists in the codebase
// today — see the audit's Section 14 finding.
export const ANALYTICS_SHARE_METHODS = ["web_share_api", "clipboard"] as const;
export type AnalyticsShareMethod = (typeof ANALYTICS_SHARE_METHODS)[number];

export function isAnalyticsShareMethod(value: unknown): value is AnalyticsShareMethod {
  return typeof value === "string" && (ANALYTICS_SHARE_METHODS as readonly string[]).includes(value);
}

// page_type — one per actual current public surface this pass
// instruments. Deliberately not a DB enum (per the task's own guidance):
// plain application-code validation is enough for this fixed, small set.
// Extend this array, never invent a stray string at a call site. The
// first four are entity DETAIL pages (Phase 1); the rest are DISCOVERY
// surfaces (Phase 2A) — home is the reserved Discovery Page Builder
// system page rendered at "/", discover/find/events/businesses/
// locations/marketplace are today's specialized, non-builder-driven
// discovery routes (see the completed audit — none of them are forced
// into the Page Builder for this pass).
export const ANALYTICS_PAGE_TYPES = [
  "business",
  "event",
  "location",
  "product",
  "home",
  "discover",
  "find",
  "events",
  "businesses",
  "locations",
  "marketplace",
  // Phase 2B — the QR resolution route itself (see src/app/q/[code]).
  "qr",
] as const;
export type AnalyticsPageType = (typeof ANALYTICS_PAGE_TYPES)[number];

export function isAnalyticsPageType(value: unknown): value is AnalyticsPageType {
  return typeof value === "string" && (ANALYTICS_PAGE_TYPES as readonly string[]).includes(value);
}

// discovery_section_impression / entity_impression's metadata.origin
// (hybrid mode only) — see lib/homepage-rows.ts's resolveHomepageRowItems,
// which already computes this distinction internally; Phase 2A threads it
// through to the renderer rather than re-deriving it.
export const ANALYTICS_ENTITY_ORIGINS = ["pinned", "auto"] as const;
export type AnalyticsEntityOrigin = (typeof ANALYTICS_ENTITY_ORIGINS)[number];

// Phase 2B — analytics_events.acquisition_source. Exactly one source
// type exists in V1 (a QR scan establishing first-touch); the column and
// this closed vocabulary are deliberately generic so a future UTM/
// referrer-based first-touch source can be added later without a schema
// change — see lib/analytics/session.ts's own note on why that's
// explicitly NOT built this pass.
export const ANALYTICS_ACQUISITION_SOURCES = ["qr"] as const;
export type AnalyticsAcquisitionSource = (typeof ANALYTICS_ACQUISITION_SOURCES)[number];

export function isAnalyticsAcquisitionSource(value: unknown): value is AnalyticsAcquisitionSource {
  return typeof value === "string" && (ANALYTICS_ACQUISITION_SOURCES as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Accepts a genuinely uuid-shaped string, or undefined/null (field not
 * supplied) — rejects anything else (including a non-uuid string), so a
 * malformed id can never silently become a stray NULL in storage; the
 * whole request is rejected instead (see the ingestion route). */
export function optionalUuid(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return isUuid(value) ? value : undefined;
}

export function isValidUuidField(value: unknown): boolean {
  return value === undefined || value === null || isUuid(value);
}

// Reasonable maximum lengths — never store an arbitrarily huge caller-
// supplied string. Referrer/UTM/page_path are all real URLs/params in
// practice; a normal one is well under 100 characters, so these caps are
// generous while still bounding worst-case row size.
export const MAX_TEXT_FIELD_LENGTH = 2048;
export const MAX_METADATA_BYTES = 4096;

export function clampText(value: unknown, maxLength: number = MAX_TEXT_FIELD_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/** Metadata is the one open-ended field on an event — still bounded: only
 * plain, flat-ish JSON up to MAX_METADATA_BYTES once serialized, never an
 * arbitrarily large or deeply nested caller payload. */
export function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_METADATA_BYTES) return {};
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
