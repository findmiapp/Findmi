import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCategories } from "@/lib/data";
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
  searchParams: Promise<{ error?: string; duplicate_slug?: string; duplicate_name?: string; plan?: string }>;
}) {
  const { error, duplicate_slug: duplicateSlug, duplicate_name: duplicateName, plan } = await searchParams;
  // Join + Add Business Plan UX Alignment pass — /join's Pro card links
  // here with ?plan=pro so Pro intent is preselected instead of the
  // default Free radio. Free needs no param (it's already the default).
  const wantsPro = plan === "pro";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Preserve ?plan=pro through sign-in using the existing safe `next`
    // redirect mechanism (lib/auth/safe-redirect.ts already round-trips
    // a path's query string) — no new auth infrastructure, just not
    // dropping the query string this redirect used to hardcode away.
    const next = wantsPro ? "/account/business/new?plan=pro" : "/account/business/new";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const categories = await getCategories();

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">My FindMi</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Add a Business</h1>
      <p className="mt-2 text-sm text-ink/60">
        You&rsquo;ll own and manage it right away, and FindMi will review it before it appears in discovery. Choose
        Free or Pro below — Free never requires payment.
      </p>

      {duplicateSlug ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink">
            {error ?? "We found a business that looks like a match."}
          </p>
          <p className="mt-1.5 text-sm text-ink/70">
            {duplicateName ?? "An existing business"} may already be on FindMi. If this is your business, claim it
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
            <input type="text" name="name" required placeholder="Your business name" className={inputClass} />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Primary category</span>
            <select name="category_id" required defaultValue="" className={inputClass}>
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

          {/* City/State — useful minimal disambiguation + duplicate
              detection, not a Pro location editor. Optional. */}
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">
                City <span className="font-normal text-ink/40">(optional)</span>
              </span>
              <input type="text" name="city" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">
                State <span className="font-normal text-ink/40">(optional)</span>
              </span>
              <input type="text" name="state" className={inputClass} />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">
              Website <span className="font-normal text-ink/40">(optional)</span>
            </span>
            <input type="url" name="website_url" placeholder="https://" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">
              Instagram <span className="font-normal text-ink/40">(optional)</span>
            </span>
            <input type="url" name="instagram_url" placeholder="https://instagram.com/…" className={inputClass} />
          </label>

          {/* Plan choice — Native Business Onboarding Pass 3, restyled by
              the Pro Positioning pass to the same hierarchy as /join:
              Pro first/dominant with FindMi Here spotlighted, Free
              smaller/quieter directly below as a genuinely selectable
              "basic index" option. Radio values/names and the default
              selection logic are UNCHANGED — Free stays defaultChecked
              unless ?plan=pro was passed in (never auto-selecting a
              paid plan just because it's now visually first) — so
              createMemberBusiness (untouched) submits identically to
              before. Every bullet below is a CURRENT entitlement (see
              account/business/actions.ts's FREE_ALLOWED_COLUMNS/
              PRO_ONLY_COLUMNS and business/[slug]/page.tsx's own `pro &&`
              gates) — nothing promised here that doesn't already exist.
              Choosing Pro doesn't create the business as Pro directly:
              it's still created Free + pending_review first (same RPC),
              then this action immediately continues into native Stripe
              checkout for that exact business — see createMemberBusiness. */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink">Choose your plan</span>
            <div className="flex flex-col gap-3">
              {/* Pro — dominant choice, same visual weight/aqua glow as
                  /join's ProCard, FindMi Here spotlighted inside it. */}
              <label className="relative flex cursor-pointer flex-col gap-2.5 rounded-3xl border border-findmi/40 bg-white p-4 shadow-[0_4px_20px_rgba(20,176,188,0.12)] transition has-[:checked]:ring-2 has-[:checked]:ring-findmi sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">FindMi Pro</p>
                  <input type="radio" name="plan_choice" value="pro" defaultChecked={wantsPro} className="h-4 w-4 accent-findmi" />
                </div>
                <p className="flex items-baseline gap-1">
                  <span className="font-display text-2xl font-bold tracking-tight text-ink">$20</span>
                  <span className="text-xs font-medium text-ink/45">first year</span>
                </p>

                {/* Final Conversion Consistency pass — Free can also add/
                    manage appearances now (Passes 1-2), so this no longer
                    frames "adding appearances" as the Pro-exclusive
                    benefit — the real Pro distinction is the full
                    schedule showing publicly (Free's public profile
                    shows only its next 1). Also drops the "Featured with
                    Pro" eyebrow (implied FindMi itself features the
                    business), matching join/page.tsx's ProCard. */}
                <div className="rounded-2xl bg-findmi-50 p-3">
                  <p className="text-sm font-bold text-ink">FindMi Here</p>
                  <p className="mt-0.5 text-xs font-semibold text-ink/75">Show customers where to find you next.</p>
                  <p className="mt-1 text-xs text-ink/60">
                    Your full upcoming schedule shows on your public profile — not just your next appearance.
                  </p>
                </div>

                <ul className="flex flex-col gap-1.5 text-xs text-ink/55">
                  <PlanBullet>Full business profile</PlanBullet>
                  <PlanBullet>Gallery</PlanBullet>
                  <PlanBullet>Website, socials &amp; contact information</PlanBullet>
                  <PlanBullet>Business updates</PlanBullet>
                  <PlanBullet>Richer discovery presence</PlanBullet>
                </ul>
              </label>

              {/* Free — small, quiet "basic index" option directly below
                  Pro, not an equal competing card. */}
              <label className="flex cursor-pointer flex-col gap-1.5 rounded-2xl border border-black/10 bg-mist/40 p-4 transition has-[:checked]:border-findmi has-[:checked]:bg-findmi-50 has-[:checked]:ring-1 has-[:checked]:ring-findmi/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink/70">Just need a basic listing?</p>
                  <input type="radio" name="plan_choice" value="free" defaultChecked={!wantsPro} className="h-4 w-4 accent-findmi" />
                </div>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-sm font-bold text-ink">Free Basic Index</span>
                  <span className="text-sm text-ink/45">· $0</span>
                </p>
                <p className="text-xs text-ink/60">Get your name, logo, category and short description into FindMi.</p>
                <p className="mt-1 text-xs text-ink/35 line-through decoration-ink/25">
                  Full About section · Gallery · Website + social links · FindMi Here · Business updates
                </p>
              </label>
            </div>
            <p className="mt-1.5 text-xs text-ink/40">No automatic renewal during the introductory period.</p>
          </div>

          <label className="mt-1 flex items-start gap-2.5">
            <input
              type="checkbox"
              name="authorized"
              required
              className="mt-0.5 h-4 w-4 shrink-0 accent-findmi"
            />
            <span className="text-sm text-ink/70">
              I confirm that I am authorized to create and manage this business on FindMi.
            </span>
          </label>

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            Create My Business
          </button>
          <p className="text-center text-xs text-ink/40">
            Free plan requires no payment. Pro continues to secure Stripe checkout after your business is created.
          </p>
        </form>
      </div>
    </div>
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
