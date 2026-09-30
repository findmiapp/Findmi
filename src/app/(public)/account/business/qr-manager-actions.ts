"use server";

// QR Campaigns V2 — Pass 2 owner mutations for the Campaign Manager
// (create via the Intelligent Creator, edit, lifecycle, duplicate).
// Deliberately separate from qr-actions.ts's createOwnerQrCampaign,
// which stays exactly as it was for backward compatibility with its
// existing callers (contextual per-entity creation, QrCampaignCreator).
//
// Every mutation re-verifies authorization and eligibility server-side —
// never trusts a businessId/campaignId/eventId/locationId/productId
// supplied by the client just because it was supplied.
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember, requireEventMember, requireLocationMember } from "@/lib/permissions";
import { generateQrCode } from "@/lib/analytics/qrCode";
import { validateCustomDestination } from "@/lib/navigation";
import {
  deriveQrContextFromAppearance,
  getBusinessQrEligibleEvents,
  getBusinessQrEligibleLocations,
  type QrCampaignStatus,
  type QrDestinationType,
} from "@/lib/qr-v2";
import { getPublicOrigin } from "@/lib/site-url";
import type { CreatedQrCampaign } from "./qr-actions";
import QRCode from "qrcode";

export type QrContextType = "appearance" | "business" | "product" | "event" | "location";

export interface CreateIntelligentQrInput {
  businessId: string;
  contextType: QrContextType;
  /** Ignored for contextType "business" (the Business itself is the context). */
  contextId?: string;
  destinationType: QrDestinationType;
  /** Required for business/product/event/location destination types. */
  destinationId?: string;
  /** Required for the "custom" destination type. */
  destinationUrl?: string;
  name: string;
  placement: string | null;
}

export type QrCreateResult = { ok: true; campaign: CreatedQrCampaign } | { ok: false; error: string };
export type QrSimpleResult = { ok: true } | { ok: false; error: string };

type DestinationResolution =
  | { ok: true; destinationId: string | null; destinationUrl: string | null; destinationPath: string }
  | { ok: false; error: string };

/** Shared by create and edit — resolves + re-verifies a destination
 * against `businessId`'s own legitimate objects (never trusts a raw id).
 * Event/Location destinations use the exact same business-aware
 * eligibility Foundation established for CONTEXT, applied here to
 * destination too — the safest, most consistent bar available, and the
 * one place this codebase already defines "does this Business
 * legitimately reach this Event/Location." */
async function resolveAndVerifyDestination(
  admin: SupabaseClient,
  businessId: string,
  destinationType: QrDestinationType,
  destinationId?: string,
  destinationUrl?: string
): Promise<DestinationResolution> {
  if (destinationType === "business") {
    const { data: business } = await admin.from("businesses").select("id, slug").eq("id", businessId).maybeSingle();
    if (!business?.slug) return { ok: false, error: "Business not found." };
    return { ok: true, destinationId: business.id, destinationUrl: null, destinationPath: `/business/${business.slug}` };
  }
  if (destinationType === "product") {
    if (!destinationId) return { ok: false, error: "Choose a product." };
    const { data: product } = await admin.from("products").select("id, business_id, slug").eq("id", destinationId).maybeSingle();
    if (!product || product.business_id !== businessId) return { ok: false, error: "That product isn't available for this business." };
    return { ok: true, destinationId: product.id, destinationUrl: null, destinationPath: `/product/${product.slug}` };
  }
  if (destinationType === "event") {
    if (!destinationId) return { ok: false, error: "Choose an event." };
    const eligible = await getBusinessQrEligibleEvents(admin, businessId);
    if (!eligible.some((e) => e.id === destinationId)) return { ok: false, error: "That event isn't associated with this business." };
    const { data: event } = await admin.from("events").select("id, slug").eq("id", destinationId).maybeSingle();
    if (!event?.slug) return { ok: false, error: "Event not found." };
    return { ok: true, destinationId: event.id, destinationUrl: null, destinationPath: `/event/${event.slug}` };
  }
  if (destinationType === "location") {
    if (!destinationId) return { ok: false, error: "Choose a location." };
    const eligible = await getBusinessQrEligibleLocations(admin, businessId);
    if (!eligible.some((l) => l.id === destinationId)) return { ok: false, error: "That location isn't associated with this business." };
    const { data: location } = await admin.from("locations").select("id, slug").eq("id", destinationId).maybeSingle();
    if (!location?.slug) return { ok: false, error: "Location not found." };
    return { ok: true, destinationId: location.id, destinationUrl: null, destinationPath: `/location/${location.slug}` };
  }
  // "custom" — server-side validation only, never trusts client validation.
  if (!destinationUrl) return { ok: false, error: "Enter a destination link." };
  const validated = validateCustomDestination(destinationUrl);
  if (!validated.ok) return { ok: false, error: validated.error };
  // destination_path is never consulted once destination_type is set (see
  // resolveQrDestination) — the column is just NOT NULL. Store the
  // internal path verbatim when the custom value is one; otherwise an
  // inert placeholder.
  const destinationPath = validated.value.startsWith("/") ? validated.value : "/";
  return { ok: true, destinationId: null, destinationUrl: validated.value, destinationPath };
}

