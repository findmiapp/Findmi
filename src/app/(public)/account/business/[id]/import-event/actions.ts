"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isEmailVerified, requireBusinessMember } from "@/lib/permissions";
import { createHostedEvent, getHostAuthority } from "@/lib/event-hosting";
import { eventHref } from "@/lib/event-links";
import { analyzeEventImage, analyzeEventText, analyzeEventUrl, defaultEventImportDeps } from "@/lib/event-import/engine";
import { readEventImportImage } from "@/lib/event-import/image-source";
import { publicImportAnalysis } from "@/lib/event-import/diagnostics";
import { normalizeReview, persistEventImport, type PersistDeps } from "@/lib/event-import/persist";
import type { EventImportAnalysis, EventImportOutcome, EventImportReview } from "@/lib/event-import/types";
import { applyBusinessToEvent } from "@/lib/event-participation";
import { isStoredEventImageUrl, previewEventImage, recoverEventImage, storeUploadedEventImage, uploadedEventImageError, type EventImagePreview } from "@/lib/event-import/media";
import { EVENT_IMPORT_IMAGE_MAX_BYTES } from "@/lib/event-import/types";
import { findExistingGeographyMatch } from "@/lib/market-requests";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { isSlugTaken } from "@/lib/admin/queries";
import { notifyAdmin } from "@/lib/notifications/adminNotify";
import { propagateAllDatesParticipation } from "@/lib/appearance-event-sync";

/** Event Import V1 — Business entry (Where I'll Be / Host an Event). The
 * same engine serves every context; this file only supplies the Business
 * context and authorization. Membership is re-derived from the caller's
 * own session on every call (never trusted from the client). */
async function authorize(businessId: string) {
  try {
    await requireBusinessMember(businessId);
  } catch {
    return null;
  }
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = getAdminSupabase();
  if (!user || !admin) return null;
  const { data: business } = await admin.from("businesses").select("id, name").eq("id", businessId).maybeSingle();
  if (!business) return null;
  return { user, admin, business: business as { id: string; name: string } };
}

/** Analyze only — reads the page and finds matches. Writes nothing. */
export async function analyzeEventImport(businessId: string, url: string): Promise<EventImportAnalysis> {
  const ctx = await authorize(businessId);
  if (!ctx) return { ok: false, code: "server" };
  try {
    // Consumer-facing: the plain failure code only, never fetch diagnostics.
    return publicImportAnalysis(await analyzeEventUrl({ url, businessId, rateKey: ctx.user.id }, defaultEventImportDeps(ctx.admin)));
  } catch {
    return { ok: false, code: "server" };
  }
}

/** Paste Details — analyze pasted text through the same engine (same
 * per-person rate limit). Writes nothing. */
export async function analyzeEventImportText(businessId: string, text: string): Promise<EventImportAnalysis> {
  const ctx = await authorize(businessId);
  if (!ctx) return { ok: false, code: "server" };
  try {
    return publicImportAnalysis(await analyzeEventText({ text: typeof text === "string" ? text : "", businessId, rateKey: ctx.user.id }, defaultEventImportDeps(ctx.admin)));
  } catch {
    return { ok: false, code: "server" };
  }
}

/** Upload — analyze one flyer / screenshot through the same engine (same
 * per-person rate limit). The image is read once and never stored. */
export async function analyzeEventImportImage(businessId: string, form: FormData): Promise<EventImportAnalysis> {
  const ctx = await authorize(businessId);
  if (!ctx) return { ok: false, code: "server" };
  try {
    const image = await readEventImportImage(form instanceof FormData ? form.get("image") : null);
    if (!image.ok) return { ok: false, code: image.code };
    return publicImportAnalysis(await analyzeEventImage({ image: image.image, businessId, rateKey: ctx.user.id }, defaultEventImportDeps(ctx.admin)));
  } catch {
    return { ok: false, code: "server" };
  }
}

type Ctx = NonNullable<Awaited<ReturnType<typeof authorize>>>;

