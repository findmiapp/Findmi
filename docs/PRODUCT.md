# Findmi Product Definition

Evidence tags are defined in `RECONCILIATION-2026-10-29.md`.

## Thesis

Findmi connects digital discovery to the physical world. For any brand,
product, place or event it should answer **what** it is, **where** it is,
**where it will be**, **when** something is happening, what's available
there, what people experienced, and what's relevant to *you*.

For Businesses it answers: How am I represented? Where am I appearing?
Where are my products available? What should I do next? Which
opportunities exist? How do people find me and act on it?

The durable chain:

```
Business/Brand → Products → Locations / Events(→Occurrences) → Appearances / Availability
      → Consumers → Moments · Follows · Wants/Relationships · Saves · Collections · Actions → Performance
```

## Users

- **Consumers.** Discovery works signed out. A Supabase Auth account
  unlocks follows, Library, Moments authorship, messages and orders. [CODE]
- **Page managers.** Signed-in users who manage Businesses, Locations or
  Events ("Pages I Manage"). Acting identities: `personal` | `business` |
  `location` (`lib/capabilities.ts`). [CODE]
- **Founder / Admin.** Curation, imports, moderation, taxonomy, BD CRM,
  settlements and site configuration at `/admin`. [CODE]

## Core entities (see `DATA-MODEL.md` for tables)

- **Business / Brand.** The durable public entity. "Brand" is mainly
  consumer-facing wording ("Brands We Love", Brand Build onboarding). It's
  the same `businesses` table, not a separate entity. [SCHEMA]
- **Location.** A first-class place with a public page, hours, geocoding,
  a place hierarchy and managers. Never reduce it to an address string when
  a Location exists. [SCHEMA]
- **Event + Occurrences.** An Event is the identity. Its schedule is a
  Primary Date plus `event_occurrences` for every other date. Never
  duplicate Events per date. [SCHEMA]
- **Appearance.** A Business present in a real-world context (Event,
  Occurrence or Location). Owner-facing name: **Where I'll Be**. [SCHEMA]
- **Product.** A Business's catalog item. It can be sold through the
  marketplace and linked to Availability. [SCHEMA]
- **Availability.** A Business (optionally specific Products) at a
  Location, with relationships `stocked · sold · served · featured ·
  sampled`, status `pending · live · declined`, and an optional date
  range. [SCHEMA]
- **Moment.** Findmi's experience/documentation layer: multi-photo,
  sectioned, connected to Events, Locations, Businesses and Products.
  Stored as `journal_entries*`. [SCHEMA]
- **QR campaign.** A physical-to-digital bridge to any entity or URL,
  measured in Performance. [SCHEMA]
- **Opportunity.** An actionable commercial opportunity (listings,
  invitations, ideas, goals, commercial terms, threads). It's not a
  passive insight. [SCHEMA]
- **Markets / Areas.** Geographic discovery (`/explore/[market]/[area]`),
  backed by Census geographies. [SCHEMA]
- **Collections.** Private, user-named folders of any entity, independent
  of Wants and Saves. [SCHEMA]

## Terminology dictionary — don't substitute casually

