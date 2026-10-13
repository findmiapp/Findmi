"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { analyzeEventUrl, defaultEventImportDeps } from "@/lib/event-import/engine";
import { recoverEventImage } from "@/lib/event-import/media";
import { describeSourceFailure, type EventImportFetchDiagnostics } from "@/lib/event-import/diagnostics";
import { convertAppearanceToEvent, type ConvertResult } from "@/lib/appearance-conversion";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { isSlugTaken } from "@/lib/admin/queries";

/** Rich Appearance → Event conversion — ADMIN ONLY, one schedule item at a
 * time. Re-reads the item's own source link through the SAME Event Import
 * analysis a new import uses, refuses a calendar page / an unreadable
 * source / an Event already on Findmi, validates identity inside the
 * conversion, and returns everything it did. Nothing runs automatically;
 * a later canary is one explicit call (or the small button on the admin
 * Edit Appearance page). */

export type AdminConvertSummary =
  | {
      status: "converted";
      eventId: string;
      occurrenceId: string;
      appearanceId: string;
      image: "stored" | "failed" | "none" | undefined;
      warnings: string[];
      recovered: { title: string | null; description: boolean; imageUrl: string | null; organizer: string | null; sourceUrl: string; dates: string[] };
    }
  | { status: "not_converted"; reason: string; detail?: string; eventId?: string; fetch?: EventImportFetchDiagnostics };

export async function convertLegacyAppearanceToEvent(appearanceId: string): Promise<AdminConvertSummary> {
  const admin = await requireAdminSupabase();
  return runConversion(admin, appearanceId);
}

async function runConversion(admin: SupabaseClient, appearanceId: string): Promise<AdminConvertSummary> {
  const { data } = await admin.from("appearances").select("id, business_id, external_url, event_id").eq("id", appearanceId).maybeSingle();
  const row = data as { id: string; business_id: string; external_url: string | null; event_id: string | null } | null;
  if (!row) return { status: "not_converted", reason: "not_found" };
  if (row.event_id) return { status: "not_converted", reason: "already_linked", eventId: row.event_id };
  if (!row.external_url) return { status: "not_converted", reason: "no_source_link" };

  // The same analysis a new import runs (safe fetch, extraction, matching).
  const analysis = await analyzeEventUrl({ url: row.external_url, businessId: row.business_id, rateKey: `admin-convert:${row.id}` }, defaultEventImportDeps(admin));
  // Admin-only: the site's own status + final host, e.g. "Source unavailable
  // — luma.com returned HTTP 403." (consumer importers never see these).
  if (!analysis.ok) return { status: "not_converted", reason: "source_unavailable", detail: describeSourceFailure(analysis.code, analysis.fetch), fetch: analysis.fetch };
  if (analysis.kind !== "single") return { status: "not_converted", reason: "source_is_calendar", detail: "That link lists several Events, not this one." };
  // A conservative Event match already on Findmi: joining it is a separate,
  // reviewed decision — never a second Event.
  if (analysis.matches.event?.confidence === "strong") {
    return { status: "not_converted", reason: "event_match_exists", eventId: analysis.matches.event.id, detail: analysis.matches.event.name };
  }

  const candidate = analysis.candidate;
  const result: ConvertResult = await convertAppearanceToEvent(admin, row.id, {
    recovered: candidate,
    storeImage: async (url) => {
      const stored = await recoverEventImage(admin, url);
      return stored.ok ? stored.url : null;
    },
    uniqueEventSlug: async (title) => {
      const base = resolveSlugInput(null, title);
      return base ? ensureUniqueSlug(base, (c) => isSlugTaken("events", c)) : null;
    },
  });

  if (result.status !== "converted") {
    return {
      status: "not_converted",
      reason: result.status === "skipped" || result.status === "refused" ? result.reason : "error",
      detail: result.status === "refused" ? result.detail : result.status === "error" ? result.error : undefined,
      eventId: result.status === "skipped" ? result.eventId : undefined,
    };
  }
  revalidatePath("/admin/events");
  revalidatePath(`/admin/appearances/${row.id}`);
  return {
    status: "converted",
    eventId: result.eventId,
    occurrenceId: result.occurrenceId,
    appearanceId: result.appearanceId,
    image: result.image,
    warnings: result.warnings ?? [],
    recovered: {
      title: candidate.title,
      description: Boolean(candidate.description),
      imageUrl: candidate.imageUrl,
      organizer: candidate.organizer,
      sourceUrl: candidate.sourceUrl,
      dates: candidate.occurrences.map((o) => o.start),
    },
  };
}

/** The Edit Appearance page's small "Convert To Event" form. */
export async function convertAppearanceFromAdminPage(appearanceId: string) {
  const admin = await requireAdminSupabase();
  const out = await runConversion(admin, appearanceId);
  const base = `/admin/appearances/${appearanceId}`;
  if (out.status === "converted") {
    const note = out.image === "failed" ? "&convertNote=image" : "";
    redirect(`${base}?converted=${out.eventId}${note}`);
  }
  // A source failure's detail is already a full sentence.
  const message = out.reason === "source_unavailable" && out.detail ? out.detail : [out.reason, out.detail].filter(Boolean).join(": ");
  redirect(`${base}?convertError=${encodeURIComponent(message)}`);
}
