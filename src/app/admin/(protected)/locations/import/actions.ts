"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { tryAcquireWebsiteFetchSlot } from "@/lib/brand-website-rate-limit";
import { parseLocationPaste, normalizeLocationWebsite, locationEvidenceKey } from "@/lib/location-import/parse";
import { resolveLocationBatch } from "@/lib/location-import/resolve";
import { buildLocationProposal, type LocationCategoryOption } from "@/lib/location-import/website";
import { createImportedLocation, defaultLocationImportDeps, readLocationWebsite, type ImportedLocationResult } from "@/lib/location-import/server";
import type { LocationCreateInput, LocationEvidence, LocationProposal, LocationResolution } from "@/lib/location-import/types";
import { researchEntity } from "@/lib/entity-research";
import { prepareLocation, type PreparedLocation } from "@/lib/entity-prepare";

/** Location Import V1 — Admin entry points. Every action verifies the
 * founder Admin session first (requireAdminSupabase, the same check the
 * middleware does) before any read or write. Used by Admin → Locations →
 * Import Locations AND by Admin Event Import's missing-Location step, so
 * both go through exactly one pipeline. */

async function adminClient(): Promise<SupabaseClient | null> {
  try {
    return await requireAdminSupabase();
  } catch {
    return null;
  }
}

async function locationCategories(admin: SupabaseClient): Promise<LocationCategoryOption[]> {
  const { data } = await admin.from("categories").select("id, name, slug").eq("kind", "location");
  return ((data ?? []) as LocationCategoryOption[]).filter((c) => c && typeof c.id === "string");
}

export interface LocationImportRow {
  evidence: LocationEvidence;
  resolution: LocationResolution;
  /** Present for a place that isn't on Findmi yet (new / insufficient /
   * ambiguous — creating is still possible once the operator decides). */
  proposal: LocationProposal;
}

export type LocationAnalysis = { ok: true; rows: LocationImportRow[]; blocks: number } | { ok: false; error: string };

/** Paste → distinct places, each resolved ONCE against Findmi. Writes nothing. */
export async function adminAnalyzeLocationPaste(text: string): Promise<LocationAnalysis> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const parsed = parseLocationPaste(typeof text === "string" ? text.slice(0, 60_000) : "");
  if (!parsed.ok) return parsed;
  try {
    const deps = defaultLocationImportDeps(admin);
    const [resolutions, categories] = await Promise.all([resolveLocationBatch(parsed.locations, (e) => deps.findCandidates(e)), locationCategories(admin)]);
    return {
      ok: true,
      blocks: parsed.blocks,
      rows: parsed.locations.map((evidence) => ({ evidence, resolution: resolutions.get(evidence.key)!, proposal: buildLocationProposal(evidence, null, categories) })),
    };
  } catch {
    return { ok: false, error: "Couldn't check these Locations against Findmi. Please try again." };
  }
}

/** One place's evidence as Admin Event Import supplies it (an occurrence's
 * reviewed place). Same resolution as a pasted Location. Writes nothing. */
export async function adminResolveLocationEvidence(input: { name: string | null; address: string | null; city: string | null; state: string | null; postalCode: string | null; website?: string | null }): Promise<{ ok: true; row: LocationImportRow } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  const base = { name: t(input?.name), address: t(input?.address), city: t(input?.city), state: t(input?.state), postalCode: t(input?.postalCode) };
  const evidence: LocationEvidence = { ...base, key: locationEvidenceKey(base), labels: ["This place"], website: normalizeLocationWebsite(t(input?.website)), phone: null, category: null, description: null, warnings: [] };
  try {
    const deps = defaultLocationImportDeps(admin);
    const [resolutions, categories] = await Promise.all([resolveLocationBatch([evidence], (e) => deps.findCandidates(e)), locationCategories(admin)]);
    return { ok: true, row: { evidence, resolution: resolutions.get(evidence.key)!, proposal: buildLocationProposal(evidence, null, categories) } };
  } catch {
    return { ok: false, error: "Couldn't check this place against Findmi. Please try again." };
  }
}

/** Admin Event Import — PREPARE one missing place for Review, without a
 * click: match first (an existing / possible Location needs no research);
 * a new place's pasted Location Website is read first; only when it is
 * absent or unreadable does contextual web research look for the place's
 * official site, which is then read by the same Location Import reader.
 * Writes nothing. The client asks once per distinct place per batch. */
