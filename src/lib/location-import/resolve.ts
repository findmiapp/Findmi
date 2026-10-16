import { normalizeStreetAddress } from "@/lib/locationCreation";
import { canOfferLocationCreate } from "@/lib/event-import/review";
import type { ExistingLocation, LocationEvidence, LocationResolution } from "./types";

/** Location Import V1 — MATCH BEFORE CREATE. The first job is never
 * enrichment: it is making sure a place already on Findmi is reused, a
 * genuinely new one is created once, and anything uncertain goes to the
 * operator instead of being guessed. Candidates come from the one shared
 * duplicate finder (lib/locationCreation.ts findLikelyDuplicateLocations —
 * same street+locality, or same name+locality); this decides what they mean. */

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["the", "and", "of", "at", "in", "on", "nyc", "new", "york", "store", "shop", "location", "flagship", "co", "inc", "llc"]);
const tokens = (v: string | null | undefined) => norm(v).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));

/** Names that plainly refer to the same place: equal, one containing the
 * other, or sharing a distinctive word ("Shopify NY" ~ "Shopify New York").
 * Only ever used TOGETHER with an equal street address. */
export function similarLocationNames(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const cx = x.replace(/ /g, "");
  const cy = y.replace(/ /g, "");
  if (cx.length >= 4 && cy.length >= 4 && (cx.includes(cy) || cy.includes(cx))) return true;
  const tx = new Set(tokens(x));
  return tokens(y).some((t) => tx.has(t));
}

const zip5 = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(0, 5);

function sameStreet(e: LocationEvidence, c: ExistingLocation): boolean | null {
  if (!e.address || !c.address) return null;
  if (normalizeStreetAddress(e.address) !== normalizeStreetAddress(c.address)) return false;
  const ez = zip5(e.postalCode);
  const cz = zip5(c.postal_code);
  if (ez.length === 5 && cz.length === 5) return ez === cz;
  const agree = (a: string | null, b: string | null) => !a || !b || norm(a) === norm(b);
  return agree(e.city, c.city) && agree(e.state, c.state);
}

/** Why this evidence can't create a NEW canonical Location (null = it can).
 * The same conservative rule as Missing-Location Quick Create
 * (canOfferLocationCreate): a named place with a numbered street address,
 * city and state — never an area, intersection, placeholder or bare city. */
export function locationIdentityIssue(e: Pick<LocationEvidence, "name" | "address" | "city" | "state">): string | null {
  if (!e.name?.trim()) return "Add the Location Name.";
  if (!e.address?.trim()) return "Add a street address (with a building number).";
  if (!e.city?.trim() || !e.state?.trim()) return "Add the City and State.";
  const ok = canOfferLocationCreate(
    { venueName: e.name, address: e.address, city: e.city, state: e.state, postalCode: null, useLocationId: null },
    { locationVisibility: "exact", online: false }
  );
  return ok ? null : "This isn't a specific place yet — an area, corner or intersection can't become a Findmi Location. Add the building's street address.";
}

/** What the candidates mean for this evidence. */
export function classifyLocationMatches(e: LocationEvidence, candidates: readonly ExistingLocation[]): LocationResolution {
  const relevant: ExistingLocation[] = [];
  const strong: ExistingLocation[] = [];
  for (const c of candidates) {
    const street = sameStreet(e, c);
    // A DIFFERENT known street address is a different place (another
    // branch with the same name) — never a candidate.
    if (street === false) continue;
    relevant.push(c);
    if (street === true && similarLocationNames(e.name, c.name)) strong.push(c);
  }
  if (strong.length === 1) return { kind: "existing", location: strong[0] };
  if (strong.length > 1) return { kind: "ambiguous", candidates: strong };
  if (relevant.length > 0) return { kind: "ambiguous", candidates: relevant };
  const issue = locationIdentityIssue(e);
  return issue ? { kind: "insufficient", reason: issue } : { kind: "new" };
}

/** Resolves every distinct place in a batch ONCE (the same key never asks
 * the database twice, so five mentions → one resolution). */
export async function resolveLocationBatch(
  evidence: readonly LocationEvidence[],
  findCandidates: (e: LocationEvidence) => Promise<ExistingLocation[]>
): Promise<Map<string, LocationResolution>> {
  const out = new Map<string, LocationResolution>();
  for (const e of evidence) {
    if (out.has(e.key)) continue;
    let candidates: ExistingLocation[] = [];
    if (e.name?.trim() || e.address?.trim()) {
      try {
        candidates = await findCandidates(e);
      } catch {
        candidates = [];
      }
    }
    out.set(e.key, classifyLocationMatches(e, candidates));
  }
  return out;
}

export { tallyLocationImport, type LocationImportTally, type LocationRowOutcome } from "./tally";
