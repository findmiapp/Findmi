/** Admin Locations — the operator-facing lifecycle state of one Location,
 * derived ONLY from the existing canonical columns (no status column):
 *   TRASHED   trashed_at set
 *   ARCHIVED  archived_at set
 *   DRAFT     active, not publicly listed (is_demo = true)
 *   PUBLISHED active and publicly listed (is_demo = false)
 * Admin terminology only; public behavior is unchanged. Client-safe. */
export type LocationLifecycleState = "published" | "draft" | "archived" | "trashed";

export function locationLifecycleState(l: { is_demo?: boolean | null; archived_at?: string | null; trashed_at?: string | null }): LocationLifecycleState {
  if (l.trashed_at) return "trashed";
  if (l.archived_at) return "archived";
  return l.is_demo === false ? "published" : "draft";
}

export const LOCATION_LIFECYCLE_LABEL: Record<LocationLifecycleState, string> = {
  published: "Published",
  draft: "Draft",
  archived: "Archived",
  trashed: "Trashed",
};

export const LOCATION_LIFECYCLE_TONE: Record<LocationLifecycleState, string> = {
  published: "bg-findmi-50 text-findmi-700",
  draft: "bg-amber-50 text-amber-800",
  archived: "bg-black/[0.06] text-ink/55",
  trashed: "bg-red-50 text-red-700",
};
