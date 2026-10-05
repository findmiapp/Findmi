"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isAdminSession } from "@/lib/admin/auth";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { validateImageFile, validateConnectableObject, JOURNAL_MEDIA_BUCKET } from "@/lib/journal";
import { getAllOccurrencesForEvent } from "@/lib/data";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import {
  isJournalSectionType,
  JOURNAL_PHOTO_CAPTION_MAX,
  JOURNAL_SECTION_NOTES_MAX,
  JOURNAL_SECTION_TITLE_MAX,
  type JournalEntrySectionRow,
} from "@/lib/journal-sections";

// Journal V1 Server Actions — every mutation here re-derives the caller's
// real id from their own session (getServerSupabase().auth.getUser()) and
// re-verifies ownership of the target journal_entries row itself before
// touching anything; a client-supplied entryId/mediaId is never trusted at
// face value, same discipline every existing member action in this codebase
// (requireBusinessMember/requireAuthorizedBusinessMember) already follows.
// RLS backs every one of these as a second layer — an ownership check here
// that somehow had a bug still could not let the write through.

async function requireUser() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You need to be signed in to do that.");
  return user;
}

/** Verifies the caller owns `entryId`, via the session-scoped client (RLS-
 * backed — a non-owner's select simply returns no row). Returns the admin
 * (service-role) client for the actual write once ownership is confirmed,
 * same two-step pattern requireAuthorizedBusinessMember already uses.
 *
 * Journal Pass 1 — an authorized FindMi admin (isAdminSession(), the same
 * independent cookie-session check middleware's own /admin gate performs)
 * is also allowed through, for ANY entry regardless of its real owner —
 * this is the one path the new /admin/journal/[id] editor needs, since an
 * admin-password session carries no Supabase auth identity of its own and
 * so could never pass the owner check above. requireAdminSupabase()
 * re-verifies admin status (defense in depth, same as every other
 * privileged admin Server Action in this codebase) before handing back the
 * service-role client; the entry's real `user_id` is read directly via
 * that client (bypassing RLS, correctly, since this caller is already
 * independently authorized) so uploadJournalPhoto's storage path still
 * groups by the entry's TRUE owner, never the editing admin. Every
 * existing consumer owner-path call and behavior below is unchanged. */
async function requireOwnEntry(entryId: string) {
  if (await isAdminSession()) {
    const admin = await requireAdminSupabase();
    const { data: entry } = await admin.from("journal_entries").select("id, user_id").eq("id", entryId).maybeSingle();
    if (!entry) throw new Error("That Moment doesn't exist.");
    return { admin, userId: entry.user_id as string };
  }

  const user = await requireUser();
  const supabase = await getServerSupabase();
  const { data: entry } = await supabase.from("journal_entries").select("id, user_id").eq("id", entryId).maybeSingle();
  if (!entry || entry.user_id !== user.id) throw new Error("That Moment doesn't exist or isn't yours.");
  const admin = getAdminSupabase();
  if (!admin) throw new Error("Server isn't configured.");
  return { admin, userId: user.id };
}

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Step 1 entry point — creates a bare draft row the instant a visitor
 * starts documenting an experience, so a photo uploaded a moment later
 * always has a real journal_entry_id to attach to. Title/date are
 * placeholder-safe defaults (today's date, empty title) immediately
 * overwritten by saveJournalBasics on the first real "Next" tap; never
 * shown to anyone but the owner (draft rows are excluded from the Index
 * and from every public/other-user RLS read). */
export async function startJournalDraft(): Promise<{ id: string } | { error: string }> {
  try {
    const user = await requireUser();
    const admin = getAdminSupabase();
    if (!admin) return { error: "Server isn't configured." };
    const { data, error } = await admin
      .from("journal_entries")
      .insert({ user_id: user.id, title: "", entry_date: new Date().toISOString().slice(0, 10) })
      .select("id")
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't start a new entry." };
    return { id: data.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start a new entry." };
  }
}

export async function saveJournalBasics(
  entryId: string,
  formData: FormData
): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const title = str(formData, "title");
    const entryDate = str(formData, "entry_date");
    if (!title) return { error: "Name this Moment." };
    if (!entryDate) return { error: "Choose a date." };

    const { error } = await admin
      .from("journal_entries")
      .update({
        title,
        entry_date: entryDate,
        entry_time: str(formData, "entry_time"),
        notes: str(formData, "notes"),
      })
      .eq("id", entryId);
    if (error) return { error: error.message };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't save that." };
  }
}

