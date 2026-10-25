import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { notifyAdmin } from "@/lib/notifications/adminNotify";
import { isAuthorizedForConversation } from "@/lib/opportunities";
import { INTENT_LABELS, REPORT_REASON_LABELS, kindFor, validateReport, type ReportEntityType } from "@/lib/reports-domain";

export const dynamic = "force-dynamic";

const ENTITY_TABLE: Record<Exclude<ReportEntityType, "conversation" | "message">, string> = {
  business: "businesses",
  event: "events",
  location: "locations",
  product: "products",
  moment: "journal_entries",
  appearance: "appearances",
  profile: "profiles",
};

// Abuse guard: in-memory only, per server instance. The address is used
// as a short-lived counter key and never stored or logged.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();
function limited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.delete(hits.keys().next().value as string);
  return false;
}

/** Suggest A Correction / Request Removal / Report (lib/reports-domain).
 * Creates one content_reports row for Findmi to review and notifies the
 * admin inbox. Never changes or removes the content itself. Asks for no
 * personal information beyond an optional reply email (signed-out only). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true }); // honeypot

  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (limited(key)) return NextResponse.json({ error: "Too many reports. Please try again later." }, { status: 429 });

  const parsed = validateReport(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.value;

  const admin = getAdminSupabase();
  if (!admin) return NextResponse.json({ error: "Server isn't configured." }, { status: 500 });
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The content must exist; a conversation or message can only be
  // reported by one of its own participants.
  let label = "";
  if (r.entityType === "conversation" || r.entityType === "message") {
    if (!user) return NextResponse.json({ error: "Sign in to report a message." }, { status: 401 });
    let conversationId = r.entityId;
    if (r.entityType === "message") {
      const { data: msg } = await admin.from("conversation_messages").select("conversation_id").eq("id", r.entityId).maybeSingle();
      if (!msg) return NextResponse.json({ error: "That message couldn't be found." }, { status: 404 });
      conversationId = (msg as { conversation_id: string }).conversation_id;
    }
    if (!(await isAuthorizedForConversation(admin, conversationId, user.id))) {
      return NextResponse.json({ error: "That conversation couldn't be found." }, { status: 404 });
    }
    label = r.entityType === "message" ? "A message" : "A conversation";
  } else {
    const nameCol = r.entityType === "moment" ? "title" : r.entityType === "appearance" ? "title" : r.entityType === "profile" ? "display_name" : "name";
    const { data: row } = await admin.from(ENTITY_TABLE[r.entityType]).select(`id, ${nameCol}`).eq("id", r.entityId).maybeSingle();
    if (!row) return NextResponse.json({ error: "That page couldn't be found." }, { status: 404 });
    label = String((row as unknown as Record<string, unknown>)[nameCol] ?? r.entityType);
  }

  const kind = kindFor(r.intent, r.reason);
  const { data: inserted, error } = await admin
    .from("content_reports")
    .insert({
      entity_type: r.entityType,
      entity_id: r.entityId,
      report_kind: kind,
      reason: r.reason,
      details: r.details,
      evidence_url: r.evidenceUrl,
      reporter_relationship: r.relationship,
      reporter_user_id: user?.id ?? null,
      reporter_email: user ? null : r.email,
    })
    .select("id")
    .single();
  if (error || !inserted) return NextResponse.json({ error: "Couldn't send that. Please try again." }, { status: 500 });

  await notifyAdmin({
    subject: `${INTENT_LABELS[r.intent]}: ${label}`,
    heading: `${INTENT_LABELS[r.intent]} (${REPORT_REASON_LABELS[r.reason]})`,
    body: [`${r.entityType}: ${label}`, `Kind: ${kind}`, user ? "Reporter: signed in" : r.email ? "Reporter: guest, wants a reply" : "Reporter: guest"],
    actionLabel: "Review Report",
    actionUrl: `/admin/reports/${(inserted as { id: string }).id}`,
  });

  return NextResponse.json({ ok: true });
}
