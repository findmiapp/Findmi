"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { analyzeAdminSourceEvent, analyzeEventText, analyzeEventUrl, defaultEventImportDeps, type EventImportDeps } from "@/lib/event-import/engine";
import { PASTE_MAX_CHARS } from "@/lib/event-import/text-source";
import { getAllCategories } from "@/lib/admin/queries";
import {
  defaultBrandImportEngine,
  loadBrandImportBatch,
  loadBrandImportCandidate,
  planBrandImport,
  processBrandImportCandidate,
  supabaseBrandImportStore,
  brandImportSiteImages,
  BRAND_IMPORT_MAX_INPUTS,
  type BrandImportProcessOutcome,
  type BrandImportProposal,
} from "@/lib/admin/brand-import";
import { createBusinessFromCandidate, defaultCreateBusinessDeps, saveBrandReview, supabaseBrandReviewStore, type BrandReviewInput } from "@/lib/admin/brand-import-review";
import {
  applyExistingEventEnrichment,
  compareExistingEvent,
  loadExistingEventSnapshot,
  proposalFromReview,
  type ExistingEventSnapshot,
  type ExistingField,
  type FieldComparison,
} from "@/lib/event-import/existing-event";
import { findBusinessMatches } from "@/lib/business-matching";
import { researchEntity } from "@/lib/entity-research";
import { prepareBusiness, type BusinessPrepareResult } from "@/lib/entity-prepare";
import { insertInlineBusiness, type InlineBusinessResult } from "@/lib/admin/inline-business";
import { publicImportAnalysis } from "@/lib/event-import/diagnostics";
import { asOperatorAnalysis } from "@/lib/event-import/operator";
import { normalizeReview, persistDiscoveryEvent, type SourceEventDeps } from "@/lib/event-import/persist";
import type { EventImportAnalysis, EventImportOutcome, EventImportReview } from "@/lib/event-import/types";
import { isStoredEventImageUrl, previewEventImage, recoverEventImage, storeUploadedEventImage, uploadedEventImageError, type EventImagePreview } from "@/lib/event-import/media";
import { EVENT_IMPORT_IMAGE_MAX_BYTES } from "@/lib/event-import/types";
import { brandImageFailureReason, fetchVerifiedBrandImage, previewBrandCandidateResult, storeBrandImage, type BrandPreviewResult } from "@/lib/brand-images";
import { createImportedLocation, defaultLocationImportDeps, readLocationWebsite } from "@/lib/location-import/server";
import { applyEntityMedia, entityMediaState, findEntityMedia, readMatchesBusiness, type EntityMediaKind, type EntityMediaRow, type EntityMediaState, type FindMediaResult } from "@/lib/entity-media";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";
import { findExistingGeographyMatch } from "@/lib/market-requests";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { isSlugTaken } from "@/lib/admin/queries";
import { propagateAllDatesParticipation } from "@/lib/appearance-event-sync";

/** Admin Event Import — the OPERATOR entry to the one Event Import engine
 * (lib/event-import). Every action independently verifies the founder
 * Admin session (requireAdminSupabase — the same check middleware does)
 * before any read or write; Business membership is never involved, and
 * the Business importer's own authorization is untouched. There is no
 * initiating Business: analysis runs with businessId null, and each Event
 * is saved with its OWN reviewed Business (or none) — see
 * persistDiscoveryEvent. */

/** One shared analysis rate-limit bucket for the founder Admin session. */
const ADMIN_RATE_KEY = "admin:event-import";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function adminClient(): Promise<SupabaseClient | null> {
  try {
    return await requireAdminSupabase();
  } catch {
    return null;
  }
}

/** The engine's dependencies for an operator import: the shared ones, with
 * Business matching widened to what Admin may see. The source's Business
 * name is suggested only when exactly ONE real Business has that exact
 * name (live or pending review — never demo, archived or trashed);
 * anything ambiguous stays unresolved for the operator. */
