# FindMi — Project Memory

This file is read automatically at the start of every Claude Code session
on this repo. It exists so settled product/architecture/design decisions
don't have to be re-explained in every prompt. Treat everything below as
already decided — don't re-litigate, re-audit, or re-ask about it unless
the user explicitly raises it.

## 1. What FindMi is

FindMi is a consumer discovery + marketplace platform centered on **time,
place, movement, and discovery**. Core concepts: FindMi Here, Here Now,
Businesses, Products, Appearances, Events, Locations, marketplace commerce.

FindMi should feel like a consumer technology product — not Yelp, not a
traditional directory, not a generic SaaS app, not a WordPress-style
listing site. Don't casually redesign established systems while doing an
unrelated feature pass.

## 2. Brand / design system — locked

- Consumer-facing brand capitalization: **FindMi**.
- Primary brand color, FindMi Aqua: **`#14B0BC`** (Tailwind `findmi`
  color, with a full 50–900 tint/shade scale already defined in
  `tailwind.config.ts`). Sampled directly from the real logo asset — the
  authoritative source, not invented. Used scarcely and intentionally,
  never as a flood background.
- **Never** reintroduce `#C6FF00`, lime/acid-green, or purple SaaS
  styling — those were explicitly rejected in earlier passes.
- Aqua-filled primary buttons/badges use **white text and white icons**
  (`text-white`, icons inherit via `currentColor`). Pale Aqua tints
  (`bg-findmi-50`, `bg-findmi/NN`) are a different case — they're soft
  highlight panels, not primary buttons, and correctly keep dark
  `text-findmi-700` text. Don't "fix" those.
- Typography: **Inter** is the approved typeface for the whole public
  app — both body (`--font-inter`) and display/headings
  (`--font-display`), loaded via `next/font/google` in `src/app/
  layout.tsx`. Fallback stack (see `tailwind.config.ts`):
  `Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue,
  Arial, sans-serif`. Do **not** introduce Space Grotesk, Plus Jakarta
  Sans, or another trendy/geometric display font without explicit user
  approval — both were tried and explicitly rejected as reading too
  "tech/SaaS" against the original FindMi reference screenshots.
  `globals.css` also softens `tracking-tight` specifically on
  `.font-display` elements (`-0.006em`, not Tailwind's default
  `-0.025em`) — a deliberate, centralized correction; don't revert it.
- Typography direction generally: clean, consumer-oriented, open,
  neo-grotesk, restrained weights, comfortable line-height — not
  compressed, not dev-tool/SaaS-like.
- If the user has supplied reference screenshots (of the original FindMi
  site or elsewhere) in a session, those remain the visual authority for
  whatever dimension they illustrate (typically typography) — match them
  rather than substituting a generic interpretation, even in later
  sessions that didn't see the images directly.
- Don't invent a new visual system while doing unrelated work.

## 3. Product language — locked

- Use **FindMi Here** as the feature name. Not "FindMi Next" / "Find
  Them Next" / "Where I'll Be Next" as a label or heading. Ordinary
  sentences can still say things like "see where they'll be next" — this
  rule is about the feature *name*, not banning the phrase everywhere.