export async function uploadJournalPhoto(
  entryId: string,
  formData: FormData
): Promise<{ id: string; url: string; isCover: boolean } | { error: string }> {
  try {
    const { admin, userId } = await requireOwnEntry(entryId);
    const sectionId = await resolveUploadSectionId(admin, entryId, formData.get("sectionId"));
    if (sectionId && "error" in sectionId) return sectionId;
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "No file selected." };

    const validated = await validateImageFile(file);
    if ("error" in validated) return validated;

    // Image Performance V1 — concurrent uploads broke the old "count
    // existing rows, use that as the next index" approach: two uploads
    // racing the same count query could read the same count and collide
    // on display_order. The client (useJournalPhotoUpload) now computes a
    // deterministic, collision-free index per photo BEFORE any upload in
    // the batch starts (existing photo count snapshotted once, plus each
    // photo's own fixed position in the user's selection — never
    // completion order), and sends it as `displayOrder`. This is a pure
    // ordering value with no authorization meaning — requireOwnEntry above
    // already gates that only the entry's real owner can call this at all,
    // so the worst a bad value could do is misorder the owner's own
    // photos. Any caller that doesn't send one (defensive — only this
    // hook does today) falls back to the exact original count-query
    // behavior, unchanged.
    const requestedOrderRaw = formData.get("displayOrder");
    let displayOrder: number;
    if (typeof requestedOrderRaw === "string" && /^\d+$/.test(requestedOrderRaw)) {
      displayOrder = parseInt(requestedOrderRaw, 10);
    } else {
      const { count } = await admin
        .from("journal_entry_media")
        .select("id", { count: "exact", head: true })
        .eq("journal_entry_id", entryId);
      displayOrder = count ?? 0;
    }

    // Server-generated path only — never the original filename. Scoped
    // under the owning user AND entry so a storage listing (service-role
    // only, never reachable by a client) stays organized; the path itself
    // carries no authorization meaning on its own — see this module's own
    // header note on why a signed URL is the only way to ever read it.
    const path = `journal/${userId}/${entryId}/${randomUUID()}.${validated.extension}`;
    const uploadBody = validated.converted?.buffer ?? file;
    const { error: uploadError } = await admin.storage.from(JOURNAL_MEDIA_BUCKET).upload(path, uploadBody, {
      contentType: validated.contentType,
      upsert: false,
      // Image Performance V1 — every path here is immutable (a fresh
      // randomUUID every time, upsert: false, never overwritten), so a
      // 1-year cache lifetime is safe; Supabase's own default (3600s) was
      // needlessly short for content that never changes under its URL.
      cacheControl: "31536000",
    });
    if (uploadError) return { error: uploadError.message };

    // Image Performance V1 — the DB insert and the signed-URL creation are
    // independent (the signed URL only needs `path`, already known above,
    // never the insert's result), so they now run concurrently instead of
    // strictly in series. Failure semantics are unchanged from before: an
    // insert failure still cleans up the just-uploaded Storage object; a
    // signing failure alone was already non-fatal before this change (the
    // caller simply got back an empty `url`) and still is — no new orphan
    // risk, just less time spent waiting.
    //
    // Moments V2 — cover is explicit is_cover, independent of position. A
    // new photo only claims the cover when it's at position 0 AND this
    // Moment has no cover yet (i.e. the first photo into an empty Moment);
    // a client-supplied position 0 alone never steals an existing cover.
    const claimCover = displayOrder === 0 && !(await entryHasCover(admin, entryId));
    const [{ data: mediaRow, error: insertError }, { data: signed }] = await Promise.all([
      insertMediaRows(admin, [
        {
          journal_entry_id: entryId,
          storage_path: path,
          display_order: displayOrder,
          is_cover: claimCover,
          ...(sectionId ? { section_id: sectionId.id } : {}),
        },
      ]).then(({ data, error }) => ({ data: data?.[0] ?? null, error })),
      admin.storage.from(JOURNAL_MEDIA_BUCKET).createSignedUrl(path, 60 * 60),
    ]);
    if (insertError || !mediaRow) {
      await admin.storage.from(JOURNAL_MEDIA_BUCKET).remove([path]);
      return { error: insertError?.message ?? "Couldn't save that photo." };
    }

    return { id: mediaRow.id, url: signed?.signedUrl ?? "", isCover: mediaRow.is_cover };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't upload that photo." };
  }
}

/** Deletes one photo (row + Storage object). If it was the cover, the
 * Moment's first remaining photo (global display_order) becomes the cover.
 * Returns the Moment's resulting cover id so the editor can sync its
 * explicit cover state. */
export async function removeJournalPhoto(
  entryId: string,
  mediaId: string
): Promise<{ ok: true; coverMediaId: string | null } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const { data: media } = await admin
      .from("journal_entry_media")
      .select("id, storage_path, is_cover")
      .eq("id", mediaId)
      .eq("journal_entry_id", entryId)
      .maybeSingle();
    if (!media) return { error: "That photo is already gone." };

    await admin.from("journal_entry_media").delete().eq("id", mediaId);
    await admin.storage.from(JOURNAL_MEDIA_BUCKET).remove([media.storage_path]);

    if (media.is_cover) {
      const { data: next } = await admin
        .from("journal_entry_media")
        .select("id")
        .eq("journal_entry_id", entryId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next) await admin.from("journal_entry_media").update({ is_cover: true }).eq("id", next.id);
    }
    return { ok: true, coverMediaId: await currentCoverId(admin, entryId) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't remove that photo." };
  }
}

export interface JournalBatchAuthItem {
  localId: string;
  ok: boolean;
  path?: string;
  token?: string;
  errorMessage?: string;
}

/** Journal Photo Upload V3 — the batch half of direct browser-to-Storage
 * upload. ONE ownership check (requireOwnEntry) authorizes the WHOLE
 * selected chunk, not one Server Action round trip per photo — this is
 * the call that keeps a normal (non-HEIC) photo's binary OFF Vercel
 * entirely (see useJournalPhotoUpload's own header note on why the
 * previous server-upload-only architecture was too slow for high-volume
 * batches). createSignedUploadUrl needs no storage.objects RLS policy at
 * all (see src/lib/supabase/client.ts's own note): it's generated here
 * using the service-role client, which bypasses Storage RLS entirely, and
 * the resulting token is a short-lived (2-hour), path-scoped bearer
 * credential the browser then uses directly with uploadToSignedUrl. No
 * new Storage policy, no bucket-privacy change, no service-role exposure
 * to the browser.
 *
 * Each file's signed-URL request is caught independently (never one
 * unguarded Promise.all whose single rejection would fail the whole
 * chunk) — one photo's authorization failure can never take down its
 * chunk-mates, the exact bug the previous direct-upload attempt had. */
