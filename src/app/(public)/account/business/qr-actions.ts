"use server";

// Pro QR Self-Service V1 — the owner-facing counterpart to
// src/app/admin/(protected)/qr-campaigns/actions.ts. Reuses the exact
// same code-generation/collision-retry mechanism and destination-safety
// validator that file already established; the only real difference is
// authorization: every relationship id here is re-verified server-side
// against the AUTHENTICATED owner's own business — never trusted from
// the client — whereas the admin action can trust a raw form UUID
// because only an admin can reach it at all.
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { generateQrCode, isSafeQrDestinationPath } from "@/lib/analytics/qrCode";
import { getPublicOrigin } from "@/lib/site-url";
import QRCode from "qrcode";

export type QrCampaignTarget = "business" | "appearance" | "product";

export interface CreatedQrCampaign {
  id: string;
  name: string;
  code: string;
  qrUrl: string;
  destinationPath: string;
  qrSvg: string;
}

type CreateResult = { ok: true; campaign: CreatedQrCampaign } | { ok: false; error: string };

/** Findmi Here appearances have no own detail page — the existing public
 * anchor on the Business's own profile (BusinessPublicView.tsx's
 * id="findmi-here" section) is the real, already-shipped destination for
 * "see this business's schedule," so an Appearance-targeted campaign
 * points there rather than inventing a new per-appearance route. */
const FINDMI_HERE_ANCHOR = "#findmi-here";

export async function createOwnerQrCampaign(
  businessId: string,
  input: { name: string; target: QrCampaignTarget; entityId?: string }
): Promise<CreateResult> {
  let membership;
  try {
    membership = await requireBusinessMember(businessId);
  } catch {
    return { ok: false, error: "You don't have access to this business." };
  }
  void membership;

  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };

  const { data: business } = await admin
    .from("businesses")
    .select("id, slug, plan_tier, plan_expires_at")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return { ok: false, error: "Business not found." };

  // Server-side entitlement re-check — the UI only ever offers this
  // control to a Pro business, but that's not enough on its own: a
  // direct call to this action must be rejected here too, never relying
  // on the caller having hidden the button.
  if (!isBusinessPro(business)) {
    return { ok: false, error: "QR campaigns are part of Findmi Pro." };
  }

  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Enter a name for this QR code." };

  let destinationPath: string;
  let appearanceId: string | null = null;
  let productId: string | null = null;

  if (input.target === "business") {
    destinationPath = `/business/${business.slug}`;
  } else if (input.target === "appearance") {
    // Ownership re-verified here — an appearance id submitted by the
    // client is NEVER trusted; it must actually belong to (business_id =)
    // this authenticated business, or the request is rejected outright.
    if (!input.entityId) return { ok: false, error: "Choose an appearance." };
    const { data: appearance } = await admin
      .from("appearances")
      .select("id, business_id")
      .eq("id", input.entityId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!appearance) return { ok: false, error: "That appearance doesn't belong to this business." };
    appearanceId = appearance.id;
    destinationPath = `/business/${business.slug}${FINDMI_HERE_ANCHOR}`;
  } else {
    // "product"
    if (!input.entityId) return { ok: false, error: "Choose a product." };
    const { data: product } = await admin
      .from("products")
      .select("id, business_id, slug")
      .eq("id", input.entityId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!product) return { ok: false, error: "That product doesn't belong to this business." };
    productId = product.id;
    destinationPath = `/product/${product.slug}`;
  }

  if (!isSafeQrDestinationPath(destinationPath)) {
    return { ok: false, error: "Could not build a safe destination for this QR code." };
  }

  // Same bounded collision-retry loop as the admin action — collision
  // odds against a 72-bit random code are negligible; this only guards
  // against a real, persistent insert error looping forever.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateQrCode();
    const { data: inserted, error } = await admin
      .from("qr_campaigns")
      .insert({
        name,
        business_id: businessId,
        appearance_id: appearanceId,
        product_id: productId,
        destination_path: destinationPath,
        placement: null,
        campaign_label: null,
        is_active: true,
        code,
      })
      .select("id")
      .single();
    if (!error && inserted) {
      // The QR code must encode the full absolute URL — a camera app
      // can't resolve a bare relative path like "/q/abc123".
      const qrUrl = `${getPublicOrigin()}/q/${code}`;
      const qrSvg = await QRCode.toString(qrUrl, { type: "svg", margin: 1, width: 320 }).catch(() => "");
      return {
        ok: true,
        campaign: { id: inserted.id, name, code, qrUrl, destinationPath, qrSvg },
      };
    }
    if (error && error.code !== "23505") {
      return { ok: false, error: "Could not create this QR code. Please try again." };
    }
  }
  return { ok: false, error: "Could not generate a unique code. Please try again." };
}
