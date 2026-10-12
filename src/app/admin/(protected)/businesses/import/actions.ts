"use server";

import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { getAllCategories } from "@/lib/admin/queries";
import {
  defaultBrandImportEngine,
  planBrandImport,
  processBrandImportCandidate,
  supabaseBrandImportStore,
  type BrandImportProcessOutcome,
} from "@/lib/admin/brand-import";

/** Brand Ingestion P3 — Admin bulk Brand Import actions. Admin-only:
 * every action verifies the admin session (requireAdminSupabase) before
 * any read or write. Only the two import tables are written; Businesses
 * are only read (matching). Nothing here creates or changes a Business. */

const IMPORT_PATH = "/admin/businesses/import";
const TEXT_MAX_CHARS = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Build Brand Profiles": persist the batch + candidates quickly (no
 * fetching, no AI), then open the batch page. */
export async function createBrandImportBatchAction(formData: FormData) {
  const admin = await requireAdminSupabase();
  const raw = formData.get("websites");
  const plan = planBrandImport(typeof raw === "string" ? raw.slice(0, TEXT_MAX_CHARS) : "");
  if (!plan.ok) {
    redirect(errorRedirectUrl(IMPORT_PATH, plan.error === "empty" ? "Paste at least one website." : "Paste up to 20 websites per import."));
  }
  let batchId: string | null = null;
  try {
    batchId = await supabaseBrandImportStore(admin).createBatch(plan.candidates);
  } catch {
    batchId = null;
  }
  if (!batchId) redirect(errorRedirectUrl(IMPORT_PATH, "Couldn't create the import. Please try again."));
  redirect(`${IMPORT_PATH}/${batchId}${plan.duplicatesSkipped > 0 ? `?skipped=${plan.duplicatesSkipped}` : ""}`);
}

/** Processes ONE candidate (claim → match first → P1 core → persist).
 * Called by the batch page's runner and Retry button with only an id;
 * returns only a safe outcome (no proposal, no errors). */
export async function processBrandImportCandidateAction(
  candidateId: string
): Promise<BrandImportProcessOutcome | { outcome: "error" }> {
  if (typeof candidateId !== "string" || !UUID.test(candidateId)) return { outcome: "not_found" };
  const admin = await requireAdminSupabase();
  try {
    const engine = defaultBrandImportEngine(admin, async () =>
      (await getAllCategories("business")).map((c) => ({ id: c.id, slug: c.slug, name: c.name }))
    );
    return await processBrandImportCandidate(candidateId, {
      store: supabaseBrandImportStore(admin),
      engine,
      now: Date.now,
      log: (entry) => console.info(JSON.stringify(entry)),
    });
  } catch {
    // Store errors before a claim (the candidate is unchanged) — safe and
    // generic; nothing about the error reaches the client.
    return { outcome: "error" };
  }
}
