"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { respondToOpportunityListing } from "@/lib/opportunity-listings";
import { isBusinessResponseStatus } from "@/lib/opportunity-listings-domain";

/** Business response to a commercial Opportunity (I'm Interested / Not
 * Interested). Every rule is enforced server-side by
 * respondToOpportunityListing: membership of THIS Business, owner/manager
 * only, never Admin Manage-As, verified email, the recipient row must
 * belong to this Business, listing open, canonical transition. Nothing
 * here trusts the bound ids beyond that. No email/notification is sent. */
export async function respondToOpportunity(businessId: string, recipientId: string, response: string) {
  const detail = `/account/business/${businessId}/opportunities/${recipientId}`;
  if (!isBusinessResponseStatus(response)) redirect(`${detail}?error=${encodeURIComponent("That response isn't available.")}`);

  let result: Awaited<ReturnType<typeof respondToOpportunityListing>>;
  try {
    result = await respondToOpportunityListing({ businessId, recipientId, response });
  } catch (err) {
    redirect(`/account?error=${encodeURIComponent(err instanceof Error ? err.message : "You don't have access to that business.")}`);
  }
  if (!result.ok) redirect(`${detail}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(detail);
  revalidatePath(`/account/business/${businessId}`);
  redirect(`${detail}?responded=${response}`);
}