function operatorDeps(admin: SupabaseClient): EventImportDeps {
  return {
    ...defaultEventImportDeps(admin),
    // Event image guard: a page's fallback image that Brand Import already
    // read as this site's logo / cover is generic site imagery.
    siteBrandImages: (host) => brandImportSiteImages(admin, host),
    involvedBusinesses: true,
    matchOrganizer: async (name, city, state) => {
      const exact = (await findBusinessMatches(admin, { name, city, state })).filter((m) => m.reasons.includes("name_location"));
      if (exact.length !== 1) return null;
      const { data } = await admin.from("businesses").select("id, name, archived_at, trashed_at").eq("id", exact[0].id).maybeSingle();
      const row = data as { id: string; name: string; archived_at: string | null; trashed_at: string | null } | null;
      return row && !row.archived_at && !row.trashed_at ? { id: row.id, name: row.name } : null;
    },
  };
}

/** Paste Details (one Event, or several explicitly marked Events; blocks
 * in the structured "Event Name: …" syntax are read field by field). Writes nothing. */
export async function adminAnalyzeEventText(text: string): Promise<EventImportAnalysis> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "server" };
  try {
    const result = await analyzeEventText({ text: typeof text === "string" ? text : "", businessId: null, rateKey: ADMIN_RATE_KEY, structured: true }, operatorDeps(admin));
    return publicImportAnalysis(asOperatorAnalysis(result, { url: "", name: "Pasted Details", platform: null }));
  } catch {
    return { ok: false, code: "server" };
  }
}

/** From Link — the same engine and safe fetch as every importer. Writes nothing. */
export async function adminAnalyzeEventUrl(url: string): Promise<EventImportAnalysis> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "server" };
  try {
    const link = typeof url === "string" ? url.trim() : "";
    const result = await analyzeEventUrl({ url: link, businessId: null, rateKey: ADMIN_RATE_KEY }, operatorDeps(admin));
    return publicImportAnalysis(asOperatorAnalysis(result, { url: link, name: null, platform: null }));
  } catch {
    return { ok: false, code: "server" };
  }
}

/** Missing-Location Quick Create for Admin — through Location Import V1
 * (lib/location-import/server.ts), which creates with the SAME rules as
 * the member-facing createInlinePlace (lib/places/inline-place.ts: street
 * address required, duplicate check unless forced, unlisted, no
 * membership), authorized by the Admin session instead of Business
 * membership. The Review step itself uses EventLocationCreate. */
export async function adminCreateImportLocation(formData: FormData): Promise<CreateInlineLocationResult> {
  const admin = await adminClient();
  if (!admin) return { status: "error", error: "Your Admin session has ended. Sign in again." };
  const field = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string) : "");
  return createImportedLocation(
    admin,
    { name: field("name"), address: field("address"), addressLine2: field("address_line2") || null, city: field("city"), state: field("state"), postalCode: field("postal_code") || null },
    defaultLocationImportDeps(admin),
    { force: field("force") === "1", submitter: "admin" }
  );
}

/** Admin Event Import — PREPARE a Primary Business that isn't linked, so
 * Review shows a ready candidate instead of a dead end. Findmi's own match
 * first (zero research); a pasted Business Website that Brand Import can
 * read needs no search; only a missing website — or one Brand Import
 * couldn't read — triggers contextual web research, whose official site
 * then goes back through Brand Import. Writes nothing; never creates. The
 * client asks once per distinct Business per batch. */
export async function adminPrepareBusiness(input: { name: string; website: string | null; websiteReadFailed: boolean; eventName?: string | null }): Promise<{ ok: true; prepared: BusinessPrepareResult } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const name = typeof input?.name === "string" ? input.name.trim().slice(0, 160) : "";
  if (!name) return { ok: false, error: "No Business name to prepare." };
  const website = typeof input?.website === "string" && /^https:\/\//i.test(input.website) ? input.website.slice(0, 500) : null;
  try {
    const prepared = await prepareBusiness(
      { name, website, websiteReadFailed: input?.websiteReadFailed === true, eventName: typeof input?.eventName === "string" ? input.eventName.slice(0, 200) : null },
      {
        findMatches: (q) => findBusinessMatches(admin, { name: q.name, websiteUrl: q.websiteUrl }),
        research: (q) => researchEntity(q, undefined, { log: (entry) => console.info(JSON.stringify({ event: "entity_research", ...entry })) }),
        findReadyRead: (n) => findReadyBusinessRead(admin, n),
      }
    );
    return { ok: true, prepared };
  } catch {
    return { ok: false, error: "Couldn't prepare this Business. You can still create it from the name." };
  }
}

