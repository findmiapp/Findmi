import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getAllCategories } from "@/lib/admin/queries";
import { loadBrandImportCandidate } from "@/lib/admin/brand-import";
import { creatableProposal, REVIEW_ABOUT_MAX, REVIEW_NAME_MAX, REVIEW_SHORT_MAX } from "@/lib/admin/brand-import-review";
import { previewBrandCandidateResult, type BrandPreviewResult } from "@/lib/brand-images";
import {
  BRAND_IMPORT_AI_LABEL,
  BRAND_IMPORT_STATUS_LABEL,
  brandImagePreviewUnavailableLabel,
  brandImageReviewItems,
  brandImportFailureLabel,
  formatAiCost,
} from "@/lib/admin/brand-import-display";
import DeleteButton from "@/components/admin/DeleteButton";
import { createBusinessFromCandidateAction, discardBrandCandidateAction, saveBrandReviewAction } from "../../actions";
import ReviewSubmitButton from "../../ReviewSubmitButton";

export const dynamic = "force-dynamic";
// Previews re-verify ≤ 2 candidate images; Create Business re-verifies and
// stores the kept images (safe fetch, bounded) before finishing.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/** Brand Ingestion P4 — review one proposed Brand. Ready: edit + Save
 * Review, Create Business, Discard. Creating: finish an interrupted
 * creation. Created / Existing / Discarded: display only. Failed: Discard
 * (Retry stays on the batch page). */
