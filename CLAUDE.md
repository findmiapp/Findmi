# Findmi — Agent Operating Manual

Read automatically at the start of every Claude Code session. Keep it
short: detailed knowledge lives in `/docs`. Everything marked *locked* is
settled. Don't re-litigate it unless the user raises it.

## 1. What Findmi is

A real-world discovery platform. It connects consumers with Businesses and
Brands, Products, Locations, Events (with Occurrences), Appearances,
Availability and Moments. Around those entities it adds a Business Manager
for owners, a marketplace, and a founder Admin. The entity graph and its
relationships matter more than any one screen. Findmi isn't Yelp, a
directory, an event calendar, a QR generator or a generic SaaS dashboard.
Details: `docs/PRODUCT.md`.

## 2. Authority hierarchy

When sources disagree:

1. Production schema + current code: what's actually implemented.
2. Current tests (`tests/*.test.mjs`): executable expectations. Many are
   source-inspection tests that encode approved copy and composition.
3. `/docs/*.md`: intended product and architectural meaning.
4. `docs/BACKLOG.md`: requested future work, not current functionality.
5. Commit messages, history, conversation: evidence and rationale only.

A request in a doc or a conversation isn't evidence the feature exists. A
feature you can't see in the UI isn't evidence its infrastructure is
missing. Commit bodies in this repo are detailed and are the best "why"
source.

## 3. Session start (before material changes)

1. Read this file and the relevant `/docs` files.
2. Check branch/HEAD and uncommitted changes.
3. **Find the existing implementation before designing anything.** Search
   `src/lib`, `src/components`, the route tree and `supabase/migrations`.
   Most concepts already exist: occurrences, importers, provenance,
   Availability, QR, analytics, Moments, Collections, the manager shell and
   host routing.
4. Decide which kind of work it is: modifying, completing, or genuinely new.
5. Report meaningful doc ↔ code discrepancies before making
   architecture-altering assumptions.

Scope discipline: inspect only the target route/component, its direct
dependencies and the relevant schema. Don't refactor unrelated code. Don't
start the next logical feature: implement, QA, commit, push, report, stop.

## 4. Non-negotiables

- **Find it, understand it, then modify it intentionally.** Never build a
  second version of something Findmi already has.
- Don't duplicate entities a relationship already models. Use Appearances
  (Business ↔ Event/Occurrence/Location), Availability (Business/Product ↔
  Location) and Occurrences (dates of one Event).
- Don't rename established terminology casually (`docs/PRODUCT.md` §
  Terminology). Don't rename internal identifiers just for cosmetics.
- Never fabricate data, integration state or implementation status.
- Update the canonical `/docs` in the same commit when product or
  architectural truth changes. Ask yourself: does this change make any
  statement in `/docs` false? Docs change when the truth changes, not on
  every code change. `DECISIONS.md` isn't a changelog. `BACKLOG.md` holds
  unresolved work only (dedupe it, remove verified-done items).

## 5. Brand / design system — locked

- Brand name in user-facing copy: **"Findmi"**. Never "FindMi", "FindMI" or
  "FINDMI". Old code comments saying "FindMi" are historical prose.
- Findmi Aqua **`#14B0BC`** (Tailwind `findmi`, 50–900 scale in
  `tailwind.config.ts`), used sparingly, never as a flood background.
  Aqua-filled buttons/badges use white text and icons. Pale tints
  (`bg-findmi-50`) keep `text-findmi-700`. Don't "fix" those.
- **Never** reintroduce `#C6FF00` / lime / acid-green or purple SaaS
  styling.
- Typeface: **Inter** for body and display (`next/font/google` in
  `src/app/layout.tsx`). No Space Grotesk, Plus Jakarta Sans or other
  display fonts without explicit approval. `globals.css` softens
  `tracking-tight` on `.font-display` (`-0.006em`). Keep it.
- Visible section titles use **Title Case**, written as display copy,
  never CSS `capitalize` on dynamic content.
- User-supplied reference screenshots are the visual authority for
  whatever they illustrate.
- Reuse existing tokens/classes before styling anything. More in
  `docs/DESIGN-SYSTEM.md`.

## 6. Environment constraints — do not re-diagnose

- This sandbox **can't** reach production Supabase or Vercel over HTTP.
  That's expected. Don't ping/curl/nslookup them. An empty local data
  state isn't a production regression.
- Use the **Supabase MCP tools** (project `findmi`,
  `drcbrzwchlirfspjgtik`) for real schema/data inspection and migrations.
- Verify code with `npm run build`, `npm run lint` and `npm test`. Leave
  live verification to the user and say exactly what to check.

## 7. Supabase / database rules

- Production holds real data. Read rows before any backfill. Never delete
  data to "clean up".
- Schema changes: additive when practical, inspected against the live
  schema first, applied with `mcp__Supabase__apply_migration`, and backed
  by a matching file in `supabase/migrations/`. Nothing destructive without
  explicit approval.
