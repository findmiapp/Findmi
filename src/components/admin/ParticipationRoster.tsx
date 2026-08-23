import type { SelectOption } from "@/lib/admin/queries";
import type { EventParticipant } from "@/lib/admin/queries";

const STATUS_OPTIONS = [
  { value: "not_participating", label: "— Not Participating —" },
  { value: "invited", label: "Invited" },
  { value: "applied", label: "Applied" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved (public)" },
  { value: "declined", label: "Declined" },
];

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

/** One row per business in the system (not just currently-linked ones) —
 * adding, changing status, featuring, and removing a participant are all
 * just "set this business's status," so one unified control handles the
 * whole workflow without separate add/remove UI. */
export default function ParticipationRoster({
  businessOptions,
  participants,
}: {
  businessOptions: SelectOption[];
  participants: EventParticipant[];
}) {
  const byId = new Map(participants.map((p) => [p.business_id, p]));

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">Participating Businesses</span>
      {businessOptions.length === 0 ? (
        <p className="text-sm text-ink/45">No businesses yet — add one first.</p>
      ) : (
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-xl border border-black/10 bg-white p-2">
          {businessOptions.map((b) => {
            const existing = byId.get(b.value);
            return (
              <div
                key={b.value}
                className="flex flex-col gap-2 rounded-lg border border-black/5 p-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <input type="hidden" name="all_business_ids" value={b.value} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{b.label}</p>
                  {b.sublabel && <p className="text-xs text-ink/40">{b.sublabel}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    name={`status_${b.value}`}
                    defaultValue={existing?.status ?? "not_participating"}
                    className={inputClass}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-ink/70">
                    <input
                      type="checkbox"
                      name={`featured_${b.value}`}
                      defaultChecked={existing?.featured}
                      className="h-4 w-4 accent-findmi"
                    />
                    Featured
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-1.5 text-xs text-ink/45">
        Only &ldquo;Approved&rdquo; businesses appear publicly on the event page.
      </p>
    </div>
  );
}
