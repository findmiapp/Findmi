import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { notifyFounderOfPaidClaim } from "@/lib/notifications/claimNotification";

// This one webhook URL serves every Tally form in the project, branching
// on which hidden field identifies the submission:
//   - membership_id  -> vendor onboarding intake (Path A/B, unchanged
//     below — see that section's own comment).
//   - claim_id       -> the $20 claim listing-activation payment (new,
//     see "Claim payment" section below). A SEPARATE, stricter signature
//     check applies to this branch — see claimPaymentSignatureOk().

// Vendor onboarding intake — handles BOTH membership paths (see CLAUDE.md
// onboarding pass, Parts 7/8/12): Path A (founder-invited, comped) and
// Path B (paid, post-checkout) share this one Tally form/webhook,
// distinguished by the membership_id + source hidden fields the form was
// opened with (lib/tally.ts's getOnboardingFormUrl). A submission is
// NEVER trusted to self-report its own plan/payment status — Path B
// requires the referenced membership to already be billing_status=paid
// in Supabase before anything is written.
//
// This creates/updates a real `businesses` row directly (reusing all of
// the existing admin Business CRUD) plus the linked `memberships` row —
// never publishes: publication_status is always set to pending_review,
// left for founder approval in /admin/onboarding.

// Tally's optional webhook signing — verified only when configured
// (Settings -> Webhooks -> Signing secret on the Tally form). If unset,
// submissions are still processed (documented as a manual-config gap in
// the final report) rather than silently dropping all vendor intake.
// Used ONLY by the vendor-onboarding branch below — the claim-payment
// branch uses its own, deliberately stricter check (see
// claimPaymentSignatureOk) since that path moves real money and must
// never fail open.
function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.TALLY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Claim payment signature check — unlike verifySignature() above, this
 * NEVER fails open. A claim payment event moves real $20 and must never
 * be accepted without a verified signature: no secret configured means no
 * claim payment is ever accepted, full stop, regardless of what the
 * request body claims. */
