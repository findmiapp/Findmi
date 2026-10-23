"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inquiryOutcomeAction } from "@/app/(public)/account/inquiry-actions";
import type { InquiryStatus } from "@/lib/commercial-inquiries-domain";

/** The outcome buttons a party may use (computed server-side by
 * inquiryActionsFor; the action re-checks everything). Accept is one tap;
 * Decline and Withdraw ask once more inline. Acceptance creates nothing else —
 * no Find Us Here, Appearance, participation, Order or contract. */
const LABEL: Partial<Record<InquiryStatus, string>> = { accepted: "Accept", declined: "Decline", withdrawn: "Withdraw Inquiry" };

export default function InquiryActions({ inquiryId, asEntity, actions }: { inquiryId: string; asEntity: { entityType: string; entityId: string }; actions: InquiryStatus[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<InquiryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (actions.length === 0) return null;

  const act = (next: InquiryStatus) =>
    start(async () => {
      setError(null);
      const result = await inquiryOutcomeAction(inquiryId, asEntity, next);
      if (!result.ok) return setError(result.error);
      setConfirming(null);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) =>
          confirming === a ? (
            <span key={a} className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} onClick={() => act(a)} className="flex h-10 items-center rounded-full bg-ink px-4 text-button font-bold text-white transition hover:bg-ink/85 disabled:opacity-50">
                {pending ? "Saving…" : `Yes, ${LABEL[a]}`}
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(null)} className="flex h-10 items-center px-2 text-metadata font-semibold text-muted hover:text-primary">
                Cancel
              </button>
            </span>
          ) : (
            <button
              key={a}
              type="button"
              disabled={pending || confirming !== null}
              onClick={() => (a === "accepted" ? act(a) : setConfirming(a))}
              className={
                a === "accepted"
                  ? "flex h-10 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50"
                  : "flex h-10 items-center rounded-full border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-black/20 disabled:opacity-50"
              }
            >
              {LABEL[a]}
            </button>
          )
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
