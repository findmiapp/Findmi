import "server-only";
// Privacy & Data (Trust & Privacy Phase 2A): what a signed-in person can
// see and download about their own Findmi account. Service role, always
// filtered by the authenticated user's own id (the caller passes the id it
// got from the session, never a client value).
//
// The export holds what the person provided or did on Findmi. It never
// includes other people's private information (other participants'
// messages, other users' identities), Findmi-internal notes, security or
// fraud data, secrets, or business intelligence about Businesses they
// manage. Photos are listed (with their stored file names) rather than
// embedded; a copy of the photo files themselves is a manual privacy
// request.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AccountDataSummary {
  pagesFollowed: number;
  savedItems: number;
  organizedItems: number;
  moments: number;
}

async function count(admin: SupabaseClient, table: string, column: string, userId: string): Promise<number> {
  try {
    const { count: n } = await admin.from(table).select(column, { count: "exact", head: true }).eq(column, userId);
    return n ?? 0;
  } catch {
    return 0;
  }
}

const FOLLOW_TABLES = ["account_followed_businesses", "account_followed_events", "account_followed_locations"];
const SAVE_TABLES = ["account_saved_businesses", "account_saved_events", "account_saved_products", "account_saved_locations"];

/** Counts computed directly from the account tables (nothing estimated). */
export async function getAccountDataSummary(admin: SupabaseClient, userId: string): Promise<AccountDataSummary> {
  const [follows, saves, organized, moments] = await Promise.all([
    Promise.all(FOLLOW_TABLES.map((t) => count(admin, t, "user_id", userId))),
    Promise.all(SAVE_TABLES.map((t) => count(admin, t, "user_id", userId))),
    count(admin, "user_entity_relationships", "user_id", userId),
    count(admin, "journal_entries", "user_id", userId),
  ]);
  return {
    pagesFollowed: follows.reduce((a, b) => a + b, 0),
    savedItems: saves.reduce((a, b) => a + b, 0),
    organizedItems: organized,
    moments,
  };
}

