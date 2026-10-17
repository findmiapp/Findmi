-- Findmi Brand Audit + Opportunity Intelligence V1.
--
-- NOT YET APPLIED TO PRODUCTION. Additive only — six new tables and a
-- starter library of Opportunity Ideas. No existing table, row or policy
-- is changed.
--
--   brand_audits                 one row per Business: status + timestamps
--   brand_audit_answers          Goals / Challenges a Business selected,
--                                each with its OWN optional elaboration
--   business_intelligence_notes  Findmi Admin's internal note (Admin only)
--   opportunity_ideas            Admin-managed Idea library
--   opportunity_idea_businesses  Selected-Businesses targeting
--   opportunity_idea_responses   Business + Idea → Interested / Maybe /
--                                Not For Us + optional note
--
-- Access model is the same as business_opportunity_goals and
-- opportunity_listings: RLS enabled with NO anon/authenticated policies or
-- grants, so no client key can read or write any row. Every read/write is
-- server-side through the service role AFTER the app's own authorization
-- (requireBusinessMember + business_id scoping for Businesses, canManageGoals
-- for writes; requireAdmin for Findmi Admin) — see src/lib/brand-audit.ts.
-- The internal note lives in its own table so no Business read can ever
-- select it by accident.
--
-- Value lists mirror src/lib/brand-audit-domain.ts — change both.
-- Re-running this file is safe: every create is "if not exists" and the
-- seed inserts skip Ideas that already exist (seed_key).

-- ---------------------------------------------------------------- brand audit

create table if not exists public.brand_audits (
  business_id         uuid primary key references public.businesses (id) on delete cascade,
  status              text not null default 'in_progress',
  completed_at        timestamptz,
  updated_by_user_id  uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint brand_audits_status_check check (status in ('in_progress', 'complete')),
  constraint brand_audits_completed_check check ((status = 'complete') = (completed_at is not null))
);

drop trigger if exists trg_brand_audits_updated_at on public.brand_audits;
create trigger trg_brand_audits_updated_at
  before update on public.brand_audits
  for each row execute function public.set_updated_at();

create table if not exists public.brand_audit_answers (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  kind                text not null,
  option_key          text not null,
  detail              text,
  updated_by_user_id  uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint brand_audit_answers_unique unique (business_id, kind, option_key),
  constraint brand_audit_answers_kind_check check (kind in ('goal', 'challenge')),
  constraint brand_audit_answers_key_check check (
    (kind = 'goal' and option_key in ('build_awareness','product_sampling','drive_sales','product_launch','foot_traffic','reach_new_customers','community_engagement','lead_generation','generate_content','retail_trial','partnerships','other'))
    or (kind = 'challenge' and option_key in ('finding_opportunities','activation_locations','reaching_audience','product_trial','local_awareness','reliable_partners','staffing_execution','measuring_results','budget_efficiency','content_reach','retail_access','other'))
  ),
  constraint brand_audit_answers_detail_check check (detail is null or char_length(detail) <= 1000)
);

create index if not exists brand_audit_answers_business_idx on public.brand_audit_answers (business_id, kind);

drop trigger if exists trg_brand_audit_answers_updated_at on public.brand_audit_answers;
create trigger trg_brand_audit_answers_updated_at
  before update on public.brand_audit_answers
  for each row execute function public.set_updated_at();

create table if not exists public.business_intelligence_notes (
  business_id  uuid primary key references public.businesses (id) on delete cascade,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint business_intelligence_notes_note_check check (char_length(note) <= 4000)
);

drop trigger if exists trg_business_intelligence_notes_updated_at on public.business_intelligence_notes;
create trigger trg_business_intelligence_notes_updated_at
  before update on public.business_intelligence_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- opportunity ideas

