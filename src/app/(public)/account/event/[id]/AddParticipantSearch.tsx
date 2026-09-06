"use client";

import { useTransition } from "react";
import { AccountEntitySearchAdd, type AccountSearchResult } from "@/components/account/AccountRelationPicker";
import { inviteParticipatingBusiness } from "../actions";

/** Participating Businesses tab — a search box that immediately invites
 * whichever existing FindMi business the organizer picks, by calling the
 * bound Server Action directly (no separate "Add" button/step). Excludes
 * businesses already on the roster so re-picking one is a no-op from the
 * UI's own perspective (the action itself is also idempotent via
 * ignoreDuplicates, so this is a UX nicety, not the real guard). */
export default function AddParticipantSearch({ eventId, excludeIds }: { eventId: string; excludeIds: string[] }) {
  const [isPending, startTransition] = useTransition();

  function handleAdd(result: AccountSearchResult) {
    startTransition(() => {
      inviteParticipatingBusiness(eventId, result.value);
    });
  }

  return (
    <div>
      <AccountEntitySearchAdd
        entity="businesses"
        placeholder="Search FindMi businesses to invite…"
        excludeIds={new Set(excludeIds)}
        onAdd={handleAdd}
      />
      {isPending && <p className="mt-1.5 text-xs text-ink/40">Inviting…</p>}
    </div>
  );
}
