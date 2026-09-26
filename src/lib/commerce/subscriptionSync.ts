import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { notifyAdmin } from "@/lib/notifications/adminNotify";
import { getSubscriptionStripe } from "./subscriptionStripe";
import { resolvePlanFromPriceId } from "./subscriptionPriceReverse";

// Recurring Billing Pass 2B — the one reusable synchronization function.
// The dedicated webhook route calls this; a future admin reconciliation
// action (not built in this pass) should call the exact same function
// rather than duplicating any of this logic.
//
// Design principle throughout: canonical Stripe retrieval is the sole
// source of truth for subscription STATE. The webhook event that
// triggered a given call only ever supplies an id to re-fetch and two
// purely observational fields (event id/created, persisted on the row for
// debugging only — never used to accept or reject a write; see the
// migration's own comment on why event.created must never gate a write:
// an older event can easily retrieve NEWER canonical state, so rejecting
// a write because ITS triggering event looks "older" would be logically
// wrong). Ordering/concurrency correctness instead comes from a
// transaction-scoped Postgres advisory lock inside sync_subscription_from_
// stripe(), keyed on (livemode, stripe_subscription_id).

const GRANTING_STATUSES = new Set(["active", "trialing", "past_due"]);

export type SubscriptionSyncOutcome =
  | { outcome: "applied"; mirrorOutcome: string }
  | { outcome: "duplicate_active_subscription" }
  | { outcome: "anomaly_missing_customer_mapping" }
  | { outcome: "anomaly_customer_user_mismatch" }
  | { outcome: "anomaly_missing_business_metadata" }
  | { outcome: "anomaly_unsupported_item_shape" }
  | { outcome: "anomaly_unresolvable_price" };

interface AnomalyParams {
  anomalyType: string;
  eventId: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  businessId?: string | null;
  payerUserId?: string | null;
  livemode: boolean;
  details: Record<string, unknown>;
}

/** Durably persists a billing anomaly. Idempotent against the SAME Stripe
 * event redelivering the SAME anomaly type (the migration's partial
 * unique index on (anomaly_type, stripe_event_id) absorbs that as a
 * 23505, treated as a safe no-op here). Any OTHER persistence failure is
 * a genuine transient problem and is NEVER swallowed — it propagates so
 * the webhook route responds 5xx and Stripe retries the whole event,
 * giving this anomaly another chance to be durably recorded rather than
 * silently existing only in a console log. Never stores anything beyond
 * safe identifiers and the caller-controlled `details` object — no card/
 * payment-method data, no full Stripe Customer object, no raw webhook
 * body ever flows into `details`. */
async function recordAnomaly(admin: SupabaseClient, params: AnomalyParams): Promise<void> {
  const { error } = await admin.from("billing_sync_anomalies").insert({
    anomaly_type: params.anomalyType,
    stripe_event_id: params.eventId,
    stripe_subscription_id: params.subscriptionId ?? null,
    stripe_customer_id: params.customerId ?? null,
    business_id: params.businessId ?? null,
    payer_user_id: params.payerUserId ?? null,
    livemode: params.livemode,
    details: params.details,
  });
  if (error && error.code !== "23505") {
    throw new Error(`Failed to persist billing anomaly "${params.anomalyType}": ${error.message}`);
  }
}

/** Retrieves the CANONICAL current Subscription from Stripe, validates it
 * against local billing state, resolves its Price to a canonical plan/
 * interval, and calls the atomic sync_subscription_from_stripe() RPC.
 * Every anomaly is durably recorded (never console-log-only) before this
 * returns a non-throwing result — a caller (the webhook route) may treat
 * any returned SubscriptionSyncOutcome as safe to acknowledge 2xx. A
 * thrown error means a transient failure occurred (Stripe unreachable,
 * Supabase unavailable, anomaly persistence itself failed) and the caller
 * must respond 5xx so Stripe retries. */
