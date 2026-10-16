import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractBrandProfile } from "@/lib/brand-website-extract";
import { brandImagePreview, fetchVerifiedBrandImage, storeBrandImage, type BrandImageRole, type VerifiedBrandImage } from "@/lib/brand-images";
import { safeFetchBrandPage, type SafeFetchResult } from "@/lib/safe-fetch";
import { findLikelyDuplicateLocations, type CreateInlineLocationResult } from "@/lib/locationCreation";
import { normalizeLocationHours } from "@/lib/locationHours";
import { insertUnlistedPlace } from "@/lib/places/inline-place";
import { cleanLocationPhone, cleanPostalCode, normalizeLocationWebsite } from "./parse";
import { locationIdentityIssue } from "./resolve";
import { extractLocationFacts } from "./website";
import type { ExistingLocation, LocationCreateInput, LocationEvidence, LocationMediaChoice, LocationWebsiteFacts } from "./types";

/** Location Import V1 — the server half: website reading and creation.
 * Reuses Brand Import's proven pieces as they are — the shared safe page
 * fetch (SSRF guard, size/time limits, one transient retry), its page
 * extraction (logo / cover candidates), and its image verification,
 * preview and re-hosting — instead of a second fetcher or image path.
 * Performs NO authorization: each caller authorizes first (Admin session). */

export interface LocationImportDeps {
  fetchPage: (url: URL) => Promise<SafeFetchResult>;
  verifyImage: (url: string, role: BrandImageRole) => Promise<{ ok: true; image: VerifiedBrandImage } | { ok: false }>;
  preview: (image: VerifiedBrandImage) => Promise<string | null>;
  store: (image: VerifiedBrandImage) => Promise<string | null>;
  findCandidates: (e: Pick<LocationEvidence, "name" | "address" | "city" | "state" | "postalCode">) => Promise<ExistingLocation[]>;
  /** Existing Location category ids (a submitted id must be one of them). */
  locationCategoryIds: () => Promise<Set<string>>;
}

export function defaultLocationImportDeps(admin: SupabaseClient): LocationImportDeps {
  return {
    fetchPage: (url) => safeFetchBrandPage(url),
    verifyImage: async (url, role) => {
      const r = await fetchVerifiedBrandImage(url, role);
      return r.ok ? { ok: true, image: r.image } : { ok: false };
    },
    preview: (image) => brandImagePreview(image),
    store: (image) => storeBrandImage(admin, image),
    findCandidates: (e) => findLikelyDuplicateLocations(admin, { name: e.name ?? "", address: e.address, city: e.city, state: e.state, postal_code: e.postalCode }),
    locationCategoryIds: async () => {
      const { data } = await admin.from("categories").select("id").eq("kind", "location");
      return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    },
  };
}

export type LocationWebsiteRead =
  | { ok: true; finalUrl: string; facts: LocationWebsiteFacts; logo: LocationMediaChoice | null; cover: LocationMediaChoice | null; mediaChecked: number }
  | { ok: false; code: "invalid_url" | "fetch_failed"; detail: string };

const MEDIA_TRIES = 2;

async function firstVerified(urls: readonly string[], role: BrandImageRole, deps: LocationImportDeps, budget: { left: number }): Promise<LocationMediaChoice | null> {
  for (const url of urls.slice(0, MEDIA_TRIES)) {
    if (budget.left <= 0) return null;
    budget.left -= 1;
    const r = await deps.verifyImage(url, role);
    if (r.ok) return { sourceUrl: url, preview: await deps.preview(r.image) };
  }
  return null;
}

/** Reads ONE official Location website: place facts (JSON-LD) plus at most
 * a verified logo and a verified cover. A failure never blocks creation
 * from the supplied identity. */
