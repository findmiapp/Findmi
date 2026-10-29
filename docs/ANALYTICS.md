# Analytics and Performance

## Pipeline [CODE][SCHEMA]

- Client tracking: `lib/analytics/track.ts` (+ `useViewportImpression`
  for impressions) posts to `/api/analytics/track`. That route is
  rate-limited (`rateLimit.ts`) and sanitizes input (`sanitize.ts`).
- Server tracking: `serverTrack.ts`. QR scans are recorded at
  `/q/[code]` (`qrScan.ts`), and arrival is attributed via
  `/api/analytics/qr-arrival`.
- Session: `session.ts` / `session-constants.ts`. Context:
  `context.ts`.
- Storage: one row per event in `analytics_events` (about 12.4k rows on
  2026-10-29). Subject (`subject_type` / `subject_id`) + entity FKs, page
  type/path, placement, session, user, referrer, UTM, `qr_campaign_id`,
  `acquisition_source`, `acquisition_qr_campaign_id`, discovery
  page/section/topic, area.
- Retention: when `ANALYTICS_RETENTION_DAYS` (≥30) is set, Admin → Privacy
  Requests can de-identify older rows (account link, referrer and session
  are removed, totals kept) (`retention.ts`).

## Event taxonomy — `lib/analytics/taxonomy.ts` is canonical

`page_view`, `save`/`unsave`, `follow`/`unfollow`,
`click_contact_channel` (phone, email, website, instagram, facebook,
tiktok), `share` (web_share_api, clipboard), `entity_impression`,
`entity_click`, `click_directions`, `click_rsvp`, `click_tickets`,
`click_apply_to_vend`, `click_contact_organizer`, `product_external_click`,
`search`, `filter_change`, `discovery_section_impression`, `qr_scan`,
`topic_open`, `area_open`, `search_submit`, `search_result_open`,
`relationship_set`/`unset`, `click_public_action`, `want`/`unwant`.
Subject types: business, event, event_occurrence, appearance, location,
product.

A QR interaction is one resolved `qr_scan`. There's no
qr_click/qr_view/qr_open. Add new names only in `taxonomy.ts`, and reuse
an existing name if one fits.

## Performance (owner-facing)

`lib/analytics/ownerPerformance.ts` powers manager Home's pulse and the
Performance destination: Impressions, Profile Views, Actions (labelled
groups such as Product Clicks), Followers, discovery sources (page types
such as Business Profile and Product Page, plus placements such as
Featured Products), ranked Appearances and Products, and audience. Range
labels come from `ownerPerformanceRangeLabel()`. QR detail comes from
`qrCampaignDetail.ts` (unique visitors, actions).

## Gating

The headline is available on Free. Change/trend labels are Pro-only. QR
creation is never gated. The full per-view Pro matrix: [VERIFY] in
`PerformanceViews.tsx` / `PerformanceTab.tsx` before documenting more.

## Not yet documented — verify before stating

Exact definitions of unique visitor, deduplication, attribution windows,
bot or internal or owner-traffic filtering, time zones and aggregation.
Read `ownerPerformance.ts` / `qrCampaignDetail.ts` before writing any
formula here.
