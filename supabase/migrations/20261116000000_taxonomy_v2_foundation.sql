-- Taxonomy V2 — Pass 1: additive foundation.
--
-- Separates the discovery dimensions the V1 model mixed into "categories":
--
--   WHAT        entity Category trees (public.categories, unchanged role)
--               · Event Type · Experience Mechanic · Appearance Type ·
--               Opportunity Category (public.taxonomy_terms — controlled
--               vocabularies that are NOT categories) · Topics (shared)
--   WHO         Audience (+ age)            — code-controlled text[]
--   ACCESS      Price Kind (+ range) · Entry Mode — code-controlled
--   ATTRIBUTES  Setting · Benefits (code) · factual attributes
--               (public.attribute_definitions + one jsonb per entity)
--   WHEN        public.location_hours (+ exceptions) — representation only
--
-- Mirrors src/lib/taxonomy/v2.ts — change both together.
--
-- SAFETY. Additive and idempotent (re-running is a no-op):
--   * no existing row's existing value changes; no table is renamed; no
--     legacy column (is_free, family_friendly, locations.hours,
--     locations.category_id, event_formats) is retired or rewritten;
--   * the only constraint changes WIDEN three V1 checks on events
--     (audience / entry_modes / benefits) to the V2 superset — every V1
--     value stays valid;
--   * every NEW table is server-only: RLS on, no policies, no anon /
--     authenticated grants. Nothing public reads V2 until a later pass adds
--     read policies deliberately;
--   * new columns on public tables are nullable or empty-defaulted and are
--     read by no code yet;
--   * V2 category ROWS are NOT inserted (39 readers query categories by
--     kind with no status filter; Pass 2 stages them with the mapping).
--     Only categories.status / description and the (id, kind) key the new
--     joins reference are added.

-- ================================================================ 0. shared guards

