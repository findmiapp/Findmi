"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markAllSignalsReviewed, markSignalReviewed } from "@/lib/brand-intelligence";

// Admin → Opportunities → Intelligence review actions. lib/brand-intelligence.ts
// runs requireAdmin() first in every function.

const PAGE = "/admin/opportunities/intelligence";

function back(returnTo: string, params: Record<string, string>) {
  const base = returnTo.startsWith(PAGE) ? returnTo : PAGE;
  const query = new URLSearchParams(params).toString();
  return query ? `${base}${base.includes("?") ? "&" : "?"}${query}` : base;
}

export async function markReviewed(type: string, id: string, returnTo: string) {
  const result = await markSignalReviewed(type, id);
  revalidatePath("/admin", "layout");
  if (!result.ok) redirect(back(returnTo, { error: result.error }));
  redirect(back(returnTo, {}));
}

export async function markAllReviewed(returnTo: string) {
  const result = await markAllSignalsReviewed();
  revalidatePath("/admin", "layout");
  if (!result.ok) redirect(back(returnTo, { error: result.error }));
  redirect(back(returnTo, { reviewed: "all" }));
}