export async function adminPrepareLocation(input: { name: string | null; address: string | null; city: string | null; state: string | null; postalCode: string | null; website?: string | null; eventName?: string | null }): Promise<{ ok: true; prepared: PreparedLocation } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const t = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const base = { name: t(input?.name, 160), address: t(input?.address), city: t(input?.city, 80), state: t(input?.state, 40), postalCode: t(input?.postalCode, 12) };
  const evidence: LocationEvidence = { ...base, key: locationEvidenceKey(base), labels: ["This place"], website: normalizeLocationWebsite(t(input?.website, 500)), phone: null, category: null, description: null, warnings: [] };
  try {
    const deps = defaultLocationImportDeps(admin);
    const prepared = await prepareLocation(
      evidence,
      {
        findCandidates: (e) => deps.findCandidates(e),
        readWebsite: async (url, supplied) => {
          const release = tryAcquireWebsiteFetchSlot();
          if (!release) return { ok: false, code: "fetch_failed", detail: "Findmi is reading other websites — try again in a moment." };
          try {
            return await readLocationWebsite(url, supplied, deps);
          } finally {
            release();
          }
        },
        research: (q) => researchEntity(q, undefined, { log: (entry) => console.info(JSON.stringify({ event: "entity_research", ...entry })) }),
        categories: () => locationCategories(admin),
      },
      { eventName: t(input?.eventName, 200) }
    );
    return { ok: true, prepared };
  } catch {
    return { ok: false, error: "Couldn't prepare this place. You can still review and create it." };
  }
}

export type LocationWebsiteOutcome =
  | { ok: true; proposal: LocationProposal; website: string }
  | { ok: false; error: string; busy?: boolean };

/** Reads ONE official Location website and returns the merged proposal
 * (supplied values win; conflicts flagged). Writes nothing. Bounded by the
 * shared per-instance website-fetch slots Brand Import already uses. */
export async function adminReadLocationWebsite(evidence: LocationEvidence): Promise<LocationWebsiteOutcome> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const website = normalizeLocationWebsite(evidence?.website);
  if (!website) return { ok: false, error: "Add the Location's own website first." };
  const release = tryAcquireWebsiteFetchSlot();
  if (!release) return { ok: false, busy: true, error: "Findmi is reading other websites — try again in a moment." };
  try {
    const safe: LocationEvidence = {
      key: typeof evidence.key === "string" ? evidence.key : "",
      labels: [],
      name: typeof evidence.name === "string" ? evidence.name : null,
      address: typeof evidence.address === "string" ? evidence.address : null,
      city: typeof evidence.city === "string" ? evidence.city : null,
      state: typeof evidence.state === "string" ? evidence.state : null,
      postalCode: typeof evidence.postalCode === "string" ? evidence.postalCode : null,
      website,
      phone: typeof evidence.phone === "string" ? evidence.phone : null,
      category: typeof evidence.category === "string" ? evidence.category : null,
      description: typeof evidence.description === "string" ? evidence.description : null,
      warnings: [],
    };
    const deps = defaultLocationImportDeps(admin);
    const [read, categories] = await Promise.all([readLocationWebsite(website, { address: safe.address }, deps), locationCategories(admin)]);
    if (!read.ok) return { ok: false, error: read.detail };
    const proposal = buildLocationProposal(safe, read.facts, categories);
    return { ok: true, website, proposal: { ...proposal, logo: read.logo, cover: read.cover } };
  } catch {
    return { ok: false, error: "Findmi couldn't read this website. You can still create the Location from the details you have." };
  } finally {
    release();
  }
}

/** Creates ONE reviewed Location (unlisted, duplicate-checked unless the
 * operator chose Create Anyway). Never publishes, never links a Business. */
export async function adminCreateImportedLocation(input: LocationCreateInput, force = false): Promise<ImportedLocationResult> {
  const admin = await adminClient();
  if (!admin) return { status: "error", error: "Your Admin session has ended. Sign in again." };
  try {
    const result = await createImportedLocation(admin, input, defaultLocationImportDeps(admin), { force: force === true });
    if (result.status === "created") {
      revalidatePath("/admin/locations");
      revalidatePath("/admin");
    }
    return result;
  } catch {
    return { status: "error", error: "Couldn't create this Location. Please try again." };
  }
}
