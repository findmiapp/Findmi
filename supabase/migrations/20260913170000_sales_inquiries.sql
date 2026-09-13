-- Multi-Region / National Sales Inquiry pass — a dedicated, minimal
-- table for leads submitted through /join's Multi-Region/National
-- "Talk to Sales" flow (source='join_multi_region'). Deliberately NOT
-- the customer<->business `inquiries` table (a completely different
-- shape: requires an authenticated user_id + an existing business_id,
-- built for a signed-in customer messaging a real Findmi business) and
-- NOT `market_requests` (geography proposals, no contact/business/goals
-- fields at all) — neither can represent a prospective national/
-- multi-region brand's own sales lead without distorting its schema.
--
-- RLS enabled with NO public policies — same "deny-by-default, all
-- public writes go through a validated Server Action using the
-- service-role admin client" precedent as market_requests/inquiries
-- (see 20260905230000_area_picker_and_market_requests.sql's own header
-- comment). Nothing here is ever publicly readable; the founder reads it
-- via requireAdminSupabase() at /admin/sales-inquiries, exactly like
-- every other admin screen.
create table if not exists public.sales_inquiries (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null,
  business_name text not null,
  email text not null,
  phone text,
  website_or_instagram text,
  city_market_count integer not null,
  regions text not null,
  goals text not null,
  source text not null default 'join_multi_region',
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists sales_inquiries_status_idx on public.sales_inquiries (status);
create index if not exists sales_inquiries_created_at_idx on public.sales_inquiries (created_at desc);

alter table public.sales_inquiries enable row level security;
