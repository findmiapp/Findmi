import type { Metadata } from "next";
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
  searchParams: Promise<{ error?: string; duplicate_slug?: string; duplicate_name?: string }>;
}) {
  const { error, duplicate_slug: duplicateSlug, duplicate_name: duplicateName } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/business/new");

  const categories = await getCategories();

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">My FindMi</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Add a Business</h1>
      <p className="mt-2 text-sm text-ink/60">
        Creating a business on FindMi is free — no payment required. You&rsquo;ll own and manage it right away, and
        FindMi will review it before it appears in discovery.
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
            Create Business — Free
          </button>
          <p className="text-center text-xs text-ink/40">
            Free, always. You can explore upgrading to FindMi Pro anytime after.
          </p>
        </form>
      </div>
    </div>
  );
}
