"use client";

import { useState, useTransition } from "react";
import type { MomentDisplayState } from "@/lib/entity-moment-display";

/** Show / Hide / Feature a connected Moment on ONE profile or page (a Business,
 * Location or Event). A display preference of that entity only: it never edits,
 * unpublishes or deletes the Moment, and changes nothing on its author or on any
 * other profile. At most one Moment is featured per entity — featuring another
 * replaces it (the previous one simply goes back to shown). */
export default function MomentDisplayControl({
  initial,
  noun,
  action,
}: {
  initial: MomentDisplayState;
  /** "Profile" (Business) or "Page" (Location / Event). */
  noun: "Profile" | "Page";
  action: (display: MomentDisplayState) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [state, setState] = useState<MomentDisplayState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (next: MomentDisplayState) =>
    startTransition(async () => {
      setError(null);
      const before = state;
      setState(next);
      const result = await action(next);
      if (!result.ok) {
        setState(before);
        setError(result.error);
      }
    });

  const button = (label: string, next: MomentDisplayState, on = false) => (
    <button
      type="button"
      onClick={() => set(next)}
      disabled={pending}
      aria-pressed={on}
      className={`inline-flex h-8 items-center rounded-full px-3 text-metadata font-semibold transition disabled:opacity-60 ${on ? "bg-findmi-50 text-findmi-700 ring-1 ring-findmi/40" : "bg-black/[0.05] text-secondary hover:text-primary"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5">
        {state === "hidden" ? (
          button(`Show On ${noun}`, "shown", true)
        ) : (
          <>
            {button(`Hide From ${noun}`, "hidden")}
            {state === "featured" ? button("Remove Feature", "shown", true) : button(`Feature On ${noun}`, "featured")}
          </>
        )}
      </div>
      <p className="mt-0.5 text-microcopy text-subtle">
        {state === "hidden" ? `Hidden from this ${noun.toLowerCase()} only.` : state === "featured" ? `Shown first on this ${noun.toLowerCase()}.` : `Shown on this ${noun.toLowerCase()}.`}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-microcopy font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