- **Here Now** is reserved for a genuinely live appearance (current time
  falls between the appearance's start and end) — never guessed or
  approximated.
- Other established phrasing already in use: Follow Their Moves, Find
  Them, Who You'll Find Here, What You'll Find. Don't force branded
  wording into every sentence.

## 4. Environment constraints — DO NOT RE-DIAGNOSE

Claude's local sandbox **cannot** reach the production Supabase or
Vercel hosts. This is known and expected — not a bug to investigate.

- Never spend time `ping`/`curl`/`nslookup`/`traceroute`-ing, or
  otherwise re-diagnosing connectivity to those hosts. A local
  empty/missing-data state on a data-dependent page is expected here and
  is **not** evidence of a production regression.
- Use the **Supabase MCP tools** (`apply_migration`, `execute_sql`,
  `list_tables`, etc.) for real database inspection, verification, and
  migrations — this does reach the real project.
- Use `npm run build` / `npm run lint` locally for code verification.
- Leave final live-behavior verification (does the deployed page
  actually work) to the user against the real Vercel deployment — state
  clearly in the final report what they need to check.
- Don't re-explain or re-discover this constraint each session.

## 5. Supabase / database rules

- Production Supabase holds real data. Treat writes conservatively.
- Schema changes: additive whenever practical, applied via
  `mcp__Supabase__apply_migration` (not undocumented ad-hoc DDL),
  inspected against the current live schema first (`list_tables` /
  `execute_sql`), and never destructive without explicit approval.
  Preserve existing rows/relationships — never delete data to "clean up."
- Read the actual current rows before any production backfill or bulk
  update.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — has no `NEXT_PUBLIC_`
  prefix, must never be imported from a `"use client"` file. Admin writes
  go through `getAdminSupabase()` (`src/lib/admin/supabase-admin.ts`),
  used only in Server Actions / Server Components. Public reads go
  through the anon client (`src/lib/supabase.ts`), gated by RLS.
- Don't rebuild admin authentication (`src/middleware.ts` + `src/lib/
  admin/auth.ts` — a single shared `ADMIN_PASSWORD`, HMAC-signed session
  cookie via Web Crypto, no accounts/roles). It's settled.

## 6. Known core architecture — don't re-audit

These systems exist and work. Don't re-read/re-learn/re-explain them
wholesale unless the task directly touches them — inspect only the
specific files a task needs.

- Founder `/admin` + admin authentication (`src/app/admin/**`)
- Business / Event / Location / Appearance / Product CRUD (admin)
- Category homepage controls (`/admin/categories`, `show_on_home` /
  `home_sort_order`)
- Admin scalable search (`/admin/api/search`) + searchable relationship
  pickers (`src/components/admin/RelationPicker.tsx`,
  `useAdminSearch.ts`) — used instead of giant dropdowns/checklists
- Supabase Storage (business/product/event images)
- Public business profiles, product detail pages
- FindMi Here (`/find`, `getFindMiHereFeed`) — appearances-based,
  temporal (now/today/weekend/anytime)
- Appearance → Event routing; Event → participating businesses
  (`event_businesses`: `status`, `featured`, `offering_text`,
  `display_order`)
- Follow / Save (per-device localStorage, no accounts —
  `src/lib/saved.ts`, `src/lib/cart.ts` follow the same pattern)
- Homepage discovery composition (`src/app/(public)/page.tsx`)
- Multi-vendor cart + checkout foundation (`src/lib/commerce/**`,
  `src/app/(public)/cart/**`) — orders, order_items, vendor
  allocations, manual settlement ledger, refund accounting, per-item
  fulfillment (shipping/local_delivery/pickup/event_pickup), Stripe
  customer-facing checkout (`src/app/api/webhooks/stripe/route.ts`)

Don't rebuild any of the above merely because a new feature touches
nearby code.

## 7. Commerce business rules — locked

See `src/lib/commerce/fees.ts`, `ledger.ts`, `processingFee.ts`,
`quote.ts`, `settleOrder.ts` for the actual implementation.

- Default FindMi marketplace fee: **5%** of merchandise value, separate
  from payment-processing fees.
- Marketplace fee override precedence: campaign/promotion override
  (reserved for later — `applied_fee_source: "campaign_override"`
  exists as a type but nothing populates it yet) → product override
  (`marketplace_fee_override_percent`) → business/vendor override
  (`marketplace_fee_percent`) → platform default 5%.
- Every order item **snapshots** its applied fee %, fee $, processing
  payer, and vendor net at creation time. Never recompute historical
  orders from current settings.
- Default processing-fee responsibility: **vendor**. Override
  precedence: product (`processing_fee_payer_override`) → business
  (`processing_fee_payer`) → platform default (vendor). Customer-paid
  processing shows as a visible, separate checkout line — never folded
  silently into the item price.
- FindMi controls settlement. Vendor funds go into `vendor_order_
  allocations` with status **`held`** — never auto-paid. Admin records
  manual payouts (`/admin/settlements`) against one or more orders.
  **Do not** build or enable automatic vendor payouts without explicit
  new instruction.
- Vendors are responsible for fulfillment: shipping, local delivery,
  local pickup, event pickup — configured per product
  (`product_fulfillment_options`), and fulfillment can differ per item
  within the same multi-vendor cart/checkout.
- One customer checkout can span multiple vendors; the customer pays
  FindMi once, and internal seller allocations are computed server-side
  — never trust client-submitted prices/totals (see
  `lib/commerce/quote.ts` — always re-reads products/business settings
  fresh).
- `stripe_account_id` / `stripe_connect_status` columns exist on
  `businesses` for future Connect readiness only. **Do not** build
  Connect onboarding or enable automatic transfers just because those
  fields exist.

## 8. Admin UX principles

- Founder admin must scale past a handful of rows. Relationship
  selection uses searchable, server-backed pickers
  (`RelationPicker.tsx` / `/admin/api/search`, debounced, ≤20 results)
  — not giant `<select>` dropdowns or full-table checklists — once an
  entity count can plausibly grow past a screenful.
- List-page search/filtering is server-side (`ilike`/`eq` pushed into
  the Supabase query), never fetch-everything-then-filter-in-JS.
- Admin UI should stay usable at ~390px mobile width.
- Keep founder admin a lightweight internal tool — not an enterprise
  CMS. Resist adding generality nobody asked for.

## 9. Scope / token efficiency

- Start from the current committed state. Don't reread the whole
  repository for a targeted task.
- Don't inspect git history unless the task specifically needs
  historical context.
- Don't repeat a previous functionality/architecture audit — those
  findings already carried forward in this file are the audit.
- Inspect only: the target route/component, its direct dependencies,
  and the relevant schema/query code. Prefer targeted `Grep`/`Glob` and
  specific file reads over broad exploration.
- Before a large feature pass, briefly name the smallest set of
  files/systems actually required, then stick to that set.
- Don't refactor unrelated code, or "improve" a working system, just
  because you noticed it while doing something else.

## 10. UI change rule

- Before changing any styling, look at the existing relevant design
  tokens/classes first (`tailwind.config.ts`, `globals.css`, the
  component's current className) and reuse the established Aqua,
  typography, spacing, button, card, and navigation patterns.
- Never invent a new font, color, or design direction without explicit
  user instruction — see Section 2, which is the result of two prior
  rejected attempts.
- If the user supplies a reference screenshot, it's the visual
  authority for whatever it's illustrating — match it, don't
  paraphrase it into a generic interpretation.

## 11. Definition of done

A normal feature pass isn't complete until:

1. The requested functionality is implemented.
2. Any required database migrations are applied (via Supabase MCP) and
   verified additive/non-destructive.
3. Existing production data is preserved.
4. `npm run build` passes.
5. `npm run lint` passes.
6. Relevant responsive QA is done where UI changed (typically 360/390/
   412px; static/mocked content can be checked directly against the
   local build even when Supabase-backed pages can't be — see Section 4).
7. Changes are committed with a clear, scoped message.
8. Changes are pushed to the existing working branch (never a new one
   unless asked).
9. The final response states plainly what — if anything — the user
   still needs to verify live, rather than claiming full live
   verification the sandbox can't actually perform.

## 12. Final report format

Keep it concise. Normally include: starting commit, final commit, files
changed, schema/migration changes (if any), what was implemented,
build/lint results, push result, any new environment variables, any
manual configuration required, and a short live-verification checklist.
Don't produce another repository-wide audit unless asked.

## 13. Feature boundaries

Don't automatically start the next logical feature after finishing the
requested pass — implement, QA, commit, push, report, then **stop** and
wait for the user. Don't scope-creep into vendor dashboards, Stripe
Connect, analytics, messaging, reviews, advanced marketplace systems, or
a visual redesign unless specifically requested.

## 14. Current workflow priority

FindMi is approaching market-launch readiness. Prioritize work that
helps explain FindMi, populate it with real content, convert Founding
Members ($99/yr), or operate the marketplace reliably — over speculative
feature expansion. A feature that doesn't materially help launch, sell,
operate, or validate FindMi should generally wait for explicit direction.

## Reference: environment variables

See `.env.example` for the authoritative list. As of this writing:
Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`), admin (`ADMIN_PASSWORD`), Stripe Founding
Membership Payment Link (`NEXT_PUBLIC_STRIPE_FOUNDING_LINK`, separate
from marketplace checkout), Stripe marketplace checkout
(`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), Tally forms
(`NEXT_PUBLIC_TALLY_ONBOARDING_URL`, `NEXT_PUBLIC_TALLY_INQUIRY_URL`),
and `NEXT_PUBLIC_SITE_URL`.

## Reference: commands

- `npm run dev` — local dev server
- `npm run build` — production build (also runs type checking)
- `npm run lint` — ESLint
- `npm run start` — run a production build locally
