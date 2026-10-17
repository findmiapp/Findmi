import "server-only";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireAdmin } from "@/lib/admin/auth";
import { requireBusinessMember } from "@/lib/permissions";
import { getCurrentUserId } from "@/lib/journal";
import { canManageGoals } from "@/lib/opportunity-goals-domain";
import {
  isIdeaEligible,
  isIdeaResponse,
  orderIdeasForBusiness,
  validateAuditAnswers,
  validateIdeaInput,
  IDEA_LIMITS,
  IDEA_RESPONSES,
  type AuditAnswer,
  type AuditAnswerInput,
  type AuditKind,
  type AuditStatus,
  type AuditSummary,
  type IdeaAudience,
  type IdeaFormInput,
  type IdeaResponse,
  type IdeaStatus,
  type IdeaType,
} from "@/lib/brand-audit-domain";

// Findmi Brand Audit + Opportunity Intelligence V1 — server data access.
// Every table is server-only (RLS on, no client policies/grants — see
// supabase/migrations/20261021000000_brand_audit_and_opportunity_ideas.sql);
// every function authorizes first:
//   Business functions — requireBusinessMember(businessId) and every query
//     scoped by business_id; writes additionally need canManageGoals
//     (owner/manager, never Admin Manage-As — the same semantics as
//     Opportunity Goals). Staff can view, not change.
//   Admin functions — requireAdmin().
// The Admin internal note (business_intelligence_notes) is read ONLY by
// Admin functions; no Business function selects it.
// Every function tolerates the tables not existing yet (migration
// pending): reads return { available: false }, writes a friendly error.

type Result = { ok: true } | { ok: false; error: string };
const UNAVAILABLE = "The Brand Audit isn’t available yet. Please try again soon.";

function client() {
  const admin = getAdminSupabase();
  if (!admin) throw new Error("Findmi is unavailable right now.");
  return admin;
}

const missing = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";

// ---------------------------------------------------------------- shared reads

export interface BrandAuditData {
  available: boolean;
  summary: AuditSummary;
  goals: AuditAnswer[];
  challenges: AuditAnswer[];
}

const EMPTY_SUMMARY: AuditSummary = { status: null, goalCount: 0, challengeCount: 0, completedAt: null, updatedAt: null };

async function readAudit(businessId: string): Promise<BrandAuditData> {
  const admin = client();
  const [{ data: audit, error }, { data: answers, error: answersError }] = await Promise.all([
    admin.from("brand_audits").select("status, completed_at, updated_at").eq("business_id", businessId).maybeSingle(),
    admin.from("brand_audit_answers").select("kind, option_key, detail, updated_at").eq("business_id", businessId),
  ]);
  if (error || answersError) return { available: false, summary: EMPTY_SUMMARY, goals: [], challenges: [] };
  const rows = (answers ?? []) as { kind: AuditKind; option_key: string; detail: string | null; updated_at: string }[];
  const pick = (kind: AuditKind) => rows.filter((r) => r.kind === kind).map((r) => ({ key: r.option_key, detail: r.detail }));
  const goals = pick("goal");
  const challenges = pick("challenge");
  const a = audit as { status: AuditStatus; completed_at: string | null; updated_at: string } | null;
  return {
    available: true,
    summary: { status: a?.status ?? null, goalCount: goals.length, challengeCount: challenges.length, completedAt: a?.completed_at ?? null, updatedAt: a?.updated_at ?? null },
    goals,
    challenges,
  };
}

// ---------------------------------------------------------------- business: brand audit

export async function getBrandAudit(businessId: string): Promise<BrandAuditData> {
  await requireBusinessMember(businessId);
  return readAudit(businessId);
}

async function authorizeManage(businessId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const membership = await requireBusinessMember(businessId);
  if (!canManageGoals(membership.role, membership.viaAdmin)) {
    return {
      ok: false,
      error: membership.viaAdmin
        ? "The Brand Audit comes from the Business. Viewing as a Findmi Admin can’t change it."
        : "Only a Business owner or manager can change the Brand Audit.",
    };
  }
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, userId };
}