async function rows(admin: SupabaseClient, table: string, columns: string, column: string, userId: string, limit = 5000): Promise<unknown[]> {
  try {
    const { data } = await admin.from(table).select(columns).eq(column, userId).limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}

/** A JSON export of the person's own account data (see module note). */
export async function buildAccountExport(admin: SupabaseClient, userId: string, email: string | null): Promise<Record<string, unknown>> {
  const [
    profile,
    followedBusinesses,
    followedEvents,
    followedLocations,
    savedBusinesses,
    savedEvents,
    savedProducts,
    savedLocations,
    relationships,
    moments,
    orders,
    businessClaims,
    eventClaims,
    locationClaims,
    marketRequests,
    privacyPreferences,
    legalAcceptances,
    privacyRequests,
    participants,
    memberships,
  ] = await Promise.all([
    rows(admin, "profiles", "display_name, username, bio, location_label, avatar_url, phone, created_at, updated_at", "id", userId),
    rows(admin, "account_followed_businesses", "business_id, created_at", "user_id", userId),
    rows(admin, "account_followed_events", "event_id, created_at", "user_id", userId),
    rows(admin, "account_followed_locations", "location_id, created_at", "user_id", userId),
    rows(admin, "account_saved_businesses", "business_id, created_at", "user_id", userId),
    rows(admin, "account_saved_events", "event_id, created_at", "user_id", userId),
    rows(admin, "account_saved_products", "product_id, created_at", "user_id", userId),
    rows(admin, "account_saved_locations", "location_id, created_at", "user_id", userId),
    rows(admin, "user_entity_relationships", "entity_type, entity_id, relation, created_at", "user_id", userId),
    rows(
      admin,
      "journal_entries",
      "id, title, entry_date, entry_time, notes, visibility, status, manual_location_name, manual_location_address, manual_location_city, manual_location_state, manual_location_zip, created_at, updated_at, journal_entry_media(storage_path, caption, display_order, is_cover, created_at), journal_entry_connections(business_id, product_id, event_id, event_occurrence_id)",
      "user_id",
      userId,
      1000
    ),
    rows(
      admin,
      "orders",
      "order_number, customer_email, customer_name, customer_phone, total_charged, currency, payment_status, refund_status, created_at, order_items(product_name, quantity, unit_price, fulfillment_method, fulfillment_status)",
      "user_id",
      userId
    ),
    rows(admin, "business_claim_requests", "business_id, status, full_name, email, phone, message, created_at, reviewed_at", "user_id", userId),
    rows(admin, "event_claim_requests", "event_id, status, full_name, email, phone, message, created_at, reviewed_at", "user_id", userId),
    rows(admin, "location_claim_requests", "location_id, status, full_name, email, phone, message, created_at, reviewed_at", "user_id", userId),
    rows(admin, "market_requests", "requested_text, city, state, status, created_at", "requester_user_id", userId),
    rows(admin, "privacy_preferences", "analytics_choice, analytics_choice_at, personalized_discovery, marketing_email, updated_at", "user_id", userId),
    rows(admin, "legal_acceptances", "document, version, context, accepted_at", "user_id", userId),
    rows(admin, "privacy_requests", "request_type, status, details, created_at, resolved_at", "user_id", userId),
    rows(admin, "conversation_participants", "id, conversation_id, entity_type", "user_id", userId),
    Promise.all([
      rows(admin, "business_members", "business_id, role, created_at", "user_id", userId),
      rows(admin, "event_members", "event_id, role, created_at", "user_id", userId),
      rows(admin, "location_members", "location_id, role, created_at", "user_id", userId),
    ]),
  ]);

  // Messages: only the ones this person sent (never other participants').
  const myParticipantIds = (participants as { id: string }[]).map((p) => p.id);
  let sentMessages: unknown[] = [];
  if (myParticipantIds.length > 0) {
    try {
      const { data } = await admin
        .from("conversation_messages")
        .select("conversation_id, kind, body, created_at")
        .in("sender_participant_id", myParticipantIds)
        .eq("kind", "text")
        .order("created_at", { ascending: true })
        .limit(5000);
      sentMessages = data ?? [];
    } catch {
      sentMessages = [];
    }
  }

  // First-party analytics associated with this account: counts by event
  // type (the raw rows also describe pages and other people's content).
  let analytics: Record<string, number> = {};
  try {
    const { data } = await admin.from("analytics_events").select("event_name").eq("user_id", userId).limit(50000);
    analytics = ((data ?? []) as { event_name: string }[]).reduce<Record<string, number>>((acc, r) => {
      acc[r.event_name] = (acc[r.event_name] ?? 0) + 1;
      return acc;
    }, {});
  } catch {
    analytics = {};
  }

  return {
    format: "findmi-account-export-v1",
    generated_at: new Date().toISOString(),
    account: { email, profile: profile[0] ?? null },
    follows: { businesses: followedBusinesses, events: followedEvents, locations: followedLocations },
    saves: { businesses: savedBusinesses, events: savedEvents, products: savedProducts, locations: savedLocations },
    organized_items: relationships,
    moments,
    messages_you_sent: sentMessages,
    orders,
    claims: { businesses: businessClaims, events: eventClaims, locations: locationClaims },
    pages_you_manage: { businesses: memberships[0], events: memberships[1], locations: memberships[2] },
    market_requests: marketRequests,
    privacy_preferences: privacyPreferences[0] ?? null,
    legal_acceptances: legalAcceptances,
    privacy_requests: privacyRequests,
    analytics_event_counts: analytics,
    notes: [
      "Photos are listed by stored file name. To receive copies of your photo files, submit a privacy request.",
      "Messages include only those you sent. Other people's messages are not included.",
    ],
  };
}
