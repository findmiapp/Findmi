// Entity Media Completeness V1 — find and FILL-ONLY apply a Business's or a
// Location's missing logo / cover from Admin Event Import Review.
//
// No new media system: the website is the stored one, else the website
// this import supplied, else the existing Entity Research (researchEntity);
// the site is read by the existing website reader (Location Import's
// readLocationWebsite — Brand Import's safe page fetch, page extraction and
// image verification), and an approved candidate is re-verified and
// re-hosted by the existing brand-image storage. Writes only ever fill an
// EMPTY logo_url / cover_image_url — never replace one (guarded again in
// the update itself, so a field filled meanwhile is never overwritten).
// Event creative is never taken from here.

export type EntityMediaKind = "business" | "location";
export type EntityMediaRole = "logo" | "cover";

export interface EntityMediaRow {
  id: string;
  name: string;
  logo_url: string | null;
  cover_image_url: string | null;
  website_url: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

export interface EntityMediaState {
  kind: EntityMediaKind;
  id: string;
  name: string;
  logo: boolean;
  cover: boolean;
  website: string | null;
}

export const MEDIA_COLUMN: Record<EntityMediaRole, "logo_url" | "cover_image_url"> = { logo: "logo_url", cover: "cover_image_url" };

const present = (v: string | null | undefined) => Boolean(v && v.trim());

export function entityMediaState(kind: EntityMediaKind, row: EntityMediaRow): EntityMediaState {
  return { kind, id: row.id, name: row.name, logo: present(row.logo_url), cover: present(row.cover_image_url), website: row.website_url ?? null };
}

/** The media roles an entity is missing. */
export function missingMedia(state: Pick<EntityMediaState, "logo" | "cover">): EntityMediaRole[] {
  return (["logo", "cover"] as const).filter((r) => !state[r]);
}

export type MediaCandidate = { sourceUrl: string; preview: string | null };

export interface FindMediaResult {
  website: string | null;
  websiteSource: "stored" | "import" | "research" | null;
  logo: MediaCandidate | null;
  cover: MediaCandidate | null;
  note: string | null;
}

export interface FindMediaDeps {
  research: (input: { kind: EntityMediaKind; name: string; address?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; context?: { eventName?: string | null; triedWebsite?: string | null } }) => Promise<{ status: string; website: string | null }>;
  readWebsite: (url: string, supplied: { address: string | null }) => Promise<{ ok: true; logo: MediaCandidate | null; cover: MediaCandidate | null } | { ok: false }>;
}

const httpsOrNull = (v: string | null | undefined) => {
  if (!v) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Candidates for the roles this entity is MISSING only (a present logo /
 * cover is never re-sourced). Website order: stored → this import's →
 * Entity Research. A failure is a note, never an error. */
export async function findEntityMedia(
  kind: EntityMediaKind,
  row: EntityMediaRow,
  hints: { website?: string | null; eventName?: string | null },
  deps: FindMediaDeps
): Promise<FindMediaResult> {
  const missing = missingMedia(entityMediaState(kind, row));
  if (missing.length === 0) return { website: row.website_url, websiteSource: row.website_url ? "stored" : null, logo: null, cover: null, note: "Nothing missing." };
  let website = httpsOrNull(row.website_url);
  let websiteSource: FindMediaResult["websiteSource"] = website ? "stored" : null;
  if (!website && httpsOrNull(hints.website)) {
    website = httpsOrNull(hints.website);
    websiteSource = "import";
  }
  if (!website) {
    const r = await deps
      .research({ kind, name: row.name, address: row.address ?? null, city: row.city ?? null, state: row.state ?? null, postalCode: row.postal_code ?? null, context: { eventName: hints.eventName ?? null, triedWebsite: null } })
      .catch(() => null);
    if (r?.status === "found" && httpsOrNull(r.website)) {
      website = httpsOrNull(r.website);
      websiteSource = "research";
    } else {
      return { website: null, websiteSource: null, logo: null, cover: null, note: "No official website found. Add the media in the editor if you have it." };
    }
  }
  const read = await deps.readWebsite(website!, { address: row.address ?? null }).catch(() => ({ ok: false as const }));
  if (!read.ok) return { website, websiteSource, logo: null, cover: null, note: "The website couldn't be read. Add the media in the editor if you have it." };
  const logo = missing.includes("logo") ? read.logo : null;
  const cover = missing.includes("cover") ? read.cover : null;
  return { website, websiteSource, logo, cover, note: logo || cover ? null : "The website has no verifiable logo or cover." };
}

/** Why a requested role wasn't applied — always a real, distinguishable
 * reason, never the one generic "couldn't be verified, or it was already
 * set" that hid whichever of these actually happened:
 *   already_set    — the field was no longer empty (fill-only; never a
 *                     failure of the candidate itself);
 *   verification_failed — the re-fetch/re-verify of the exact candidate
 *                     URL failed or rejected it (security/suitability);
 *   storage_failed  — verification passed but re-hosting it in Findmi
 *                     storage failed (a legitimate candidate, an
 *                     infrastructure problem, not a validation one). */
export type EntityMediaSkipReason = "already_set" | "verification_failed" | "storage_failed";
export interface EntityMediaSkip {
  role: EntityMediaRole;
  reason: EntityMediaSkipReason;
  /** verification_failed only — the specific brandImageFailureReason()
   * diagnostic string, when the caller supplies one. */
  detail?: string;
}

export type StoreMediaResult = { ok: true; url: string } | { ok: false; reason: "verification_failed" | "storage_failed"; detail?: string };

export interface ApplyMediaDeps {
  load: (kind: EntityMediaKind, id: string) => Promise<EntityMediaRow | null>;
  /** Re-verify + re-host one source image — the specific reason it didn't
   * make it, when it didn't, never a bare null. */
  store: (sourceUrl: string, role: EntityMediaRole) => Promise<StoreMediaResult>;
  /** Write `column` ONLY while it is still empty; true when written. */
  fillIfEmpty: (kind: EntityMediaKind, id: string, column: "logo_url" | "cover_image_url", url: string) => Promise<boolean>;
}

/** FILL-ONLY: each requested role is stored only if the entity's field is
 * still empty (re-read first, guarded again by the write itself). Every
 * role that doesn't end up applied carries the SPECIFIC reason why —
 * Media Truthfulness pass: a legitimate, verified, selected candidate for
 * an actually-empty field must either persist or say exactly why it
 * didn't, never the old one-size-fits-all message. */
export async function applyEntityMedia(
  kind: EntityMediaKind,
  id: string,
  choice: { logoSourceUrl?: string | null; coverSourceUrl?: string | null },
  deps: ApplyMediaDeps
): Promise<{ ok: true; applied: EntityMediaRole[]; skipped: EntityMediaSkip[] } | { ok: false; error: string }> {
  const row = await deps.load(kind, id);
  if (!row) return { ok: false, error: "That record is no longer available." };
  const state = entityMediaState(kind, row);
  const applied: EntityMediaRole[] = [];
  const skipped: EntityMediaSkip[] = [];
  for (const [role, source] of [["logo", choice.logoSourceUrl], ["cover", choice.coverSourceUrl]] as const) {
    const url = httpsOrNull(source);
    if (!url) continue;
    if (state[role]) {
      skipped.push({ role, reason: "already_set" }); // never overwrite existing media
      continue;
    }
    const stored = await deps.store(url, role).catch((): StoreMediaResult => ({ ok: false, reason: "storage_failed" }));
    if (stored.ok && (await deps.fillIfEmpty(kind, id, MEDIA_COLUMN[role], stored.url).catch(() => false))) applied.push(role);
    else skipped.push(stored.ok ? { role, reason: "storage_failed" } : { role, reason: stored.reason, ...(stored.detail ? { detail: stored.detail } : {}) });
  }
  return { ok: true, applied, skipped };
}

// ── Brand Import read reuse for a new Business ────────────────────────────

const norm = (v: string | null | undefined) =>
  (v ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The registrable label of a site ("www.fujifilm.com" → "fujifilm"). */
export function siteLabel(url: string | null | undefined): string | null {
  try {
    const host = new URL(url ?? "").hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  } catch {
    return null;
  }
}

/** A ready Brand Import read that names the SAME Business: its read name
 * equals the evidence, or the evidence is exactly the site's own label
 * ("FUJIFILM" ↔ fujifilm.com). Conservative — the operator still reviews
 * the read before anything is created. */
export function readMatchesBusiness(evidenceName: string, read: { name: string | null; website: string | null }): boolean {
  const n = norm(evidenceName);
  if (!n) return false;
  if (norm(read.name) === n) return true;
  const label = siteLabel(read.website);
  return Boolean(label && n.replace(/\s+/g, "") === label);
}
