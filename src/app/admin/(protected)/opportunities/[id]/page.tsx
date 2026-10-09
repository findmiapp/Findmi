import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminOpportunityContext, getAdminOpportunityListing, getAdminOpportunityOptions, type AdminOpportunityOption } from "@/lib/opportunity-listings";
import {
  COMPONENT_TYPE_LABELS,
  MONETARY_COMPONENT_TYPES,
  OPTION_COMMERCIAL_MODE_LABELS,
  formatComponentSummary,
  formatOptionSummary,
  formatOptionalContributions,
  type ComponentFields,
  type OptionFields,
} from "@/lib/opportunity-commercial-terms-domain";
import { isLegacyUnclassified } from "@/lib/opportunity-commercial-terms-bridge";
import {
  LISTING_STATUS_LABELS,
  LISTING_TRANSITIONS,
  RECIPIENT_STATUS_LABELS,
  canManageRecipients,
  canSendOpportunity,
  getOpportunityLifecycle,
  listingTransitionLabel,
  summarizeRecipientCounts,
  emptyRecipientCounts,
  toPresentableOpportunity,
  type ListingStatus,
  type RecipientStatus,
} from "@/lib/opportunity-listings-domain";
import {
  OpportunityAsideSections,
  OpportunityHero,
  OpportunityMainSections,
  OpportunitySection,
} from "@/components/opportunities/OpportunityPresentation";
import RecipientSender from "../RecipientSender";
import RecipientCard from "../RecipientCard";
import ConfirmSubmitButton from "../ConfirmSubmitButton";
import OpportunityLifecycle from "../OpportunityLifecycle";
import { STATUS_BADGE } from "../format";
import { convertLegacyToCommercialTerms, sendOpportunity, setListingVisibility, setOpportunityStatus } from "../actions";

export const dynamic = "force-dynamic";

const primaryBtn =
  "inline-flex items-center justify-center rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";
const secondaryBtn =
  "inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-ink/75 transition hover:border-ink/30 hover:text-ink";
const quietBtn = "rounded-full px-2 py-2 text-xs font-semibold text-ink/45 transition hover:text-ink";

function savedMessage(saved: string, sent?: string): string {
  if (saved === "created") return "Draft saved. Open it when it's ready to send.";
  if (saved === "updated") return "Changes saved.";
  if (saved === "sent") {
    const n = Number(sent ?? 0);
    return n > 0 ? `Opportunity sent to ${n} ${n === 1 ? "Business" : "Businesses"}.` : "No new Businesses — nothing was sent.";
  }
  if (saved === "status-open") return "Opportunity is Open.";
  if (saved === "status-closed") return "Opportunity is Closed.";
  if (saved === "status-archived") return "Opportunity archived. Nothing was deleted.";
  if (saved === "recipient") return "Recipient updated.";
  if (saved === "notes") return "Internal note saved.";
  if (saved === "visibility-discoverable") return "Discoverable — Businesses can find this in Explore while it's open.";
  if (saved === "visibility-private") return "Private — only Businesses it's sent to can see it.";
  if (saved === "converted") return "Commercial Terms added.";
  return "Saved.";
}

/** Which listing move is the hero's primary action. Open listings lead with
 * Add Businesses instead (the operational action), so Close is secondary. */
function primaryMove(status: ListingStatus): ListingStatus | null {
  if (status === "draft" || status === "closed") return "open";
  return null;
}

const COUNTED: RecipientStatus[] = ["offered", "interested", "not_interested", "confirmed", "completed", "cancelled", "withdrawn"];

/** Commercial Terms Admin Builder (Pass 2) — Admin-only, additive display.
 * Never touches src/components/opportunities/OpportunityPresentation.tsx
 * (shared with the future Business view). Two states:
 *   - zero Options ("not yet classified"): the existing legacy Investment
 *     line (OpportunityMainSections, unchanged) is still shown elsewhere on
 *     this page; this card explains WHY it's ambiguous in plain language
 *     (never the word "legacy") and offers the one explicit, admin-
 *     initiated "Add Commercial Terms" conversion — never automatic.
 *   - >=1 Option: the real structured summary, Option by Option. */