function claimPaymentSignatureOk(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.TALLY_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

interface TallyField {
  label: string;
  type: string;
  value: unknown;
  options?: { id: string; text: string }[];
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fieldValue(field: TallyField | undefined): string | null {
  if (!field) return null;
  const v = field.value;
  if (v == null) return null;
  if (Array.isArray(v)) {
    // File uploads: array of {url, name}. Multi-select: array of option ids
    // resolved through field.options, or plain strings.
    const asFiles = v as { url?: string }[];
    if (asFiles.length > 0 && typeof asFiles[0] === "object" && asFiles[0]?.url) {
      return asFiles[0].url ?? null;
    }
    if (field.options) {
      const ids = new Set(v as string[]);
      const labels = field.options.filter((o) => ids.has(o.id)).map((o) => o.text);
      if (labels.length) return labels.join(", ");
    }
    return (v as string[]).join(", ") || null;
  }
  const s = String(v).trim();
  return s || null;
}

function findValue(map: Map<string, TallyField>, candidates: string[]): string | null {
  for (const c of candidates) {
    const field = map.get(normalizeLabel(c));
    const value = fieldValue(field);
    if (value) return value;
  }
  return null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

// ── Claim payment ───────────────────────────────────────────────────────
const CLAIM_PAYMENT_AMOUNT_CENTS = 2000; // $20 — see the claim payment migration

const CLAIM_TABLE = {
  business: { table: "business_claim_requests" as const, entityTable: "businesses" as const, column: "business_id" as const },
  event: { table: "event_claim_requests" as const, entityTable: "events" as const, column: "event_id" as const },
};

/** Reads whether this submission represents a genuinely successful $20
 * payment. Tally's exact webhook payload shape for a form's built-in
 * Payment/Stripe question block could not be verified against live
 * documentation from this environment (network access to tally.so is
 * blocked here) — this is DELIBERATELY conservative: it checks for a
 * field literally typed PAYMENT first (Tally's own payment-question
 * block, if its structured value carries a status/amount), then falls
 * back to generic label-matched fields using the exact same convention
 * every other field on this webhook already reads. If no clear paid-$20
 * signal is found, the caller rejects the submission — payment is never
 * assumed successful. Before relying on this in production, submit one
 * real $20 test payment through the actual configured claim payment Tally
 * form and confirm these labels/shapes match what Tally actually sends;
 * adjust the candidate lists below if they don't. */
function extractPaymentSignal(fields: TallyField[]): { paid: boolean; amountCents: number | null; reference: string | null } {
  const paymentField = fields.find((f) => (f.type ?? "").toUpperCase() === "PAYMENT");
  if (paymentField && paymentField.value && typeof paymentField.value === "object" && !Array.isArray(paymentField.value)) {
    const v = paymentField.value as Record<string, unknown>;
    const status = String(v.status ?? v.paymentStatus ?? "").toLowerCase();
    const amountRaw = v.amount ?? v.amountCents;
    const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
    const reference =
      (typeof v.paymentId === "string" && v.paymentId) ||
      (typeof v.paymentIntentId === "string" && v.paymentIntentId) ||
      (typeof v.id === "string" && v.id) ||
      null;
    if (["paid", "succeeded", "completed", "success"].includes(status)) {
      return { paid: true, amountCents: Number.isFinite(amount) ? Math.round(amount) : null, reference };
    }
    if (status) return { paid: false, amountCents: null, reference };
  }

  const byLabel = new Map<string, TallyField>();
  for (const f of fields) byLabel.set(normalizeLabel(f.label ?? ""), f);
  const statusValue = findValue(byLabel, ["payment status", "stripe payment status", "payment"]);
  const amountValue = findValue(byLabel, ["payment amount", "amount paid", "amount"]);
  const referenceValue = findValue(byLabel, ["payment reference", "payment id", "stripe payment intent", "submission id"]);

  const paid = Boolean(statusValue && ["paid", "succeeded", "completed", "success"].includes(statusValue.toLowerCase()));
  let amountCents: number | null = null;
  if (amountValue) {
    const numeric = Number(amountValue.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numeric)) {
      // Accepts either a dollar figure ("20", "20.00") or already-cents
      // ("2000") — this feature has exactly one real price point ($20),
      // so anything at or under $1000-equivalent is read as dollars.
      amountCents = numeric <= 1000 ? Math.round(numeric * 100) : Math.round(numeric);
    }
  }
  return { paid, amountCents, reference: referenceValue };
}

async function handleClaimPaymentSubmission(fields: TallyField[]): Promise<NextResponse> {
  const byLabel = new Map<string, TallyField>();
  for (const f of fields) byLabel.set(normalizeLabel(f.label ?? ""), f);

  const claimId = findValue(byLabel, ["claim_id"]);
  const claimTypeRaw = findValue(byLabel, ["claim_type"]);
  if (!claimId || (claimTypeRaw !== "business" && claimTypeRaw !== "event")) {
    return NextResponse.json({ error: "Missing or invalid claim_id/claim_type." }, { status: 400 });
  }
  const claimType = claimTypeRaw;
  const { table, entityTable, column } = CLAIM_TABLE[claimType];

  const { paid, amountCents, reference } = extractPaymentSignal(fields);
  if (!paid) {
    return NextResponse.json({ error: "Payment not confirmed as successful." }, { status: 400 });
  }
  if (amountCents !== CLAIM_PAYMENT_AMOUNT_CENTS) {
    return NextResponse.json({ error: "Unexpected payment amount — expected $20." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  if (!supabase) return NextResponse.json({ error: "Server isn't configured." }, { status: 500 });

  const { data: claim } = await supabase
    .from(table)
    .select(`id, status, payment_status, user_id, created_at, full_name, email, phone, ${column}`)
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return NextResponse.json({ error: "Unknown claim." }, { status: 404 });

  const claimRow = claim as {
    id: string;
    status: string;
    payment_status: string;
    user_id: string;
    created_at: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    business_id?: string;
    event_id?: string;
  };

  // Idempotent: repeated webhook delivery for the same event must never
  // double-process. Already-paid is a success no-op, not an error —
  // Tally (like most webhook senders) can and will redeliver.
  if (claimRow.payment_status === "paid") {
    return NextResponse.json({ received: true, alreadyProcessed: true });
  }
  if (claimRow.status !== "pending") {
    // A claim that was already approved/rejected shouldn't silently start
    // looking "paid" — surfaced as an error rather than a silent no-op so
    // a stray/late payment on a resolved claim gets noticed.
    return NextResponse.json({ error: "Claim is no longer pending." }, { status: 409 });
  }

  const paymentReference = reference || `tally:${claimId}`;
  const paidAt = new Date().toISOString();

  // .eq("payment_status", "unpaid") on the WHERE clause is the actual
  // race-safety guarantee (in addition to the payment_reference unique
  // index) if two near-simultaneous deliveries both pass the checks
  // above before either commits: whichever UPDATE lands second matches
  // zero rows here rather than double-applying.
  const { data: updated, error: updateError } = await supabase
    .from(table)
    .update({
      payment_status: "paid",
      payment_amount: CLAIM_PAYMENT_AMOUNT_CENTS,
      paid_at: paidAt,
      payment_reference: paymentReference,
    })
    .eq("id", claimId)
    .eq("payment_status", "unpaid")
    .select("id")
    .maybeSingle();

  if (updateError) {
    // Most likely the payment_reference uniqueness guard catching a
    // genuine duplicate/replay of a reference already attached to a
    // different claim — never surfaced as "paid".
    return NextResponse.json({ error: "Could not record payment." }, { status: 500 });
  }
  if (!updated) {
    // Lost the race to a concurrent delivery that already marked this
    // claim paid — same idempotent no-op as the payment_status==='paid'
    // check above.
    return NextResponse.json({ received: true, alreadyProcessed: true });
  }

  // Founder notification — best-effort, only ever attempted after the
  // payment record above has already succeeded, and never allowed to
  // affect this response either way.
  try {
    await notifyFounderOfPaidClaim({
      supabase,
      claimType,
      claimId,
      entityTable,
      entityId: (claimRow[column] as string | undefined) ?? "",
      fullName: claimRow.full_name ?? "",
      email: claimRow.email ?? "",
      phone: claimRow.phone ?? "",
      submittedAt: claimRow.created_at,
    });
  } catch (err) {
    console.error("[claim-payment] founder notification failed", err);
  }

  return NextResponse.json({ received: true });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: { data?: { fields?: TallyField[] } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const fields = payload.data?.fields ?? [];
  const byLabel = new Map<string, TallyField>();
  for (const f of fields) byLabel.set(normalizeLabel(f.label ?? ""), f);

  // Route by identifier before touching the signature check, so the
  // claim-payment branch can use its own stricter (never-fail-open)
  // verification instead of the vendor-intake branch's.
  const claimId = findValue(byLabel, ["claim_id"]);
  if (claimId) {
    const signature = request.headers.get("tally-signature");
    if (!claimPaymentSignatureOk(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid or unverifiable signature." }, { status: 401 });
    }
    return handleClaimPaymentSubmission(fields);
  }

  const signature = request.headers.get("tally-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  // Hidden fields — see lib/tally.ts's documented required hidden-field keys.
  const membershipId = findValue(byLabel, ["membership_id"]);
  const source = findValue(byLabel, ["source"]);
  const existingBusinessIdField = findValue(byLabel, ["existing_business_id"]);

  if (!membershipId) {
    return NextResponse.json({ error: "Missing membership_id — this form must be opened via a FindMi invite/checkout link." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  if (!supabase) return NextResponse.json({ error: "Server isn't configured." }, { status: 500 });

  const { data: membership } = await supabase
    .from("memberships")
    .select("id, business_id, existing_business_id, plan_id, billing_status")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Unknown membership." }, { status: 404 });

  // Never trust the form's own plan/payment claims — verify server-side.
  if (source === "paid" && membership.billing_status !== "paid") {
    return NextResponse.json({ error: "Membership isn't marked paid yet." }, { status: 409 });
  }

  let plan: { slug: string } | null = null;
  if (membership.plan_id) {
    const { data } = await supabase.from("membership_plans").select("slug").eq("id", membership.plan_id).maybeSingle();
    plan = data;
  }

  // Structured fields we map directly onto businesses columns.
  const businessName = findValue(byLabel, ["business name"]);
  const email = findValue(byLabel, ["email"]);
  const phone = findValue(byLabel, ["phone"]);
  const website = findValue(byLabel, ["website"]);
  const instagram = findValue(byLabel, ["instagram"]);
  const facebook = findValue(byLabel, ["facebook", "facebook tiktok", "facebook or tiktok", "tiktok"]);
  const description = findValue(byLabel, ["business description", "description"]);
  const city = findValue(byLabel, ["city", "base city"]);
  const state = findValue(byLabel, ["state", "base state"]);
  const logoUrl = findValue(byLabel, ["logo", "logo image"]);
  const coverUrl = findValue(byLabel, ["cover image", "cover hero image", "hero image"]);
  const primaryCategory = findValue(byLabel, ["primary category", "category"]);

  // Unstructured/rich content — kept in admin_notes for the founder to
  // build out via the full admin CRUD after approval, per Part 7's "not
  // 80 required fields" guidance rather than parsing into child records.
  const notesParts = [
    ["Primary FindMi market", findValue(byLabel, ["primary findmi market", "primary market"])],
    ["Service area", findValue(byLabel, ["service area"])],
    ["Products / services", findValue(byLabel, ["products services", "products and services"])],
    ["Accepts bookings/inquiries?", findValue(byLabel, ["do you accept bookings inquiries", "accepts bookings inquiries", "accepts bookings"])],
    ["Upcoming appearances/events", findValue(byLabel, ["upcoming appearances events", "upcoming appearances"])],
    ["Anything else", findValue(byLabel, ["anything else findmi should know", "anything else"])],
  ].filter(([, v]) => v) as [string, string][];
  const submittedNotes = notesParts.map(([label, v]) => `${label}: ${v}`).join("\n");

  const targetBusinessId = membership.business_id ?? existingBusinessIdField ?? membership.existing_business_id ?? null;

  const businessPayload: Record<string, unknown> = {
    short_description: description ? description.slice(0, 160) : null,
    description,
    logo_url: logoUrl,
    cover_image_url: coverUrl,
    website_url: website,
    instagram_url: instagram,
    facebook_url: facebook,
    email,
    phone,
    city,
    state,
    is_demo: false,
    publication_status: "pending_review",
    founding_member: plan?.slug === "founding-500",
  };
  if (businessName) businessPayload.name = businessName;

  let businessId = targetBusinessId;
  if (businessId) {
    await supabase.from("businesses").update(businessPayload).eq("id", businessId);
  } else {
    if (!businessName) {
      return NextResponse.json({ error: "Business name is required." }, { status: 400 });
    }
    const baseSlug = slugify(businessName) || "business";
    let slug = baseSlug;
    let attempt = 0;
    // Small, bounded uniqueness retry — this catalog is nowhere near large
    // enough to need anything fancier.
    while (attempt < 5) {
      const { data: existing } = await supabase.from("businesses").select("id").eq("slug", slug).maybeSingle();
      if (!existing) break;
      attempt += 1;
      slug = `${baseSlug}-${attempt + 1}`;
    }
    const { data: created, error } = await supabase
      .from("businesses")
      .insert({ ...businessPayload, slug })
      .select("id")
      .single();
    if (error || !created) {
      return NextResponse.json({ error: "Could not create business record." }, { status: 500 });
    }
    businessId = created.id;
  }

  if (primaryCategory && businessId) {
    const { data: cat } = await supabase.from("categories").select("id").ilike("name", primaryCategory).maybeSingle();
    if (cat) {
      await supabase.from("business_categories").delete().eq("business_id", businessId).eq("category_id", cat.id);
      await supabase.from("business_categories").insert({ business_id: businessId, category_id: cat.id });
    }
  }

  const contactName = findValue(byLabel, ["owner name", "contact name", "owner contact name"]);
  await supabase
    .from("memberships")
    .update({
      business_id: businessId,
      onboarding_status: "submitted",
      publication_status: "pending_review",
      contact_name: contactName ?? undefined,
      contact_email: email ?? undefined,
      contact_phone: phone ?? undefined,
      admin_notes: submittedNotes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId);

  return NextResponse.json({ received: true });
}
