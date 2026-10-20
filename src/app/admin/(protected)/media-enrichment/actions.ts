"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { enrichEntityImage, previewEntityImage, type MediaEnrichmentRequest, type MediaEnrichmentResult } from "@/lib/admin/media-enrichment";

/** Media Enrichment — one row: fetch the source image server-side, store
 * it through Findmi's image pipeline, write it to the existing record.
 * Admin session verified before any fetch, read or write (fails closed). */
export async function processMediaRow(req: MediaEnrichmentRequest): Promise<MediaEnrichmentResult> {
  let admin;
  try {
    admin = await requireAdminSupabase();
  } catch {
    return { ok: false, error: "Unauthorized." };
  }
  const result = await enrichEntityImage(admin, req);
  if (result.ok) {
    // The same public/admin paths the entity's own admin save revalidates.
    revalidatePath(result.publicPath);
    revalidatePath(result.adminPath);
    revalidatePath("/");
  }
  return result;
}

/** A verified preview of a source image (nothing stored). Admin only. */
export async function previewMediaRow(target: string, url: string): Promise<{ preview: string } | { error: string }> {
  try {
    await requireAdmin();
  } catch {
    return { error: "Unauthorized." };
  }
  return previewEntityImage(target, url);
}
