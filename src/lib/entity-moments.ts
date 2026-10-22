import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntityMomentDisplay, type MomentDisplayEntity, type MomentDisplayState } from "./entity-moment-display";

/** The Moments that can appear on a Location's or an Event's public page — read for
 * the page's manager, who decides which ones are shown, featured or hidden there.
 * Exactly the public page's own rule (public + published, and connected to it: a
 * Location's own `location_id`, an Event's connection to the Event or any of its
 * dates), so the manager sees what a visitor could see and nothing else. Service-role
 * client; the caller authorizes the entity first. */

export type EntityMomentKind = Exclude<MomentDisplayEntity, "business">;
const LIMIT = 200;

export interface EntityMoment {
  id: string;
  title: string;
  entryDate: string;
  authorLabel: string | null;
  display: MomentDisplayState;
}

/** The Moment ids that are eligible to appear on this entity's page. */
async function eligibleEntryIds(admin: SupabaseClient, kind: EntityMomentKind, entityId: string): Promise<string[]> {
  if (kind === "location") {
    const { data } = await admin.from("journal_entries").select("id").eq("location_id", entityId).eq("visibility", "public").eq("status", "published").limit(LIMIT);
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  }
  const { data: occ } = await admin.from("event_occurrences").select("id").eq("event_id", entityId).limit(500);
  const occurrenceIds = ((occ ?? []) as { id: string }[]).map((o) => o.id);
  const filter = occurrenceIds.length > 0 ? `event_id.eq.${entityId},event_occurrence_id.in.(${occurrenceIds.join(",")})` : `event_id.eq.${entityId}`;
  const { data: conns } = await admin.from("journal_entry_connections").select("journal_entry_id").or(filter).limit(LIMIT * 2);
  const ids = [...new Set(((conns ?? []) as { journal_entry_id: string }[]).map((c) => c.journal_entry_id))];
  if (ids.length === 0) return [];
  const { data } = await admin.from("journal_entries").select("id").in("id", ids.slice(0, LIMIT)).eq("visibility", "public").eq("status", "published");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export async function isEntryOnEntityPage(admin: SupabaseClient, kind: EntityMomentKind, entityId: string, entryId: string): Promise<boolean> {
  if (kind === "location") {
    const { data } = await admin.from("journal_entries").select("id").eq("id", entryId).eq("location_id", entityId).eq("visibility", "public").eq("status", "published").maybeSingle();
    return Boolean(data);
  }
  return (await eligibleEntryIds(admin, kind, entityId)).includes(entryId);
}

export async function getEntityMoments(admin: SupabaseClient, kind: EntityMomentKind, entityId: string): Promise<EntityMoment[]> {
  const ids = await eligibleEntryIds(admin, kind, entityId);
  if (ids.length === 0) return [];
  const [{ data }, display] = await Promise.all([
    admin.from("journal_entries").select("id, title, entry_date, author_label").in("id", ids).order("entry_date", { ascending: false }).limit(LIMIT),
    getEntityMomentDisplay(admin, kind, entityId),
  ]);
  const hidden = new Set(display.hidden);
  return ((data ?? []) as { id: string; title: string; entry_date: string; author_label: string | null }[]).map((r) => ({
    id: r.id,
    title: r.title,
    entryDate: r.entry_date,
    authorLabel: r.author_label,
    display: hidden.has(r.id) ? "hidden" : display.featured === r.id ? "featured" : "shown",
  }));
}
