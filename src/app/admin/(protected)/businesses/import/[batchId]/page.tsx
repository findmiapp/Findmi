import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getAllCategories } from "@/lib/admin/queries";
import { BRAND_IMPORT_MAX_ATTEMPTS, loadBrandImportBatch, type BrandImportStatus } from "@/lib/admin/brand-import";
import { runnableCandidateIds } from "@/lib/admin/brand-import-runner";
import {
  BRAND_IMPORT_AI_LABEL,
  BRAND_IMPORT_STATUS_LABEL,
  brandImportFailureLabel,
  formatAiCost,
} from "@/lib/admin/brand-import-display";
import BrandImportRunner from "../BrandImportRunner";
import RetryCandidateButton from "../RetryCandidateButton";

export const dynamic = "force-dynamic";
// Each candidate is processed by its own Server Action request from this
// page (safe fetch ≤ 8 s, AI ≤ 12 s, image checks) — well inside this.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deterministic input failures — a retry would only spend attempts.
const NOT_RETRYABLE = new Set(["invalid_input", "unsupported_site"]);
const COUNTED: BrandImportStatus[] = ["queued", "processing", "ready", "existing_business", "failed", "discarded"];

const STATUS_TONE: Record<string, string> = {
  ready: "bg-findmi-50 text-findmi-700",
  existing_business: "bg-black/[0.05] text-ink/70",
  failed: "bg-red-50 text-red-700",
  processing: "bg-amber-50 text-amber-800",
  queued: "bg-black/[0.03] text-ink/55",
};

export default async function BrandImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ skipped?: string }>;
}) {
  const { batchId } = await params;
  const { skipped } = await searchParams;
  if (!UUID.test(batchId)) notFound();
  const admin = await requireAdminSupabase();
  const [batch, categories] = await Promise.all([loadBrandImportBatch(admin, batchId), getAllCategories("business")]);
  if (!batch) notFound();
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const counts = new Map<string, number>();
  for (const c of batch.candidates) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  const skippedCount = Number.parseInt(skipped ?? "", 10);
  // Server-side, at render time: queued + abandoned (lease-expired)
  // processing candidates under the attempt limit.
  const runnableIds = runnableCandidateIds(
    batch.candidates.map((c) => ({ id: c.id, position: c.position, status: c.status, attemptCount: c.attemptCount, processingStartedAt: c.processingStartedAt })),
    Date.now()
  );
  const resumed = batch.candidates.some((c) => c.attemptCount > 0);
  const totalCost = batch.candidates.reduce((sum, c) => sum + (c.aiEstimatedCostUsd ?? 0), 0);
  const totalInput = batch.candidates.reduce((sum, c) => sum + (c.aiInputTokens ?? 0), 0);
  const totalOutput = batch.candidates.reduce((sum, c) => sum + (c.aiOutputTokens ?? 0), 0);

  return (
    <div>
      <Link href="/admin/businesses/import" className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← Import Brands
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">Brand Import</h1>
      <p className="mt-1 text-sm text-ink/55">
        Created {new Date(batch.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
        {batch.submittedCount} {batch.submittedCount === 1 ? "website" : "websites"}
      </p>

      {skippedCount > 0 && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">
          {skippedCount} duplicate {skippedCount === 1 ? "website was" : "websites were"} skipped.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-black/10 px-3 py-1 text-xs text-ink/70">Submitted {batch.submittedCount}</span>
        {COUNTED.filter((s) => s !== "discarded" || counts.get(s)).map((s) => (
          <span key={s} className="rounded-full border border-black/10 px-3 py-1 text-xs text-ink/70">
            {s === "existing_business" ? "Existing" : BRAND_IMPORT_STATUS_LABEL[s]} {counts.get(s) ?? 0}
          </span>
        ))}
        {(totalInput > 0 || totalCost > 0) && (
          <span className="rounded-full border border-black/10 px-3 py-1 text-xs text-ink/70">
            AI {totalInput.toLocaleString()} in / {totalOutput.toLocaleString()} out · Est. {formatAiCost(totalCost) ?? "—"}
          </span>
        )}
      </div>

      <BrandImportRunner runnableIds={runnableIds} resumed={resumed} />

      <ul className="mt-4 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
        {batch.candidates.map((c) => {
          const p = c.proposal;
          const failure = c.status === "failed" ? brandImportFailureLabel(c.failureCode) : null;
          const cost = formatAiCost(c.aiEstimatedCostUsd);
          return (
            <li key={c.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs tabular-nums text-ink/40">{c.position}.</span>
                  <span className="break-all text-sm font-semibold text-ink">{c.normalizedHost ?? c.submittedInput}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_TONE[c.status] ?? "bg-black/[0.03] text-ink/55"}`}>
                    {BRAND_IMPORT_STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </div>
                {c.normalizedHost && c.submittedInput !== c.normalizedHost && (
                  <p className="mt-0.5 break-all text-xs text-ink/40">Submitted: {c.submittedInput}</p>
                )}
                {p && (
                  <p className="mt-1 text-sm text-ink/80">
                    <span className="font-semibold">{p.name ?? "No name found"}</span>
                    {" · "}
                    {p.cat ? (categoryName.get(p.cat) ?? "Unknown category") : "No category"}
                    {p.sd ? <span className="block text-xs text-ink/55">{p.sd}</span> : null}
                  </p>
                )}
                {c.status === "existing_business" && c.matchedBusiness && (
                  <p className="mt-1 text-sm text-ink/80">Existing On Findmi: {c.matchedBusiness.name}</p>
                )}
                {failure && <p className="mt-1 text-xs text-red-700">{failure}</p>}
                {(c.aiStatus || cost) && (
                  <p className="mt-1 text-xs text-ink/45">
                    {c.aiStatus ? BRAND_IMPORT_AI_LABEL[c.aiStatus] : null}
                    {c.aiModel ? ` · ${c.aiModel}` : ""}
                    {cost ? ` · Est. ${cost}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {c.status === "ready" && (
                  <Link href={`/admin/businesses/import/${batch.id}/${c.id}`} className="text-xs font-bold uppercase tracking-wide text-findmi-700 hover:underline">
                    View Candidate
                  </Link>
                )}
                {c.status === "existing_business" && c.matchedBusiness && (
                  <Link href={`/admin/businesses/${c.matchedBusiness.id}`} className="text-xs font-bold uppercase tracking-wide text-findmi-700 hover:underline">
                    Open Business
                  </Link>
                )}
                {c.status === "failed" &&
                  !NOT_RETRYABLE.has(c.failureCode ?? "") &&
                  (c.attemptCount >= BRAND_IMPORT_MAX_ATTEMPTS ? (
                    <span className="text-xs text-ink/45">Retry Limit Reached</span>
                  ) : (
                    <RetryCandidateButton candidateId={c.id} />
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
