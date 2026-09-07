alter table public.appearances
  add column market_id uuid null references public.markets(id),
  add column market_area_id uuid null references public.market_areas(id);

create index appearances_market_id_idx on public.appearances using btree (market_id);
create index appearances_market_area_id_idx on public.appearances using btree (market_area_id);
