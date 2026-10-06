import "server-only";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireAdmin } from "@/lib/admin/auth";
import { requireBusinessMember } from "@/lib/permissions";
import { getCurrentUserId } from "@/lib/journal";
import {
  canGoalTransition,
  canManageGoals,
  validateGoalInput,
  type GoalBudgetBand,
  type GoalFormInput,
  type GoalInterest,
  type GoalObjective,
  type GoalStatus,
  type GoalTiming,
} from "@/lib/opportunity-goals-domain";

// Opportunities V2 — server data access for Business Opportunity Goals
// (public.business_opportunity_goals). The table is server-only (RLS on,
// no client policies/grants); every function authorizes first:
//   Business functions — requireBusinessMember(businessId), every query
//     scoped by business_id; create/edit/status additionally need
//     canManageGoals (owner/manager, never Admin Manage-As).
//   Admin functions — requireAdmin().
// Every function tolerates the table not existing yet (migration pending):
// reads return { available: false }, writes return a friendly error.

/** Columns a Business member sees on its own goals (no author id). */
const GOAL_COLUMNS =
  "id, business_id, title, status, objectives, opportunity_interests, audience_text, market_ids, markets_text, budget_band, budget_min_cents, budget_max_cents, timing, starts_on, ends_on, notes, created_at, updated_at";

export interface BusinessGoal {
  id: string;
  business_id: string;
  title: string;
  status: GoalStatus;
  objectives: GoalObjective[];
  opportunity_interests: GoalInterest[];
  audience_text: string | null;
  market_ids: string[];
  markets_text: string | null;
  budget_band: GoalBudgetBand;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  timing: GoalTiming;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Market names resolved from market_ids (display only). */
  markets: string[];
}

export interface AdminBusinessGoal extends BusinessGoal {
  business: { id: string; name: string; slug: string | null } | null;
}

export interface MarketOption {
  id: string;
  name: string;
}

type GoalResult = { ok: true; goalId: string } | { ok: false; error: string };

const UNAVAILABLE = "Goals aren't available yet. Please try again soon.";

function client() {
  const admin = getAdminSupabase();
  if (!admin) throw new Error("Opportunities are unavailable right now.");
  return admin;
}

/** Active Findmi Markets — the selectable geographic preferences. */
export async function getGoalMarketOptions(): Promise<MarketOption[]> {
  const { data } = await client().from("markets").select("id, name").eq("active", true).order("sort_order");
  return (data ?? []) as MarketOption[];
}

async function withMarketNames<T extends { market_ids: string[] }>(rows: T[]): Promise<(T & { markets: string[] })[]> {
  const ids = [...new Set(rows.flatMap((r) => r.market_ids ?? []))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await client().from("markets").select("id, name").in("id", ids);
    for (const m of (data ?? []) as MarketOption[]) names.set(m.id, m.name);
  }
  return rows.map((r) => ({ ...r, market_ids: r.market_ids ?? [], markets: (r.market_ids ?? []).map((id) => names.get(id)).filter((n): n is string => Boolean(n)) }));
}

// ---------------------------------------------------------------- business reads

export async function getBusinessGoals(businessId: string): Promise<{ available: boolean; goals: BusinessGoal[] }> {
  await requireBusinessMember(businessId);
  const { data, error } = await client()
    .from("business_opportunity_goals")
    .select(GOAL_COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error || !data) return { available: false, goals: [] };
  return { available: true, goals: await withMarketNames(data as unknown as Omit<BusinessGoal, "markets">[]) };
}

export async function getBusinessGoal(businessId: string, goalId: string): Promise<BusinessGoal | null> {
  await requireBusinessMember(businessId);
  const { data } = await client().from("business_opportunity_goals").select(GOAL_COLUMNS).eq("id", goalId).eq("business_id", businessId).maybeSingle();
  if (!data) return null;
  return (await withMarketNames([data as unknown as Omit<BusinessGoal, "markets">]))[0];
}

// ---------------------------------------------------------------- business writes

async function authorizeManage(businessId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const membership = await requireBusinessMember(businessId);
  if (!canManageGoals(membership.role, membership.viaAdmin)) {
    return {
      ok: false,
      error: membership.viaAdmin
        ? "Goals come from the Business. Viewing as a Findmi Admin can't create or change them."
        : "Only a Business owner or manager can change goals.",
    };
  }
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Please sign in to manage goals." };
  return { ok: true, userId };
}

async function validated(input: GoalFormInput) {
  const markets = await getGoalMarketOptions();
  return validateGoalInput(input, new Set(markets.map((m) => m.id)));
}

export async function createBusinessGoal(businessId: string, input: GoalFormInput): Promise<GoalResult> {
  const auth = await authorizeManage(businessId);
  if (!auth.ok) return auth;
  const parsed = await validated(input);
  if (!parsed.ok) return parsed;
  const { data, error } = await client()
    .from("business_opportunity_goals")
    .insert({ ...parsed.value, business_id: businessId, status: "active", created_by_user_id: auth.userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.code === "42P01" || error?.code === "PGRST205" ? UNAVAILABLE : "Couldn't save your goal. Please try again." };
  return { ok: true, goalId: data.id as string };
}

export async function updateBusinessGoal(businessId: string, goalId: string, input: GoalFormInput): Promise<GoalResult> {
  const auth = await authorizeManage(businessId);
  if (!auth.ok) return auth;
  const parsed = await validated(input);
  if (!parsed.ok) return parsed;
  const { data, error } = await client()
    .from("business_opportunity_goals")
    .update(parsed.value)
    .eq("id", goalId)
    .eq("business_id", businessId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't save your goal. Please try again." };
  return { ok: true, goalId };
}

/** Pause / resume / close / reopen — canonical transitions only, written
 * conditionally on the status it was read in. Never a delete. */
export async function setBusinessGoalStatus(businessId: string, goalId: string, next: GoalStatus): Promise<GoalResult> {
  const auth = await authorizeManage(businessId);
  if (!auth.ok) return auth;
  const admin = client();
  const { data: row } = await admin.from("business_opportunity_goals").select("status").eq("id", goalId).eq("business_id", businessId).maybeSingle();
  if (!row) return { ok: false, error: "Goal not found." };
  const current = row.status as GoalStatus;
  if (!canGoalTransition(current, next)) return { ok: false, error: "That change isn't available." };
  const { data, error } = await admin
    .from("business_opportunity_goals")
    .update({ status: next })
    .eq("id", goalId)
    .eq("business_id", businessId)
    .eq("status", current)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "This goal changed. Please try again." };
  return { ok: true, goalId };
}

// ---------------------------------------------------------------- admin

/** Every Business goal (optionally by status), newest first — Admin only. */
export async function getAdminBusinessGoals(status?: GoalStatus): Promise<{ available: boolean; goals: AdminBusinessGoal[] }> {
  await requireAdmin();
  let query = client().from("business_opportunity_goals").select(`${GOAL_COLUMNS}, business:businesses(id, name, slug)`).order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error || !data) return { available: false, goals: [] };
  type Row = Omit<AdminBusinessGoal, "markets" | "business"> & { business: AdminBusinessGoal["business"] | AdminBusinessGoal["business"][] };
  const rows = (data as unknown as Row[]).map((r) => ({ ...r, business: Array.isArray(r.business) ? (r.business[0] ?? null) : r.business }));
  return { available: true, goals: await withMarketNames(rows) };
}