/** Missing-Business Quick Create — only on the operator's explicit action
 * in Review (never from text alone). See lib/admin/inline-business.ts:
 * pending review, no owner / membership / claim / Pro / verification, and
 * no Event link until that reviewed Event is saved. */
export async function adminCreateImportBusiness(formData: FormData): Promise<InlineBusinessResult> {
  const admin = await adminClient();
  if (!admin) return { status: "error", error: "Your Admin session has ended. Sign in again." };
  try {
    return await insertInlineBusiness(admin, { name: formData.get("name"), websiteUrl: formData.get("website_url"), force: formData.get("force") === "1" });
  } catch {
    return { status: "error", error: "Couldn't add this Business. Please try again." };
  }
}

function discoveryDeps(admin: SupabaseClient): SourceEventDeps {
  return {
    admin,
    // Admin Event Import is the privileged path: new Events are live at once.
    submitter: "admin",
    storeImage: async (url) => {
      // A cover uploaded in Review is already verified + in Findmi storage.
      if (isStoredEventImageUrl(admin, url)) return url;
      const stored = await recoverEventImage(admin, url);
      return stored.ok ? stored.url : null;
    },
    geography: async (text) => {
      const match = await findExistingGeographyMatch(admin, text);
      return match ? { marketId: match.marketId, areaId: match.areaId ?? null } : null;
    },
    uniqueEventSlug: async (title) => {
      const base = resolveSlugInput(null, title);
      return base ? ensureUniqueSlug(base, (candidate) => isSlugTaken("events", candidate)) : null;
    },
    propagateDates: (eventId, ids) => propagateAllDatesParticipation(admin, eventId, ids),
    findEventBySourceUrl: async (url) => {
      const { data } = await admin
        .from("events")
        .select("id")
        .eq("external_url", url)
        .is("trashed_at", null)
        .is("archived_at", null)
        .neq("publication_status", "rejected")
        .limit(1);
      return ((data ?? []) as { id: string }[])[0] ?? null;
    },
  };
}

const BATCH_MAX = 40;

/** Save reviewed Events — each validated and saved on its own (one that
 * fails never blocks the others). Every Event is a host-less source Event;
 * its Business (if any) is the one the operator reviewed for THAT Event,
 * re-checked here as a real Business. */
export async function adminCommitEventImportBatch(
  items: { review: EventImportReview; businessId: string | null }[]
): Promise<{ ok: true; results: { title: string; outcome: EventImportOutcome }[] } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Choose at least one Event." };
  if (items.length > BATCH_MAX) return { ok: false, error: `Add up to ${BATCH_MAX} Events at a time.` };
  const deps = discoveryDeps(admin);
  const results: { title: string; outcome: EventImportOutcome }[] = [];
  for (const item of items) {
    const review = item?.review;
    const title = typeof review?.title === "string" ? review.title : "";
    results.push({ title, outcome: await commitOne(admin, deps, review, item?.businessId ?? null) });
  }
  if (results.some((r) => r.outcome.ok)) {
    revalidatePath("/admin/events");
    revalidatePath("/events");
  }
  return { ok: true, results };
}

/** Explicit Involved-Business Resolution — the operator's own non-"ignored"
 * choices from review.otherBusinessChoices, validated as real Business ids
 * (never trusting the client's id without a lookup, same discipline as the
 * primary `businessId` just below). Dedup'd; the primary business is never
 * also added as an "other" participant. */
async function resolveOtherBusinessIds(admin: SupabaseClient, review: EventImportReview, primaryBusinessId: string | null): Promise<string[]> {
  const chosen = Object.values(review.otherBusinessChoices ?? {}).filter((c): c is { id: string; name: string } => c !== "ignored" && Boolean(c?.id));
  const ids = [...new Set(chosen.map((c) => c.id))].filter((id) => UUID.test(id) && id !== primaryBusinessId).slice(0, 25);
  if (ids.length === 0) return [];
  const { data } = await admin.from("businesses").select("id").in("id", ids);
  const valid = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  return ids.filter((id) => valid.has(id));
}

