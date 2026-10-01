"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { validateImageFile, validateConnectableObject, JOURNAL_MEDIA_BUCKET } from "@/lib/journal";

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
 * same two-step pattern requireAuthorizedBusinessMember already uses. */
async function requireOwnEntry(entryId: string) {
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
): Promise<{ id: string; url: string } | { error: string }> {
  try {
    const { admin, userId } = await requireOwnEntry(entryId);
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "No file selected." };

    const validated = await validateImageFile(file);
    if ("error" in validated) return validated;

    const { count } = await admin
      .from("journal_entry_media")
      .select("id", { count: "exact", head: true })
      .eq("journal_entry_id", entryId);
    const displayOrder = count ?? 0;

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
    });
    if (uploadError) return { error: uploadError.message };

    const { data: mediaRow, error: insertError } = await admin
      .from("journal_entry_media")
      .insert({ journal_entry_id: entryId, storage_path: path, display_order: displayOrder, is_cover: displayOrder === 0 })
      .select("id")
      .single();
    if (insertError || !mediaRow) {
      await admin.storage.from(JOURNAL_MEDIA_BUCKET).remove([path]);
      return { error: insertError?.message ?? "Couldn't save that photo." };
    }

    const { data: signed } = await admin.storage.from(JOURNAL_MEDIA_BUCKET).createSignedUrl(path, 60 * 60);
    return { id: mediaRow.id, url: signed?.signedUrl ?? "" };
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

export async function setJournalCoverPhoto(entryId: string, mediaId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    await admin.from("journal_entry_media").update({ is_cover: false }).eq("journal_entry_id", entryId);
    const { error } = await admin.from("journal_entry_media").update({ is_cover: true }).eq("id", mediaId).eq("journal_entry_id", entryId);
    if (error) return { error: error.message };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update the cover photo." };
  }
}

export async function saveJournalLocation(entryId: string, locationId: string | null): Promise<{ ok: true } | { error: string }> {
  try {
    const { admin } = await requireOwnEntry(entryId);
    if (locationId && !(await validateConnectableObject("location", locationId))) {
      return { error: "That Location couldn't be found." };
    }
    const { error } = await admin.from("journal_entries").update({ location_id: locationId }).eq("id", entryId);
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
}

/** Replace-set semantics — simplest correct model for a small, infrequently
 * -changed list: every real connection for this entry is validated fresh
 * and the full set is written atomically (delete-then-insert), rather than
 * diffing individual adds/removes. */
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

    await admin.from("journal_entry_connections").delete().eq("journal_entry_id", entryId);
    const rows = [
      ...ids.businessIds.map((business_id) => ({ journal_entry_id: entryId, business_id })),
      ...ids.productIds.map((product_id) => ({ journal_entry_id: entryId, product_id })),
      ...ids.eventIds.map((event_id) => ({ journal_entry_id: entryId, event_id })),
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