/** Saves one step (Goals or Challenges) as the Business's current answers
 * for that kind: deselected choices are removed, each selected choice keeps
 * its own elaboration. Never touches the other kind. Creates the audit row
 * (in progress) the first time; never downgrades a completed audit. */
export async function saveBrandAuditStep(businessId: string, kind: AuditKind, input: AuditAnswerInput[]): Promise<Result> {
  const auth = await authorizeManage(businessId);
  if (!auth.ok) return auth;
  const parsed = validateAuditAnswers(kind, input);
  if (!parsed.ok) return parsed;
  const admin = client();

  const { data: audit, error: auditError } = await admin.from("brand_audits").select("status").eq("business_id", businessId).maybeSingle();
  if (auditError) return { ok: false, error: missing(auditError) ? UNAVAILABLE : "Couldn’t save. Please try again." };
  if (!audit) {
    const { error } = await admin.from("brand_audits").insert({ business_id: businessId, status: "in_progress", updated_by_user_id: auth.userId });
    if (error && error.code !== "23505") return { ok: false, error: "Couldn’t save. Please try again." };
  }

  const { data: existing } = await admin.from("brand_audit_answers").select("option_key").eq("business_id", businessId).eq("kind", kind);
  const keep = new Set(parsed.value.map((a) => a.key));
  const removed = ((existing ?? []) as { option_key: string }[]).map((r) => r.option_key).filter((k) => !keep.has(k));
  if (removed.length) {
    const { error } = await admin.from("brand_audit_answers").delete().eq("business_id", businessId).eq("kind", kind).in("option_key", removed);
    if (error) return { ok: false, error: "Couldn’t save. Please try again." };
  }
  const { error: upsertError } = await admin.from("brand_audit_answers").upsert(
    parsed.value.map((a) => ({ business_id: businessId, kind, option_key: a.key, detail: a.detail, updated_by_user_id: auth.userId })),
    { onConflict: "business_id,kind,option_key" }
  );
  if (upsertError) return { ok: false, error: "Couldn’t save. Please try again." };
  // Touch the audit so "last updated" reflects this save.
  await admin.from("brand_audits").update({ updated_by_user_id: auth.userId, updated_at: new Date().toISOString() }).eq("business_id", businessId);
  return { ok: true };
}

/** Marks the audit complete (both steps answered). The first completion
 * date is kept when a completed audit is reviewed again. */