async function commitOne(admin: SupabaseClient, deps: SourceEventDeps, review: EventImportReview | undefined, businessId: string | null): Promise<EventImportOutcome> {
  if (!review || typeof review !== "object") return { ok: false, error: "Add the event's name." };
  // An Event resolved as already on Findmi is updated ONLY through Review
  // Existing Event (adminApplyExistingEvent) — never through new-Event
  // creation, whatever the client sends.
  if (typeof review.useEventId === "string" && UUID.test(review.useEventId)) {
    return { ok: true, kind: "already", title: typeof review.title === "string" ? review.title : "", viewHref: `/admin/events/${review.useEventId}` };
  }
  // Operator imports are always genuine source Events — never hosted.
  const normalized = normalizeReview({ ...review, intent: "participating", asEvent: true });
  if (!normalized.ok) return normalized;
  let business: string | null = null;
  if (businessId) {
    if (typeof businessId !== "string" || !UUID.test(businessId)) return { ok: false, error: "That Business isn't on Findmi." };
    const { data } = await admin.from("businesses").select("id").eq("id", businessId).maybeSingle();
    if (!data) return { ok: false, error: "That Business isn't on Findmi." };
    business = businessId;
  }
  const otherBusinessIds = await resolveOtherBusinessIds(admin, review, business);
  try {
    return await persistDiscoveryEvent(normalized.value, business, deps, otherBusinessIds);
  } catch {
    return { ok: false, error: "Couldn't save it. Please try again." };
  }
}

// ── Event Link enrichment (one Event per request) ─────────────────────────

/** Admin source reads have their own bound (a 25-Event paste reads up to 25
 * pages), separate from the per-person Paste/Link analysis limit. */
const ENRICH_WINDOW_MS = 10 * 60 * 1000;
const ENRICH_MAX_PER_WINDOW = 150;
let enrichHits: number[] = [];
function enrichRateLimited(now = Date.now()): boolean {
  enrichHits = enrichHits.filter((t) => now - t < ENRICH_WINDOW_MS);
  if (enrichHits.length >= ENRICH_MAX_PER_WINDOW) return true;
  enrichHits.push(now);
  return false;
}

/** ONE pasted structured Event, enriched from its own Event Link through
 * the existing Event URL importer (lib/event-import/engine.ts
 * analyzeAdminSourceEvent). The Review page runs these a few at a time, so
 * every Event gets its own bounded request. Writes nothing. */
export async function adminEnrichPastedEvent(text: string): Promise<EventImportAnalysis> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "server" };
  try {
    const deps: EventImportDeps = { ...operatorDeps(admin), isRateLimited: () => enrichRateLimited() };
    return publicImportAnalysis(await analyzeAdminSourceEvent({ text: typeof text === "string" ? text.slice(0, PASTE_MAX_CHARS) : "", rateKey: ADMIN_RATE_KEY }, deps));
  } catch {
    return { ok: false, code: "server" };
  }
}

// ── Business: the existing website-assisted Brand Import, inline ──────────

export interface BusinessReadView {
  batchId: string;
  candidateId: string;
  status: string;
  failureCode: string | null;
  proposal: BrandImportProposal | null;
  matchedBusiness: { id: string; name: string } | null;
  createdBusiness: { id: string; name: string } | null;
  updatedAt: string;
}

/** Starts the existing Brand Import for the Business websites named in
 * this paste (import tables only — brand_import_batches/candidates; no
 * Business is written). Same planning as Admin → Businesses → Import
 * (normalization, one candidate per host, at most 20 per batch). */
