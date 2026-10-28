// Location moderation — the ONE rule for a Location's review state.
//
// Two separate facts, never conflated:
//   locations.review_status  — CANONICAL moderation state:
//       'pending_review'  submitted by a user / Business, awaiting Admin
//       'approved'        Admin approved it
//       'rejected'        Admin declined it
//       NULL              never entered review (Admin-created, legacy rows)
//   locations.is_demo        — "not publicly listed" (Draft). Public
//       discovery requires is_demo = false (lib/location-eligibility.ts).
//
// is_demo is NOT a synonym for pending: an Admin can keep an approved
// Location unlisted, and legacy unlisted Locations stay NULL (never
// assumed to be submissions). A submitted Location starts unlisted AND
// pending; Admin approval lists it and marks it approved; rejection keeps
// it unlisted and marks it rejected. Its managers can edit it throughout.
// Pure — safe for server, client and tests.

export type LocationReviewStatus = "pending_review" | "approved" | "rejected";
export type LocationSubmitter = "admin" | "member";

/** Columns a NEW Location is inserted with, by who submits it. */
export function newLocationModeration(submitter: LocationSubmitter): { is_demo: true; review_status: LocationReviewStatus | null } {
  // Both start unlisted (exactly as before); only a member/Business
  // submission enters the Admin review queue.
  return { is_demo: true, review_status: submitter === "member" ? "pending_review" : null };
}

/** The write Admin's decision makes. Approve lists the Location. */
export function locationReviewDecision(decision: "approve" | "reject"): { is_demo: boolean; review_status: LocationReviewStatus } {
  return decision === "approve" ? { is_demo: false, review_status: "approved" } : { is_demo: true, review_status: "rejected" };
}

export function isLocationPendingReview(l: { review_status?: string | null } | null | undefined): boolean {
  return l?.review_status === "pending_review";
}

/** Manager-facing status line for a Location they manage. */
export function locationStatusLabel(l: { is_demo?: boolean | null; review_status?: string | null }): { label: string; tone: "aqua" | "amber" | "neutral" } {
  if (l.review_status === "pending_review") return { label: "Pending Review", tone: "amber" };
  if (l.review_status === "rejected") return { label: "Not Approved", tone: "amber" };
  if (l.is_demo) return { label: "Not Listed", tone: "neutral" };
  return { label: "Live", tone: "aqua" };
}