interface OwnerCheckRow {
  business_id: string | null;
  event_id: string | null;
  location_id: string | null;
}

/** Same dispatch every existing QR reopen path already uses (see
 * account/qr/[id]/page.tsx) — a campaign always has exactly one of these
 * three relationship columns populated as its OWNING relationship. */
async function authorizeQrCampaignOwner(row: OwnerCheckRow): Promise<boolean> {
  try {
    if (row.business_id) {
      await requireBusinessMember(row.business_id);
      return true;
    }
    if (row.event_id) {
      await requireEventMember(row.event_id);
      return true;
    }
    if (row.location_id) {
      await requireLocationMember(row.location_id);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function buildCreatedCampaign(name: string, code: string, id: string, destinationPath: string): Promise<CreatedQrCampaign> {
  const qrUrl = `${getPublicOrigin()}/q/${code}`;
  const qrSvg = await QRCode.toString(qrUrl, { type: "svg", margin: 1, width: 320 }).catch(() => "");
  return { id, name, code, qrUrl, destinationPath, qrSvg };
}

/** The Intelligent Creator's create action — always Business-scoped
 * (Step 1's "What is this QR for?" is always answered in the context of
 * a specific, already-authorized Business). Populates every relevant
 * context field at once (business_id plus whichever of appearance_id/
 * event_id/event_occurrence_id/location_id/product_id genuinely applies)
 * rather than only one — the same rich, multi-dimensional attribution
 * the Foundation's own "Native Rose at Minthorne" example describes.
 * Destination is resolved completely independently of context. */
export async function createIntelligentQrCampaign(input: CreateIntelligentQrInput): Promise<QrCreateResult> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Enter a name for this QR code." };

  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };

  try {
    await requireBusinessMember(input.businessId);
  } catch {
    return { ok: false, error: "You don't have access to this business." };
  }

  let appearanceId: string | null = null;
  let eventId: string | null = null;
  let eventOccurrenceId: string | null = null;
  let locationId: string | null = null;
  let productId: string | null = null;

  if (input.contextType === "appearance") {
    if (!input.contextId) return { ok: false, error: "Choose an appearance." };
    const { data: appearance } = await admin.from("appearances").select("id, business_id").eq("id", input.contextId).maybeSingle();
    if (!appearance || appearance.business_id !== input.businessId) {
      return { ok: false, error: "That appearance isn't available for this business." };
    }
    const derived = await deriveQrContextFromAppearance(admin, input.contextId);
    if (!derived) return { ok: false, error: "That appearance couldn't be found." };
    appearanceId = derived.appearanceId;
    eventId = derived.eventId;
    eventOccurrenceId = derived.eventOccurrenceId;
    locationId = derived.locationId;
  } else if (input.contextType === "product") {
    if (!input.contextId) return { ok: false, error: "Choose a product." };
    const { data: product } = await admin.from("products").select("id, business_id").eq("id", input.contextId).maybeSingle();
    if (!product || product.business_id !== input.businessId) {
      return { ok: false, error: "That product isn't available for this business." };
    }
    productId = product.id;
  } else if (input.contextType === "event") {
    if (!input.contextId) return { ok: false, error: "Choose an event." };
    const eligible = await getBusinessQrEligibleEvents(admin, input.businessId);
    if (!eligible.some((e) => e.id === input.contextId)) return { ok: false, error: "That event isn't associated with this business." };
    eventId = input.contextId;
  } else if (input.contextType === "location") {
    if (!input.contextId) return { ok: false, error: "Choose a location." };
    const eligible = await getBusinessQrEligibleLocations(admin, input.businessId);
    if (!eligible.some((l) => l.id === input.contextId)) return { ok: false, error: "That location isn't associated with this business." };
    locationId = input.contextId;
  }
  // "business" — no extra id needed; business_id alone is the context.

  const destination = await resolveAndVerifyDestination(admin, input.businessId, input.destinationType, input.destinationId, input.destinationUrl);
  if (!destination.ok) return { ok: false, error: destination.error };

  const placement = input.placement?.trim().slice(0, 60) || null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateQrCode();
    const { data: inserted, error } = await admin
      .from("qr_campaigns")
      .insert({
        name,
        code,
        business_id: input.businessId,
        appearance_id: appearanceId,
        event_id: eventId,
        event_occurrence_id: eventOccurrenceId,
        location_id: locationId,
        product_id: productId,
        destination_type: input.destinationType,
        destination_id: destination.destinationId,
        destination_url: destination.destinationUrl,
        destination_path: destination.destinationPath,
        placement,
        campaign_label: null,
        status: "active",
        is_active: true,
      })
      .select("id")
      .single();
    if (!error && inserted) {
      revalidatePath(`/account/business/${input.businessId}/qr`);
      return { ok: true, campaign: await buildCreatedCampaign(name, code, inserted.id, destination.destinationPath) };
    }
    if (error && error.code !== "23505") return { ok: false, error: "Could not create this QR code. Please try again." };
  }
  return { ok: false, error: "Could not generate a unique code. Please try again." };
}