export async function adminStartBusinessReads(
  websites: string[]
): Promise<{ ok: true; reads: (BusinessReadView & { website: string })[] } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const list = [...new Set((Array.isArray(websites) ? websites : []).filter((w): w is string => typeof w === "string" && w.length <= 300))].slice(0, 50);
  const reads: (BusinessReadView & { website: string })[] = [];
  try {
    for (let i = 0; i < list.length; i += BRAND_IMPORT_MAX_INPUTS) {
      const chunk = list.slice(i, i + BRAND_IMPORT_MAX_INPUTS);
      const plan = planBrandImport(chunk.join("\n"));
      if (!plan.ok) continue;
      const batchId = await supabaseBrandImportStore(admin).createBatch(plan.candidates);
      const batch = await loadBrandImportBatch(admin, batchId);
      for (const c of batch?.candidates ?? []) reads.push({ website: c.submittedInput, ...readView(batchId, c) });
    }
  } catch {
    return { ok: false, error: "Couldn't start reading the Business websites. Please try again." };
  }
  return { ok: true, reads };
}

function readView(batchId: string, c: NonNullable<Awaited<ReturnType<typeof loadBrandImportCandidate>>>): BusinessReadView {
  return {
    batchId,
    candidateId: c.id,
    status: c.status,
    failureCode: c.failureCode,
    proposal: c.proposal,
    matchedBusiness: c.matchedBusiness,
    createdBusiness: c.createdBusiness,
    updatedAt: c.updatedAt,
  };
}

/** Processes ONE Business website — exactly Admin Brand Import's
 * processBrandImportCandidateAction (match first → website reading → AI →
 * logo / cover candidates); "busy" means retry shortly. */
export async function adminProcessBusinessRead(candidateId: string): Promise<BrandImportProcessOutcome | { outcome: "error" }> {
  if (typeof candidateId !== "string" || !UUID.test(candidateId)) return { outcome: "not_found" };
  const admin = await adminClient();
  if (!admin) return { outcome: "error" };
  try {
    const engine = defaultBrandImportEngine(admin, async () => (await getAllCategories("business")).map((c) => ({ id: c.id, slug: c.slug, name: c.name })));
    return await processBrandImportCandidate(candidateId, { store: supabaseBrandImportStore(admin), engine, now: Date.now, log: (entry) => console.info(JSON.stringify(entry)) });
  } catch {
    return { outcome: "error" };
  }
}

export async function adminLoadBusinessRead(batchId: string, candidateId: string): Promise<BusinessReadView | null> {
  if (!UUID.test(String(batchId)) || !UUID.test(String(candidateId))) return null;
  const admin = await adminClient();
  if (!admin) return null;
  try {
    const c = await loadBrandImportCandidate(admin, batchId, candidateId);
    return c ? readView(batchId, c) : null;
  } catch {
    return null;
  }
}

/** Create Business from the reviewed Brand Import candidate — the existing
 * Save Review + Create Business path (pending review, Free, no owner,
 * membership, claim, Pro or verification; final re-match first, so an
 * existing Business is linked instead of duplicated). */
export async function adminCreateBusinessFromRead(
  batchId: string,
  candidateId: string,
  expectedUpdatedAt: string,
  input: BrandReviewInput
): Promise<{ ok: true; business: { id: string; name: string }; existing: boolean } | { ok: false; error: string }> {
  if (!UUID.test(String(batchId)) || !UUID.test(String(candidateId))) return { ok: false, error: "This Business read is no longer available." };
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  try {
    const categories = await getAllCategories("business");
    const clean = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000) : "");
    const saved = await saveBrandReview(
      batchId,
      candidateId,
      clean(expectedUpdatedAt),
      {
        name: clean(input?.name),
        categoryId: clean(input?.categoryId),
        website: clean(input?.website),
        instagram: clean(input?.instagram),
        shortDescription: clean(input?.shortDescription),
        about: clean(input?.about),
        useLogo: input?.useLogo === true,
        useCover: input?.useCover === true,
      },
      { store: supabaseBrandReviewStore(admin), businessCategoryIds: new Set(categories.map((c) => c.id)) }
    );
    if (saved.outcome === "invalid") return { ok: false, error: saved.error };
    if (saved.outcome === "stale") return { ok: false, error: "This Business changed since it was loaded. Reload it and try again." };
    if (saved.outcome !== "saved") return { ok: false, error: "This Business can't be created from here." };
    const created = await createBusinessFromCandidate(batchId, candidateId, defaultCreateBusinessDeps(admin));
    if (created.outcome === "created" || created.outcome === "already_created" || created.outcome === "existing_business") {
      const { data } = await admin.from("businesses").select("id, name").eq("id", created.businessId).maybeSingle();
      const row = data as { id: string; name: string } | null;
      return row ? { ok: true, business: row, existing: created.outcome === "existing_business" } : { ok: false, error: "Couldn't load the new Business." };
    }
    if (created.outcome === "invalid") return { ok: false, error: created.error };
    return { ok: false, error: "Creation didn't finish. It's safe to try again — no duplicate will be created." };
  } catch {
    return { ok: false, error: "Creation didn't finish. It's safe to try again — no duplicate will be created." };
  }
}

