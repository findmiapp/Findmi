-- ============================================================================
-- Require Cell Number at Signup — profiles.phone
--
-- Adds the canonical, private phone number field to public.profiles.
-- Nullable (never NOT NULL) so every existing account keeps working
-- unchanged and un-locked-out — only NEW signups are required (at the
-- application layer, in src/app/(public)/signup/actions.ts) to supply
-- one. Stored E.164-normalized for US/Canada (NANP) numbers only (see
-- src/lib/phone.ts) — this app has no international phone infrastructure
-- today, so this pass doesn't invent one.
--
-- Privacy: profiles has NO public read policy (profiles_select_own is
-- the only self-read policy; profiles_select_public/public_profiles
-- both hard-code their own explicit column allowlists that do not, and
-- will not, include phone — see 20260905130000_user_identity_and_event_
-- follow.sql and 20260905150000_public_profiles_view.sql). Adding this
-- column does not change either of those column lists, so it can never
-- become reachable through the existing public identity surfaces.
-- ============================================================================

alter table public.profiles add column if not exists phone text;

-- Same real DB-level guarantee already established for username
-- (profiles_username_format) — the app layer normalizes before writing,
-- this is the actual enforcement backstop. NANP only: +1 followed by a
-- 10-digit number whose area code and exchange code don't start with 0/1.
alter table public.profiles
  add constraint profiles_phone_format
  check (phone is null or phone ~ '^\+1[2-9]\d{2}[2-9]\d{6}$');

-- Extends the existing new-user trigger (unchanged shape/behavior for
-- display_name) to also seed phone from the same raw_user_meta_data
-- payload the signup Server Action already sends alongside display_name
-- — a convenience mirror, never the canonical source (the signup action
-- itself writes/relies on profiles.phone as the real copy).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_display_name text;
  meta_phone text;
begin
  meta_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  meta_phone := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');
  insert into public.profiles (id, display_name, phone) values (new.id, meta_display_name, meta_phone);
  return new;
end;
$$;
