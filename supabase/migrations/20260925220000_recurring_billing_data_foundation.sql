-- Recurring Billing Pass 1 — billing data foundation.
--
-- Purely additive: two new tables, zero ALTERs on any existing table.
-- Implements the design from the recurring-billing architecture audit
-- and its Pass 1A follow-up (customer identity + entitlement
-- provenance), including the test/live mode-scoping correction that
-- follow-up made: Preview and Production currently share one Supabase
-- project, and Stripe test/live objects have independent identities, so
-- livemode must be a real component of every uniqueness/identity
-- constraint here, not observational metadata bolted on afterward.
--
-- NOT wired to anything yet — no checkout code, no webhook code, no
-- entitlement-resolver change. businesses.plan_tier/plan_source/
-- plan_started_at/plan_expires_at/plan_payment_reference/
-- stripe_account_id/stripe_connect_status are all untouched by this
-- migration; isBusinessPro() still reads only those columns.

-- ---------------------------------------------------------------------
-- stripe_customers — one row per (FindMi user, Stripe mode). A user can
-- legitimately hold both a test-mode and a live-mode Stripe Customer at
-- once, hence PRIMARY KEY (user_id, livemode) rather than (user_id)
-- alone.
-- ---------------------------------------------------------------------
create table public.stripe_customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  livemode boolean not null,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, livemode),
  unique (stripe_customer_id, livemode),
  -- Composite candidate key — lets business_subscriptions below carry a
  -- composite FK tying payer_user_id + stripe_customer_id + livemode to
  -- this exact mapping, so "payer_user_id = A but stripe_customer_id
  -- actually belongs to B" becomes structurally unrepresentable rather
  -- than only application-enforced. Reasoned through for deletion/
  -- ordering safety — see business_subscriptions' own comment below and
  -- this migration's accompanying report for why it's safe to add.
  unique (user_id, stripe_customer_id, livemode)
);

comment on table public.stripe_customers is
  'One Stripe Customer per FindMi user per Stripe mode (test/live). Service-role only for now: RLS enabled, zero anon/authenticated policies. Deliberately no email (lives in auth.users), no business_id (a Customer belongs to a user, not a business — see the ownership-model audit), no payment-method data.';

alter table public.stripe_customers enable row level security;

create trigger trg_stripe_customers_updated_at
  before update on public.stripe_customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- business_subscriptions — mirrors Stripe subscription state per
-- business. business_id is who RECEIVES the entitlement; payer_user_id
-- is who OWNS the Stripe billing relationship — deliberately separate,
-- since business ownership (business_members) can change while the
-- original payer keeps paying, and business_members.role is already
-- observed in production to sometimes have zero 'owner' rows for a
-- business, so ownership can't be assumed to reliably identify a payer.
-- ---------------------------------------------------------------------
create table public.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Deliberately NOT ON DELETE CASCADE, and NOT nullable. A FindMi
  -- account deletion must never silently destroy the historical
  -- subscription record — a real financial record. Default FK behavior
  -- (NO ACTION / RESTRICT) means a user who has ever been a
  -- subscription payer cannot be hard-deleted from auth.users while
  -- that row exists, on purpose: the delete is blocked outright rather
  -- than the row being silently orphaned or the history silently lost.
  -- Reassigning/anonymizing payer_user_id ahead of a deletion is a
  -- future concern, out of scope for this pass.
  payer_user_id uuid not null references auth.users(id),
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  stripe_price_id text not null,
  commercial_plan text not null check (commercial_plan in ('pro', 'managed_pro')),
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  -- Intentionally NOT CHECK-constrained. Stripe's own installed SDK
  -- types Subscription.Status as an open union (with an OtherString
  -- escape hatch) for forward compatibility with future Stripe
  -- statuses. The one place a fixed status list is meaningful here is
  -- the partial unique index below, which encodes a deliberate business
  -- decision (which statuses count as "blocking"), not a data-integrity
  -- fact about what Stripe can ever send.
  status text not null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz null,
  latest_invoice_status text null,
  livemode boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_subscription_id, livemode),
  -- Ties payer_user_id + stripe_customer_id + livemode to the SAME
  -- stripe_customers mapping — see that table's own composite UNIQUE.
  -- Reasoned safe: this pass writes zero rows into either table, so
  -- there is no ordering/race concern yet; for the future webhook path,
  -- the Customer is always resolved-or-created before a Checkout
  -- Session (and therefore before any Subscription) can exist, so a
  -- stripe_customers row is guaranteed to already exist by the time any
  -- business_subscriptions row would reference it. Deletion behavior:
  -- this FK defaults to RESTRICT, same as payer_user_id's own direct FK
  -- above — it adds no new deletion-blocking behavior beyond what that
  -- direct FK already causes (both independently prevent hard-deleting
  -- a user with subscription history; they agree, they don't conflict).
  constraint business_subscriptions_payer_customer_fkey
    foreign key (payer_user_id, stripe_customer_id, livemode)
    references public.stripe_customers (user_id, stripe_customer_id, livemode)
);

comment on table public.business_subscriptions is
  'Mirrors Stripe subscription state per business. NOT yet wired to entitlement resolution (isBusinessPro() is untouched) — see the recurring-billing audit for the forward-only sync algorithm a future pass will implement. Service-role only for now: RLS enabled, zero anon/authenticated policies.';

alter table public.business_subscriptions enable row level security;

create index business_subscriptions_business_id_idx
  on public.business_subscriptions (business_id);

create index business_subscriptions_payer_user_id_idx
  on public.business_subscriptions (payer_user_id);

create index business_subscriptions_customer_livemode_idx
  on public.business_subscriptions (stripe_customer_id, livemode);

-- At most one BLOCKING subscription per business per Stripe mode, so a
-- test-mode subscription can never prevent a live-mode one (or vice
-- versa) for the same business. 'incomplete'/'incomplete_expired'/
-- 'unpaid'/'canceled' are deliberately excluded from the blocking set:
-- 'incomplete' must stay retryable (Stripe itself auto-expires it within
-- ~23h regardless); 'unpaid' is not reliably terminal in Stripe's own
-- lifecycle without account-specific Dashboard dunning configuration, so
-- it must not trap a customer unable to start a working subscription.
create unique index business_subscriptions_one_active_per_business_mode
  on public.business_subscriptions (business_id, livemode)
  where status in ('active', 'trialing', 'past_due', 'paused');

create trigger trg_business_subscriptions_updated_at
  before update on public.business_subscriptions
  for each row execute function public.set_updated_at();
