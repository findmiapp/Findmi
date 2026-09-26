import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActiveMarkets, getCategories } from "@/lib/data";
import BusinessGeographyFields from "@/components/BusinessGeographyFields";
import { createMemberBusiness } from "../actions";

export const metadata: Metadata = {
  title: "Add a Business",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached, same convention every other /account/* page uses.
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

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

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">My Findmi</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Add a Business</h1>
      {hasInvite ? (
        <p className="mt-2 text-sm text-ink/60">
          You&rsquo;ll own and manage it right away, and Findmi will review it before it appears in discovery.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink/60">
          Get started free — no credit card required. You&rsquo;ll own and manage your business right away, and
          Findmi will review it before it appears in discovery. Pro is available anytime below if you want more.
        </p>
      )}

      {duplicateSlug ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink">
            {error ?? "We found a business that looks like a match."}
          </p>
          <p className="mt-1.5 text-sm text-ink/70">
            {duplicateName ?? "An existing business"} may already be on Findmi. If this is your business, claim it
            instead of creating a duplicate listing.
          </p>
          <Link
            href={`/business/${duplicateSlug}`}
            className="mt-3 flex h-11 items-center justify-center rounded-full bg-ink px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            View {duplicateName ?? "this business"} &amp; Claim It
          </Link>
          <p className="mt-3 text-xs text-ink/50">
            Not the same business?{" "}
            <a href="#add-business-form" className="font-semibold text-ink underline underline-offset-2">
              Continue creating a new one below
            </a>
            .
          </p>
        </div>
      ) : (
        error && (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )
      )}

      <div id="add-business-form" className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={createMemberBusiness} className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Business name</span>
            <input
              type="text"
              name="name"
              required
              defaultValue={submittedName ?? ""}
              placeholder="Your business name"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Primary category</span>
            <select name="category_id" required defaultValue={submittedCategoryId ?? ""} className={inputClass}>
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
              BusinessGeographyFields' own doc comment. */}
          <BusinessGeographyFields
            markets={markets}
            defaultCity={submittedCity ?? ""}
            defaultState={submittedState ?? ""}
            defaultMarketId={submittedMarketId ?? ""}
            defaultRequestedMarketText={submittedRequestedMarketText ?? ""}
          />

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">
              Website <span className="font-normal text-ink/40">(optional)</span>
            </span>
            <input
              type="url"
              name="website_url"
              defaultValue={submittedWebsiteUrl ?? ""}
              placeholder="https://"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">
              Instagram <span className="font-normal text-ink/40">(optional)</span>
            </span>
            <input
              type="url"
              name="instagram_url"
              defaultValue={submittedInstagramUrl ?? ""}
              placeholder="https://instagram.com/…"
              className={inputClass}
            />
          </label>

          {/* Plan choice — Native Business Onboarding Pass 3, restyled by
              the Pro Positioning pass to match /join's card treatment,
              then flipped by the P0 Safe-to-Share Acquisition pass: Free
              is now first/dominant for a normal, no-intent visitor, with
              Pro first/dominant only when `wantsPro` (explicit ?plan=pro
              or a round-tripped plan_choice) is true — see ProPlanOption/
              FreePlanOption below. Join Conversion Copy Cleanup pass —
              dropped the "basic index"/"basic listing" framing and the
              strike-through denial line, which had gone stale after Free
              gained About/Website/Instagram/3 appearances/5 markets; Free
              now states its own real benefits instead. Radio values/names
              and the default selection logic are UNCHANGED — whichever
              plan is dominant is also the one defaultChecked, and
              `wantsPro` alone still decides which that is — so
              createMemberBusiness (untouched) submits identically to
              before. Every bullet below is a CURRENT
              entitlement (see account/business/actions.ts's
              PROFILE_FREE_COLUMNS/PROFILE_PRO_COLUMNS/LINKS_COLUMNS and
              business/[slug]/page.tsx's own `pro &&` gates) — nothing
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
                <p className="text-sm font-bold text-findmi-700">Your Findmi Pro invite is ready.</p>
                <p className="mt-1.5 text-sm text-findmi-700">
                  First, add the business you want to use with Findmi below. We&rsquo;ll apply your complimentary Pro
                  access to it automatically once it&rsquo;s created — no payment required.
                </p>
              </div>
            </>
          ) : (
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
              <span className="mb-1.5 block text-sm font-medium text-ink">
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
              <p className="mt-1.5 text-xs text-ink/40">$99 for one year of Findmi Pro. No automatic renewal.</p>

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
                <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                  Have a Pro Invite Code?
                </summary>
                <input
                  type="text"
                  name="invite"
                  placeholder="Enter Invite Code"
                  className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-ink/40">
                  A valid code applies complimentary Pro after your business is created — no payment required.
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
            <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
              Have a Referral Code?
            </summary>
            <input
              type="text"
              name="ref"
              defaultValue={ref ?? ""}
              placeholder="Enter Referral Code"
              className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-ink/40">
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
            <span className="text-sm text-ink/70">
              I confirm that I am authorized to create and manage this business on Findmi.
            </span>
          </label>

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            Create My Business
          </button>
          {!hasInvite && (
            <p className="text-center text-xs text-ink/40">
              Free plan requires no payment. Pro continues to secure Stripe checkout after your business is created.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

/** P0 Safe-to-Share Acquisition pass — Pro's plan-chooser option,
 * extracted so its dominant/quiet visual treatment can be driven by a
 * prop (see the parent's own comment on why: whichever plan the visitor
 * actually wants — explicit ?plan=pro, or the normal no-intent case —
 * gets both the dominant styling AND the pre-selected radio). Content is
 * byte-identical to the plan card that always rendered here before this
 * pass; only the dominant/quiet class sets and defaultChecked now vary
 * with a prop instead of being hardcoded to "always dominant." */
function ProPlanOption({ dominant }: { dominant: boolean }) {
  if (!dominant) {
    return (
      <label className="flex cursor-pointer flex-col gap-1.5 rounded-2xl border border-black/10 bg-mist/40 p-4 transition has-[:checked]:border-findmi has-[:checked]:bg-findmi-50 has-[:checked]:ring-1 has-[:checked]:ring-findmi/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink/70">Want deeper tools?</p>
          <input type="radio" name="plan_choice" value="pro" className="h-4 w-4 accent-findmi" />
        </div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold text-ink">Findmi Pro</span>
          <span className="text-sm text-ink/45">· $99/year</span>
        </p>
        {/* Business Acquisition + Stale Plan Copy Cleanup pass — was
            "Full Findmi Here schedule, gallery, contact info and more."
            (schedule-first). Analytics — a real, currently Pro-gated
            capability, see account/business/[id]/page.tsx's `pro &&`
            gate on PerformanceTab — now leads. */}
        <p className="text-xs text-ink/60">Analytics, full schedule, gallery, contact info and more.</p>
      </label>
    );
  }
  return (
    <label className="relative flex cursor-pointer flex-col gap-2.5 rounded-3xl border border-findmi/40 bg-white p-4 shadow-[0_4px_20px_rgba(20,176,188,0.12)] transition has-[:checked]:ring-2 has-[:checked]:ring-findmi sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Findmi Pro</p>
        <input type="radio" name="plan_choice" value="pro" defaultChecked className="h-4 w-4 accent-findmi" />
      </div>
      <p className="flex items-baseline gap-1">
        <span className="font-display text-2xl font-bold tracking-tight text-ink">$99</span>
        <span className="text-xs font-medium text-ink/45">/ year</span>
      </p>

      {/* Business Acquisition + Stale Plan Copy Cleanup pass — was a
          "Findmi Here" / full-schedule highlight box (schedule-completion
          framing — accurate, since Free really is capped at 3 public
          appearances vs Pro's full schedule, but not the right LEADING
          pitch — see canonical rule: Pro explains/optimizes, it isn't
          merely "the plan that unlocks your schedule"). Repositioned to
          Analytics, a real, currently Pro-gated capability (see
          account/business/[id]/page.tsx's `pro && performanceData` gate),
          reusing the same truthful copy as that feature's own upgrade-
          lock elsewhere (UpgradeLockedTab tabKey="performance"). */}
      <div className="rounded-2xl bg-findmi-50 p-3">
        <p className="text-sm font-bold text-ink">Analytics</p>
        <p className="mt-0.5 text-xs font-semibold text-ink/75">See what&rsquo;s working — and grow it.</p>
        <p className="mt-1 text-xs text-ink/60">Understand how people discover and engage with your business.</p>
      </div>

      {/* Business Acquisition + Stale Plan Copy Cleanup pass — Analytics
          added as the leading bullet (see above); every other bullet
          remains an existing, verified-accurate Pro capability. Canonical
          Plan Config pass note above still applies: "Gallery + products"
          stays just "Gallery," Products being a Free capability. */}
      <ul className="flex flex-col gap-1.5 text-xs text-ink/55">
        <PlanBullet>Analytics</PlanBullet>
        <PlanBullet>Full Findmi Here schedule</PlanBullet>
        <PlanBullet>Gallery</PlanBullet>
        <PlanBullet>Contact info + customer inquiries</PlanBullet>
        <PlanBullet>Business updates</PlanBullet>
        <PlanBullet>Custom Findmi URL</PlanBullet>
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
          <p className="text-sm font-semibold text-ink/70">Prefer to start free?</p>
          <input type="radio" name="plan_choice" value="free" className="h-4 w-4 accent-findmi" />
        </div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold text-ink">Findmi Free</span>
          <span className="text-sm text-ink/45">· $0 · No credit card required</span>
        </p>
        <p className="text-xs text-ink/60">Create your Findmi page and show your next 3 appearances.</p>
        {/* Canonical Plan Config pass — "products" removed: Products is a
            Free capability now (Free/Pro Entitlement Realignment pass),
            so naming it as a reason to upgrade was stale and actively
            wrong. Business Acquisition + Stale Plan Copy Cleanup pass —
            was "Upgrade anytime for your full schedule, custom Findmi URL
            and more." (schedule-first); reworded to lead with Analytics,
            consistent with ProPlanOption/join/page.tsx's FreeSection. */}
        <p className="mt-1 text-xs text-ink/45">Upgrade anytime for Analytics and more.</p>
      </label>
    );
  }
  return (
    <label className="relative flex cursor-pointer flex-col gap-2.5 rounded-3xl border border-findmi/40 bg-white p-4 shadow-[0_4px_20px_rgba(20,176,188,0.12)] transition has-[:checked]:ring-2 has-[:checked]:ring-findmi sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Get Started Free</p>
        <input type="radio" name="plan_choice" value="free" defaultChecked className="h-4 w-4 accent-findmi" />
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-2xl font-bold tracking-tight text-ink">$0</span>
        <span className="text-xs font-medium text-ink/45">No credit card required</span>
      </p>

      <div className="rounded-2xl bg-findmi-50 p-3">
        <p className="text-sm font-bold text-ink">Your Findmi page, live today</p>
        <p className="mt-0.5 text-xs font-semibold text-ink/75">Show customers who you are and where you&rsquo;ll be next.</p>
        <p className="mt-1 text-xs text-ink/60">Create your business page now — upgrade anytime, no pressure.</p>
      </div>

      <ul className="flex flex-col gap-1.5 text-xs text-ink/55">
        <PlanBullet>Business profile + About</PlanBullet>
        <PlanBullet>Website + Instagram</PlanBullet>
        <PlanBullet>Next 3 upcoming appearances</PlanBullet>
        <PlanBullet>Up to 5 markets</PlanBullet>
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
