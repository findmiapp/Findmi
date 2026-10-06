import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminOpportunityListing, type AdminOpportunityRecipient } from "@/lib/opportunity-listings";
import { getEventOptionById, getLocationOptionById } from "@/lib/admin/queries";
import {
  ADMIN_TRANSITIONS,
  LISTING_STATUS_LABELS,
  LISTING_TRANSITIONS,
  OPPORTUNITY_TYPE_LABELS,
  RECIPIENT_STATUS_LABELS,
  adminTransitionLabel,
  canManageRecipients,
  formatOpportunityPrice,
  listingTransitionLabel,
  type ListingStatus,
} from "@/lib/opportunity-listings-domain";
import OpportunityForm from "../OpportunityForm";
import RecipientSender from "../RecipientSender";
import ConfirmSubmitButton from "../ConfirmSubmitButton";
import { RECIPIENT_BADGE, STATUS_BADGE, formatOpportunityDate, formatOpportunityTiming } from "../format";
import { saveOpportunity, saveRecipientNotes, sendOpportunity, setOpportunityStatus, setRecipientStatus } from "../actions";

export const dynamic = "force-dynamic";

const primaryBtn = "rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";
const secondaryBtn = "rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink";
const smallBtn = "rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:border-ink/30 hover:text-ink";

function savedMessage(saved: string, sent?: string): string {
  if (saved === "created") return "Draft saved. Open it when it's ready to send.";
  if (saved === "sent") {
    const n = Number(sent ?? 0);
    return n > 0 ? `Opportunity sent to ${n} ${n === 1 ? "Business" : "Businesses"}.` : "No new Businesses — nothing was sent.";
  }
  if (saved === "status-open") return "Opportunity is Open.";
  if (saved === "status-closed") return "Opportunity is Closed.";
  if (saved === "status-archived") return "Opportunity archived. Nothing was deleted.";
  if (saved === "recipient") return "Recipient updated.";
  if (saved === "notes") return "Internal note saved.";
  return "Saved.";
}

function DateLine({ label, iso }: { label: string; iso: string | null }) {
  if (!iso) return null;
  return (
    <span className="whitespace-nowrap">
      {label} {formatOpportunityDate(iso)}
    </span>
  );
}