export async function authorizeJournalPhotoUploadBatch(
  entryId: string,
  files: { localId: string; extension: "jpg" | "png" }[]
): Promise<{ results: JournalBatchAuthItem[] } | { error: string }> {
  const perfStart = Date.now();
  try {
    const ownStart = Date.now();
    const { admin, userId } = await requireOwnEntry(entryId);
    const ownMs = Date.now() - ownStart;
    if (files.length === 0) return { results: [] };
    if (files.length > 40) return { error: "Too many photos in one batch." };

    const signStart = Date.now();
    const results = await Promise.all(
      files.map(async (f): Promise<JournalBatchAuthItem> => {
        try {
          const ext = f.extension === "png" ? "png" : "jpg";
          const path = `journal/${userId}/${entryId}/${randomUUID()}.${ext}`;
          const { data, error } = await admin.storage.from(JOURNAL_MEDIA_BUCKET).createSignedUploadUrl(path);
          if (error || !data) throw new Error(error?.message ?? "Couldn't authorize that upload.");
          return { localId: f.localId, ok: true, path: data.path, token: data.token };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Couldn't authorize that upload.";
          console.error("[journal] authorizeJournalPhotoUploadBatch item failed", { entryId, localId: f.localId, message });
          return { localId: f.localId, ok: false, errorMessage: message };
        }
      })
    );
    // Performance V3.1 — temporary timing breakdown, phone QA has no
    // desktop DevTools; safe to remove once finalize/authorize latency is
    // confirmed fixed by real-device QA. No secrets in these lines.
    console.log("[journal] authorizeJournalPhotoUploadBatch perf", {
      entryId,
      fileCount: files.length,
      ownMs,
      signMs: Date.now() - signStart,
      totalMs: Date.now() - perfStart,
    });
    return { results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't authorize uploads.";
    console.error("[journal] authorizeJournalPhotoUploadBatch failed", { entryId, fileCount: files.length, message, totalMs: Date.now() - perfStart });
    return { error: message };
  }
}

export interface JournalBatchFinalizeItem {
  localId: string;
  ok: boolean;
  mediaId?: string;
  url?: string;
  /** Whether this photo is the Moment's cover (explicit is_cover). */
  isCover?: boolean;
  errorMessage?: string;
}

/** The metadata-only half of direct upload — called once the browser has
 * already PUT a chunk's bytes straight to Storage via uploadToSignedUrl.
 * Never trusts a client-supplied storagePath at face value: each must fall
 * inside this exact user's own namespace for this exact entry (the same
 * prefix authorizeJournalPhotoUploadBatch always generates), or that one
 * item is rejected before any row is written — never the whole batch.
 *
 * Performance V3.1 — real Android QA traced a ~58s finalize for 13 photos.
 * This function previously re-verified every uploaded object with a
 * Storage list() call (plus a 400ms-delay retry whenever anything was
 * missing) before trusting it. That's removed: uploadToSignedUrl's own
 * success response IS Supabase Storage's authoritative confirmation that
 * the bytes are persisted at that exact path — not a client-side claim
 * this function needs to independently re-check. The path itself can
 * never be forged (a fresh, server-generated randomUUID under this
 * caller's OWN verified journal/{userId}/{entryId}/ namespace, authorized
 * by a short-lived, single-path-scoped signed token only this server ever
 * mints — see authorizeJournalPhotoUploadBatch's own comment), so the
 * namespace-prefix check below is still the real security boundary, fully
 * intact. What the list() check added beyond that was a size/MIME
 * recheck against a client-preprocessed image already capped by this
 * owner's own browser before upload, protecting only that owner's own
 * private folder from their own malformed upload — a self-contained,
 * low-severity risk, not a cross-user or integrity one. Removing it cuts
 * a full Storage API round trip (and its retry delay) off every finalize
 * call. A bucket-level `file_size_limit`/`allowed_mime_types` config (set
 * once via the Supabase dashboard/API, not here) would add Storage-API-
 * enforced defense-in-depth on top of this if wanted later — no code or
 * schema change needed for that, and it's out of scope for this pass.
 *
 * Idempotent against a retried/duplicated call: a row is looked up by
 * storage_path (unique per upload attempt — a fresh randomUUID every time
 * authorizeJournalPhotoUploadBatch runs) before inserting, so a lost
 * response or a duplicate Retry tap for an already-finalized photo returns
 * the existing row instead of creating a second one. No schema change or
 * uniqueness constraint was needed for this — see this module's own note
 * on why a single-owner editing session never has a true concurrent
 * double-submit race for the same path.
 *
 * Internal stage timing is logged (never signed URLs/tokens/raw user
 * data) so a slow finalize can be diagnosed from Vercel's own function
 * logs without guessing — see this pass's own QA instrumentation note. */
export async function finalizeJournalPhotoBatch(
  entryId: string,
  items: { localId: string; storagePath: string; displayOrder: number; sectionId?: string | null }[]
): Promise<{ results: JournalBatchFinalizeItem[] } | { error: string }> {
  const perfStart = Date.now();
  try {
    const ownStart = Date.now();
    const { admin, userId } = await requireOwnEntry(entryId);
    const ownMs = Date.now() - ownStart;
    if (items.length === 0) return { results: [] };
    if (items.length > 40) return { error: "Too many photos in one batch." };

    const pathValidationStart = Date.now();
    const expectedPrefix = `journal/${userId}/${entryId}/`;
    const results: JournalBatchFinalizeItem[] = [];
    const safeItems: typeof items = [];
    // Moments V2 — optional target section per photo; every one must be a
    // section of THIS Moment (the composite FK enforces it too).
    const requestedSectionIds = [...new Set(items.map((it) => it.sectionId).filter((id): id is string => typeof id === "string" && id.length > 0))];
    const validSectionIds = new Set(
      requestedSectionIds.length > 0 ? (await loadEntrySections(admin, entryId)).map((s) => s.id).filter((id) => requestedSectionIds.includes(id)) : []
    );
    for (const item of items) {
      if (item.sectionId && !validSectionIds.has(item.sectionId)) {
        results.push({ localId: item.localId, ok: false, errorMessage: "That section isn't part of this Moment." });
      } else if (!item.storagePath.startsWith(expectedPrefix) || item.storagePath.includes("..")) {
        results.push({ localId: item.localId, ok: false, errorMessage: "That upload couldn't be verified." });
      } else {
        safeItems.push(item);
      }
    }
    const pathValidationMs = Date.now() - pathValidationStart;
    if (safeItems.length === 0) return { results };

    // Idempotency check — see this function's own header note.
    const idempotencyStart = Date.now();
    const paths = safeItems.map((it) => it.storagePath);
    const { data: existingRows } = await admin
      .from("journal_entry_media")
      .select("id, storage_path, is_cover")
      .eq("journal_entry_id", entryId)
      .in("storage_path", paths);
    const mediaIdByPath = new Map<string, string>((existingRows ?? []).map((r) => [r.storage_path as string, r.id as string]));
    const coverIds = new Set<string>((existingRows ?? []).filter((r) => r.is_cover).map((r) => r.id as string));
    const idempotencyMs = Date.now() - idempotencyStart;

    const insertStart = Date.now();
    const needsInsert = safeItems.filter((it) => !mediaIdByPath.has(it.storagePath));
    if (needsInsert.length > 0) {
      // Moments V2 — explicit cover: only the position-0 photo of a Moment
      // that has NO cover yet claims it (see uploadJournalPhoto's note).
      const hasCover = await entryHasCover(admin, entryId);
      const rows = needsInsert.map((item) => {
        const displayOrder = Number.isInteger(item.displayOrder) && item.displayOrder >= 0 ? item.displayOrder : 0;
        return {
          journal_entry_id: entryId,
          storage_path: item.storagePath,
          display_order: displayOrder,
          is_cover: !hasCover && displayOrder === 0,
          ...(item.sectionId ? { section_id: item.sectionId } : {}),
        };
      });
      const { data: insertedRows, error: insertError } = await insertMediaRows(admin, rows);
      if (insertError) {
        console.error("[journal] finalizeJournalPhotoBatch insert failed", { entryId, message: insertError.message });
        for (const item of needsInsert) results.push({ localId: item.localId, ok: false, errorMessage: "Couldn't save that photo." });
      } else {
        for (const row of insertedRows ?? []) {
          mediaIdByPath.set(row.storage_path, row.id);
          if (row.is_cover) coverIds.add(row.id);
        }
      }
    }
    const insertMs = Date.now() - insertStart;

    // Image Performance V1's own batched-signed-URL pattern (see
    // lib/journal.ts's resolveSignedUrls) — ONE createSignedUrls call for
    // however many photos just got confirmed, never one per photo.
    const signedUrlStart = Date.now();
    const confirmedPaths = safeItems.filter((it) => mediaIdByPath.has(it.storagePath)).map((it) => it.storagePath);
    const { data: signedUrls } = confirmedPaths.length > 0
      ? await admin.storage.from(JOURNAL_MEDIA_BUCKET).createSignedUrls(confirmedPaths, 60 * 60)
      : { data: [] };
    const urlByPath = new Map((signedUrls ?? []).filter((s) => s.signedUrl && !s.error).map((s) => [s.path as string, s.signedUrl as string]));
    const signedUrlMs = Date.now() - signedUrlStart;

    for (const item of safeItems) {
      const mediaId = mediaIdByPath.get(item.storagePath);
      if (!mediaId) continue; // already pushed an error result above
      results.push({ localId: item.localId, ok: true, mediaId, url: urlByPath.get(item.storagePath) ?? "", isCover: coverIds.has(mediaId) });
    }

    console.log("[journal] finalizeJournalPhotoBatch perf", {
      entryId,
      itemCount: items.length,
      ownMs,
      pathValidationMs,
      idempotencyMs,
      insertMs,
      signedUrlMs,
      totalMs: Date.now() - perfStart,
    });
    return { results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't finalize those photos.";
    console.error("[journal] finalizeJournalPhotoBatch failed", { entryId, message, totalMs: Date.now() - perfStart });
    return { error: message };
  }
}

/** Cleans up a Storage object that was uploaded directly (via the signed-
 * URL path above) but never finalized into a journal_entry_media row —
 * e.g. the owner removed the photo from the grid while it was still
 * mid-upload. Never touches the database (there is no row to delete yet);
 * the same storagePath-namespace check as finalizeJournalPhotoBatch
 * prevents this from ever being pointed at a path outside the caller's
 * own entry. */
export async function discardJournalUpload(entryId: string, storagePath: string): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin, userId } = await requireOwnEntry(entryId);
    const expectedPrefix = `journal/${userId}/${entryId}/`;
    if (!storagePath.startsWith(expectedPrefix) || storagePath.includes("..")) {
      return { error: "That upload couldn't be verified." };
    }
    await admin.storage.from(JOURNAL_MEDIA_BUCKET).remove([storagePath]);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't clean up that upload." };
  }
}

