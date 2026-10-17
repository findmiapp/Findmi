// Brand Intelligence V1.1 — Admin Opportunity Intelligence Command Center.
// Dependency-free aggregation over the EXISTING V1 rows (brand_audits,
// brand_audit_answers, opportunity_ideas, opportunity_idea_responses,
// businesses) plus the Admin review state (admin_intelligence_reviews).
// Nothing here is stored or duplicated; every signal is derived from real
// timestamps. Tested directly by tests/brand-intelligence.test.mjs.

import {
  AUDIT_KEYS,
  AUDIT_SECTIONS,
  SECTION_OF_KIND,
  auditOptionLabel,
  auditProgress,
  IDEA_RESPONSES,
  type AuditKind,
  type AuditSection,
  type AuditStatus,
  type IdeaResponse,
} from "./brand-audit-domain";

export const SIGNAL_TYPES = ["brand_audit", "idea_response"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export const isSignalType = (v: unknown): v is SignalType => typeof v === "string" && (SIGNAL_TYPES as readonly string[]).includes(v);

/** A completion and the save that completed it land within this window;
 * anything later on a completed audit is an update. */
const SAME_SAVE_MS = 60_000;

export interface AuditRow {
  business_id: string;
  status: AuditStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface AnswerRow {
  business_id: string;
  kind: AuditKind;
  option_key: string;
  updated_at?: string;
}
/** brand_audit_markets (declared) — V1.2 geography. */
export interface GeoRow {
  business_id: string;
  intent: "current" | "priority";
  level: string;
  place_key: string;
  label: string;
  created_at: string;
  updated_at: string;
}
export interface ResponseRow {
  id: string;
  idea_id: string;
  business_id: string;
  response: IdeaResponse;
  note: string | null;
  created_at: string;
  updated_at: string;
}
export interface IdeaRow {
  id: string;
  title: string;
  status: string;
}
export interface ReviewRow {
  signal_type: SignalType;
  signal_id: string;
  reviewed_at: string;
}

export type SignalEvent = "audit_completed" | "audit_updated" | "audit_in_progress" | "idea_responded" | "idea_response_changed";

export interface IntelligenceSignal {
  type: SignalType;
  id: string;
  /** Source row's updated_at — when the Brand last changed it. */
  at: string;
  isNew: boolean;
  event: SignalEvent;
  business: { id: string; name: string };
  /** Brand Audit signals. */
  audit?: {
    progress: number;
    goals: string[];
    challenges: string[];
    audiences: string[];
    ages: string[];
    priorities: string[];
    scope: string | null;
    currentMarkets: string[];
    priorityMarkets: string[];
    environments: string[];
    /** Sections the Brand changed since Admin last reviewed (or since it
     * completed, if never reviewed) — "Red Bull updated Target Audience". */
    changedSections: AuditSection[];
    /** Priority places added in that window — "added New York City". */
    addedPriorityMarkets: string[];
  };
  /** Idea response signals. */
  idea?: { id: string; title: string; response: IdeaResponse; note: string | null };
}

const ms = (iso: string) => new Date(iso).getTime();

export function auditEvent(a: AuditRow): SignalEvent {
  if (a.status !== "complete") return "audit_in_progress";
  return a.completed_at && ms(a.updated_at) - ms(a.completed_at) <= SAME_SAVE_MS ? "audit_completed" : "audit_updated";
}

/** NEW unless Admin reviewed it at or after the Brand's last change. */
export function isSignalNew(at: string, review: ReviewRow | undefined): boolean {
  return !review || ms(at) > ms(review.reviewed_at);
}

export function buildSignals(input: {
  audits: AuditRow[];
  answers: AnswerRow[];
  responses: ResponseRow[];
  ideas: IdeaRow[];
  businesses: { id: string; name: string }[];
  reviews: ReviewRow[];
  geo?: GeoRow[];
}): IntelligenceSignal[] {
  const names = new Map(input.businesses.map((b) => [b.id, b.name]));
  const ideas = new Map(input.ideas.map((i) => [i.id, i]));
  const reviews = new Map(input.reviews.map((r) => [`${r.signal_type}:${r.signal_id}`, r]));
  const business = (id: string) => ({ id, name: names.get(id) ?? "Business" });

  const auditSignals = input.audits.flatMap((a): IntelligenceSignal[] => {
    const mine = input.answers.filter((x) => x.business_id === a.business_id);
    const geo = (input.geo ?? []).filter((g) => g.business_id === a.business_id);
    const labels = (kind: AuditKind) =>
      mine
        .filter((x) => x.kind === kind)
        .sort((x, y) => AUDIT_KEYS[kind].indexOf(x.option_key) - AUDIT_KEYS[kind].indexOf(y.option_key))
        .map((x) => auditOptionLabel(kind, x.option_key));
    const goals = labels("goal");
    const challenges = labels("challenge");
    // An audit row with no answers says nothing yet.
    if (mine.length === 0 && geo.length === 0) return [];
    const review = reviews.get(`brand_audit:${a.business_id}`);
    // "Changed since": Admin's last review, else (never reviewed) after the
    // save that completed the audit; an unfinished, unreviewed audit has no
    // baseline, so nothing is singled out.
    const since = review ? ms(review.reviewed_at) : a.completed_at ? ms(a.completed_at) + SAME_SAVE_MS : null;
    const changed = new Set<AuditSection>();
    if (since !== null) {
      for (const x of mine) if (x.updated_at && ms(x.updated_at) > since) changed.add(SECTION_OF_KIND[x.kind]);
      if (geo.some((g) => ms(g.updated_at) > since)) changed.add("markets");
    }
    const audiences = labels("audience");
    const ages = labels("age_range");
    const priorities = labels("audience_priority");
    const environments = labels("environment");
    const scope = labels("market_scope")[0] ?? null;
    const currentMarkets = geo.filter((g) => g.intent === "current").map((g) => g.label);
    const priorityMarkets = geo.filter((g) => g.intent === "priority").map((g) => g.label);
    return [
      {
        type: "brand_audit",
        id: a.business_id,
        at: a.updated_at,
        isNew: isSignalNew(a.updated_at, review),
        event: auditEvent(a),
        business: business(a.business_id),
        audit: {
          progress: auditProgress({
            status: a.status,
            goalCount: goals.length,
            challengeCount: challenges.length,
            audienceCount: audiences.length + ages.length + priorities.length,
            marketCount: (scope ? 1 : 0) + geo.length,
            environmentCount: environments.length,
            completedAt: a.completed_at,
            updatedAt: a.updated_at,
          }),
          goals,
          challenges,
          audiences,
          ages,
          priorities,
          scope,
          currentMarkets,
          priorityMarkets,
          environments,
          changedSections: AUDIT_SECTIONS.filter((k) => changed.has(k)),
          addedPriorityMarkets: since === null ? [] : geo.filter((g) => g.intent === "priority" && ms(g.created_at) > since).map((g) => g.label),
        },
      },
    ];
  });

  const responseSignals = input.responses.map(
    (r): IntelligenceSignal => ({
      type: "idea_response",
      id: r.id,
      at: r.updated_at,
      isNew: isSignalNew(r.updated_at, reviews.get(`idea_response:${r.id}`)),
      event: ms(r.updated_at) - ms(r.created_at) > SAME_SAVE_MS ? "idea_response_changed" : "idea_responded",
      business: business(r.business_id),
      idea: { id: r.idea_id, title: ideas.get(r.idea_id)?.title ?? "Idea", response: r.response, note: r.note },
    })
  );

  return [...auditSignals, ...responseSignals].sort((x, y) => ms(y.at) - ms(x.at) || x.id.localeCompare(y.id));
}

export interface IntelligenceMetrics {
  newSignals: number;
  brandsProfiled: number;
  completedAudits: number;
  interested: number;
  maybe: number;
  notForUs: number;
  /** Distinct Businesses with at least one Interested or Maybe response. */
  brandsOpenToIdeas: number;
  /** New signals by kind — the dashboard summary. */
  newBreakdown: { interested: number; maybe: number; notForUs: number; auditsCompleted: number; auditsUpdated: number };
}

export function intelligenceMetrics(signals: IntelligenceSignal[], audits: AuditRow[], responses: ResponseRow[]): IntelligenceMetrics {
  const fresh = signals.filter((s) => s.isNew);
  const count = (r: IdeaResponse) => responses.filter((x) => x.response === r).length;
  const freshResponse = (r: IdeaResponse) => fresh.filter((s) => s.idea?.response === r).length;
  return {
    newSignals: fresh.length,
    brandsProfiled: signals.filter((s) => s.type === "brand_audit").length,
    completedAudits: audits.filter((a) => a.status === "complete").length,
    interested: count("interested"),
    maybe: count("maybe"),
    notForUs: count("not_for_us"),
    brandsOpenToIdeas: new Set(responses.filter((r) => r.response !== "not_for_us").map((r) => r.business_id)).size,
    newBreakdown: {
      interested: freshResponse("interested"),
      maybe: freshResponse("maybe"),
      notForUs: freshResponse("not_for_us"),
      auditsCompleted: fresh.filter((s) => s.event === "audit_completed").length,
      auditsUpdated: fresh.filter((s) => s.event === "audit_updated" || s.event === "audit_in_progress").length,
    },
  };
}

export interface BrandIntelligenceRow {
  business: { id: string; name: string };
  audit: IntelligenceSignal["audit"] | null;
  auditEvent: SignalEvent | null;
  interested: number;
  maybe: number;
  notForUs: number;
  /** Titles of Ideas this Brand is Interested in / Maybe on. */
  openTo: string[];
  isNew: boolean;
  lastAt: string;
}

/** One row per Brand with any intelligence; new first, then most recent. */
export function intelligenceByBrand(signals: IntelligenceSignal[]): BrandIntelligenceRow[] {
  const rows = new Map<string, BrandIntelligenceRow>();
  for (const s of signals) {
    const row =
      rows.get(s.business.id) ??
      ({ business: s.business, audit: null, auditEvent: null, interested: 0, maybe: 0, notForUs: 0, openTo: [], isNew: false, lastAt: s.at } as BrandIntelligenceRow);
    if (s.audit) {
      row.audit = s.audit;
      row.auditEvent = s.event;
    }
    if (s.idea) {
      if (s.idea.response === "interested") row.interested += 1;
      else if (s.idea.response === "maybe") row.maybe += 1;
      else row.notForUs += 1;
      if (s.idea.response !== "not_for_us") row.openTo.push(s.idea.title);
    }
    row.isNew ||= s.isNew;
    if (ms(s.at) > ms(row.lastAt)) row.lastAt = s.at;
    rows.set(s.business.id, row);
  }
  return [...rows.values()].sort((a, b) => Number(b.isNew) - Number(a.isNew) || ms(b.lastAt) - ms(a.lastAt));
}

export interface IdeaDemandRow {
  idea: { id: string; title: string; status: string };
  counts: Record<IdeaResponse, number>;
  businesses: Record<IdeaResponse, { id: string; name: string }[]>;
  newCount: number;
}

/** Demand by Idea, strongest first (Interested, then Maybe). Every Idea
 * with at least one response, whatever its current status. */
export function intelligenceByIdea(signals: IntelligenceSignal[], ideas: IdeaRow[]): IdeaDemandRow[] {
  const rows = new Map<string, IdeaDemandRow>();
  for (const s of signals) {
    if (!s.idea) continue;
    const idea = ideas.find((i) => i.id === s.idea!.id) ?? { id: s.idea.id, title: s.idea.title, status: "draft" };
    const row =
      rows.get(idea.id) ??
      ({
        idea: { id: idea.id, title: idea.title, status: idea.status },
        counts: Object.fromEntries(IDEA_RESPONSES.map((r) => [r, 0])),
        businesses: Object.fromEntries(IDEA_RESPONSES.map((r) => [r, []])),
        newCount: 0,
      } as unknown as IdeaDemandRow);
    row.counts[s.idea.response] += 1;
    row.businesses[s.idea.response].push(s.business);
    if (s.isNew) row.newCount += 1;
    rows.set(idea.id, row);
  }
  return [...rows.values()].sort((a, b) => b.counts.interested - a.counts.interested || b.counts.maybe - a.counts.maybe || a.idea.title.localeCompare(b.idea.title));
}

/** "Updated Target Audience & Markets · Added New York City As A Priority
 * Market" — the specific change when it's known, else the event headline. */
export function auditChangeHeadline(s: IntelligenceSignal, sectionLabels: Record<AuditSection, string>): string | null {
  if (!s.audit || s.event === "audit_completed") return null;
  const parts: string[] = [];
  const sections = s.audit.changedSections.map((k) => sectionLabels[k]);
  if (sections.length) parts.push(`Updated ${sections.length > 1 ? `${sections.slice(0, -1).join(", ")} & ${sections.at(-1)}` : sections[0]}`);
  if (s.audit.addedPriorityMarkets.length) {
    const places = s.audit.addedPriorityMarkets;
    parts.push(`Added ${places.length > 2 ? `${places.slice(0, 2).join(", ")} +${places.length - 2}` : places.join(" & ")} As ${places.length > 1 ? "Priority Markets" : "A Priority Market"}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export const SIGNAL_HEADLINE: Record<SignalEvent, string> = {
  audit_completed: "Completed Brand Audit",
  audit_updated: "Updated Brand Audit",
  audit_in_progress: "Brand Audit In Progress",
  idea_responded: "Responded",
  idea_response_changed: "Changed Response",
};
