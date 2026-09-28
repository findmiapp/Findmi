"use server";

// QR Campaigns V1 — the owner-facing QR creation action, generalized from
// Pro QR Self-Service V1 to cover all five FindMi destination types
// (Business/Appearance/Product/Event/Location) and reachable regardless
// of plan tier. Reuses the exact same code-generation/collision-retry
// mechanism and destination-safety validator the admin action
// (src/app/admin/(protected)/qr-campaigns/actions.ts) already established;
// the only real difference is authorization: every relationship id here
// is re-verified server-side against the AUTHENTICATED caller's own real
// membership — never trusted from the client — whereas the admin action
// can trust a raw form UUID because only an admin can reach it at all.
//
// Free vs Pro (Product Principle: FREE CREATES AND DISTRIBUTES, PRO
// ANALYZES AND AMPLIFIES) — QR is a distribution/bridge tool, so creation
// itself is NOT plan-gated here. Deeper QR intelligence (unique visitors,
// action breakdown) is gated at the DISPLAY layer instead — see
// src/app/(public)/account/qr/[id]/page.tsx — never here.
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember, requireEventMember, requireLocationMember } from "@/lib/permissions";
import { generateQrCode, isSafeQrDestinationPath } from "@/lib/analytics/qrCode";
import { getPublicOrigin } from "@/lib/site-url";
import QRCode from "qrcode";

export type QrCampaignTarget = "business" | "appearance" | "product" | "event" | "location";

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

/** Creates one QR campaign for exactly one destination. `targetId` is the
 * id of whichever entity `target` names (a business/appearance/product/
 * event/location id) — never a businessId-plus-optional-entity shape,
 * since Event and Location campaigns have no owning business at all
 * (event_members/location_members are independent of business_members —
 * see lib/permissions.ts's own doc comment on that). Every id is
 * re-verified server-side against the entity it claims to belong to and
 * against the caller's real membership before anything is written. */
export async function createOwnerQrCampaign(input: {
  name: string;
  target: QrCampaignTarget;
  targetId: string;
}): Promise<CreateResult> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Enter a name for this QR code." };
  if (!input.targetId) return { ok: false, error: "Choose a destination." };

  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };

  let destinationPath: string;
  let businessId: string | null = null;
  let appearanceId: string | null = null;
  let productId: string | null = null;
  let eventId: string | null = null;
  let locationId: string | null = null;

  if (input.target === "business") {
    try {
      await requireBusinessMember(input.targetId);
    } catch {
      return { ok: false, error: "You don't have access to this business." };
    }
    const { data: business } = await admin.from("businesses").select("id, slug").eq("id", input.targetId).maybeSingle();
    if (!business?.slug) return { ok: false, error: "Business not found." };
    businessId = business.id;
    destinationPath = `/business/${business.slug}`;
  } else if (input.target === "appearance") {
    // Ownership re-verified here — an appearance id submitted by the
    // client is NEVER trusted; it must actually exist, and the caller
    // must actually manage its business, or the request is rejected.
    const { data: appearance } = await admin.from("appearances").select("id, business_id").eq("id", input.targetId).maybeSingle();
    if (!appearance) return { ok: false, error: "Appearance not found." };
    try {
      await requireBusinessMember(appearance.business_id);
    } catch {
      return { ok: false, error: "You don't have access to this business." };
    }
    const { data: business } = await admin.from("businesses").select("slug").eq("id", appearance.business_id).maybeSingle();
    if (!business?.slug) return { ok: false, error: "Business not found." };
    businessId = appearance.business_id;
    appearanceId = appearance.id;
    destinationPath = `/business/${business.slug}${FINDMI_HERE_ANCHOR}`;
  } else if (input.target === "product") {
    const { data: product } = await admin.from("products").select("id, business_id, slug").eq("id", input.targetId).maybeSingle();
    if (!product) return { ok: false, error: "Product not found." };
    try {
      await requireBusinessMember(product.business_id);
    } catch {
      return { ok: false, error: "You don't have access to this business." };
    }
    businessId = product.business_id;
    productId = product.id;
    destinationPath = `/product/${product.slug}`;
  } else if (input.target === "event") {
    // Event ownership is independent of business ownership (event_members,
    // not business_members) — see lib/permissions.ts's requireEventMember.
    try {
      await requireEventMember(input.targetId);
    } catch {
      return { ok: false, error: "You don't have access to this event." };
    }
    const { data: event } = await admin.from("events").select("id, slug").eq("id", input.targetId).maybeSingle();
    if (!event?.slug) return { ok: false, error: "Event not found." };
    eventId = event.id;
    destinationPath = `/event/${event.slug}`;
  } else {
    // "location" — also independent of business ownership
    // (location_members, not business_members).
    try {
      await requireLocationMember(input.targetId);
    } catch {
      return { ok: false, error: "You don't have access to this location." };
    }
    const { data: location } = await admin.from("locations").select("id, slug").eq("id", input.targetId).maybeSingle();
    if (!location?.slug) return { ok: false, error: "Location not found." };
    locationId = location.id;
    destinationPath = `/location/${location.slug}`;
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
        event_id: eventId,
        location_id: locationId,
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
