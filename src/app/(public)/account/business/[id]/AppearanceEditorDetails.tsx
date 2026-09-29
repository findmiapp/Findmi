"use client";

import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/** Appearance Editor State Repair — a small, locally-owned replacement for
 * `<details open={someServerBoolean}>`. That pattern is a React-CONTROLLED
 * prop: React re-asserts the DOM `open` attribute to match the server value
 * on every re-render of this tree. Business Manager's per-appearance edit
 * rows and the "Add Where I'll Be" composer only ever get a `true` server
 * value from a URL/searchParam (`isEditing`/`addHasDraft`) that's set
 * exclusively by a validation-error redirect — opening one of these
 * natively (clicking its `<summary>`) never touches the URL at all. So the
 * very next incidental Server Component re-render — which Next.js
 * performs after ANY Server Action call resolves (e.g. MemberImageField's
 * own uploadMemberBusinessImage), whether or not that action calls
 * revalidatePath — recomputes the same false/false value and forces every
 * open editor closed, mid-edit, with whatever wasn't Saved yet discarded.
 *
 * This component keeps `open` in local React state instead, seeded once
 * from the server value, and lets the native `<summary>` toggle own it
 * from then on via `onToggle` — so an incidental refresh (same URL, same
 * searchParams) leaves an already-open editor alone. It only re-seeds from
 * `initialOpen` when the URL's search string itself actually changes —
 * i.e. a REAL navigation happened (a validation-error redirect that should
 * reopen the affected row, or a successful Save's redirect that should
 * return to the collapsed list) — never on an in-place refresh. */
export default function AppearanceEditorDetails({
  initialOpen,
  className,
  summaryClassName,
  summary,
  children,
}: {
  initialOpen: boolean;
  className?: string;
  summaryClassName?: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const searchKey = useSearchParams().toString();
  const [open, setOpen] = useState(initialOpen);
  const lastSearchKey = useRef(searchKey);

  if (searchKey !== lastSearchKey.current) {
    lastSearchKey.current = searchKey;
    if (open !== initialOpen) setOpen(initialOpen);
  }

  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}
