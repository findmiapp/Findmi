"use client";

import { useState, useTransition } from "react";
import { AccountEntitySearchAdd, type AccountSearchResult } from "@/components/account/AccountRelationPicker";
import { inviteParticipatingBusiness } from "../actions";

/** Participating Businesses tab — a search box that immediately invites
 * whichever existing FindMi business the organizer picks, by calling the
 * bound Server Action directly (no separate "Add" button/step). Excludes
 * businesses already on the roster so re-picking one is a no-op from the
 * UI's own perspective (the action itself is also idempotent via
 * ignoreDuplicates, so this is a UX nicety, not the real guard).
 *
 * Opportunities + Conversation Foundation V1 — an optional note, read from
 * plain component state (not a <form>, since AccountEntitySearchAdd fires
 * its own onAdd immediately on selection) and passed straight through to
 * the same inviteParticipatingBusiness call. Cleared after each successful
 * invite so it never accidentally attaches to a second, different pick. */
export default function AddParticipantSearch({ eventId, excludeIds }: { eventId: string; excludeIds: string[] }) {
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleAdd(result: AccountSearchResult) {
    const trimmedNote = note.trim();
    startTransition(() => {
      inviteParticipatingBusiness(eventId, result.value, trimmedNote || undefined);
    });
    setNote("");
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
      <AccountEntitySearchAdd
        entity="businesses"
        placeholder="Search Findmi businesses to invite…"
        excludeIds={new Set(excludeIds)}
        onAdd={handleAdd}
      />
      {isPending && <p className="mt-1.5 text-xs text-ink/40">Inviting…</p>}
    </div>
  );
}
