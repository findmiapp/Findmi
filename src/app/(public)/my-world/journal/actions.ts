"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isAdminSession } from "@/lib/admin/auth";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { validateImageFile, validateConnectableObject, JOURNAL_MEDIA_BUCKET } from "@/lib/journal";
import { MAX_UPLOAD_BYTES } from "@/lib/imageUploadValidation";
import { getAllOccurrencesForEvent } from "@/lib/data";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";

// Journal Photo Upload V3 — the direct-upload path (browser -> Storage via
// a signed upload URL) never passes through validateImageFile()'s true
// byte-signature check, since the whole point is to skip the server round
// trip for the binary. finalizeJournalPhotoBatch's own post-upload
// metadata check (size + declared content-type) is the closest equivalent
// available without downloading the file back onto the server.
const ALLOWED_DIRECT_UPLOAD_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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
    if (!entry) throw new Error("That Journal Entry doesn't exist.");
    return { admin, userId: entry.user_id as string };
  }

  const user = await requireUser();
  const supabase = await getServerSupabase();
  const { data: entry } = await supabase.from("journal_entries").select("id, user_id").eq("id", entryId).maybeSingle();
  if (!entry || entry.user_id !== user.id) throw new Error("That Journal Entry doesn't exist or isn't yours.");
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
    if (!title) return { error: "Give this entry a title." };
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
    const [{ data: mediaRow, error: insertError }, { data: signed }] = await Promise.all([
      admin
        .from("journal_entry_media")
        .insert({ journal_entry_id: entryId, storage_path: path, display_order: displayOrder, is_cover: displayOrder === 0 })
        .select("id")
        .single(),
      admin.storage.from(JOURNAL_MEDIA_BUCKET).createSignedUrl(path, 60 * 60),
    ]);
    if (insertError || !mediaRow) {
      await admin.storage.from(JOURNAL_MEDIA_BUCKET).remove([path]);
      return { error: insertError?.message ?? "Couldn't save that photo." };
    }

    return { id: mediaRow.id, url: signed?.signedUrl ?? "", isCover: displayOrder === 0 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't upload that photo." };
  }
}

export async function removeJournalPhoto(entryId: string, mediaId: string): Promise<{ ok: true } | { error: string }> {
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
        .limit(1)
        .maybeSingle();
      if (next) await admin.from("journal_entry_media").update({ is_cover: true }).eq("id", next.id);
    }
    return { ok: true };
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
  try {
    const { admin, userId } = await requireOwnEntry(entryId);
    if (files.length === 0) return { results: [] };
    if (files.length > 40) return { error: "Too many photos in one batch." };

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
    return { results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't authorize uploads.";
    console.error("[journal] authorizeJournalPhotoUploadBatch failed", { entryId, fileCount: files.length, message });
    return { error: message };
  }
}

export interface JournalBatchFinalizeItem {
  localId: string;
  ok: boolean;
  mediaId?: string;
  url?: string;
  errorMessage?: string;
}

/** The metadata-only half of direct upload — called once the browser has
 * already PUT a chunk's bytes straight to Storage via uploadToSignedUrl.
 * Never trusts a client-supplied storagePath at face value: each must fall
 * inside this exact user's own namespace for this exact entry (the same
 * prefix authorizeJournalPhotoUploadBatch always generates), or that one
 * item is rejected before any row is written — never the whole batch.
 *
 * ONE list() call covers the entire chunk (every photo in it shares the
 * same folder) instead of one per photo, sorted by created_at DESCENDING
 * so this batch's brand-new objects are always found even if this entry's
 * Storage folder already holds many older ones from previous sessions —
 * a plain default (name-sorted) listing could otherwise miss them once a
 * folder holds more than one page of objects. A single retry of that same
 * batched call (never per item) absorbs a rare read-after-write gap.
 *
 * Idempotent against a retried/duplicated call: a row is looked up by
 * storage_path (unique per upload attempt — a fresh randomUUID every time
 * authorizeJournalPhotoUploadBatch runs) before inserting, so a lost
 * response or a duplicate Retry tap for an already-finalized photo returns
 * the existing row instead of creating a second one. No schema change or
 * uniqueness constraint was needed for this — see this module's own note
 * on why a single-owner editing session never has a true concurrent
 * double-submit race for the same path. */
