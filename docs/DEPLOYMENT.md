# Deployment and Reconciliation

Deployment starts with reconciliation, not implementation.

## Known facts

- Hosting: Vercel, Git-integrated with the public GitHub repo
  `findmiapp/Findmi`. Vercel posts a GitHub Deployment for every build, so
  `GET https://api.github.com/repos/findmiapp/Findmi/deployments` (no auth
  needed) is the readable record of what's deployed.
- **Production branch: `claude/findmi-mvp-marketplace-3tvcik`.** That's
  the repo's GitHub default branch, and every Production deployment SHA is
  that branch's tip at the time. (Inferred from deployment records, since
  the Vercel project setting isn't readable from here. It's consistent
  with every record.)
- **Production deploys automatically when that branch is pushed.**
  "Manual" means a human-approved fast-forward of the default branch.
  Pattern: work is pushed to a session branch (`ccr-*` / `claude/*`) →
  Vercel builds a **Preview** for every push to any branch → after
  approval, the default branch is fast-forwarded → Vercel builds
  **Production** (for example, preview `aa7d1e2` at 15:10, production
  `aa7d1e2` at 15:41 on 2026-10-29).
- Preview URLs follow `findmi-<hash>-findmiapp-7326s-projects.vercel.app`.
  The repo's listed homepage is `https://findmi-one.vercel.app`. The public
  domain is `findmi.app`. This sandbox can't fetch `findmi.app` because
  it's outside the session network allowlist.
- As of 2026-10-29 17:20 UTC, production is running **`aa7d1e2`**.
  `3b2f195` (the docs pass) has a **Preview only** and isn't in
  production.
- Until about 2026-10-28 12:05 UTC, two Vercel projects (`findmi` and
  `highperlocal`) built from this repo. After that, deployments carry
  unsuffixed `Preview` / `Production` environment names, which is
  consistent with only one project still being connected.
- Sessions work on an assigned feature branch and push only there. They
  never push the default branch without approval.
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

## Rollback

There's no documented or observed rollback procedure. Two options exist:

1. **Vercel Instant Rollback.** In the Vercel dashboard, promote a
   previous Production deployment. It's fast, and Git is untouched, so the
   default branch and production will then differ until it's reconciled.
2. **`git revert`** on the default branch, then push. Production rebuilds
   automatically. This keeps Git and production in sync. Never reset or
   force-push the default branch.

Which one is preferred is the founder's call. **[VERIFY]**

## Still to establish — [VERIFY]

CI (there's none in the repo: no `.github/` directory), the preferred
rollback option, and the Vercel project settings themselves (production
branch, env vars). Only the founder can read those.
