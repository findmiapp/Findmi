import "server-only";
import { normalizeStreetAddress } from "@/lib/locationCreation";
import { classifyLocationMatches } from "@/lib/location-import/resolve";
import { buildLocationProposal, type LocationCategoryOption } from "@/lib/location-import/website";
import type { LocationWebsiteRead } from "@/lib/location-import/server";
import type { ExistingLocation, LocationEvidence, LocationProposal, LocationResolution } from "@/lib/location-import/types";
import { hostOf, type EntityResearchInput, type EntityResearchResult } from "@/lib/entity-research";

/** Admin Ingestion Orchestration — prepares a missing Business or Location
 * for operator REVIEW (never creates one). Hierarchy:
 *   1. Findmi's canonical data (a match → reuse; zero research)
 *   2. explicit pasted values (always win)
 *   3. the supplied official website, through the existing extractor
 *   4. contextual web research ONLY when identity/source is still missing
 *      or the supplied site couldn't be read — and then the researched site
 *      goes back through the same deterministic extractor
 *   5. the operator reviews and creates through the existing create paths.
 * Pure orchestration over injected dependencies (testable, no I/O here). */

export type WebsiteSource = "pasted" | "research" | null;

// ── Business ────────────────────────────────────────────────────────────

export interface BusinessPrepareInput {
  name: string;
  /** "Business Website:" as pasted (null when none). */
  website: string | null;
  /** Brand Import already tried the pasted website and failed. */
  websiteReadFailed: boolean;
  eventName?: string | null;
}

export type BusinessPrepareResult =
  /** Findmi already has it (by website, or exact name + place) — select it. */
  | { status: "existing"; candidates: { id: string; name: string; isPublic: boolean }[] }
  /** Brand Import reads this website (pasted, or found by research). */
  | { status: "website"; website: string; source: Exclude<WebsiteSource, null>; research: EntityResearchResult | null; sameAsFailed: boolean }
  /** No website: a minimal prepared Business (name, + research provenance). */
  | { status: "no_website"; research: EntityResearchResult | null };

export interface BusinessPrepareDeps {
  findMatches: (input: { name: string; websiteUrl: string | null }) => Promise<{ id: string; name: string; isPublic: boolean; reasons: string[] }[]>;
  research: (input: EntityResearchInput) => Promise<EntityResearchResult>;
}

export async function prepareBusiness(input: BusinessPrepareInput, deps: BusinessPrepareDeps): Promise<BusinessPrepareResult> {
  const name = input.name.trim();
  const matches = (await deps.findMatches({ name, websiteUrl: input.website }).catch(() => [])).filter((m) => m.reasons.includes("website") || m.reasons.includes("name_location"));
  if (matches.length > 0) return { status: "existing", candidates: matches.slice(0, 3).map(({ id, name: n, isPublic }) => ({ id, name: n, isPublic })) };
  // A supplied website that Brand Import can still read needs no search.
  if (input.website && !input.websiteReadFailed) return { status: "website", website: input.website, source: "pasted", research: null, sameAsFailed: false };
  const research = await deps.research({ kind: "business", name, context: { eventName: input.eventName ?? null, triedWebsite: input.website } });
  if (research.status === "found" && research.website) {
    const tried = input.website ? hostOf(input.website) : null;
    const found = hostOf(research.website);
    return { status: "website", website: research.website, source: "research", research, sameAsFailed: Boolean(tried && found && tried === found) };
  }
  return { status: "no_website", research };
}

// ── Location ────────────────────────────────────────────────────────────

export interface PreparedLocation {
  evidence: LocationEvidence;
  resolution: LocationResolution;
  proposal: LocationProposal;
  website: { url: string | null; source: WebsiteSource; read: "read" | "failed" | "none" };
  research: EntityResearchResult | null;
}

export interface LocationPrepareDeps {
  findCandidates: (e: LocationEvidence) => Promise<ExistingLocation[]>;
  readWebsite: (url: string, supplied: { address: string | null }) => Promise<LocationWebsiteRead>;
  research: (input: EntityResearchInput) => Promise<EntityResearchResult>;
  categories: () => Promise<LocationCategoryOption[]>;
}

export async function prepareLocation(evidence: LocationEvidence, deps: LocationPrepareDeps, context: { eventName?: string | null } = {}): Promise<PreparedLocation> {
  const [candidates, categories] = await Promise.all([deps.findCandidates(evidence).catch(() => []), deps.categories().catch(() => [])]);
  const resolution = classifyLocationMatches(evidence, candidates);
  const base = (e: LocationEvidence) => buildLocationProposal(e, null, categories);
  // Existing / ambiguous / not specific enough: no website read, no research.
  if (resolution.kind !== "new") return { evidence, resolution, proposal: base(evidence), website: { url: evidence.website, source: evidence.website ? "pasted" : null, read: "none" }, research: null };

  const readInto = async (url: string, source: Exclude<WebsiteSource, null>): Promise<{ proposal: LocationProposal; ok: boolean }> => {
    const e = { ...evidence, website: url };
    const read = await deps.readWebsite(url, { address: evidence.address }).catch(() => null);
    if (!read?.ok) return { proposal: base(e), ok: false };
    const p = buildLocationProposal(e, read.facts, categories);
    return { proposal: { ...p, logo: read.logo, cover: read.cover, sources: { ...p.sources, website: source === "research" ? "research" : "provided" } }, ok: true };
  };

  // 1. The pasted Location Website first — success means zero search.
  let pastedFailed = false;
  if (evidence.website) {
    const r = await readInto(evidence.website, "pasted");
    if (r.ok) return { evidence, resolution, proposal: r.proposal, website: { url: evidence.website, source: "pasted", read: "read" }, research: null };
    pastedFailed = true;
  }

  // 2. Contextual research (name + full address — never name alone).
  const research = await deps.research({
    kind: "location",
    name: evidence.name ?? "",
    address: evidence.address,
    city: evidence.city,
    state: evidence.state,
    postalCode: evidence.postalCode,
    context: { eventName: context.eventName ?? null, triedWebsite: evidence.website },
  });
  let proposal = base(evidence);
  let website: PreparedLocation["website"] = { url: evidence.website, source: evidence.website ? "pasted" : null, read: pastedFailed ? "failed" : "none" };
  const sameAsPasted = Boolean(evidence.website && research.website && hostOf(evidence.website) === hostOf(research.website));
  if (research.status === "found" && research.website && !sameAsPasted) {
    const r = await readInto(research.website, "research");
    proposal = r.proposal;
    website = { url: research.website, source: "research", read: r.ok ? "read" : "failed" };
  } else if (research.status === "found" && sameAsPasted) {
    proposal.notes = [...proposal.notes, "Web research confirms the pasted website, but it couldn't be read — create from the details you have."];
  } else if (research.status === "ambiguous") {
    proposal.notes = [...proposal.notes, `Web research couldn't confirm this place's official website${research.suggestions.length ? ` (possible: ${research.suggestions.join(", ")})` : ""}. Add it if you know it.`];
  }
  // A researched address that disagrees with the pasted one is FLAGGED
  // (pasted wins unless the operator changes it).
  const street = research.address?.street;
  if (street && evidence.address && normalizeStreetAddress(street) !== normalizeStreetAddress(evidence.address) && !proposal.conflicts.some((c) => c.field === "address")) {
    proposal.conflicts = [...proposal.conflicts, { field: "address", provided: evidence.address, website: street, from: "research" }];
  }
  return { evidence, resolution, proposal, website, research };
}
