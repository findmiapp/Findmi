import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TARGET_STATUS_LABELS, type TargetStatus } from "./business-targets-domain";
import { relationshipHref, relationshipRefFor } from "./relationship-links";
import { managerAppearanceHref, managerBase, managerProductHref, managerThreadHref, withOrigin } from "./manager-links";
import { inboxTypeLabel } from "./inbox";

/** Manager Search v1 — find things in ONE Business's managed world, by name,
 * from the existing records: its Products, Places (its own Locations), Events
 * (hosted or taking part), Appearances, Targets, Opportunities sent to it, and
 * (for a signed-in member) Conversations it is part of. Never Findmi's public
 * catalog, never another Business's private records: every read is filtered by
 * this Business first. Each source is capped, so a search is a handful of
 * small queries. Every result deep-links to its exact Manager destination. */

export type ManagerSearchType = "product" | "place" | "event" | "appearance" | "target" | "opportunity" | "conversation";

export const MANAGER_SEARCH_TYPE_LABELS: Record<ManagerSearchType, string> = {
  product: "Product",
  place: "Place",
  event: "Event",
  appearance: "Where I’ll Be",
  target: "Target",
  opportunity: "Opportunity",
  conversation: "Conversation",
};

export interface ManagerSearchResult {
  type: ManagerSearchType;
  title: string;
  /** "Target · In Conversation", "Conversation · Commercial Inquiry". */
  context: string;
  href: string;
}

/** Results per source. */
export const MANAGER_SEARCH_PER_TYPE = 5;
export const MANAGER_SEARCH_MIN = 2;

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** The search text as a safe ilike pattern (PostgREST wildcards escaped), or
 * null when it's too short to search. */
export function searchPattern(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < MANAGER_SEARCH_MIN) return null;
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ")}%`;
}

export async function searchManager(
  admin: SupabaseClient,
  businessId: string,
  rawQuery: unknown,
  conversations: readonly { id: string; otherPartyLabel: string; subjectType: string; myKeys: readonly string[] }[] = []
): Promise<ManagerSearchResult[]> {
  const pat = searchPattern(rawQuery);
  if (!pat) return [];
  const n = MANAGER_SEARCH_PER_TYPE;
  const b = managerBase(businessId);
  const label = (t: ManagerSearchType, extra?: string | null) => [MANAGER_SEARCH_TYPE_LABELS[t], extra].filter(Boolean).join(" · ");

  const [products, places, hosted, joined, appearances, opportunities, targetPlaces, targetBusinesses, targetEvents] = await Promise.all([
    admin.from("products").select("id, name").eq("business_id", businessId).is("trashed_at", null).ilike("name", pat).limit(n),
    admin.from("business_locations").select("location_id, location:locations!inner(id, name)").eq("business_id", businessId).ilike("location.name", pat).limit(n),
    admin.from("events").select("id, name").eq("host_business_id", businessId).is("trashed_at", null).ilike("name", pat).limit(n),
    admin.from("event_businesses").select("event_id, status, event:events!inner(id, name, slug)").eq("business_id", businessId).ilike("event.name", pat).limit(n),
    admin.from("appearances").select("id, title, start_at").eq("business_id", businessId).ilike("title", pat).order("start_at", { ascending: false }).limit(n),
    admin.from("opportunity_recipients").select("id, status, listing:opportunity_listings!inner(title)").eq("business_id", businessId).neq("status", "withdrawn").ilike("listing.title", pat).limit(n),
    // Targets: names first (capped), then only THIS Business's Targets on them.
    admin.from("locations").select("id, name").ilike("name", pat).limit(20),
    admin.from("businesses").select("id, name").neq("id", businessId).ilike("name", pat).limit(20),
    admin.from("events").select("id, name").ilike("name", pat).limit(20),
  ]);

  const names = new Map<string, string>();
  for (const r of [...((targetPlaces.data ?? []) as Row[]), ...((targetBusinesses.data ?? []) as Row[]), ...((targetEvents.data ?? []) as Row[])]) names.set(r.id as string, r.name as string);
  const idsOf = (res: { data: unknown }) => ((res.data ?? []) as Row[]).map((r) => r.id as string);
  const placeIds = idsOf(targetPlaces);
  const bizIds = idsOf(targetBusinesses);
  const eventIds = idsOf(targetEvents);
  const filters = [
    placeIds.length ? `target_location_id.in.(${placeIds.join(",")})` : null,
    bizIds.length ? `target_business_id.in.(${bizIds.join(",")})` : null,
    eventIds.length ? `target_event_id.in.(${eventIds.join(",")})` : null,
  ].filter(Boolean);
  const targets = filters.length
    ? await admin.from("business_targets").select("id, status, target_location_id, target_business_id, target_event_id").eq("business_id", businessId).or(filters.join(",")).limit(n)
    : { data: [] as Row[] };

  const out: ManagerSearchResult[] = [];
  for (const r of (products.data ?? []) as Row[]) out.push({ type: "product", title: r.name as string, context: label("product"), href: managerProductHref(businessId, r.id as string) });
  for (const r of (places.data ?? []) as Row[]) {
    const l = one(r.location as Row | Row[] | null);
    if (l) out.push({ type: "place", title: l.name as string, context: label("place", "Your Location"), href: `${relationshipHref(businessId, { kind: "location", locationId: l.id as string })}&from=search` });
  }
  for (const r of (hosted.data ?? []) as Row[]) out.push({ type: "event", title: r.name as string, context: label("event", "Hosting"), href: `/account/event/${r.id as string}?business_id=${businessId}` });
  for (const r of (joined.data ?? []) as Row[]) {
    const e = one(r.event as Row | Row[] | null);
    if (e && !out.some((x) => x.type === "event" && x.title === e.name)) out.push({ type: "event", title: e.name as string, context: label("event", "Taking Part"), href: `/event/${e.slug as string}` });
  }
  for (const r of (appearances.data ?? []) as Row[]) out.push({ type: "appearance", title: r.title as string, context: label("appearance"), href: managerAppearanceHref(businessId, r.id as string) });
  for (const r of (targets.data ?? []) as Row[]) {
    const kind = r.target_location_id ? "location" : r.target_business_id ? "business" : "event";
    const counterparty = (r.target_location_id ?? r.target_business_id ?? r.target_event_id) as string;
    const ref = relationshipRefFor(kind, { targetId: r.id as string, locationId: (r.target_location_id as string | null) ?? null });
    out.push({ type: "target", title: names.get(counterparty) ?? "Target", context: label("target", TARGET_STATUS_LABELS[r.status as TargetStatus]), href: `${relationshipHref(businessId, ref)}&from=search` });
  }
  for (const r of (opportunities.data ?? []) as Row[]) {
    const l = one(r.listing as Row | Row[] | null);
    if (l) out.push({ type: "opportunity", title: l.title as string, context: label("opportunity"), href: `${b}/opportunities/${r.id as string}` });
  }
  const needle = (typeof rawQuery === "string" ? rawQuery : "").trim().toLowerCase();
  for (const c of conversations.filter((x) => x.myKeys.includes(`business:${businessId}`) && x.otherPartyLabel.toLowerCase().includes(needle)).slice(0, n)) {
    out.push({ type: "conversation", title: c.otherPartyLabel, context: label("conversation", inboxTypeLabel(c.subjectType)), href: withOrigin(managerThreadHref(businessId, c.id), "search") });
  }
  return out;
}
