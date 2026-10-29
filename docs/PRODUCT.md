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
  Recurring commercial plans: **Pro** and **Managed Pro**, monthly or
  annual, priced only through Stripe Price IDs in env. Planning figures
  are $20/mo · $149/yr (Pro) and $49 · $399 (Managed Pro). The legacy
  $99/yr one-time checkout is the fallback until recurring billing is
  configured. Which one is live in production: [VERIFY]. [CODE]
- Pro is associated with Performance change/trend detail, inquiries
  tooling and market allowances (`lib/entitlements.ts`). QR creation is
  never plan-gated. [CODE]
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
