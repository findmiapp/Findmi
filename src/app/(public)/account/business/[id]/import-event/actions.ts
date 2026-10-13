"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isEmailVerified, requireBusinessMember } from "@/lib/permissions";
import { getHostEventEligibility } from "@/lib/entitlements";
import { analyzeEventUrl, defaultEventImportDeps } from "@/lib/event-import/engine";
import { normalizeReview, persistEventImport } from "@/lib/event-import/persist";
import type { EventImportAnalysis, EventImportOutcome, EventImportReview } from "@/lib/event-import/types";
import { applyBusinessToEvent } from "@/lib/event-participation";
import { fetchVerifiedBrandImage, storeBrandImage } from "@/lib/brand-images";
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
    return await analyzeEventUrl({ url, businessId, rateKey: ctx.user.id }, defaultEventImportDeps(ctx.admin));
  } catch {
    return { ok: false, code: "server" };
  }
}

/** Create / connect — only from the reviewed values. */
export async function commitEventImport(businessId: string, review: EventImportReview): Promise<EventImportOutcome> {
  const ctx = await authorize(businessId);
  if (!ctx) return { ok: false, error: "You don't have access to this Business." };
  const normalized = normalizeReview(review);
  if (!normalized.ok) return normalized;
  const { admin, user, business } = ctx;

  if (normalized.value.intent === "participating" && normalized.value.useEventId && !(await isEmailVerified(admin, user.id))) {
    return { ok: false, error: "Verify your email before asking to join an Event." };
  }

  try {
    const outcome = await persistEventImport(normalized.value, {
      admin,
      userId: user.id,
      businessId,
      businessName: business.name,
      applyToEvent: (eventId) => applyBusinessToEvent(admin, { eventId, businessId, userId: user.id }),
      canHost: async () => (await getHostEventEligibility(admin, user.id, businessId)).ok,
      storeImage: async (url) => {
        const verified = await fetchVerifiedBrandImage(url, "cover");
        return verified.ok ? storeBrandImage(admin, verified.image) : null;
      },
      geography: async (text) => {
        const match = await findExistingGeographyMatch(admin, text);
        return match ? { marketId: match.marketId, areaId: match.areaId ?? null } : null;
      },
      uniqueEventSlug: async (title) => {
        const base = resolveSlugInput(null, title);
        return base ? ensureUniqueSlug(base, (candidate) => isSlugTaken("events", candidate)) : null;
      },
      notifyNewEvent: async (eventId, title, startIso) => {
        await notifyAdmin({
          subject: `Event awaiting review: ${title}`,
          heading: "New Event awaiting review",
          body: [`Event: ${title}`, `Host: ${business.name}`, `Starts: ${new Date(startIso).toLocaleString()}`, "Source: Event Import"],
          actionLabel: "Review Event",
          actionUrl: `/admin/events/${eventId}`,
        });
      },
      propagateDates: (eventId, ids) => propagateAllDatesParticipation(admin, eventId, ids),
    });
    if (outcome.ok) {
      revalidatePath(`/account/business/${businessId}`);
      revalidatePath("/account");
    }
    return outcome;
  } catch {
    return { ok: false, error: "Couldn't save it. Please try again." };
  }
}
