-- Discovery Lanes Placement & Density Refinement pass — additive column
-- so the homepage can split Admin-ordered Lanes into two regions
-- (Primary Discovery, near the top; Explore More, lower down) without a
-- title/kind/index-based guess. Defaults every existing/new lane to
-- "explore_more" (today's only behavior) and backfills exactly the
-- "Right Now" lane to "primary" — no other row touched.
alter table discovery_lanes
  add column placement text not null default 'explore_more'
    check (placement in ('primary', 'explore_more'));

update discovery_lanes
  set placement = 'primary'
  where id = '3445f81b-9314-4d25-8f89-93069ef1de82';

-- At most one Primary Discovery lane per page at any time — backs the
-- Admin "Make Primary" control's single-select behavior at the DB layer,
-- not just in the UI.
create unique index discovery_lanes_one_primary_per_page
  on discovery_lanes (page_id)
  where placement = 'primary';