export async function syncSubscriptionFromStripe(
  subscriptionId: string,
  eventId: string,
  eventCreated: Date,
  eventLivemode: boolean
): Promise<SubscriptionSyncOutcome> {
  const stripe = getSubscriptionStripe();
  const admin = getAdminSupabase();
  if (!stripe || !admin) {
    throw new Error("Recurring billing sync is not configured (missing dedicated Stripe client or Supabase admin client).");
  }

  // Always fetch fresh — never trust the embedded event payload object,
  // regardless of which of the 3 subscribed event types triggered this
  // call. This is what makes out-of-order delivery harmless: every
  // invocation converges on the SAME current truth.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const { data: mapping, error: mappingError } = await admin
    .from("stripe_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .eq("livemode", eventLivemode)
    .maybeSingle();
  if (mappingError) throw new Error(`Failed to look up Stripe Customer mapping: ${mappingError.message}`);

  if (!mapping) {
    await recordAnomaly(admin, {
      anomalyType: "missing_customer_mapping",
      eventId,
      subscriptionId,
      customerId,
      livemode: eventLivemode,
      details: { reason: "No stripe_customers row for this Customer in this Stripe mode" },
    });
    return { outcome: "anomaly_missing_customer_mapping" };
  }

  const metaUserId = subscription.metadata.findmi_user_id;
  if (!metaUserId || metaUserId !== mapping.user_id) {
    await recordAnomaly(admin, {
      anomalyType: "customer_user_mismatch",
      eventId,
      subscriptionId,
      customerId,
      payerUserId: mapping.user_id,
      livemode: eventLivemode,
      details: { metadataUserId: metaUserId ?? null, mappedUserId: mapping.user_id },
    });
    return { outcome: "anomaly_customer_user_mismatch" };
  }

  const businessId = subscription.metadata.findmi_business_id;
  if (!businessId) {
    await recordAnomaly(admin, {
      anomalyType: "missing_business_metadata",
      eventId,
      subscriptionId,
      customerId,
      payerUserId: mapping.user_id,
      livemode: eventLivemode,
      details: {},
    });
    return { outcome: "anomaly_missing_business_metadata" };
  }

  const items = subscription.items.data;
  const singleItem = items.length === 1 ? items[0] : null;
  if (!singleItem || singleItem.quantity !== 1) {
    await recordAnomaly(admin, {
      anomalyType: "unsupported_subscription_item_shape",
      eventId,
      subscriptionId,
      customerId,
      businessId,
      payerUserId: mapping.user_id,
      livemode: eventLivemode,
      details: { itemCount: items.length, quantity: singleItem?.quantity ?? null },
    });
    return { outcome: "anomaly_unsupported_item_shape" };
  }

  const priceId = singleItem.price.id;
  const resolved = resolvePlanFromPriceId(priceId);
  if (!resolved) {
    await recordAnomaly(admin, {
      anomalyType: "unresolvable_price",
      eventId,
      subscriptionId,
      customerId,
      businessId,
      payerUserId: mapping.user_id,
      livemode: eventLivemode,
      details: { priceId },
    });
    return { outcome: "anomaly_unresolvable_price" };
  }

  // Price ID is authoritative — a metadata disagreement is recorded for
  // visibility but never blocks a valid, known Price.
  if (subscription.metadata.findmi_plan !== resolved.plan || subscription.metadata.findmi_interval !== resolved.interval) {
    await recordAnomaly(admin, {
      anomalyType: "metadata_price_mismatch",
      eventId,
      subscriptionId,
      customerId,
      businessId,
      payerUserId: mapping.user_id,
      livemode: eventLivemode,
      details: {
        metadataPlan: subscription.metadata.findmi_plan ?? null,
        metadataInterval: subscription.metadata.findmi_interval ?? null,
        priceResolvedPlan: resolved.plan,
        priceResolvedInterval: resolved.interval,
      },
    });
  }

  const currentPeriodEnd = GRANTING_STATUSES.has(subscription.status)
    ? new Date(singleItem.current_period_end * 1000).toISOString()
    : null;

  const latestInvoice = subscription.latest_invoice;
  const latestInvoiceStatus =
    latestInvoice && typeof latestInvoice === "object" ? latestInvoice.status ?? null : null;

  const { data: rpcResult, error: rpcError } = await admin.rpc("sync_subscription_from_stripe", {
    p_business_id: businessId,
    p_payer_user_id: mapping.user_id,
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscription.id,
    p_stripe_price_id: priceId,
    p_commercial_plan: resolved.plan,
    p_billing_interval: resolved.interval,
    p_status: subscription.status,
    p_current_period_end: currentPeriodEnd,
    p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    p_latest_invoice_status: latestInvoiceStatus,
    p_livemode: eventLivemode,
    p_event_id: eventId,
    p_event_created: eventCreated.toISOString(),
  });
  if (rpcError) throw new Error(`sync_subscription_from_stripe RPC failed: ${rpcError.message}`);

  const result = rpcResult as { applied: boolean; duplicate_active_subscription: boolean; mirror_outcome: string };

  if (result.duplicate_active_subscription) {
    await recordAnomaly(admin, {
      anomalyType: "duplicate_active_subscription",
      eventId,
      subscriptionId,
      customerId,
      businessId,
      payerUserId: mapping.user_id,
      livemode: eventLivemode,
      details: { stripePriceId: priceId, commercialPlan: resolved.plan, billingInterval: resolved.interval, status: subscription.status },
    });
    await notifyAdmin({
      subject: "Duplicate active recurring subscription detected",
      heading: "Two active Stripe subscriptions for one business",
      body: [
        `Business: ${businessId}`,
        `New subscription (not synced locally): ${subscriptionId}`,
        "This business already has a different subscription in an active/trialing/past_due/paused state — the existing local record was preserved and left untouched.",
        "Manual reconciliation is required in the Stripe Dashboard (decide which subscription to keep/cancel/refund). No automatic cancellation or refund was performed.",
      ],
      actionLabel: "View Business",
      actionUrl: `/admin/businesses/${businessId}`,
    });
    return { outcome: "duplicate_active_subscription" };
  }

  return { outcome: "applied", mirrorOutcome: result.mirror_outcome };
}
