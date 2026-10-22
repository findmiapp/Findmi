"use client";

import { useState, useTransition } from "react";
import { setMomentProfileDisplayAction } from "../moment-display-actions";

/** Show On Profile / Hide From Profile — a display preference for THIS
 * Business's public profile. It never edits or deletes the Moment (which may
 * belong to someone else) and changes nothing on any other profile; the line
 * under the button says so in plain words. */
export default function MomentProfileControl({ businessId, entryId, initialHidden }: { businessId: string; entryId: string; initialHidden: boolean }) {
  const [hidden, setHidden] = useState(initialHidden);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () =>
    startTransition(async () => {
      setError(null);
      const next = !hidden;
      setHidden(next);
      const result = await setMomentProfileDisplayAction(businessId, entryId, next);
      if (!result.ok) {
        setHidden(!next);
        setError(result.error);
      }
    });

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={hidden}
        className={`inline-flex h-8 items-center rounded-full px-3 text-metadata font-semibold transition disabled:opacity-60 ${
          hidden ? "bg-findmi-50 text-findmi-700 ring-1 ring-findmi/40" : "bg-black/[0.05] text-secondary hover:text-primary"
        }`}
      >
        {hidden ? "Show On Profile" : "Hide From Profile"}
      </button>
      <p className="mt-0.5 text-microcopy text-subtle">{hidden ? "Hidden from your profile only." : "Shown on your public profile."}</p>
      {error && (
        <p role="alert" className="mt-1 text-microcopy font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
