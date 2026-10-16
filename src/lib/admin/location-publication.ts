import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntityManagerEmails } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";

/** Admin Location publication — the ONE implementation of "Published on /
 * off" shared by the single-Location editor (saveLocation) and the Admin
 * Locations bulk Publish / Unpublish. The canonical field is the existing
 * `locations.is_demo` (false = publicly listed = PUBLISHED; true = active
 * but not listed = DRAFT); Archive / Trash stay the separate archived_at /
 * trashed_at columns. Nothing else is written: no ownership, membership,
 * Business / Event / Appearance / Find Us At relationship is touched — a
 * Draft Location keeps every reference, and public surfaces already stop
 * linking it (lib/location-links.ts publicLocationHref). Server-only. */

/** Location review-decision notification — every CURRENT location_members
 * recipient, same shape as notifyBusinessOwners/notifyEventOrganizers
 * (admin/businesses|events/actions.ts). Location's own review state is
 * just the one is_demo boolean (no separate rejected/paused states exist
 * for Location, unlike Business/Event's richer publication_status) — so
 * "approved" is the true->false transition and "rejected" is the
 * false->true transition; copy is worded to stay honest either way
 * (a first review decision, or a later un-publish) since the schema
 * can't distinguish those two cases from each other. Best-effort: a
 * Resend failure never affects the save that already committed. */
export async function notifyLocationManagers(
  supabase: SupabaseClient,
  locationId: string,
  locationName: string,
  outcome: "approved" | "rejected"
): Promise<void> {
  const to = await getEntityManagerEmails(supabase, "location", locationId);
  const copy =
    outcome === "approved"
      ? {
          type: "location_approved",
          subject: `Your venue is now live — ${locationName}`,
          heading: "Your venue is now live",
          body: [`${locationName} has been approved and is now visible on Findmi.`],
        }
      : {
          type: "location_rejected",
          subject: `Update on your venue — ${locationName}`,
          heading: "Your venue isn't visible on Findmi",
          body: [
            `${locationName} isn't visible on Findmi right now.`,
            "You can review your venue details — it can be made visible again once it's ready.",
          ],
        };

  await sendProductNotification({
    to,
    type: copy.type,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    actionLabel: `Manage ${locationName}`,
    actionUrl: `/account/location/${locationId}`,
  });
}

export type LocationPublicationOutcome = "changed" | "already" | "inactive" | "missing" | "failed";

export interface LocationPublicationResult {
  publish: boolean;
  /** Ids whose state changed (now Published / now Draft). */
  changed: string[];
  /** Already in the requested state — left unchanged (idempotent). */
  already: string[];
  /** Archived or in Trash — publication only applies to active Locations. */
  inactive: string[];
  /** Not found (deleted meanwhile, or not a Location id). */
  missing: string[];
  /** The update didn't confirm these — still in their old state, retryable. */
  failed: string[];
  /** Slugs of changed Locations (for revalidating their public pages). */
  changedSlugs: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOCATION_BULK_MAX = 500;

/** Only well-formed, distinct ids (never trusted beyond that: every id is
 * re-read from the database before anything is written). */
export function cleanLocationIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && UUID.test(v)))].slice(0, LOCATION_BULK_MAX);
}

/** Publish (is_demo = false) or Unpublish → Draft (is_demo = true) the
 * given ACTIVE Locations. Idempotent: rows already in that state, and
 * archived / trashed rows, are reported and left untouched. Only rows the
 * update itself returns count as changed — anything else is "failed" (never
 * claimed as success). Managers are notified exactly as the single editor
 * does, on a real transition only; a notification failure never undoes the
 * change. */
export async function setLocationPublication(
  supabase: SupabaseClient,
  ids: string[],
  publish: boolean,
  notify: (supabase: SupabaseClient, id: string, name: string, outcome: "approved" | "rejected") => Promise<void> = notifyLocationManagers
): Promise<LocationPublicationResult> {
  const result: LocationPublicationResult = { publish, changed: [], already: [], inactive: [], missing: [], failed: [], changedSlugs: [] };
  if (ids.length === 0) return result;
  const { data, error } = await supabase.from("locations").select("id, name, slug, is_demo, archived_at, trashed_at").in("id", ids);
  if (error) return { ...result, failed: [...ids] };
  const rows = new Map(((data ?? []) as { id: string; name: string; slug: string; is_demo: boolean; archived_at: string | null; trashed_at: string | null }[]).map((r) => [r.id, r]));
  const toChange: string[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) result.missing.push(id);
    else if (row.archived_at || row.trashed_at) result.inactive.push(id);
    else if (row.is_demo === !publish) result.already.push(id);
    else toChange.push(id);
  }
  if (toChange.length === 0) return result;
  const { data: updated, error: updateError } = await supabase
    .from("locations")
    .update({ is_demo: !publish })
    .in("id", toChange)
    // Same guard as the selection: never flips an archived / trashed row,
    // even if it changed state between the read and the write.
    .is("archived_at", null)
    .is("trashed_at", null)
    .select("id");
  const confirmed = new Set(updateError ? [] : ((updated ?? []) as { id: string }[]).map((r) => r.id));
  for (const id of toChange) {
    if (!confirmed.has(id)) {
      result.failed.push(id);
      continue;
    }
    const row = rows.get(id)!;
    result.changed.push(id);
    result.changedSlugs.push(row.slug);
    try {
      await notify(supabase, id, row.name, publish ? "approved" : "rejected");
    } catch {
      // best effort — the publication change already committed
    }
  }
  return result;
}

/** One honest summary line ("3 Published · 2 Already Published · 1 Failed"). */
export function describeLocationPublication(r: LocationPublicationResult): string {
  const n = (k: number, word = "Location") => `${k} ${word}${k === 1 ? "" : "s"}`;
  const verb = r.publish ? "Published" : "Unpublished (Draft)";
  const parts = [`${n(r.changed.length)} ${verb}`];
  if (r.already.length) parts.push(`${r.already.length} Already ${r.publish ? "Published" : "Draft"}`);
  if (r.inactive.length) parts.push(`${r.inactive.length} Skipped (Archived or in Trash)`);
  if (r.missing.length) parts.push(`${r.missing.length} Not Found`);
  if (r.failed.length) parts.push(`${r.failed.length} Failed — still selected, try again`);
  return parts.join(" · ");
}
