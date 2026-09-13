-- Business-Controlled Inquiry Settings pass — the new unified Business
-- Inquiry flow (0b757d1) incorrectly showed INQUIRE on every Pro
-- Business regardless of owner intent (confirmed live: Palermo Ceramics,
-- Pro, never configured or authorized this). Fixes that by requiring an
-- explicit, owner-controlled opt-in.
--
-- Deliberately NOT reusing native_inquiries_enabled: that column's
-- existing, already-documented meaning (see account/business/[id]/
-- page.tsx's own "Messaging UX Unification pass" comment, predating this
-- pass) is narrowly "the legacy Product-page inquiries/inquiry_messages
-- compose link" — explicitly NOT the Inquire button. Repurposing it here
-- would silently change what a business's PRIOR explicit opt-in into
-- that different, still-live feature means, which is exactly the kind
-- of inference this pass was told not to make. accepts_inquiries is a
-- new, distinct flag for the new, distinct capability.
--
-- Both default to the "nothing changes for anyone today" state — false /
-- empty array — for every existing row, including the 4 businesses that
-- already opted into native_inquiries_enabled (a different feature) and
-- every existing Pro business already showing the un-gated INQUIRE
-- button pre-fix. No business is bulk-enabled; no legacy CTA field
-- (inquiry_cta_url/inquiry_cta_label) is treated as an opt-in signal.
alter table public.businesses add column if not exists accepts_inquiries boolean not null default false;
alter table public.businesses add column if not exists inquiry_topics text[] not null default '{}';

-- Same public-safe column grant pattern native_inquiries_enabled already
-- established (businesses has anon/authenticated SELECT revoked at the
-- table level with an explicit per-column grant list — see
-- restrict_internal_commerce_columns/restrict_business_contact_columns).
-- Additive: only these two new columns are granted, nothing else widens.
grant select (accepts_inquiries, inquiry_topics) on public.businesses to anon, authenticated;