// ============================================================================
// Moments V2 — photo sections foundation (media layout, explicit cover,
// captions, section CRUD). No consumer UI uses sections yet; the flat
// photo editor goes through saveJournalMediaLayout / setJournalCover.
//
// Invariants these maintain:
//   - COVER = explicit is_cover (one per Moment — journal_entry_media_one_
//     cover_idx). Never derived from position; layout saves never touch it.
//   - ORDER = one global display_order per Moment, flattened as section 1's
//     photos, section 2's, …, then unsectioned photos.
//   - A photo's section_id is NULL or a section of the SAME Moment (also
//     enforced by the composite FK in the database).
//
// Deploy-order safety: until the 20261006000000 migration reaches a given
// database, reads tolerate the missing journal_entry_sections table /
// section_id column (treated as "no sections"), and no write includes
// section_id unless a section was explicitly requested — so the flat
// editor keeps working either way.
// ============================================================================

type JournalAdminClient = Awaited<ReturnType<typeof requireOwnEntry>>["admin"];

interface MediaLayoutRow {
  id: string;
  display_order: number;
  created_at: string;
  section_id: string | null;
}

function isMissingSectionsSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /journal_entry_sections/.test(error.message ?? "");
}

/** This Moment's sections in display order (ties: creation time). */
async function loadEntrySections(admin: JournalAdminClient, entryId: string): Promise<JournalEntrySectionRow[]> {
  const { data, error } = await admin
    .from("journal_entry_sections")
    .select("*")
    .eq("journal_entry_id", entryId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingSectionsSchema(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as JournalEntrySectionRow[];
}

/** Every photo of this Moment in its current global order. select("*") so
 * this works whether or not section_id exists yet in this database. */
async function loadEntryMediaLayout(admin: JournalAdminClient, entryId: string): Promise<MediaLayoutRow[]> {
  const { data, error } = await admin.from("journal_entry_media").select("*").eq("journal_entry_id", entryId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => ({
      id: r.id as string,
      display_order: r.display_order as number,
      created_at: r.created_at as string,
      section_id: (r.section_id as string | null | undefined) ?? null,
    }))
    .sort((a, b) => a.display_order - b.display_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

async function entryHasCover(admin: JournalAdminClient, entryId: string): Promise<boolean> {
  return (await currentCoverId(admin, entryId)) !== null;
}

async function currentCoverId(admin: JournalAdminClient, entryId: string): Promise<string | null> {
  const { data } = await admin.from("journal_entry_media").select("id").eq("journal_entry_id", entryId).eq("is_cover", true).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Inserts media rows. If a concurrent upload claimed the cover between
 * the caller's "does this Moment have a cover?" check and this insert, the
 * one-cover unique index rejects the batch (23505) — retry once with no
 * row claiming the cover rather than failing the photos. */
async function insertMediaRows(
  admin: JournalAdminClient,
  rows: Record<string, unknown>[]
): Promise<{ data: { id: string; storage_path: string; is_cover: boolean }[] | null; error: { message: string } | null }> {
  const attempt = await admin.from("journal_entry_media").insert(rows).select("id, storage_path, is_cover");
  if (attempt.error?.code === "23505" && rows.some((r) => r.is_cover)) {
    const retry = await admin
      .from("journal_entry_media")
      .insert(rows.map((r) => ({ ...r, is_cover: false })))
      .select("id, storage_path, is_cover");
    return { data: (retry.data ?? null) as { id: string; storage_path: string; is_cover: boolean }[] | null, error: retry.error };
  }
  return { data: (attempt.data ?? null) as { id: string; storage_path: string; is_cover: boolean }[] | null, error: attempt.error };
}

/** Validates an optional upload target section (FormData value) against
 * this Moment. Returns null when none was requested. */
async function resolveUploadSectionId(
  admin: JournalAdminClient,
  entryId: string,
  raw: FormDataEntryValue | null
): Promise<{ id: string } | { error: string } | null> {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const sections = await loadEntrySections(admin, entryId);
  return sections.some((s) => s.id === raw) ? { id: raw } : { error: "That section isn't part of this Moment." };
}

/** Rejects media ids that belong to ANOTHER Moment; silently drops ids that
 * no longer exist at all (e.g. a photo removed while this save was in
 * flight), so a stale-but-honest client never hard-fails. */
async function screenForeignMediaIds(admin: JournalAdminClient, entryId: string, ids: string[], known: Set<string>): Promise<string | null> {
  const unknown = [...new Set(ids.filter((id) => !known.has(id)))];
  if (unknown.length === 0) return null;
  const { data } = await admin.from("journal_entry_media").select("id, journal_entry_id").in("id", unknown);
  return (data ?? []).some((r) => r.journal_entry_id !== entryId) ? "That photo isn't part of this Moment." : null;
}

/** The one layout writer. Applies an optional new section order, optional
 * per-photo section assignments and an optional photo order, then rewrites
 * every photo's display_order to the flattened global order. Only changed
 * rows are written. Never touches is_cover. Not one atomic transaction
 * (same trade-off the previous reorder accepted): a partial failure leaves
 * a recoverable order the next save rewrites completely. */
async function writeJournalMediaLayout(
  admin: JournalAdminClient,
  entryId: string,
  opts: { sectionOrder?: string[]; mediaOrder?: string[]; sectionAssignments?: Map<string, string | null> }
): Promise<{ ok: true } | { error: string }> {
  const sections = await loadEntrySections(admin, entryId);
  const sectionIds = new Set(sections.map((s) => s.id));

  let orderedSections = sections;
  if (opts.sectionOrder) {
    if (opts.sectionOrder.some((id) => !sectionIds.has(id))) return { error: "That section isn't part of this Moment." };
    const named = [...new Set(opts.sectionOrder)];
    const rest = sections.filter((s) => !named.includes(s.id));
    orderedSections = [...named.map((id) => sections.find((s) => s.id === id)!), ...rest];
    const sectionWrites = orderedSections
      .map((s, index) => ({ s, index }))
      .filter(({ s, index }) => s.display_order !== index)
      .map(({ s, index }) => admin.from("journal_entry_sections").update({ display_order: index }).eq("id", s.id).eq("journal_entry_id", entryId));
    const sectionResults = await Promise.all(sectionWrites);
    const sectionFailed = sectionResults.find((r) => r.error);
    if (sectionFailed?.error) return { error: sectionFailed.error.message };
  }

  const media = await loadEntryMediaLayout(admin, entryId);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const known = new Set(mediaById.keys());
  const referencedIds = [...(opts.mediaOrder ?? []), ...(opts.sectionAssignments ? [...opts.sectionAssignments.keys()] : [])];
  const foreign = await screenForeignMediaIds(admin, entryId, referencedIds, known);
  if (foreign) return { error: foreign };

  const assignments = new Map<string, string | null>();
  for (const [mediaId, sectionId] of opts.sectionAssignments ?? []) {
    if (!known.has(mediaId)) continue;
    if (sectionId !== null && !sectionIds.has(sectionId)) return { error: "That section isn't part of this Moment." };
    assignments.set(mediaId, sectionId);
  }

  const namedOrder = [...new Set((opts.mediaOrder ?? []).filter((id) => known.has(id)))];
  const namedSet = new Set(namedOrder);
  const baseSequence = [...namedOrder.map((id) => mediaById.get(id)!), ...media.filter((m) => !namedSet.has(m.id))];

  const effectiveSection = (m: MediaLayoutRow): string | null => {
    const sectionId = assignments.has(m.id) ? assignments.get(m.id)! : m.section_id;
    return sectionId && sectionIds.has(sectionId) ? sectionId : null;
  };
  const flattened: MediaLayoutRow[] = [
    ...orderedSections.flatMap((s) => baseSequence.filter((m) => effectiveSection(m) === s.id)),
    ...baseSequence.filter((m) => effectiveSection(m) === null),
  ];

  const mediaWrites = flattened.flatMap((m, index) => {
    const patch: { display_order?: number; section_id?: string | null } = {};
    if (m.display_order !== index) patch.display_order = index;
    if (assignments.has(m.id) && assignments.get(m.id) !== m.section_id) patch.section_id = assignments.get(m.id)!;
    if (Object.keys(patch).length === 0) return [];
    return [admin.from("journal_entry_media").update(patch).eq("id", m.id).eq("journal_entry_id", entryId)];
  });
  const mediaResults = await Promise.all(mediaWrites);
  const mediaFailed = mediaResults.find((r) => r.error);
  if (mediaFailed?.error) return { error: mediaFailed.error.message };
  return { ok: true };
}

export interface JournalMediaLayoutInput {
  /** Optional new section order (ids of this Moment's sections). Sections
   * not named keep their relative order after the named ones. */
  sectionOrder?: string[];
  /** Photos in the desired order. `sectionId` omitted = keep the photo's
   * current section; null = unsectioned; a string = that section. Photos
   * not named keep their relative order after the named ones. */
  items: { mediaId: string; sectionId?: string | null }[];
}

/** Saves section order, each photo's section membership, and the flattened
 * global photo order. Never changes the cover. */
export async function saveJournalMediaLayout(entryId: string, layout: JournalMediaLayoutInput): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const sectionAssignments = new Map<string, string | null>();
    for (const item of layout.items) {
      if (item.sectionId !== undefined) sectionAssignments.set(item.mediaId, item.sectionId);
    }
    return await writeJournalMediaLayout(admin, entryId, {
      sectionOrder: layout.sectionOrder,
      mediaOrder: layout.items.map((it) => it.mediaId),
      sectionAssignments: sectionAssignments.size > 0 ? sectionAssignments : undefined,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update photo order." };
  }
}

/** Makes one photo the Moment's cover without moving it: its position and
 * section stay exactly as they are. Clears the old cover first so the
 * one-cover unique index never sees two. */
export async function setJournalCover(entryId: string, mediaId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const { data: media } = await admin.from("journal_entry_media").select("id, is_cover").eq("id", mediaId).eq("journal_entry_id", entryId).maybeSingle();
    if (!media) return { error: "That photo isn't part of this Moment." };
    if (media.is_cover) return { ok: true };
    const { error: clearError } = await admin.from("journal_entry_media").update({ is_cover: false }).eq("journal_entry_id", entryId).eq("is_cover", true);
    if (clearError) return { error: clearError.message };
    const { error: setError } = await admin.from("journal_entry_media").update({ is_cover: true }).eq("id", mediaId).eq("journal_entry_id", entryId);
    if (setError) return { error: setError.message };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't set the cover." };
  }
}

/** Saves one photo's caption (trimmed; empty = no caption). */
export async function saveJournalMediaCaption(entryId: string, mediaId: string, caption: string | null): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const value = typeof caption === "string" ? caption.trim() : "";
    if (value.length > JOURNAL_PHOTO_CAPTION_MAX) return { error: `Keep photo notes under ${JOURNAL_PHOTO_CAPTION_MAX} characters.` };
    const { data, error } = await admin
      .from("journal_entry_media")
      .update({ caption: value.length > 0 ? value : null })
      .eq("id", mediaId)
      .eq("journal_entry_id", entryId)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: "That photo isn't part of this Moment." };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't save that note." };
  }
}

function cleanSectionText(value: string | null | undefined, max: number, label: string): { value: string | null } | { error: string } {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > max) return { error: `Keep the section ${label} under ${max} characters.` };
  return { value: trimmed.length > 0 ? trimmed : null };
}

