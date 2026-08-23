"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";

export default function SubmitBar({
  cancelHref,
  saveLabel = "Save",
}: {
  cancelHref: string;
  saveLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-black/5 bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
      <Link href={cancelHref} className="text-sm font-semibold text-ink/60 hover:text-ink">
        Cancel
      </Link>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-findmi px-6 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600 disabled:opacity-60"
      >
        {pending ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
