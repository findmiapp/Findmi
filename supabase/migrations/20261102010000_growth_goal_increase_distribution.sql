-- Pass 2 — Growth goal "Increase Distribution" (increase_distribution).
--
-- Adds one Growth Setup goal to the EXISTING goal vocabulary
-- (brand_audit_answers kind = 'goal'). "Grow Retail Presence" (retail_trial)
-- stays a separate goal. No new goal system, table or column.
--
-- The only change is the key check constraint, recreated with the same lists
-- as 20261023000000_brand_intelligence_v1_2.sql plus 'increase_distribution'.
-- It is a strict superset, so every existing row still satisfies it. Value
-- lists mirror src/lib/brand-audit-domain.ts. Re-running this file is safe.

alter table public.brand_audit_answers drop constraint if exists brand_audit_answers_key_check;
alter table public.brand_audit_answers add constraint brand_audit_answers_key_check check (
  (kind = 'goal' and option_key in ('build_awareness','product_sampling','drive_sales','product_launch','foot_traffic','reach_new_customers','community_engagement','lead_generation','generate_content','increase_distribution','retail_trial','partnerships','other'))
  or (kind = 'challenge' and option_key in ('finding_opportunities','activation_locations','reaching_audience','product_trial','local_awareness','reliable_partners','staffing_execution','measuring_results','budget_efficiency','content_reach','retail_access','other'))
  or (kind = 'audience' and option_key in ('gen_z','young_professionals','parents_families','college_students','creators','entrepreneurs','office_workers','fitness_wellness','food_drink','beauty','fashion','tech','sports_fans','entertainment_culture','travelers','local_communities','b2b','other'))
  or (kind = 'age_range' and option_key in ('under_18','18_20','21_24','25_34','35_44','45_54','55_64','65_plus','not_primary'))
  or (kind = 'audience_priority' and option_key in ('women','men','lgbtq','multicultural','no_priority','other'))
  or (kind = 'market_scope' and option_key in ('local','regional','national','multi_market'))
  or (kind = 'environment' and option_key in ('retail','residential','workplaces','campuses','fitness_wellness','hospitality','restaurants_cafes','festivals_events','street','community_events','creator_events','conferences','other'))
);
