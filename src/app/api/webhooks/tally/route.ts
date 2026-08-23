import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

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

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("tally-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: { data?: { fields?: TallyField[] } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const fields = payload.data?.fields ?? [];
  const byLabel = new Map<string, TallyField>();
  for (const f of fields) byLabel.set(normalizeLabel(f.label ?? ""), f);

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