// ── Review Existing Event ─────────────────────────────────────────────────

export async function adminCompareExistingEvent(
  eventId: string,
  review: EventImportReview,
  business: { id: string; name: string } | null
): Promise<{ ok: true; snapshot: ExistingEventSnapshot; comparisons: FieldComparison[] } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const snapshot = await loadExistingEventSnapshot(admin, String(eventId));
  if (!snapshot) return { ok: false, error: "That Event is no longer on Findmi." };
  return { ok: true, snapshot, comparisons: compareExistingEvent(snapshot, proposalFromReview(review ?? {}, business)) };
}

/** Applies only the fields Admin chose (lib/event-import/existing-event.ts). */
export async function adminApplyExistingEvent(
  eventId: string,
  review: EventImportReview,
  business: { id: string; name: string } | null,
  choices: Partial<Record<ExistingField, "fill" | "replace">>
): Promise<{ ok: true; applied: ExistingField[]; participants?: string[] } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  if (business) {
    const { data } = await admin.from("businesses").select("id").eq("id", business.id).maybeSingle();
    if (!data) return { ok: false, error: "That Business isn't on Findmi." };
  }
  try {
    const deps = discoveryDeps(admin);
    // Involved Businesses: only the operator's explicit Match / Create
    // resolutions, validated exactly as a new Event's are.
    const participantIds = await resolveOtherBusinessIds(admin, review ?? {}, business?.id ?? null);
    const result = await applyExistingEventEnrichment(
      admin,
      String(eventId),
      choices ?? {},
      proposalFromReview(review ?? {}, business),
      { storeImage: deps.storeImage, propagateDates: deps.propagateDates },
      participantIds
    );
    if (result.ok && (result.applied.length > 0 || (result.participants?.length ?? 0) > 0)) {
      revalidatePath("/admin/events");
      revalidatePath("/events");
    }
    return result;
  } catch {
    return { ok: false, error: "Couldn't update the Event. Please try again." };
  }
}

// ── Image previews (Review only; nothing stored) ──────────────────────────

/** A candidate Event image, previewed through the same fetch + verification
 * the save path uses (previewEventImage) — a small data URI, because the
 * page's CSP doesn't (and shouldn't) allow third-party image hosts. */
export async function adminPreviewEventImage(url: string): Promise<EventImagePreview> {
  const admin = await adminClient();
  if (!admin) return { preview: null, reason: "fetch_failed" };
  let parsed: URL | null = null;
  try {
    parsed = typeof url === "string" && url.length <= 2048 ? new URL(url) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password) return { preview: null, reason: "fetch_failed" };
  try {
    return await previewEventImage(parsed.toString());
  } catch {
    return { preview: null, reason: "fetch_failed" };
  }
}

/** Logo / cover previews of a Brand Import candidate — exactly what Admin →
 * Businesses → Import shows (previewBrandCandidateResult), read from the
 * candidate's own stored proposal (never a client-supplied URL). */
