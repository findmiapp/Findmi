-- Homepage Bulletin — a single, admin-managed editorial announcement
-- shown on the public homepage between the hero and "What's Coming Up".
-- Deliberately object-agnostic (not Event-specific): destination_type/
-- destination_id/destination_url let one Bulletin point at a Business,
-- Event, Location, or a safe custom URL, resolved app-side (same pattern
-- nav_items already uses for route vs. custom link — see
-- lib/navigation.ts) rather than a single FK to one specific table.
--
-- Multiple Bulletins can be saved; the app enforces "at most one
-- published" as a two-step update (unpublish every other row, then
-- publish the target — see publishBulletin in
-- src/app/admin/(protected)/bulletins/actions.ts). The partial unique
-- index below is the DB-level backstop for that same invariant — it's
-- structurally impossible for two rows to have is_published = true at
-- once, regardless of what application code does.
create table if not exists public.homepage_bulletins (
  id uuid primary key default gen_random_uuid(),

  eyebrow text,
  headline text not null,
  supporting_text text,
  meta_text text,
  thumbnail_url text,
  cta_text text,

  destination_type text
    check (destination_type in ('business', 'event', 'location', 'custom_url')),
  destination_id uuid,
  destination_url text,

  is_published boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists homepage_bulletins_is_published_idx
  on public.homepage_bulletins (is_published);

-- At most one published row, enforced at the database level regardless
-- of application logic — every indexed row's key is the literal value
-- `true`, so a second published row would collide.
create unique index if not exists homepage_bulletins_single_published_idx
  on public.homepage_bulletins ((is_published))
  where is_published = true;

create trigger trg_homepage_bulletins_updated_at
  before update on public.homepage_bulletins
  for each row execute function public.set_updated_at();

alter table public.homepage_bulletins enable row level security;

-- Public read — published Bulletin content only. Every column here is as
-- safe to expose as any other public content field (business/event/
-- location names, homepage copy) — nothing internal-only, so no
-- column-level grant restriction is needed (mirrors market_areas'
-- posture, not activations' sensitive-column case).
create policy "Public read published homepage bulletins"
  on public.homepage_bulletins
  for select
  using (is_published = true);

-- No insert/update/delete policy for anon/authenticated — every write
-- goes through getAdminSupabase() (service role, bypasses RLS), same
-- convention as every other admin-managed entity table.
