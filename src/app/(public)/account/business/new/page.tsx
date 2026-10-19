import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCategories } from "@/lib/data";
import BusinessGeographyFields from "@/components/BusinessGeographyFields";
import { createMemberBusiness } from "../actions";
import BrandImageInput from "./BrandImageInput";
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
import GuestCreateSubmit from "@/components/account/GuestCreateSubmit";

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
    authorized?: string;
    resume?: string;
  }>;
}) {
  const {
    error,
    duplicate_slug: duplicateSlug,
    duplicate_name: duplicateName,
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
    authorized: submittedAuthorized,
    resume,
  } = await searchParams;
  // Business Creation UX Cleanup pass — Business creation no longer asks
  // the visitor to choose a plan (see the Free value section below), so
  // an incoming ?plan=pro (e.g. an old /join/business link) is simply
  // unused now — Free is the only create-time outcome. Pro remains fully
  // available afterward from Business Manager's own Upgrade path; nothing
  // about that infrastructure changes here.

  // Pro Invite / Complimentary Access Codes pass — /redeem/[code] links
  // here with ?invite=CODE when a signed-in-but-business-less visitor
  // needs to create a business before applying their invite. This is the
  // one remaining Pro-adjacent entry point in normal creation: it never
  // asks the visitor to choose anything, it just confirms a complimentary
  // grant already in motion (see createMemberBusiness's own invite-first
  // branch) — so it stays, independent of the Free/Pro picker removed
  // elsewhere on this page.
  const hasInvite = Boolean(invite);

  // Brand Onboarding presentation (source=brand from /join/brand): "Review
  // Your Brand" and Business Profile landing after creation, instead of
  // the ordinary form's copy/redirect — the business is still created
  // Free either way. Presentation only — an explicit ?invite= still shows
  // its own existing invite block regardless of this flag. Computed before
  // the auth check below since it decides whether one is needed at all.
  const brandOnboarding = parseBrandSource(source);
  // Guest-First Creation pass — a plain Add Business / Add Brand visit
  // (no stored draft to recover) may begin and fill in the real form
  // before ever signing in; identity is required only at actual submit
  // (createMemberBusiness handles that, preserving every typed field
  // through the login round-trip). The one exception is returning to an
  // already-analyzed brand draft (source=brand&draft=1): that draft is a
  // signed cookie keyed to a specific signed-in user (readBrandDraft
  // below), so it can only be read once that identity is known — the
  // visitor already signed in earlier in that flow, so this isn't a new
  // guest-facing gate, just this read's own precondition.
  const needsAuthForDraft = brandOnboarding && draftParam === "1";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && needsAuthForDraft) {
    const params = new URLSearchParams();
    if (hasInvite) params.set("invite", invite!);
    if (ref) params.set("ref", ref);
    params.set("source", BRAND_SOURCE);
    params.set("draft", "1");
    const query = params.toString();
    const next = `/account/business/new${query ? `?${query}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const categories = await getCategories();

  // Brand Onboarding V1.1B — set only by /join/brand's website analysis
  // (lib/brand-candidate.ts). Display-only: the fields below are the
  // ordinary, editable form values and createMemberBusiness re-validates
  // everything on submit.
  const prefillStatus = parseBrandPrefillStatus(prefill);
  // V1.1C — the enriched Brand Identity draft (signed, short-lived cookie,
  // verified against the CURRENT Supabase user). On a validation round-
  // trip (`error` present) the owner's own submitted values win and the
  // draft only supplies the image candidates; otherwise the draft fills
  // the editable fields. It never sets plan, authorization or ownership.
  // `user!` is safe here: needsAuthForDraft already redirected above when
  // this same condition held and no user was signed in.
  const draft = needsAuthForDraft ? await readBrandDraft(user!.id) : null;
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
    // Brand Review has one description: About falls back to the short
    // description the Build found when it found no longer About text.
    about: fromDraft ? (fromDraft.about ?? fromDraft.sd ?? "") : (submittedAbout ?? ""),
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
  // `user!` is safe here too — both are only reached when `draft` is set,
  // which itself only happens when needsAuthForDraft already guaranteed a
  // signed-in user above.
  const stagedUrl = (path: string | undefined) => (admin && path && isStagedPathFor(path, user!.id) ? stagedBrandImageUrl(admin, path) : null);
  const logoStagedUrl = stagedUrl(draft?.logoStaged);
  const coverStagedUrl = stagedUrl(draft?.coverStaged);
  const needsPreview = Boolean(draft && ((draft.logo && !logoStagedUrl) || (draft.cover && !coverStagedUrl)));
  const previewsAllowed = needsPreview && !recordBrandImagePreview(user!.id);
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
          : prefillStatus === "blocked"
            ? `${prefillHost ?? "This website"} doesn't let Findmi read it automatically. You can still add the brand details yourself.`
            : null;

  const geography = <BusinessGeographyFields defaultCity={values.city} defaultState={values.state} />;

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
          Findmi will review it before it appears in discovery.
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
        <form id="create-business-form" action={createMemberBusiness} className="flex flex-col gap-4">
          {brandOnboarding && <input type="hidden" name="source" value={BRAND_SOURCE} />}
          {draft && <input type="hidden" name="draft" value="1" />}

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

          {/* Business Creation UX Cleanup pass — factual City/State only;
              no Findmi Market/Area UI at all (see BusinessGeographyFields'
              own doc comment). Brand Onboarding (VCL A2b) shows no
              geography at all: a new Brand establishes its identity
              without being asked where it is based. */}
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
          {/* Final Brand Build V1 UX cleanup — Logo and Cover Image are
              ALWAYS shown on Brand Review: the verified image found by the
              Build (preview + "Use This …" + Replace), or a clear empty
              state with Add Logo / Add Cover Image. A missing extracted
              image never removes the field. */}
          {brandOnboarding && (
            <div className="flex flex-col gap-3">
              <BrandImageInput role="logo" label="Logo" foundPreview={logoPreview} useName="use_logo" useDefault={useLogoDefault} fileName="logo_file" />
              <BrandImageInput role="cover" label="Cover Image" foundPreview={coverPreview} useName="use_cover" useDefault={useCoverDefault} fileName="cover_file" />
            </div>
          )}
          {/* Final Brand Build V1 UX cleanup — Brand onboarding reviews ONE
              description (About, below); Short Description stays on normal
              creation and in Business Manager, unchanged. */}
          {!brandOnboarding && (
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
          )}
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

          {/* Business Creation UX Cleanup pass — replaces the former
              Free/Pro plan-choice radio (ProPlanOption/FreePlanOption,
              $20/month Pro · $49/month Managed Pro, "Want more?"/"Choose
              a paid plan after creation") with a single Free value
              section: creating and using a Findmi Business Page is free
              right now, and this form never asks the visitor to choose a
              plan. createMemberBusiness is untouched — no plan_choice
              field is submitted at all, so every normal creation takes
              the exact same "created Free, land on the business
              workspace" path that function already has for a Free
              choice; Stripe/Pro checkout infrastructure, /upgrade/pro and
              Business Manager's own Plan & Status tab are unaffected and
              still let an existing business upgrade later. Every bullet
              below is a CURRENT Free entitlement (see
              account/business/actions.ts's requireBusinessMemberWithDetails/
              PROFILE_FREE_COLUMNS, business/location-actions.ts,
              qr-manager-actions.ts and moment-authorship.ts — none of
              which gate on isBusinessPro) — nothing promised here that
              doesn't already exist. Performance analytics, Discovery
              source & QR attribution, Follower insights and Customer
              Inquiries remain genuinely Pro-only (BusinessPublicView.tsx's
              `pro &&` gates) and are deliberately not claimed below. */}
          {hasInvite ? (
            // Pro Invite / Complimentary Access Codes pass — an invite in
            // play never asks the visitor to choose anything: this
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
            <div className="relative flex flex-col gap-2.5 rounded-3xl border border-findmi/40 bg-white p-4 shadow-[0_4px_20px_rgba(20,176,188,0.12)] sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-label font-bold uppercase text-accent">Get Started Free</p>
                <p className="flex items-baseline gap-1.5">
                  <span className="font-display text-display font-bold text-primary">$0</span>
                  <span className="text-metadata font-medium text-subtle">No credit card required</span>
                </p>
              </div>
              <p className="text-body text-muted">Everything you need to show up on Findmi.</p>
              <ul className="flex flex-col gap-1.5 text-metadata text-muted">
                <PlanBullet>Your complete Business Page</PlanBullet>
                <PlanBullet>Products, photos, links &amp; contact info</PlanBullet>
                <PlanBullet>Events &amp; your upcoming schedule</PlanBullet>
                <PlanBullet>Locations, stockists &amp; where to find you</PlanBullet>
                <PlanBullet>Moments from your real-world activity</PlanBullet>
                <PlanBullet>Findmi search &amp; discovery</PlanBullet>
              </ul>
              <p className="mt-0.5 text-metadata text-subtle">Free. No trial. No credit card.</p>
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

          <GuestCreateSubmit
            formId="create-business-form"
            label={brandOnboarding ? "Add My Brand" : "Create My Business"}
            title={brandOnboarding ? "Your Brand Is Ready" : "Your Business Page Is Ready"}
            body="Create your free Findmi account to publish it, manage it and keep everything you've created."
            authed={Boolean(user)}
            resume={resume === "1"}
            className={`mt-2 ${primaryButtonClass}`}
          />
        </form>
      </div>
    </div>
  );
}

/** Business Creation UX Cleanup pass — the Free value section's bullet,
 * same aqua checkmark /join's PlanCard uses (join/page.tsx), recreated
 * locally rather than imported — that component lives in a page file,
 * not a shared module, and this is cheap enough not to warrant a new
 * shared abstraction. */
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
