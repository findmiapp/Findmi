import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findBusinessMatches, normalizeInstagramHandle, normalizeWebsiteHost, type BusinessMatch, type BusinessMatchInput } from "../business-matching";
import { prepareBrandWebsite } from "../brand-candidate-builder";
import { cleanText } from "../brand-website-extract";
import { fetchVerifiedBrandImage, storeBrandImage, type BrandImageRole } from "../brand-images";
import { ensureUniqueSlug, slugify } from "../slug";
import { BrandImportProposalSchema, parseBrandImportProposal, type BrandImportProposal } from "./brand-import";

/** Brand Ingestion P4 — Admin review of a Ready import candidate and the
 * explicit, idempotent creation of a canonical Business from it.
 * Admin-only and server-only: callers MUST have passed
 * requireAdminSupabase() and pass its service-role client in.
 *
 * Save Review edits ONLY the candidate proposal (never a Business, no
 * fetch, no AI). Create Business re-matches the FINAL reviewed identity,
 * then creates the Business with the candidate's own UUID as its primary
 * key — the idempotency anchor: a retry can always tell whether this
 * candidate's Business already exists. The new Business is
 * pending_review, has no owner, no geography and no market; only kept
 * images are re-verified and stored through the canonical media path. */

export const REVIEW_NAME_MAX = 200;
export const REVIEW_SHORT_MAX = 160;
export const REVIEW_ABOUT_MAX = 600;

const instagramUrl = (handle: string | null | undefined) => (handle ? `https://www.instagram.com/${handle}` : null);

// ── Review input ──────────────────────────────────────────────────────────

export interface BrandReviewInput {
  name: string;
  categoryId: string;
  website: string;
  instagram: string;
  shortDescription: string;
  about: string;
  useLogo: boolean;
  useCover: boolean;
}

export type BrandReviewValidation = { ok: true; proposal: BrandImportProposal } | { ok: false; error: string };

/** Pure: the Admin's edits applied to the current proposal. Only the
 * whitelisted fields change (name, category, website, Instagram, short
 * description, About, keep/remove logo/cover); everything else in the
 * proposal (finalUrl, candidate image URLs, extracted city/state) is kept
 * as-is. Validated against the strict proposal schema. */
