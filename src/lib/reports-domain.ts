// Corrections, removal requests and reports (Trust & Privacy Phase 2A).
// Pure and dependency-free: the public dialog, the /api/reports route, the
// admin queue and the tests share these rules (tests/reports-domain.test.mjs).
// Every list mirrors a CHECK constraint on public.content_reports.
//
// Correction and removal are free and separate from claiming a page:
// claiming grants management; a correction or removal request just asks
// Findmi to review something. Submitting never changes or removes content
// by itself; an admin reviews every report.

export const REPORT_ENTITY_TYPES = ["business", "event", "location", "product", "moment", "appearance", "profile", "conversation", "message"] as const;
export type ReportEntityType = (typeof REPORT_ENTITY_TYPES)[number];

export const REPORT_KINDS = ["correction", "removal", "report", "copyright", "trademark"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_REASONS = ["inaccurate", "privacy", "copyright", "trademark", "impersonation", "safety", "abusive", "spam_scam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORTER_RELATIONSHIPS = ["organization", "rights_holder", "authorized_agent", "subject", "visitor", "other"] as const;
export type ReporterRelationship = (typeof REPORTER_RELATIONSHIPS)[number];

export const REPORT_STATUSES = ["open", "in_review", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_RESOLUTIONS = ["corrected", "removed", "restricted", "no_action", "other"] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  inaccurate: "Inaccurate information",
  privacy: "Privacy concern",
  copyright: "Copyright",
  trademark: "Trademark",
  impersonation: "Impersonation",
  safety: "Safety concern",
  abusive: "Abusive content",
  spam_scam: "Spam or scam",
  other: "Something else",
};

export const REPORTER_RELATIONSHIP_LABELS: Record<ReporterRelationship, string> = {
  organization: "I represent this organization",
  rights_holder: "I own the rights to this content",
  authorized_agent: "I'm authorized to act for the rights owner",
  subject: "This is about me",
  visitor: "I'm a visitor",
  other: "Other",
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  in_review: "In Review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const REPORT_RESOLUTION_LABELS: Record<ReportResolution, string> = {
  corrected: "Corrected",
  removed: "Removed",
  restricted: "Restricted",
  no_action: "No Action Needed",
  other: "Other",
};

/** The three public entry points and the reasons each offers. Copyright
 * and trademark complaints are "Request Removal" reasons; they are stored
 * as their own kind so the admin queue can treat them separately. */
export type ReportIntent = "correction" | "removal" | "report";

export const INTENT_LABELS: Record<ReportIntent, string> = {
  correction: "Suggest A Correction",
  removal: "Request Removal",
  report: "Report",
};

export const INTENT_REASONS: Record<ReportIntent, readonly ReportReason[]> = {
  correction: ["inaccurate", "other"],
  removal: ["privacy", "copyright", "trademark", "impersonation", "inaccurate", "other"],
  report: ["inaccurate", "impersonation", "safety", "abusive", "spam_scam", "privacy", "other"],
};

/** Which intents a kind of content offers. Conversations and messages are
 * reported (never "corrected"); everything public offers all three. */
export function intentsFor(entityType: ReportEntityType): ReportIntent[] {
  if (entityType === "conversation" || entityType === "message") return ["report"];
  if (entityType === "moment" || entityType === "profile") return ["removal", "report"];
  return ["correction", "removal", "report"];
}

export function kindFor(intent: ReportIntent, reason: ReportReason): ReportKind {
  if (intent === "removal" && reason === "copyright") return "copyright";
  if (intent === "removal" && reason === "trademark") return "trademark";
  return intent;
}

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

export const isReportEntityType = oneOf(REPORT_ENTITY_TYPES);
export const isReportReason = oneOf(REPORT_REASONS);
export const isReporterRelationship = oneOf(REPORTER_RELATIONSHIPS);
export const isReportStatus = oneOf(REPORT_STATUSES);
export const isReportResolution = oneOf(REPORT_RESOLUTIONS);
export const isReportIntent = oneOf(["correction", "removal", "report"] as const);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_REPORT_DETAILS = 4000;

export interface ReportInput {
  entityType: ReportEntityType;
  entityId: string;
  intent: ReportIntent;
  reason: ReportReason;
  details: string | null;
  evidenceUrl: string | null;
  relationship: ReporterRelationship | null;
  /** Signed-out reporters only, and only if they want a reply. */
  email: string | null;
}

/** Validates a raw submission. Copyright and trademark complaints need a
 * description of the work or mark and the reporter's relationship to it;
 * a correction needs the details of what is wrong. Nothing else is asked
 * for, so a report never collects more than it needs. */
export function validateReport(raw: Record<string, unknown>): { ok: true; value: ReportInput } | { ok: false; error: string } {
  const entityType = raw.entityType;
  const entityId = raw.entityId;
  const intent = raw.intent;
  const reason = raw.reason;
  if (!isReportEntityType(entityType) || typeof entityId !== "string" || !UUID_RE.test(entityId)) return { ok: false, error: "That page couldn't be found." };
  if (!isReportIntent(intent) || !intentsFor(entityType).includes(intent)) return { ok: false, error: "Choose what you'd like to do." };
  if (!isReportReason(reason) || !INTENT_REASONS[intent].includes(reason)) return { ok: false, error: "Choose a reason." };

  const details = typeof raw.details === "string" && raw.details.trim() ? raw.details.trim().slice(0, MAX_REPORT_DETAILS) : null;
  const relationship = isReporterRelationship(raw.relationship) ? raw.relationship : null;
  let evidenceUrl: string | null = null;
  if (typeof raw.evidenceUrl === "string" && raw.evidenceUrl.trim()) {
    const v = raw.evidenceUrl.trim();
    try {
      const u = new URL(v);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Enter a valid link." };
    } catch {
      return { ok: false, error: "Enter a valid link." };
    }
    evidenceUrl = v.slice(0, 2048);
  }
  let email: string | null = null;
  if (typeof raw.email === "string" && raw.email.trim()) {
    if (!EMAIL_RE.test(raw.email.trim())) return { ok: false, error: "Enter a valid email address, or leave it blank." };
    email = raw.email.trim().toLowerCase().slice(0, 320);
  }

  if (intent === "correction" && !details) return { ok: false, error: "Tell Findmi what should be corrected." };
  const kind = kindFor(intent, reason);
  if ((kind === "copyright" || kind === "trademark") && (!details || !relationship)) {
    return { ok: false, error: "Describe the work or mark, and your relationship to it." };
  }
  return { ok: true, value: { entityType, entityId, intent, reason, details, evidenceUrl, relationship, email } };
}
