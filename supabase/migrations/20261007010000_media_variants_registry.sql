-- Legacy-variant registry — durable record of which pre-existing
-- (unmarked) findmi-media/journal-media originals have generated WebP
-- derivatives on disk, for the resolver in
-- src/lib/media-variants-registry.ts. New uploads never need a row here:
-- a successful upload gets the `.fv1.` filename marker (see
-- src/lib/image-variants.ts) and resolves its variants from the filename
-- alone, forever. This table exists ONLY to let legacy originals — whose
-- public URLs must never change, so they can never be renamed to carry
-- that marker — gain the same benefit once a future backfill generates
-- derivatives for them.
--
-- One row per ORIGINAL, not per variant. A variant's own Storage path is
-- always `variantPath(original_path, size)` — a pure function of the
-- original's own path and the requested size (see image-variants.ts) —
-- so a per-variant-row design would store that path a second time as a
-- plain string, a second source of truth that could drift from the
-- function already computing it everywhere else. `variants` holds only
-- the facts that AREN'T derivable this way: each generated size's byte
-- count, pixel dimensions, and format, keyed by size as text (`"160"`,
-- `"800"`, `"1600"`) so the set of sizes present IS the set of variants
-- that exist for that original — no separate boolean/enum columns to
-- keep in sync. This also means adding a future 4th size needs no schema
-- change, only a new key in the same column.
--
-- `role` is observability metadata only (which of MEDIA_ROLES this
-- original was backfilled as) — never read by the resolver itself, which
-- only ever asks "which sizes does this path have," not "why". A single
-- original reused across multiple roles (e.g. the same photo as both a
-- business cover and an event gallery image) still gets exactly one row,
-- with `variants` holding the UNION of sizes every role needed — the
-- backfill script's job, not this schema's.
create table if not exists public.media_variants (
  bucket text not null,
  original_path text not null,
  variants jsonb not null,
  role text,
  generated_at timestamptz not null default now(),
  primary key (bucket, original_path)
);

comment on table public.media_variants is
  'Legacy-variant registry: which pre-existing (unmarked) Storage originals have generated derivatives, and at which sizes. Written only by the backfill/admin-replace server code via the service-role client (src/lib/media-variants-registry.ts). Service-role only: RLS enabled, zero anon/authenticated policies — no client ever reads or writes this table directly. Read in batched form (one query per page, never per image) by the public image resolver as a fallback path for originals that predate the `.fv1.` filename-marker convention; `.fv1.`-marked originals never consult this table at all.';

comment on column public.media_variants.bucket is
  'Storage bucket the original lives in (findmi-media or journal-media) — part of the primary key so the same relative path in two buckets can never collide.';
comment on column public.media_variants.original_path is
  'The ORIGINAL''s own Storage object path — never a variant path, never rewritten. The existing DB column that stores this original''s public/signed URL is never touched by writing this row.';
comment on column public.media_variants.variants is
  'Per-size facts for this original''s generated derivatives, keyed by size as text, e.g. {"160": {"bytes": 8421, "width": 160, "height": 160, "format": "webp"}, "800": {...}}. The variant PATH itself is never stored here — it is always variantPath(original_path, size) (src/lib/image-variants.ts), so this column only ever holds information that function cannot already derive.';
comment on column public.media_variants.role is
  'Observability only — which media_backfill_roles.ts role this original was backfilled under (or the first one, if it serves several). Never consulted by the resolver.';

alter table public.media_variants enable row level security;
-- Deliberately zero policies: service-role requests bypass RLS entirely
-- (same convention as stripe_customers, business_subscriptions,
-- qr_campaigns, etc.) — anon and authenticated roles get no access of any
-- kind, by default-deny, rather than an explicit "deny all" policy that
-- would need to be kept in sync with nothing.
