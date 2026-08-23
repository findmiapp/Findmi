import { round2 } from "./fees";

export interface AllocatableItem {
  id: string;
  chargeableValue: number;
}

/** Deterministic proportional allocation of one blended processing fee
 * (Stripe charges a single fee on the whole payment, not per line item)
 * across order items, weighted by each item's chargeable value
 * (line_merchandise_total + fulfillment_amount). Rounding to the cent
 * means the naive per-item shares won't always sum exactly to the input
 * total — the residual (always < $0.01 × item count) is added to the last
 * item in the given order, so the sum of allocations always equals
 * totalFee exactly. Caller passes items in a stable order (e.g. sorted by
 * id) so the residual lands on the same item every time this is re-run
 * (used both at checkout-creation, with an estimate, and again at webhook
 * time, with Stripe's real fee — see Part 24).
 */
export function allocateProportionally(
  items: AllocatableItem[],
  totalFee: number
): Map<string, number> {
  const result = new Map<string, number>();
  if (items.length === 0 || totalFee <= 0) {
    items.forEach((i) => result.set(i.id, 0));
    return result;
  }

  const sumChargeable = items.reduce((sum, i) => sum + i.chargeableValue, 0);
  if (sumChargeable <= 0) {
    items.forEach((i) => result.set(i.id, 0));
    return result;
  }

  let allocated = 0;
  items.forEach((item, idx) => {
    if (idx === items.length - 1) return; // last item gets the residual below
    const share = round2(totalFee * (item.chargeableValue / sumChargeable));
    result.set(item.id, share);
    allocated += share;
  });
  const last = items[items.length - 1];
  result.set(last.id, round2(totalFee - allocated));

  return result;
}
