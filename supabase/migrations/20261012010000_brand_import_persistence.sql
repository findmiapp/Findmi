-- Brand Ingestion P2 — durable persistence for Admin bulk Brand Import.
--
-- Purely additive: two new INTERNAL operational tables. Nothing else is
-- touched — not public.businesses, not its RLS policies, not any existing
-- table, function or grant.
--
-- An import candidate is a PROPOSED record built from one submitted
-- website (src/lib/brand-candidate-builder.ts). It is NOT a Business, is
-- never discoverable, and is not canonical truth: `proposal` holds
-- untrusted extracted/AI values that application code validates (typed/
-- Zod candidate boundary) before trusting, and a Business is only ever
-- created/connected after explicit Admin review.
--
-- Access model: server-only, same as opportunity_listings. RLS enabled
-- with ZERO policies and every anon/authenticated privilege revoked;
-- reads/writes go through server code with the service role after
-- requireAdmin (requireAdminSupabase()).
--
-- Status lifecycle (transitions are implemented by application code
-- later; P2 only constrains the vocabulary):
--   queued            persisted, not currently processing
--   processing        a candidate-building worker owns it
--                     (processing_started_at = its lease start)
--   ready             candidate built, awaiting Admin review
--   existing_business matching found a canonical Business already
--   failed            processing failed safely (failure_code); retryable
--   creating          a canonical-create operation has claimed it
--   created           canonical Business creation completed
--   discarded         Admin intentionally rejected it
--
-- Deliberately NOT constrained: status ↔ matched/created Business id
-- consistency. Both links are ON DELETE SET NULL, so such a check would
-- make deleting a Business fail; the links are informational history.

create table public.brand_import_batches (
  id               uuid primary key default gen_random_uuid(),
  -- Inputs submitted in this batch (current product limit: 1–20).
  -- Per-status counts and AI totals are derived from candidates, never
  -- cached here.
  submitted_count  smallint not null
                     constraint brand_import_batches_submitted_count_check
                     check (submitted_count between 1 and 20),
  created_at       timestamptz not null default now()
);

create table public.brand_import_candidates (
  id                              uuid primary key default gen_random_uuid(),
  batch_id                        uuid not null
                                    references public.brand_import_batches(id) on delete cascade,
  -- 1-based input order within the batch.
  position                        smallint not null
                                    constraint brand_import_candidates_position_check
                                    check (position between 1 and 20),
  -- The line as submitted (bounded like the public website input).
  submitted_input                 text not null
                                    constraint brand_import_candidates_submitted_input_check
                                    check (char_length(submitted_input) <= 200 and btrim(submitted_input) <> ''),
  -- Canonical website identity (lib/business-matching normalizeWebsiteHost);
  -- null when the input isn't a usable website.
  normalized_host                 text
                                    constraint brand_import_candidates_normalized_host_check
                                    check (normalized_host is null
                                           or (char_length(normalized_host) between 1 and 253
                                               and normalized_host = lower(normalized_host)
                                               and normalized_host !~ '\s')),

  status                          text not null default 'queued'
                                    constraint brand_import_candidates_status_check
                                    check (status in ('queued', 'processing', 'ready', 'existing_business',
                                                      'failed', 'creating', 'created', 'discarded')),
  -- A safe snake_case code (e.g. too_large, no_metadata, match_failed) —
  -- never a raw error message, URL or page content.
  failure_code                    text
                                    constraint brand_import_candidates_failure_code_check
                                    check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  attempt_count                   smallint not null default 0
                                    constraint brand_import_candidates_attempt_count_check
                                    check (attempt_count >= 0),
  -- Lease start for the worker that owns a `processing` candidate (a
  -- stale lease can be reclaimed, so it must always be set).
  processing_started_at           timestamptz,

  -- The proposed Brand candidate (untrusted; validated by application
  -- code). Null until processing succeeds. Size is bounded on Postgres's
  -- canonical jsonb text form (deterministic; slightly larger than
  -- compact JSON) — a real candidate is a few KB.
  proposal                        jsonb
                                    constraint brand_import_candidates_proposal_check
                                    check (proposal is null
                                           or (jsonb_typeof(proposal) = 'object'
                                               and octet_length(proposal::text) <= 16384)),

  matched_business_id             uuid references public.businesses(id) on delete set null,
  -- A canonical Business is the created result of at most one candidate
  -- (UNIQUE; NULLs are distinct, so any number of candidates have none).
  created_business_id             uuid references public.businesses(id) on delete set null
                                    constraint brand_import_candidates_created_business_key unique,

  -- AI observability (lib/brand-ai-enrichment usage; summed across
  -- attempts by application code). Null = no AI call / unknown — never
  -- a fabricated zero.
  ai_status                       text
                                    constraint brand_import_candidates_ai_status_check
                                    check (ai_status is null or ai_status in ('used', 'skipped', 'failed')),
  ai_model                        text
                                    constraint brand_import_candidates_ai_model_check
                                    check (ai_model is null or char_length(ai_model) between 1 and 100),
  ai_input_tokens                 integer
                                    constraint brand_import_candidates_ai_input_tokens_check
                                    check (ai_input_tokens is null or ai_input_tokens >= 0),
  ai_output_tokens                integer
                                    constraint brand_import_candidates_ai_output_tokens_check
                                    check (ai_output_tokens is null or ai_output_tokens >= 0),
  ai_cache_creation_input_tokens  integer
                                    constraint brand_import_candidates_ai_cache_creation_tokens_check
                                    check (ai_cache_creation_input_tokens is null or ai_cache_creation_input_tokens >= 0),
  ai_cache_read_input_tokens      integer
                                    constraint brand_import_candidates_ai_cache_read_tokens_check
                                    check (ai_cache_read_input_tokens is null or ai_cache_read_input_tokens >= 0),
  ai_estimated_cost_usd           numeric(10, 6)
                                    constraint brand_import_candidates_ai_estimated_cost_check
                                    check (ai_estimated_cost_usd is null or ai_estimated_cost_usd >= 0),

  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  -- One row per input position; also serves batch ordering (batch_id, position).
  constraint brand_import_candidates_batch_position_key unique (batch_id, position),
  -- The same website at most once per batch (NULLs are distinct, so
  -- several unusable inputs may share a batch); allowed across batches.
  constraint brand_import_candidates_batch_host_key unique (batch_id, normalized_host),
  constraint brand_import_candidates_processing_lease_check
    check (status <> 'processing' or processing_started_at is not null)
);

-- Processing / recovery: find queued, failed or stale-lease candidates.
create index brand_import_candidates_status_updated_idx
  on public.brand_import_candidates (status, updated_at);

create trigger trg_brand_import_candidates_updated_at
  before update on public.brand_import_candidates
  for each row execute function public.set_updated_at();

-- Server-only access: RLS on, no anon/authenticated policies or grants.
alter table public.brand_import_batches    enable row level security;
alter table public.brand_import_candidates enable row level security;
revoke all on table public.brand_import_batches    from anon, authenticated;
revoke all on table public.brand_import_candidates from anon, authenticated;
grant all on table public.brand_import_batches    to service_role;
grant all on table public.brand_import_candidates to service_role;

comment on table public.brand_import_batches is
  'Admin bulk Brand Import batch (internal, server-only). Counts are derived from brand_import_candidates.';
comment on table public.brand_import_candidates is
  'Admin bulk Brand Import candidate: one submitted website and its PROPOSED Brand (internal, server-only; not a Business, never public).';
