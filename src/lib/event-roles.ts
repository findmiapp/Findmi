/** Business ↔ Event roles — the ONE rule for how a Business relates to an
 * Event (Findmi Consolidation pass, Good Organics fix). Pure; client-safe.
 *
 *   HOST         events.host_business_id. Canonical, complete on its own:
 *                the Event is the host's Event — it is on the host's
 *                schedule, its public profile and Findmi Here because the
 *                Business hosts it. No event_businesses row or Appearance
 *                is ever needed (or manufactured) for the host.
 *   PARTICIPANT  an approved event_businesses row (or approved
 *                event_occurrence_businesses for selected dates). For OTHER
 *                Businesses taking part.
 *
 * The roles never merge: the host can't be invited to, apply to, or join
 * its own Event as a participant, and is never an invite candidate. A
 * participant row that already exists for the host (e.g. created by hand
 * before this rule) is left untouched, and the host is still shown once,
 * as Host. */

export type BusinessEventRole = "host" | "participant";

export const EVENT_ROLE_LABELS: Record<BusinessEventRole, string> = { host: "Host", participant: "Participant" };

/** Why the host can't be added to its own Event as a participant. */
export const HOST_ALREADY_CONNECTED = "This Business hosts this Event, so it's already connected as the Host.";

export function isEventHost(hostBusinessId: string | null | undefined, businessId: string | null | undefined): boolean {
  return Boolean(hostBusinessId && businessId && hostBusinessId === businessId);
}

/** The Business's role on the Event, or null. Host wins over any
 * participant row. */
export function businessEventRole(input: { hostBusinessId: string | null | undefined; businessId: string; participantStatus?: string | null }): BusinessEventRole | null {
  if (isEventHost(input.hostBusinessId, input.businessId)) return "host";
  return input.participantStatus === "approved" ? "participant" : null;
}

/** Participant roster without the host (the host is shown as Host). */
export function participantsExcludingHost<T extends { business_id: string }>(rows: readonly T[], hostBusinessId: string | null | undefined): T[] {
  return rows.filter((r) => !isEventHost(hostBusinessId, r.business_id));
}

/** Businesses never offered as invite candidates: the host and everyone
 * already on the roster. */
export function inviteExclusionIds(hostBusinessId: string | null | undefined, participantIds: readonly string[]): string[] {
  return [...new Set([...(hostBusinessId ? [hostBusinessId] : []), ...participantIds])];
}

/** Event ids a Business is connected to for its schedule / profile:
 * hosted ∪ approved Event-level participation. */
export function connectedEventIds(hostedIds: readonly string[], participantIds: readonly string[]): string[] {
  return [...new Set([...hostedIds, ...participantIds])];
}