export async function adminPreviewBusinessRead(batchId: string, candidateId: string): Promise<{ logo: BrandPreviewResult; cover: BrandPreviewResult } | null> {
  const view = await adminLoadBusinessRead(batchId, candidateId);
  if (!view?.proposal) return null;
  const none: BrandPreviewResult = { preview: null, reason: null };
  try {
    const [logo, cover] = await Promise.all([
      view.proposal.logo ? previewBrandCandidateResult(view.proposal.logo, "logo") : Promise.resolve(none),
      view.proposal.cover ? previewBrandCandidateResult(view.proposal.cover, "cover") : Promise.resolve(none),
    ]);
    return { logo, cover };
  } catch {
    return null;
  }
}

// ── Entity Media Completeness V1 ──────────────────────────────────────────

/** A READY Brand Import read (not yet used to create or link a Business)
 * that names this Business — so Review creates from it (verified logo /
 * cover included) instead of a bare Quick Create. */
async function findReadyBusinessRead(admin: SupabaseClient, name: string): Promise<{ batchId: string; candidateId: string; website: string } | null> {
  const { data } = await admin
    .from("brand_import_candidates")
    .select("id, batch_id, normalized_host, proposal")
    .eq("status", "ready")
    .is("created_business_id", null)
    .is("matched_business_id", null)
    .order("created_at", { ascending: false })
    .limit(100);
  for (const row of (data ?? []) as { id: string; batch_id: string; normalized_host: string | null; proposal: { name?: string | null; finalUrl?: string | null } | null }[]) {
    const website = row.proposal?.finalUrl ?? (row.normalized_host ? `https://${row.normalized_host}/` : null);
    if (website && readMatchesBusiness(name, { name: row.proposal?.name ?? null, website })) return { batchId: row.batch_id, candidateId: row.id, website };
  }
  return null;
}

const MEDIA_TABLE: Record<EntityMediaKind, "businesses" | "locations"> = { business: "businesses", location: "locations" };
const MEDIA_SELECT: Record<EntityMediaKind, string> = {
  business: "id, name, logo_url, cover_image_url, website_url",
  location: "id, name, logo_url, cover_image_url, website_url, address, city, state, postal_code",
};

async function loadMediaRow(admin: SupabaseClient, kind: EntityMediaKind, id: string): Promise<EntityMediaRow | null> {
  if (!UUID.test(String(id))) return null;
  const { data } = await admin.from(MEDIA_TABLE[kind]).select(MEDIA_SELECT[kind]).eq("id", id).maybeSingle();
  return (data as EntityMediaRow | null) ?? null;
}

/** Logo / cover completeness of the Businesses and Locations a Review uses. */
export async function adminEntityMediaStatus(refs: { kind: EntityMediaKind; id: string }[]): Promise<EntityMediaState[]> {
  const admin = await adminClient();
  if (!admin) return [];
  const out: EntityMediaState[] = [];
  for (const kind of ["business", "location"] as const) {
    const ids = [...new Set((Array.isArray(refs) ? refs : []).filter((r) => r?.kind === kind && UUID.test(String(r.id))).map((r) => r.id))].slice(0, 60);
    if (ids.length === 0) continue;
    const { data } = await admin.from(MEDIA_TABLE[kind]).select(MEDIA_SELECT[kind]).in("id", ids);
    for (const row of (data ?? []) as unknown as EntityMediaRow[]) out.push(entityMediaState(kind, row));
  }
  return out;
}

/** Find Media — candidates for the MISSING roles only: the stored website,
 * else this import's website, else Entity Research; read by the existing
 * website reader. Verified previews only; nothing is stored here. */
export async function adminFindEntityMedia(input: { kind: EntityMediaKind; id: string; website?: string | null; eventName?: string | null }): Promise<{ ok: true; result: FindMediaResult } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const kind: EntityMediaKind = input?.kind === "location" ? "location" : "business";
  try {
    const row = await loadMediaRow(admin, kind, input?.id);
    if (!row) return { ok: false, error: "That record is no longer available." };
    const deps = defaultLocationImportDeps(admin);
    const result = await findEntityMedia(
      kind,
      row,
      { website: typeof input?.website === "string" ? input.website.slice(0, 500) : null, eventName: typeof input?.eventName === "string" ? input.eventName.slice(0, 200) : null },
      {
        research: (q) => researchEntity(q, undefined, { log: (entry) => console.info(JSON.stringify({ event: "entity_research", ...entry })) }),
        readWebsite: async (url, supplied) => {
          const read = await readLocationWebsite(url, supplied, deps);
          return read.ok ? { ok: true, logo: read.logo, cover: read.cover } : { ok: false };
        },
      }
    );
    return { ok: true, result };
  } catch {
    return { ok: false, error: "Couldn't look for media just now. Try again." };
  }
}