export async function completeBrandAudit(businessId: string): Promise<Result> {
  const auth = await authorizeManage(businessId);
  if (!auth.ok) return auth;
  const current = await readAudit(businessId);
  if (!current.available) return { ok: false, error: UNAVAILABLE };
  if (current.summary.goalCount === 0) return { ok: false, error: "Choose at least one Goal first." };
  if (current.summary.challengeCount === 0) return { ok: false, error: "Choose at least one Challenge first." };
  const { error } = await client()
    .from("brand_audits")
    .update({
      status: "complete",
      completed_at: current.summary.completedAt ?? new Date().toISOString(),
      updated_by_user_id: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId);
  return error ? { ok: false, error: "Couldn’t complete the Brand Audit. Please try again." } : { ok: true };
}

// ---------------------------------------------------------------- business: ideas

export interface BusinessIdea {
  id: string;
  title: string;
  summary: string;
  details: string | null;
  ideaType: IdeaType;
  displayOrder: number;
  response: { value: IdeaResponse; note: string | null; updatedAt: string } | null;
}

interface IdeaRow {
  id: string;
  title: string;
  summary: string;
  details: string | null;
  idea_type: IdeaType;
  status: IdeaStatus;
  display_order: number;
  audience: IdeaAudience;
}

const IDEA_COLUMNS = "id, title, summary, details, idea_type, status, display_order, audience";

/** Published Ideas this Business is eligible for (All Brands, or targeted
 * to it), unanswered first. Eligibility is decided here, never in the UI. */
export async function getIdeasForBusiness(businessId: string): Promise<{ available: boolean; ideas: BusinessIdea[] }> {
  await requireBusinessMember(businessId);
  const admin = client();
  const [{ data: ideas, error }, { data: targets }, { data: responses }] = await Promise.all([
    admin.from("opportunity_ideas").select(IDEA_COLUMNS).eq("status", "published").order("display_order"),
    admin.from("opportunity_idea_businesses").select("idea_id").eq("business_id", businessId),
    admin.from("opportunity_idea_responses").select("idea_id, response, note, updated_at").eq("business_id", businessId),
  ]);
  if (error || !ideas) return { available: false, ideas: [] };
  const targeted = new Set(((targets ?? []) as { idea_id: string }[]).map((t) => t.idea_id));
  const byIdea = new Map(((responses ?? []) as { idea_id: string; response: IdeaResponse; note: string | null; updated_at: string }[]).map((r) => [r.idea_id, r]));
  const eligible = (ideas as IdeaRow[]).filter((i) => isIdeaEligible({ status: i.status, audience: i.audience, targetBusinessIds: targeted.has(i.id) ? [businessId] : [] }, businessId));
  return {
    available: true,
    ideas: orderIdeasForBusiness(
      eligible.map((i) => {
        const r = byIdea.get(i.id);
        return {
          id: i.id,
          title: i.title,
          summary: i.summary,
          details: i.details,
          ideaType: i.idea_type,
          displayOrder: i.display_order,
          response: r ? { value: r.response, note: r.note, updatedAt: r.updated_at } : null,
        };
      })
    ),
  };
}

async function eligibleIdea(businessId: string, ideaId: string): Promise<boolean> {
  const admin = client();
  const [{ data: idea }, { data: target }] = await Promise.all([
    admin.from("opportunity_ideas").select("status, audience").eq("id", ideaId).maybeSingle(),
    admin.from("opportunity_idea_businesses").select("idea_id").eq("idea_id", ideaId).eq("business_id", businessId).maybeSingle(),
  ]);
  if (!idea) return false;
  const i = idea as { status: string; audience: string };
  return isIdeaEligible({ status: i.status, audience: i.audience, targetBusinessIds: target ? [businessId] : [] }, businessId);
}

/** Interested / Maybe / Not For Us — one response per Business per Idea,
 * changeable. Only for an Idea this Business is eligible for right now.
 * `note` undefined keeps the existing note; a string replaces it. */
export async function respondToIdea(businessId: string, ideaId: string, response: string, note?: string | null): Promise<Result> {
  const auth = await authorizeManage(businessId);
  if (!auth.ok) return auth;
  if (!isIdeaResponse(response)) return { ok: false, error: "That response isn’t available." };
  const cleanNote = note === undefined ? undefined : note?.trim() ? note.trim() : null;
  if ((cleanNote?.length ?? 0) > IDEA_LIMITS.note) return { ok: false, error: `Keep your note to ${IDEA_LIMITS.note} characters.` };
  if (!(await eligibleIdea(businessId, ideaId))) return { ok: false, error: "That Idea isn’t available." };
  const row: Record<string, unknown> = { idea_id: ideaId, business_id: businessId, response, responded_by_user_id: auth.userId };
  if (cleanNote !== undefined) row.note = cleanNote;
  const { error } = await client().from("opportunity_idea_responses").upsert(row, { onConflict: "idea_id,business_id" });
  if (error) return { ok: false, error: missing(error) ? UNAVAILABLE : "Couldn’t save your response. Please try again." };
  return { ok: true };
}

// ---------------------------------------------------------------- admin: business intelligence

export interface AdminIdeaSignal {
  ideaId: string;
  title: string;
  ideaType: IdeaType | null;
  response: IdeaResponse;
  note: string | null;
  updatedAt: string;
}

export interface AdminBusinessIntelligence extends BrandAuditData {
  signals: AdminIdeaSignal[];
  note: { text: string; updatedAt: string } | null;
}

export async function getAdminBusinessIntelligence(businessId: string): Promise<AdminBusinessIntelligence> {
  await requireAdmin();
  const admin = client();
  const [audit, { data: responses }, { data: note }] = await Promise.all([
    readAudit(businessId),
    admin.from("opportunity_idea_responses").select("idea_id, response, note, updated_at, idea:opportunity_ideas(title, idea_type)").eq("business_id", businessId).order("updated_at", { ascending: false }),
    admin.from("business_intelligence_notes").select("note, updated_at").eq("business_id", businessId).maybeSingle(),
  ]);
  type Row = { idea_id: string; response: IdeaResponse; note: string | null; updated_at: string; idea: { title: string; idea_type: IdeaType } | { title: string; idea_type: IdeaType }[] | null };
  const signals = ((responses ?? []) as Row[]).map((r) => {
    const idea = Array.isArray(r.idea) ? r.idea[0] : r.idea;
    return { ideaId: r.idea_id, title: idea?.title ?? "Idea", ideaType: idea?.idea_type ?? null, response: r.response, note: r.note, updatedAt: r.updated_at };
  });
  const n = note as { note: string; updated_at: string } | null;
  return { ...audit, signals, note: n && n.note ? { text: n.note, updatedAt: n.updated_at } : null };
}

export async function saveBusinessIntelligenceNote(businessId: string, text: string): Promise<Result> {
  await requireAdmin();
  const note = text.trim();
  if (note.length > 4000) return { ok: false, error: "Keep the note to 4,000 characters." };
  const { error } = await client().from("business_intelligence_notes").upsert({ business_id: businessId, note }, { onConflict: "business_id" });
  if (error) return { ok: false, error: missing(error) ? UNAVAILABLE : "Couldn’t save the note." };
  return { ok: true };
}

// ---------------------------------------------------------------- admin: idea library

export interface AdminIdea {
  id: string;
  title: string;
  summary: string;
  details: string | null;
  idea_type: IdeaType;
  status: IdeaStatus;
  display_order: number;
  audience: IdeaAudience;
  created_at: string;
  updated_at: string;
}

export type ResponseCounts = Record<IdeaResponse, number>;
const zeroCounts = (): ResponseCounts => ({ interested: 0, maybe: 0, not_for_us: 0 });

export async function getAdminIdeas(status?: IdeaStatus): Promise<{ available: boolean; ideas: (AdminIdea & { counts: ResponseCounts })[] }> {
  await requireAdmin();
  const admin = client();
  let query = admin.from("opportunity_ideas").select(`${IDEA_COLUMNS}, created_at, updated_at`).order("display_order").order("title");
  if (status) query = query.eq("status", status);
  const [{ data, error }, { data: responses }] = await Promise.all([query, admin.from("opportunity_idea_responses").select("idea_id, response")]);
  if (error || !data) return { available: false, ideas: [] };
  const counts = new Map<string, ResponseCounts>();
  for (const r of (responses ?? []) as { idea_id: string; response: IdeaResponse }[]) {
    const c = counts.get(r.idea_id) ?? zeroCounts();
    if (IDEA_RESPONSES.includes(r.response)) c[r.response] += 1;
    counts.set(r.idea_id, c);
  }
  return { available: true, ideas: (data as AdminIdea[]).map((i) => ({ ...i, counts: counts.get(i.id) ?? zeroCounts() })) };
}

export interface AdminIdeaDetail {
  idea: AdminIdea;
  targets: { id: string; name: string }[];
  responses: { businessId: string; businessName: string; response: IdeaResponse; note: string | null; updatedAt: string }[];
  counts: ResponseCounts;
  /** Selected-Businesses Ideas only: targeted Businesses with no response yet
   * (exact, from the targeting rows). Null for All Brands. */
  noResponse: number | null;
}

export async function getAdminIdea(ideaId: string): Promise<AdminIdeaDetail | null> {
  await requireAdmin();
  const admin = client();
  const [{ data: idea }, { data: targets }, { data: responses }] = await Promise.all([
    admin.from("opportunity_ideas").select(`${IDEA_COLUMNS}, created_at, updated_at`).eq("id", ideaId).maybeSingle(),
    admin.from("opportunity_idea_businesses").select("business_id, business:businesses(id, name)").eq("idea_id", ideaId),
    admin.from("opportunity_idea_responses").select("business_id, response, note, updated_at, business:businesses(id, name)").eq("idea_id", ideaId).order("updated_at", { ascending: false }),
  ]);
  if (!idea) return null;
  type B = { id: string; name: string } | { id: string; name: string }[] | null;
  const one = (b: B) => (Array.isArray(b) ? b[0] : b) ?? null;
  const t = ((targets ?? []) as { business_id: string; business: B }[]).map((r) => ({ id: r.business_id, name: one(r.business)?.name ?? "Business" }));
  const rs = ((responses ?? []) as { business_id: string; response: IdeaResponse; note: string | null; updated_at: string; business: B }[]).map((r) => ({
    businessId: r.business_id,
    businessName: one(r.business)?.name ?? "Business",
    response: r.response,
    note: r.note,
    updatedAt: r.updated_at,
  }));
  const counts = zeroCounts();
  for (const r of rs) counts[r.response] += 1;
  const i = idea as AdminIdea;
  const responded = new Set(rs.map((r) => r.businessId));
  return { idea: i, targets: t, responses: rs, counts, noResponse: i.audience === "selected_businesses" ? t.filter((b) => !responded.has(b.id)).length : null };
}

async function replaceTargets(ideaId: string, businessIds: string[]): Promise<Result> {
  const admin = client();
  const { data: existing } = await admin.from("opportunity_idea_businesses").select("business_id").eq("idea_id", ideaId);
  const keep = new Set(businessIds);
  const removed = ((existing ?? []) as { business_id: string }[]).map((r) => r.business_id).filter((id) => !keep.has(id));
  if (removed.length) {
    const { error } = await admin.from("opportunity_idea_businesses").delete().eq("idea_id", ideaId).in("business_id", removed);
    if (error) return { ok: false, error: "Couldn’t update who sees this Idea." };
  }
  if (businessIds.length) {
    const { error } = await admin.from("opportunity_idea_businesses").upsert(
      businessIds.map((business_id) => ({ idea_id: ideaId, business_id })),
      { onConflict: "idea_id,business_id", ignoreDuplicates: true }
    );
    if (error) return { ok: false, error: "Couldn’t update who sees this Idea." };
  }
  return { ok: true };
}

export async function createAdminIdea(input: IdeaFormInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAdmin();
  const parsed = validateIdeaInput(input);
  if (!parsed.ok) return parsed;
  const { target_business_ids, ...fields } = parsed.value;
  const { data, error } = await client().from("opportunity_ideas").insert(fields).select("id").single();
  if (error || !data) return { ok: false, error: missing(error) ? UNAVAILABLE : "Couldn’t create the Idea." };
  const targets = await replaceTargets(data.id as string, target_business_ids);
  return targets.ok ? { ok: true, id: data.id as string } : targets;
}

export async function updateAdminIdea(ideaId: string, input: IdeaFormInput): Promise<Result> {
  await requireAdmin();
  const parsed = validateIdeaInput(input);
  if (!parsed.ok) return parsed;
  const { target_business_ids, ...fields } = parsed.value;
  const { data, error } = await client().from("opportunity_ideas").update(fields).eq("id", ideaId).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn’t save the Idea." };
  return replaceTargets(ideaId, target_business_ids);
}

export async function setAdminIdeaStatus(ideaId: string, status: IdeaStatus): Promise<Result> {
  await requireAdmin();
  const { data, error } = await client().from("opportunity_ideas").update({ status }).eq("id", ideaId).select("id").maybeSingle();
  return error || !data ? { ok: false, error: "Couldn’t change the status." } : { ok: true };
}
