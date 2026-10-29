# Deployment and Reconciliation

Deployment starts with reconciliation, not implementation.

## Known facts

- Hosting: Vercel. The production branch mapping isn't in the repo:
  **[VERIFY]** in the Vercel dashboard. Sessions work on an assigned
  feature branch and push only there.
- The sandbox can't reach production Supabase or Vercel over HTTP (see
  `/CLAUDE.md` §6). Database work goes through Supabase MCP. Live page
  verification is done by the user.

## Before implementing

1. `git status`, current branch, HEAD. Check divergence from the other
   active branches.
2. Read the relevant `/docs` and search for existing implementations.
3. For schema work: inspect the live schema (`list_tables` /
   `execute_sql`) and the latest repo migrations.

## Verification before push

- `npm run build` (includes type-check) and `npm run lint`.
- `npm test`. Baseline on 2026-10-29: 3465 tests, **1 known pre-existing
  failure** (`tests/guest-moment-reload.test.mjs:237`). Report any other
  failure as yours until proven otherwise.
- Re-read your own diff: no accidental migrations, dependency changes or
  config changes in a UI-only change.
- Responsive QA at 360/390/412px for UI work.

## Migrations

- Additive by default. Nothing destructive without explicit approval and
  rationale.
- Apply with `mcp__Supabase__apply_migration` **and** commit the same SQL
  as `supabase/migrations/<timestamp>_<name>.sql`.
- Write idempotent DDL (`if not exists`, `drop constraint if exists` then
  `add`), as the existing files do.
- **The ledger is incomplete.** As of 2026-10-29, about 33 repo migrations
  (for example `user_collections`, `product_wants`,
  `profile_public_visibility`, `discovery_engine_map_v1`, `taxonomy_v2_*`)
  have live schema but no row in `supabase_migrations.schema_migrations`.
  About 30 early ledger entries have no repo file. To check whether a
  migration is live, query for its objects (columns, tables, functions,
  constraints), never by ledger name. Don't backfill the ledger without
  approval.
- For each migration, call out: new tables/columns, constraint changes,
  RLS and grant effects, backfills.

## Production

The approved pattern is:

- Fast-forward production only. **Never force-push production.**
- Deploy only after approval. Report the resulting SHA and the Vercel
  deployment ID when available.
- Verify production after deploy (the user does this, against the real
  deployment).

Historical example: the October 28 deployment was reconciled to contain
exactly the three approved Business Manager commits before fast-forward.
What matters is the discipline, not those SHAs.

## Env changes

Every new env var goes into `.env.example` with a comment, and is named in
the final report as manual configuration. Server-only secrets never get
a `NEXT_PUBLIC_` prefix.

## Still to establish — [VERIFY]

The production branch, CI (none in repo: no `.github/workflows`), preview
deployment behavior, the rollback procedure, and whether the Highperlocal
Supabase project is used anywhere.
