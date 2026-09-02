"use server";

import { requireAdmin } from "./auth";
import { getAdminSupabase } from "./supabase-admin";
import { validateImageFile } from "@/lib/imageUploadValidation";

const BUCKET = "findmi-media";

/** Uploads one image to the public findmi-media bucket and returns its
 * public URL — the same kind of URL string every image_url/logo_url/
 * cover_image_url field already stores, so no other code needs to change
 * to consume it.
 *
 * Security Pass 4 — this is a "use server" export like any admin Server
 * Action (its own importers, GalleryField.tsx/ImageField.tsx, are
 * currently admin-only, but this function has no way to know that at
 * runtime), so it independently verifies an admin session before touching
 * Storage, rather than trusting that only an already-gated admin page
 * would ever call it. Unchanged by the member-facing upload pass (see
 * uploadMemberBusinessImage in account/business/actions.ts) — this
 * function, its requireAdmin() check, and its authorization behavior are
 * exactly what they were before that pass; only the shared, auth-
 * independent file-validation rules below were moved into
 * lib/imageUploadValidation.ts so both upload paths can reuse the exact
 * same safety checks without duplicating (and risking drift in) the
 * MIME/magic-byte/size logic. */
export async function uploadImage(formData: FormData): Promise<{ url?: string; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { error: "Unauthorized." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file selected." };

  const validated = await validateImageFile(file);
  if ("error" in validated) return validated;

  const supabase = getAdminSupabase();
  if (!supabase) return { error: "Storage isn't configured on the server." };

  // Path is built entirely from server-generated values — a random UUID
  // plus the extension looked up from the validated MIME type above, never
  // anything derived from the submitted filename. The original filename
  // (arbitrary, admin-supplied) never touches the storage path at all.
  const path = `${crypto.randomUUID()}.${validated.extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