export interface JournalSectionInput {
  sectionType: string;
  title?: string | null;
  notes?: string | null;
}

/** Adds an (empty) section at the end of this Moment's sections. */
export async function createJournalSection(
  entryId: string,
  input: JournalSectionInput
): Promise<{ section: JournalEntrySectionRow } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    if (!isJournalSectionType(input.sectionType)) return { error: "Choose a section type." };
    const title = cleanSectionText(input.title, JOURNAL_SECTION_TITLE_MAX, "title");
    if ("error" in title) return title;
    const notes = cleanSectionText(input.notes, JOURNAL_SECTION_NOTES_MAX, "note");
    if ("error" in notes) return notes;
    const existing = await loadEntrySections(admin, entryId);
    const nextOrder = existing.reduce((max, s) => Math.max(max, s.display_order + 1), 0);
    const { data, error } = await admin
      .from("journal_entry_sections")
      .insert({ journal_entry_id: entryId, section_type: input.sectionType, title: title.value, notes: notes.value, display_order: nextOrder })
      .select("*")
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't add that section." };
    return { section: data as JournalEntrySectionRow };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't add that section." };
  }
}

/** Updates a section's type, title and/or note — only the fields given. */
export async function updateJournalSection(
  entryId: string,
  sectionId: string,
  patch: Partial<JournalSectionInput>
): Promise<{ section: JournalEntrySectionRow } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const update: { section_type?: string; title?: string | null; notes?: string | null } = {};
    if (patch.sectionType !== undefined) {
      if (!isJournalSectionType(patch.sectionType)) return { error: "Choose a section type." };
      update.section_type = patch.sectionType;
    }
    if (patch.title !== undefined) {
      const title = cleanSectionText(patch.title, JOURNAL_SECTION_TITLE_MAX, "title");
      if ("error" in title) return title;
      update.title = title.value;
    }
    if (patch.notes !== undefined) {
      const notes = cleanSectionText(patch.notes, JOURNAL_SECTION_NOTES_MAX, "note");
      if ("error" in notes) return notes;
      update.notes = notes.value;
    }
    const query =
      Object.keys(update).length > 0
        ? admin.from("journal_entry_sections").update(update).eq("id", sectionId).eq("journal_entry_id", entryId).select("*")
        : admin.from("journal_entry_sections").select("*").eq("id", sectionId).eq("journal_entry_id", entryId);
    const { data, error } = await query;
    if (error) return { error: error.message };
    const section = data?.[0];
    if (!section) return { error: "That section isn't part of this Moment." };
    return { section: section as JournalEntrySectionRow };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update that section." };
  }
}

