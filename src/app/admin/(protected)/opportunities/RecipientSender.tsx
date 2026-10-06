"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Avatar, EntitySearchAdd, type SearchResult } from "@/components/admin/RelationPicker";

function SendButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className="rounded-full bg-findmi px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Sending…" : count > 1 ? `Send Opportunity to ${count} Businesses` : "Send Opportunity"}
    </button>
  );
}

/** Recommend To Businesses — pick several Businesses (server-backed search,
 * already-sent ones excluded), add an optional private fit note to each,
 * then Send. Nothing is written until Send: selecting only builds this
 * local list. */
export default function RecipientSender({
  action,
  alreadySentIds,
}: {
  action: (formData: FormData) => void | Promise<void>;
  alreadySentIds: string[];
}) {
  const [selected, setSelected] = useState<SearchResult[]>([]);
  // Selected-but-unsent Businesses drop out of results; already-sent ones
  // stay visible, marked "Already Added", so nothing looks missing.
  const exclude = new Set(selected.map((s) => s.value));
  const added = new Set(alreadySentIds);

  return (
    <form action={action} className="flex flex-col gap-3">
      <EntitySearchAdd
        entity="businesses"
        placeholder="Search Businesses to add…"
        excludeIds={exclude}
        addedIds={added}
        onAdd={(r) => setSelected((prev) => [...prev, r])}
      />
      {selected.length > 0 && (
        <ul className="flex flex-col gap-2">
          {selected.map((b) => (
            <li key={b.value} className="rounded-xl border border-black/10 bg-white p-3">
              <input type="hidden" name="business_id" value={b.value} />
              <div className="flex items-center gap-2.5">
                <Avatar url={b.image_url} label={b.label} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{b.label}</span>
                  {b.sublabel && <span className="block truncate text-xs text-ink/45">{b.sublabel}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected((prev) => prev.filter((p) => p.value !== b.value))}
                  className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink"
                >
                  Remove
                </button>
              </div>
              <textarea
                name={`fit_note_${b.value}`}
                rows={2}
                maxLength={1000}
                placeholder="Fit note (optional) — Admin only, never shown to the Business"
                className="mt-2 w-full resize-y rounded-xl border border-black/10 bg-white px-3 py-2 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SendButton count={selected.length} />
        {selected.length === 0 && <span className="text-xs text-ink/45">Add one or more Businesses above.</span>}
      </div>
    </form>
  );
}
