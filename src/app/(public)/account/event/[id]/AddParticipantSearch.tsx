"use client";

import { useState, useTransition } from "react";
import { AccountEntitySearchAdd, type AccountSearchResult } from "@/components/account/AccountRelationPicker";
import { inviteParticipatingBusiness } from "../actions";
import type { EventParticipationScope } from "@/lib/types";

/** Participating Businesses tab — a search box that invites whichever
 * existing FindMi business the organizer picks. Excludes businesses
 * already on the roster so re-picking one is a no-op from the UI's own
 * perspective (the action itself is also idempotent via ignoreDuplicates,
 * so this is a UX nicety, not the real guard).
 *
 * Multi-Date Business Participation Pass 2B — for a single-date Event
 * (effectiveDates.length <= 1), the invite still fires immediately on
 * pick, exactly as before — nothing to choose between. For a multi-date
 * Event, picking a business opens a small "Participating dates" chooser
 * (All dates / Selected dates) before the invite is actually sent, so the
 * organizer's own explicit scope choice is recorded from the start —
 * never inferred, never forced through a pointless chooser on a
 * single-date Event (per this pass's own INVITE UX rule).
 *
 * Opportunities + Conversation Foundation V1 — an optional note, read from
 * plain component state (not a <form>, since AccountEntitySearchAdd fires
 * its own onAdd immediately on selection) and passed straight through to
 * the same inviteParticipatingBusiness call. Cleared after each successful
 * invite so it never accidentally attaches to a second, different pick. */
export default function AddParticipantSearch({
  eventId,
  excludeIds,
  effectiveDates,
}: {
  eventId: string;
  excludeIds: string[];
  effectiveDates: { id: string; label: string }[];
}) {
  const [note, setNote] = useState("");
  const [pendingBusiness, setPendingBusiness] = useState<AccountSearchResult | null>(null);
  const [scope, setScope] = useState<EventParticipationScope>("all_dates");
  const [selectedDateIds, setSelectedDateIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const isMultiDate = effectiveDates.length > 1;

  function sendInvite(businessId: string, inviteScope: EventParticipationScope, dateIds: string[]) {
    const trimmedNote = note.trim();
    startTransition(() => {
      inviteParticipatingBusiness(eventId, businessId, trimmedNote || undefined, inviteScope, dateIds);
    });
    setNote("");
    setPendingBusiness(null);
    setScope("all_dates");
    setSelectedDateIds([]);
  }

  function handleAdd(result: AccountSearchResult) {
    if (!isMultiDate) {
      sendInvite(result.value, "all_dates", []);
      return;
    }
    setPendingBusiness(result);
  }

  function toggleDate(id: string) {
    setSelectedDateIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div>
      <label className="mb-2 block">
        <span className="mb-1 block text-xs font-medium text-ink/60">
          Note to include <span className="font-normal text-ink/40">(optional)</span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. We'd love to have you at our spring market…"
          className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
      </label>
      {pendingBusiness ? (
        <div className="rounded-xl border border-black/10 bg-white p-3">
          <p className="text-sm font-semibold text-ink">Participating dates for {pendingBusiness.label}</p>
          <div className="mt-2 flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="radio" checked={scope === "all_dates"} onChange={() => setScope("all_dates")} className="h-3.5 w-3.5 accent-findmi" />
              All dates — participate throughout this Event
            </label>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="radio" checked={scope === "selected_dates"} onChange={() => setScope("selected_dates")} className="h-3.5 w-3.5 accent-findmi" />
              Selected dates — choose dates
            </label>
          </div>
          {scope === "selected_dates" && (
            <div className="mt-2 flex flex-col gap-1">
              {effectiveDates.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-xs text-ink/70">
                  <input type="checkbox" checked={selectedDateIds.includes(d.id)} onChange={() => toggleDate(d.id)} className="h-3.5 w-3.5 accent-findmi" />
                  {d.label}
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => sendInvite(pendingBusiness.value, scope, selectedDateIds)}
              disabled={isPending || (scope === "selected_dates" && selectedDateIds.length === 0)}
              className="text-xs font-bold uppercase tracking-wide text-findmi-700 hover:underline disabled:opacity-50"
            >
              {isPending ? "Inviting…" : "Send Invite"}
            </button>
            <button type="button" onClick={() => setPendingBusiness(null)} className="text-xs font-semibold text-ink/50 hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <AccountEntitySearchAdd
            entity="businesses"
            placeholder="Search Findmi businesses to invite…"
            excludeIds={new Set(excludeIds)}
            onAdd={handleAdd}
          />
          {isPending && <p className="mt-1.5 text-xs text-ink/40">Inviting…</p>}
        </>
      )}
    </div>
  );
}