- **The production migration ledger is incomplete.** About 33 repo
  migrations have live schema but no ledger row. To check whether a
  migration is applied, look for the object itself, not
  `schema_migrations`. See `docs/DEPLOYMENT.md`.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Admin writes go through
  `getAdminSupabase()` (`src/lib/admin/supabase-admin.ts`) in Server
  Actions/Components only. Public reads use the anon client
  (`src/lib/supabase.ts`) under RLS. Signed-in reads use `@supabase/ssr`
  (`src/lib/supabase/*`).
- Two separate auth boundaries share `src/middleware.ts` and never share a
  cookie: founder `/admin` (one `ADMIN_PASSWORD`, HMAC cookie,
  `src/lib/admin/auth.ts`, settled, don't rebuild) and consumer/owner
  Supabase Auth (`/account/**`, `/my-world/journal/**`).

## 8. Commerce rules — locked

Implementation: `src/lib/commerce/` (`fees.ts`, `ledger.ts`,
`processingFee.ts`, `quote.ts`, `settleOrder.ts`).

- Marketplace fee defaults to **5%** of merchandise value, separate from
  processing. Precedence: campaign override (reserved, unpopulated) →
  product `marketplace_fee_override_percent` → business
  `marketplace_fee_percent` → 5%.
- Order items **snapshot** fee %, fee $, processing payer and vendor net.
  Never recompute history.
- The vendor pays processing by default (product → business → vendor).
  Customer-paid processing is a visible, separate checkout line.
- Vendor funds land in `vendor_order_allocations` as **`held`**. Payouts
  are recorded manually (`/admin/settlements`). **No automatic payouts and
  no Stripe Connect onboarding** without new explicit instruction, even
  though `stripe_account_id` / `stripe_connect_status` exist.
- Vendors own fulfillment per item (shipping / local delivery / pickup /
  event pickup). Totals are always re-quoted server-side. Never trust
  client prices.

## 9. Admin UX principles

Founder Admin is a lightweight internal tool. Relationship selection uses
the server-backed `RelationPicker` / `/admin/api/search` (debounced, ≤20
results), never giant selects. List filtering happens server-side. Admin
should stay usable at about 390px.

## 10. Definition of done

1. Functionality implemented, reusing existing infrastructure.
2. Required migrations applied through MCP, verified additive, and a repo
   file added.
3. Production data preserved.
4. `npm run build` and `npm run lint` pass. Run `npm test` and name
   pre-existing failures separately (see `docs/BACKLOG.md`).
5. Responsive QA at 360/390/412px where UI changed.
6. Canonical `/docs` updated if product/architecture truth changed.
7. Committed with a clear, scoped message and pushed to the existing
   working branch (never a new branch unless asked).
8. The final report states plainly what still needs live verification.

## 11. Final report format

Concise: starting/final commit, files changed, schema changes, what was
implemented, build/lint/test results, push result, new env vars, manual
config, and a short live-verification checklist. No repo-wide audits
unless asked.

## 12. Priorities

Findmi is approaching launch. Favor work that explains Findmi, populates
it with real content, converts paying Businesses (Pro / Managed Pro), or
runs the marketplace reliably. Don't scope-creep into Stripe Connect,
automated payouts, native apps or a visual redesign unless asked.

## 13. Documentation map (`/docs`)

| File | Contents |
| --- | --- |
| `PRODUCT.md` | Thesis, users, entities, **terminology dictionary**, monetization |
| `ARCHITECTURE.md` | Stack, app surfaces, auth boundaries, host routing, shared infrastructure |
| `DATA-MODEL.md` | Entity ontology mapped to real tables |
| `DESIGN-SYSTEM.md` | Visual/interaction conventions and rejected patterns |
| `ROUTES-AND-IA.md` | Route tree and information architecture |
| `BUSINESS-MANAGER.md` | Owner manager: shell, nav, destinations, infrastructure |
| `CONSUMER-EXPERIENCE.md` | Home, discovery, Moments, Library, profiles |
| `ANALYTICS.md` | Event taxonomy, Performance, QR measurement |
| `INTEGRATIONS.md` | Supabase, Vercel, Stripe, Tally, Anthropic, Resend, geocoding, importers |
| `DEPLOYMENT.md` | Reconciliation, verification, migrations, production procedure |
| `DECISIONS.md` | Durable decisions + rationale (not a changelog) |
| `BACKLOG.md` | Unresolved work only |
| `RECONCILIATION-2026-10-29.md` | Audit record behind these docs (point-in-time) |
| `BUSINESS_DEVELOPMENT_HANDOFF.md` | BD CRM handoff (pre-existing) |

## Reference: commands

`npm run dev` · `npm run build` (includes type-check) · `npm run lint` ·
`npm test` · `npm run start`. The full env var list is in `.env.example`
(the authoritative source).
