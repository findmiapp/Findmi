-- Create Event idempotency (2026-11-02 incident: one Create Event form was
-- submitted three times in ~5 seconds and produced three identical Events).
--
-- One row per form submission key. A creation Server Action CLAIMS its
-- form's one-time key here before creating anything; a repeated submission
-- of the same rendered form carries the same key, loses the primary-key race
-- and is sent to the entity the first submission created instead of
-- creating another. Additive only; nothing existing is changed.
--
-- Service-role only: RLS on with no policies, and no grants to anon /
-- authenticated. Only Server Actions (getAdminSupabase) read or write it.
create table if not exists public.form_submission_keys (
  key uuid primary key,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  user_id uuid not null,
  entity_id uuid,
  created_at timestamptz not null default now()
);

alter table public.form_submission_keys enable row level security;
revoke all on table public.form_submission_keys from anon, authenticated;

create index if not exists form_submission_keys_created_at_idx on public.form_submission_keys (created_at);

comment on table public.form_submission_keys is
  'One-time creation-form submission keys (idempotency). Service-role only. See src/lib/form-submission-keys.ts.';
