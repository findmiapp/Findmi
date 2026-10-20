# JerseyCity.guide local preview

Review JerseyCity.guide (the real Findmi pages built with `SITE=jc`)
populated with Jersey City content, without touching Production data or
any Supabase project.

```
Postgres (temporary cluster) ← schema.sql     Production public schema, read-only catalog snapshot
                             ← reference.sql  markets/areas/categories + Findmi editorial config, copied read-only
                             ← fixture.sql    FICTIONAL Jersey City content (+ a few out-of-scope control rows)
PostgREST :54330 → proxy.mjs :54321  (Supabase-shaped /rest/v1, no auth)
```

Requires PostgreSQL 16 server binaries (`initdb`, `pg_ctl`, `psql`), `curl`
and Node. PostgREST is downloaded on first run.

1. Start the local API (keep it running):

   ```
   scripts/jc-preview/start.sh
   ```

2. In another shell, from the repo root, build and start the app against it:

   ```
   export SITE=jc \
     NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
     NEXT_PUBLIC_SUPABASE_ANON_KEY=$(cat scripts/jc-preview/keys/anon.jwt) \
     SUPABASE_SERVICE_ROLE_KEY=$(cat scripts/jc-preview/keys/service_role.jwt)
   npm run build && npm start
   ```

   Open http://localhost:3000. Omit `SITE=jc` to see Findmi itself on the
   same data (the control rows then appear, as they should on Findmi).

The keys in `keys/` are signed with a local-only secret and only work
against this throwaway database. Data is regenerated on every start, with
dates relative to today; stopping `start.sh` discards it.