export interface UpdateQrCampaignInput {
  campaignId: string;
  name?: string;
  placement?: string | null;
  destinationType?: QrDestinationType;
  destinationId?: string;
  destinationUrl?: string;
}

/** Edits name/placement/destination WITHOUT ever touching id, code,
 * status, context fields, or analytics history — the printed QR keeps
 * working exactly as before. */
export async function updateQrCampaign(input: UpdateQrCampaignInput): Promise<QrSimpleResult> {
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };

  const { data: row } = await admin
    .from("qr_campaigns")
    .select("id, business_id, event_id, location_id")
    .eq("id", input.campaignId)
    .maybeSingle();
  if (!row) return { ok: false, error: "QR campaign not found." };
  if (!(await authorizeQrCampaignOwner(row))) return { ok: false, error: "You don't have access to this QR code." };

  const updates: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 120);
    if (!name) return { ok: false, error: "Enter a name for this QR code." };
    updates.name = name;
  }
  if (input.placement !== undefined) {
    updates.placement = input.placement?.trim().slice(0, 60) || null;
  }
  if (input.destinationType) {
    if (!row.business_id) {
      return { ok: false, error: "This QR isn't associated with a Business, so its destination can't be edited here yet." };
    }
    const destination = await resolveAndVerifyDestination(admin, row.business_id, input.destinationType, input.destinationId, input.destinationUrl);
    if (!destination.ok) return { ok: false, error: destination.error };
    updates.destination_type = input.destinationType;
    updates.destination_id = destination.destinationId;
    updates.destination_url = destination.destinationUrl;
    updates.destination_path = destination.destinationPath;
  }

  if (Object.keys(updates).length === 0) return { ok: true };
  updates.updated_at = new Date().toISOString();

  const { error } = await admin.from("qr_campaigns").update(updates).eq("id", input.campaignId);
  if (error) return { ok: false, error: "Could not save changes. Please try again." };

  revalidatePath(`/account/qr/${input.campaignId}`);
  if (row.business_id) revalidatePath(`/account/business/${row.business_id}/qr`);
  return { ok: true };
}