| Term | Meaning / where | Status |
| --- | --- | --- |
| **Findmi** | Brand name in all copy | Locked |
| **Findmi Here** | The feature name for real-world presence: consumer `/find` feed, and the center tab of the Business Manager (Appearances + Availability + Locations) | Current [CODE] |
| **Here Now** | Only for a genuinely live appearance (now is between start and end). Never approximated | Locked |
| **Where I'll Be** | Owner-facing label for creating/listing a Business's Appearances | Current [CODE] |
| **Moments** | The experience content layer. `/moments` = Explore · For You · My Moments | Current [CODE] |
| **My Moments** | Mode on `/moments` showing your own Moments in the shared card feed | Current [CODE] |
| **My Journal** | `/journal`, the personal dated archive (Day / Week / Month / Year, newest first) | Current [CODE] |
| **Add Moment** | Composer entry, `/my-world/journal/new` | Current [CODE] |
| **Your Library** | `/account/saved`, one personal library: Things I Want · Want To Do · Want To Go · Must Do · Have & Been · Following · Saved + Collections | Current [CODE] |
| **Things I Want / Want** | Product Want (`product_wants`) | Current [CODE] |
| **Mark As** | Relationship states: want · must_do · like · dislike · been · have (`user_entity_relationships`) | Current [SCHEMA] |
| **Pages I Manage** | Account Home section listing managed Pages | Current [CODE] |
| **Upcoming Events / From Pages You Follow** | Consumer Account Home upcoming followed content | Current [CODE] |
| **Coming Up** | Business Manager Home rail of the owner's own schedule. Location pages: "Coming Up Here" | Current [CODE]. Consumer use retired |
| **Performance** | Owner analytics destination (includes QR Codes) | Current [CODE] |
| **Needs Attention** | Count badge inside Inbox / Follow-Ups on manager Home. Not a nav item or standalone row | Current [CODE] |
| **Growth Manager** | Manager Home module: Set Goals · Opportunities · Ideas (· Set Targets) | Current [CODE] |
| **Opportunities** | Manager destination (formerly "Growth") | Current [CODE] |
| **Profile Buttons** | Public Profile tab for entity public actions (formerly "Public Actions") | Current [CODE] |
| **Follow Their Moves · Find Them · Who You'll Find Here · What You'll Find** | Established consumer phrasing | Current |
| ~~My World~~ | Retired. Redirects to `/journal` | [SUPERSEDED] |
| ~~Passbook~~ | Removed from current copy (route `/join/passbook` still exists) | [SUPERSEDED] |
| ~~FindMi Next / Where I'll Be Next~~ (as feature names) | Use Findmi Here | [SUPERSEDED] |

## Monetization

- **Business plans** (`plan_tier`): `free` · `pro` · `pro_seller`.
  `isBusinessPro` = tier pro/pro_seller **and** (`plan_expires_at` null or
  in the future). [CODE]
- **Displayed pricing (public):** `/join/business` and
  `/account/business/new` say Business Pages are **free** ("Free. No
  trial. No credit card.") and show **no** Pro pricing. Pro pricing
  appears only at `/upgrade/pro` (reached from the manager's "Upgrade to
  Pro" links). [CODE]
- **Checkout path at `/upgrade/pro`:** if
  `STRIPE_SUBSCRIPTIONS_SECRET_KEY` and all four recurring Price IDs are
  set, it shows the recurring picker (Pro $20/mo · $149/yr, Managed Pro
  $49/mo · $399/yr, display values in `lib/commerce/plans.ts`, charged
  from env Price IDs). Otherwise it shows the **legacy $99 / one year,
  one-time** Stripe Checkout. [CODE]
- **Production evidence (2026-10-29):** `business_subscriptions` has **0
  rows** (no recurring subscription has ever been created). Of 35 `pro`
  Businesses, only **1** is `plan_source = paid`, through a live one-time
  Checkout session (Sept 2026). The rest are admin/complimentary/invite
  grants, 27 of them with no expiry. Whether the recurring env vars are set
  in Vercel can't be read from here. The admin diagnostic
  `/admin/api/stripe-subscriptions-diagnostic` or the Vercel env settings
  will answer it. [SCHEMA] / [VERIFY]
- **Legacy `membership_plans` rows** (Founding 500 `annual_price` 1, Pro
  249, Multi-Region 750, all flagged active/public) are still in the
  database, but no current page renders `PlanCheckoutForm`, so that
  checkout is unreachable from the UI. The 25 `memberships` rows all date
  from Aug 2026. [SCHEMA][CODE]
- **What Pro actually gates in code:** the full Performance dashboard
  (Free sees the QR snapshot, Home headline numbers and an upgrade
  prompt), change/trend labels, Customer Inquiries (settings + the General
  Inquiry profile button), the Orders pill's relevance, the Pro badge, and
  market allowances (`getBusinessMarketLimit`). **QR creation isn't
  gated.** [CODE]
- **Marketplace**: a 5% default marketplace fee. Findmi holds funds and
  pays out manually (see `/CLAUDE.md` §8).
- **Claims**: a $20 listing activation through Tally payment. [CODE]
- Referral partners and Pro invites exist. [SCHEMA]

## Durable principles

Preserve real-world context, shared entities over duplicates,
Business ↔ Event/Place relationships, geographic and temporal discovery,
consumer intent/history, business measurement, physical-to-digital
interaction, hyperlocal relevance, and one platform serving both consumers
and managers.

## What Findmi is not

Not just Yelp, an event calendar, an Instagram clone, a static directory,
a QR generator, a ticketing system, a CRM, a standalone SaaS dashboard or a
business map. Those may be parts of it, but none of them defines it.
