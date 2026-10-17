// Identity, Authorship & Entity Access V1 — the pure rules. No I/O.
//
// journal_entries.user_id           = the authenticated creator / original
//                                     actor. Never rewritten.
// journal_entries.author_business_id = the PUBLIC author when set (a
//                                     Business); NULL → the Person user_id.
//
// Business authority comes ONLY from a real business_members row with role
// owner or manager. Staff never qualify. Admin authority is a separate,
// explicit path — never a membership, never "Managed".

export const BUSINESS_AUTHOR_ROLES = ["owner", "manager"] as const;

export function canPostAsBusinessRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** The viewer's real memberships: business id → role. */
export type MembershipRoles = ReadonlyMap<string, string>;

export interface MomentAuthorship {
  user_id: string;
  author_business_id?: string | null;
}

export type MomentActor = { kind: "admin" } | { kind: "user"; userId: string; roles: MembershipRoles };

/** Who may manage (edit / delete / organize) a Moment right now. Derived
 * from current state only: a Business Moment follows CURRENT owner/manager
 * membership — the original creator keeps nothing from user_id alone. */
export function canManageMoment(entry: MomentAuthorship, actor: MomentActor): boolean {
  if (actor.kind === "admin") return true;
  const businessId = entry.author_business_id ?? null;
  if (businessId === null) return entry.user_id === actor.userId;
  return canPostAsBusinessRole(actor.roles.get(businessId));
}

/** Validates a requested public author. `requested` null = the creator's
 * Personal identity. Never trusts the id — only real roles (or Admin). */
export function authorizeAuthorChoice(
  entry: MomentAuthorship,
  actor: MomentActor,
  requested: string | null
): { ok: true } | { error: string } {
  if (!canManageMoment(entry, actor)) return { error: "You can't manage this Moment." };
  if (actor.kind === "admin") return { ok: true };
  if (requested === null) {
    return entry.user_id === actor.userId ? { ok: true } : { error: "Only the person who created this Moment can post it personally." };
  }
  return canPostAsBusinessRole(actor.roles.get(requested)) ? { ok: true } : { error: "You can only post as a Business you manage." };
}

export interface ManagedBusinessOption {
  id: string;
  name: string;
  logoUrl: string | null;
}

export type PostedByOption = { value: string | null; label: string; imageUrl: string | null; kind: "person" | "business" };

/** The Posted By choices for a normal user. Personal only for the creator
 * (or on create); Businesses only where the viewer is owner/manager. The
 * current Business author always stays listed so the control never lies. */
export function postedByOptions({
  viewerUserId,
  entryUserId,
  personalLabel,
  managed,
  roles,
  current,
}: {
  viewerUserId: string;
  /** null while creating (the viewer will be the creator). */
  entryUserId: string | null;
  personalLabel: string;
  managed: ManagedBusinessOption[];
  roles: MembershipRoles;
  current?: ManagedBusinessOption | null;
}): PostedByOption[] {
  const options: PostedByOption[] = [];
  if (entryUserId === null || entryUserId === viewerUserId) options.push({ value: null, label: personalLabel, imageUrl: null, kind: "person" });
  const seen = new Set<string>();
  for (const b of managed) {
    if (!canPostAsBusinessRole(roles.get(b.id)) || seen.has(b.id)) continue;
    seen.add(b.id);
    options.push({ value: b.id, label: b.name, imageUrl: b.logoUrl, kind: "business" });
  }
  if (current && !seen.has(current.id)) options.push({ value: current.id, label: current.name, imageUrl: current.logoUrl, kind: "business" });
  return options;
}

/** Default author on create: the Business the composer was opened from,
 * only if the viewer is currently its owner/manager; otherwise Personal. */
export function defaultAuthorBusinessId(fromBusinessId: string | null | undefined, roles: MembershipRoles): string | null {
  return fromBusinessId && canPostAsBusinessRole(roles.get(fromBusinessId)) ? fromBusinessId : null;
}

// ── Public author resolution ─────────────────────────────────────────────

export interface PublicMomentAuthor {
  kind: "person" | "business";
  name: string;
  imageUrl: string | null;
  href: string | null;
}

export interface AuthorPerson {
  display_name: string | null;
  avatar_url: string | null;
}

export interface AuthorBusiness {
  name: string;
  slug: string | null;
  logo_url: string | null;
  publication_status?: string | null;
  archived_at?: string | null;
  trashed_at?: string | null;
}

/** A display name that looks like an email address is never shown. */
export function safeAuthorName(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n && !n.includes("@") ? n : null;
}

const httpsOnly = (url: string | null | undefined) => (url && /^https?:\/\//.test(url) ? url : null);

export function businessIsPublic(b: AuthorBusiness): boolean {
  return (b.publication_status ?? "live") === "live" && !b.archived_at && !b.trashed_at;
}

/** The ONE author rule every Moment surface uses. A Business author never
 * falls back to the creating Person (that would expose who posted it). */
export function momentAuthorFrom(
  entry: { user_id: string; author_business_id?: string | null; author_label?: string | null },
  person: AuthorPerson | null | undefined,
  business: AuthorBusiness | null | undefined,
  personHref: string | null
): PublicMomentAuthor | null {
  if (entry.author_business_id) {
    if (!business) return null;
    return {
      kind: "business",
      name: business.name,
      imageUrl: httpsOnly(business.logo_url),
      href: business.slug && businessIsPublic(business) ? `/business/${business.slug}` : null,
    };
  }
  const name = safeAuthorName(person?.display_name) ?? (entry.author_label?.trim() || null);
  if (!name) return null;
  return { kind: "person", name, imageUrl: httpsOnly(person?.avatar_url), href: personHref };
}

// ── Business management state ────────────────────────────────────────────

export type BusinessManagementState = "managed" | "claim_pending" | "unclaimed";

/** The ONE definition. Counts only REAL business_members rows — Admin /
 * service-role / viaAdmin authority never contributes. Verified
 * (businesses.verified) is independent and not part of this. */
export function businessManagementState({ memberCount, pendingClaimCount }: { memberCount: number; pendingClaimCount: number }): BusinessManagementState {
  if (memberCount > 0) return "managed";
  if (pendingClaimCount > 0) return "claim_pending";
  return "unclaimed";
}

export const BUSINESS_MANAGEMENT_STATE_LABELS: Record<BusinessManagementState, string> = {
  managed: "Managed",
  claim_pending: "Claim Pending",
  unclaimed: "Unclaimed",
};
