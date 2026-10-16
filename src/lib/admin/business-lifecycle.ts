import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntityManagerEmails } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";
import { BUSINESS_TRANSITION_RULE, businessEligibility, type BusinessTransition } from "./lifecycle-eligibility";

export type { BusinessTransition };

/** Admin Business lifecycle — the ONE implementation of the Business
 * moderation transitions, shared by the single-Business controls (Approve
 * / Reject / Pause / Restore) and the Businesses list bulk toolbar, so the
 * two can never drift. Existing canonical columns only:
 *
 *   businesses.publication_status  draft | pending_review | live | paused | rejected
 *     Approve  pending_review → live      (owners notified "live")
 *     Reject   pending_review → rejected  (owners notified "rejected")
 *     Pause    live → paused              (owners notified "paused")
 *     Resume   paused → live              (owners notified "restored")
 *   businesses.is_demo  — a SEPARATE flag (demo vs real); never touched here.
 *   archived_at / trashed_at — the existing Archive / Trash (unchanged).
 *
 * A public Business page needs is_demo = false AND publication_status =
 * 'live' (getBusinessBySlug): for an imported Business (is_demo = false),
 * Approve IS publication. Each transition writes ONLY publication_status,
 * guarded by its exact source state — never ownership, membership, plan /
 * Pro / billing, verification, Events, Appearances, Products or Locations.
 * Owners are notified exactly once, on a real transition. Server-only. */

/** Business review-decision notification — every CURRENT
 * business_members recipient (see getEntityManagerEmails), never the
 * public listing's own contact email. Best-effort: a Resend failure
 * never affects the moderation decision itself, which has already
 * committed by the time this is called. */
export async function notifyBusinessOwners(
  supabase: SupabaseClient,
  businessId: string,
  businessName: string,
  outcome: "live" | "rejected" | "paused" | "restored"
): Promise<void> {
  const to = await getEntityManagerEmails(supabase, "business", businessId);
  const copyByOutcome: Record<typeof outcome, { type: string; subject: string; heading: string; body: string[] }> = {
    live: {
      type: "business_approved",
      subject: `Your Business is now live — ${businessName}`,
      heading: "Your Business is now live",
      body: [`${businessName} has been approved and is now visible on Findmi.`],
    },
    rejected: {
      type: "business_rejected",
      subject: `Update on your Business — ${businessName}`,
      heading: "Your Business wasn't approved",
      body: [
        `${businessName} wasn't approved for publication this time.`,
        "You can review and update your Business details, then resubmit for review.",
      ],
    },
    paused: {
      type: "business_paused",
      subject: `Your Business was paused — ${businessName}`,
      heading: "Your Business was paused",
      body: [`${businessName} has been temporarily paused and is no longer visible on Findmi.`],
    },
    restored: {
      type: "business_restored",
      subject: `Your Business is live again — ${businessName}`,
      heading: "Your Business is live again",
      body: [`${businessName} is visible on Findmi again.`],
    },
  };
  const copy = copyByOutcome[outcome];

  await sendProductNotification({
    to,
    type: copy.type,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    actionLabel: `Manage ${businessName}`,
    actionUrl: `/account/business/${businessId}`,
  });
}

export interface BusinessTransitionResult {
  op: BusinessTransition;
  changed: string[];
  /** Already in the target state — untouched, no notification. */
  already: string[];
  /** In another state this transition doesn't apply to (e.g. Approve on a Paused one). */
  notApplicable: string[];
  /** Archived or in Trash. */
  inactive: string[];
  missing: string[];
  /** Not confirmed by the update — still in their old state, retryable. */
  failed: string[];
  changedSlugs: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BUSINESS_BULK_MAX = 500;

export function cleanBusinessIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && UUID.test(v)))].slice(0, BUSINESS_BULK_MAX);
}

export type NotifyBusinessOwners = typeof notifyBusinessOwners;

/** Applies one transition. Every id is re-read; only rows the guarded
 * update itself returns count as changed (and only those are notified). */
export async function transitionBusinesses(
  supabase: SupabaseClient,
  ids: string[],
  op: BusinessTransition,
  notify: NotifyBusinessOwners = notifyBusinessOwners
): Promise<BusinessTransitionResult> {
  const rule = BUSINESS_TRANSITION_RULE[op];
  const result: BusinessTransitionResult = { op, changed: [], already: [], notApplicable: [], inactive: [], missing: [], failed: [], changedSlugs: [] };
  if (ids.length === 0) return result;
  const { data, error } = await supabase.from("businesses").select("id, name, slug, publication_status, archived_at, trashed_at").in("id", ids);
  if (error) return { ...result, failed: [...ids] };
  type Row = { id: string; name: string; slug: string | null; publication_status: string | null; archived_at: string | null; trashed_at: string | null };
  const rows = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]));
  const toChange: string[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) result.missing.push(id);
    else {
      const c = businessEligibility(op, row);
      if (c === "change") toChange.push(id);
      else if (c === "already") result.already.push(id);
      else if (c === "inactive") result.inactive.push(id);
      else result.notApplicable.push(id);
    }
  }
  if (toChange.length === 0) return result;
  const { data: updated, error: updateError } = await supabase
    .from("businesses")
    .update({ publication_status: rule.to })
    .in("id", toChange)
    // The same compound guard as the single-Business actions: only the
    // genuine source state can move (a stale tab or double tap is a no-op).
    .eq("publication_status", rule.from)
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
    if (row.slug) result.changedSlugs.push(row.slug);
    try {
      await notify(supabase, id, row.name, rule.notify);
    } catch {
      // best effort — the decision already committed
    }
  }
  return result;
}

const VERB: Record<BusinessTransition, { done: string; already: string; na: string }> = {
  approve: { done: "Approved", already: "Already Published", na: "Not in Needs Review" },
  reject: { done: "Rejected", already: "Already Rejected", na: "Not in Needs Review" },
  pause: { done: "Paused", already: "Already Paused", na: "Not Published" },
  resume: { done: "Resumed", already: "Already Published", na: "Not Paused" },
};

/** One honest summary line ("10 Businesses Approved · 2 Already Published"). */
export function describeBusinessTransition(r: BusinessTransitionResult): string {
  const v = VERB[r.op];
  const n = (k: number) => `${k} ${k === 1 ? "Business" : "Businesses"}`;
  const parts = [`${n(r.changed.length)} ${v.done}`];
  if (r.already.length) parts.push(`${r.already.length} ${v.already}`);
  if (r.notApplicable.length) parts.push(`${r.notApplicable.length} Skipped (${v.na})`);
  if (r.inactive.length) parts.push(`${r.inactive.length} Skipped (Archived or in Trash)`);
  if (r.missing.length) parts.push(`${r.missing.length} Not Found`);
  if (r.failed.length) parts.push(`${r.failed.length} Failed — still selected, try again`);
  return parts.join(" · ");
}
