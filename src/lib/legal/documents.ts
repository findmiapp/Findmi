// Findmi legal documents registry: the ONE place that names each document
// Findmi may ask someone to accept, the version currently in force, and
// where acceptance applies. Pure (tests/legal-acceptance.test.mjs).
//
// A null `currentVersion` means "not published": nothing is required,
// nothing blocks an existing flow and no acceptance is recorded. Publishing
// a document is a one-line version change here plus the UI notice for its
// contexts; no migration.
//
// Published (Oct 2026): the Terms of Service and the Privacy Policy, both
// at signup only. The version is the page's "Last updated" date
// (lib/legal/published.ts). Signup shows "By creating an account, you
// agree to Findmi's Terms of Service and acknowledge the Privacy Policy",
// so the Privacy Policy is recorded as an acknowledgement, not agreement.
// Nothing reads outstanding documents to gate a flow, so existing accounts
// are never blocked or sent through a reacceptance step.

export const LEGAL_DOCUMENT_IDS = [
  "terms",
  "privacy_acknowledgement",
  "business_terms",
  "marketplace_buyer_terms",
  "marketplace_seller_terms",
  "managed_services_terms",
  "opportunity_terms",
  "content_terms",
] as const;
export type LegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number];

export const LEGAL_ACCEPTANCE_CONTEXTS = [
  "signup",
  "business_claim",
  "business_creation",
  "marketplace_checkout",
  "seller_onboarding",
  "moment_publish",
  "managed_service",
  "opportunity_engagement",
  "reacceptance",
] as const;
export type LegalAcceptanceContext = (typeof LEGAL_ACCEPTANCE_CONTEXTS)[number];

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  /** Public route once published. */
  path: string;
  /** Version in force, e.g. "2026-12-01". null = not yet published. */
  currentVersion: string | null;
  /** Contexts where this document applies once published. */
  contexts: readonly LegalAcceptanceContext[];
}

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  terms: { id: "terms", title: "Terms of Service", path: "/terms", currentVersion: "2026-10-25", contexts: ["signup", "reacceptance"] },
  privacy_acknowledgement: { id: "privacy_acknowledgement", title: "Privacy Policy", path: "/privacy", currentVersion: "2026-10-25", contexts: ["signup", "reacceptance"] },
  business_terms: { id: "business_terms", title: "Business Terms", path: "/legal/business", currentVersion: null, contexts: ["business_claim", "business_creation", "reacceptance"] },
  marketplace_buyer_terms: { id: "marketplace_buyer_terms", title: "Marketplace Buyer Terms", path: "/legal/marketplace-buyers", currentVersion: null, contexts: ["marketplace_checkout"] },
  marketplace_seller_terms: { id: "marketplace_seller_terms", title: "Marketplace Seller Terms", path: "/legal/marketplace-sellers", currentVersion: null, contexts: ["seller_onboarding", "reacceptance"] },
  managed_services_terms: { id: "managed_services_terms", title: "Managed Services Terms", path: "/legal/managed-services", currentVersion: null, contexts: ["managed_service"] },
  opportunity_terms: { id: "opportunity_terms", title: "Opportunity Terms", path: "/legal/opportunities", currentVersion: null, contexts: ["opportunity_engagement"] },
  content_terms: { id: "content_terms", title: "Content Terms", path: "/legal/content", currentVersion: null, contexts: ["moment_publish"] },
};

export function isLegalDocumentId(value: unknown): value is LegalDocumentId {
  return typeof value === "string" && (LEGAL_DOCUMENT_IDS as readonly string[]).includes(value);
}

export function isLegalAcceptanceContext(value: unknown): value is LegalAcceptanceContext {
  return typeof value === "string" && (LEGAL_ACCEPTANCE_CONTEXTS as readonly string[]).includes(value);
}

/** Published documents that apply in a context (none until Phase 2B). */
export function documentsForContext(context: LegalAcceptanceContext, registry: Record<LegalDocumentId, LegalDocument> = LEGAL_DOCUMENTS): LegalDocument[] {
  return Object.values(registry).filter((d) => d.currentVersion !== null && d.contexts.includes(context));
}

/** Given someone's latest accepted version per document, which published
 * documents still need (re)acceptance in this context. A version change
 * (a material update) makes an older acceptance stale. */
export function outstandingDocuments(
  context: LegalAcceptanceContext,
  accepted: Partial<Record<LegalDocumentId, string>>,
  registry: Record<LegalDocumentId, LegalDocument> = LEGAL_DOCUMENTS
): LegalDocument[] {
  return documentsForContext(context, registry).filter((d) => accepted[d.id] !== d.currentVersion);
}
