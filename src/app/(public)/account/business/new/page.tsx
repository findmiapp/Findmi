import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActiveMarkets, getCategories } from "@/lib/data";
import BusinessGeographyFields from "@/components/BusinessGeographyFields";
import { createMemberBusiness } from "../actions";
import {
  BRAND_SOURCE,
  SHORT_DESCRIPTION_MAX_LENGTH,
  parseBrandPrefillStatus,
  parseBrandSource,
  prefillHostLabel,
} from "@/lib/brand-candidate";
import { readBrandDraft } from "@/lib/brand-draft";
import { isStagedPathFor, previewBrandCandidateResult, stagedBrandImageUrl } from "@/lib/brand-images";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { recordBrandImagePreview } from "@/lib/brand-website-rate-limit";

export const metadata: Metadata = {
  title: "Add a Business",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached, same convention every other /account/* page uses.
export const dynamic = "force-dynamic";
// Brand Onboarding V1.1C — creation may re-host up to two verified brand
// images (each a bounded 8 s safe fetch) after the Business is created.
export const maxDuration = 30;

const ABOUT_MAX_LENGTH = 600;

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-button font-bold uppercase text-white transition hover:bg-findmi-600";

/** Native Business Onboarding Pass 2 — the smallest native "can't find
 * your business, add it" entry point. Minimal fields only (see this
 * pass's own spec) — never the old Tally onboarding form's full field
 * set. Submits to createMemberBusiness (account/business/actions.ts),
 * which does the real duplicate check + atomic create+ownership RPC;
 * this page just renders the form and whatever result that action
 * redirects back with (a plain error, or a likely-duplicate match). */
export default async function AddBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    duplicate_slug?: string;
    duplicate_name?: string;
    plan?: string;
    invite?: string;
    ref?: string;
    name?: string;
    category_id?: string;
    city?: string;
    state?: string;
    website_url?: string;
    instagram_url?: string;
    short_description?: string;
    prefill?: string;
    source?: string;
    draft?: string;
    description?: string;
    use_logo?: string;
    use_cover?: string;
    market_id?: string;
    requested_market_text?: string;
    authorized?: string;
    plan_choice?: string;
  }>;
}) {
  const {
    error,
    duplicate_slug: duplicateSlug,
    duplicate_name: duplicateName,
    plan,
    invite,
    ref,
    name: submittedName,
    category_id: submittedCategoryId,
    city: submittedCity,
    state: submittedState,
    website_url: submittedWebsiteUrl,
    instagram_url: submittedInstagramUrl,
    short_description: submittedShortDescription,
    prefill,
    source,
    draft: draftParam,
    description: submittedAbout,
    use_logo: submittedUseLogo,
    use_cover: submittedUseCover,
    market_id: submittedMarketId,
    requested_market_text: submittedRequestedMarketText,
    authorized: submittedAuthorized,
    plan_choice: submittedPlanChoice,
  } = await searchParams;
  // Join + Add Business Plan UX Alignment pass — /join's Pro card links
  // here with ?plan=pro so Pro intent is preselected instead of the
  // default Free radio. Free needs no param (it's already the default).
  // Event Creation + Pending Review UX pass — a rejected resubmission
  // round-trips its own plan_choice too (see createMemberBusiness), so
  // either source keeps Pro selected.
  const wantsPro = plan === "pro" || submittedPlanChoice === "pro";

  // Pro Invite / Complimentary Access Codes pass — /redeem/[code] links
  // here with ?invite=CODE when a signed-in-but-business-less visitor
  // needs to create a business before applying their invite. An invite
  // in play always wins over ?plan=pro: Pro here would mean Stripe
  // checkout, and an invited business should never be routed through
  // Stripe (see createMemberBusiness's own invite-first branch).
  const hasInvite = Boolean(invite);

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Preserve ?plan=pro/?invite=CODE through sign-in using the existing
    // safe `next` redirect mechanism (lib/auth/safe-redirect.ts already
    // round-trips a path's query string) — no new auth infrastructure,
    // just not dropping the query string this redirect used to hardcode
    // away.
    const params = new URLSearchParams();
    if (hasInvite) params.set("invite", invite!);
    else if (wantsPro) params.set("plan", "pro");
    // Referral Partner + Discount Foundation — preserved through sign-in
    // the same way, independent of invite/plan: a referral code and a
    // Pro Invite are separate systems and can both survive the same
    // login round-trip.
    if (ref) params.set("ref", ref);
    const query = params.toString();
    const next = `/account/business/new${query ? `?${query}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const [categories, markets] = await Promise.all([getCategories(), getActiveMarkets()]);

  // Brand Onboarding V1.1B — set only by /join/brand's website analysis
  // (lib/brand-candidate.ts). Display-only: the fields below are the
  // ordinary, editable form values and createMemberBusiness re-validates
  // everything on submit.
  const prefillStatus = parseBrandPrefillStatus(prefill);
  // Brand Onboarding presentation (source=brand from /join/brand): "Review
  // Your Brand", no Free/Pro picker (the business is created Free, exactly
  // as when no plan is chosen), Business Profile landing after creation.
  // Presentation only — an explicit ?invite= still shows its own existing
  // invite block, and a stray ?plan=pro never brings the picker back here.
  const brandOnboarding = parseBrandSource(source);
  // V1.1C — the enriched Brand Identity draft (signed, short-lived cookie,
  // verified against the CURRENT Supabase user). On a validation round-
  // trip (`error` present) the owner's own submitted values win and the
  // draft only supplies the image candidates; otherwise the draft fills
  // the editable fields. It never sets plan, authorization or ownership.
  const draft = brandOnboarding && draftParam === "1" ? await readBrandDraft(user.id) : null;
  const roundTrip = Boolean(error);
  const fromDraft = draft && !roundTrip ? draft : null;
  const values = {
    name: fromDraft ? (fromDraft.name ?? "") : (submittedName ?? ""),
    categoryId: fromDraft ? (fromDraft.cat ?? "") : (submittedCategoryId ?? ""),
    city: fromDraft ? (fromDraft.city ?? "") : (submittedCity ?? ""),
    state: fromDraft ? (fromDraft.state ?? "") : (submittedState ?? ""),
    websiteUrl: fromDraft ? fromDraft.site : (submittedWebsiteUrl ?? ""),
    instagramUrl: fromDraft ? (fromDraft.ig ? `https://www.instagram.com/${fromDraft.ig}` : "") : (submittedInstagramUrl ?? ""),
    shortDescription: fromDraft ? (fromDraft.sd ?? "") : (submittedShortDescription ?? ""),
    about: fromDraft ? (fromDraft.about ?? "") : (submittedAbout ?? ""),
  };
  // Previews: each candidate is re-fetched and re-validated server-side and
  // shown as a small re-encoded data URI — never hotlinked, never stored.
  // A candidate is offered (and selected by default) ONLY if that full
  // verification + preview succeeds; the owner can deselect it.
  // VCL A3 recovery — a candidate verified during the Build was staged in
  // Findmi storage: Review shows that verified copy directly (no second
  // third-party fetch, no preview limit), so it can't silently vanish. Only
  // an unstaged (legacy/fallback) candidate is re-verified here as before.
  const admin = draft && (draft.logoStaged || draft.coverStaged) ? getAdminSupabase() : null;
  const stagedUrl = (path: string | undefined) => (admin && path && isStagedPathFor(path, user.id) ? stagedBrandImageUrl(admin, path) : null);
  const logoStagedUrl = stagedUrl(draft?.logoStaged);
  const coverStagedUrl = stagedUrl(draft?.coverStaged);
  const needsPreview = Boolean(draft && ((draft.logo && !logoStagedUrl) || (draft.cover && !coverStagedUrl)));
  const previewsAllowed = needsPreview && !recordBrandImagePreview(user.id);
  const [logoResult, coverResult] = previewsAllowed
    ? await Promise.all([
        draft!.logo && !logoStagedUrl ? previewBrandCandidateResult(draft!.logo, "logo") : Promise.resolve(null),
        draft!.cover && !coverStagedUrl ? previewBrandCandidateResult(draft!.cover, "cover") : Promise.resolve(null),
      ])
    : [null, null];
  const logoPreview = logoStagedUrl ?? logoResult?.preview ?? null;
  const coverPreview = coverStagedUrl ?? coverResult?.preview ?? null;
  // TEMPORARY (VCL A3 root cause): whether Review actually shows the
  // candidates analysis found — reason codes only, never URLs or user ids.
  if (brandOnboarding && draftParam === "1") {
    console.info(
      JSON.stringify({
        event: "brand_review_preview",
        draft: Boolean(draft),
        logoCandidate: Boolean(draft?.logo || draft?.logoStaged),
        coverCandidate: Boolean(draft?.cover || draft?.coverStaged),
        instagram: Boolean(draft?.ig),
        previewsAllowed,
        logo: logoStagedUrl ? "staged" : draft?.logo ? (logoResult ? (logoResult.preview ? "shown" : logoResult.reason) : "not_previewed") : null,
        cover: coverStagedUrl ? "staged" : draft?.cover ? (coverResult ? (coverResult.preview ? "shown" : coverResult.reason) : "not_previewed") : null,
      })
    );
  }
  const useLogoDefault = roundTrip ? submittedUseLogo === "1" : true;
  const useCoverDefault = roundTrip ? submittedUseCover === "1" : true;
  const prefillHost = prefillHostLabel(values.websiteUrl);
  const prefillNotice =
    prefillStatus === "website"
      ? `We filled in some details from ${prefillHost ?? "your website"}. Check everything before adding your brand.`
      : prefillStatus === "unavailable"
        ? `We couldn't read ${prefillHost ?? "that website"}, so add your details below.`
        : prefillStatus === "limited"
          ? "You've built several profiles recently. Add your details below, or try again in a few minutes."
          : null;

  const geography = (
    <BusinessGeographyFields
      markets={markets}
      defaultCity={values.city}
      defaultState={values.state}
      defaultMarketId={submittedMarketId ?? ""}
      defaultRequestedMarketText={submittedRequestedMarketText ?? ""}
    />
  );

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-label font-bold uppercase text-accent">My Findmi</p>
      <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">
        {brandOnboarding ? "Review Your Brand" : "Add a Business"}
      </h1>
      {draft ? (
        <p className="mt-2 text-body text-muted">
          We found this information from your website. Review anything you&rsquo;d like to change, then add your
          brand. Findmi will review it before it appears in discovery.
        </p>
      ) : brandOnboarding ? (
        <p className="mt-2 text-body text-muted">
          Check and complete your brand&rsquo;s starting profile, then add it. You&rsquo;ll own and manage it right away,
          and Findmi will review it before it appears in discovery.
        </p>
      ) : hasInvite ? (
        <p className="mt-2 text-body text-muted">
          You&rsquo;ll own and manage it right away, and Findmi will review it before it appears in discovery.
        </p>
      ) : (
        <p className="mt-2 text-body text-muted">
          Get started free, no credit card required. You&rsquo;ll own and manage your business right away, and
          Findmi will review it before it appears in discovery. Pro is available anytime below if you want more.
        </p>
      )}

      {prefillNotice && !error && (
        <p className="mt-5 rounded-2xl bg-findmi-50 px-4 py-3 text-body text-findmi-700">{prefillNotice}</p>
      )}

      {duplicateSlug ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <p className="text-body font-semibold text-primary">
            {error ?? "We found a business that looks like a match."}
          </p>
          <p className="mt-1.5 text-body text-secondary">
            {duplicateName ?? "An existing business"} may already be on Findmi. If this is your business, claim it
            instead of creating a duplicate listing.
          </p>
          <Link
            href={`/business/${duplicateSlug}`}
            className="mt-3 flex h-11 items-center justify-center rounded-full bg-ink px-4 text-label font-bold uppercase text-white transition hover:bg-ink/85"
          >
            View {duplicateName ?? "this business"} &amp; Claim It
          </Link>
          <p className="mt-3 text-metadata text-muted">
            Not the same business?{" "}
            <a href="#add-business-form" className="font-semibold text-primary underline underline-offset-2">
              Continue creating a new one below
            </a>
            .
          </p>
        </div>
      ) : (
        error && (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>
        )
      )}

      <div id="add-business-form" className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={createMemberBusiness} className="flex flex-col gap-4">
          {brandOnboarding && <input type="hidden" name="source" value={BRAND_SOURCE} />}
          {draft && <input type="hidden" name="draft" value="1" />}

          {/* V1.1C — Brand Identity: verified logo/cover candidates, selected
              by default, deselectable. Only a checkbox is submitted; which
              image it means comes from the signed draft, never the form. */}
          {(logoPreview || coverPreview) && (
            <div className="flex flex-col gap-3">
              <p className="text-label font-bold uppercase text-subtle">Brand Identity</p>
              {logoPreview && (
                <label className="flex items-center gap-3 rounded-2xl border border-black/10 p-3">
                  <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/5 bg-white">
                    <Image src={logoPreview} alt="Logo found on your website" width={64} height={64} unoptimized className="h-full w-full object-contain" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-primary">Logo</span>
                    <span className="block text-metadata text-subtle">From your website</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-metadata font-semibold text-primary">
                    <input type="checkbox" name="use_logo" value="1" defaultChecked={useLogoDefault} className="h-5 w-5 accent-findmi" />
                    Use This Logo
                  </span>
                </label>
              )}
              {coverPreview && (
                <label className="flex flex-col gap-2 rounded-2xl border border-black/10 p-3">
                  <span className="relative block aspect-[16/9] w-full overflow-hidden rounded-xl bg-black/5">
                    <Image src={coverPreview} alt="Cover image found on your website" fill unoptimized className="object-cover" />
                  </span>
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-primary">Cover image</span>
                      <span className="block text-metadata text-subtle">From your website</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-metadata font-semibold text-primary">
                      <input type="checkbox" name="use_cover" value="1" defaultChecked={useCoverDefault} className="h-5 w-5 accent-findmi" />
                      Use This Cover
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">Business name</span>
            <input autoCapitalize="words"
              type="text"
              name="name"
              required
              defaultValue={values.name}
              placeholder="Your business name"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">Primary category</span>
            <select name="category_id" required defaultValue={values.categoryId} className={inputClass}>
              <option value="" disabled>
                Choose a category…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Geography Foundation Pass 2, corrected by the Business
              Geography Onboarding UX Correction pass — city/state (now
              required) drive a live Findmi area suggestion, shown only
              once the owner has actually typed something, instead of
              leaving them to separately solve Findmi's own taxonomy. See
              BusinessGeographyFields' own doc comment. Brand Onboarding
              (VCL A2b) shows no geography at all: a new Brand establishes
              its identity without being asked where it is based. */}
          {!brandOnboarding && geography}

          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">
              Website <span className="font-normal text-subtle">(optional)</span>
            </span>
            <input autoCapitalize="none"
              type="url"
              name="website_url"
              defaultValue={values.websiteUrl}
              placeholder="https://"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">
              Instagram <span className="font-normal text-subtle">(optional)</span>
            </span>
            <input autoCapitalize="none"
              type="url"
              name="instagram_url"
              defaultValue={values.instagramUrl}
              placeholder="https://instagram.com/…"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">
              Short description <span className="font-normal text-subtle">(optional)</span>
            </span>
            <textarea autoCapitalize="sentences"
              name="short_description"
              rows={2}
              maxLength={SHORT_DESCRIPTION_MAX_LENGTH}
              defaultValue={values.shortDescription}
              placeholder="A sentence about what you do"
              className={inputClass}
            />
            <span className="mt-1 block text-label text-subtle">Up to {SHORT_DESCRIPTION_MAX_LENGTH} characters.</span>
          </label>
          {brandOnboarding && (
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-primary">
                About <span className="font-normal text-subtle">(optional)</span>
              </span>
              <textarea autoCapitalize="sentences"
                name="description"
                rows={5}
                maxLength={ABOUT_MAX_LENGTH}
                defaultValue={values.about}
                placeholder="A few sentences about your brand"
                className={inputClass}
              />
              <span className="mt-1 block text-label text-subtle">Up to {ABOUT_MAX_LENGTH} characters. You can expand it later.</span>
            </label>
          )}

          {/* Plan choice — Native Business Onboarding Pass 3, restyled by
              the Pro Positioning pass to match /join's card treatment,
              then flipped by the P0 Safe-to-Share Acquisition pass: Free
              is now first/dominant for a normal, no-intent visitor, with
              Pro first/dominant only when `wantsPro` (explicit ?plan=pro
              or a round-tripped plan_choice) is true — see ProPlanOption/
              FreePlanOption below. Join Conversion Copy Cleanup pass —
              dropped the "basic index"/"basic listing" framing and the
              strike-through denial line, which had gone stale after Free
              gained About/Website/Instagram; Free Tier Entitlement Reset
              V1 further expanded this to the complete core presence
              (products, gallery, contact info, complete schedule,
              unlimited markets) — Free now states its own real benefits
              instead. Radio values/names and the default selection logic
              are UNCHANGED — whichever plan is dominant is also the one
              defaultChecked, and `wantsPro` alone still decides which
              that is — so createMemberBusiness (untouched) submits
              identically to before. Every bullet below is a CURRENT
              entitlement (see account/business/actions.ts's
              requireBusinessMemberWithDetails/PROFILE_FREE_COLUMNS and
              BusinessPublicView.tsx's remaining `pro &&` gates) — nothing
              promised here that doesn't already exist. Choosing Pro
              doesn't create the business as Pro directly: it's still
              created Free + pending_review first (same RPC), then this
              action immediately continues into native Stripe
              checkout for that exact business — see createMemberBusiness. */}
          {hasInvite ? (
            // Pro Invite / Complimentary Access Codes pass — an invite in
            // play replaces the Free/Pro/Stripe choice entirely: this
            // business is still created Free + pending_review first (same
            // RPC as always), then createMemberBusiness hands off to
            // /redeem/[code] to apply the invite — never to Stripe.
            <>
              <input type="hidden" name="invite" value={invite} />
              <div className="rounded-2xl border border-findmi/30 bg-findmi-50 p-4">
                <p className="text-body font-bold text-accent">Your Findmi Pro invite is ready.</p>
                <p className="mt-1.5 text-body text-accent">
                  First, add the business you want to use with Findmi below. We&rsquo;ll apply your complimentary Pro
                  access to it automatically once it&rsquo;s created. No payment required.
                </p>
              </div>
            </>
          ) : brandOnboarding ? null : (
            <div>
              {/* Business Acquisition + Stale Plan Copy Cleanup pass —
                  was unconditionally "Choose your plan", framing every
                  normal (no-intent) visitor as being asked to buy
                  software before they've created anything. The normal
                  path now reads "Get started" (Free is the obvious
                  default below, not a competing decision); explicit Pro
                  intent (?plan=pro) keeps "Choose your plan" since that
                  visitor arrived specifically to weigh the two — nothing
                  about defaultChecked/plan_choice/Stripe routing changed,
                  this is the label text only. */}
              <span className="mb-1.5 block text-body font-medium text-primary">
                {wantsPro ? "Choose your plan" : "Get started"}
              </span>
              {/* P0 Safe-to-Share Acquisition pass — the dominant/quiet
                  visual treatment and render order now both follow
                  `wantsPro` instead of Pro always being first/dominant.
                  Explicit Pro intent (?plan=pro, or a rejected
                  resubmission's own round-tripped plan_choice) is fully
                  preserved: wantsPro still drives defaultChecked exactly
                  as before, and now ALSO keeps Pro visually dominant/first
                  for that one visitor — nothing about that path changed.
                  A normal, no-intent visitor (the common case) now sees
                  Free first and dominant, with "$99/year" no longer the
                  first monetary message on the page. */}
              <div className="flex flex-col gap-3">
                {wantsPro ? (
                  <>
                    <ProPlanOption dominant />
                    <FreePlanOption dominant={false} />
                  </>
                ) : (
                  <>
                    <FreePlanOption dominant />
                    <ProPlanOption dominant={false} />
                  </>
                )}
              </div>
              <p className="mt-1.5 text-metadata text-subtle">
                Pro starts at $20/month, Managed Pro at $49/month — choose after your business is created.
              </p>

              {/* Make Pro Invite First-Class pass — a first-time vendor
                  with a complimentary code should never have to choose
                  paid Pro and land in Stripe just to get here. This is a
                  plain field inside the SAME create-business form (not a
                  separate ProInviteCodeEntry mini-form that would navigate
                  away before the business even exists) — name="invite"
                  submits alongside name/category/plan_choice/etc., and
                  createMemberBusiness's own existing invite-first branch
                  (account/business/actions.ts) already takes priority
                  over plan_choice whenever this is non-blank, regardless
                  of which Free/Pro radio is selected: the business is
                  still created via the exact same safe native RPC
                  (Free + pending_review, owner membership granted), then
                  handed off to /redeem/[code] instead of Stripe. Leaving
                  this blank changes nothing — plan_choice behaves exactly
                  as before. Collapsed by default so it stays secondary to
                  the primary Free/Pro choice above, not a third
                  competing option. */}
              <details className="group mt-3">
                <summary className="cursor-pointer text-metadata font-semibold text-muted underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                  Have a Pro Invite Code?
                </summary>
                <input autoCapitalize="none"
                  type="text"
                  name="invite"
                  placeholder="Enter Invite Code"
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
                />
                <p className="mt-1.5 text-metadata text-subtle">
                  A valid code applies complimentary Pro after your business is created. No payment required.
                </p>
              </details>
            </div>
          )}

          {/* Referral Partner + Discount Foundation — a plain field
              inside this SAME create-business form, name="ref", entirely
              independent of the Pro Invite field above: a business can
              carry both. createMemberBusiness reads this and calls
              attribute_referral() right after creating the business —
              never blocking creation on an invalid code, never itself
              deciding a discount or commission (that happens later, at
              actual Pro checkout / a real paid conversion). Pre-filled
              from ?ref=CODE (findmi.app/join?ref=CODE or a direct link)
              but still editable — the same field serves both the
              preserved-link case and manual entry. */}
          <details className="group mt-1" open={Boolean(ref)}>
            <summary className="cursor-pointer text-metadata font-semibold text-muted underline underline-offset-2 [&::-webkit-details-marker]:hidden">
              Have a Referral Code?
            </summary>
            <input autoCapitalize="none"
              type="text"
              name="ref"
              defaultValue={ref ?? ""}
              placeholder="Enter Referral Code"
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
            />
            <p className="mt-1.5 text-metadata text-subtle">
              A valid referral code may reduce the price of Findmi Pro if you upgrade.
            </p>
          </details>

          <label className="mt-1 flex items-start gap-2.5">
            <input
              type="checkbox"
              name="authorized"
              required
              defaultChecked={Boolean(submittedAuthorized)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-findmi"
            />
            <span className="text-body text-secondary">
              I confirm that I am authorized to create and manage this business on Findmi.
            </span>
          </label>

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            {brandOnboarding ? "Add My Brand" : "Create My Business"}
          </button>
          {/* Add Business Copy Compression (#19) — this restated, word for
              word, what the Free/Pro cards directly above the submit
              button already say ("No credit card required" / "Create
              your business first, then choose Pro or Managed Pro with
              monthly or annual billing"). Dropped as a pure duplicate;
              neither card's own copy, nor the plan_choice radio/pricing
              logic, changed. */}
        </form>
      </div>
    </div>
  );
}

/** P0 Safe-to-Share Acquisition pass — Pro's plan-chooser option,
 * extracted so its dominant/quiet visual treatment can be driven by a
 * prop (see the parent's own comment on why: whichever plan the visitor
 * actually wants — explicit ?plan=pro, or the normal no-intent case —
 * gets both the dominant styling AND the pre-selected radio).
 *
 * Recurring Pricing Rollout pass — this is no longer a "Findmi Pro ·
 * $99/year" card. Architecture decision for this pass: business creation
 * never chooses between Pro/Managed Pro or Monthly/Annual — that choice
 * happens once, after creation, on the canonical /upgrade/pro picker
 * (see createMemberBusiness in ../actions.ts, which redirects there
 * instead of starting Stripe checkout directly). This radio's `value`
 * stays "pro" for that exact reason: it's paid INTENT, not a Pro-specific
 * selection — createMemberBusiness's `planChoiceRaw === "pro"` check is
 * unchanged, only what happens after it changed. */
function ProPlanOption({ dominant }: { dominant: boolean }) {
  if (!dominant) {
    return (
      <label className="flex cursor-pointer flex-col gap-1.5 rounded-2xl border border-black/10 bg-mist/40 p-4 transition has-[:checked]:border-findmi has-[:checked]:bg-findmi-50 has-[:checked]:ring-1 has-[:checked]:ring-findmi/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-body font-semibold text-secondary">Want more?</p>
          <input type="radio" name="plan_choice" value="pro" className="h-4 w-4 accent-findmi" />
        </div>
        <p className="text-body font-bold text-primary">Choose a paid plan after creation</p>
        <p className="text-metadata text-muted">
          Create your business first, then choose Pro or Managed Pro with monthly or annual billing.
        </p>
      </label>
    );
  }
  return (
    <label className="relative flex cursor-pointer flex-col gap-2.5 rounded-3xl border border-findmi/40 bg-white p-4 shadow-[0_4px_20px_rgba(20,176,188,0.12)] transition has-[:checked]:ring-2 has-[:checked]:ring-findmi sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label font-bold uppercase text-accent">Choose a paid plan after creation</p>
        <input type="radio" name="plan_choice" value="pro" defaultChecked className="h-4 w-4 accent-findmi" />
      </div>
      <p className="text-body text-muted">
        Create your business first, then choose Pro or Managed Pro with monthly or annual billing.
      </p>

      <div className="rounded-2xl bg-findmi-50 p-3">
        <p className="text-body font-bold text-primary">Analytics, or let Findmi maintain it for you</p>
        <p className="mt-0.5 text-metadata font-semibold text-secondary">Pro: see what&rsquo;s working and grow it.</p>
        <p className="mt-1 text-metadata text-muted">Managed Pro: Findmi keeps your profile updated for you.</p>
      </div>

      {/* Free Tier Entitlement Reset V1 — the previous list here (Full
          Findmi Here schedule, Gallery, Contact info, Business updates,
          Custom Findmi URL) named exactly the features this reset makes
          Free; those bullets are retired. Rewritten to only the
          capabilities that are still genuinely Pro-only — see
          lib/entitlements.ts / PerformanceTab.tsx — plus Customer
          Inquiries, a separate, still-gated feature unaffected by this
          pass (see BusinessPublicView.tsx's own canInquire check). */}
      <ul className="flex flex-col gap-1.5 text-metadata text-muted">
        <PlanBullet>Performance analytics</PlanBullet>
        <PlanBullet>Discovery source &amp; QR attribution</PlanBullet>
        <PlanBullet>Follower insights</PlanBullet>
        <PlanBullet>Customer Inquiries</PlanBullet>
        <PlanBullet>Expanded discovery</PlanBullet>
      </ul>
    </label>
  );
}

/** P0 Safe-to-Share Acquisition pass — Free's plan-chooser option, same
 * extraction/reasoning as ProPlanOption above. The quiet-treatment
 * content (used when an explicit Pro visitor has Pro dominant instead) is
 * byte-identical to the small Free card that always rendered here before
 * this pass. The dominant treatment is new: Free previously never had a
 * "led with" presentation at all, since Pro was always dominant — this
 * mirrors Pro's own dominant layout (spotlight box + fuller bullet list)
 * so Free reads as a complete, legitimate primary offer, not a shrunken
 * fallback. No feature/entitlement claim here is new: every bullet is the
 * same current Free entitlement the quiet version already listed. */
function FreePlanOption({ dominant }: { dominant: boolean }) {
  if (!dominant) {
    return (
      <label className="flex cursor-pointer flex-col gap-1.5 rounded-2xl border border-black/10 bg-mist/40 p-4 transition has-[:checked]:border-findmi has-[:checked]:bg-findmi-50 has-[:checked]:ring-1 has-[:checked]:ring-findmi/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-body font-semibold text-secondary">Prefer to start free?</p>
          <input type="radio" name="plan_choice" value="free" className="h-4 w-4 accent-findmi" />
        </div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-body font-bold text-primary">Findmi Free</span>
          <span className="text-body text-subtle">· $0 · No credit card required</span>
        </p>
        {/* Free Tier Entitlement Reset V1 — was "...show your next 3
            appearances." Free's public profile shows the complete
            schedule now, not just 3. */}
        <p className="text-metadata text-muted">Create your Findmi page and show your complete upcoming schedule.</p>
        <p className="mt-1 text-metadata text-subtle">Upgrade anytime for Analytics and more.</p>
      </label>
    );
  }
  return (
    <label className="relative flex cursor-pointer flex-col gap-2.5 rounded-3xl border border-findmi/40 bg-white p-4 shadow-[0_4px_20px_rgba(20,176,188,0.12)] transition has-[:checked]:ring-2 has-[:checked]:ring-findmi sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label font-bold uppercase text-accent">Get Started Free</p>
        <input type="radio" name="plan_choice" value="free" defaultChecked className="h-4 w-4 accent-findmi" />
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-display font-bold text-primary">$0</span>
        <span className="text-metadata font-medium text-subtle">No credit card required</span>
      </p>

      <div className="rounded-2xl bg-findmi-50 p-3">
        <p className="text-body font-bold text-primary">Your Findmi page, live today</p>
        <p className="mt-0.5 text-metadata font-semibold text-secondary">Show customers who you are and where you&rsquo;ll be next.</p>
        <p className="mt-1 text-metadata text-muted">Create your business page now. Upgrade anytime, no pressure.</p>
      </div>

      {/* Free Tier Entitlement Reset V1 — was "Next 3 upcoming
          appearances" / "Up to 5 markets"; both are unlimited/complete
          Free capabilities now. Products &amp; Gallery and Contact &amp;
          Social added — also genuinely Free now, previously omitted here
          entirely. */}
      <ul className="flex flex-col gap-1.5 text-metadata text-muted">
        <PlanBullet>Business profile, products &amp; gallery</PlanBullet>
        <PlanBullet>Contact info &amp; social links</PlanBullet>
        <PlanBullet>Complete upcoming schedule</PlanBullet>
        <PlanBullet>Unlimited relevant markets</PlanBullet>
        <PlanBullet>Findmi search &amp; discovery</PlanBullet>
      </ul>
    </label>
  );
}

/** Same aqua checkmark bullet /join's PlanCard uses (join/page.tsx),
 * recreated locally rather than imported — that component lives in a
 * page file, not a shared module, and this is cheap enough not to
 * warrant a new shared abstraction (Plan UX Alignment pass). */
function PlanBullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <CheckGlyph />
      <span>{children}</span>
    </li>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-findmi-700">
      <path
        d="M4 10.5l3.5 3.5L16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