const LIFECYCLE_TRANSITIONS: Record<QrCampaignStatus, QrCampaignStatus[]> = {
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  // Archived is terminal — never automatically or manually reactivated;
  // Duplicate is the supported way to get a new active campaign from one.
  archived: [],
};

/** Pause/Reactivate/Archive — status is the single lifecycle authority;
 * is_active is kept in lockstep (see the Foundation migration/report) so
 * the two columns can never disagree. Never deletes anything. */
export async function setQrCampaignLifecycle(campaignId: string, targetStatus: QrCampaignStatus): Promise<QrSimpleResult> {
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };

  const { data: row } = await admin
    .from("qr_campaigns")
    .select("id, business_id, event_id, location_id, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (!row) return { ok: false, error: "QR campaign not found." };
  if (!(await authorizeQrCampaignOwner(row))) return { ok: false, error: "You don't have access to this QR code." };

  const current = row.status as QrCampaignStatus;
  if (current === targetStatus) return { ok: true };
  if (!LIFECYCLE_TRANSITIONS[current]?.includes(targetStatus)) {
    return { ok: false, error: "That status change isn't allowed." };
  }

  const { error } = await admin
    .from("qr_campaigns")
    .update({ status: targetStatus, is_active: targetStatus === "active", updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (error) return { ok: false, error: "Could not update status. Please try again." };

  revalidatePath(`/account/qr/${campaignId}`);
  if (row.business_id) revalidatePath(`/account/business/${row.business_id}/qr`);
  return { ok: true };
}

/** Duplicate — a genuinely new campaign: new id, new code, copied
 * context/placement/destination, status reset to active. Analytics/scan/
 * acquisition history is never copied (it can't be — it all keys off the
 * ORIGINAL campaign's own id, which this never reuses). */
export async function duplicateQrCampaign(campaignId: string): Promise<QrCreateResult> {
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };

  const { data: row } = await admin.from("qr_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!row) return { ok: false, error: "QR campaign not found." };
  if (!(await authorizeQrCampaignOwner(row))) return { ok: false, error: "You don't have access to this QR code." };

  const name = `${row.name} Copy`.slice(0, 120);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateQrCode();
    const { data: inserted, error } = await admin
      .from("qr_campaigns")
      .insert({
        name,
        code,
        business_id: row.business_id,
        appearance_id: row.appearance_id,
        event_id: row.event_id,
        event_occurrence_id: row.event_occurrence_id,
        location_id: row.location_id,
        product_id: row.product_id,
        destination_type: row.destination_type,
        destination_id: row.destination_id,
        destination_url: row.destination_url,
        destination_path: row.destination_path,
        placement: row.placement,
        campaign_label: null,
        status: "active",
        is_active: true,
      })
      .select("id")
      .single();
    if (!error && inserted) {
      if (row.business_id) revalidatePath(`/account/business/${row.business_id}/qr`);
      return { ok: true, campaign: await buildCreatedCampaign(name, code, inserted.id, row.destination_path) };
    }
    if (error && error.code !== "23505") return { ok: false, error: "Could not duplicate this QR code. Please try again." };
  }
  return { ok: false, error: "Could not generate a unique code. Please try again." };
}
