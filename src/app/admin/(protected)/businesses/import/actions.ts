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
import {
  createBusinessFromCandidate,
  defaultCreateBusinessDeps,
  discardBrandCandidate,
  saveBrandReview,
  supabaseBrandReviewStore,
} from "@/lib/admin/brand-import-review";

/** Brand Ingestion P3/P4 — Admin bulk Brand Import actions. Admin-only:
 * every action verifies the admin session (requireAdminSupabase) before
 * any read or write. Processing, Save Review and Discard write only the
 * import tables. Create Business is the ONE path that writes a canonical
 * Business (lib/admin/brand-import-review.ts). */

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

// ── P4: review, discard, create ───────────────────────────────────────────

const candidatePath = (batchId: string, candidateId: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `${IMPORT_PATH}/${batchId}/${candidateId}${q ? `?${q}` : ""}`;
};
const validIds = (batchId: unknown, candidateId: unknown): batchId is string =>
  typeof batchId === "string" && typeof candidateId === "string" && UUID.test(batchId) && UUID.test(candidateId);
const field = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.slice(0, 2000) : "";
};

/** Save Review — edits only the candidate's proposal (no Business, no
 * fetch, no AI), conditional on the review the form was rendered with. */
export async function saveBrandReviewAction(formData: FormData) {
  const batchId = formData.get("batch_id");
  const candidateId = formData.get("candidate_id");
  if (!validIds(batchId, candidateId)) redirect(IMPORT_PATH);
  const admin = await requireAdminSupabase();
  let target: string;
  try {
    const categories = await getAllCategories("business");
    const result = await saveBrandReview(
      batchId,
      candidateId as string,
      field(formData, "expected_updated_at"),
      {
        name: field(formData, "name"),
        categoryId: field(formData, "category_id"),
        website: field(formData, "website"),
        instagram: field(formData, "instagram"),
        shortDescription: field(formData, "short_description"),
        about: field(formData, "about"),
        useLogo: formData.get("use_logo") === "1",
        useCover: formData.get("use_cover") === "1",
      },
      { store: supabaseBrandReviewStore(admin), businessCategoryIds: new Set(categories.map((c) => c.id)) }
    );
    target =
      result.outcome === "saved"
        ? candidatePath(batchId, candidateId as string, { saved: "1" })
        : result.outcome === "invalid"
          ? candidatePath(batchId, candidateId as string, { error: result.error })
          : result.outcome === "stale"
            ? candidatePath(batchId, candidateId as string, { error: "This review changed since you opened it. Reload to see the latest version, then edit again." })
            : candidatePath(batchId, candidateId as string, { error: "This candidate can no longer be edited." });
  } catch {
    target = candidatePath(batchId, candidateId as string, { error: "Couldn't save the review. Please try again." });
  }
  redirect(target);
}

/** Discard Candidate — ready or failed → discarded (nothing deleted). */
export async function discardBrandCandidateAction(batchId: string, candidateId: string) {
  if (!validIds(batchId, candidateId)) redirect(IMPORT_PATH);
  const admin = await requireAdminSupabase();
  let target: string;
  try {
    const result = await discardBrandCandidate(batchId, candidateId, supabaseBrandReviewStore(admin));
    target = candidatePath(batchId, candidateId, result === "discarded" ? { discarded: "1" } : { error: "Only Ready or Failed candidates can be discarded." });
  } catch {
    target = candidatePath(batchId, candidateId, { error: "Couldn't discard the candidate. Please try again." });
  }
  redirect(target);
}

/** Create Business — explicit, idempotent (candidate id = Business id),
 * final re-match first; creates a pending_review Business with no owner,
 * geography or market. Retrying after any partial failure is safe. */
export async function createBusinessFromCandidateAction(formData: FormData) {
  const batchId = formData.get("batch_id");
  const candidateId = formData.get("candidate_id");
  if (!validIds(batchId, candidateId)) redirect(IMPORT_PATH);
  const admin = await requireAdminSupabase();
  let target: string;
  try {
    const result = await createBusinessFromCandidate(batchId, candidateId as string, defaultCreateBusinessDeps(admin));
    const path = (params: Record<string, string>) => candidatePath(batchId, candidateId as string, params);
    switch (result.outcome) {
      case "created":
        target = path(result.imageWarnings.length ? { created: "1", image_warning: result.imageWarnings.join(",") } : { created: "1" });
        break;
      case "already_created":
        target = path({ created: "1" });
        break;
      case "existing_business":
        target = path({ existing: "1" });
        break;
      case "invalid":
        target = path({ error: result.error });
        break;
      case "failed":
        target = path({ error: "Creation didn't finish. It's safe to try again — no duplicate will be created." });
        break;
      default:
        target = path({ error: "This candidate can't be created in its current state." });
    }
  } catch {
    target = candidatePath(batchId, candidateId as string, { error: "Creation didn't finish. It's safe to try again — no duplicate will be created." });
  }
  redirect(target);
}
