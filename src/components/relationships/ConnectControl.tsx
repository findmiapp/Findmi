"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_INTENTS_BY_KIND, type CommercialIntent, type TargetKind } from "@/lib/commercial-intents";
import { CONNECT_HINT, RELATIONSHIP_ACTIONS } from "@/lib/relationship-links";
import { connectAction } from "@/app/(public)/account/business/[id]/target-actions";
import { IntentPicker } from "./IntentPicker";

/** Connect — begin this Business's private relationship with a Place,
 * Business or Event, then open it. One deliberate step: say what it's about
 * (the existing intent vocabulary; Event Participation is excluded — it has
 * its own Apply To Participate workflow), then Connect. Creates the private
 * Target only (connectAction) — never an Inquiry, Opportunity, Find Us Here
 * entry or Appearance. An existing relationship is simply opened. */
export default function ConnectControl({
  businessId,
  kind,
  counterpartyId,
  label = RELATIONSHIP_ACTIONS.connect,
  primary = true,
}: {
  businessId: string;
  kind: TargetKind;
  counterpartyId: string;
  label?: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const exclude: CommercialIntent[] = kind === "event" ? ["event_participation"] : [];
  const [open, setOpen] = useState(false);
  const [intents, setIntents] = useState<CommercialIntent[]>(DEFAULT_INTENTS_BY_KIND[kind].filter((i) => !exclude.includes(i)));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const connect = () =>
    start(async () => {
      setError(null);
      const res = await connectAction(businessId, kind, counterpartyId, intents);
      if (!res.ok) return setError(res.error);
      router.push(res.href);
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          primary
            ? "flex h-10 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600"
            : "flex h-10 items-center rounded-full border border-findmi/40 bg-white px-4 text-button font-bold text-findmi-700 transition hover:bg-findmi-50"
        }
      >
        {label}
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl bg-black/[0.03] p-3">
      <p className="text-metadata font-semibold text-muted">What&rsquo;s it about?</p>
      <IntentPicker kind={kind} value={intents} onChange={setIntents} disabled={pending} exclude={exclude} />
      <p className="text-microcopy text-subtle">{CONNECT_HINT}</p>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={connect} disabled={pending || intents.length === 0} className="flex h-10 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50">
          {pending ? "Connecting…" : RELATIONSHIP_ACTIONS.connect}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="flex h-10 items-center px-3 text-metadata font-semibold text-muted hover:text-primary">
          Cancel
        </button>
      </div>
    </div>
  );
}
