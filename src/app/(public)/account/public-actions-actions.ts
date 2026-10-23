"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getCurrentUser } from "@/lib/supabase/server";
import { requireBusinessMember, requireEventMember, requireLocationMember } from "@/lib/permissions";
import { isPageManagerRole } from "@/lib/capabilities";
import { isTargetKind, type TargetKind } from "@/lib/commercial-intents";
import { TARGET_STATUS_LABELS } from "@/lib/business-targets-domain";
import { addBusinessTarget } from "@/lib/business-targets";
import { getEntityRelationships } from "@/lib/relationship-context";
import { relationshipHref, relationshipRefFor } from "@/lib/relationship-links";
import { actionIntent, actionRoute, validatePublicActions } from "@/lib/public-actions-domain";
import { entityOpportunityIds, readPublicActions, savePublicActions } from "@/lib/public-actions";

/** Public Actions — the server side of the public entity action bar and of
 * the manager's Public Actions settings. Every call re-reads the session and
 * the entity's saved actions; nothing the browser sends decides who acts,
 * which entity, or what an action does. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_PATH: Record<TargetKind, string> = { business: "business", location: "location", event: "event" };
const ENTITY_TABLE: Record<TargetKind, "businesses" | "locations" | "events"> = { business: "businesses", location: "locations", event: "events" };

export interface ActingBusiness {
  id: string;
  name: string;
  /** This Business's own relationship state with the entity — shown only
   * to its own signed-in manager, once it is the acting Business. */
  status: string | null;
  relationshipHref: string | null;
}

/** Who may act from a public page: the signed-in person's own active
 * Businesses where they're an owner or manager (never the entity itself). */