/** Reorders this Moment's sections and re-flattens the global photo order
 * to match. */
export async function reorderJournalSections(entryId: string, orderedSectionIds: string[]): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    return await writeJournalMediaLayout(admin, entryId, { sectionOrder: orderedSectionIds });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't reorder sections." };
  }
}

/** Deletes a section. Its photos are never deleted: the database clears
 * their section_id (ON DELETE SET NULL (section_id)), and the global order
 * is re-flattened so they sit with the other unsectioned photos. */
export async function deleteJournalSection(entryId: string, sectionId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const { data, error } = await admin.from("journal_entry_sections").delete().eq("id", sectionId).eq("journal_entry_id", entryId).select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: "That section isn't part of this Moment." };
    return await writeJournalMediaLayout(admin, entryId, {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't delete that section." };
  }
}

export interface JournalManualLocationInput {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  suggestToFindmi: boolean;
}

/** Step 2 — a canonical FindMi Location (locationId) and a manually-typed
 * one (manual) are mutually exclusive by construction: whichever this call
 * receives wins, and the other side is always cleared, so a row can never
 * end up with both a real location_id AND stale manual_location_* text
 * left over from an earlier choice. Passing neither (both null) means the
 * step was skipped — both sides are cleared. `manual.suggestToFindmi` is
 * the entire "suggest this place" signal for this pass (see the
 * migration's own comment): a plain boolean on the entry, never a
 * promise, never an automatic write into public.locations. */
