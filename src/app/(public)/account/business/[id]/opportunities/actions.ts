"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { expressExploreInterest, respondToOpportunityListing } from "@/lib/opportunity-listings";
import { isBusinessResponseStatus } from "@/lib/opportunity-listings-domain";
import { createBusinessGoal, setBusinessGoalStatus, updateBusinessGoal } from "@/lib/opportunity-goals";
import { isGoalStatus, type GoalFormInput } from "@/lib/opportunity-goals-domain";

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

/** "I'm Interested" on an Explore listing (no existing relationship).
 * Every rule is enforced by expressExploreInterest. No email/notification. */
export async function expressInterestFromExplore(businessId: string, listingId: string) {
  const back = `/account/business/${businessId}/opportunities/explore/${listingId}`;
  let result: Awaited<ReturnType<typeof expressExploreInterest>>;
  try {
    result = await expressExploreInterest({ businessId, listingId });
  } catch (err) {
    redirect(`/account?error=${encodeURIComponent(err instanceof Error ? err.message : "You don't have access to that business.")}`);
  }
  if (!result.ok) redirect(`${back}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(`/account/business/${businessId}`);
  redirect(`/account/business/${businessId}/opportunities/${result.recipientId}?responded=interested`);
}

// ---------------------------------------------------------------- goals

export type GoalFormState = { error: string | null };

function readGoalForm(formData: FormData): GoalFormInput {
  const s = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : null;
  };
  const all = (k: string) => formData.getAll(k).filter((v): v is string => typeof v === "string");
  return {
    title: s("title"),
    objectives: all("objectives"),
    opportunity_interests: all("opportunity_interests"),
    audience_text: s("audience_text"),
    market_ids: all("market_ids"),
    markets_text: s("markets_text"),
    budget_band: s("budget_band"),
    timing: s("timing"),
    starts_on: s("starts_on"),
    ends_on: s("ends_on"),
    notes: s("notes"),
  };
}

/** Create (goalId null) or edit a goal. Returns an error state for the
 * wizard to show in place (keeping every answer); redirects on success.
 * Authorization/validation live in lib/opportunity-goals.ts. */
export async function submitGoal(businessId: string, goalId: string | null, _prev: GoalFormState, formData: FormData): Promise<GoalFormState> {
  let result: Awaited<ReturnType<typeof createBusinessGoal>>;
  try {
    result = goalId ? await updateBusinessGoal(businessId, goalId, readGoalForm(formData)) : await createBusinessGoal(businessId, readGoalForm(formData));
  } catch (err) {
    redirect(`/account?error=${encodeURIComponent(err instanceof Error ? err.message : "You don't have access to that business.")}`);
  }
  if (!result.ok) return { error: result.error };
  revalidatePath(`/account/business/${businessId}`);
  redirect(
    goalId
      ? `/account/business/${businessId}?tab=opportunities&view=goals&goal=saved`
      : `/account/business/${businessId}/opportunities/goals/new?created=${result.goalId}`
  );
}

export async function changeGoalStatus(businessId: string, goalId: string, next: string) {
  const back = `/account/business/${businessId}?tab=opportunities&view=goals`;
  if (!isGoalStatus(next)) redirect(`${back}&error=${encodeURIComponent("That change isn't available.")}`);
  let result: Awaited<ReturnType<typeof setBusinessGoalStatus>>;
  try {
    result = await setBusinessGoalStatus(businessId, goalId, next);
  } catch (err) {
    redirect(`/account?error=${encodeURIComponent(err instanceof Error ? err.message : "You don't have access to that business.")}`);
  }
  if (!result.ok) redirect(`${back}&error=${encodeURIComponent(result.error)}`);
  revalidatePath(`/account/business/${businessId}`);
  redirect(`${back}&goal=${next}`);
}
