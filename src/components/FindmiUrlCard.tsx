"use client";

// FindMi Global Handle Registry — one shared "FindMi URL" presentation for
// every owned entity Manager (Business/Location/Event). Product Model
// Correction pass: this is always an ENTITY's public identity, never
// presented as belonging to the signed-in account personally (no "Your
// public profile: @..." wording — see account/profile, which no longer
// has any handle concept at all). Claimed state leads with the actual
// readable URL (Copy Link + Change) rather than continuing to show an
// empty form; unclaimed state is the plain claim form. Never prepopulates
// from the entity's own name/slug — `currentHandle` is the only possible
// default value, and only once genuinely claimed.
import { useState } from "react";
import CopyButton from "./CopyButton";
import UsernameField from "./UsernameField";
import type { HandleEntityType } from "@/lib/handles";
import { siteConfig } from "@/lib/site-config";

const primaryButtonClass =
  "flex h-10 shrink-0 items-center justify-center rounded-full bg-findmi px-5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";
const secondaryButtonClass =
  "shrink-0 rounded-full border border-black/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/70 transition hover:bg-black/5";

export default function FindmiUrlCard({
  entityType,
  entityId,
  entityLabel,
  currentHandle,
  action,
}: {
  entityType: HandleEntityType;
  entityId: string;
  /** e.g. "this business" / "this venue" / "this event" — used only in
   * the unclaimed/change prompt copy, never as a prefill value. */
  entityLabel: string;
  currentHandle: string | null;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(!currentHandle);
  const url = currentHandle ? `${siteConfig.domain}/${currentHandle}` : null;

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Findmi URL</p>

      {!editing && currentHandle ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5">
          <p className="min-w-0 break-all text-base font-bold text-findmi-700">{url}</p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <CopyButton value={`https://${url}`} label="Copy Link" className={secondaryButtonClass} />
            <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
              Change
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink/60">
            {currentHandle ? `Choose a new FindMi URL for ${entityLabel}.` : `Create an easy-to-share FindMi link for ${entityLabel}.`}
          </p>
          <form action={action} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <UsernameField
                name="username"
                defaultValue={currentHandle}
                current={{ entityType, entityId }}
                autoFocus={Boolean(currentHandle)}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="submit" className={primaryButtonClass}>
                {currentHandle ? "Save" : "Claim"}
              </button>
              {currentHandle && (
                <button type="button" onClick={() => setEditing(false)} className={secondaryButtonClass}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
