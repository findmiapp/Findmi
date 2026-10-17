import "server-only";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireAdmin } from "@/lib/admin/auth";
import {
  buildSignals,
  intelligenceByBrand,
  intelligenceByIdea,
  intelligenceMetrics,
  isSignalType,
  type AnswerRow,
  type AuditRow,
  type BrandIntelligenceRow,
  type GeoRow,
  type IdeaDemandRow,
  type IdeaRow,
  type IntelligenceMetrics,
  type IntelligenceSignal,
  type ResponseRow,
  type ReviewRow,
  type SignalType,
} from "@/lib/brand-intelligence-domain";

// Brand Intelligence V1.1 — Admin Opportunity Intelligence Command Center.
// ADMIN ONLY: every exported function runs requireAdmin() first and reads
// through the service role. It aggregates the existing V1 tables (never
// copies them) plus admin_intelligence_reviews. It never reads
// business_intelligence_notes. Tolerates the V1.1 review table not
// existing yet (every signal reads as New; marking reviewed returns a
// friendly error) and the V1 tables not existing (available: false).

type Result = { ok: true } | { ok: false; error: string };

function client() {
  const admin = getAdminSupabase();
  if (!admin) throw new Error("Findmi is unavailable right now.");
  return admin;
}

const missing = (error: { code?: string } | null | undefined) => error?.code === "42P01" || error?.code === "PGRST205";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CommandCenter {
  available: boolean;
  /** False until the V1.1 migration is applied — review state can't persist. */
  reviewsAvailable: boolean;
  signals: IntelligenceSignal[];
  metrics: IntelligenceMetrics;
  byBrand: BrandIntelligenceRow[];
  byIdea: IdeaDemandRow[];
}

const EMPTY: CommandCenter = {
  available: false,
  reviewsAvailable: false,
  signals: [],
  metrics: intelligenceMetrics([], [], []),
  byBrand: [],
  byIdea: [],
};

async function loadSignals() {
  const admin = client();
  const [audits, answers, responses, ideas, reviews, geo] = await Promise.all([
    admin.from("brand_audits").select("business_id, status, completed_at, created_at, updated_at"),
    admin.from("brand_audit_answers").select("business_id, kind, option_key, updated_at").eq("source", "declared"),
    admin.from("opportunity_idea_responses").select("id, idea_id, business_id, response, note, created_at, updated_at"),
    admin.from("opportunity_ideas").select("id, title, status"),
    admin.from("admin_intelligence_reviews").select("signal_type, signal_id, reviewed_at"),
    admin.from("brand_audit_markets").select("business_id, intent, level, place_key, label, created_at, updated_at").eq("source", "declared"),
  ]);
  if (audits.error || answers.error || responses.error || ideas.error || geo.error) return null;
  const auditRows = (audits.data ?? []) as AuditRow[];
  const responseRows = (responses.data ?? []) as ResponseRow[];
  const ideaRows = (ideas.data ?? []) as IdeaRow[];
  const businessIds = [...new Set([...auditRows.map((a) => a.business_id), ...responseRows.map((r) => r.business_id)])];
  const { data: businesses } = businessIds.length ? await admin.from("businesses").select("id, name").in("id", businessIds) : { data: [] };
  const signals = buildSignals({
    audits: auditRows,
    answers: (answers.data ?? []) as AnswerRow[],
    responses: responseRows,
    ideas: ideaRows,
    businesses: (businesses ?? []) as { id: string; name: string }[],
    reviews: reviews.error ? [] : ((reviews.data ?? []) as ReviewRow[]),
    geo: (geo.data ?? []) as GeoRow[],
  });
  return { signals, auditRows, responseRows, ideaRows, reviewsAvailable: !reviews.error };
}

export async function getCommandCenter(): Promise<CommandCenter> {
  await requireAdmin();
  const loaded = await loadSignals();
  if (!loaded) return EMPTY;
  const { signals, auditRows, responseRows, ideaRows, reviewsAvailable } = loaded;
  return {
    available: true,
    reviewsAvailable,
    signals,
    metrics: intelligenceMetrics(signals, auditRows, responseRows),
    byBrand: intelligenceByBrand(signals),
    byIdea: intelligenceByIdea(signals, ideaRows),
  };
}

/** New-signal summary for the Admin dashboard and the Opportunities tab. */
export async function getIntelligenceSummary(): Promise<IntelligenceMetrics | null> {
  await requireAdmin();
  const loaded = await loadSignals();
  return loaded ? intelligenceMetrics(loaded.signals, loaded.auditRows, loaded.responseRows) : null;
}

async function upsertReviews(rows: { signal_type: SignalType; signal_id: string }[]): Promise<Result> {
  if (rows.length === 0) return { ok: true };
  const reviewed_at = new Date().toISOString();
  const { error } = await client()
    .from("admin_intelligence_reviews")
    .upsert(
      rows.map((r) => ({ ...r, reviewed_at })),
      { onConflict: "signal_type,signal_id" }
    );
  if (error) return { ok: false, error: missing(error) ? "Review tracking isn’t available yet — apply the V1.1 migration." : "Couldn’t mark reviewed." };
  return { ok: true };
}

export async function markSignalReviewed(type: string, id: string): Promise<Result> {
  await requireAdmin();
  if (!isSignalType(type) || !UUID_RE.test(id)) return { ok: false, error: "That signal isn’t available." };
  return upsertReviews([{ signal_type: type, signal_id: id }]);
}

/** Marks every signal that is new RIGHT NOW (recomputed server-side, never
 * a client-supplied list). */
export async function markAllSignalsReviewed(): Promise<Result> {
  await requireAdmin();
  const loaded = await loadSignals();
  if (!loaded) return { ok: false, error: "Opportunity Intelligence isn’t available yet." };
  return upsertReviews(loaded.signals.filter((s) => s.isNew).map((s) => ({ signal_type: s.type, signal_id: s.id })));
}