export async function saveJournalLocation(
  entryId: string,
  locationId: string | null,
  manual?: JournalManualLocationInput | null
): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    if (locationId) {
      if (!(await validateConnectableObject("location", locationId))) {
        return { error: "That Location couldn't be found." };
      }
      const { error } = await admin
        .from("journal_entries")
        .update({
          location_id: locationId,
          manual_location_name: null,
          manual_location_address: null,
          manual_location_city: null,
          manual_location_state: null,
          manual_location_zip: null,
          manual_location_suggested: false,
        })
        .eq("id", entryId);
      if (error) return { error: error.message };
      return { ok: true };
    }

    const hasManualText = Boolean(manual && (manual.name || manual.address || manual.city || manual.state || manual.zip));
    const { error } = await admin
      .from("journal_entries")
      .update({
        location_id: null,
        manual_location_name: hasManualText ? manual!.name : null,
        manual_location_address: hasManualText ? manual!.address : null,
        manual_location_city: hasManualText ? manual!.city : null,
        manual_location_state: hasManualText ? manual!.state : null,
        manual_location_zip: hasManualText ? manual!.zip : null,
        manual_location_suggested: hasManualText ? Boolean(manual!.suggestToFindmi) : false,
      })
      .eq("id", entryId);
    if (error) return { error: error.message };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't save that Location." };
  }
}

export interface JournalConnectionIds {
  businessIds: string[];
  productIds: string[];
  eventIds: string[];
  // Moments V2 — up to ONE specific occurrence PER connected Event (was one
  // per Moment), each additional to (never instead of) its parent Event
  // connection. An Event with no occurrence means "no specific date
  // identified," a legitimate, honest state — never guessed.
  occurrenceIds: string[];
}

/** Replace-set semantics — simplest correct model for a small, infrequently
 * -changed list: every real connection for this entry is validated fresh
 * and the full set is written atomically (delete-then-insert), rather than
 * diffing individual adds/removes. Re-selecting the same Event/occurrence
 * never creates a duplicate row — the delete-then-insert replaces the
 * entire set every time, and the DB's own unique index on
 * (journal_entry_id, event_occurrence_id) backs this as a second layer. */
