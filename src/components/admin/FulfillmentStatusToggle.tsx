"use client";

import { useTransition } from "react";
import { toggleItemFulfilled } from "@/app/admin/(protected)/orders/actions";

export default function FulfillmentStatusToggle({
  orderItemId,
  orderId,
  fulfilled,
}: {
  orderItemId: string;
  orderId: string;
  fulfilled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => toggleItemFulfilled(orderItemId, orderId, !fulfilled))}
      className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition disabled:opacity-50 ${
        fulfilled ? "bg-findmi-50 text-findmi-700" : "border border-black/10 text-ink/60"
      }`}
    >
      {fulfilled ? "Fulfilled" : "Mark Fulfilled"}
    </button>
  );
}
