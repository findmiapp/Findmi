-- ============================================================================
-- FindMi Global Handle Registry — entity-only correction
--
-- The original handles_registry migration (20260907171457, already applied
-- to production) incorrectly included "person" as a supported handle
-- entity type. FindMi vanity usernames belong to public Business/Location/
-- Event entities only — never a personal account/profile. That migration
-- is NOT rewritten (it already ran in production); this is a forward
-- corrective migration instead, per this repo's own migration discipline.
--
-- Live trace immediately before this migration confirmed exactly ONE row
-- in public.handles: entity_type='person', handle='mocktailmart',
-- entity_id/user_id both c23de6ce-d827-4098-b5c6-3683b56d9c54 — matching
-- profiles.username for that same row (the pre-existing personal username
-- from before the handle registry even existed). No other Person handles
-- and no legitimate Business/Location/Event handles exist yet, so nothing
-- else is touched.
-- ============================================================================

-- 1. Release the one mistaken Person handle. This makes "mocktailmart"
-- available again in the global namespace immediately. It is deliberately
-- NOT reassigned to any Business/Location/Event here or ever automatically
-- — a future claim requires an authorized owner explicitly choosing it
-- through that entity's own Manager UI.
delete from public.handles where entity_type = 'person';

-- 2. Clear the now-obsolete personal username cache. profiles.username
-- was only ever a denormalized read-cache for the Person handle system
-- being removed here (kept in sync by claim_person_handle, dropped
-- below) — left in place it would misleadingly suggest this personal
-- profile still holds a public vanity handle it no longer does.
update public.profiles set username = null, updated_at = now() where username is not null;

-- 3. Narrow entity_type to the three real vanity entity types.
alter table public.handles drop constraint handles_entity_type_check;
alter table public.handles add constraint handles_entity_type_check check (entity_type in ('business', 'location', 'event'));

-- 4. Decommission the Person-specific claim path — nothing in the
-- codebase calls this after this pass.
drop function if exists public.claim_person_handle(uuid, text);
