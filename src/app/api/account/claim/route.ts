import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import { notifyAdmin } from "@/lib/notifications/adminNotify";

export const dynamic = "force-dynamic";

const ENTITY = {
  business: { entityTable: "businesses", claimTable: "business_claim_requests", memberTable: "business_members", column: "business_id" },
  event: { entityTable: "events", claimTable: "event_claim_requests", memberTable: "event_members", column: "event_id" },
  // Multi-Entity Self-Service V1, Stage 3 — Location claiming is free for
  // every signed-in user, exactly like a business claim (never gated on
  // entitlement, unlike event) — see this stage's own Location Access
  // rule. location_claim_requests/location_members mirror business's own
  // tables structurally.
  location: { entityTable: "locations", claimTable: "location_claim_requests", memberTable: "location_members", column: "location_id" },
} as const;
type EntityType = keyof typeof ENTITY;

// Reasonable-but-not-exhaustive email shape check — matches the level of
// rigor a client-side type="email" input already provides; the point is
// to catch obvious typos/garbage, not to be a full RFC 5322 validator.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEntityType(value: string | null): value is EntityType {
  return value === "business" || value === "event" || value === "location";
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
 *   "pending_review"       — a pending claim row exists and goes straight
 *                            to founder review. Claiming a business is
 *                            free (see CLAIMS: REMOVE PAYMENT REQUIREMENT
 *                            ONLY). Multi-Entity Self-Service V1 removes
 *                            the old $20 event claim fee too — an EVENT
 *                            claim reaches this state once the claimant
 *                            has qualifying FindMi access (see
 *                            canCurrentUserManageEvents()); it is no
 *                            longer gated on payment at all, regardless of
 *                            this exact claim row's own (now-vestigial)
 *                            payment_status.
 *   "membership_required"  — EVENT claims only: the claimant is signed in
 *                            but doesn't yet have qualifying FindMi access
 *                            (an active-Pro or Pro-Invite-granted
 *                            business). Never routed to a $20 payment —
 *                            just a plain "membership required" message
 *                            pointing at the existing Pro/Invite path.
 *   "member"               — the entity already has an approved owner
 *                            (this viewer or anyone else), OR a different
 *                            user's claim is already pending on it; claim
 *                            UI hidden entirely for every visitor either
 *                            way, never just the owner/claimant.
 * A rejected (or approved, i.e. now covered by "member") claim falls back
 * to "none", intentionally allowing a fresh claim to be submitted — see
 * the claim foundation migration's partial-unique-index note.
 *
 * `entitled` is only ever consulted for type === "event" (business and
 * location claims have never depended on any entitlement check) —
 * callers pass `true` for business/location claims as a harmless
 * default. */
function resolvePendingState(type: EntityType, entitled: boolean): "pending_review" | "membership_required" {
  if (type !== "event") return "pending_review";
  return entitled ? "pending_review" : "membership_required";
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

  // Business/location-claim addition: already-claimed-by-anyone check —
  // must answer the same way for EVERY visitor (owner, other signed-in
  // users, and signed-out guests alike), not just the current viewer, so
  // it can't use the RLS-scoped client above (business_members/
  // location_members only let a user read their own row). Read-only
  // existence check via service-role, same authorize-elsewhere-then-
  // elevate shape used throughout the app — no membership/claim record is
  // touched, only reported on. business_members/location_members each
  // enforce at most one 'owner' row, so any row here means it's already
  // claimed. Scoped to business/location only — event claim eligibility
  // is untouched.
  if (type === "business" || type === "location") {
    const admin = getAdminSupabase();
    if (admin) {
      const { data: anyMember } = await admin.from(memberTable).select("id").eq(column, entityId).limit(1).maybeSingle();
      if (anyMember) return NextResponse.json({ state: "member" });
    }
  }

  if (user) {
    const { data: pendingClaim } = await supabase
      .from(claimTable)
      .select("id, full_name, email, phone")
      .eq("user_id", user.id)
      .eq(column, entityId)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingClaim) {
      // Multi-Entity Self-Service V1 — an event claim's resolved state no
      // longer depends on payment_status (that column is now vestigial
      // for events — see resolvePendingState's own comment); it depends
      // entirely on the claimant's CURRENT entitlement, re-checked fresh
      // on every load so gaining/losing qualifying access is reflected
      // immediately, not frozen at whatever it was when the claim was
      // first submitted.
      const entitled = type === "event" ? await isEventEntitled(user.id) : true;
      const state = resolvePendingState(type, entitled);
      return NextResponse.json({
        state,
        claimId: pendingClaim.id,
        fullName: pendingClaim.full_name,
        email: pendingClaim.email,
        phone: pendingClaim.phone,
      });
    }
  }

  // Business/location-claim addition: no pending claim belonging to this
  // viewer (or no viewer at all) — but a DIFFERENT user's claim may
  // already be pending on this same business/location (the "one pending
  // claim" constraint is per-user, not per-entity — see the claim
  // foundation migration). Never expose that claimant's contact info to
  // anyone else; just stop offering a competing CTA. Scoped to business/
  // location only — event claim eligibility is untouched.
  if (type === "business" || type === "location") {
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

  // Progressive Email Verification pass — a claim is an identity assertion
  // over an EXISTING entity someone else may legitimately own, so it's the
  // one owner action this pass gates on profiles.email_verified_at. Checked
  // here (GET) so ClaimButton never even opens a submittable form for an
  // unverified visitor — same "re-check fresh, never trust prior state"
  // discipline the entitlement check right below already uses. Ahead of
  // the event-entitlement check: proving identity is the more fundamental
  // gate. Signed-out visitors are unaffected (ClaimButton's own "guest"
  // override only applies when resolved === "none", which this never
  // returns for an unauthenticated caller anyway).
  if (user && !(await isEmailVerified(user.id))) {
    return NextResponse.json({ state: "verification_required" });
  }

  // Multi-Entity Self-Service V1 — an authenticated visitor with no
  // pending claim on this event still can't open the claim form unless
  // they already qualify; a signed-out visitor is unaffected (ClaimButton
  // overrides "none" to its own "guest" state client-side when !authed,
  // same as before this pass — entitlement can't be checked without a
  // real session anyway).
  if (type === "event" && user) {
    const entitled = await isEventEntitled(user.id);
    if (!entitled) return NextResponse.json({ state: "membership_required" });
  }

  return NextResponse.json({ state: "none", accountEmail: user?.email ?? null });
}