create or replace function public.taxonomy_text_array_is_set(p text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is not null and cardinality(p) = cardinality(array(select distinct x from unnest(p) x)) and array_position(p, null) is null;
$$;

-- ================================================================ 1. entity Category trees (existing table)

alter table public.categories add column if not exists status text not null default 'active';
alter table public.categories add column if not exists description text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_status_check') then
    alter table public.categories add constraint categories_status_check check (status in ('active', 'hidden', 'deprecated', 'staged'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'categories_description_length_check') then
    alter table public.categories add constraint categories_description_length_check check (description is null or char_length(description) <= 500);
  end if;
  -- The key the typed joins below reference, so a join row can only ever
  -- point at a Category of the right entity kind.
  if not exists (select 1 from pg_constraint where conname = 'categories_id_kind_key') then
    alter table public.categories add constraint categories_id_kind_key unique (id, kind);
  end if;
end $$;

-- Existing entity ↔ category joins gain a primary flag and provenance
-- (NULL source = a pre-V2 row of unrecorded origin).
alter table public.business_categories add column if not exists is_primary boolean not null default false;
alter table public.business_categories add column if not exists source text;
alter table public.event_categories add column if not exists is_primary boolean not null default false;
alter table public.event_categories add column if not exists source text;
alter table public.product_categories add column if not exists is_primary boolean not null default false;
alter table public.product_categories add column if not exists source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_categories_source_check') then
    alter table public.business_categories add constraint business_categories_source_check check (source is null or source in ('migration', 'importer', 'admin', 'owner', 'suggestion'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_categories_source_check') then
    alter table public.event_categories add constraint event_categories_source_check check (source is null or source in ('migration', 'importer', 'admin', 'owner', 'suggestion'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_categories_source_check') then
    alter table public.product_categories add constraint product_categories_source_check check (source is null or source in ('migration', 'importer', 'admin', 'owner', 'suggestion'));
  end if;
end $$;

create unique index if not exists business_categories_one_primary_idx on public.business_categories (business_id) where is_primary;
create unique index if not exists event_categories_one_primary_idx on public.event_categories (event_id) where is_primary;
create unique index if not exists product_categories_one_primary_idx on public.product_categories (product_id) where is_primary;

-- Location multi-category (V2). locations.category_id stays the legacy
-- primary and is still what every current read uses.
create table if not exists public.location_categories (
  location_id uuid not null references public.locations (id) on delete cascade,
  category_id uuid not null,
  category_kind text not null default 'location' check (category_kind = 'location'),
  is_primary boolean not null default false,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (location_id, category_id),
  foreign key (category_id, category_kind) references public.categories (id, kind) on delete cascade
);
create unique index if not exists location_categories_one_primary_idx on public.location_categories (location_id) where is_primary;
create index if not exists location_categories_category_idx on public.location_categories (category_id);

-- ================================================================ 2. controlled term vocabularies

create table if not exists public.taxonomy_terms (
  id uuid primary key default gen_random_uuid(),
  vocabulary text not null check (vocabulary in ('event_type', 'experience_mechanic', 'appearance_type', 'opportunity_category')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'active' check (status in ('active', 'hidden', 'deprecated')),
  sort_order integer not null default 0,
  -- experience_mechanic only: Benefits it may SUGGEST — never a confirmed
  -- Benefit (Mechanics never prove Benefits).
  suggests_benefits text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vocabulary, slug),
  unique (id, vocabulary),
  constraint taxonomy_terms_suggests_benefits_check check (
    public.taxonomy_text_array_is_set(suggests_benefits)
    and suggests_benefits <@ array['free_food', 'free_drinks', 'free_samples', 'free_products', 'giveaways', 'swag', 'discounts', 'prizes', 'complimentary_services']::text[]
    and (vocabulary = 'experience_mechanic' or cardinality(suggests_benefits) = 0)
  )
);

-- Event ↔ Event Type (1 primary; a few at most — enforced by the editor).
create table if not exists public.event_type_assignments (
  event_id uuid not null references public.events (id) on delete cascade,
  term_id uuid not null,
  vocabulary text not null default 'event_type' check (vocabulary = 'event_type'),
  is_primary boolean not null default false,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (event_id, term_id),
  foreign key (term_id, vocabulary) references public.taxonomy_terms (id, vocabulary) on delete restrict
);
create unique index if not exists event_type_assignments_one_primary_idx on public.event_type_assignments (event_id) where is_primary;
create index if not exists event_type_assignments_term_idx on public.event_type_assignments (term_id);

-- Event ↔ Experience Mechanic (multi-select).
create table if not exists public.event_mechanic_assignments (
  event_id uuid not null references public.events (id) on delete cascade,
  term_id uuid not null,
  vocabulary text not null default 'experience_mechanic' check (vocabulary = 'experience_mechanic'),
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (event_id, term_id),
  foreign key (term_id, vocabulary) references public.taxonomy_terms (id, vocabulary) on delete restrict
);
create index if not exists event_mechanic_assignments_term_idx on public.event_mechanic_assignments (term_id);

-- Runs on public tables written by owners as well as service_role, and
-- reads the server-only vocabulary — hence SECURITY DEFINER (read-only
-- lookup, fixed search_path).
-- A single-valued term column (appearances.appearance_type_id,
-- opportunity_listings.opportunity_category_id) may only hold a term of
-- its own vocabulary. TG_ARGV[0] = column, TG_ARGV[1] = vocabulary.
create or replace function public.taxonomy_term_column_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v_id is null then
    return new;
  end if;
  if not exists (select 1 from public.taxonomy_terms t where t.id = v_id and t.vocabulary = tg_argv[1]) then
    raise exception '% must reference a % term', tg_argv[0], tg_argv[1] using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ================================================================ 3. Topics (shared, admin-controlled)
-- NOT public.discovery_topics (saved-query lenses), which is untouched.

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 1000),
  kind text not null check (kind in ('subject', 'occasion')),
  broader_topic_id uuid references public.topics (id) on delete restrict,
  applies_to text[] not null default array['business', 'location', 'event', 'product', 'appearance']::text[],
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  sort_order integer not null default 0,
  seo_title text check (seo_title is null or char_length(seo_title) <= 120),
  seo_description text check (seo_description is null or char_length(seo_description) <= 300),
  indexable boolean not null default false,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topics_not_own_broader check (broader_topic_id is null or broader_topic_id <> id),
  constraint topics_applies_to_check check (
    cardinality(applies_to) > 0
    and public.taxonomy_text_array_is_set(applies_to)
    and applies_to <@ array['business', 'location', 'event', 'product', 'appearance']::text[]
  )
);
create index if not exists topics_broader_idx on public.topics (broader_topic_id) where broader_topic_id is not null;

-- Broader/narrower must stay a tree: no cycles.
create or replace function public.topics_hierarchy_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.broader_topic_id is not null and exists (
    with recursive up(id, depth) as (
      select new.broader_topic_id, 1
      union all
      select t.broader_topic_id, up.depth + 1 from public.topics t join up on t.id = up.id where t.broader_topic_id is not null and up.depth < 32
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'topic hierarchy cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists topics_hierarchy_guard on public.topics;
create trigger topics_hierarchy_guard before insert or update of broader_topic_id on public.topics for each row execute function public.topics_hierarchy_guard();

-- Entity ↔ Topic links (one table per entity: real FKs, like the existing
-- *_categories joins). A link needs an ACTIVE Topic that applies to that
-- entity type. TG_ARGV[0] = entity type.
create or replace function public.topic_link_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.topics t where t.id = new.topic_id and t.status = 'active' and tg_argv[0] = any (t.applies_to)) then
    raise exception 'topic is not active or does not apply to %', tg_argv[0] using errcode = '23514';
  end if;
  return new;
end;
$$;

create table if not exists public.business_topics (
  business_id uuid not null references public.businesses (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (business_id, topic_id)
);
create table if not exists public.location_topics (
  location_id uuid not null references public.locations (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (location_id, topic_id)
);
create table if not exists public.event_topics (
  event_id uuid not null references public.events (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (event_id, topic_id)
);
create table if not exists public.product_topics (
  product_id uuid not null references public.products (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (product_id, topic_id)
);
create table if not exists public.appearance_topics (
  appearance_id uuid not null references public.appearances (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (appearance_id, topic_id)
);
create index if not exists business_topics_topic_idx on public.business_topics (topic_id);
create index if not exists location_topics_topic_idx on public.location_topics (topic_id);
create index if not exists event_topics_topic_idx on public.event_topics (topic_id);
create index if not exists product_topics_topic_idx on public.product_topics (topic_id);
create index if not exists appearance_topics_topic_idx on public.appearance_topics (topic_id);

drop trigger if exists business_topics_guard on public.business_topics;
create trigger business_topics_guard before insert or update on public.business_topics for each row execute function public.topic_link_guard('business');
drop trigger if exists location_topics_guard on public.location_topics;
create trigger location_topics_guard before insert or update on public.location_topics for each row execute function public.topic_link_guard('location');
drop trigger if exists event_topics_guard on public.event_topics;
create trigger event_topics_guard before insert or update on public.event_topics for each row execute function public.topic_link_guard('event');
drop trigger if exists product_topics_guard on public.product_topics;
create trigger product_topics_guard before insert or update on public.product_topics for each row execute function public.topic_link_guard('product');
drop trigger if exists appearance_topics_guard on public.appearance_topics;
create trigger appearance_topics_guard before insert or update on public.appearance_topics for each row execute function public.topic_link_guard('appearance');

-- Category → Topic implication ("Coffee Shop" is about Coffee) so an entity
-- needn't be tagged twice. Only for real entity Category kinds.
create table if not exists public.category_topics (
  category_id uuid not null references public.categories (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (category_id, topic_id)
);
create index if not exists category_topics_topic_idx on public.category_topics (topic_id);

create or replace function public.category_topics_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_kind text;
begin
  select c.kind into v_kind from public.categories c where c.id = new.category_id;
  if v_kind is null or v_kind not in ('business', 'location', 'event', 'product') then
    raise exception 'only entity Categories imply Topics' using errcode = '23514';
  end if;
  if not exists (select 1 from public.topics t where t.id = new.topic_id and v_kind = any (t.applies_to)) then
    raise exception 'topic does not apply to % categories', v_kind using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists category_topics_guard on public.category_topics;
create trigger category_topics_guard before insert or update on public.category_topics for each row execute function public.category_topics_guard();

-- ================================================================ 4. attributes (definitions + one jsonb per entity)

create table if not exists public.attribute_definitions (
  key text primary key check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(key) <= 60),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  entity_types text[] not null,
  value_type text not null check (value_type in ('boolean', 'enum', 'multi_enum', 'number')),
  allowed_values text[],
  attribute_group text not null default 'Amenities' check (char_length(attribute_group) between 1 and 40),
  -- true = offered only for categories linked in attribute_definition_categories.
  requires_category_scope boolean not null default false,
  filterable boolean not null default true,
  status text not null default 'active' check (status in ('active', 'hidden', 'deprecated')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attribute_definitions_entity_types_check check (
    cardinality(entity_types) > 0 and public.taxonomy_text_array_is_set(entity_types) and entity_types <@ array['location', 'product']::text[]
  ),
  constraint attribute_definitions_allowed_values_check check (
    (value_type in ('enum', 'multi_enum') and allowed_values is not null and cardinality(allowed_values) > 0 and public.taxonomy_text_array_is_set(allowed_values))
    or (value_type in ('boolean', 'number') and allowed_values is null)
  )
);

create table if not exists public.attribute_definition_categories (
  attribute_key text not null references public.attribute_definitions (key) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (attribute_key, category_id)
);

alter table public.locations add column if not exists attributes jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists attributes jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_attributes_object_check') then
    alter table public.locations add constraint locations_attributes_object_check check (jsonb_typeof(attributes) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_attributes_object_check') then
    alter table public.products add constraint products_attributes_object_check check (jsonb_typeof(attributes) = 'object');
  end if;
end $$;

create index if not exists locations_attributes_idx on public.locations using gin (attributes jsonb_path_ops);
create index if not exists products_attributes_idx on public.products using gin (attributes jsonb_path_ops);

-- Every key must be an active definition for that entity type, with a value
-- of the declared type (src/lib/taxonomy/v2.ts validateAttributes).
-- Category applicability is an editor rule (it depends on the entity's
-- categories at edit time). TG_ARGV[0] = entity type.
create or replace function public.validate_entity_attributes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  d public.attribute_definitions%rowtype;
begin
  if new.attributes is null or new.attributes = '{}'::jsonb then
    return new;
  end if;
  for k, v in select * from jsonb_each(new.attributes) loop
    select * into d from public.attribute_definitions where key = k;
    if not found or d.status <> 'active' or not (tg_argv[0] = any (d.entity_types)) then
      raise exception 'attribute % is not an active % attribute', k, tg_argv[0] using errcode = '23514';
    end if;
    if (d.value_type = 'boolean' and jsonb_typeof(v) <> 'boolean')
      or (d.value_type = 'number' and jsonb_typeof(v) <> 'number')
      or (d.value_type = 'enum' and not (jsonb_typeof(v) = 'string' and (v #>> '{}') = any (d.allowed_values)))
      or (d.value_type = 'multi_enum' and not (jsonb_typeof(v) = 'array' and not exists (
            select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (d.allowed_values)))))
    then
      raise exception 'attribute % has a value of the wrong type', k using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists locations_attributes_guard on public.locations;
create trigger locations_attributes_guard before insert or update of attributes on public.locations for each row execute function public.validate_entity_attributes('location');
drop trigger if exists products_attributes_guard on public.products;
create trigger products_attributes_guard before insert or update of attributes on public.products for each row execute function public.validate_entity_attributes('product');

-- ================================================================ 5. Location hours (V2 representation)
-- Local minutes, no "24:00" strings: open_minute 0–1439; close_minute in
-- (open, open + 1440] — above 1440 runs past midnight into the next day.
-- ISO weekday 1 = Mon … 7 = Sun. Several rows on a day = split hours; a
-- weekday with no rows (status 'regular') = closed; 0 → 1440 = open all
-- day. Unknown hours = locations.hours_status NULL. The legacy
-- locations.hours jsonb is untouched and is still what the site reads.

alter table public.locations add column if not exists hours_status text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_hours_status_check') then
    alter table public.locations add constraint locations_hours_status_check check (hours_status is null or hours_status in ('regular', 'by_appointment', 'event_only', 'temporarily_closed'));
  end if;
end $$;

create table if not exists public.location_hours (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  open_minute smallint not null check (open_minute between 0 and 1439),
  close_minute smallint not null,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  constraint location_hours_close_check check (close_minute > open_minute and close_minute <= open_minute + 1440)
);
create index if not exists location_hours_location_idx on public.location_hours (location_id, weekday);

-- A period on the week-minute circle (Mon 00:00 = 0, 10080 per week),
-- split where Sunday night wraps into Monday.
create or replace function public.location_hours_week_ranges(p_weekday smallint, p_open smallint, p_close smallint)
returns int4range[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when (p_weekday - 1) * 1440 + p_close <= 10080 then array[int4range((p_weekday - 1) * 1440 + p_open, (p_weekday - 1) * 1440 + p_close)]
    else array[int4range((p_weekday - 1) * 1440 + p_open, 10080), int4range(0, (p_weekday - 1) * 1440 + p_close - 10080)]
  end;
$$;

-- Periods of one Location never overlap — including an overnight period
-- spilling into the next morning (btree_gist isn't installed, so a
-- trigger instead of an exclusion constraint).
create or replace function public.location_hours_overlap_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('location_hours:' || new.location_id::text, 0));
  if exists (
    select 1
    from public.location_hours h,
      unnest(public.location_hours_week_ranges(h.weekday, h.open_minute, h.close_minute)) a,
      unnest(public.location_hours_week_ranges(new.weekday, new.open_minute, new.close_minute)) b
    where h.location_id = new.location_id and h.id <> new.id and a && b
  ) then
    raise exception 'location hours overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;
drop trigger if exists location_hours_overlap_guard on public.location_hours;
create trigger location_hours_overlap_guard before insert or update on public.location_hours for each row execute function public.location_hours_overlap_guard();

-- Dated exceptions REPLACE the weekly periods for every date they cover:
-- holidays, special hours, temporary closures, future scheduled changes.
create table if not exists public.location_hours_exceptions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  kind text not null check (kind in ('closed', 'special_hours')),
  reason text check (reason is null or reason in ('holiday', 'temporary_closure', 'special_event', 'seasonal', 'other')),
  label text check (label is null or char_length(label) <= 80),
  note text check (note is null or char_length(note) <= 300),
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  constraint location_hours_exceptions_range_check check (ends_on >= starts_on)
);
create index if not exists location_hours_exceptions_location_idx on public.location_hours_exceptions (location_id, starts_on, ends_on);

create table if not exists public.location_hours_exception_periods (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.location_hours_exceptions (id) on delete cascade,
  open_minute smallint not null check (open_minute between 0 and 1439),
  close_minute smallint not null,
  constraint location_hours_exception_periods_close_check check (close_minute > open_minute and close_minute <= open_minute + 1440)
);
create index if not exists location_hours_exception_periods_exception_idx on public.location_hours_exception_periods (exception_id);

-- One exception per date per Location (never two competing answers).
create or replace function public.location_hours_exceptions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('location_hours_exceptions:' || new.location_id::text, 0));
  if exists (
    select 1 from public.location_hours_exceptions e
    where e.location_id = new.location_id and e.id <> new.id and daterange(e.starts_on, e.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')
  ) then
    raise exception 'location hours exceptions overlap' using errcode = '23P01';
  end if;
  if new.kind = 'closed' and exists (select 1 from public.location_hours_exception_periods p where p.exception_id = new.id) then
    raise exception 'a closure has no periods' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists location_hours_exceptions_guard on public.location_hours_exceptions;
create trigger location_hours_exceptions_guard before insert or update on public.location_hours_exceptions for each row execute function public.location_hours_exceptions_guard();

-- Periods belong only to special-hours exceptions and never overlap each other.
create or replace function public.location_hours_exception_periods_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('location_hours_exception_periods:' || new.exception_id::text, 0));
  if not exists (select 1 from public.location_hours_exceptions e where e.id = new.exception_id and e.kind = 'special_hours') then
    raise exception 'periods belong only to special-hours exceptions' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.location_hours_exception_periods p
    where p.exception_id = new.exception_id and p.id <> new.id and int4range(p.open_minute, p.close_minute) && int4range(new.open_minute, new.close_minute)
  ) then
    raise exception 'exception periods overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;
drop trigger if exists location_hours_exception_periods_guard on public.location_hours_exception_periods;
create trigger location_hours_exception_periods_guard before insert or update on public.location_hours_exception_periods for each row execute function public.location_hours_exception_periods_guard();

-- ================================================================ 6. Event / Occurrence / Appearance / Business / Product / Opportunity fields

-- Price: ONE canonical admission truth. NULL price_kind = unknown (never
-- "not free"). is_free / family_friendly are untouched legacy fields.
alter table public.events add column if not exists price_kind text;
alter table public.events add column if not exists price_min_cents integer;
alter table public.events add column if not exists price_max_cents integer;
alter table public.events add column if not exists currency text;
alter table public.events add column if not exists price_note text;
alter table public.events add column if not exists setting text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_price_kind_check') then
    alter table public.events add constraint events_price_kind_check check (price_kind is null or price_kind in ('free', 'paid', 'donation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_price_range_check') then
    alter table public.events add constraint events_price_range_check check (
      (price_min_cents is null or price_min_cents >= 0)
      and (price_max_cents is null or price_max_cents >= 0)
      and (price_min_cents is null or price_max_cents is null or price_min_cents <= price_max_cents)
      -- A free event carries no price; an amount needs its currency.
      and (price_kind is distinct from 'free' or (price_min_cents is null and price_max_cents is null))
      and ((price_min_cents is null and price_max_cents is null) or currency is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_currency_check') then
    alter table public.events add constraint events_currency_check check (currency is null or currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_price_note_length_check') then
    alter table public.events add constraint events_price_note_length_check check (price_note is null or char_length(price_note) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_setting_check') then
    alter table public.events add constraint events_setting_check check (setting is null or setting in ('indoor', 'outdoor', 'indoor_outdoor', 'online', 'hybrid'));
  end if;
end $$;

-- Widen the three V1 attribute checks to the V2 superset (every V1 value
-- stays valid; "free_admission" remains storable for V1 compatibility
-- only — V2 Free is price_kind).
alter table public.events drop constraint if exists events_audience_check;
alter table public.events add constraint events_audience_check check (audience <@ array['all_ages', 'family', 'kids', 'teens', 'adults', '18_plus', '21_plus', 'professional', 'creators']::text[]);
alter table public.events drop constraint if exists events_entry_modes_check;
alter table public.events add constraint events_entry_modes_check check (entry_modes <@ array['walk_in', 'rsvp', 'registration', 'ticket', 'reservation', 'invite']::text[]);
alter table public.events drop constraint if exists events_benefits_check;
alter table public.events add constraint events_benefits_check check (benefits <@ array['free_admission', 'free_food', 'free_drinks', 'free_samples', 'free_products', 'giveaways', 'swag', 'discounts', 'prizes', 'complimentary_services']::text[]);

-- Explicit all-day: NULL = not stated (every existing row), never inferred.
alter table public.event_occurrences add column if not exists all_day boolean;

-- Appearance Type (its own vocabulary — never inherited from an Event) and
-- Benefits.
alter table public.appearances add column if not exists appearance_type_id uuid references public.taxonomy_terms (id) on delete restrict;
alter table public.appearances add column if not exists benefits text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appearances_benefits_check') then
    alter table public.appearances add constraint appearances_benefits_check check (
      public.taxonomy_text_array_is_set(benefits)
      and benefits <@ array['free_food', 'free_drinks', 'free_samples', 'free_products', 'giveaways', 'swag', 'discounts', 'prizes', 'complimentary_services']::text[]
    );
  end if;
end $$;
create index if not exists appearances_appearance_type_idx on public.appearances (appearance_type_id) where appearance_type_id is not null;
drop trigger if exists appearances_appearance_type_guard on public.appearances;
create trigger appearances_appearance_type_guard before insert or update of appearance_type_id on public.appearances for each row execute function public.taxonomy_term_column_guard('appearance_type_id', 'appearance_type');

-- Business Model: optional multi-select, never required.
alter table public.businesses add column if not exists business_models text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_business_models_check') then
    alter table public.businesses add constraint businesses_business_models_check check (
      public.taxonomy_text_array_is_set(business_models)
      and business_models <@ array['product_brand', 'retailer', 'food_service', 'service_provider', 'maker_artist', 'organizer', 'venue_operator', 'agency']::text[]
    );
  end if;
end $$;

-- Product audience (e.g. kids, 21+ for alcohol). Services are NOT products
-- in V2; existing product_type rows are untouched.
alter table public.products add column if not exists audience text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_audience_check') then
    alter table public.products add constraint products_audience_check check (
      public.taxonomy_text_array_is_set(audience)
      and audience <@ array['all_ages', 'family', 'kids', 'teens', 'adults', '18_plus', '21_plus', 'professional', 'creators']::text[]
    );
  end if;
end $$;

-- Commercial Opportunity Category (opportunity_listings only; the
-- event-participation public.opportunities table is not touched).
alter table public.opportunity_listings add column if not exists opportunity_category_id uuid references public.taxonomy_terms (id) on delete restrict;
drop trigger if exists opportunity_listings_category_guard on public.opportunity_listings;
create trigger opportunity_listings_category_guard before insert or update of opportunity_category_id on public.opportunity_listings for each row execute function public.taxonomy_term_column_guard('opportunity_category_id', 'opportunity_category');

-- ================================================================ 7. aliases (one vocabulary-alias store)
-- Vocabulary only; grammar (time words, "open until", "near me") stays in
-- the parser. Not read by the parser yet; existing aliases
-- (discovery_topics.aliases, market_areas.aliases, parser constants) stay.

create table if not exists public.taxonomy_aliases (
  id uuid primary key default gen_random_uuid(),
  phrase text not null check (char_length(phrase) between 1 and 80 and phrase = lower(btrim(regexp_replace(phrase, '\s+', ' ', 'g')))),
  dimension text not null check (dimension in (
    'category', 'topic', 'event_type', 'experience_mechanic', 'appearance_type', 'opportunity_category', 'area', 'region',
    'audience', 'entry_mode', 'price_kind', 'setting', 'benefit', 'business_model', 'attribute', 'entity_type'
  )),
  target_id uuid,
  target_code text,
  -- Optional scope: the entity types this reading applies to.
  entity_types text[],
  priority smallint not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source text not null default 'admin' check (source in ('migration', 'admin')),
  created_at timestamptz not null default now(),
  constraint taxonomy_aliases_target_check check (
    (dimension in ('category', 'topic', 'event_type', 'experience_mechanic', 'appearance_type', 'opportunity_category', 'area', 'region') and target_id is not null and target_code is null)
    or (dimension in ('audience', 'entry_mode', 'price_kind', 'setting', 'benefit', 'business_model', 'attribute', 'entity_type') and target_code is not null and target_id is null)
  ),
  constraint taxonomy_aliases_entity_types_check check (
    entity_types is null or (cardinality(entity_types) > 0 and public.taxonomy_text_array_is_set(entity_types) and entity_types <@ array['business', 'location', 'event', 'product', 'appearance']::text[])
  )
);
create unique index if not exists taxonomy_aliases_target_key on public.taxonomy_aliases (phrase, dimension, coalesce(target_id::text, target_code));
create index if not exists taxonomy_aliases_phrase_idx on public.taxonomy_aliases (phrase) where status = 'active';

-- Every alias points at something real.
create or replace function public.taxonomy_aliases_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ok boolean;
begin
  ok := case new.dimension
    when 'category' then exists (select 1 from public.categories c where c.id = new.target_id and c.kind in ('business', 'location', 'event', 'product')
                           and (new.entity_types is null or new.entity_types = array[c.kind]))
    when 'topic' then exists (select 1 from public.topics t where t.id = new.target_id)
    when 'event_type' then exists (select 1 from public.taxonomy_terms t where t.id = new.target_id and t.vocabulary = 'event_type')
    when 'experience_mechanic' then exists (select 1 from public.taxonomy_terms t where t.id = new.target_id and t.vocabulary = 'experience_mechanic')
    when 'appearance_type' then exists (select 1 from public.taxonomy_terms t where t.id = new.target_id and t.vocabulary = 'appearance_type')
    when 'opportunity_category' then exists (select 1 from public.taxonomy_terms t where t.id = new.target_id and t.vocabulary = 'opportunity_category')
    when 'area' then exists (select 1 from public.market_areas m where m.id = new.target_id)
    when 'region' then exists (select 1 from public.markets m where m.id = new.target_id)
    when 'audience' then new.target_code = any (array['all_ages', 'family', 'kids', 'teens', 'adults', '18_plus', '21_plus', 'professional', 'creators'])
    when 'entry_mode' then new.target_code = any (array['walk_in', 'rsvp', 'registration', 'ticket', 'reservation', 'invite'])
    when 'price_kind' then new.target_code = any (array['free', 'paid', 'donation'])
    when 'setting' then new.target_code = any (array['indoor', 'outdoor', 'indoor_outdoor', 'online', 'hybrid'])
    when 'benefit' then new.target_code = any (array['free_food', 'free_drinks', 'free_samples', 'free_products', 'giveaways', 'swag', 'discounts', 'prizes', 'complimentary_services'])
    when 'business_model' then new.target_code = any (array['product_brand', 'retailer', 'food_service', 'service_provider', 'maker_artist', 'organizer', 'venue_operator', 'agency'])
    when 'attribute' then exists (select 1 from public.attribute_definitions d where d.key = new.target_code)
    when 'entity_type' then new.target_code = any (array['business', 'location', 'event', 'product', 'appearance'])
    else false
  end;
  if not ok then
    raise exception 'alias target % / % is not a valid % target', new.target_id, new.target_code, new.dimension using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists taxonomy_aliases_guard on public.taxonomy_aliases;
create trigger taxonomy_aliases_guard before insert or update on public.taxonomy_aliases for each row execute function public.taxonomy_aliases_guard();

-- ================================================================ 8. legacy slug compatibility (inactive)
-- One legacy classification slug → its V2 concept(s). Seeded 'draft':
-- nothing redirects, rewrites URLs, discovery_topics.query, homepage or nav
-- until a later pass activates rows.

create table if not exists public.taxonomy_legacy_mappings (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null check (legacy_source in ('category', 'discovery_topic')),
  legacy_kind text not null default '' check (legacy_kind in ('', 'business', 'event', 'product', 'location', 'event_format')),
  legacy_slug text not null check (char_length(legacy_slug) between 1 and 120),
  -- [{ "dimension": "...", "slug": "..." } | { "dimension": "...", "code": "..." }, …]
  targets jsonb not null check (jsonb_typeof(targets) = 'array' and jsonb_array_length(targets) > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (legacy_source, legacy_kind, legacy_slug)
);

-- ================================================================ 9. provenance

-- Unconfirmed ideas (importer extraction, deterministic suggestions,
-- Mechanic → Benefit hints) awaiting review. Confirming one writes the
-- canonical assignment; only confirmed classifications ever power discovery.
create table if not exists public.classification_suggestions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('business', 'location', 'event', 'event_occurrence', 'product', 'appearance', 'opportunity_listing')),
  entity_id uuid not null,
  dimension text not null check (dimension in (
    'category', 'topic', 'event_type', 'experience_mechanic', 'appearance_type', 'opportunity_category',
    'audience', 'age_range', 'entry_mode', 'price_kind', 'price_range', 'setting', 'benefit', 'business_model',
    'attribute', 'all_day', 'hours'
  )),
  value jsonb not null,
  source text not null check (source in ('migration', 'importer', 'suggestion')),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence text check (evidence is null or char_length(evidence) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  constraint classification_suggestions_review_check check ((status = 'suggested') = (reviewed_at is null))
);
create unique index if not exists classification_suggestions_open_key on public.classification_suggestions (entity_type, entity_id, dimension, md5(value::text)) where status = 'suggested';
create index if not exists classification_suggestions_queue_idx on public.classification_suggestions (status, dimension, created_at);
create index if not exists classification_suggestions_entity_idx on public.classification_suggestions (entity_type, entity_id);

-- Who set a value stored in a column / array (price_kind, audience,
-- setting, …). Join rows carry their own source; this covers the rest
-- without adding provenance columns to every public table.
create table if not exists public.classification_field_sources (
  entity_type text not null check (entity_type in ('business', 'location', 'event', 'event_occurrence', 'product', 'appearance', 'opportunity_listing')),
  entity_id uuid not null,
  field text not null check (field in (
    'price_kind', 'price_range', 'setting', 'audience', 'age_range', 'entry_modes', 'benefits', 'all_day',
    'appearance_type', 'business_models', 'attributes', 'hours', 'hours_status', 'opportunity_category'
  )),
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  set_at timestamptz not null default now(),
  set_by uuid,
  primary key (entity_type, entity_id, field)
);

-- ================================================================ 10. access: every new table is server-only

do $$
declare
  t text;
begin
  foreach t in array array[
    'location_categories', 'taxonomy_terms', 'event_type_assignments', 'event_mechanic_assignments',
    'topics', 'business_topics', 'location_topics', 'event_topics', 'product_topics', 'appearance_topics', 'category_topics',
    'attribute_definitions', 'attribute_definition_categories',
    'location_hours', 'location_hours_exceptions', 'location_hours_exception_periods',
    'taxonomy_aliases', 'taxonomy_legacy_mappings', 'classification_suggestions', 'classification_field_sources'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

revoke all on function public.taxonomy_term_column_guard() from public, anon, authenticated;
revoke all on function public.topics_hierarchy_guard() from public, anon, authenticated;
revoke all on function public.topic_link_guard() from public, anon, authenticated;
revoke all on function public.category_topics_guard() from public, anon, authenticated;
revoke all on function public.validate_entity_attributes() from public, anon, authenticated;
revoke all on function public.location_hours_overlap_guard() from public, anon, authenticated;
revoke all on function public.location_hours_exceptions_guard() from public, anon, authenticated;
revoke all on function public.location_hours_exception_periods_guard() from public, anon, authenticated;
revoke all on function public.taxonomy_aliases_guard() from public, anon, authenticated;

comment on table public.taxonomy_terms is 'Taxonomy V2: controlled vocabularies that are NOT entity Categories — event_type, experience_mechanic, appearance_type, opportunity_category. Server-only until a later pass adds read policies.';
comment on table public.topics is 'Taxonomy V2: canonical, admin-controlled shared Topics (what an entity is about). Distinct from discovery_topics (saved-query lenses). Server-only until a later pass adds read policies.';
comment on table public.taxonomy_aliases is 'Taxonomy V2: vocabulary aliases → structured concepts (dimension + target). Grammar stays in the parser. Not read by search yet.';
comment on table public.location_hours is 'Taxonomy V2: weekly opening periods in LOCAL minutes (close_minute > 1440 = past midnight). Not read yet; locations.hours remains the live source.';
comment on table public.taxonomy_legacy_mappings is 'Taxonomy V2: legacy classification slug → V2 concept(s). Inactive (draft) until a later pass activates compatibility.';
comment on table public.classification_suggestions is 'Taxonomy V2: unconfirmed classification ideas awaiting review. Never powers discovery.';

-- ================================================================ 11. launch vocabulary (generated by scripts/taxonomy-v2-seed-sql.mjs)

insert into public.taxonomy_terms (vocabulary, slug, name, sort_order, suggests_benefits) values
  ('event_type', 'festival', 'Festival', 10, '{}'::text[]),
  ('event_type', 'market', 'Market', 20, '{}'::text[]),
  ('event_type', 'shopping-event', 'Shopping Event', 30, '{}'::text[]),
  ('event_type', 'tasting', 'Tasting', 40, '{}'::text[]),
  ('event_type', 'dining-experience', 'Dining Experience', 50, '{}'::text[]),
  ('event_type', 'class', 'Class', 60, '{}'::text[]),
  ('event_type', 'workshop', 'Workshop', 70, '{}'::text[]),
  ('event_type', 'talk-panel', 'Talk & Panel', 80, '{}'::text[]),
  ('event_type', 'conference', 'Conference', 90, '{}'::text[]),
  ('event_type', 'meetup-social', 'Meetup & Social', 100, '{}'::text[]),
  ('event_type', 'networking', 'Networking', 110, '{}'::text[]),
  ('event_type', 'party', 'Party', 120, '{}'::text[]),
  ('event_type', 'performance', 'Performance', 130, '{}'::text[]),
  ('event_type', 'screening', 'Screening', 140, '{}'::text[]),
  ('event_type', 'exhibition', 'Exhibition', 150, '{}'::text[]),
  ('event_type', 'immersive-experience', 'Immersive Experience', 160, '{}'::text[]),
  ('event_type', 'tour-walk', 'Tour & Walk', 170, '{}'::text[]),
  ('event_type', 'race-competition', 'Race & Competition', 180, '{}'::text[]),
  ('event_type', 'fitness-session', 'Fitness Session', 190, '{}'::text[]),
  ('event_type', 'watch-party', 'Watch Party', 200, '{}'::text[]),
  ('event_type', 'fundraiser', 'Fundraiser', 210, '{}'::text[]),
  ('event_type', 'volunteer-event', 'Volunteer Event', 220, '{}'::text[]),
  ('event_type', 'open-house', 'Open House', 230, '{}'::text[]),
  ('experience_mechanic', 'pop-up', 'Pop-Up', 10, '{}'::text[]),
  ('experience_mechanic', 'sampling', 'Sampling', 20, array['free_samples']::text[]),
  ('experience_mechanic', 'demo', 'Demo', 30, '{}'::text[]),
  ('experience_mechanic', 'brand-activation', 'Brand Activation', 40, '{}'::text[]),
  ('experience_mechanic', 'product-launch', 'Product Launch', 50, '{}'::text[]),
  ('experience_mechanic', 'retail-experience', 'Retail Experience', 60, '{}'::text[]),
  ('experience_mechanic', 'sample-sale', 'Sample Sale', 70, '{}'::text[]),
  ('experience_mechanic', 'meet-greet', 'Meet & Greet', 80, '{}'::text[]),
  ('experience_mechanic', 'giveaway', 'Giveaway', 90, array['giveaways']::text[]),
  ('appearance_type', 'pop-up', 'Pop-Up', 10, '{}'::text[]),
  ('appearance_type', 'sampling-demo', 'Sampling & Demo', 20, '{}'::text[]),
  ('appearance_type', 'vendor-booth', 'Vendor Booth', 30, '{}'::text[]),
  ('appearance_type', 'in-store', 'In-Store Appearance', 40, '{}'::text[]),
  ('appearance_type', 'activation', 'Activation', 50, '{}'::text[]),
  ('appearance_type', 'guest-appearance', 'Guest Appearance', 60, '{}'::text[]),
  ('appearance_type', 'mobile-stop', 'Mobile Stop', 70, '{}'::text[]),
  ('appearance_type', 'pickup-point', 'Pickup Point', 80, '{}'::text[]),
  ('appearance_type', 'other', 'Other', 90, '{}'::text[]),
  ('opportunity_category', 'activation-sampling', 'Activation & Sampling', 10, '{}'::text[]),
  ('opportunity_category', 'retail-vending', 'Retail & Vending', 20, '{}'::text[]),
  ('opportunity_category', 'sponsorship', 'Sponsorship', 30, '{}'::text[]),
  ('opportunity_category', 'content-media', 'Content & Media', 40, '{}'::text[]),
  ('opportunity_category', 'partnerships', 'Partnerships', 50, '{}'::text[]),
  ('opportunity_category', 'space-placement', 'Space & Placement', 60, '{}'::text[])
on conflict (vocabulary, slug) do nothing;

insert into public.topics (slug, name, kind, sort_order) values
  ('coffee', 'Coffee', 'subject', 10),
  ('tea', 'Tea', 'subject', 20),
  ('matcha', 'Matcha', 'subject', 30),
  ('bakery-pastry', 'Bakery & Pastry', 'subject', 40),
  ('chocolate-sweets', 'Chocolate & Sweets', 'subject', 50),
  ('wine', 'Wine', 'subject', 60),
  ('beer', 'Beer', 'subject', 70),
  ('cocktails', 'Cocktails', 'subject', 80),
  ('plant-based', 'Plant-Based', 'subject', 90),
  ('local-food', 'Local Food', 'subject', 100),
  ('fashion', 'Fashion', 'subject', 110),
  ('streetwear', 'Streetwear', 'subject', 120),
  ('sneakers', 'Sneakers', 'subject', 130),
  ('vintage', 'Vintage', 'subject', 140),
  ('jewelry', 'Jewelry', 'subject', 150),
  ('beauty', 'Beauty', 'subject', 160),
  ('skincare', 'Skincare', 'subject', 170),
  ('fragrance', 'Fragrance', 'subject', 180),
  ('wellness', 'Wellness', 'subject', 190),
  ('fitness', 'Fitness', 'subject', 200),
  ('running', 'Running', 'subject', 210),
  ('yoga', 'Yoga', 'subject', 220),
  ('art', 'Art', 'subject', 230),
  ('design', 'Design', 'subject', 240),
  ('photography', 'Photography', 'subject', 250),
  ('books', 'Books', 'subject', 260),
  ('film', 'Film', 'subject', 270),
  ('live-music', 'Live Music', 'subject', 280),
  ('djs-dance', 'DJs & Dance', 'subject', 290),
  ('comedy', 'Comedy', 'subject', 300),
  ('theater', 'Theater', 'subject', 310),
  ('home-interiors', 'Home & Interiors', 'subject', 320),
  ('plants', 'Plants', 'subject', 330),
  ('crafts-diy', 'Crafts & DIY', 'subject', 340),
  ('tech', 'Tech', 'subject', 350),
  ('ai', 'AI', 'subject', 360),
  ('startups', 'Startups', 'subject', 370),
  ('careers', 'Careers', 'subject', 380),
  ('parenting', 'Parenting', 'subject', 390),
  ('pets', 'Pets', 'subject', 400),
  ('sustainability', 'Sustainability', 'subject', 410),
  ('local-makers', 'Local Makers', 'subject', 420),
  ('gifts', 'Gifts', 'subject', 430),
  ('halloween', 'Halloween', 'occasion', 440),
  ('thanksgiving', 'Thanksgiving', 'occasion', 450),
  ('winter-holidays', 'Winter Holidays', 'occasion', 460),
  ('valentines-day', 'Valentine''s Day', 'occasion', 470),
  ('lunar-new-year', 'Lunar New Year', 'occasion', 480),
  ('pride', 'Pride', 'occasion', 490),
  ('summer', 'Summer', 'occasion', 500),
  ('back-to-school', 'Back to School', 'occasion', 510),
  ('fashion-week', 'Fashion Week', 'occasion', 520),
  ('nyc-marathon', 'NYC Marathon', 'occasion', 530)
on conflict (slug) do nothing;

update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'matcha' and p.slug = 'tea' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'streetwear' and p.slug = 'fashion' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'sneakers' and p.slug = 'streetwear' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'skincare' and p.slug = 'beauty' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'fragrance' and p.slug = 'beauty' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'running' and p.slug = 'fitness' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'yoga' and p.slug = 'fitness' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'ai' and p.slug = 'tech' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'fashion-week' and p.slug = 'fashion' and c.broader_topic_id is null;
update public.topics c set broader_topic_id = p.id from public.topics p where c.slug = 'nyc-marathon' and p.slug = 'running' and c.broader_topic_id is null;

insert into public.attribute_definitions (key, label, entity_types, value_type, allowed_values, attribute_group, requires_category_scope, sort_order) values
  ('wifi', 'Wi-Fi', array['location']::text[], 'boolean', null, 'Amenities', false, 10),
  ('outdoor_seating', 'Outdoor Seating', array['location']::text[], 'boolean', null, 'Amenities', false, 20),
  ('restrooms', 'Restrooms', array['location']::text[], 'boolean', null, 'Amenities', false, 30),
  ('parking', 'Parking', array['location']::text[], 'boolean', null, 'Amenities', false, 40),
  ('pet_friendly', 'Pet Friendly', array['location']::text[], 'boolean', null, 'Amenities', false, 50),
  ('reservations_accepted', 'Reservations Accepted', array['location']::text[], 'boolean', null, 'Amenities', false, 60),
  ('wheelchair_accessible', 'Wheelchair Accessible', array['location']::text[], 'boolean', null, 'Accessibility', false, 70),
  ('accessible_restroom', 'Accessible Restroom', array['location']::text[], 'boolean', null, 'Accessibility', false, 80),
  ('vegan', 'Vegan', array['product']::text[], 'boolean', null, 'Dietary', true, 90),
  ('vegetarian', 'Vegetarian', array['product']::text[], 'boolean', null, 'Dietary', true, 100),
  ('gluten_free', 'Gluten-Free', array['product']::text[], 'boolean', null, 'Dietary', true, 110),
  ('caffeine_free', 'Caffeine-Free', array['product']::text[], 'boolean', null, 'Dietary', true, 120),
  ('non_alcoholic', 'Non-Alcoholic', array['product']::text[], 'boolean', null, 'Dietary', true, 130)
on conflict (key) do nothing;

insert into public.taxonomy_aliases (phrase, dimension, target_code, entity_types, source) values
  ('kids', 'audience', 'kids', null, 'migration'),
  ('children', 'audience', 'kids', null, 'migration'),
  ('for kids', 'audience', 'kids', null, 'migration'),
  ('family', 'audience', 'family', null, 'migration'),
  ('families', 'audience', 'family', null, 'migration'),
  ('family friendly', 'audience', 'family', null, 'migration'),
  ('family-friendly', 'audience', 'family', null, 'migration'),
  ('all ages', 'audience', 'all_ages', null, 'migration'),
  ('teens', 'audience', 'teens', null, 'migration'),
  ('teenagers', 'audience', 'teens', null, 'migration'),
  ('adults', 'audience', 'adults', null, 'migration'),
  ('18+', 'audience', '18_plus', null, 'migration'),
  ('21+', 'audience', '21_plus', null, 'migration'),
  ('21 and over', 'audience', '21_plus', null, 'migration'),
  ('professionals', 'audience', 'professional', null, 'migration'),
  ('creators', 'audience', 'creators', null, 'migration'),
  ('walk in', 'entry_mode', 'walk_in', null, 'migration'),
  ('walk-in', 'entry_mode', 'walk_in', null, 'migration'),
  ('walk ins', 'entry_mode', 'walk_in', null, 'migration'),
  ('rsvp', 'entry_mode', 'rsvp', null, 'migration'),
  ('registration', 'entry_mode', 'registration', null, 'migration'),
  ('register', 'entry_mode', 'registration', null, 'migration'),
  ('tickets', 'entry_mode', 'ticket', null, 'migration'),
  ('ticketed', 'entry_mode', 'ticket', null, 'migration'),
  ('reservations', 'entry_mode', 'reservation', null, 'migration'),
  ('invite only', 'entry_mode', 'invite', null, 'migration'),
  ('free', 'price_kind', 'free', null, 'migration'),
  ('free admission', 'price_kind', 'free', null, 'migration'),
  ('free entry', 'price_kind', 'free', null, 'migration'),
  ('no cover', 'price_kind', 'free', null, 'migration'),
  ('paid', 'price_kind', 'paid', null, 'migration'),
  ('donation', 'price_kind', 'donation', null, 'migration'),
  ('pay what you wish', 'price_kind', 'donation', null, 'migration'),
  ('indoor', 'setting', 'indoor', null, 'migration'),
  ('indoors', 'setting', 'indoor', null, 'migration'),
  ('outdoor', 'setting', 'outdoor', null, 'migration'),
  ('outdoors', 'setting', 'outdoor', null, 'migration'),
  ('online', 'setting', 'online', null, 'migration'),
  ('virtual', 'setting', 'online', null, 'migration'),
  ('hybrid', 'setting', 'hybrid', null, 'migration'),
  ('free samples', 'benefit', 'free_samples', null, 'migration'),
  ('samples', 'benefit', 'free_samples', null, 'migration'),
  ('free food', 'benefit', 'free_food', null, 'migration'),
  ('free drinks', 'benefit', 'free_drinks', null, 'migration'),
  ('giveaways', 'benefit', 'giveaways', null, 'migration'),
  ('swag', 'benefit', 'swag', null, 'migration'),
  ('discounts', 'benefit', 'discounts', null, 'migration'),
  ('vegan', 'attribute', 'vegan', array['product']::text[], 'migration'),
  ('wifi', 'attribute', 'wifi', array['location']::text[], 'migration'),
  ('wi-fi', 'attribute', 'wifi', array['location']::text[], 'migration'),
  ('outdoor seating', 'attribute', 'outdoor_seating', array['location']::text[], 'migration'),
  ('patio', 'attribute', 'outdoor_seating', array['location']::text[], 'migration'),
  ('wheelchair accessible', 'attribute', 'wheelchair_accessible', array['location']::text[], 'migration'),
  ('accessible', 'attribute', 'wheelchair_accessible', array['location']::text[], 'migration'),
  ('pet friendly', 'attribute', 'pet_friendly', array['location']::text[], 'migration'),
  ('dog friendly', 'attribute', 'pet_friendly', array['location']::text[], 'migration'),
  ('gluten free', 'attribute', 'gluten_free', array['product']::text[], 'migration'),
  ('events', 'entity_type', 'event', null, 'migration'),
  ('brands', 'entity_type', 'business', null, 'migration'),
  ('shops', 'entity_type', 'business', null, 'migration'),
  ('places', 'entity_type', 'location', null, 'migration'),
  ('products', 'entity_type', 'product', null, 'migration')
on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;

insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'pop up', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'pop-up' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'pop-up', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'pop-up' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'popup', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'pop-up' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'pop up', 'appearance_type', x.id, array['appearance']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'appearance_type' and x.slug = 'pop-up' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'pop-up', 'appearance_type', x.id, array['appearance']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'appearance_type' and x.slug = 'pop-up' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'popup', 'appearance_type', x.id, array['appearance']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'appearance_type' and x.slug = 'pop-up' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'sampling', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'sampling' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'product launch', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'product-launch' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'launch', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'product-launch' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'activation', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'brand-activation' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'sample sale', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'sample-sale' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'meet and greet', 'experience_mechanic', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'experience_mechanic' and x.slug = 'meet-greet' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'market', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'market' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'markets', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'market' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'fair', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'market' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'flea market', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'market' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'festival', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'festival' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'tasting', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'tasting' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'tastings', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'tasting' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'class', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'class' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'classes', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'class' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'workshop', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'workshop' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'workshops', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'workshop' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'panel', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'talk-panel' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'talk', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'talk-panel' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'meetup', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'meetup-social' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'party', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'party' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'exhibit', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'exhibition' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'exhibition', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'exhibition' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'screening', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'screening' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'watch party', 'event_type', x.id, array['event']::text[], 'migration' from public.taxonomy_terms x where x.vocabulary = 'event_type' and x.slug = 'watch-party' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'coffee', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'coffee' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'espresso', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'coffee' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'tea', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'tea' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'matcha', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'matcha' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'pastry', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'bakery-pastry' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'bakery', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'bakery-pastry' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'wine', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'wine' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'beer', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'beer' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'cocktails', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'cocktails' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'plant based', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'plant-based' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'vegan', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'plant-based' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'streetwear', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'streetwear' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'sneakers', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'sneakers' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'vintage', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'vintage' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'thrift', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'vintage' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'skincare', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'skincare' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'makeup', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'beauty' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'perfume', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'fragrance' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'running', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'running' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'run club', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'running' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'yoga', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'yoga' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'live music', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'live-music' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'dj', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'djs-dance' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'parenting', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'parenting' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'pets', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'pets' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'dogs', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'pets' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'halloween', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'halloween' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'thanksgiving', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'thanksgiving' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'holidays', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'winter-holidays' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'christmas', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'winter-holidays' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'valentines', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'valentines-day' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'valentine''s day', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'valentines-day' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'lunar new year', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'lunar-new-year' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'pride', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'pride' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'fashion week', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'fashion-week' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'nyfw', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'fashion-week' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'marathon', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'nyc-marathon' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;
insert into public.taxonomy_aliases (phrase, dimension, target_id, entity_types, source) select 'nyc marathon', 'topic', x.id, null, 'migration' from public.topics x where x.slug = 'nyc-marathon' on conflict (phrase, dimension, (coalesce(target_id::text, target_code))) do nothing;

insert into public.taxonomy_legacy_mappings (legacy_source, legacy_kind, legacy_slug, targets, status, note) values
  ('category', 'event_format', 'brand-activation', '[{"dimension":"experience_mechanic","slug":"brand-activation"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'pop-up', '[{"dimension":"experience_mechanic","slug":"pop-up"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'sampling', '[{"dimension":"experience_mechanic","slug":"sampling"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'product-launch', '[{"dimension":"experience_mechanic","slug":"product-launch"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'retail-experience', '[{"dimension":"experience_mechanic","slug":"retail-experience"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'sample-sale', '[{"dimension":"experience_mechanic","slug":"sample-sale"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'market', '[{"dimension":"event_type","slug":"market"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'festival', '[{"dimension":"event_type","slug":"festival"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'networking', '[{"dimension":"event_type","slug":"networking"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'talk-panel', '[{"dimension":"event_type","slug":"talk-panel"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'workshop', '[{"dimension":"event_type","slug":"workshop"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'conference', '[{"dimension":"event_type","slug":"conference"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'exhibition', '[{"dimension":"event_type","slug":"exhibition"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'immersive-experience', '[{"dimension":"event_type","slug":"immersive-experience"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'performance', '[{"dimension":"event_type","slug":"performance"}]'::jsonb, 'draft', null),
  ('category', 'event_format', 'party-social', '[{"dimension":"event_type","slug":"party"}]'::jsonb, 'draft', 'Review: some rows may be Meetup & Social rather than Party.')
on conflict (legacy_source, legacy_kind, legacy_slug) do nothing;