export async function readLocationWebsite(website: string, supplied: { address: string | null }, deps: LocationImportDeps): Promise<LocationWebsiteRead> {
  const href = normalizeLocationWebsite(website);
  if (!href) return { ok: false, code: "invalid_url", detail: "That website isn't a web address." };
  const page = await deps.fetchPage(new URL(href));
  if (!page.ok) return { ok: false, code: "fetch_failed", detail: "Findmi couldn't read this website. You can still review and create the Location from the details above." };
  const facts = extractLocationFacts(page.html, supplied);
  const profile = extractBrandProfile(page.html, page.url);
  // Logos: strong logo evidence only (JSON-LD logo, logo metadata,
  // itemprop=logo, the header brand mark) — never a favicon or touch icon.
  const strongLogos = profile.logoCandidates.slice(0, profile.logoStrongCount ?? 0);
  const budget = { left: 4 };
  const logo = await firstVerified([...strongLogos, ...(profile.svgLogoCandidates ?? [])], "logo", deps, budget);
  const cover = await firstVerified(profile.coverCandidates.filter((u) => u !== logo?.sourceUrl), "cover", deps, budget);
  if (!facts.description) facts.description = profile.aboutDescription ?? profile.shortDescription ?? null;
  return { ok: true, finalUrl: page.url.href, facts, logo, cover, mediaChecked: 4 - budget.left };
}

export type ImportedLocationResult = CreateInlineLocationResult & { media?: { logo: "stored" | "failed" | "none"; cover: "stored" | "failed" | "none" } };

const DESCRIPTION_MAX = 2000;

function profileOf(input: LocationCreateInput, categoryIds: Set<string>) {
  const lat = typeof input.latitude === "number" && Number.isFinite(input.latitude) && Math.abs(input.latitude) <= 90 ? input.latitude : null;
  const lng = typeof input.longitude === "number" && Number.isFinite(input.longitude) && Math.abs(input.longitude) <= 180 ? input.longitude : null;
  const description = typeof input.description === "string" ? input.description.replace(/\r\n?/g, "\n").trim().slice(0, DESCRIPTION_MAX) : null;
  return {
    website_url: normalizeLocationWebsite(input.website),
    phone: cleanLocationPhone(input.phone),
    description: description || null,
    category_id: typeof input.categoryId === "string" && categoryIds.has(input.categoryId) ? input.categoryId : null,
    hours: normalizeLocationHours(input.hours),
    // A map position only as a pair (never one half).
    latitude: lat !== null && lng !== null ? lat : null,
    longitude: lat !== null && lng !== null ? lng : null,
  };
}

const text = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/** Creates ONE new canonical Location through the SAME unlisted Quick
 * Create insert (lib/places/inline-place.ts): duplicate-checked unless
 * forced, is_demo = true (Not Listed → Admin Needs Review), no owner, no
 * membership, no Business relationship, no publication. Verified media is
 * re-verified and re-hosted after the row exists; a media failure never
 * undoes the creation (the public page renders its fallback). */
export async function createImportedLocation(admin: SupabaseClient, input: LocationCreateInput, deps: LocationImportDeps, opts: { force?: boolean } = {}): Promise<ImportedLocationResult> {
  const name = text(input?.name, 160);
  const address = text(input?.address);
  const city = text(input?.city, 80);
  const state = text(input?.state, 40);
  const issue = locationIdentityIssue({ name, address, city, state });
  if (issue) return { status: "error", error: issue };
  const postalCode = cleanPostalCode(input.postalCode ?? null);
  const categoryIds = input.categoryId ? await deps.locationCategoryIds().catch(() => new Set<string>()) : new Set<string>();
  const result = await insertUnlistedPlace(admin, { name, address, city, state, postalCode, force: opts.force === true, profile: profileOf(input, categoryIds) });
  if (result.status !== "created") return result;

  const media = { logo: "none" as "stored" | "failed" | "none", cover: "none" as "stored" | "failed" | "none" };
  const patch: Record<string, string> = {};
  for (const [role, url] of [["logo", input.logoSourceUrl], ["cover", input.coverSourceUrl]] as const) {
    if (typeof url !== "string" || !/^https:\/\//i.test(url)) continue;
    const verified = await deps.verifyImage(url, role);
    const stored = verified.ok ? await deps.store(verified.image) : null;
    media[role] = stored ? "stored" : "failed";
    if (stored) patch[role === "logo" ? "logo_url" : "cover_image_url"] = stored;
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("locations").update(patch).eq("id", result.location.id);
    if (error) {
      console.warn("location-import: media update failed:", error.message);
      if (patch.logo_url) media.logo = "failed";
      if (patch.cover_image_url) media.cover = "failed";
    }
  }
  return { ...result, media };
}