export async function finalizeJournalPhotoBatch(
  entryId: string,
  items: { localId: string; storagePath: string; displayOrder: number }[]
): Promise<{ results: JournalBatchFinalizeItem[] } | { error: string }> {
  try {
    const { admin, userId } = await requireOwnEntry(entryId);
    if (items.length === 0) return { results: [] };
    if (items.length > 40) return { error: "Too many photos in one batch." };

    const expectedPrefix = `journal/${userId}/${entryId}/`;
    const results: JournalBatchFinalizeItem[] = [];
    const safeItems: typeof items = [];
    for (const item of items) {
      if (!item.storagePath.startsWith(expectedPrefix) || item.storagePath.includes("..")) {
        results.push({ localId: item.localId, ok: false, errorMessage: "That upload couldn't be verified." });
      } else {
        safeItems.push(item);
      }
    }
    if (safeItems.length === 0) return { results };

    const folder = `journal/${userId}/${entryId}`;
    const listOnce = () => admin.storage.from(JOURNAL_MEDIA_BUCKET).list(folder, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
    let { data: listing } = await listOnce();
    let byFilename = new Map((listing ?? []).map((f) => [f.name, f]));
    const missing = safeItems.map((it) => it.storagePath.slice(it.storagePath.lastIndexOf("/") + 1)).filter((name) => !byFilename.has(name));
    if (missing.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      ({ data: listing } = await listOnce());
      byFilename = new Map((listing ?? []).map((f) => [f.name, f]));
    }

    const verified: { item: (typeof safeItems)[number]; path: string }[] = [];
    for (const item of safeItems) {
      const filename = item.storagePath.slice(item.storagePath.lastIndexOf("/") + 1);
      const found = byFilename.get(filename);
      const size = found?.metadata?.size;
      const mimetype = found?.metadata?.mimetype;
      if (!found || size === undefined || size > MAX_UPLOAD_BYTES || !mimetype || !ALLOWED_DIRECT_UPLOAD_MIME_TYPES.has(mimetype)) {
        console.error("[journal] finalizeJournalPhotoBatch verification failed", {
          entryId,
          storagePath: item.storagePath,
          found: Boolean(found),
          size,
          mimetype,
        });
        await admin.storage.from(JOURNAL_MEDIA_BUCKET).remove([item.storagePath]);
        results.push({ localId: item.localId, ok: false, errorMessage: "That photo couldn't be verified." });
        continue;
      }
      verified.push({ item, path: item.storagePath });
    }
    if (verified.length === 0) return { results };

    // Idempotency check — see this function's own header note.
    const paths = verified.map((v) => v.path);
    const { data: existingRows } = await admin
      .from("journal_entry_media")
      .select("id, storage_path")
      .eq("journal_entry_id", entryId)
      .in("storage_path", paths);
    const mediaIdByPath = new Map<string, string>((existingRows ?? []).map((r) => [r.storage_path as string, r.id as string]));

    const needsInsert = verified.filter((v) => !mediaIdByPath.has(v.path));
    if (needsInsert.length > 0) {
      const rows = needsInsert.map(({ item, path }) => ({
        journal_entry_id: entryId,
        storage_path: path,
        display_order: Number.isInteger(item.displayOrder) && item.displayOrder >= 0 ? item.displayOrder : 0,
        is_cover: item.displayOrder === 0,
      }));
      const { data: insertedRows, error: insertError } = await admin.from("journal_entry_media").insert(rows).select("id, storage_path");
      if (insertError) {
        console.error("[journal] finalizeJournalPhotoBatch insert failed", { entryId, message: insertError.message });
        for (const { item } of needsInsert) results.push({ localId: item.localId, ok: false, errorMessage: "Couldn't save that photo." });
      } else {
        for (const row of insertedRows ?? []) mediaIdByPath.set(row.storage_path as string, row.id as string);
      }
    }

    // Image Performance V1's own batched-signed-URL pattern (see
    // lib/journal.ts's resolveSignedUrls) — ONE createSignedUrls call for
    // however many photos just got confirmed, never one per photo.
    const confirmedPaths = verified.filter((v) => mediaIdByPath.has(v.path)).map((v) => v.path);
    const { data: signedUrls } = confirmedPaths.length > 0
      ? await admin.storage.from(JOURNAL_MEDIA_BUCKET).createSignedUrls(confirmedPaths, 60 * 60)
      : { data: [] };
    const urlByPath = new Map((signedUrls ?? []).filter((s) => s.signedUrl && !s.error).map((s) => [s.path as string, s.signedUrl as string]));

    for (const { item, path } of verified) {
      const mediaId = mediaIdByPath.get(path);
      if (!mediaId) continue; // already pushed an error result above
      results.push({ localId: item.localId, ok: true, mediaId, url: urlByPath.get(path) ?? "" });
    }
    return { results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't finalize those photos.";
    console.error("[journal] finalizeJournalPhotoBatch failed", { entryId, message });
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

/** Journal Photo Experience V2 — persists the owner's current photo order
 * (drag, the fallback Move Earlier/Later/Make Cover menu, or the automatic
 * end-of-batch reconciliation after a set of uploads settles). The client
 * array is authoritative for the editing session; this call makes it
 * authoritative in the database too, for exactly the media rows it names.
 *
 * Every id in `orderedMediaIds` is re-verified against this entry before
 * anything is written — an id belonging to another entry (another user's
 * or this owner's own different entry) is silently dropped rather than
 * trusted, so this can never be used to reorder media it doesn't own.
 *
 * Cover is re-derived from position (index 0 = cover), never a separate
 * field the client sets directly — "Make Cover" is just "move to the
 * front, then call this." journal_entry_media_one_cover_idx is a unique
 * partial index (at most one is_cover=true row per entry), so every row's
 * is_cover is cleared in one pass BEFORE any row is set back to true —
 * interleaving those two would risk two rows briefly both claiming
 * is_cover=true and colliding on that index. The second pass (display_order
 * + is_cover for each row) is safe to run concurrently once phase one has
 * cleared every row, since at most one of these updates ever sets
 * is_cover=true again.
 *
 * This is deliberately NOT one atomic transaction/RPC — no migration was
 * needed for this pass (see this action's own audit note): a single owner
 * never edits the same entry concurrently from two places, so the only
 * failure window is a rare partial write that leaves a stale-but-
 * recoverable order (the next successful reorder/reconciliation overwrites
 * it completely) — never cross-entry or cross-user corruption, since every
 * update stays scoped to a verified id AND this entryId. */
export async function reorderJournalMedia(entryId: string, orderedMediaIds: string[]): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    if (orderedMediaIds.length === 0) return { ok: true };

    const { data: existing } = await admin.from("journal_entry_media").select("id").eq("journal_entry_id", entryId).in("id", orderedMediaIds);
    const validIds = new Set((existing ?? []).map((r) => r.id as string));
    const safeOrder = orderedMediaIds.filter((id) => validIds.has(id));
    if (safeOrder.length === 0) return { ok: true };

    const { error: clearError } = await admin.from("journal_entry_media").update({ is_cover: false }).eq("journal_entry_id", entryId);
    if (clearError) return { error: clearError.message };

    const results = await Promise.all(
      safeOrder.map((mediaId, index) =>
        admin.from("journal_entry_media").update({ display_order: index, is_cover: index === 0 }).eq("id", mediaId).eq("journal_entry_id", entryId)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return { error: failed.error.message };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update photo order." };
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
  // Journal V2 Pass 2B — at most one specific Event Occurrence, additional
  // to (never instead of) a parent Event connection. Null means "no
  // specific date identified," a legitimate, honest state — never guessed.
  occurrenceId: string | null;
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
    if (ids.occurrenceId) {
      const { data: occ } = await admin.from("event_occurrences").select("id, event_id").eq("id", ids.occurrenceId).maybeSingle();
      if (!occ) return { error: "That date couldn't be found." };
      if (!ids.eventIds.includes(occ.event_id)) return { error: "That date doesn't belong to a connected event." };
    }

    await admin.from("journal_entry_connections").delete().eq("journal_entry_id", entryId);
    const rows = [
      ...ids.businessIds.map((business_id) => ({ journal_entry_id: entryId, business_id })),
      ...ids.productIds.map((product_id) => ({ journal_entry_id: entryId, product_id })),
      ...ids.eventIds.map((event_id) => ({ journal_entry_id: entryId, event_id })),
      ...(ids.occurrenceId ? [{ journal_entry_id: entryId, event_occurrence_id: ids.occurrenceId }] : []),
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
    return { error: "Add a title and date before saving." };
  }
  await admin.from("journal_entries").update({ visibility, status: "published" }).eq("id", entryId);
  revalidatePath("/my-world/journal");
  revalidatePath(`/journal/${entryId}`);
  redirect(`/journal/${entryId}`);
}

export async function updateJournalVisibility(entryId: string, visibility: "private" | "public"): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    const { error } = await admin.from("journal_entries").update({ visibility }).eq("id", entryId);
    if (error) return { error: error.message };
    revalidatePath("/my-world/journal");
    revalidatePath(`/journal/${entryId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update visibility." };
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
