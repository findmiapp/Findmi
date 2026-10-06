import Link from "next/link";
import type { AdminOpportunityRecipient } from "@/lib/opportunity-listings";
import { ADMIN_TRANSITIONS, RECIPIENT_STATUS_LABELS, adminTransitionLabel } from "@/lib/opportunity-listings-domain";
import { RECIPIENT_BADGE, formatOpportunityDate } from "./format";
import { saveRecipientNotes, setRecipientStatus } from "./actions";

/** One recipient Business: status, fit/response notes, dates, the canonical
 * Admin moves (ADMIN_TRANSITIONS) and its Admin-only note. */
const smallBtn = "rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:border-ink/30 hover:text-ink";

function DateLine({ label, iso }: { label: string; iso: string | null }) {
  if (!iso) return null;
  return (
    <span className="whitespace-nowrap">
      {label} {formatOpportunityDate(iso)}
    </span>
  );
}

export default function RecipientCard({ r, listingId, manageable }: { r: AdminOpportunityRecipient; listingId: string; manageable: boolean }) {
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

