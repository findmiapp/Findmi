import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getAllCategories } from "@/lib/admin/queries";
import { loadBrandImportCandidate } from "@/lib/admin/brand-import";
import { creatableProposal, REVIEW_ABOUT_MAX, REVIEW_NAME_MAX, REVIEW_SHORT_MAX } from "@/lib/admin/brand-import-review";
import { previewBrandCandidate } from "@/lib/brand-images";
import { BRAND_IMPORT_AI_LABEL, BRAND_IMPORT_STATUS_LABEL, brandImportFailureLabel, formatAiCost } from "@/lib/admin/brand-import-display";
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
  const [logo, cover] =
    editable || status === "creating"
      ? await Promise.all([
          p?.logo ? previewBrandCandidate(p.logo, "logo") : Promise.resolve(null),
          p?.cover ? previewBrandCandidate(p.cover, "cover") : Promise.resolve(null),
        ])
      : [null, null];
  const category = p?.cat ? (categories.find((c) => c.id === p.cat)?.name ?? "Unknown category") : null;
  const cost = formatAiCost(candidate.aiEstimatedCostUsd);
  const creatable = p ? creatableProposal(p) : null;
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
              <input name="name" defaultValue={p.name ?? ""} required maxLength={REVIEW_NAME_MAX} className={inputClass} />
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
              <input name="website" inputMode="url" defaultValue={p.site} required maxLength={300} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Instagram</span>
              <input name="instagram" defaultValue={p.ig ? `@${p.ig}` : ""} placeholder="@handle" maxLength={200} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Short Description</span>
              <textarea name="short_description" defaultValue={p.sd ?? ""} rows={2} maxLength={REVIEW_SHORT_MAX} className={inputClass} />
              <span className="mt-1 block text-xs text-ink/45">Up to {REVIEW_SHORT_MAX} characters.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">About</span>
              <textarea name="about" defaultValue={p.about ?? ""} rows={5} maxLength={REVIEW_ABOUT_MAX} className={inputClass} />
              <span className="mt-1 block text-xs text-ink/45">Up to {REVIEW_ABOUT_MAX} characters.</span>
            </label>

            {(p.logo || p.cover) && (
              <fieldset className="space-y-3">
                <legend className="mb-1.5 text-sm font-medium text-ink">Images</legend>
                {p.cover && (
                  <label className="block overflow-hidden rounded-xl border border-black/[0.07]">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element -- verified data URI preview
                      <img src={cover} alt="Cover candidate" className="aspect-[16/9] w-full object-cover" />
                    ) : (
                      <span className="block px-3 py-2 text-xs text-ink/50">Cover found — preview unavailable.</span>
                    )}
                    <span className="flex items-center gap-2 px-3 py-2 text-sm text-ink">
                      <input type="checkbox" name="use_cover" value="1" defaultChecked={p.useCover !== false} />
                      Keep Cover
                    </span>
                  </label>
                )}
                {p.logo && (
                  <label className="flex items-center gap-3 rounded-xl border border-black/[0.07] px-3 py-2">
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- verified data URI preview
                      <img src={logo} alt="Logo candidate" className="h-14 w-14 rounded-lg border border-black/[0.07] object-contain" />
                    ) : (
                      <span className="text-xs text-ink/50">Logo found — preview unavailable.</span>
                    )}
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" name="use_logo" value="1" defaultChecked={p.useLogo !== false} />
                      Keep Logo
                    </span>
                  </label>
                )}
                <p className="text-xs text-ink/45">Kept images are re-checked and stored by Findmi when the Business is created.</p>
              </fieldset>
            )}

            <div className="flex justify-end">
              <ReviewSubmitButton label="Save Review" pendingLabel="Saving…" />
            </div>
          </form>

          <div className="mt-5 rounded-2xl border border-black/[0.07] bg-white px-4 py-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/45">Create Business</p>
            <p className="mt-1 text-sm text-ink/70">
              Creates a pending-review Business from the <strong>saved</strong> review — no owner, location or market. Save your edits first.
              {category ? ` Category: ${category}.` : ""}
            </p>
            {creatable && !creatable.ok ? (
              <p className="mt-3 text-sm text-ink/60">{creatable.error}</p>
            ) : (
              <form action={createBusinessFromCandidateAction} className="mt-3">
                {ids}
                <ReviewSubmitButton label="Create Business" pendingLabel="Creating…" primary />
              </form>
            )}
          </div>

          <div className="mt-5 flex justify-end">
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
