/** Admin Bulk Lifecycle V2 — the pure, client-safe eligibility rules shared
 * by the server lifecycle helpers (lib/admin/event-lifecycle.ts,
 * lib/admin/business-lifecycle.ts) and the bulk toolbars' per-action
 * counts, so what the toolbar offers and what the server does can't drift.
 * "change" = this transition applies; "already" = the row is already in
 * the target state (no write); "inactive" = Shut Down / Archived / Trash;
 * "na" = another state this transition doesn't apply to. */

export type Eligibility = "change" | "already" | "inactive" | "na";

export type EventTransition = "live" | "hide" | "shutdown";

export function eventEligibility(op: EventTransition, row: { is_demo: boolean; publication_status?: string | null; archived_at?: string | null; trashed_at?: string | null }): Eligibility {
  if (row.trashed_at) return "inactive";
  if (op === "shutdown") return row.archived_at ? "already" : "change";
  if (row.archived_at) return "inactive";
  if (op === "live") return !row.is_demo && row.publication_status === "live" ? "already" : "change";
  return row.is_demo ? "already" : "change";
}

export type BusinessTransition = "approve" | "reject" | "pause" | "resume";

export const BUSINESS_TRANSITION_RULE: Record<BusinessTransition, { from: string; to: string; notify: "live" | "rejected" | "paused" | "restored" }> = {
  approve: { from: "pending_review", to: "live", notify: "live" },
  reject: { from: "pending_review", to: "rejected", notify: "rejected" },
  pause: { from: "live", to: "paused", notify: "paused" },
  resume: { from: "paused", to: "live", notify: "restored" },
};

export function businessEligibility(op: BusinessTransition, row: { publication_status?: string | null; archived_at?: string | null; trashed_at?: string | null }): Eligibility {
  if (row.archived_at || row.trashed_at) return "inactive";
  const rule = BUSINESS_TRANSITION_RULE[op];
  if (row.publication_status === rule.to) return "already";
  return row.publication_status === rule.from ? "change" : "na";
}

/** Admin Business row badge — derived from the existing columns only:
 * Trash / Archive first, then the demo flag, then publication_status. */
export function businessBadge(b: { is_demo: boolean; publication_status?: string | null; archived_at?: string | null; trashed_at?: string | null }): { label: string; className: string } {
  if (b.trashed_at) return { label: "Trashed", className: "bg-red-50 text-red-700" };
  if (b.archived_at) return { label: "Archived", className: "bg-black/[0.06] text-ink/55" };
  if (b.is_demo) return { label: "Demo", className: "bg-black/[0.06] text-ink/50" };
  switch (b.publication_status) {
    case "pending_review":
      return { label: "Pending Review", className: "bg-amber-50 text-amber-700" };
    case "paused":
      return { label: "Paused", className: "bg-black/[0.06] text-ink/50" };
    case "rejected":
      return { label: "Rejected", className: "bg-red-50 text-red-700" };
    case "draft":
      return { label: "Draft", className: "bg-black/[0.06] text-ink/50" };
    default:
      return { label: "Active", className: "bg-findmi-50 text-findmi-700" };
  }
}
