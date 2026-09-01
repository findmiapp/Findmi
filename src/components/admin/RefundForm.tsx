"use client";

import type { FormEvent } from "react";

/** The Refund form's own client boundary — needed only so the submit can
 * be intercepted for a confirmation prompt before the (server-action)
 * refund actually runs; the parent order detail page stays an async
 * Server Component otherwise. Same small-client-island pattern as
 * FulfillmentStatusToggle on this same page. Eligibility itself (paid
 * order, non-empty PaymentIntent, amount within the refundable balance)
 * is enforced authoritatively in issueRefund() server-side — this is only
 * the "are you sure" layer in front of it. */
export default function RefundForm({
  action,
  refundable,
}: {
  action: (formData: FormData) => void;
  refundable: number;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const amount = Number(new FormData(e.currentTarget).get("amount"));
    if (!amount || amount <= 0) return; // let the input's own required/min handle this
    const ok = window.confirm(`Refund $${amount.toFixed(2)}? This cannot be undone.`);
    if (!ok) e.preventDefault();
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="number"
        name="amount"
        step="0.01"
        min="0.01"
        max={refundable}
        placeholder={`Up to $${refundable.toFixed(2)}`}
        required
        className="w-32 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs text-ink"
      />
      <input
        type="text"
        name="reason"
        placeholder="Reason (optional)"
        className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs text-ink"
      />
      <button
        type="submit"
        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-black/[0.03]"
      >
        Refund
      </button>
    </form>
  );
}
