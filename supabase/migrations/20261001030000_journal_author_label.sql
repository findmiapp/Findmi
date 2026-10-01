-- Journal Pass 1 — nullable author attribution ("By Findmi", etc).
--
-- A single nullable text column, not an author/publisher/organization
-- system — see the completed Journal audit's own Section H for why this is
-- the correct V1 scope: no profiles table change, no polymorphic author
-- model, no business/consumer authorship modes. When set, the public
-- entry renders "By {author_label}"; when null (every existing row today),
-- nothing renders — fully additive, no backfill required.
--
-- No RLS change needed: every existing journal_entries policy (owner
-- select/insert/update/delete, public select of a published+public row)
-- already operates at full-row granularity via `select("*")`/`using(...)`
-- with no column list, so this new column is automatically covered by
-- those same policies the instant it exists.
alter table public.journal_entries
  add column if not exists author_label text;