create table if not exists public.opportunity_ideas (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  summary        text not null,
  details        text,
  idea_type      text not null default 'other',
  status         text not null default 'draft',
  display_order  integer not null default 100,
  audience       text not null default 'all_brands',
  seed_key       text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint opportunity_ideas_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint opportunity_ideas_summary_check check (char_length(btrim(summary)) between 1 and 240),
  constraint opportunity_ideas_details_check check (details is null or char_length(details) <= 2000),
  constraint opportunity_ideas_type_check check (idea_type in ('sampling','residential','workplace','retail','events','hospitality','wellness','campus','partnerships','content','sponsorship','other')),
  constraint opportunity_ideas_status_check check (status in ('draft', 'published', 'archived')),
  constraint opportunity_ideas_audience_check check (audience in ('all_brands', 'selected_businesses')),
  constraint opportunity_ideas_order_check check (display_order between 0 and 100000)
);

create index if not exists opportunity_ideas_published_idx on public.opportunity_ideas (display_order) where status = 'published';

drop trigger if exists trg_opportunity_ideas_updated_at on public.opportunity_ideas;
create trigger trg_opportunity_ideas_updated_at
  before update on public.opportunity_ideas
  for each row execute function public.set_updated_at();

create table if not exists public.opportunity_idea_businesses (
  idea_id      uuid not null references public.opportunity_ideas (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (idea_id, business_id)
);

create index if not exists opportunity_idea_businesses_business_idx on public.opportunity_idea_businesses (business_id);

create table if not exists public.opportunity_idea_responses (
  id                    uuid primary key default gen_random_uuid(),
  idea_id               uuid not null references public.opportunity_ideas (id) on delete cascade,
  business_id           uuid not null references public.businesses (id) on delete cascade,
  response              text not null,
  note                  text,
  responded_by_user_id  uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint opportunity_idea_responses_unique unique (idea_id, business_id),
  constraint opportunity_idea_responses_response_check check (response in ('interested', 'maybe', 'not_for_us')),
  constraint opportunity_idea_responses_note_check check (note is null or char_length(note) <= 1000)
);

create index if not exists opportunity_idea_responses_business_idx on public.opportunity_idea_responses (business_id);

drop trigger if exists trg_opportunity_idea_responses_updated_at on public.opportunity_idea_responses;
create trigger trg_opportunity_idea_responses_updated_at
  before update on public.opportunity_idea_responses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- access (server-only)

alter table public.brand_audits enable row level security;
alter table public.brand_audit_answers enable row level security;
alter table public.business_intelligence_notes enable row level security;
alter table public.opportunity_ideas enable row level security;
alter table public.opportunity_idea_businesses enable row level security;
alter table public.opportunity_idea_responses enable row level security;

revoke all on public.brand_audits, public.brand_audit_answers, public.business_intelligence_notes,
  public.opportunity_ideas, public.opportunity_idea_businesses, public.opportunity_idea_responses
  from anon, authenticated;
grant all on public.brand_audits, public.brand_audit_answers, public.business_intelligence_notes,
  public.opportunity_ideas, public.opportunity_idea_businesses, public.opportunity_idea_responses
  to service_role;

comment on table public.brand_audits is 'Brand Audit V1: one row per Business. Private to that Business''s members and Findmi Admin; server-only access.';
comment on table public.brand_audit_answers is 'Brand Audit V1: selected Goals / Challenges, each with its own optional elaboration. Server-only access.';
comment on table public.business_intelligence_notes is 'Findmi Admin internal Opportunity Intelligence note. Admin only — never read by any Business surface.';
comment on table public.opportunity_ideas is 'Opportunity Ideas V1: Findmi-authored strategy/channel ideas (not real Opportunities or inventory). Server-only access.';
comment on table public.opportunity_idea_responses is 'Opportunity Ideas V1: one response per Business per Idea (changeable). Server-only access.';

-- ---------------------------------------------------------------- starter idea library
-- Idea templates only: no venues, dates, audience sizes, pricing or
-- partnerships are claimed. Editable in Admin → Opportunities → Ideas.

insert into public.opportunity_ideas (seed_key, title, summary, details, idea_type, status, display_order, audience) values
  ('residential_sampling', 'Residential Sampling',
   'Bring your product directly into high-density residential communities through lobby, amenity-space and resident experiences.',
   'Apartment and condo communities host resident events and amenity-space programming. A sampling moment there puts your product in front of people where they live, often with repeat exposure over time.',
   'residential', 'published', 10, 'all_brands'),
  ('workplace_activations', 'Workplace Activations',
   'Reach professionals during the workday with sampling, demos or experiences in offices and shared workspaces.',
   'Offices, coworking spaces and corporate campuses look for perks and programming for their teams. A workplace activation can introduce your brand to people during the moments they take a break.',
   'workplace', 'published', 20, 'all_brands'),
  ('retail_pop_ups', 'Retail Pop-Ups',
   'Set up a temporary presence inside or alongside a retail space to meet shoppers in person.',
   'A pop-up gives shoppers a reason to stop, try and buy. It can test a new neighborhood or audience before a longer commitment.',
   'retail', 'published', 30, 'all_brands'),
  ('in_store_sampling', 'In-Store Sampling',
   'Offer samples or demos where your product is sold, right at the moment people decide what to buy.',
   'Sampling at the shelf turns curiosity into trial and trial into purchase. It also gives you direct feedback from shoppers.',
   'sampling', 'published', 40, 'all_brands'),
  ('events_festivals', 'Events & Festivals',
   'Show up where crowds gather, from street fairs and markets to concerts and seasonal festivals.',
   'Events concentrate an engaged audience in one place and time. A booth, sampling table or experience can create a lot of first impressions in a single day.',
   'events', 'published', 50, 'all_brands'),
  ('fitness_wellness', 'Fitness & Wellness Activations',
   'Connect with active, health-minded people at gyms, studios, runs and wellness events.',
   'Fitness and wellness communities are loyal and highly engaged. Products that fit an active lifestyle can find natural moments to be tried and remembered.',
   'wellness', 'published', 60, 'all_brands'),
  ('hospitality_partnerships', 'Hospitality Partnerships',
   'Work with hotels, restaurants and bars to feature your product in guest experiences.',
   'Hospitality partners can place your product in rooms, on menus or in guest amenities, introducing it in a setting people already enjoy.',
   'hospitality', 'published', 70, 'all_brands'),
  ('campus_activations', 'College & Campus Activations',
   'Introduce your brand to students through campus events, organizations and student life programming.',
   'Students try new brands readily and share what they like. Campus moments can build early loyalty with a hard-to-reach audience.',
   'campus', 'published', 80, 'all_brands'),
  ('street_sampling', 'Street Sampling',
   'Meet people on the move with sampling teams in high-traffic neighborhoods and commuter areas.',
   'Street teams can reach a large number of people quickly in busy areas, putting your product directly into hands.',
   'sampling', 'published', 90, 'all_brands'),
  ('community_partnerships', 'Community Partnerships',
   'Partner with local organizations, clubs and causes that share your values and audience.',
   'Community groups bring trust and belonging. Supporting or collaborating with them can make your brand part of the neighborhood.',
   'partnerships', 'published', 100, 'all_brands'),
  ('creator_events', 'Creator & Influencer Events',
   'Host or join experiences with creators who can introduce your brand to their audiences.',
   'Creator events produce content and conversations around your product, reaching people through voices they already follow.',
   'content', 'published', 110, 'all_brands'),
  ('brand_collaborations', 'Brand Collaborations',
   'Team up with a complementary brand on a shared experience, product moment or giveaway.',
   'Collaborations let two brands share audiences. The right partner can introduce you to customers who are already a natural fit.',
   'partnerships', 'published', 120, 'all_brands'),
  ('product_launch_experiences', 'Product Launch Experiences',
   'Launch something new with an in-person moment designed to build early buzz and first trial.',
   'A launch experience gives people a reason to show up, try your newest product first and talk about it.',
   'events', 'published', 130, 'all_brands'),
  ('event_sponsorship', 'Event Sponsorship',
   'Put your brand behind an event your audience already loves, with visibility and on-site presence.',
   'Sponsorship associates your brand with an experience people care about, often with signage, sampling or a featured moment on site.',
   'sponsorship', 'published', 140, 'all_brands')
on conflict (seed_key) do nothing;
