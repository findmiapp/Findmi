import { getAdminSupabase } from "./supabase-admin";

// Admin → Users — read helpers. Consumer/vendor Supabase Auth accounts
// only (never the founder admin cookie session — that has no "users"
// concept at all, see lib/admin/auth.ts). Every read here goes through
// the service-role client (getAdminSupabase()), the same one
// lib/admin/claim-queries.ts already uses for its own
// auth.admin.getUserById() lookups — no new client, no new auth
// mechanism. Deliberately exposes ONLY the safe subset of an auth.users
// row: id, email, created_at, email_confirmed_at, last_sign_in_at.
// Never encrypted_password, never any *_token column, never
// app_metadata/user_metadata verbatim (display_name is read out of
// public.profiles instead, the same table the rest of the app already
// treats as the real display-name source of truth).

export interface AdminUserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
}

/** All consumer/vendor accounts, optionally filtered by a plain
 * case-insensitive substring match against email or display name.
 *
 * Supabase's Admin API has no server-side "search by email/name" filter
 * on listUsers() — only pagination — so this fetches one page (200,
 * comfortably above FindMi's current real account volume — this
 * project's own database currently has a single digit number of real
 * accounts) and filters in JS. Matches this pass's own instruction
 * ("for the current expected FindMi user volume, simple server-side
 * filtering is acceptable"). Revisit with real pagination + a dedicated
 * search index if the account count ever approaches that page size. */
export async function listAdminUsers(query?: string): Promise<AdminUserRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error || !data) return [];

  const userIds = data.users.map((u) => u.id);
  const { data: profileRows } = userIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [] as { id: string; display_name: string | null }[] };
  const nameByUser = new Map(
    ((profileRows ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name])
  );

  let rows: AdminUserRow[] = data.users.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    displayName: nameByUser.get(u.id) ?? null,
    createdAt: u.created_at,
    emailConfirmedAt: u.email_confirmed_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
  }));

  const q = query?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) => r.email?.toLowerCase().includes(q) || r.displayName?.toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  return rows;
}

/** One account's safe Account-tab fields. Returns null for a missing/bad
 * id rather than throwing — the page decides how to render "not found". */
export async function getAdminUserAccount(userId: string): Promise<AdminUserRow | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) return null;

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    displayName: profile?.display_name ?? null,
    createdAt: data.user.created_at,
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
    lastSignInAt: data.user.last_sign_in_at ?? null,
  };
}

// ── Business / Event access (existing tables, read from the OTHER side) ──
// business_members/event_members already exist and are already written to
// by admin/businesses, admin/claims, and the claim-approval RPCs — this
// only adds the query direction those callers didn't need: "what does
// THIS user have access to," across every business/event at once, for the
// new User Detail page. Never a new table, never a new column.

export type MemberRole = "owner" | "manager" | "staff";
const ROLE_SORT_ORDER: Record<MemberRole, number> = { owner: 0, manager: 1, staff: 2 };

export interface UserBusinessAccessRow {
  memberId: string;
  role: MemberRole;
  businessId: string;
  name: string;
  slug: string;
}

export async function getUserBusinessAccess(userId: string): Promise<UserBusinessAccessRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("business_members")
    .select("id, role, business:businesses(id, name, slug)")
    .eq("user_id", userId);

  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as { id: string; role: MemberRole; business: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null };
      const b = Array.isArray(r.business) ? r.business[0] : r.business;
      return { memberId: r.id, role: r.role, businessId: b?.id ?? "", name: b?.name ?? "Unknown business", slug: b?.slug ?? "" };
    })
    .sort((a, b) => ROLE_SORT_ORDER[a.role] - ROLE_SORT_ORDER[b.role]);
}

export interface UserEventAccessRow {
  memberId: string;
  role: MemberRole;
  eventId: string;
  name: string;
  slug: string;
}

export async function getUserEventAccess(userId: string): Promise<UserEventAccessRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("event_members")
    .select("id, role, event:events(id, name, slug)")
    .eq("user_id", userId);

  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as { id: string; role: MemberRole; event: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null };
      const e = Array.isArray(r.event) ? r.event[0] : r.event;
      return { memberId: r.id, role: r.role, eventId: e?.id ?? "", name: e?.name ?? "Unknown event", slug: e?.slug ?? "" };
    })
    .sort((a, b) => ROLE_SORT_ORDER[a.role] - ROLE_SORT_ORDER[b.role]);
}

export interface UserInheritedProductGroup {
  businessId: string;
  businessName: string;
  products: { id: string; name: string; slug: string }[];
}

/** Read-only: products from every business this user has ANY
 * business_members row for (owner/manager/staff alike — all three
 * already grant "Manage Business" access via requireBusinessMember, see
 * lib/permissions.ts, so all three see this business's products in the
 * real Pro editor too). There is no product-level membership table and
 * this pass doesn't add one — access is entirely inherited from the
 * business, which is why this is read-only here. */
export async function getUserInheritedProducts(userId: string): Promise<UserInheritedProductGroup[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  const { data: memberships } = await supabase
    .from("business_members")
    .select("business:businesses(id, name)")
    .eq("user_id", userId);
  const businesses = new Map<string, string>();
  for (const row of (memberships ?? []) as { business: { id: string; name: string } | { id: string; name: string }[] | null }[]) {
    const b = Array.isArray(row.business) ? row.business[0] : row.business;
    if (b) businesses.set(b.id, b.name);
  }
  if (businesses.size === 0) return [];

  const { data: products } = await supabase
    .from("products")
    .select("id, name, slug, business_id")
    .in("business_id", Array.from(businesses.keys()))
    .order("name");

  const groups = new Map<string, UserInheritedProductGroup>();
  for (const p of (products ?? []) as { id: string; name: string; slug: string; business_id: string }[]) {
    if (!groups.has(p.business_id)) {
      groups.set(p.business_id, { businessId: p.business_id, businessName: businesses.get(p.business_id) ?? "Unknown business", products: [] });
    }
    groups.get(p.business_id)!.products.push({ id: p.id, name: p.name, slug: p.slug });
  }
  return Array.from(groups.values());
}
