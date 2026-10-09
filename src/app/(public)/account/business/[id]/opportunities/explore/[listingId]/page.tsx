import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BusinessAppShell from "../../../v2/BusinessAppShell";
import ChevronIcon from "@/components/ChevronIcon";
import { getExploreItem } from "@/lib/opportunity-listings";
import { canMemberRespond } from "@/lib/opportunity-listings-domain";
import { OpportunityAsideSections, OpportunityDeal, OpportunityHero, OpportunityMainSections, OpportunityResponseSection } from "@/components/opportunities/OpportunityPresentation";
import { loadBusinessShell } from "../../loadBusinessShell";
import { expressInterestFromExplore } from "../../actions";
import { getSiteContactInfo } from "@/lib/contact-info";
import { CHOOSE_PACKAGE_MESSAGE, choosePackageMailto, requiresPackageChoice } from "@/lib/opportunity-package-policy";

export const dynamic = "force-dynamic";

/** Explore detail — one discoverable Opportunity this Business has no
 * relationship with yet. Only explorable listings resolve (getExploreItem:
 * discoverable + open + not past deadline; private listings 404). If the
 * Business already has its own recipient row, the canonical relationship
 * page is shown instead. "I'm Interested" creates that relationship
 * (owner/manager only; enforced server-side). */
export default async function ExploreOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; listingId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, listingId } = await params;
  const { error } = await searchParams;
  const { membership, shell } = await loadBusinessShell(id, `/account/business/${id}/opportunities/explore/${listingId}`);
  const item = await getExploreItem(id, listingId);
  if (!item) notFound();
  if (item.linkedRecipientId) redirect(`/account/business/${id}/opportunities/${item.linkedRecipientId}`);

  const o = item.opportunity;
  // Temporary single-package policy — the server refuses this Interested too.
  const choosePackageHref = requiresPackageChoice(item.options.length)
    ? choosePackageMailto({ email: (await getSiteContactInfo()).email, opportunityTitle: o.title, businessName: shell.business.name })
    : null;
  const mayRespond = canMemberRespond(membership.role, membership.viaAdmin);
  const note = membership.viaAdmin
    ? "Viewing as a Findmi Admin. Responses come from the Business; manage Opportunities from Admin."
    : !mayRespond
      ? "Only a Business owner or manager can respond to this Opportunity."
      : null;

  return (
    <BusinessAppShell {...shell} activeSection="opportunities">
      <div className="flex max-w-4xl flex-col gap-4">
        <Link href={`${shell.basePath}?tab=opportunities&view=explore`} className="flex w-fit items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          <ChevronIcon direction="left" className="h-3 w-3" />
          Explore
        </Link>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>}

        {/* 1. Introduction (no price fact, no response controls) */}
        <OpportunityHero o={o} place={item.place} showCredits={false} showCommercialFact={false} commercialOptions={item.options} />

        {/* 2. The Deal — understood BEFORE any response */}
        <OpportunityDeal o={o} options={item.options} />

        {/* 3. Response */}
        <OpportunityResponseSection title="Interested?">
          <div className="flex flex-col gap-3">
            <p className="text-metadata text-secondary">
              {choosePackageHref ? CHOOSE_PACKAGE_MESSAGE : <>This lets Findmi know you&rsquo;d like to discuss participating. It is not a confirmation.</>}
            </p>
            {mayRespond &&
              (choosePackageHref ? (
                <a href={choosePackageHref} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-findmi px-3 text-center text-button font-bold text-white transition hover:bg-findmi-600 sm:w-auto sm:px-6">
                  Contact Findmi to Choose a Package
                </a>
              ) : (
                <form action={expressInterestFromExplore.bind(null, id, listingId)}>
                  <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-findmi text-button font-bold text-white transition hover:bg-findmi-600 sm:w-auto sm:px-6">
                    I&rsquo;m Interested
                  </button>
                </form>
              ))}
            {note && <p className="text-metadata text-muted">{note}</p>}
          </div>
        </OpportunityResponseSection>

        {/* 4. Details */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <OpportunityMainSections o={o} includeDealProse={false} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <OpportunityAsideSections
              o={o}
              place={item.place}
              locationHref={item.place?.slug ? `/location/${item.place.slug}` : null}
              event={item.event}
              eventHref={item.event?.slug ? `/event/${item.event.slug}` : null}
              showCredits={false}
              showInvestment={false}
            />
          </div>
        </div>
      </div>
    </BusinessAppShell>
  );
}
