"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { round2 } from "@/lib/commerce/fees";
import { computeAllocationStatus } from "@/lib/commerce/ledger";
import { errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";

/** Records a manual vendor payout — an accounting entry only, no money
 * actually moves (Part 12). The founder picks one or more unpaid
 * allocations and a total amount, which is applied to those allocations
 * oldest-first; any remainder past what's owed on the last one is simply
 * not applied further (kept as a note case — the UI clamps to what's
 * outstanding, so this only matters if the founder overrides the total). */
export async function recordSettlementPayment(businessId: string, formData: FormData) {
  const path = `/admin/settlements/${businessId}`;
  const supabase = await requireAdminSupabase();

  const allocationIds = formData.getAll("allocation_id").map(String);
  const amount = num(formData, "amount");
  const method = str(formData, "method") ?? "other";
  const paymentDate = str(formData, "payment_date") ?? new Date().toISOString().slice(0, 10);
  const reference = str(formData, "reference");
  const note = str(formData, "note");

  if (allocationIds.length === 0) redirect(errorRedirectUrl(path, "Select at least one order to pay out."));
  if (!amount || amount <= 0) redirect(errorRedirectUrl(path, "Enter a payout amount greater than $0."));

  const { data: payment, error: paymentError } = await supabase
    .from("settlement_payments")
    .insert({ business_id: businessId, amount, payment_date: paymentDate, method, reference, note })
    .select("id")
    .single();
  if (paymentError || !payment) {
    redirect(errorRedirectUrl(path, paymentError?.message ?? "Could not record payment."));
  }

  const { data: allocations } = await supabase
    .from("vendor_order_allocations")
    .select("*")
    .in("id", allocationIds)
    .order("created_at", { ascending: true });

  let remaining = amount as number;
  for (const allocation of allocations ?? []) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, Math.max(0, allocation.amount_outstanding));
    if (applied <= 0) continue;
    remaining = round2(remaining - applied);

    await supabase.from("settlement_payment_allocations").insert({
      settlement_payment_id: payment!.id,
      vendor_order_allocation_id: allocation.id,
      amount_applied: applied,
    });

    const newAmountPaid = round2(allocation.amount_paid + applied);
    const newOutstanding = round2(allocation.amount_outstanding - applied);
    const fullyRefunded = allocation.vendor_net + allocation.refund_adjustment <= 0.005;
    await supabase
      .from("vendor_order_allocations")
      .update({
        amount_paid: newAmountPaid,
        amount_outstanding: newOutstanding,
        status: computeAllocationStatus(newAmountPaid, newOutstanding, fullyRefunded),
        updated_at: new Date().toISOString(),
      })
      .eq("id", allocation.id);
  }

  revalidatePath(path);
  revalidatePath("/admin/settlements");
  redirect(`${path}?paid=1`);
}
