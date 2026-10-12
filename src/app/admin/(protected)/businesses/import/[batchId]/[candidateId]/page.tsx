import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getAllCategories } from "@/lib/admin/queries";
import { loadBrandImportCandidate } from "@/lib/admin/brand-import";
import { previewBrandCandidate } from "@/lib/brand-images";
import { BRAND_IMPORT_AI_LABEL, BRAND_IMPORT_STATUS_LABEL, formatAiCost } from "@/lib/admin/brand-import-display";

export const dynamic = "force-dynamic";
// Logo/cover previews re-fetch and re-verify each candidate image (safe
// fetch, ≤ 2 images, 10-minute result cache).
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Brand Ingestion P3 — read-only view of one proposed Brand. No editing,
 * creating or discarding here (P4). */
export default async function BrandImportCandidatePage({ params }: { params: Promise<{ batchId: string; candidateId: string }> }) {
  const { batchId, candidateId } = await params;
  if (!UUID.test(batchId) || !UUID.test(candidateId)) notFound();
  const admin = await requireAdminSupabase();
  const [candidate, categories] = await Promise.all([loadBrandImportCandidate(admin, batchId, candidateId), getAllCategories("business")]);
  if (!candidate) notFound();
  const p = candidate.proposal;
  // Previews: verified, re-encoded data URIs — never a hotlinked URL.
  const [logo, cover] = await Promise.all([
    p?.logo ? previewBrandCandidate(p.logo, "logo") : Promise.resolve(null),
    p?.cover ? previewBrandCandidate(p.cover, "cover") : Promise.resolve(null),
  ]);
  const category = p?.cat ? (categories.find((c) => c.id === p.cat)?.name ?? "Unknown category") : null;
  const cost = formatAiCost(candidate.aiEstimatedCostUsd);

  const field = (label: string, value: React.ReactNode) => (
    <div className="border-t border-black/[0.06] py-3 first:border-t-0">
      <dt className="text-xs font-bold uppercase tracking-wide text-ink/45">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink">{value ?? <span className="text-ink/40">Not found</span>}</dd>
    </div>
  );

  return (
    <div className="max-w-2xl">
      <Link href={`/admin/businesses/import/${batchId}`} className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← Brand Import
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{p?.name ?? candidate.normalizedHost ?? "Candidate"}</h1>
      <p className="mt-1 text-sm text-ink/55">
        {BRAND_IMPORT_STATUS_LABEL[candidate.status] ?? candidate.status} · Proposed Brand profile — not on Findmi.
      </p>

      {!p ? (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink/70">No candidate has been built for this website.</p>
      ) : (
        <>
          {(cover || logo) && (
            <div className="mt-5 overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element -- verified data URI preview
                <img src={cover} alt="Cover candidate" className="aspect-[16/9] w-full object-cover" />
              )}
              {logo && (
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- verified data URI preview */}
                  <img src={logo} alt="Logo candidate" className="h-16 w-16 rounded-xl border border-black/[0.07] object-contain" />
                  <span className="text-xs text-ink/50">Logo candidate</span>
                </div>
              )}
            </div>
          )}
          <dl className="mt-5 rounded-2xl border border-black/[0.07] bg-white px-4">
            {field("Name", p.name)}
            {field("Category", category)}
            {field("Website", p.site)}
            {field("Instagram", p.ig ? `@${p.ig}` : null)}
            {field("Short Description", p.sd)}
            {field("About", p.about)}
            {field("Location", [p.city, p.state].filter(Boolean).join(", ") || null)}
            {field("Logo Candidate", p.logo ? (logo ? "Verified" : "Found, preview unavailable") : null)}
            {field("Cover Candidate", p.cover ? (cover ? "Verified" : "Found, preview unavailable") : null)}
          </dl>
        </>
      )}

      <dl className="mt-5 rounded-2xl border border-black/[0.07] bg-white px-4">
        {field("AI", candidate.aiStatus ? BRAND_IMPORT_AI_LABEL[candidate.aiStatus] : null)}
        {field("AI Model", candidate.aiModel)}
        {field(
          "AI Tokens",
          candidate.aiInputTokens != null || candidate.aiOutputTokens != null
            ? `${(candidate.aiInputTokens ?? 0).toLocaleString()} in / ${(candidate.aiOutputTokens ?? 0).toLocaleString()} out`
            : null
        )}
        {field("Estimated AI Cost", cost)}
        {field("Attempts", String(candidate.attemptCount))}
      </dl>
    </div>
  );
}
