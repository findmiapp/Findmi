import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import { Chip } from "./owner-ui";
import ScrollToTopOnArrival from "./ScrollToTopOnArrival";
import AddToPresence from "./business/[id]/v2/AddToPresence";

/** VCL A2 — the completion state Brand onboarding lands on
 * (/account?created=<id>): success + status for the Business that was just
 * submitted, then the ordinary Account Home continues below. Deliberately
 * NOT a Business dashboard — the Business workspace stays the place to
 * manage it. Rendered only for one of the signed-in user's OWN Businesses
 * that is actually pending review (the page resolves `created` against the
 * user's memberships; this component trusts nothing from the URL). */
export default function CreatedBusinessCard({
  business,
}: {
  business: { id: string; name: string; slug: string; imageUrl: string | null };
}) {
  return (
    <section
      aria-labelledby="created-business"
      className="mt-4 rounded-3xl border border-findmi/25 bg-findmi-50 px-5 py-5 sm:px-6"
    >
      <ScrollToTopOnArrival />
      <div className="flex items-center gap-3">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white">
          {business.imageUrl ? (
            <SupabaseImage src={business.imageUrl} alt="" fill sizes="48px" className="object-contain" />
          ) : (
            <NavIcon name="storefront" className="h-6 w-6 text-findmi-700" />
          )}
        </span>
        <div className="min-w-0">
          <h2 id="created-business" className="truncate font-display text-section-title font-bold text-primary">
            {business.name}
          </h2>
          <div className="mt-0.5">
            <Chip tone="amber">Pending Review</Chip>
          </div>
        </div>
      </div>
      <p className="mt-4 text-body font-semibold text-primary">Your Business has been submitted.</p>
      <p className="mt-1 max-w-xl text-body text-secondary">
        It&rsquo;s visible to you now and will appear in discovery after Findmi reviews it.
      </p>
      {/* SUBMISSION -> ACCOUNT HOME -> CLEAR STATUS -> NEXT ACTION: the one
          Create on Findmi entry (the same sheet Business Home uses) leads,
          then Manage and Preview. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <AddToPresence basePath={`/account/business/${business.id}`} businessId={business.id} variant="primary" label="Create on Findmi" />
        <Link
          href={`/account/business/${business.id}`}
          className="inline-flex h-11 min-w-0 max-w-full items-center rounded-xl border border-findmi/40 bg-white px-4 text-button font-bold text-findmi-700 transition hover:bg-findmi-50"
        >
          <span className="truncate">Manage {business.name}</span>
        </Link>
        {business.slug && (
          <Link
            href={`/business/${business.slug}`}
            className="inline-flex h-11 items-center rounded-xl border border-findmi/40 bg-white px-4 text-button font-bold text-findmi-700 transition hover:bg-findmi-50"
          >
            Preview
          </Link>
        )}
      </div>
    </section>
  );
}
