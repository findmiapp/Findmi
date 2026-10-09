import Link from "next/link";
import { notFound } from "next/navigation";
import BusinessAppShell from "../../v2/BusinessAppShell";
import ChevronIcon from "@/components/ChevronIcon";
import { getBusinessOpportunityItem } from "@/lib/opportunity-listings";
import { canMemberRespond, type BusinessOpportunityState, type BusinessResponseStatus } from "@/lib/opportunity-listings-domain";
import {
  OpportunityAsideSections,
  OpportunityHero,
  OpportunityMainSections,
} from "@/components/opportunities/OpportunityPresentation";
import { BusinessStateBadge } from "@/components/opportunities/BusinessOpportunityCard";
import { loadBusinessShell } from "../loadBusinessShell";
import { respondToOpportunity } from "../actions";

export const dynamic = "force-dynamic";

const RESPONDED: Record<BusinessResponseStatus, string> = {
  interested: "Thanks — Findmi now knows you're interested.",
  not_interested: "Got it — you've passed on this Opportunity.",
};

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}
function CrossGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

/** The Business's decision area. Choices come from the canonical
 * getBusinessOpportunityState; who may press them from canMemberRespond.
 * The server action re-checks everything. */
function DecisionArea({
  state,
  action,
  mayRespond,
  viaAdmin,
}: {
  state: BusinessOpportunityState;
  action: (response: BusinessResponseStatus) => (formData: FormData) => void | Promise<void>;
  mayRespond: boolean;
  viaAdmin: boolean;
}) {
  const fresh = state.choices.length === 2;
  const permissionNote = !state.answerable
    ? null
    : viaAdmin
      ? "Viewing as a Findmi Admin. Responses come from the Business; manage this Opportunity from Admin."
      : !mayRespond
        ? "Only a Business owner or manager can respond to this Opportunity."
        : null;

  return (
    <div className="flex flex-col gap-3 border-t border-black/5 pt-4">
      {fresh && mayRespond && (
        <div className="grid gap-2 sm:grid-cols-2">
          <form action={action("interested")}>
            <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-findmi text-button font-bold text-white transition hover:bg-findmi-600">
              <CheckGlyph />
              I&rsquo;m Interested
            </button>
          </form>
          <form action={action("not_interested")}>
            <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-black/10 bg-white text-button font-semibold text-primary transition hover:border-black/20">
              <CrossGlyph />
              Not Interested
            </button>
          </form>
        </div>
      )}

      {!fresh && (
        <div
          className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 ${
            state.tone === "aquaSoft" || state.tone === "positive" ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.03] text-ink/70"
          }`}
        >
          {(state.tone === "aquaSoft" || state.tone === "positive") && (
            <span className="mt-0.5 shrink-0">
              <CheckGlyph />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-label font-bold uppercase">{state.label}</p>
            <p className="mt-0.5 text-metadata">{state.message}</p>
          </div>
        </div>
      )}

      {fresh && <p className="rounded-xl bg-findmi-50/60 px-3.5 py-2.5 text-metadata text-findmi-700">{state.message}</p>}

      {!fresh && mayRespond && state.choices.length > 0 && (
        <form action={action(state.choices[0])} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-metadata text-muted">Changed your mind?</span>
          <button type="submit" className="text-metadata font-bold text-accent hover:underline">
            {state.choices[0] === "interested" ? "I'm Interested" : "Not Interested"}
          </button>
        </form>
      )}

      {permissionNote && <p className="text-metadata text-muted">{permissionNote}</p>}
    </div>
  );
}

/** Business-Facing Opportunities V1 — one commercial Opportunity Findmi
 * recommended to this Business. Reachable only through this Business's
 * own recipient row (getBusinessOpportunityItem scopes by business_id
 * AND recipient id after requireBusinessMember); everything rendered is
 * the Business-safe view model — never internal notes, listing status,
 * other recipients or counts. */
export default async function BusinessOpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; recipientId: string }>;
  searchParams: Promise<{ responded?: string; error?: string }>;
}) {
  const { id, recipientId } = await params;
  const { responded, error } = await searchParams;
  const { membership, shell } = await loadBusinessShell(id, `/account/business/${id}/opportunities/${recipientId}`);

  const item = await getBusinessOpportunityItem(id, recipientId);
  if (!item) notFound();
  const { view, place, event, options } = item;
  const o = view.opportunity;
  const mayRespond = canMemberRespond(membership.role, membership.viaAdmin);
  const action = (response: BusinessResponseStatus) => respondToOpportunity.bind(null, id, view.recipientId, response);
  const respondedMessage = responded === "interested" || responded === "not_interested" ? RESPONDED[responded] : null;

  return (
    <BusinessAppShell {...shell} activeSection="opportunities">
      <div className="flex max-w-4xl flex-col gap-4">
        <Link href={`${shell.basePath}?tab=opportunities`} className="flex w-fit items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          <ChevronIcon direction="left" className="h-3 w-3" />
          Opportunities
        </Link>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>}
        {respondedMessage && !error && (
          <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-findmi-700">{respondedMessage}</p>
        )}

        <OpportunityHero
          o={o}
          place={place}
          showCredits={false}
          badges={<BusinessStateBadge tone={view.state.tone} label={view.state.label} />}
          actions={<DecisionArea state={view.state} action={action} mayRespond={mayRespond} viaAdmin={Boolean(membership.viaAdmin)} />}
          commercialOptions={options}
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <OpportunityMainSections o={o} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <OpportunityAsideSections
              o={o}
              place={place}
              locationHref={place?.slug ? `/location/${place.slug}` : null}
              event={event}
              eventHref={event?.slug ? `/event/${event.slug}` : null}
              showCredits={false}
              commercialOptions={options}
            />
          </div>
        </div>
      </div>
    </BusinessAppShell>
  );
}
