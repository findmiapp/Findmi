"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Category } from "@/lib/types";
import LifecycleBulkActionBar from "@/components/admin/LifecycleBulkActionBar";
import {
  bulkArchiveLocations,
  bulkPermanentDeleteLocations,
  bulkQuickEditLocations,
  bulkRestoreLocationsFromArchive,
  bulkRestoreLocationsFromTrash,
  bulkSetLocationsPublished,
  bulkTrashLocations,
} from "./lifecycle-actions";

// Touch-friendly (≥ 40px tall) pill buttons for the phone-first bar.
const pill = "flex min-h-10 items-center justify-center rounded-full px-4 text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40";

/** Quick Edit — METADATA only (Category today). Structured as a list of
 * independently applied fields so another approved field can be added
 * without redesigning the bar. Lifecycle actions never live here. */
function QuickEditForm({ ids, categories }: { ids: string[]; categories: Category[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" disabled={ids.length === 0} onClick={() => setOpen(true)} className={`${pill} col-span-2 border border-black/15 text-ink/70 hover:border-black/25 sm:col-span-1`}>
        Quick Edit{ids.length > 0 ? ` (${ids.length})` : ""}
      </button>
    );
  }
  return (
    <form action={bulkQuickEditLocations} className="col-span-2 flex w-full flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2.5">
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <p className="w-full text-[11px] font-bold uppercase tracking-wide text-ink/45">Quick Edit · {ids.length} Selected</p>
      <label className="flex items-center gap-1.5 text-xs font-semibold text-ink/70">
        <input type="checkbox" name="apply_category" className="h-4 w-4" />
        Category
      </label>
      <select name="category_id" className="min-h-10 min-w-0 flex-1 rounded-lg border border-black/10 px-2 text-sm">
        <option value="">— None —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="flex w-full items-center gap-3">
        <button type="submit" className={`${pill} bg-findmi text-white hover:bg-findmi-600`}>
          Apply
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One existing lifecycle form action (Archive / Move to Trash) with its
 * existing confirmation — unchanged semantics, phone-sized button. */
function FormAction({ action, ids, label, tone, confirmMessage }: { action: (formData: FormData) => void | Promise<void>; ids: string[]; label: string; tone: "default" | "destructive"; confirmMessage?: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmMessage && !confirm(confirmMessage)) e.preventDefault();
      }}
      className="contents"
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <button type="submit" disabled={ids.length === 0} className={`${pill} ${tone === "destructive" ? "border border-red-200 text-red-600 hover:bg-red-50" : "border border-black/15 text-ink/70 hover:border-black/25"}`}>
        {label}
      </button>
    </form>
  );
}

export function publishConfirmMessage(count: number, publish: boolean): string {
  const noun = `${count} Location${count === 1 ? "" : "s"}`;
  return publish
    ? `Publish ${noun}?\n\n${count === 1 ? "This Location" : "These Locations"} will become publicly visible on Findmi.`
    : `Unpublish ${noun}?\n\n${count === 1 ? "It returns" : "They return"} to Draft: no public Location page, nothing is deleted, and every Event and Business link is kept.`;
}

export default function LocationBulkActionBar({
  view,
  selectedIds,
  categories,
  keepSelected,
}: {
  // No "paused" view — Locations have no Pause concept at all (no
  // publication_status/is_active column exists).
  view: "active" | "archived" | "trashed" | "other";
  selectedIds: string[];
  categories: Category[];
  /** Keeps only these rows selected (failed rows, for a retry). */
  keepSelected?: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  // Archived / Trash views keep the existing shared bar (Restore, Trash,
  // Permanent Delete) unchanged.
  if (view === "archived" || view === "trashed") {
    return (
      <LifecycleBulkActionBar
        view={view}
        selectedIds={selectedIds}
        entityNoun="location"
        actions={{
          archive: bulkArchiveLocations,
          restoreFromArchive: bulkRestoreLocationsFromArchive,
          trash: bulkTrashLocations,
          restoreFromTrash: bulkRestoreLocationsFromTrash,
          permanentDelete: bulkPermanentDeleteLocations,
        }}
      />
    );
  }

  function setPublished(publish: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0 || !confirm(publishConfirmMessage(ids.length, publish))) return;
    setNotice(null);
    startTransition(async () => {
      // No optimistic success: only the server's confirmed outcome is shown.
      const r = await bulkSetLocationsPublished(ids, publish).catch(() => null);
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

  const count = selectedIds.length;
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto" data-location-bulk-bar="">
      {/* Lifecycle actions first (Publish / Unpublish are primary), then
          Archive / Trash, then Quick Edit (metadata). 2 columns on a phone,
          one row from sm up. */}
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <button type="button" disabled={count === 0 || pending} onClick={() => setPublished(true)} className={`${pill} bg-findmi text-white hover:bg-findmi-600`}>
          {pending ? "Saving…" : `Publish${count ? ` (${count})` : ""}`}
        </button>
        <button type="button" disabled={count === 0 || pending} onClick={() => setPublished(false)} className={`${pill} border border-findmi/40 text-findmi-700 hover:bg-findmi-50`}>
          Unpublish{count ? ` (${count})` : ""}
        </button>
        <FormAction action={bulkArchiveLocations} ids={selectedIds} label={`Archive${count ? ` (${count})` : ""}`} tone="default" />
        <FormAction
          action={bulkTrashLocations}
          ids={selectedIds}
          label={`Trash${count ? ` (${count})` : ""}`}
          tone="destructive"
          confirmMessage={`Move ${count} location(s) to Trash? They'll be hidden everywhere until restored.`}
        />
        <QuickEditForm ids={selectedIds} categories={categories} />
      </div>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-xs font-semibold ${notice.tone === "ok" ? "bg-findmi-50 text-findmi-700" : "bg-amber-50 text-amber-900"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