// Media Truthfulness pass — a fetch/verify failure on the exact candidate
// URL Find Media just showed as valid is more likely a transient remote
// hiccup (the site rate-limiting a second rapid request, a flaky CDN) than
// a real rejection, since the SAME check already passed moments earlier.
// One bounded retry after a short delay before reporting a real failure —
// never a second chance at a DIFFERENT (weaker) check; the retry calls the
// exact same fetchVerifiedBrandImage.
const MEDIA_APPLY_RETRY_DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Apply approved media — FILL-ONLY (an existing logo / cover is never
 * replaced; the write itself only lands while the field is still empty).
 * Every role that doesn't apply reports the SPECIFIC reason (never the old
 * one-size-fits-all "couldn't be verified, or it was already set"). */
export async function adminApplyEntityMedia(input: { kind: EntityMediaKind; id: string; logoSourceUrl?: string | null; coverSourceUrl?: string | null }): Promise<{ ok: true; applied: ("logo" | "cover")[]; skipped: { role: "logo" | "cover"; reason: string }[] } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const kind: EntityMediaKind = input?.kind === "location" ? "location" : "business";
  try {
    const result = await applyEntityMedia(kind, input?.id, { logoSourceUrl: input?.logoSourceUrl ?? null, coverSourceUrl: input?.coverSourceUrl ?? null }, {
      load: (k, id) => loadMediaRow(admin, k, id),
      store: async (url, role) => {
        let verified = await fetchVerifiedBrandImage(url, role);
        if (!verified.ok && verified.reason === "fetch_failed") {
          await sleep(MEDIA_APPLY_RETRY_DELAY_MS);
          verified = await fetchVerifiedBrandImage(url, role);
        }
        if (!verified.ok) return { ok: false, reason: "verification_failed", detail: brandImageFailureReason(verified) };
        const stored = await storeBrandImage(admin, verified.image);
        return stored ? { ok: true, url: stored } : { ok: false, reason: "storage_failed" };
      },
      fillIfEmpty: async (k, id, column, url) => {
        const { data, error } = await admin.from(MEDIA_TABLE[k]).update({ [column]: url }).eq("id", id).is(column, null).select("id");
        return !error && ((data ?? []) as unknown[]).length > 0;
      },
    });
    if (!result.ok) return result;
    if (result.applied.length > 0) revalidatePath("/admin/events");
    return { ok: true, applied: result.applied, skipped: result.skipped.map((s) => ({ role: s.role, reason: mediaSkipMessage(s) })) };
  } catch {
    return { ok: false, error: "Couldn't save the media. Nothing was changed." };
  }
}

/** A truthful, operator-facing reason for one skipped role — never the old
 * generic "couldn't be verified, or it was already set". */
function mediaSkipMessage(skip: { reason: string; detail?: string }): string {
  if (skip.reason === "already_set") return "Already set — a value was added to this field while Find Media was open.";
  if (skip.reason === "storage_failed") return "The image was verified but couldn't be saved to Findmi storage. Try again.";
  return `The image could no longer be verified (${skip.detail ?? "it changed or is no longer reachable"}). Try Find Media again.`;
}

/** Admin Event Import — Upload Image / Replace Image for one Event in
 * Review. The SAME Event image path the Business importer uses
 * (storeUploadedEventImage), so Admin and Business imports never keep
 * separate media systems. Returns the Findmi URL the review then carries. */
export async function adminUploadEventCover(form: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  const stored = await storeUploadedEventImage(admin, form instanceof FormData ? form.get("image") : null, EVENT_IMPORT_IMAGE_MAX_BYTES);
  return stored.ok ? stored : { ok: false, error: uploadedEventImageError(stored.reason) };
}