function RecipientCard({ r, listingId, manageable }: { r: AdminOpportunityRecipient; listingId: string; manageable: boolean }) {
  const moves = manageable ? ADMIN_TRANSITIONS[r.status] : [];
  return (
    <li id={`recipient-${r.id}`} className="scroll-mt-20 rounded-xl border border-black/10 bg-white p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {r.business ? (
            <Link href={`/admin/businesses/${r.business.id}`} className="block truncate text-sm font-semibold text-ink hover:underline">
              {r.business.name}
            </Link>
          ) : (
            <span className="block text-sm font-semibold text-ink/50">Business unavailable</span>
          )}
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink/50">
            <DateLine label="Offered" iso={r.offered_at} />
            <DateLine label="Responded" iso={r.responded_at} />
            <DateLine label="Status changed" iso={r.status_changed_at} />
          </span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RECIPIENT_BADGE[r.status]}`}>
          {RECIPIENT_STATUS_LABELS[r.status]}
        </span>
      </div>

      {(r.fit_note || r.response_note) && (
        <dl className="mt-2.5 flex flex-col gap-1.5 text-sm">
          {r.fit_note && (
            <div>
              <dt className="text-xs font-semibold text-ink/50">Fit Note</dt>
              <dd className="whitespace-pre-line text-ink/80">{r.fit_note}</dd>
            </div>
          )}
          {r.response_note && (
            <div>
              <dt className="text-xs font-semibold text-ink/50">Business Response Note</dt>
              <dd className="whitespace-pre-line text-ink/80">{r.response_note}</dd>
            </div>
          )}
        </dl>
      )}

      {moves.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {moves.map((to) => (
            <form key={to} action={setRecipientStatus.bind(null, listingId, r.id, to)}>
              <button type="submit" className={smallBtn}>
                {adminTransitionLabel(r.status, to)}
              </button>
            </form>
          ))}
        </div>
      )}

      <details className="group mt-3 border-t border-black/5 pt-2.5">
        <summary className="cursor-pointer list-none text-xs font-semibold text-ink/55 hover:text-ink">
          {r.internal_notes ? "Internal Note" : "+ Internal Note"}
          {r.internal_notes && <span className="ml-1 font-normal text-ink/45 group-open:hidden">— {r.internal_notes.slice(0, 80)}{r.internal_notes.length > 80 ? "…" : ""}</span>}
        </summary>
        <form action={saveRecipientNotes.bind(null, listingId, r.id)} className="mt-2 flex flex-col gap-2">
          <textarea
            name="internal_notes"
            defaultValue={r.internal_notes ?? ""}
            rows={2}
            placeholder="Admin only — never shown to the Business"
            className="w-full resize-y rounded-xl border border-black/10 bg-white px-3 py-2 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
          />
          <button type="submit" className={`${smallBtn} self-start`}>
            Save Note
          </button>
        </form>
      </details>
    </li>
  );
}

/** Opportunities V1 Pass 2 — one listing: status controls, recipients
 * (Send + Findmi-controlled outcomes + internal notes) and the edit form. */
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

  const [initialLocation, initialEvent] = await Promise.all([getLocationOptionById(listing.location_id), getEventOptionById(listing.event_id)]);

  const moves = LISTING_TRANSITIONS[listing.status];
  const manageable = canManageRecipients(listing.status);
  const timing = formatOpportunityTiming(listing);
  const place = initialLocation?.label ?? listing.place_text;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/opportunities" className="hover:underline">
          Opportunities
        </Link>
        <span>/</span>
        <span className="truncate">{listing.title}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 font-display text-2xl font-semibold tracking-tight text-ink">{listing.title}</h1>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[listing.status]}`}>
          {LISTING_STATUS_LABELS[listing.status]}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink/60">
        {[OPPORTUNITY_TYPE_LABELS[listing.opportunity_type], formatOpportunityPrice(listing), listing.credits_eligible ? "Credits Eligible" : null, place]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {(timing || listing.host_name) && (
        <p className="mt-0.5 text-xs text-ink/50">{[listing.host_name ? `Hosted by ${listing.host_name}` : null, timing].filter(Boolean).join(" · ")}</p>
      )}

      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved && !error && (
        <div className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          <p>{savedMessage(saved, sent)}</p>
          {skipped && <p className="mt-1 text-xs">Already sent, skipped: {skipped}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {moves.map((to: ListingStatus) =>
          to === "archived" ? (
            <ConfirmSubmitButton
              key={to}
              action={setOpportunityStatus.bind(null, listing.id, to)}
              confirmMessage="Archive this Opportunity? It's hidden from active lists but nothing is deleted, and it can be unarchived."
              label={listingTransitionLabel(listing.status, to)}
              className={secondaryBtn}
            />
          ) : (
            <form key={to} action={setOpportunityStatus.bind(null, listing.id, to)}>
              <button type="submit" className={to === "open" ? primaryBtn : secondaryBtn}>
                {listingTransitionLabel(listing.status, to)}
              </button>
            </form>
          )
        )}
      </div>

      <section id="recipients" className="mt-8 scroll-mt-20">
        <h2 className="text-base font-semibold text-ink">Recipients ({recipients.length})</h2>

        {listing.status === "open" ? (
          <div className="mt-3 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
            <p className="text-sm font-semibold text-ink">Recommend To Businesses</p>
            <p className="mt-0.5 text-xs text-ink/50">Nothing is sent until you press Send. Businesses that already have this Opportunity are skipped.</p>
            <div className="mt-3">
              <RecipientSender action={sendOpportunity.bind(null, listing.id)} alreadySentIds={recipients.map((r) => r.business_id)} />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink/50">
            {listing.status === "draft"
              ? "Open this Opportunity to send it to Businesses."
              : listing.status === "closed"
                ? "Reopen this Opportunity to send it to more Businesses. Outcomes below can still be updated."
                : "Archived — unarchive to update recipients."}
          </p>
        )}

        {recipients.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {recipients.map((r) => (
              <RecipientCard key={r.id} r={r} listingId={listing.id} manageable={manageable} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-base font-semibold text-ink">Opportunity Details</h2>
        <OpportunityForm
          listing={listing}
          initialLocation={initialLocation}
          initialEvent={initialEvent}
          action={saveOpportunity.bind(null, listing.id)}
          saveLabel="Save"
          cancelHref="/admin/opportunities"
        />
      </section>
    </div>
  );
}