export default async function BrandImportCandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string; candidateId: string }>;
  searchParams: Promise<{ saved?: string; created?: string; existing?: string; discarded?: string; error?: string; image_warning?: string }>;
}) {
  const { batchId, candidateId } = await params;
  const sp = await searchParams;
  if (!UUID.test(batchId) || !UUID.test(candidateId)) notFound();
  const admin = await requireAdminSupabase();
  const [candidate, categories] = await Promise.all([loadBrandImportCandidate(admin, batchId, candidateId), getAllCategories("business")]);
  if (!candidate) notFound();
  const p = candidate.proposal;
  const status = candidate.status;
  const editable = status === "ready";
  // Previews only while a decision is still open; verified, re-encoded
  // data URIs — never a hotlinked URL.
  const none: BrandPreviewResult = { preview: null, reason: null };
  const [logoPreview, coverPreview] = editable
    ? await Promise.all([
        p?.logo ? previewBrandCandidateResult(p.logo, "logo") : Promise.resolve(none),
        p?.cover ? previewBrandCandidateResult(p.cover, "cover") : Promise.resolve(none),
      ])
    : [none, none];
  const logo = logoPreview.preview;
  const cover = coverPreview.preview;
  const unavailableReason = { logo: logoPreview.reason, cover: coverPreview.reason };
  const category = p?.cat ? (categories.find((c) => c.id === p.cat)?.name ?? "Unknown category") : null;
  const cost = formatAiCost(candidate.aiEstimatedCostUsd);
  const creatable = p ? creatableProposal(p) : null;
  // Unpreviewable images default to Remove; Create waits for a saved
  // decision on them (see brandImageReviewItems).
  const { items: images, undecided: undecidedImages } = brandImageReviewItems(p, { cover, logo });
  const imageWarnings = (sp.image_warning ?? "").split(",").filter((r) => r === "logo" || r === "cover");
  const discard = discardBrandCandidateAction.bind(null, batchId, candidateId);
  const batchHref = `/admin/businesses/import/${batchId}`;

  const field = (label: string, value: React.ReactNode) => (
    <div className="border-t border-black/[0.06] py-3 first:border-t-0">
      <dt className="text-xs font-bold uppercase tracking-wide text-ink/45">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink">{value ?? <span className="text-ink/40">Not found</span>}</dd>
    </div>
  );
  const notice = (tone: "ok" | "error" | "info", text: React.ReactNode) => (
    <p
      className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
        tone === "error" ? "border-red-200 bg-red-50 text-red-700" : tone === "ok" ? "border-findmi/30 bg-findmi-50 text-findmi-700" : "border-black/10 bg-black/[0.02] text-ink/75"
      }`}
    >
      {text}
    </p>
  );
  const openBusiness = (business: { id: string; name: string } | null, heading: string) => (
    <div className="mt-5 rounded-2xl border border-black/[0.07] bg-white px-4 py-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/45">{heading}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{business?.name ?? "Business no longer available"}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {business && (
          <Link href={`/admin/businesses/${business.id}`} className="rounded-2xl bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
            Open Business
          </Link>
        )}
        <Link href={batchHref} className="text-sm font-semibold text-ink/60 hover:text-ink">
          Back To Batch
        </Link>
      </div>
    </div>
  );
  const ids = (
    <>
      <input type="hidden" name="batch_id" value={batchId} />
      <input type="hidden" name="candidate_id" value={candidateId} />
    </>
  );

  return (
    <div className="max-w-2xl">
      <Link href={batchHref} className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← Brand Import
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{p?.name ?? candidate.normalizedHost ?? "Candidate"}</h1>
      <p className="mt-1 text-sm text-ink/55">
        {BRAND_IMPORT_STATUS_LABEL[status] ?? status}
        {editable ? " · Proposed Brand profile — not on Findmi yet." : ""}
      </p>

      {sp.error && notice("error", sp.error)}
      {sp.saved && !sp.error && notice("ok", "Review saved.")}
      {sp.created && status === "created" && notice("ok", "Business created. It's pending review — not public yet.")}
      {sp.created && imageWarnings.length > 0 &&
        notice("info", `The ${imageWarnings.join(" and ")} couldn't be imported. Add ${imageWarnings.length > 1 ? "them" : "it"} from the Business page.`)}
      {sp.existing && status === "existing_business" && notice("info", "This Brand is already on Findmi — linked to the existing Business. Nothing was created.")}
      {sp.discarded && status === "discarded" && notice("info", "Candidate discarded.")}

      {status === "created" && openBusiness(candidate.createdBusiness, "Created")}
      {status === "existing_business" && openBusiness(candidate.matchedBusiness, "Existing On Findmi")}
      {status === "discarded" && notice("info", "This candidate was discarded. Nothing was created.")}
      {(status === "queued" || status === "processing") && notice("info", "This candidate is still being built. Check back from the batch page.")}

      {status === "failed" && (
        <div className="mt-5 rounded-2xl border border-black/[0.07] bg-white px-4 py-4">
          <p className="text-sm text-red-700">{brandImportFailureLabel(candidate.failureCode)}</p>
          <p className="mt-1 text-xs text-ink/50">Retry from the batch page, or discard this candidate.</p>
          <div className="mt-3">
            <DeleteButton action={discard} label="Discard Candidate" confirmMessage="Discard this candidate? Nothing is deleted, and no Business is created." />
          </div>
        </div>
      )}

      {status === "creating" && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm text-amber-900">Creation started but didn&apos;t finish. Finishing is safe — no duplicate Business will be created.</p>
          <form action={createBusinessFromCandidateAction} className="mt-3">
            {ids}
            <ReviewSubmitButton label="Finish Creating" pendingLabel="Finishing…" primary />
          </form>
        </div>
      )}

      {editable && !p && notice("info", "No candidate has been built for this website.")}

      {editable && p && (
        <>
          <form action={saveBrandReviewAction} className="mt-5 space-y-4 rounded-2xl border border-black/[0.07] bg-white px-4 py-4">
            {ids}
            <input type="hidden" name="expected_updated_at" value={candidate.updatedAt} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Business Name</span>
              <input autoCapitalize="words" name="name" defaultValue={p.name ?? ""} required maxLength={REVIEW_NAME_MAX} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Primary Category</span>
              <select name="category_id" defaultValue={p.cat ?? ""} className={inputClass}>
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Website</span>
              <input autoCapitalize="none" name="website" inputMode="url" defaultValue={p.site} required maxLength={300} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Instagram</span>
              <input autoCapitalize="none" name="instagram" defaultValue={p.ig ? `@${p.ig}` : ""} placeholder="@handle" maxLength={200} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Short Description</span>
              <textarea autoCapitalize="sentences" name="short_description" defaultValue={p.sd ?? ""} rows={3} maxLength={REVIEW_SHORT_MAX} className={`${inputClass} resize-y`} />
              <span className="mt-1 block text-xs text-ink/45">Up to {REVIEW_SHORT_MAX} characters.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">About</span>
              <textarea autoCapitalize="sentences" name="about" defaultValue={p.about ?? ""} rows={6} maxLength={REVIEW_ABOUT_MAX} className={`${inputClass} resize-y`} />
              <span className="mt-1 block text-xs text-ink/45">Up to {REVIEW_ABOUT_MAX} characters.</span>
            </label>

            {images.length > 0 && (
              <fieldset className="space-y-3">
                <legend className="mb-1.5 text-sm font-medium text-ink">Images</legend>
                {images.map((img) => (
                  <div key={img.role} className="overflow-hidden rounded-xl border border-black/[0.07]" data-image-role={img.role}>
                    <p className="px-3 pt-2.5 text-xs font-bold uppercase tracking-wide text-ink/55">{img.label}</p>
                    <div className="px-3 pt-2">
                      {img.preview ? (
                        img.role === "cover" ? (
                          // eslint-disable-next-line @next/next/no-img-element -- verified, re-encoded data URI preview
                          <img src={img.preview} alt="Cover preview" className="aspect-[16/9] w-full rounded-lg bg-black/[0.03] object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element -- verified, re-encoded data URI preview
                          <img src={img.preview} alt="Logo preview" className="h-24 w-24 rounded-lg border border-black/[0.07] bg-white object-contain" />
                        )
                      ) : (
                        <div className="rounded-lg border border-dashed border-black/15 bg-black/[0.02] px-3 py-4 text-sm">
                          <p className="font-semibold text-ink/70">Preview unavailable</p>
                          <p className="mt-0.5 text-xs text-ink/50">{brandImagePreviewUnavailableLabel(img.role, unavailableReason[img.role])}</p>
                          <p className="mt-0.5 text-xs text-ink/50">It isn&apos;t kept unless you choose Keep.</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-3" role="radiogroup" aria-label={`${img.label} decision`}>
                      <label className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 px-3 text-sm font-semibold text-ink has-[:checked]:border-findmi has-[:checked]:bg-findmi-50 has-[:checked]:text-findmi-700">
                        <input type="radio" name={img.field} value="1" defaultChecked={img.keep} className="accent-findmi" />
                        Keep
                      </label>
                      <label className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 px-3 text-sm font-semibold text-ink has-[:checked]:border-ink/40 has-[:checked]:bg-black/[0.04]">
                        <input type="radio" name={img.field} value="0" defaultChecked={!img.keep} className="accent-ink" />
                        Remove
                      </label>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-ink/45">Kept images are re-checked and stored by Findmi when the Business is created.</p>
              </fieldset>
            )}

            <div className="border-t border-black/[0.06] pt-4 sm:flex sm:justify-end">
              <ReviewSubmitButton label="Save Review" pendingLabel="Saving…" wide />
            </div>
          </form>

          <section className="mt-6 rounded-2xl border border-findmi/30 bg-white px-4 py-4" aria-labelledby="create-business-heading">
            <p id="create-business-heading" className="text-xs font-bold uppercase tracking-wide text-findmi-700">
              Create Business
            </p>
            <p className="mt-1 text-base font-semibold text-ink">Ready to add this brand to Findmi?</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-ink/50">Status</dt>
              <dd className="text-ink">Needs Review</dd>
              <dt className="text-ink/50">Category</dt>
              <dd className="break-words text-ink">{category ?? "Not set"}</dd>
            </dl>
            {creatable && !creatable.ok ? (
              <p className="mt-3 text-sm text-ink/60">{creatable.error}</p>
            ) : undecidedImages.length > 0 ? (
              <p className="mt-3 text-sm text-ink/60">
                The {undecidedImages.join(" and ")} can&apos;t be previewed. Choose Keep or Remove above and save the review before creating.
              </p>
            ) : (
              <form action={createBusinessFromCandidateAction} className="mt-4">
                {ids}
                <p className="mb-3 text-xs text-ink/50">Save any edits before creating.</p>
                <ReviewSubmitButton label="Create Business" pendingLabel="Creating…" primary wide />
              </form>
            )}
          </section>

          <div className="mt-8 flex flex-col gap-2 border-t border-black/[0.08] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink/55">Not adding this brand?</p>
            <DeleteButton action={discard} label="Discard Candidate" confirmMessage="Discard this candidate? Nothing is deleted, and no Business is created." />
          </div>
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
