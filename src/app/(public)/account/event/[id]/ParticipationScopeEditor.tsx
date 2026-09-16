"use client";

import { useState, useTransition } from "react";
import type { EventParticipationScope } from "@/lib/types";

/** Multi-Date Business Participation Pass 2B — SCOPE CHANGE (LOCKED
 * behavior, see updateParticipatingBusinessScope's own doc comment for the
 * exact all_dates<->selected_dates reconciliation rules). A quiet, closed
 * "Change" disclosure on an already-approved participant's row — never
 * shown for a single-date Event (the caller only renders this when
 * effectiveDates.length > 1). Dates are always the unified Primary Date +
 * Additional Dates list, human-facing labels only. */
export default function ParticipationScopeEditor({
  eventId,
  businessId,
  currentScope,
  effectiveDates,
  onSave,
}: {
  eventId: string;
  businessId: string;
  currentScope: EventParticipationScope | null;
  effectiveDates: { id: string; label: string }[];
  onSave: (eventId: string, businessId: string, scope: EventParticipationScope, keepDateIds: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<EventParticipationScope>(currentScope ?? "all_dates");
  const [selectedIds, setSelectedIds] = useState<string[]>(currentScope === "selected_dates" ? effectiveDates.map((d) => d.id) : []);
  const [isPending, startTransition] = useTransition();

  function toggleDate(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function save() {
    startTransition(() => {
      onSave(eventId, businessId, scope, scope === "selected_dates" ? selectedIds : []);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-semibold text-ink/40 underline underline-offset-2 hover:text-ink/70">
        Change participating dates
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-black/10 bg-mist/30 p-3">
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs text-ink">
          <input type="radio" checked={scope === "all_dates"} onChange={() => setScope("all_dates")} className="h-3.5 w-3.5 accent-findmi" />
          All dates — participate throughout this Event
        </label>
        <label className="flex items-center gap-2 text-xs text-ink">
          <input type="radio" checked={scope === "selected_dates"} onChange={() => setScope("selected_dates")} className="h-3.5 w-3.5 accent-findmi" />
          Selected dates
        </label>
      </div>
      {scope === "selected_dates" && (
        <div className="mt-2 flex flex-col gap-1">
          {effectiveDates.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-xs text-ink/70">
              <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleDate(d.id)} className="h-3.5 w-3.5 accent-findmi" />
              {d.label}
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isPending || (scope === "selected_dates" && selectedIds.length === 0)}
          className="text-xs font-bold uppercase tracking-wide text-findmi-700 hover:underline disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