export function applyBrandReview(current: BrandImportProposal, input: BrandReviewInput, businessCategoryIds: ReadonlySet<string>): BrandReviewValidation {
  const text = (value: string, max: number, label: string): { ok: true; value: string | null } | { ok: false; error: string } => {
    const raw = (value ?? "").trim();
    if (!raw) return { ok: true, value: null };
    if (raw.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
    const clean = cleanText(raw, max);
    if (!clean) return { ok: false, error: `${label} can't contain < or >.` };
    return { ok: true, value: clean };
  };

  const name = text(input.name, REVIEW_NAME_MAX, "Business Name");
  if (!name.ok) return name;
  if (!name.value) return { ok: false, error: "Business Name is required." };

  const categoryId = (input.categoryId ?? "").trim();
  if (categoryId && !businessCategoryIds.has(categoryId)) return { ok: false, error: "Choose a valid category." };

  const websiteRaw = (input.website ?? "").trim();
  if (!websiteRaw) return { ok: false, error: "Website is required." };
  const website = prepareBrandWebsite(websiteRaw);
  if (!website.ok) return { ok: false, error: "Enter a valid website (its own domain, not a social or marketplace page)." };

  const igRaw = (input.instagram ?? "").trim();
  const ig = igRaw ? normalizeInstagramHandle(igRaw) : null;
  if (igRaw && !ig) return { ok: false, error: "Enter a valid Instagram handle or profile URL." };

  const sd = text(input.shortDescription, REVIEW_SHORT_MAX, "Short Description");
  if (!sd.ok) return sd;
  const about = text(input.about, REVIEW_ABOUT_MAX, "About");
  if (!about.ok) return about;

  const next: Record<string, unknown> = { ...current };
  for (const key of ["name", "cat", "sd", "about", "ig"]) delete next[key];
  next.site = website.website.websiteUrl;
  next.name = name.value;
  if (categoryId) next.cat = categoryId;
  if (ig) next.ig = ig;
  if (sd.value) next.sd = sd.value;
  if (about.value) next.about = about.value;
  next.useLogo = Boolean(input.useLogo);
  next.useCover = Boolean(input.useCover);
  const parsed = BrandImportProposalSchema.safeParse(next);
  return parsed.success ? { ok: true, proposal: parsed.data } : { ok: false, error: "Some values aren't valid. Check the fields and try again." };
}

// ── Store / Business access (narrow, injectable) ──────────────────────────

export interface ReviewCandidateRow {
  id: string;
  batch_id: string;
  status: string;
  proposal: unknown;
  updated_at: string;
  created_business_id: string | null;
  matched_business_id: string | null;
}

export interface BrandReviewStore {
  /** Scoped to the batch: another batch's candidate is "not found". */
  getCandidate(batchId: string, candidateId: string): Promise<ReviewCandidateRow | null>;
  /** proposal ← value, only while ready and unchanged since `expectedUpdatedAt`. */
  saveProposal(batchId: string, candidateId: string, expectedUpdatedAt: string, proposal: BrandImportProposal): Promise<boolean>;
  /** status ← discarded, only from ready or failed. */
  discard(batchId: string, candidateId: string): Promise<boolean>;
  /** status ← existing_business (+ matched id), only from `from`. */
  markExisting(batchId: string, candidateId: string, from: "ready" | "creating", businessId: string): Promise<boolean>;
  /** ready → creating. */
  claimCreate(batchId: string, candidateId: string): Promise<boolean>;
  /** creating → created (+ created_business_id). */
  finalizeCreated(batchId: string, candidateId: string, businessId: string): Promise<boolean>;
}

export interface CanonicalBusinessRow {
  id: string;
  name: string;
  logo_url: string | null;
  cover_image_url: string | null;
}

export type InsertBusinessResult = { ok: true } | { ok: false; conflict: "id" | "slug" | "other" };

export interface CanonicalBusinessWriter {
  getById(id: string): Promise<CanonicalBusinessRow | null>;
  isSlugTaken(slug: string): Promise<boolean>;
  insert(row: NewBusinessRow): Promise<InsertBusinessResult>;
  /** The canonical category writer (set_business_category RPC). */
  setCategory(businessId: string, categoryId: string): Promise<boolean>;
  setMedia(businessId: string, media: { logo_url?: string; cover_image_url?: string }): Promise<boolean>;
}

export interface NewBusinessRow {
  id: string;
  name: string;
  slug: string;
  website_url: string;
  instagram_url: string | null;
  short_description: string | null;
  description: string | null;
  plan_tier: "free";
  publication_status: "pending_review";
  is_demo: false;
}

export interface CreateBusinessDeps {
  store: BrandReviewStore;
  businesses: CanonicalBusinessWriter;
  findMatches: (input: BusinessMatchInput) => Promise<BusinessMatch[]>;
  /** Re-fetch, re-verify and store one kept image; Findmi URL or null. */
  importImage: (url: string, role: BrandImageRole) => Promise<string | null>;
  log: (entry: Record<string, unknown>) => void;
}

export type CreateBusinessOutcome =
  | { outcome: "created"; businessId: string; imageWarnings: BrandImageRole[]; recovered: boolean }
  | { outcome: "existing_business"; businessId: string }
  | { outcome: "already_created"; businessId: string }
  | { outcome: "invalid"; error: string }
  | { outcome: "not_eligible" }
  | { outcome: "not_found" }
  | { outcome: "failed"; step: "insert" | "category" | "finalize" | "slug" };

export type SaveReviewOutcome = { outcome: "saved" } | { outcome: "invalid"; error: string } | { outcome: "stale" } | { outcome: "not_eligible" } | { outcome: "not_found" };

/** Save Review: edits ONLY the candidate proposal of a READY candidate in
 * this batch, conditional on the updated_at the form was rendered with
 * (a newer edit is never silently overwritten). No Business access, no
 * website fetch, no AI. Status, attempts, AI telemetry, input/host and
 * matched id are untouched (only `proposal` is written). */
export async function saveBrandReview(
  batchId: string,
  candidateId: string,
  expectedUpdatedAt: string,
  input: BrandReviewInput,
  deps: { store: BrandReviewStore; businessCategoryIds: ReadonlySet<string> }
): Promise<SaveReviewOutcome> {
  const row = await deps.store.getCandidate(batchId, candidateId);
  if (!row) return { outcome: "not_found" };
  if (row.status !== "ready") return { outcome: "not_eligible" };
  const current = parseBrandImportProposal(row.proposal);
  if (!current) return { outcome: "invalid", error: "This candidate has no reviewable profile." };
  const next = applyBrandReview(current, input, deps.businessCategoryIds);
  if (!next.ok) return { outcome: "invalid", error: next.error };
  if (!expectedUpdatedAt || row.updated_at !== expectedUpdatedAt) return { outcome: "stale" };
  return (await deps.store.saveProposal(batchId, candidateId, expectedUpdatedAt, next.proposal)) ? { outcome: "saved" } : { outcome: "stale" };
}

/** Discard: ready or failed → discarded. Nothing is deleted. */
export async function discardBrandCandidate(batchId: string, candidateId: string, store: BrandReviewStore): Promise<"discarded" | "not_eligible"> {
  return (await store.discard(batchId, candidateId)) ? "discarded" : "not_eligible";
}

/** The reviewed proposal is complete enough to become a Business. */
export function creatableProposal(value: unknown): { ok: true; proposal: BrandImportProposal & { name: string; cat: string } } | { ok: false; error: string } {
  const p = parseBrandImportProposal(value);
  if (!p) return { ok: false, error: "This candidate's review isn't valid. Save the review again." };
  if (!p.name) return { ok: false, error: "Add a Business Name before creating." };
  if (!p.cat) return { ok: false, error: "Choose a category before creating." };
  if (!prepareBrandWebsite(p.site).ok) return { ok: false, error: "Enter a valid website before creating." };
  return { ok: true, proposal: p as BrandImportProposal & { name: string; cat: string } };
}

/** Final match on the REVIEWED identity (website + Instagram + name, and
 * the post-redirect host when different), excluding this candidate's own
 * (possibly partially created) Business. */
async function finalMatch(p: BrandImportProposal, ownId: string, findMatches: CreateBusinessDeps["findMatches"]): Promise<BusinessMatch | null> {
  const lookups = [findMatches({ websiteUrl: p.site, instagramUrl: instagramUrl(p.ig), name: p.name ?? null })];
  const host = normalizeWebsiteHost(p.site);
  const finalHost = normalizeWebsiteHost(p.finalUrl);
  if (finalHost && finalHost !== host) lookups.push(findMatches({ websiteUrl: p.finalUrl }));
  const matches = (await Promise.all(lookups)).flat().filter((m) => m.id !== ownId);
  return matches[0] ?? null;
}

/** Create Business — explicit, idempotent, retry-safe. See the module doc
 * for the recovery cases. Never deletes or overwrites another Business. */
export async function createBusinessFromCandidate(batchId: string, candidateId: string, deps: CreateBusinessDeps): Promise<CreateBusinessOutcome> {
  const row = await deps.store.getCandidate(batchId, candidateId);
  if (!row) return { outcome: "not_found" };
  if (row.status === "created") return { outcome: "already_created", businessId: row.created_business_id ?? row.id };
  if (row.status !== "ready" && row.status !== "creating") return { outcome: "not_eligible" };
  const valid = creatableProposal(row.proposal);
  if (!valid.ok) return { outcome: "invalid", error: valid.error };
  const p = valid.proposal;
  const businessId = row.id; // idempotency anchor: candidate.id == Business.id

  // CASE B / E: this candidate's Business already exists (a previous
  // attempt inserted it) → never insert again; finish the remaining steps.
  let own = await deps.businesses.getById(businessId);
  let recovered = Boolean(own);
  // Defensive: own Business present while the candidate still reads ready
  // → claim it so finalization (creating → created) applies.
  if (own && row.status === "ready" && !(await deps.store.claimCreate(batchId, candidateId))) return { outcome: "not_eligible" };

  if (!own) {
    // CASE D: the final reviewed identity matches another canonical
    // Business → link it, create nothing, overwrite nothing.
    const match = await finalMatch(p, businessId, deps.findMatches);
    if (match) {
      const linked = await deps.store.markExisting(batchId, candidateId, row.status as "ready" | "creating", match.id);
      deps.log({ event: "brand_import_create", outcome: linked ? "existing_business" : "not_eligible" });
      return linked ? { outcome: "existing_business", businessId: match.id } : { outcome: "not_eligible" };
    }
    // Claim ready → creating (CASE A retries start already creating).
    if (row.status === "ready" && !(await deps.store.claimCreate(batchId, candidateId))) return { outcome: "not_eligible" };

    const base = slugify(p.name) || "business";
    for (let attempt = 0; attempt < 3 && !own; attempt += 1) {
      const slug = await ensureUniqueSlug(attempt === 0 ? base : `${base}-${attempt + 1}`, (c) => deps.businesses.isSlugTaken(c));
      const inserted = await deps.businesses.insert({
        id: businessId,
        name: p.name,
        slug,
        website_url: p.site,
        instagram_url: instagramUrl(p.ig),
        short_description: p.sd ?? null,
        description: p.about ?? null,
        plan_tier: "free",
        publication_status: "pending_review",
        is_demo: false,
      });
      if (inserted.ok) {
        own = await deps.businesses.getById(businessId);
        break;
      }
      if (inserted.conflict === "id") {
        // A concurrent request inserted it first → recover, never duplicate.
        own = await deps.businesses.getById(businessId);
        recovered = true;
        break;
      }
      if (inserted.conflict !== "slug") {
        deps.log({ event: "brand_import_create", outcome: "failed", step: "insert" });
        return { outcome: "failed", step: "insert" }; // stays creating; retry is safe
      }
    }
    if (!own) {
      deps.log({ event: "brand_import_create", outcome: "failed", step: "slug" });
      return { outcome: "failed", step: "slug" };
    }
  }

  // Category through the canonical writer (idempotent replace).
  if (!(await deps.businesses.setCategory(businessId, p.cat))) {
    deps.log({ event: "brand_import_create", outcome: "failed", step: "category" });
    return { outcome: "failed", step: "category" }; // Business exists; retry finishes
  }

  // Images: only the kept ones, re-verified now, stored by Findmi; a slot
  // already holding an image (an earlier attempt) is never overwritten.
  const imageWarnings: BrandImageRole[] = [];
  const media: { logo_url?: string; cover_image_url?: string } = {};
  const wanted: [BrandImageRole, string | undefined, boolean, string | null][] = [
    ["logo", p.logo, p.useLogo !== false, own.logo_url],
    ["cover", p.cover, p.useCover !== false, own.cover_image_url],
  ];
  for (const [role, url, keep, existing] of wanted) {
    if (!url || !keep || existing) continue;
    let stored: string | null = null;
    try {
      stored = await deps.importImage(url, role);
    } catch {
      stored = null;
    }
    if (stored) media[role === "logo" ? "logo_url" : "cover_image_url"] = stored;
    else imageWarnings.push(role);
  }
  if (Object.keys(media).length > 0 && !(await deps.businesses.setMedia(businessId, media))) {
    if (media.logo_url) imageWarnings.push("logo");
    if (media.cover_image_url) imageWarnings.push("cover");
  }

  if (!(await deps.store.finalizeCreated(batchId, candidateId, businessId))) {
    deps.log({ event: "brand_import_create", outcome: "failed", step: "finalize" });
    return { outcome: "failed", step: "finalize" }; // Business exists; retry finalizes
  }
  deps.log({ event: "brand_import_create", outcome: "created", recovered, imageWarnings });
  return { outcome: "created", businessId, imageWarnings: [...new Set(imageWarnings)], recovered };
}

// ── Supabase implementations (service-role client, Admin callers only) ──

export function supabaseBrandReviewStore(admin: SupabaseClient): BrandReviewStore {
  const table = () => admin.from("brand_import_candidates");
  const one = async (q: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
    const { data, error } = await q;
    if (error) throw new Error("brand_import_review_write_failed");
    return (data ?? []).length === 1;
  };
  return {
    async getCandidate(batchId, candidateId) {
      const { data, error } = await table()
        .select("id, batch_id, status, proposal, updated_at, created_business_id, matched_business_id")
        .eq("id", candidateId)
        .eq("batch_id", batchId)
        .maybeSingle();
      if (error) throw new Error("brand_import_review_load_failed");
      return (data as ReviewCandidateRow | null) ?? null;
    },
    saveProposal: (batchId, candidateId, expectedUpdatedAt, proposal) =>
      one(table().update({ proposal }).eq("id", candidateId).eq("batch_id", batchId).eq("status", "ready").eq("updated_at", expectedUpdatedAt).select("id")),
    discard: (batchId, candidateId) =>
      one(table().update({ status: "discarded", processing_started_at: null }).eq("id", candidateId).eq("batch_id", batchId).in("status", ["ready", "failed"]).select("id")),
    markExisting: (batchId, candidateId, from, businessId) =>
      one(table().update({ status: "existing_business", matched_business_id: businessId }).eq("id", candidateId).eq("batch_id", batchId).eq("status", from).select("id")),
    claimCreate: (batchId, candidateId) =>
      one(table().update({ status: "creating" }).eq("id", candidateId).eq("batch_id", batchId).eq("status", "ready").select("id")),
    finalizeCreated: (batchId, candidateId, businessId) =>
      one(table().update({ status: "created", created_business_id: businessId }).eq("id", candidateId).eq("batch_id", batchId).eq("status", "creating").select("id")),
  };
}

export function supabaseCanonicalBusinessWriter(admin: SupabaseClient): CanonicalBusinessWriter {
  return {
    async getById(id) {
      const { data, error } = await admin.from("businesses").select("id, name, logo_url, cover_image_url").eq("id", id).maybeSingle();
      if (error) throw new Error("brand_import_business_load_failed");
      return (data as CanonicalBusinessRow | null) ?? null;
    },
    async isSlugTaken(slug) {
      const { data, error } = await admin.from("businesses").select("id").eq("slug", slug).limit(1);
      if (error) throw new Error("brand_import_slug_check_failed");
      return (data ?? []).length > 0;
    },
    async insert(row) {
      const { error } = await admin.from("businesses").insert(row);
      if (!error) return { ok: true };
      const text = `${(error as { message?: string }).message ?? ""} ${(error as { details?: string }).details ?? ""}`;
      if ((error as { code?: string }).code === "23505") return { ok: false, conflict: /slug/i.test(text) ? "slug" : /pkey|\(id\)/i.test(text) ? "id" : "other" };
      return { ok: false, conflict: "other" };
    },
    async setCategory(businessId, categoryId) {
      const { error } = await admin.rpc("set_business_category", { p_business_id: businessId, p_category_id: categoryId });
      return !error;
    },
    async setMedia(businessId, media) {
      const { error } = await admin.from("businesses").update(media).eq("id", businessId);
      return !error;
    },
  };
}

/** Real Create Business dependencies (service-role client). */
export function defaultCreateBusinessDeps(admin: SupabaseClient): CreateBusinessDeps {
  return {
    store: supabaseBrandReviewStore(admin),
    businesses: supabaseCanonicalBusinessWriter(admin),
    findMatches: (input) => findBusinessMatches(admin, input),
    importImage: async (url, role) => {
      const verified = await fetchVerifiedBrandImage(url, role);
      return verified.ok ? storeBrandImage(admin, verified.image) : null;
    },
    // Safe operational log: outcome/step/warnings only — never names,
    // URLs, proposal text or ids.
    log: (entry) => console.info(JSON.stringify(entry)),
  };
}
