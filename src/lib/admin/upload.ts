"use server";

import { getAdminSupabase } from "./supabase-admin";

const BUCKET = "findmi-media";
const MAX_BYTES = 5 * 1024 * 1024;

/** Uploads one image to the public findmi-media bucket and returns its
 * public URL — the same kind of URL string every image_url/logo_url/
 * cover_image_url field already stores, so no other code needs to change
 * to consume it. */
export async function uploadImage(formData: FormData): Promise<{ url?: string; error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (!file.type.startsWith("image/")) return { error: "Only image files are supported." };
  if (file.size > MAX_BYTES) return { error: "Image must be under 5MB." };

  const supabase = getAdminSupabase();
  if (!supabase) return { error: "Storage isn't configured on the server." };

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
