import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveSessionId } from "@/lib/analytics/session";
import { isRateLimited } from "@/lib/analytics/rateLimit";
import {
  clampText,
  isAnalyticsEventName,
  isValidUuidField,
  optionalUuid,
  sanitizeMetadata,
} from "@/lib/analytics/taxonomy";

export const dynamic = "force-dynamic";

/**
 * The ONE controlled boundary through which every analytics event reaches
 * Postgres — see analytics_events' own RLS (enabled, zero anon/
 * authenticated policies): there is no other way for a client, guest or
 * signed-in, to write a row here.
 *
 * SECURITY (founder-review correction): session_id is NEVER read from the
 * request body — resolveSessionId() derives it solely from the
 * server-verified findmi_sid cookie, minting one if absent. A client
 * cannot spoof another visitor's session by supplying one in the payload;
 * any session_id field in the body is ignored outright.
 *
 * user_id is likewise derived server-side from the visitor's real Supabase
 * Auth session (getServerSupabase().auth.getUser()), never trusted from
 * the body.
 *
 * navigator.sendBeacon (the tracker's primary transport — see
 * lib/analytics/track.ts) POSTs as `Content-Type: text/plain` regardless
 * of the actual JSON payload, so this parses the body as text and JSON-
 * parses it manually rather than relying on request.json()'s content-type
 * check.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const eventName = body.event_name;
  if (!isAnalyticsEventName(eventName)) {
    return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  }

  // Every entity-id-shaped field, if supplied, must actually be uuid-
  // shaped — reject the whole request rather than silently dropping a
  // malformed id into a stray NULL.
  const uuidFields = [
    "subject_id",
    "business_id",
    "event_id",
    "event_occurrence_id",
    "appearance_id",
    "location_id",
    "product_id",
    "discovery_page_id",
    "discovery_section_id",
  ] as const;
  for (const field of uuidFields) {
    if (!isValidUuidField(body[field])) {
      return NextResponse.json({ error: "Malformed identifier." }, { status: 400 });
    }
  }

  const metadata = sanitizeMetadata(body.metadata);

  // session_id and user_id are deliberately NOT read from `body` at all —
  // see the module doc comment above.
  const [sessionId, supabase] = await Promise.all([resolveSessionId(), getServerSupabase()]);

  if (isRateLimited(sessionId)) {
    return NextResponse.json({ error: "Too many events." }, { status: 429 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = getAdminSupabase();
  if (!admin) return NextResponse.json({ error: "Server isn't configured." }, { status: 500 });

  const { error } = await admin.from("analytics_events").insert({
    event_name: eventName,
    subject_type: clampText(body.subject_type, 64) ?? null,
    subject_id: optionalUuid(body.subject_id) ?? null,
    business_id: optionalUuid(body.business_id) ?? null,
    event_id: optionalUuid(body.event_id) ?? null,
    event_occurrence_id: optionalUuid(body.event_occurrence_id) ?? null,
    appearance_id: optionalUuid(body.appearance_id) ?? null,
    location_id: optionalUuid(body.location_id) ?? null,
    product_id: optionalUuid(body.product_id) ?? null,
    discovery_page_id: optionalUuid(body.discovery_page_id) ?? null,
    discovery_section_id: optionalUuid(body.discovery_section_id) ?? null,
    page_type: clampText(body.page_type, 64) ?? null,
    page_path: clampText(body.page_path, 512) ?? null,
    placement: clampText(body.placement, 128) ?? null,
    session_id: sessionId,
    user_id: user?.id ?? null,
    referrer: clampText(body.referrer) ?? null,
    utm_source: clampText(body.utm_source, 256) ?? null,
    utm_medium: clampText(body.utm_medium, 256) ?? null,
    utm_campaign: clampText(body.utm_campaign, 256) ?? null,
    metadata,
  });

  if (error) {
    // Never surface the underlying DB error to the client — analytics
    // failures must stay invisible to the visitor either way (see the
    // client tracker), this just avoids leaking schema/internal detail.
    return NextResponse.json({ error: "Could not record event." }, { status: 500 });
  }

  // Never echoes the inserted row back — raw analytics is never exposed
  // in a response body, only ever written.
  return NextResponse.json({ ok: true });
}
