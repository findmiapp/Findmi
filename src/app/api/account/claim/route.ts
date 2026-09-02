import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ENTITY = {
  business: { entityTable: "businesses", claimTable: "business_claim_requests", memberTable: "business_members", column: "business_id" },
  event: { entityTable: "events", claimTable: "event_claim_requests", memberTable: "event_members", column: "event_id" },
} as const;
type EntityType = keyof typeof ENTITY;

// Reasonable-but-not-exhaustive email shape check — matches the level of
// rigor a client-side type="email" input already provides; the point is
// to catch obvious typos/garbage, not to be a full RFC 5322 validator.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEntityType(value: string | null): value is EntityType {
  return value === "business" || value === "event";
}

async function resolveEntityId(supabase: SupabaseClient, entityTable: string, slug: string): Promise<string | null> {
  const { data } = await supabase.from(entityTable).select("id").eq("slug", slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** This visitor's claim state for one business/event — drives ClaimButton.
 * States, in the order they can occur:
 *   "none"                 — free to submit a new claim. Also returns the
 *                            account's email (accountEmail) purely as a
 *                            prefill hint for the claim form's editable
 *                            Email field — never stored anywhere until the
 *                            claimant actually submits it.
 *   "awaiting_payment"     — a pending, unpaid claim row already exists;
 *                            show the $20 payment step. Returns the
 *                            claim's own stored fullName/email/phone (NOT
 *                            the account email) so ClaimButton can rebuild
 *                            the Tally payment link after a page reload.
 *   "paid_pending_review"  — the pending claim's payment_status is 'paid';
 *                            awaiting founder review. Payment alone never
 *                            implies approval.
 *   "member"               — a real business_members/event_members row
 *                            exists; claim UI hidden entirely.
 * A rejected (or approved, i.e. now covered by "member") claim falls back
 * to "none", intentionally allowing a fresh claim to be submitted — see
 * the claim foundation migration's partial-unique-index note. */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  const slug = request.nextUrl.searchParams.get("slug");
  if (!isEntityType(type) || !slug) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ state: "none" });

  const { entityTable, claimTable, memberTable, column } = ENTITY[type];
  const entityId = await resolveEntityId(supabase, entityTable, slug);
  if (!entityId) return NextResponse.json({ state: "none", accountEmail: user.email ?? null });

  const { data: membership } = await supabase
    .from(memberTable)
    .select("id")
    .eq("user_id", user.id)
    .eq(column, entityId)
    .maybeSingle();
  if (membership) return NextResponse.json({ state: "member" });

  const { data: pendingClaim } = await supabase
    .from(claimTable)
    .select("id, payment_status, full_name, email, phone")
    .eq("user_id", user.id)
    .eq(column, entityId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingClaim) {
    const state = pendingClaim.payment_status === "paid" ? "paid_pending_review" : "awaiting_payment";
    return NextResponse.json({
      state,
      claimId: pendingClaim.id,
      fullName: pendingClaim.full_name,
      email: pendingClaim.email,
      phone: pendingClaim.phone,
    });
  }

  return NextResponse.json({ state: "none", accountEmail: user.email ?? null });
}

/** Submits a new claim request. Body: { type, slug, fullName, email,
 * phone, message? }. Identity is always the authenticated session's
 * user.id — never a value the client sends, and never derived from the
 * submitted email either: email here is just a contact field the
 * claimant typed/edited (prefilled from their account email, but not
 * required to match it), stored as-is in claim.email. fullName, email,
 * and phone are all required. Uses the RLS-scoped session client (not
 * service-role), so the insert-own-pending-unpaid-row policy on
 * business_claim_requests/event_claim_requests is the real enforcement
 * here, not just this route's own logic — payment_status is never
 * accepted from the client and always inserts as 'unpaid'. Never grants
 * membership itself, and never marks anything paid — that only ever
 * happens via the payment webhook (see /api/webhooks/tally) after a real
 * $20 payment is verified, and even then only founder approval (see the
 * migration's approve_*_claim() functions) grants membership. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : null;
  const slug = typeof body?.slug === "string" ? body.slug : null;
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 200) : "";
  const email = typeof body?.email === "string" ? body.email.trim().slice(0, 320) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) || null : null;
  if (!isEntityType(type) || !slug) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!fullName || !phone) {
    return NextResponse.json({ error: "Full name and phone are required." }, { status: 400 });
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { entityTable, claimTable, memberTable, column } = ENTITY[type];
  const entityId = await resolveEntityId(supabase, entityTable, slug);
  if (!entityId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: membership } = await supabase
    .from(memberTable)
    .select("id")
    .eq("user_id", user.id)
    .eq(column, entityId)
    .maybeSingle();
  if (membership) return NextResponse.json({ state: "member" });

  const { data: pendingClaim } = await supabase
    .from(claimTable)
    .select("id, payment_status, full_name, email, phone")
    .eq("user_id", user.id)
    .eq(column, entityId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingClaim) {
    const state = pendingClaim.payment_status === "paid" ? "paid_pending_review" : "awaiting_payment";
    return NextResponse.json({
      state,
      claimId: pendingClaim.id,
      fullName: pendingClaim.full_name,
      email: pendingClaim.email,
      phone: pendingClaim.phone,
    });
  }

  const { data: inserted, error } = await supabase
    .from(claimTable)
    .insert({ user_id: user.id, [column]: entityId, full_name: fullName, email, phone, message })
    .select("id")
    .single();

  if (error || !inserted) {
    return NextResponse.json({ error: "Couldn't submit your claim. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ state: "awaiting_payment", claimId: inserted.id, fullName, email, phone });
}
