# Highperlocal Bootstrap

This directory is intentionally **outside** `supabase/migrations/`, so it can
never be picked up and applied automatically by the normal FindMi migration
sequence (Supabase CLI / `apply_migration` tooling only scans
`supabase/migrations/`).

## What this is

`000_current_schema.sql` is a **schema-only, current-state snapshot** of
FindMi's live production database structure — captured via read-only
introspection (`pg_catalog` / `information_schema`, using
`pg_get_constraintdef` / `pg_get_indexdef` / `pg_get_functiondef` /
`pg_get_triggerdef` / `pg_get_viewdef` for exact fidelity) against FindMi's
Supabase project immediately before this file was written.

It represents **the database structure the application currently expects**
— tables, columns, defaults, constraints, indexes, functions, triggers, RLS,
and grants — as they exist **today**, after FindMi's 43 historical
migrations have already been applied and merged into one coherent final
shape. It is **not** a replay of those 43 migrations, and it does not
contain any row data, secrets, or FindMi-specific configuration content.

## Targets — read this before running anything

- **Approved target: `ewwctvowukrwqzuqfttq`** (the Highperlocal Supabase
  project) — a **new, empty** project only.
- **This file must NEVER be applied to FindMi's production project,
  `drcbrzwchlirfspjgtik`.** That project already has this exact schema (it's
  where this file was captured from) — applying it there would fail on
  every `create table`/`create policy`/etc. that already exists, or worse,
  partially apply before failing.
- Because this file represents the **final, current** schema state, **the
  prior 43 migrations in `supabase/migrations/` must NOT be replayed
  afterward** against the same (Highperlocal) project — they would
  duplicate columns/constraints/policies/functions this file already
  creates, or fail outright on the first `create table` that already
  exists. Those 43 files remain FindMi's own historical record; they are
  not a second bootstrap step for Highperlocal.

## What follows this file

**`../migrations/20260908200000_highperlocal_location_classification_and_manual_review.sql`**
runs **after** this bootstrap, and only because its columns are confirmed
**not** already present in it:

- `locations.classification`
- `appearances.location_id`
- `businesses.ownership_verification_status` / `ownership_verified_at` /
  `ownership_verification_note`
- `businesses.payment_confirmation_status` / `payment_confirmed_at` /
  `payment_confirmation_note`

This was verified directly against FindMi's live schema before writing
`000_current_schema.sql` — none of the six columns above exist there today.
Applying the bootstrap first and that migration second is therefore
additive and non-duplicating, in that order, on `ewwctvowukrwqzuqfttq` only.

## What's still separate from both SQL files

- **Storage buckets** (business/product/event/location images) — created
  via the Supabase Dashboard/Storage API, not SQL migrations. Not present
  in FindMi's tracked migration history either.
- **Auth configuration** (redirect URLs, email templates, providers) —
  Dashboard/Auth-API configuration, not SQL.
- **Extensions** (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`,
  `supabase_vault`) — every current Supabase project ships these enabled by
  default; `000_current_schema.sql` defensively re-asserts `pgcrypto` with
  `IF NOT EXISTS` (needed for `gen_random_uuid()`) but doesn't depend on
  running that statement for anything else to work.
- **Configuration table content** — the bootstrap creates the *tables* for
  `categories`, `markets`, `market_areas`, `plan_market_limits`,
  `membership_plans`, `nav_items`, `site_sections`, `homepage_rows`, and
  `forms`, but seeds **zero rows** into any of them. Highperlocal needs its
  own values here before the app is fully usable — see the pass's report
  for the full list.

## Verifying grant parity

Section 11 of the bootstrap reproduces the specific grant *narrowings*
found in FindMi's live schema (e.g. `businesses`/`products`' column-level
SELECT restriction) on top of the Supabase platform's own default
privileges, which every new project — including Highperlocal's — is
assumed to already have. After applying this file, it's worth re-running
the same read-only grant-introspection query used to write it against
`ewwctvowukrwqzuqfttq`, to confirm its default privileges actually match
what this bootstrap assumes:

```sql
select table_name, grantee, string_agg(distinct privilege_type, ',') as privs
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated','service_role')
group by table_name, grantee
order by table_name, grantee;
```