async function actingBusinesses(kind: TargetKind, entityId: string): Promise<{ signedIn: boolean; userId: string | null; businesses: { id: string; name: string; role: string }[] }> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { signedIn: false, userId: null, businesses: [] };
  const admin = getAdminSupabase();
  if (!admin) return { signedIn: true, userId: user.id, businesses: [] };
  const { data } = await admin
    .from("business_members")
    .select("business_id, role, business:businesses(id, name, archived_at, trashed_at)")
    .eq("user_id", user.id)
    .limit(25);
  type B = { id: string; name: string; archived_at: string | null; trashed_at: string | null };
  const businesses = ((data ?? []) as unknown as { role: string; business: B | B[] | null }[])
    .map((r) => ({ role: r.role, b: Array.isArray(r.business) ? r.business[0] : r.business }))
    .filter((r): r is { role: string; b: B } => Boolean(r.b && !r.b.archived_at && !r.b.trashed_at) && isPageManagerRole(r.role))
    .filter((r) => !(kind === "business" && r.b.id === entityId))
    .map((r) => ({ id: r.b.id, name: r.b.name, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { signedIn: true, userId: user.id, businesses };
}

/** Opened when a visitor taps an action that needs a Business. */
export async function getPublicActionContextAction(kind: string, entityId: string): Promise<{ signedIn: boolean; businesses: ActingBusiness[] }> {
  if (!isTargetKind(kind) || !UUID.test(entityId)) return { signedIn: false, businesses: [] };
  const ctx = await actingBusinesses(kind, entityId);
  if (!ctx.businesses.length) return { signedIn: ctx.signedIn, businesses: [] };
  const admin = getAdminSupabase();
  const rel = admin ? await getEntityRelationships(admin, ctx.businesses, kind, entityId) : [];
  return {
    signedIn: true,
    businesses: ctx.businesses.map((b) => {
      const r = rel.find((x) => x.businessId === b.id);
      return { id: b.id, name: b.name, status: r?.status ? TARGET_STATUS_LABELS[r.status] : null, relationshipHref: r?.status ? r.href : null };
    }),
  };
}

/** Continue a configured action as one of the person's Businesses:
 *   Commercial Inquiry → the Business's private Target with this entity
 *     (reused, or created through the existing authorized path with the
 *     action's intent), then its composer — nothing is sent;
 *   Opportunity → that existing Opportunity for this Business. */
export async function startPublicActionAction(businessId: string, kind: string, entityId: string, slot: number): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  if (!isTargetKind(kind) || !UUID.test(entityId) || !UUID.test(businessId)) return { ok: false, error: "That action isn't available." };
  const ctx = await actingBusinesses(kind, entityId);
  if (!ctx.signedIn) return { ok: false, error: "Sign in to continue." };
  if (!ctx.businesses.some((b) => b.id === businessId)) return { ok: false, error: "Choose one of your Businesses." };
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const action = (await readPublicActions(admin, kind, entityId))?.[slot - 1];
  if (!action || !action.enabled) return { ok: false, error: "That action isn't available anymore." };
  const route = actionRoute(action.type);
  if (route === "opportunity") {
    const open = await entityOpportunityIds(admin, kind, entityId);
    if (!action.opportunityListingId || !open.includes(action.opportunityListingId)) return { ok: false, error: "That Opportunity isn't open anymore." };
    return { ok: true, href: `/account/business/${businessId}/opportunities/explore/${action.opportunityListingId}` };
  }
  const intent = actionIntent(action.type);
  if (route !== "commercial_inquiry" || !intent) return { ok: false, error: "That action isn't available." };
  const result = await addBusinessTarget(admin, businessId, { kind, counterpartyId: entityId, intents: [intent], source: "business", userId: ctx.userId });
  if (!result.ok) return result;
  const href = relationshipHref(businessId, relationshipRefFor(kind, { targetId: result.id, locationId: result.locationId }));
  revalidatePath(`/account/business/${businessId}`);
  return { ok: true, href: `${href}&inquire=${intent}` };
}

/** "Explore Opportunities" from a public page, as one of the person's Businesses. */
export async function openEntityOpportunitiesAction(businessId: string, kind: string, entityId: string): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  if (!isTargetKind(kind) || !UUID.test(entityId) || !UUID.test(businessId)) return { ok: false, error: "That isn't available." };
  const ctx = await actingBusinesses(kind, entityId);
  if (!ctx.businesses.some((b) => b.id === businessId)) return { ok: false, error: "Choose one of your Businesses." };
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const ids = await entityOpportunityIds(admin, kind, entityId);
  if (!ids.length) return { ok: false, error: "There are no open Opportunities here right now." };
  return { ok: true, href: ids.length === 1 ? `/account/business/${businessId}/opportunities/explore/${ids[0]}` : `/account/business/${businessId}?tab=opportunities&view=explore` };
}

/** Save an entity's Public Actions — its owners / managers (or a founder
 * Admin session) only. */
export async function savePublicActionsAction(kind: string, entityId: string, items: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isTargetKind(kind) || !UUID.test(entityId)) return { ok: false, error: "That page wasn't found." };
  try {
    const membership = kind === "business" ? await requireBusinessMember(entityId) : kind === "location" ? await requireLocationMember(entityId) : await requireEventMember(entityId);
    if (!membership.viaAdmin && !isPageManagerRole(membership.role)) return { ok: false, error: "Only an owner or manager can change Public Actions." };
  } catch {
    return { ok: false, error: "You don't have access to this page." };
  }
  const checked = validatePublicActions(kind, items);
  if (!checked.ok) return checked;
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured for this action." };
  const user = await getCurrentUser().catch(() => null);
  const saved = await savePublicActions(admin, kind, entityId, checked.value, user?.id ?? null);
  if (!saved.ok) return saved;
  const { data } = await admin.from(ENTITY_TABLE[kind]).select("slug").eq("id", entityId).maybeSingle();
  const slug = (data as { slug: string | null } | null)?.slug;
  if (slug) revalidatePath(`/${PUBLIC_PATH[kind]}/${slug}`);
  return { ok: true };
}
