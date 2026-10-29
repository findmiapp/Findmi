# Routes and Information Architecture

Derived from the `src/app` route tree at `aa7d1e2`. Always re-derive URLs
from the route tree instead of trusting this list blindly.

## Public consumer (`src/app/(public)`)

| Route | Purpose |
| --- | --- |
| `/` | Home. Approved render order (guarded by `tests/homepage-section-order.test.mjs`): Weather · Hero · Search · Bulletin · Start Here doorway · Primary Discovery · What's Happening · Brands We Love · Moments · Featured Locations · Explore More Discovery · Business Showcase · remaining founder rows · Closing CTA |
| `/discover` | Broader discovery (Discovery Engine) |
| `/explore/[market]/[area]` | Geographic discovery |
| `/find` | Findmi Here feed (appearances, now / today / weekend / anytime) |
| `/map` | Discovery Map. **Under active QA** |
| `/search` | Search |
| `/events`, `/event/[slug]`, `/event/[slug]/journal` | Events, Event detail, Event Moments |
| `/locations`, `/location/[slug]` | Locations |
| `/businesses`, `/business/[slug]` | Businesses / Brands |
| `/product/[slug]`, `/marketplace`, `/cart`, `/checkout/success` | Products and marketplace |
| `/people`, `/people/[slug]` | People |
| `/guides/[slug]` | Discovery Pages / Guides |
| `/moments` | Moments: Explore · For You · My Moments, Feed or Map (`?display=map`) |
| `/journal`, `/journal/[id]` | My Journal (signed in) and a single Moment (RLS-gated read) |
| `/my-world/journal/new`, `/my-world/journal/[id]/edit` | Moment composer / editor (`/my-world` and `/my-world/journal` → 308 `/journal`) |
| `/saved` | Signed out: device-local saves. Signed in: redirects to `/account/saved` |
| `/[username]`, `/user/[username]` | Public user profiles |
| `/you` | Personal entry |
| `/join`, `/join/business`, `/join/brand`, `/join/start`, `/join/sales`, `/join/passbook`, `/join/welcome`, `/join/success` | Joining and onboarding. `/join/brand` = Brand Build |
| `/upgrade/pro`, `/redeem/[code]` | Pro checkout, invite redemption |
| `/login`, `/signup/*`, `/forgot-password`, `/reset-password`, `/auth/callback` | Auth |
| `/about`, `/privacy`, `/privacy-choices`, `/terms` | Static / legal |
| `/q/[code]` | QR scan redirect + tracking |
| `/embed/business/[slug]` | Embeddable widget |

## Consumer account (`/account`, signed in)

Account Home sections (in order): Events You Might Like · From Pages You
Follow · Upcoming Events (From Pages You Follow) · Places / Products /
Brands You Might Like · Your Recent Moments · Pages I Manage · Events You
Manage · Needs Your Attention · Inbox · Pending Claims.

Sub-routes: `saved` (Your Library), `following`, `messages`, `inquiries`,
`orders`, `profile`, `privacy` (+ `privacy/export`), `schedule`,
`verify-email`, `business` (chooser), `business/new`, `event/new`,
`event/[id]`, `location/new`, `location/[id]`, `qr/[id]`.

Personal nav (`lib/primary-nav.ts`): Your Library · My Journal · Add Moment
· Messages · Account, plus one compact Manage entry (one Business goes
straight to its manager, several go to the chooser).

## Business Manager (`/account/business/[id]`)

Destinations are `?tab=` keys (`v2/business-nav.ts` is the single source):

| Nav (mobile bottom bar) | Tab |
| --- | --- |
| Home | `overview` |
| Moments | `moments` |
| **Findmi Here** (center) | `findmi-here` |
| Performance (incl. QR Codes) | `performance`, `qr` |
| More | `more` |

Desktop rail adds **Products** (`products`) and **Opportunities**
(`growth`). More lists Public Profile (`profile`), Photos (`gallery`),
Products, Opportunities, QR Codes, Inquiry Settings (`inquiries`), Orders,
Plan & Settings (`settings`). Legacy keys redirect: links → profile,
plan / market → settings, followers → performance, opportunities → Inbox
filter.

Sub-routes: `inbox`, `inbox/[conversationId]`, `map`, `search`,
`import-event`, `import-locations` (+ history), `qr`, `qr/new`,
`opportunities/[recipientId]`, `opportunities/explore/[listingId]`,
`opportunities/goals/new`, `opportunities/goals/[goalId]/edit`,
`inquiries/[inquiryId]`, `brand-audit`, `pro-request`.

## Admin (`/admin`)

Groups from `components/admin/adminNavItems.ts`: Directory (Businesses,
Locations, Products, People) · Structure (Categories, Markets & Areas) ·
Activity (Events, Appearances, Opportunities, Opportunity Intelligence,
Opportunity Ideas, Activations) · Import (Events, Locations, Brands,
Appearances, Convert To Events) · Requests (Claims, Profile Approvals,
Market Requests) · Trust & Privacy (Reports, Privacy Requests, Audit Log) ·
Communications (Inquiries, Sales, Commercial) · Pro Access (Requests,
Invites, Plans) · Business Development (Organizations, Contacts) ·
Accounts (Users) · Commerce (Orders, Settlements) · Growth (Referrals, QR
Campaigns) · Site (Site Editor: homepage, rows, navigation, discovery,
geography, pages, about, contact, join) · Legacy (Onboarding, Forms,
Journal, Homepage Bulletins, Email Test). Logout is at `/admin/more`.

## JerseyCity.guide (`src/app/jc`)

`/`, `/discover`, `/events`, `/events/[slug]`, `/places`,
`/places/[slug]`, `/n/[neighborhood]`. Served at the `jerseycity.guide`
root. `/jc/*` on that host redirects to `/*`.

## APIs

`/api/account/*` (follow, save, sync, claim, search, me, world),
`/api/analytics/{track,qr-arrival}`, `/api/collections`,
`/api/product-want`, `/api/relationships`, `/api/discovery/map(/preview)`,
`/api/geo/[surface]`, `/api/homepage-*`, `/api/search`, `/api/reports`,
`/api/privacy/choices`, `/api/membership-status`,
`/api/webhooks/{stripe,stripe/subscriptions,tally}`, `/api/cron/geocode`.
Legacy `/api/follow*` and `/api/saved` remain. [VERIFY] whether anything
still calls them.