function CommercialTermsSection({ listing, options, editHref }: { listing: { id: string; pricing_mode: string; price_cents: number | null }; options: AdminOpportunityOption[]; editHref: string }) {
  if (isLegacyUnclassified(options.length)) {
    const needsDirection = listing.pricing_mode === "fixed" || listing.pricing_mode === "starting_at";
    return (
      <section className="rounded-2xl border border-dashed border-black/15 bg-white/60 p-4">
        <h2 className="text-sm font-semibold text-ink">Commercial Terms</h2>
        <p className="mt-1 text-sm text-ink/60">
          This Opportunity was created before Findmi&rsquo;s structured Commercial Terms model and hasn&rsquo;t been classified yet
          {needsDirection ? " — it doesn't say whether its amount is a Participation Fee, Compensation, or Project Budget." : "."}
        </p>
        <form action={convertLegacyToCommercialTerms.bind(null, listing.id)} className="mt-3 flex flex-wrap items-end gap-3">
          {needsDirection && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">This amount represents</span>
              <select name="component_type" defaultValue="" required className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none">
                <option value="" disabled>
                  Choose…
                </option>
                {MONETARY_COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMPONENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
            Add Commercial Terms
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Commercial Terms</h2>
        <Link href={`${editHref}#commercial-terms`} className="text-xs font-semibold text-findmi-700 hover:underline">
          Edit
        </Link>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {options.map((o, i) => {
          const fields = o as unknown as OptionFields;
          const optional = formatOptionalContributions(fields);
          return (
            <li key={o.id} className="rounded-xl bg-black/[0.03] px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  {options.length > 1 ? o.name || `Option ${i + 1}` : OPTION_COMMERCIAL_MODE_LABELS[o.commercial_mode as OptionFields["commercial_mode"]]}
                </p>
                <span className="text-sm text-ink/70">{formatOptionSummary(fields)}</span>
              </div>
              {o.commercial_mode === "custom" && o.custom_terms_note && <p className="mt-1 text-xs text-ink/55">{o.custom_terms_note}</p>}
              {o.commercial_mode !== "custom" && o.components.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink/55">
                  {o.components.map((c) => (
                    <li key={c.id}>{formatComponentSummary(c as unknown as ComponentFields)}</li>
                  ))}
                </ul>
              )}
              {optional.length > 0 && <p className="mt-1 text-xs text-ink/45">{optional.join(" · ")}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Opportunities — Admin command center for one commercial Opportunity:
 * hero (shared read-only presentation + Admin actions), presentational
 * lifecycle, Recipients, the commercial content, then Admin-only notes.
 * Editing lives at ./edit (the existing OpportunityForm). */
export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; sent?: string; skipped?: string }>;
}) {
  const { id } = await params;
  const { saved, error, sent, skipped } = await searchParams;
  const result = await getAdminOpportunityListing(id);
  if (!result) notFound();
  const { listing, recipients } = result;
  const [{ location, event }, commercialTermsOptions] = await Promise.all([getAdminOpportunityContext(listing), getAdminOpportunityOptions(listing.id)]);

  const o = toPresentableOpportunity(listing);
  const counts = summarizeRecipientCounts(recipients.map((r) => ({ listing_id: listing.id, status: r.status }))).get(listing.id) ?? emptyRecipientCounts();
  const lifecycle = getOpportunityLifecycle(listing.status, counts);
  const manageable = canManageRecipients(listing.status);
  const canSend = canSendOpportunity(listing.status);
  const moves = LISTING_TRANSITIONS[listing.status];
  const primary = primaryMove(listing.status);
  const secondaryMoves = moves.filter((m) => m !== primary && m !== "archived");
  const editHref = `/admin/opportunities/${listing.id}/edit`;

  // Opportunities V2 — discoverability (absent before the V2 migration =
  // private, the default).
  const discoverable = listing.visibility === "discoverable";
  const actions = (
    <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-4">
      {primary && (
        <form action={setOpportunityStatus.bind(null, listing.id, primary)}>
          <button type="submit" className={primaryBtn}>
            {listingTransitionLabel(listing.status, primary)}
          </button>
        </form>
      )}
      {canSend && (
        <a href="#recipients" className={primaryBtn}>
          + Add Businesses
        </a>
      )}
      <Link href={editHref} className={secondaryBtn}>
        Edit Opportunity
      </Link>
      {secondaryMoves.map((to) => (
        <form key={to} action={setOpportunityStatus.bind(null, listing.id, to)}>
          <button type="submit" className={secondaryBtn}>
            {listingTransitionLabel(listing.status, to)}
          </button>
        </form>
      ))}
      {listing.status !== "archived" && (
        <form action={setListingVisibility.bind(null, listing.id, discoverable ? "private" : "discoverable")}>
          <button type="submit" className={secondaryBtn}>
            {discoverable ? "Make Private" : "Make Discoverable"}
          </button>
        </form>
      )}
      {moves.includes("archived") && (
        <div className="ml-auto">
          <ConfirmSubmitButton
            action={setOpportunityStatus.bind(null, listing.id, "archived")}
            confirmMessage="Archive this Opportunity? It's hidden from active lists but nothing is deleted, and it can be unarchived."
            label="Archive"
            className={quietBtn}
          />
        </div>
      )}
    </div>
  );

  const lifecycleNote =
    listing.status === "closed"
      ? "Closed — no longer taking responses. Outcomes can still be updated."
      : listing.status === "archived"
        ? "Archived — hidden from active lists. Nothing was deleted."
        : null;

  const shownCounts = COUNTED.filter((s) => counts[s] > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/opportunities" className="shrink-0 hover:underline">
          Opportunities
        </Link>
        <span>/</span>
        <span className="truncate">{listing.title}</span>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved && !error && (
        <div className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          <p>{savedMessage(saved, sent)}</p>
          {skipped && <p className="mt-1 text-xs">Already sent, skipped: {skipped}</p>}
        </div>
      )}

      <OpportunityHero
        o={o}
        place={location}
        badges={
          <>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[listing.status]}`}>
              {LISTING_STATUS_LABELS[listing.status]}
            </span>
            <span
              title={discoverable ? "Listed in the Business Explore view while open" : "Only reachable by Businesses it's sent to"}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${discoverable ? "border border-findmi/30 text-findmi-700" : "bg-black/5 text-ink/45"}`}
            >
              {discoverable ? "Discoverable" : "Private"}
            </span>
          </>
        }
        actions={actions}
      />

      <OpportunityLifecycle steps={lifecycle} note={lifecycleNote} />

      <CommercialTermsSection listing={listing} options={commercialTermsOptions} editHref={editHref} />

      <section id="recipients" aria-labelledby="recipients-heading" className="scroll-mt-20">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="recipients-heading" className="text-lg font-semibold text-ink">
            Recipients ({recipients.length})
          </h2>
          {shownCounts.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink/55">
              {shownCounts.map((s) => (
                <span key={s} className="whitespace-nowrap">
                  <span className="font-semibold tabular-nums text-ink">{counts[s]}</span> {RECIPIENT_STATUS_LABELS[s]}
                </span>
              ))}
            </p>
          )}
        </div>

        {canSend ? (
          <div className="mt-3 rounded-2xl border border-findmi/25 bg-findmi-50/40 p-4">
            <p className="text-sm font-semibold text-ink">Recommend To Businesses</p>
            <p className="mt-0.5 text-xs text-ink/55">
              Search and add Businesses, with an optional private fit note for each. Nothing is sent until you press Send.
            </p>
            <div className="mt-3">
              <RecipientSender action={sendOpportunity.bind(null, listing.id)} alreadySentIds={recipients.map((r) => r.business_id)} />
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-dashed border-black/15 bg-white/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink/60">
              {listing.status === "draft"
                ? "This Opportunity is currently a Draft. Open it to send to Businesses."
                : listing.status === "closed"
                  ? "This Opportunity is Closed. Reopen it to send to more Businesses."
                  : "This Opportunity is Archived. Unarchive it to update recipients."}
            </p>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="shrink-0 cursor-not-allowed self-start rounded-full border border-black/10 bg-black/[0.03] px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/35 sm:self-auto"
            >
              + Add Businesses
            </button>
          </div>
        )}

        {recipients.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {recipients.map((r) => (
              <RecipientCard key={r.id} r={r} listingId={listing.id} manageable={manageable} />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <OpportunityMainSections o={o} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <OpportunityAsideSections
            o={o}
            place={location}
            locationHref={location ? `/admin/locations/${location.id}` : null}
            event={event}
            eventHref={event ? `/admin/events/${event.id}` : null}
          />
        </div>
      </div>

      <OpportunitySection
        title={
          <span className="flex items-center gap-2">
            Internal Notes
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">Admin Only</span>
          </span>
        }
        aside={
          <Link href={`${editHref}#internal`} className="text-xs font-semibold text-findmi-700 hover:underline">
            Edit
          </Link>
        }
      >
        {listing.internal_notes ? (
          <p className="whitespace-pre-line break-words rounded-xl bg-black/[0.03] px-3.5 py-3 text-sm leading-relaxed text-ink/75">{listing.internal_notes}</p>
        ) : (
          <p className="text-sm text-ink/45">No internal notes.</p>
        )}
        <p className="mt-2 text-xs text-ink/40">Never shown to Businesses.</p>
      </OpportunitySection>
    </div>
  );
}
