"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A creation form's submit button that locks the moment the form is
 * submitted: disabled (and labelled `pendingLabel`) for as long as its
 * Server Action is pending, so a repeated tap can't fire the action again
 * (2026-11-02 incident: one Create Event form was submitted three times
 * and produced three identical Events). The server still deduplicates on
 * its own (lib/form-submission-keys) — this is the first line, not the
 * only one. Must render inside the <form>. */
export default function PendingSubmitButton({
  children,
  pendingLabel = "Submitting…",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={`${className ?? ""} disabled:cursor-wait disabled:opacity-60`}>
      {pending ? pendingLabel : children}
    </button>
  );
}
