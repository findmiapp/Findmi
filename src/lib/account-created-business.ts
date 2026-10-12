// VCL A2 — which Business, if any, Account Home confirms after Brand
// onboarding (/account?created=<id>). Pure and client-safe: it never reads
// anything itself — the caller passes the signed-in user's OWN Businesses
// (from their business_members rows), so `created` can only ever select
// one of those, and only while it is genuinely pending review. Anything
// else (missing, malformed, someone else's, unknown, already live) → null,
// i.e. the ordinary Account Home with nothing revealed.
export interface OwnBusinessSummary {
  id: string;
  pendingReview: boolean;
}

export function resolveCreatedBusiness<B extends OwnBusinessSummary>(created: unknown, ownBusinesses: readonly B[]): B | null {
  if (typeof created !== "string" || !created) return null;
  return ownBusinesses.find((b) => b.id === created && b.pendingReview) ?? null;
}
