// Add Business — SEARCH EXISTING FIRST. Pure rules (no I/O) shared by the
// lookup route and its tests (tests/add-business-search-first.test.mjs).
//
// As a person types a Business name, existing PUBLIC Findmi Businesses are
// shown first (logo, name, category, geography — the same narrow public
// card /join/brand renders), each routed into the existing path for its
// state, so a duplicate is never the easy option:
//
//   manage    the viewer already manages it     → its Business Manager
//   claim     nobody manages it (no member, no  → the existing claim flow
//             pending claim)                      (ClaimButton ?claim=1)
//   pending   someone's claim is under review   → its public profile
//   request   it is already managed by others   → its public profile, to
//                                                  contact the Business and
//                                                  ask for access
//
// Only when nothing fits does the person continue to "Create [typed name]"
// — the ordinary creation form, whose server action re-checks duplicates
// on submit anyway.

import type { BusinessManagementState } from "./moment-author";

export const BUSINESS_SEARCH_MIN_CHARS = 3;
export const BUSINESS_SEARCH_DEBOUNCE_MS = 350;

export type BusinessMatchAction = "manage" | "claim" | "pending" | "request";

export interface BusinessSearchCard {
  slug: string;
  name: string;
  logoUrl: string | null;
  category: string | null;
  /** "City, ST" when known. */
  place: string | null;
  action: BusinessMatchAction;
  href: string;
}

export function businessMatchAction(state: BusinessManagementState, viewerIsMember: boolean): BusinessMatchAction {
  if (viewerIsMember) return "manage";
  if (state === "unclaimed") return "claim";
  if (state === "claim_pending") return "pending";
  return "request";
}

export const BUSINESS_MATCH_ACTION_LABELS: Record<BusinessMatchAction, { cta: string; note: string }> = {
  manage: { cta: "Manage", note: "You already manage this Business." },
  claim: { cta: "Claim", note: "Not managed yet — claim it for free." },
  pending: { cta: "View", note: "A claim is already under review." },
  request: { cta: "Request Access", note: "Already managed — contact the Business from its profile to ask for access." },
};

/** Where each action goes — always an existing route. */
export function businessMatchHref(action: BusinessMatchAction, input: { id: string; slug: string }, authenticated: boolean): string {
  const profile = `/business/${encodeURIComponent(input.slug)}`;
  if (action === "manage") return `/account/business/${encodeURIComponent(input.id)}`;
  if (action === "claim") {
    const target = `${profile}?claim=1`;
    return authenticated ? target : `/login?next=${encodeURIComponent(target)}`;
  }
  return profile;
}

/** Is a typed name worth a lookup? */
export function isMeaningfulBusinessQuery(raw: string): boolean {
  return raw.trim().replace(/\s+/g, " ").length >= BUSINESS_SEARCH_MIN_CHARS;
}

export function placeLabel(city: string | null, state: string | null): string | null {
  return [city, state].filter(Boolean).join(", ") || null;
}

export interface BusinessLookupResult {
  results: BusinessSearchCard[];
  /** Signed-in only: a matching Business may exist but isn't public. */
  possiblePrivateMatch: boolean;
  rateLimited?: boolean;
}
