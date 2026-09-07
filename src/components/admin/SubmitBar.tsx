"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";

export default function SubmitBar({
  cancelHref,
  saveLabel = "Save",
  /** Rapid-entry admin passes (Markets/Areas/Categories) — render a second
   * submit button that posts intent=save_add_another alongside the normal
   * Save. Only meaningful on a NEW-record form; the caller decides when to
   * show it (never on an edit form, where "add another" doesn't apply). */
  showAddAnother = false,
  addAnotherLabel = "Save & Add Another",
}: {
  cancelHref: string;
  saveLabel?: string;
  showAddAnother?: boolean;
  addAnotherLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-black/5 bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
      <Link href={cancelHref} className="text-sm font-semibold text-ink/60 hover:text-ink">
        Cancel
      </Link>
      <div className="flex items-center gap-2">
        {showAddAnother && (
          <button
            type="submit"
            name="intent"
            value="save_add_another"
            disabled={pending}
            className="rounded-full border border-findmi/30 bg-findmi-50 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-100 disabled:opacity-60"
          >
            {pending ? "Saving…" : addAnotherLabel}
          </button>
        )}
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="rounded-full bg-findmi px-6 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : saveLabel}
        </button>
      </div>
    </div>
  );
}
