import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Recurring Billing Pass 2A — resolves an authenticated FindMi user to
// their dedicated recurring-subscription Stripe Customer, backed by
// public.stripe_customers (Pass 1). Deliberately independent of
// memberships.stripe_customer_id (a different, legacy Stripe account/
// concern) and never persists a Customer ID onto profiles or businesses —
// a Customer belongs to a user, not a business (see Pass 1's own
// migration comment).

/** Thrown for a genuine, non-race database failure while resolving/
 * persisting a Stripe Customer mapping. Callers must treat this as fail-
 * closed: never proceed into Checkout Session creation with an unpersisted
 * billing identity. */
export class SubscriptionCustomerPersistError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SubscriptionCustomerPersistError";
  }
}

interface ResolveSubscriptionCustomerParams {
  admin: SupabaseClient;
  stripe: Stripe;
  livemode: boolean;
  userId: string;
  /** The authenticated Supabase session's own current email — never a
   * client-submitted value, never fabricated when absent. */
  userEmail: string | null | undefined;
}

/** Looks up (or lazily creates) the dedicated recurring-subscription
 * Stripe Customer for one FindMi user in one Stripe mode.
 *
 * Algorithm (see this pass's report for the full failure-mode reasoning):
 *  1. Look up stripe_customers WHERE user_id = userId AND livemode =
 *     livemode. If found, return that Customer ID as-is — no existence
 *     re-check against Stripe on every call; a locally-mapped Customer
 *     that no longer exists in Stripe is an explicit, separate failure
 *     mode this pass fails closed on (see Checkout error handling), not
 *     silently papered over here by creating a second Customer.
 *  2. Otherwise, best-effort read profiles.display_name (never required —
 *     Customer creation must still succeed with no name/no email).
 *  3. Create a Stripe Customer in the DEDICATED subscription account with
 *     a deterministic idempotency key scoped to (userId, livemode, this
 *     operation) — never a random UUID, never a key containing mutable
 *     fields like email/name — so a network retry or a concurrent
 *     duplicate call resolves to the SAME underlying Stripe object rather
 *     than creating two.
 *  4. Persist {user_id, livemode, stripe_customer_id} to stripe_customers.
 *     The table's own UNIQUE/PRIMARY KEY constraints are the authoritative
 *     race guard: if a concurrent request already won (23505 unique
 *     violation), re-read and use ITS stored Customer ID rather than the
 *     one this call just created — the two calls raced on Stripe too (via
 *     the same idempotency key) but there's no guarantee this process
 *     observed the same response ordering as the DB, so the DB row is
 *     authoritative, not whichever Stripe response landed first locally.
 *     Any other persistence failure throws SubscriptionCustomerPersistError
 *     — fail closed, never continue into Checkout unpersisted.
 */
export async function resolveSubscriptionStripeCustomerId({
  admin,
  stripe,
  livemode,
  userId,
  userEmail,
}: ResolveSubscriptionCustomerParams): Promise<string> {
  const { data: existing, error: lookupError } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .eq("livemode", livemode)
    .maybeSingle();

  if (lookupError) {
    throw new SubscriptionCustomerPersistError("Couldn't look up your billing account. Please try again.", lookupError);
  }
  if (existing) return existing.stripe_customer_id;

  // Best-effort only — a missing/unreadable display name must never block
  // Customer creation.
  let displayName: string | null = null;
  try {
    const { data: profile } = await admin.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    displayName = profile?.display_name?.trim() || null;
  } catch {
    displayName = null;
  }

  // Deterministic, stable (no time component) — this Customer, once
  // created for this user in this mode, should never be duplicated by a
  // retry, however long after the original attempt. Contains no mutable
  // fields (email/name live in the request body, not the key).
  const idempotencyKey = `findmi_subscription_customer_create:${userId}:${livemode ? "live" : "test"}`;

  let created: Stripe.Customer;
  try {
    created = await stripe.customers.create(
      {
        ...(userEmail ? { email: userEmail } : {}),
        ...(displayName ? { name: displayName } : {}),
        metadata: { findmi_user_id: userId },
      },
      { idempotencyKey }
    );
  } catch (err) {
    throw new SubscriptionCustomerPersistError("Couldn't set up your billing account. Please try again.", err);
  }

  const { error: insertError } = await admin.from("stripe_customers").insert({
    user_id: userId,
    livemode,
    stripe_customer_id: created.id,
  });

  if (!insertError) return created.id;

  // 23505 = unique_violation — a concurrent request already won this exact
  // (user_id, livemode) race. Re-read and defer to the authoritative
  // stored mapping rather than the Customer this call happened to create.
  if (insertError.code === "23505") {
    const { data: winner, error: rereadError } = await admin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("livemode", livemode)
      .maybeSingle();
    if (rereadError || !winner) {
      throw new SubscriptionCustomerPersistError("Couldn't finalize your billing account. Please try again.", rereadError);
    }
    return winner.stripe_customer_id;
  }

  // An unexpected DB failure with a real Stripe Customer already created
  // and NOT persisted anywhere. Fail closed rather than continuing into
  // Checkout with an orphaned/unpersisted Customer ID.
  throw new SubscriptionCustomerPersistError("Couldn't save your billing account. Please try again.", insertError);
}
