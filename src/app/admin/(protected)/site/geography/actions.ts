"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { str } from "@/lib/admin/form-helpers";
import { runCensusImportStep, type StepResult } from "@/lib/geo/census-import";
import type { CensusDataset } from "@/lib/geo/census-format";
import { runBackfillDryRun, runBackfillApply, isCensusImportComplete, type BackfillReport, type BackfillTable } from "@/lib/geo/entity-geo-backfill";

const PATH = "/admin/site/geography";

export type ImportStepOutcome = { ok: true; step: StepResult & { next: CensusDataset | null } } | { ok: false; error: string };

/** One bounded, idempotent Census import slice (Admin only — requireAdmin
 * runs inside runCensusImportStep before anything else). The Admin page
 * calls this repeatedly until every dataset is complete. */
export async function censusImportStepAction(vintage: string, restartDataset?: CensusDataset): Promise<ImportStepOutcome> {
  try {
    const step = await runCensusImportStep({ vintage, dataset: restartDataset, restart: Boolean(restartDataset) });
    return { ok: true, step };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Import failed." };
  }
}

const KEY = /^(state|county|place|zcta):\d+$/;
const ROLES = ["primary", "includes", "within"];

export async function addProductGeographyAction(formData: FormData) {
  const admin = await requireAdminSupabase();
  const marketId = str(formData, "market_id");
  const areaId = str(formData, "market_area_id");
  const geoKey = str(formData, "geo_key")?.toLowerCase() ?? "";
  const role = str(formData, "role") ?? "primary";
  if (!marketId || !KEY.test(geoKey) || !ROLES.includes(role)) redirect(`${PATH}?error=${encodeURIComponent("Choose a Market and a valid Census key (e.g. county:34003).")}`);
  if (areaId) {
    const { data: area } = await admin.from("market_areas").select("market_id").eq("id", areaId).maybeSingle();
    if (!area || area.market_id !== marketId) redirect(`${PATH}?error=${encodeURIComponent("That Area isn't in that Market.")}`);
  }
  const { error } = await admin.from("product_geographies").insert({ market_id: marketId, market_area_id: areaId || null, geo_key: geoKey, role });
  if (error && error.code !== "23505") redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

export async function removeProductGeographyAction(formData: FormData) {
  const admin = await requireAdminSupabase();
  const id = str(formData, "id");
  if (id) await admin.from("product_geographies").delete().eq("id", id);
  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

// ── Canonical Entity Geography — backfill runner ────────────────────────
// Dry Run writes nothing; Apply writes only empty geo_* columns, in
// bounded batches, never a Market/Area/Market Request, never a guess
// (ambiguous/unresolved rows are reported, never resolved). Refuses to
// run at all unless the Census import is complete (see
// isCensusImportComplete) — see lib/geo/entity-geo-backfill.ts.
export type BackfillOutcome = { ok: true; report: BackfillReport } | { ok: false; error: string };

export async function backfillDryRunAction(table: BackfillTable): Promise<BackfillOutcome> {
  const admin = await requireAdminSupabase();
  if (!(await isCensusImportComplete(admin))) return { ok: false, error: "The Census import must be complete before the backfill can run." };
  const report = await runBackfillDryRun(admin, table);
  return { ok: true, report };
}

export async function backfillApplyAction(table: BackfillTable): Promise<BackfillOutcome> {
  const admin = await requireAdminSupabase();
  if (!(await isCensusImportComplete(admin))) return { ok: false, error: "The Census import must be complete before the backfill can run." };
  const report = await runBackfillApply(admin, table);
  revalidatePath(PATH);
  return { ok: true, report };
}
