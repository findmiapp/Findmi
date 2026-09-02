import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

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
 *   "pending_review"       — BUSINESS claims only (claiming a business is
 *                            free — see CLAIMS: REMOVE PAYMENT REQUIREMENT
 *                            ONLY): a pending claim row exists and goes
 *                            straight to founder review, no payment step.
 *   "awaiting_payment"     — EVENT claims only: a pending, unpaid claim
 *                            row already exists; show the $20 payment
 *                            step. Returns the claim's own stored
 *                            fullName/email/phone (NOT the account email)
 *                            so ClaimButton can rebuild the Tally payment
 *                            link after a page reload.
 *   "paid_pending_review"  — EVENT claims only: the pending claim's
 *                            payment_status is 'paid'; awaiting founder
 *                            review. Payment alone never implies approval.
 *   "member"               — the entity already has an approved owner
 *                            (this viewer or anyone else), OR a different
 *                            user's claim is already pending on it; claim
 *                            UI hidden entirely for every visitor either
 *                            way, never just the owner/claimant.
 * A rejected (or approved, i.e. now covered by "member") claim falls back
 * to "none", intentionally allowing a fresh claim to be submitted — see
 * the claim foundation migration's partial-unique-index note. */
function resolvePendingState(
  type: EntityType,
  paymentStatus: string
): "pending_review" | "awaiting_payment" | "paid_pending_review" {
  if (type === "business") return "pending_review";
  return paymentStatus === "paid" ? "paid_pending_review" : "awaiting_payment";
}
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

  const { entityTable, claimTable, memberTable, column } = ENTITY[type];
  const entityId = await resolveEntityId(supabase, entityTable, slug);
  if (!entityId) return NextResponse.json({ state: "none", accountEmail: user?.email ?? null });

  // Original per-viewer membership check — unchanged, still runs for both
  // types (event claim behavior stays exactly as before this pass).
  if (user) {
    const { data: membership } = await supabase
      .from(memberTable)
      .select("id")
      .eq("user_id", user.id)
      .eq(column, entityId)
      .maybeSingle();
    if (membership) return NextResponse.json({ state: "member" });
  }

  // Business-claim-only addition: already-claimed-by-anyone check — must
  // answer the same way for EVERY visitor (owner, other signed-in users,
  // and signed-out guests alike), not just the current viewer, so it
  // can't use the RLS-scoped client above (business_members only lets a
  // user read their own row). Read-only existence check via service-role,
  // same authorize-elsewhere-then-elevate shape used throughout the app —
  // no membership/claim record is touched, only reported on.
  // business_members enforces at most one 'owner' row per business, so
  // any row here means it's already claimed. Scoped to type === "business"
  // only — event claim eligibility is untouched by this pass.
  if (type === "business") {
    const admin = getAdminSupabase();
    if (admin) {
      const { data: anyMember } = await admin.from(memberTable).select("id").eq(column, entityId).limit(1).maybeSingle();
      if (anyMember) return NextResponse.json({ state: "member" });
    }
  }

  if (user) {
    const { data: pendingClaim } = await supabase
      .from(claimTable)
      .select("id, payment_status, full_name, email, phone")
      .eq("user_id", user.id)
      .eq(column, entityId)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingClaim) {
      const state = resolvePendingState(type, pendingClaim.payment_status);
      return NextResponse.json({
        state,
        claimId: pendingClaim.id,
        fullName: pendingClaim.full_name,
        email: pendingClaim.email,
        phone: pendingClaim.phone,
      });
    }
  }

  // Business-claim-only addition: no pending claim belonging to this
  // viewer (or no viewer at all) — but a DIFFERENT user's claim may
  // already be pending on this same business (the "one pending claim"
  // constraint is per-user, not per-entity — see the claim foundation
  // migration). Never expose that claimant's contact info to anyone else;
  // just stop offering a competing CTA. Scoped to "business" only — event
  // claim eligibility is untouched by this pass.
  if (type === "business") {
    const admin = getAdminSupabase();
    if (admin) {
      const { data: pendingAny } = await admin
        .from(claimTable)
        .select("id")
        .eq(column, entityId)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      if (pendingAny) return NextResponse.json({ state: "member" });
    }
  }

  return NextResponse.json({ state: "none", accountEmail: user?.email ?? null });
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
 * $20 payment is verified — event claims only. A business claim skips the
 * payment step entirely (see resolvePendingState above) and goes straight
 * to founder review; even then, only founder approval (see the
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
    const state = resolvePendingState(type, pendingClaim.payment_status);
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

  // Claiming a business is free — straight to founder review, no payment
  // step. Event claims are untouched: still require the $20 payment.
  const state = type === "business" ? "pending_review" : "awaiting_payment";
  return NextResponse.json({ state, claimId: inserted.id, fullName, email, phone });
}
