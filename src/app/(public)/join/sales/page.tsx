import type { Metadata } from "next";
import Link from "next/link";
import { submitSalesInquiry } from "./actions";
import SubmitButton from "./SubmitButton";

export const metadata: Metadata = {
  title: "Talk to Findmi Sales",
  robots: { index: false },
};
// Anonymous submissions, and the success/error state depends entirely on
// searchParams — never statically cached, same as every other
// form-with-query-state page in this app (e.g. account/profile).
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-medium text-ink";

/** Multi-Region / National Sales Inquiry pass — the native form behind
 * /join's "Talk to Sales" CTA (join/page.tsx's RegionalSection), replacing
 * the previous mailto behavior entirely. A plain Server Action form (no
 * client JS beyond SubmitButton's pending-disable) — on success,
 * submitSalesInquiry redirects here with ?submitted=1 for the success
 * state below; on a validation error it redirects back with ?error= and
 * every already-typed field round-tripped via query params (see
 * actions.ts's fieldsForRetry) so a mistake never wipes the form. */
export default async function JoinSalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const submitted = params.submitted === "1";
  const error = params.error;

  if (submitted) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50">
          <CheckGlyph />
        </div>
        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-findmi-700">Multi-Region / National</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Thanks — we&rsquo;ll be in touch.</h1>
        <p className="mt-3 text-sm text-ink/60">
          We received your information and will follow up about the right Findmi setup for your business.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Back to Findmi
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Multi-Region / National</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Let&rsquo;s talk about your business.</h1>
      <p className="mt-3 text-sm text-ink/60">
        Tell us where you operate and what you&rsquo;re looking to accomplish with Findmi.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={submitSalesInquiry} className="flex flex-col gap-4">
          {/* Honeypot — visually and structurally hidden from real
              visitors (not just display:none, which some bots skip past),
              never labeled anything a person would recognize as a real
              field. See actions.ts's own note on how a filled value is
              handled. */}
          <div className="absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden" aria-hidden="true">
            <label>
              Leave this field blank
              <input type="text" name="company_site" tabIndex={-1} autoComplete="off" />
            </label>
          </div>

          <label className="block">
            <span className={labelClass}>Contact name</span>
            <input
              type="text"
              name="contact_name"
              required
              defaultValue={params.contact_name ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Business / brand name</span>
            <input
              type="text"
              name="business_name"
              required
              defaultValue={params.business_name ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Email</span>
            <input
              type="email"
              name="email"
              required
              defaultValue={params.email ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Number of cities or markets currently served</span>
            <input
              type="number"
              name="city_market_count"
              inputMode="numeric"
              min={1}
              max={100000}
              required
              defaultValue={params.city_market_count ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Regions / areas served or interested in</span>
            <input
              type="text"
              name="regions"
              required
              placeholder="e.g. NYC, Long Island, North Jersey"
              defaultValue={params.regions ?? ""}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-ink/45">
              Describe it however makes sense — it doesn&rsquo;t need to match Findmi&rsquo;s own market names.
            </span>
          </label>
          <label className="block">
            <span className={labelClass}>Goals / what you want Findmi to help you accomplish</span>
            <textarea
              name="goals"
              required
              rows={4}
              defaultValue={params.goals ?? ""}
              className={`${inputClass} resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Phone (optional)</span>
            <input
              type="tel"
              name="phone"
              inputMode="tel"
              defaultValue={params.phone ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Website or Instagram (optional)</span>
            <input
              type="text"
              name="website_or_instagram"
              placeholder="yourbrand.com or @yourbrand"
              defaultValue={params.website_or_instagram ?? ""}
              className={inputClass}
            />
          </label>

          <SubmitButton />
        </form>
      </div>

      <div className="mt-6 text-center">
        <Link href="/join" className="text-xs font-semibold text-ink/40 hover:text-ink/70">
          ← Back to Join Findmi
        </Link>
      </div>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 text-findmi-700">
      <path
        d="M4 10.5l3.5 3.5L16 5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
