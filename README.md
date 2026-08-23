# Findmi

Find what you're looking for. And where it'll be next.

Findmi is a mobile-first discovery platform for brands, vendors, mobile
businesses, and events — built to answer "where can I find this business
next?" It connects businesses → products/services → appearances → events →
locations, so discovery works in both directions: from a business to where
they'll be next, and from an event to who you'll find there.

## Stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS**
- **Supabase** (Postgres + row level security, no custom backend)
- **Stripe** Payment Links (Founding Membership checkout — no Stripe Connect yet)
- **Tally** (vendor onboarding + consumer inquiry forms)
- **Vercel** (hosting)

## 1. Local setup

### Prerequisites

- Node.js 18.18+ (Node 20/22 recommended)
- A [Supabase](https://supabase.com) project (free tier is fine)
- A [Stripe](https://stripe.com) account with a Payment Link
- A [Tally](https://tally.so) account with two forms

### Install

```bash
npm install
```

### Configure Supabase

1. Create a new Supabase project.
2. Open the SQL editor and run **`supabase/schema.sql`** — this creates all
   tables, indexes, RLS policies, and the `updated_at` trigger.
3. Run **`supabase/seed.sql`** — this loads realistic, clearly-fictional
   sample data (6 interconnected businesses, 3 events, appearances, and
   products) so the app isn't empty on first load. Safe to skip or re-run.
4. In **Project Settings → API**, copy the **Project URL** and **anon
   public key**.

### Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_STRIPE_FOUNDING_LINK` | Stripe → Payment Links (see below) |
| `NEXT_PUBLIC_TALLY_ONBOARDING_URL` | Tally → your vendor onboarding form's share link |
| `NEXT_PUBLIC_TALLY_INQUIRY_URL` | Tally → your consumer inquiry form's share link |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally, your production domain on Vercel |

The app runs and builds even without these set (data calls fail soft to
empty states), but membership checkout, onboarding, inquiries, and live
data all require them.

### Run

```bash
npm run dev
```

Visit `http://localhost:3000`.

## 2. Stripe: Founding Membership Payment Link

Findmi V1 intentionally uses a single **Stripe Payment Link** instead of a
custom checkout flow or Stripe Connect (that's left for later, once
businesses need their own payouts).

1. In the Stripe Dashboard, create a **Product**: "Findmi Founding
   Membership", **$99.00 / year** (recurring).
2. Create a **Payment Link** for that price.
3. Under the Payment Link's **After payment** settings, set the
   confirmation page to redirect to:
   `https://YOUR-DOMAIN/join/success`
4. Copy the Payment Link URL into `NEXT_PUBLIC_STRIPE_FOUNDING_LINK`.

The `/join` page links directly to this URL. `/join/success` is the
Stripe redirect target and prompts the new member to fill out the Tally
onboarding form.

## 3. Tally forms

Findmi uses two Tally forms:

**Vendor onboarding** (`NEXT_PUBLIC_TALLY_ONBOARDING_URL`) — shown as
"Build My Profile" on `/join/success` after a successful payment. Ask for
whatever you need to build a business's Findmi profile (name, categories,
photos, socials, first appearances, etc.).

**Consumer inquiry** (`NEXT_PUBLIC_TALLY_INQUIRY_URL`) — linked from every
business profile's "Book / Inquire" section. Findmi appends hidden query
parameters so each submission is tied to the right business:

```
?business_id={id}&business_name={name}&business_slug={slug}&source=findmi_profile
```

In your Tally form, add hidden fields named exactly `business_id`,
`business_name`, `business_slug`, and `source` — Tally automatically
pre-fills a hidden field from a matching URL query parameter. Add whatever
visible fields you want customers to fill in (name, email, phone, event
date, event type, location, guest count, budget, message, and a checkbox
like "It's OK to suggest another Findmi business if this one isn't
available" — these map to the `inquiries` table if you later wire up a
Tally webhook into Supabase).

The URL-building logic lives in one place: `src/lib/tally.ts`.

## 4. Deploy to Vercel

1. Push this repo to GitHub (or your git host of choice).
2. In Vercel, **New Project** → import the repo. Framework preset:
   **Next.js** (auto-detected).
3. Add the environment variables from `.env.example` under **Project
   Settings → Environment Variables** (use your real values, and set
   `NEXT_PUBLIC_SITE_URL` to your Vercel/production domain).
4. Deploy.
5. Update the Stripe Payment Link's "After payment" redirect and your
   Tally forms' hidden fields (if needed) to point at your live domain.

No server config, database migrations at build time, or serverless
functions beyond the one small `/api/follow` route (used by the "Follow"
button so the Supabase client stays server-side) are required.

## 5. Adding & managing data (no admin dashboard in V1)

V1 intentionally ships without a business dashboard or admin UI — content
is managed directly in **Supabase Studio** (Table Editor), which is fast
enough for a founding cohort of businesses:

1. Open your project in Supabase → **Table Editor**.
2. **New business** → add a row to `businesses` (slug must be unique,
   URL-safe, e.g. `my-coffee-cart`).
3. **Assign categories** → add a row to `business_categories` linking the
   business to one or more rows in `categories` (add new categories there
   too, if needed).
4. **Add products/services** → add rows to `products` with that
   `business_id`.
5. **Add an appearance** ("Findmi Next") → add a row to `appearances`
   with that `business_id`. Leave `event_id` null for a standalone
   appearance, or set it to group the appearance under a shared `events`
   row.
6. **Add an event** → add a row to `events`, then link businesses to it
   via `event_businesses` (one row per participating business) — that
   powers both "Findmi Next" on the business profile and "Who You'll Find
   There" on the event page.
7. Toggle `founding_member` / `verified` to `true` once a business's
   membership is confirmed, and `membership_status` to `active`.

`inquiries` and `followers` fill in automatically from the site (public
insert-only via RLS) — review them in Table Editor. A future step would
be a Tally → Supabase webhook to write `inquiries` rows directly from
form submissions; V1 keeps that manual/optional to stay simple.

A password-protected `/admin` route was intentionally left out of V1 to
avoid delaying launch — Supabase Studio covers the same need today.

## 6. Project structure

```
src/
  app/                  Routes (App Router)
    business/[slug]/    Business profile
    event/[slug]/       Event profile
    businesses/         Directory + search
    events/             Event discovery
    discover/           General discovery feed
    join/                Membership sales page
    join/success/        Post-checkout onboarding CTA
    api/follow/          Follow-capture route (keeps Supabase server-side)
  components/           UI building blocks (cards, nav, forms)
  lib/
    supabase.ts          Single shared Supabase client (reads are RLS-gated)
    data.ts               All Supabase queries, in one place
    tally.ts               Tally URL builder (hidden-field contract)
    format.ts               Date/price/location formatting helpers
    types.ts                 Shared TypeScript types matching the schema
supabase/
  schema.sql             Full schema, indexes, RLS policies
  seed.sql                 Realistic interconnected sample data
```

## 7. What's deliberately not in V1

- No business auth or self-serve dashboard — profiles are managed via
  Supabase Studio and Tally onboarding.
- No Stripe Connect / marketplace payouts — Founding Membership is a
  single flat-rate Payment Link. Architecture (separate `businesses` and
  `products` tables, no payment fields baked into products) is ready for
  Connect later without a schema rewrite.
- No search engine (Algolia/Elasticsearch) — filtering is plain
  Postgres `ilike` text search plus category joins, which is enough at
  founding-cohort scale.
- No map SDK — event/appearance rows carry `latitude`/`longitude` and a
  "Get directions" link out to Google Maps; a map view can be layered on
  top of that data later.