/** Progressive Email Verification pass — the ONE server-side check every
 * new-claim path (GET's preview and POST's real submission) re-runs fresh,
 * never cached/trusted from an earlier response. Reads profiles.
 * email_verified_at for the caller's OWN id only (never accepted from the
 * client). Does not touch or duplicate any existing claim/entitlement
 * logic below it. */
async function isEmailVerified(userId: string): Promise<boolean> {
  const admin = getAdminSupabase();
  if (!admin) return false;
  const { data } = await admin.from("profiles").select("email_verified_at").eq("id", userId).maybeSingle();
  return Boolean(data?.email_verified_at);
}

/** Multi-Entity Self-Service V1 — thin wrapper so both GET and POST share
 * the exact same "no admin client -> fail closed (not entitled)" fallback
 * rather than each re-deriving it slightly differently. */
async function isEventEntitled(userId: string): Promise<boolean> {
  const admin = getAdminSupabase();
  if (!admin) return false;
  return canCurrentUserManageEvents(admin, userId);
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
 * accepted from the client and always inserts as 'unpaid' (a vestigial
 * default for events now — see resolvePendingState's own comment; the
 * /api/webhooks/tally $20 payment webhook still exists for historical
 * reference but nothing in this flow routes a new event claim through it
 * anymore). Never grants membership itself — only founder approval (see
 * the migration's approve_*_claim() functions) grants membership.
 * Multi-Entity Self-Service V1 — an EVENT claim additionally requires the
 * claimant to already have qualifying FindMi access (active Pro or a
 * redeemed Pro Invite on some business they belong to) before a claim row
 * is even inserted; a non-qualifying signed-in user gets
 * "membership_required" back instead, with no row created — see this
 * pass's own Entitlement Rule (no separate Event fee, ever). */
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
    .select("id, full_name, email, phone")
    .eq("user_id", user.id)
    .eq(column, entityId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingClaim) {
    const entitled = type === "event" ? await isEventEntitled(user.id) : true;
    const state = resolvePendingState(type, entitled);
    return NextResponse.json({
      state,
      claimId: pendingClaim.id,
      fullName: pendingClaim.full_name,
      email: pendingClaim.email,
      phone: pendingClaim.phone,
    });
  }

  // Progressive Email Verification pass — the real, authoritative gate
  // (GET's own check above is only a preview; this is what actually
  // prevents the row from being created). Checked BEFORE inserting
  // anything, same "never accumulate a row behind a gate" discipline the
  // entitlement check right below already uses.
  if (!(await isEmailVerified(user.id))) {
    return NextResponse.json({ state: "verification_required" });
  }

  // Entitlement gate — checked BEFORE inserting anything, so a
  // non-qualifying user never accumulates a claim row that would just sit
  // unreachable behind a membership prompt. No separate $20 payment path
  // exists to fall back to.
  if (type === "event" && !(await isEventEntitled(user.id))) {
    return NextResponse.json({ state: "membership_required" });
  }

  const { data: inserted, error } = await supabase
    .from(claimTable)
    .insert({ user_id: user.id, [column]: entityId, full_name: fullName, email, phone, message })
    .select("id")
    .single();

  if (error || !inserted) {
    return NextResponse.json({ error: "Couldn't submit your claim. Please try again." }, { status: 500 });
  }

  // Admin Action Email Notifications V1 — only reached on a genuine new
  // insert (both the "already a member" and "already has a pending
  // claim for this user+entity" branches above return earlier, before
  // ever inserting a row), so a duplicate submission never produces a
  // duplicate email. One extra cheap single-row lookup for a human-
  // readable name — the claim row itself only stores the entity id.
  const { data: entity } = await supabase.from(entityTable).select("name").eq("id", entityId).maybeSingle();
  const entityName = (entity as { name: string } | null)?.name ?? "Unknown";
  const typeLabel = type === "location" ? "Venue" : type === "event" ? "Event" : "Business";
  await notifyAdmin({
    subject: `New ${typeLabel} ownership claim — ${entityName}`,
    heading: `New ${typeLabel} ownership claim`,
    body: [`${typeLabel}: ${entityName}`, `Claimant: ${fullName}`, `Email: ${email}`, `Phone: ${phone}`],
    actionLabel: "Review Claims",
    actionUrl: `/admin/claims?status=pending&type=${type}`,
  });

  // Both claim types are now free — straight to founder review, no
  // payment step for either.
  return NextResponse.json({ state: "pending_review", claimId: inserted.id, fullName, email, phone });
}
