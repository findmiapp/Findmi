"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Admin Bulk Lifecycle V2 — the shared, phone-first bulk toolbar for
 * Events and Businesses (the same pattern as the Locations toolbar): a
 * 2-column grid of ≥ 40px pills on a phone, one row from sm up.
 *
 * `transitions` are the entity's server-confirmed state changes (Make Live,
 * Hide, Approve, Pause…): each is shown only while the selection contains a
 * row it applies to (or nothing is selected yet), asks ONE confirmation,
 * shows only the server's confirmed outcome (never optimistic), keeps the
 * failed rows selected for a retry and refreshes the list. `formActions`
 * are the entity's existing form-post actions (Archive, Move to Trash) with
 * their existing confirmations, unchanged. Quick Edit (metadata) is last. */

export interface ToolbarTransition {
  key: string;
  label: string;
  tone: "primary" | "secondary" | "destructive";
  /** How many selected rows this applies to (0 hides it once something is selected). */
  eligible: number;
  confirm: (count: number) => string;
  run: (ids: string[]) => Promise<{ ok: true; result: { failed: string[] }; message: string } | { ok: false; error: string }>;
}

export interface ToolbarFormAction {
  key: string;
  label: string;
  tone: "secondary" | "destructive";
  action: (formData: FormData) => void | Promise<void>;
  confirm?: (count: number) => string;
}

export const pillClass = "flex min-h-10 items-center justify-center rounded-full px-4 text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40";
const TONE = {
  primary: "bg-findmi text-white hover:bg-findmi-600",
  secondary: "border border-black/15 text-ink/70 hover:border-black/25",
  destructive: "border border-red-200 text-red-600 hover:bg-red-50",
} as const;

export default function BulkLifecycleToolbar({
  selectedIds,
  keepSelected,
  transitions,
  formActions,
  quickEdit,
}: {
  selectedIds: string[];
  keepSelected?: (ids: string[]) => void;
  transitions: ToolbarTransition[];
  formActions: ToolbarFormAction[];
  quickEdit?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const count = selectedIds.length;
  const suffix = count ? ` (${count})` : "";

  function run(t: ToolbarTransition) {
    const ids = [...selectedIds];
    if (ids.length === 0 || !confirm(t.confirm(ids.length))) return;
    setNotice(null);
    setRunning(t.key);
    startTransition(async () => {
      // No optimistic success: only the server's confirmed outcome is shown.
      const r = await t.run(ids).catch(() => null);
      setRunning(null);
      if (!r || !r.ok) {
        setNotice({ tone: "warn", text: r && !r.ok ? r.error : "Couldn't reach Findmi — nothing was changed. Try again." });
        return;
      }
      setNotice({ tone: r.result.failed.length > 0 ? "warn" : "ok", text: r.message });
      // Failed rows stay selected for a retry; everything else is cleared.
      keepSelected?.(r.result.failed);
      router.refresh();
    });
  }

  const visible = transitions.filter((t) => count === 0 || t.eligible > 0);
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto" data-bulk-lifecycle-toolbar="">
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {visible.map((t) => (
          <button key={t.key} type="button" disabled={count === 0 || pending} onClick={() => run(t)} className={`${pillClass} ${TONE[t.tone]}`}>
            {running === t.key ? "Saving…" : `${t.label}${t.eligible && count ? ` (${t.eligible})` : ""}`}
          </button>
        ))}
        {formActions.map((a) => (
          <form
            key={a.key}
            action={a.action}
            onSubmit={(e) => {
              if (a.confirm && !confirm(a.confirm(count))) e.preventDefault();
            }}
            className="contents"
          >
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="ids" value={id} />
            ))}
            <button type="submit" disabled={count === 0 || pending} className={`${pillClass} ${TONE[a.tone]}`}>
              {a.label}
              {suffix}
            </button>
          </form>
        ))}
        {quickEdit}
      </div>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-xs font-semibold ${notice.tone === "ok" ? "bg-findmi-50 text-findmi-700" : "bg-amber-50 text-amber-900"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
