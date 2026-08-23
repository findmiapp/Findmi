import type { AllocationStatus } from "./types";

/** Single place that decides a vendor_order_allocation's status label from
 * its current numbers — used after both a refund and a settlement payment
 * touch the ledger, so the two call sites can't drift on the rule. */
export function computeAllocationStatus(
  amountPaid: number,
  amountOutstanding: number,
  fullyRefunded: boolean
): AllocationStatus {
  if (fullyRefunded) return "refunded";
  if (amountPaid > 0 && amountOutstanding <= 0) return "paid";
  if (amountPaid > 0 && amountOutstanding > 0) return "partially_paid";
  return "held";
}