export async function saveJournalConnections(entryId: string, ids: JournalConnectionIds): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);

    const checks = await Promise.all([
      ...ids.businessIds.map(async (id) => ({ id, kind: "business" as const, ok: await validateConnectableObject("business", id) })),
      ...ids.productIds.map(async (id) => ({ id, kind: "product" as const, ok: await validateConnectableObject("product", id) })),
      ...ids.eventIds.map(async (id) => ({ id, kind: "event" as const, ok: await validateConnectableObject("event", id) })),
    ]);
    const invalid = checks.find((c) => !c.ok);
    if (invalid) return { error: `That ${invalid.kind} couldn't be found.` };

    // Journal V2 Pass 2B — an occurrence connection is only ever valid
    // alongside its own parent Event connection (see this pass's own
    // locked "both relationships are meaningful" requirement) — never a
    // bare occurrence with no Event, which would be an orphan semantic
    // state (section 14's own concern, enforced here rather than trusted
    // from the client).
    const occurrenceIds = [...new Set(ids.occurrenceIds)];
    if (occurrenceIds.length > 0) {
      const { data: occs } = await admin.from("event_occurrences").select("id, event_id").in("id", occurrenceIds);
      if ((occs ?? []).length !== occurrenceIds.length) return { error: "That date couldn't be found." };
      const seenEvents = new Set<string>();
      for (const occ of occs ?? []) {
        if (!ids.eventIds.includes(occ.event_id)) return { error: "That date doesn't belong to a connected event." };
        if (seenEvents.has(occ.event_id)) return { error: "Choose one date per event." };
        seenEvents.add(occ.event_id);
      }
    }

    await admin.from("journal_entry_connections").delete().eq("journal_entry_id", entryId);
    const rows = [
      ...ids.businessIds.map((business_id) => ({ journal_entry_id: entryId, business_id })),
      ...ids.productIds.map((product_id) => ({ journal_entry_id: entryId, product_id })),
      ...ids.eventIds.map((event_id) => ({ journal_entry_id: entryId, event_id })),
      ...occurrenceIds.map((event_occurrence_id) => ({ journal_entry_id: entryId, event_occurrence_id })),
    ];
    if (rows.length > 0) {
      const { error } = await admin.from("journal_entry_connections").insert(rows);
      if (error) return { error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't save those connections." };
  }
}

export interface JournalOccurrenceOption {
  id: string;
  event_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  /** Pre-resolved local calendar date (YYYY-MM-DD) in the occurrence's own
   * timezone — see isoToLocalDateTime's own doc comment. Computed here,
   * server-side, once, rather than duplicating timezone math in the
   * client picker component. */
  localDate: string;
  /** Local start time (HH:MM) in the occurrence's own timezone. */
  localTime: string;
  location: {
    id: string;
    name: string;
    slug: string;
    city: string | null;
    state: string | null;
    logo_url: string | null;
    cover_image_url: string | null;
  } | null;
}

/** Journal V2 Pass 2B — real, picker-ready occurrences for an Event being
 * connected to a Journal entry. Deliberately backed by
 * getAllOccurrencesForEvent (lib/data.ts) rather than the discovery-facing
 * getUpcomingOccurrencesForEvent/getEffectiveEventSchedule — retrospective
 * documentation of an already-finished Event is a first-class Journal
 * requirement (see this pass's own locked product principle), never
 * filtered to "upcoming only" the way public discovery surfaces correctly
 * are. This is a Journal-specific retrieval mode, not a change to how
 * Events are discovered anywhere else. */
export async function getEventOccurrencesForJournal(eventId: string): Promise<JournalOccurrenceOption[]> {
  const occurrences = await getAllOccurrencesForEvent(eventId);
  return occurrences.map((o) => ({
    id: o.id,
    event_id: o.event_id,
    start_at: o.start_at,
    end_at: o.end_at,
    timezone: o.timezone,
    localDate: isoToLocalDateTime(o.start_at, o.timezone).slice(0, 10),
    localTime: isoToLocalDateTime(o.start_at, o.timezone).slice(11, 16),
    location: o.location
      ? {
          id: o.location.id,
          name: o.location.name,
          slug: o.location.slug,
          city: o.location.city,
          state: o.location.state,
          logo_url: o.location.logo_url,
          cover_image_url: o.location.cover_image_url,
        }
      : null,
  }));
}

/** Step 4 — the final save. Requires the entry to already have a real
 * title/date (set in Step 1); flips status to 'published' so it now
 * appears in the owner's Index and, if visibility is 'public', becomes
 * readable by anyone. */
export async function publishJournalEntry(entryId: string, visibility: "private" | "public"): Promise<{ error: string }> {
  const { admin } = await requireOwnEntry(entryId);
  const { data: entry } = await admin.from("journal_entries").select("title, entry_date").eq("id", entryId).maybeSingle();
  if (!entry?.title || !entry.entry_date) {
    return { error: "Name this Moment before publishing." };
  }
  await admin.from("journal_entries").update({ visibility, status: "published" }).eq("id", entryId);
  revalidatePath("/my-world/journal");
  revalidatePath(`/journal/${entryId}`);
  redirect(`/journal/${entryId}`);
}

/** Moments V2 — "Save Without Publishing" and "Unpublish": the one
 * not-published state a person ever sees (status draft + visibility
 * private), so nobody has to reason about status vs. visibility. */
export async function saveJournalAsDraft(entryId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const { error } = await admin.from("journal_entries").update({ status: "draft", visibility: "private" }).eq("id", entryId);
    if (error) return { error: error.message };
    revalidatePath("/my-world/journal");
    revalidatePath(`/journal/${entryId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't save that." };
  }
}

export async function deleteJournalEntryAction(entryId: string): Promise<{ error: string } | void> {
  const { admin } = await requireOwnEntry(entryId);
  const { data: mediaRows } = await admin.from("journal_entry_media").select("storage_path").eq("journal_entry_id", entryId);
  const paths = (mediaRows ?? []).map((m) => m.storage_path);
  if (paths.length > 0) await admin.storage.from(JOURNAL_MEDIA_BUCKET).remove(paths);
  // journal_entry_media/journal_entry_connections rows are removed via
  // their own `on delete cascade` FK to journal_entries — only the Storage
  // objects (which the database has no way to clean up on its own) need
  // this explicit removal above.
  const { error } = await admin.from("journal_entries").delete().eq("id", entryId);
  if (error) return { error: error.message };
  revalidatePath("/my-world/journal");
  redirect("/my-world/journal");
}