/** The existing domain paths, bound to this Business + signed-in person. */
function persistDepsFor(ctx: Ctx, businessId: string, storedFlyerUrl: string | null = null): PersistDeps {
  const { admin, user, business } = ctx;
  return {
    admin,
    userId: user.id,
    businessId,
    businessName: business.name,
    // A Business submission: new Events are saved pending Admin review
    // (an Admin operating the Business publishes hosted Events through
    // createHostedEvent's viaAdmin path).
    submitter: "business",
    applyToEvent: (eventId) => applyBusinessToEvent(admin, { eventId, businessId, userId: user.id }),
    // Real Owner/Manager first; an Admin explicitly operating this Business
    // (Manage-As) as the audited fallback — never a fabricated membership
    // (lib/event-hosting.ts).
    canHost: async () => (await getHostAuthority(admin, user.id, businessId)).ok,
    createHostedEvent: async (e) => {
      const authority = await getHostAuthority(admin, user.id, businessId);
      if (!authority.ok) return { ok: false, code: "host_not_authorized" };
      return createHostedEvent(admin, { ...e, userId: user.id, viaAdmin: authority.viaAdmin, hostBusinessId: businessId });
    },
    // The one Event image path (lib/event-import/media.ts) — Event art
    // rules, not the Brand header rules.
    storeImage: async (url) => {
      // The owner's own flyer, already verified + stored by this commit, or
      // a cover uploaded in Review (already verified + stored by
      // uploadImportEventCover) — never fetched and copied a second time.
      if (storedFlyerUrl && url === storedFlyerUrl) return storedFlyerUrl;
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
    notifyNewEvent: async (eventId, title, startIso, date) => {
      await notifyAdmin({
        subject: `Event submitted for review: ${title}`,
        heading: "New Event submitted for review",
        body: [`Event: ${title}`, `Added by: ${business.name}`, startIso ? `Starts: ${new Date(startIso).toLocaleString()}` : `Date: ${date} (time not listed)`, "Source: Event Import"],
        actionLabel: "View in Admin",
        actionUrl: `/admin/events/${eventId}`,
      });
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

async function commitOne(ctx: Ctx, businessId: string, review: EventImportReview, emailVerified: () => Promise<boolean>, flyer: unknown = null): Promise<EventImportOutcome> {
  const normalized = normalizeReview(review);
  if (!normalized.ok) return normalized;
  if (normalized.value.intent === "participating" && normalized.value.useEventId && !(await emailVerified())) {
    return { ok: false, error: "Verify your email before asking to join an Event." };
  }
  // "Use Your Uploaded Flyer": the uploaded flyer is stored only now,
  // only because the owner chose it, and only for a NEW Event (joining an
  // existing Event never changes its image).
  let flyerUrl: string | null = null;
  if (flyer && !normalized.value.useEventId) {
    const stored = await storeUploadedEventImage(ctx.admin, flyer, EVENT_IMPORT_IMAGE_MAX_BYTES);
    if (!stored.ok) return { ok: false, error: stored.reason === "unsuitable" ? "That image can't be used as the Event image (it's too small or too narrow). Choose another image, or “No Image”, to continue." : "Couldn't use that image. Try again, or choose “No Image”." };
    flyerUrl = stored.url;
  }
  try {
    const outcome = await persistEventImport(flyerUrl ? { ...normalized.value, imageUrl: flyerUrl } : normalized.value, persistDepsFor(ctx, businessId, flyerUrl));
    // Joining an Event already on Findmi: its public page, when it's live.
    if (outcome.ok && !outcome.publicHref && normalized.value.useEventId) return { ...outcome, ...(await publicLink(ctx.admin, normalized.value.useEventId)) };
    return outcome;
  } catch {
    return { ok: false, error: "Couldn't save it. Please try again." };
  }
}

async function publicLink(admin: Ctx["admin"], eventId: string): Promise<{ publicHref?: string; eventId?: string }> {
  const { data } = await admin.from("events").select("id, slug, is_demo, trashed_at").eq("id", eventId).maybeSingle();
  const ev = data as { id: string; slug: string; is_demo: boolean; trashed_at: string | null } | null;
  return ev && !ev.is_demo && !ev.trashed_at ? { publicHref: eventHref(ev.slug), eventId: ev.id } : {};
}

/** Event artwork chosen in Review — Upload Image / Replace Image. The file
 * goes through the ONE Event image path (storeUploadedEventImage: real-bytes
 * validation, HEIC conversion, Event-image fit, Findmi storage) and comes
 * back as a Findmi URL the review then carries as its image. */
export async function uploadImportEventCover(businessId: string, form: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await authorize(businessId);
  if (!ctx) return { ok: false, error: "You don't have access to this Business." };
  const stored = await storeUploadedEventImage(ctx.admin, form instanceof FormData ? form.get("image") : null, EVENT_IMPORT_IMAGE_MAX_BYTES);
  return stored.ok ? stored : { ok: false, error: uploadedEventImageError(stored.reason) };
}

/** A verified preview of the image detected on the source (a third-party
 * URL never renders directly — CSP): the same check the save path uses. */
export async function previewImportEventImage(businessId: string, url: string): Promise<EventImagePreview> {
  const ctx = await authorize(businessId);
  if (!ctx || typeof url !== "string" || !/^https:\/\//i.test(url)) return { preview: null, reason: "fetch_failed" };
  try {
    return await previewEventImage(url);
  } catch {
    return { preview: null, reason: "fetch_failed" };
  }
}

/** Create / connect — only from the reviewed values. `flyer` carries the
 * uploaded source image ONLY when the owner chose to use it as the Event
 * image; otherwise nothing about the upload is ever stored. */
export async function commitEventImport(businessId: string, review: EventImportReview, flyer: FormData | null = null): Promise<EventImportOutcome> {
  const ctx = await authorize(businessId);
  if (!ctx) return { ok: false, error: "You don't have access to this Business." };
  const outcome = await commitOne(ctx, businessId, review, () => isEmailVerified(ctx.admin, ctx.user.id), flyer instanceof FormData ? flyer.get("image") : null);
  if (outcome.ok) {
    revalidatePath(`/account/business/${businessId}`);
    revalidatePath("/account");
  }
  return outcome;
}

const BATCH_MAX = 40;

/** V1C — several reviewed Events from one source. Each one is validated
 * and saved on its own through the same path as a single import: one that
 * fails never undoes or blocks the others, and nothing unreviewed is sent. */
export async function commitEventImportBatch(businessId: string, reviews: EventImportReview[]): Promise<{ ok: true; results: { title: string; outcome: EventImportOutcome }[] } | { ok: false; error: string }> {
  const ctx = await authorize(businessId);
  if (!ctx) return { ok: false, error: "You don't have access to this Business." };
  if (!Array.isArray(reviews) || reviews.length === 0) return { ok: false, error: "Choose at least one Event." };
  if (reviews.length > BATCH_MAX) return { ok: false, error: `Add up to ${BATCH_MAX} Events at a time.` };
  let verified: boolean | null = null;
  const emailVerified = async () => (verified ??= await isEmailVerified(ctx.admin, ctx.user.id));
  const results: { title: string; outcome: EventImportOutcome }[] = [];
  for (const review of reviews) {
    results.push({ title: typeof review?.title === "string" ? review.title : "", outcome: await commitOne(ctx, businessId, review, emailVerified) });
  }
  if (results.some((r) => r.outcome.ok)) {
    revalidatePath(`/account/business/${businessId}`);
    revalidatePath("/account");
  }
  return { ok: true, results };
}
