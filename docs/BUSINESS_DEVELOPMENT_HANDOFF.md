# Findmi Business Development / Project Operations — Handoff

Status: **architecture approved in principle; nothing implemented.**
Written 2026-10-10 as a standalone handoff. A new Claude session should be able
to continue from this file plus `CLAUDE.md`, without the prior conversation.

---

## 1. Repository, branch, HEAD, worktree

| Item | Value |
|---|---|
| Repo | `findmiapp/Findmi` |
| Working branch | `claude/findmi-mvp-marketplace-3tvcik` (the only branch to push to) |
| HEAD at handoff | `7a75c537456522bc64803ec559a213e09519b7da` |
| Upstream | `origin/claude/findmi-mvp-marketplace-3tvcik`, in sync at handoff |
| Worktree | Clean except this new, uncommitted file |
| Do **not** push | Harness branch `ccr-2421e92c-pk358v` (session artifact, never used) |

Recent commit chain on the working branch (oldest → newest):

- `5a51a3b` — base for this work stream
- `5a57cfb` — Commercial Terms builder UX pass + failed-save state preservation
- `257c1df` — classification fix (required Business contributions only) + temporary single-package safeguard
- `7a75c53` — Business-facing "The Deal" presentation

Test suite at `7a75c53`: **591 passing** (`node --test --experimental-strip-types tests/`).

---

## 2. What has been implemented and deployed

All of this is **Opportunities** work. **No Business Development code exists yet.**

### 2.1 Database (production Supabase)
- Commercial Terms foundation migrations `20261009…` 090 / 100 / 110 — executed by the
  user in the Supabase SQL Editor (MCP `apply_migration` kept cancelling/timing out),
  then verified read-only.
- `supabase/migrations/20261012000000_commercial_terms_brand_contribution_classification.sql`
  — `CREATE OR REPLACE` of `public.check_option_component_commercial_mode()` and
  `public.check_option_mode_change_allowed()` using
  `coalesce(in_kind_provider,'recipient_business')`. Applied via `execute_sql` after
  explicit approval. Post-change function fingerprints (md5 of `prosrc`):
  `fcccd50ed9453aa53e1017ef6d0014a4` and `6be38b6be283c6fc7db363cce5b5a539`.
  Both: owner `postgres`, `SECURITY DEFINER` false, `search_path=""`, default ACLs.

### 2.2 Application code (pushed to the working branch)
- **Builder** — `src/lib/opportunity-commercial-terms-builder.ts` (pure state module),
  `src/app/admin/(protected)/opportunities/CommercialTermsBuilder.tsx` (progressive
  disclosure, `forwardRef` + `validateForSubmit`), `OpportunityForm.tsx`
  (`useActionState` dispatched from `onSubmit` with `preventDefault` so React 19 does
  not reset the form on a failed save), `actions.ts` (`createOpportunity` /
  `saveOpportunity` return `{ error }`), `src/components/admin/SubmitBar.tsx` (`pending`).
- **Classification** — `src/lib/opportunity-commercial-terms-domain.ts`:
  `isRequiredBrandContribution`; only money rows (`participation_fee`,
  `compensation`, `project_budget`) or In-Kind items **required from the recipient
  Business** (missing provider = Business) make an Option Structured.
- **Single-package policy** — `src/lib/opportunity-package-policy.ts`:
  `PACKAGES_ENABLED = false`, `PACKAGE_RESPONSES_ENABLED = false`, `packageEditError`,
  `requiresPackageChoice`, `choosePackageMailto` (fallback `hello@findmi.app`).
  Server-enforced on save and on both response paths through the fail-closed
  `countOpportunityPackages` in `src/lib/opportunity-listings.ts`.
- **Business "The Deal"** — `src/lib/opportunity-business-deal.ts` (replaces deleted
  `opportunity-business-commercial-terms.ts`), `OpportunityDeal` /
  `OpportunityResponseSection` in `src/components/opportunities/OpportunityPresentation.tsx`;
  Business pages `account/business/[id]/opportunities/[recipientId]/page.tsx` and
  `explore/[listingId]/page.tsx` ordered: intro → The Deal → Interested? → details.
  "Not for Us" action label (badge stays "Not Interested"); Explore has no "Not for Us".

### 2.3 Deployment status
Not verifiable from the sandbox: no PR exists for the working branch and Vercel is
unreachable (expected — see `CLAUDE.md` §4). The user must confirm the Vercel
deployment of `7a75c53`.

---

## 3. Current Business Opportunities architecture

- Tables (all `public`): `opportunity_listings`, `opportunity_options` (UI: "Package"),
  `opportunity_option_components`, `opportunity_recipients` (plus goal tables under
  `/admin/opportunities/goals`).
- Hierarchy: Listing → Option → Component. `commercial_mode` ∈ `structured` |
  `complimentary` | `custom`. Two trigger functions enforce mode/component consistency.
- Security: RLS on, **no policies, no anon/authenticated grants**; service role only via
  `getAdminSupabase()`, gated by `requireAdmin()` in the Admin layer and by
  owner checks in Business-account server code.
- `updated_at` triggers on listings, options, recipients.
- Production recipient state at last check: 2 Interested, 1 Offered, no response notes.
- Listing "Test" (`9a525163…`, `fd0c6916…`, `d1128176…` are its 3 packages) is the only
  multi-package listing; it and its Interested response are intentionally untouched.
  Multi-package gate stays until package-specific responses are built.
- **Frozen, not approved:** Phase 3/4 Opportunity infrastructure (stale-write guard
  function, response-event table). Do not build.

Opportunities may later *link* to a BD Project but are never its financial parent.

---

## 4. Existing Activations architecture

- Migrations `20260929000100`–`20260929000500` (Activations + column grants);
  library `src/lib/admin/activations.ts`; Admin pages under `admin/(protected)/activations/*`.
- Activations are the **execution / offer layer** (what happens on the ground, public
  offer surface). Published Activations are publicly readable, but **column grants
  exclude the internal financial fields** (correction to an earlier audit claim).
- Activation targets are operational goals, **not** project financial truth.
- QR campaigns: `20260930000100_qr_campaigns_v2_foundation.sql`, redirect route
  `src/app/q/[code]/route.ts`, analytics in `src/lib/analytics/*`.

BD will link to Activations (via `bd_links`), never duplicate or replace them.

---

## 5. Verified production database findings (read-only)

### Security
1. **`businesses.membership_status` is publicly readable** (52 rows = `lead`). It is in
   the public column list in `src/lib/data.ts` (~line 55) but no public UI renders it.
2. **`businesses` SELECT policies are OR'd and one is `using (true)`**, so draft and
   trashed businesses are readable via the anon API, regardless of the app's live filters
   (`data.ts` ~lines 414 and 586 filter in the app only).
3. `people` and `business_people` are publicly readable.
4. Most `public` tables carry Supabase default full grants to `anon`/`authenticated`.
   **Any new table must explicitly revoke them** (or live in a non-exposed schema).
5. Prospects must **never** be created as `businesses` rows (they would leak and
   pollute discovery). Prospects live only in BD tables.

### Measurement
- Measurable now: QR scans and unique sessions per campaign; actions taken in
  QR-acquired sessions (`acquisition_qr_campaign_id`).
- **Not** attributed: orders and sales inquiries have no QR/session attribution.
- Attendance, samples distributed, etc. must be entered manually.

---

## 6. Migration-history discrepancies and deployment precautions

- `supabase_migrations.schema_migrations` is **not reconciled** for 080 through
  `20261012000000`: 090–110 were run in the SQL Editor; `20261012000000` was run via
  `execute_sql`; none are recorded by `apply_migration`. Do **not** "repair" history
  without explicit instruction. Never run `supabase db push`.
- Also leave alone: `20261007000000`/`…070100` and `media_variants_registry` (out of scope).
- MCP `apply_migration` approval has been unreliable (cancelled twice, timed out once).
- Required procedure for any future production DDL:
  1. Inspect live schema first (`list_tables` / `execute_sql` read-only).
  2. Fingerprint affected objects (definitions, grants, policies) **before**.
  3. Present the **exact SQL** to the user and get explicit approval.
  4. Apply once; on cancel/timeout, stop and verify read-only before retrying.
  5. Fingerprint **after** and report the diff.
- Production schema is currently **frozen** by user instruction.

---

## 7. Approved vision — Findmi Business Development / Project Operations

Findmi can originate, sell, operate and manage whole commercial projects: secure
clients, procure venues/staff/vendors, manage a client-approved budget, pay project
expenses, run activations, report results, and keep the margin.

Two economic models, both first-class, neither forced into the other:

- **Findmi-operated** — the whole contract is Findmi revenue; Findmi pays costs and
  keeps gross profit. Example: $15,000 revenue − $7,000 costs = $8,000 gross profit.
- **Fee / commission** — fixed, management, sourcing, referral, percentage, retainer,
  or custom.

Rules:
- Compensation only ever comes from an **actual agreement**, never from discovery alone.
- Internal Admin tool only. **Public site unchanged**: homepage, discovery, navigation,
  branding, subscription plans, existing Opportunities workflows.
- Lightweight founder tool, not an enterprise CRM/ERP (`CLAUDE.md` §8).

---

## 8. Architecture proposal (with all later corrections applied)

All tables below live in a private `bd` schema if feasible (§9), otherwise in `public`
with the locked-down pattern (RLS on, no policies, all anon/authenticated grants
revoked, service role only, `requireAdmin()`). Table names below use the `bd_` prefix
for clarity; in a `bd` schema they would drop it (`bd.projects`).

### Organizations & contacts
- `bd_organizations` — name, kind, **nullable unique `business_id`** (links to a live
  Findmi Business when one exists; prospects never become `businesses`), notes.
- `bd_contacts` — person at an organization; name, role, email, phone, notes.

### Projects (one lifecycle object)
`bd_projects` — called "Deal" before Won and "Project" after; **same row** throughout.
- Pipeline: `stage` ∈ lead, qualified, proposal, negotiation, won, delivering,
  completed, lost, on_hold; `estimated_value`, `expected_close_date`, `lost_reason`
  (+ note), `next_action`, `next_action_due`, `owner_label` (free text — no identities).
- Revenue/budget: `proposed_amount`, `contracted_amount`, `client_approved_budget`.
- Economics: `economics_model` ∈ `operated` | `fee`; `fee_type`, `fee_amount`,
  `fee_percent`, `fee_basis`, `payment_trigger`.
- **Client is nullable at creation** (a project can start from a venue or idea).

### Parties & procurement (Phase 1)
`bd_project_parties` — organization ↔ project with role ∈ client, payer, brand,
sponsor, venue, vendor, partner (multiple per project allowed); `need_label` for
unfilled slots ("DJ", "Venue — 200 cap"); `procurement_status` ∈ needed, sourcing,
contacted, proposed, secured, not_needed.

### Money — four separate concepts
- `bd_revenue_lines` — **billing**: amounts invoiced and collected from payers.
- `bd_client_allocations` — **client-visible budget** at client price; status ∈
  planned, committed, delivered, cancelled.
- `bd_cost_lines` — **internal costs**: estimated, committed, actual; status ∈ planned,
  committed, paid, cancelled; category ∈ venue, staffing, production, logistics,
  product, media, materials, permits_insurance, other; optional party link or
  `payee_name` for unlinked payees.
- Cash = collected revenue vs paid costs (derived).

### History, links, results
- `bd_activities` — outreach log, notes, follow-ups.
- `bd_links` — polymorphic links to Activations, Opportunities, Events, occurrences,
  Appearances, Locations, QR campaigns, conversations, sales inquiries, goals.
- `bd_metric_entries` — manual metrics with `client_visible`.
- `bd_insights` — kind ∈ driver, blocker, observation, recommendation, experiment;
  evidence, period, links, status, budget effect; `client_visible` default **false**.

### Formulas
- Forecast cost per line = `actual ?? committed ?? estimated`.
- Projected gross profit = contracted − Σ forecast cost.
- Actual gross profit = contracted − Σ actual cost (recognition definition still open).
- Delivered gross profit = Σ delivered allocations − Σ actual cost on those allocations.
- Remaining client budget = approved − Σ client-committed allocations.
- ROAS/ROI shown **only** when an attributed source exists; otherwise not shown.

### Boundaries
- Client view is built **only** from allocations, revenue lines, and `client_visible`
  metrics/insights. Internal costs and margin are never client-visible. Separation is
  **by record type, not by a flag** on cost rows.
- Activations remain execution; Opportunities link optionally; Programs deferred
  (roll up by client organization for now).

---

## 9. Final decisions

1. **Private `bd` schema**, subject to feasibility verification (supabase-js
   `.schema('bd')` works with the service-role client without exposing `bd` to the
   Data API / PostgREST exposed schemas; if not feasible, fall back to locked-down
   `public.bd_*` tables).
2. **Security remediation first** (Phase 0) before any BD table exists.
3. **Parties included in Phase 1.**
4. **One Project lifecycle object** (Deal → Project, same row).
5. **No required client** at project creation.
6. **Both** Findmi-operated and fee/commission economics.
7. **Separate** budget (allocations), delivery (allocation status), billing (revenue
   lines), cash (collections/payments), and internal costs (cost lines).
8. **Private client reporting boundary** — by record type; internal costs/margin never
   exposed.

---

## 10. Remaining architecture decisions (open)

1. Is the private `bd` schema feasible (see §9.1)? Verify without changing config
   unless approved.
2. Exact replacement `businesses` SELECT policy, and whether an owner/member exception
   is needed (and how it is tested).
3. Owner identity in BD given the single shared admin password (`owner_label` free text
   is the current plan).
4. Revenue-recognition definition for "actual gross profit" (contracted vs invoiced vs
   collected vs delivered).
5. Whether metrics start in Phase 4 or Phase 5.
6. Whether client allocations are required for fee-model projects.

---

## 11. Phase sequence

- **Phase 0 — Security remediation + feasibility**
  1. Remove `membership_status` from the public column list in `src/lib/data.ts`
     **first** (deploy), **then** revoke its anon/authenticated column grant.
  2. Replace the OR'd `businesses` SELECT policies with
     `publication_status = 'live' and archived_at is null and trashed_at is null`
     (+ member exception only if needed), verifying every public read path first.
  3. Verify `bd` schema feasibility (§9.1).
- **Phase 1 — Foundation**: organizations, contacts, projects, parties, activities;
  Admin "Business Development" section (Pipeline, Accounts, Project detail);
  security tests (no client grants, no policies, service-role only).
- **Phase 2 — Economics**: revenue lines, cost lines, allocations, fee terms,
  calculated panels.
- **Phase 3 — Procurement panel + links** (`bd_links`).
- **Phase 4 — Delivery** + automatically measurable ("class B") metrics (QR).
- **Phase 5 — Manual metrics + insights.**
- **Phase 6 — Internal client-report preview** (not client-facing access).

Each phase: present exact SQL for approval, build/lint/test, commit and push only
with approval, then stop (`CLAUDE.md` §13).

---

## 12. Files and database objects to inspect next

Files:
- `src/lib/admin/auth.ts`, `src/middleware.ts` (admin gate; don't rebuild)
- `src/lib/admin/supabase-admin.ts` (`getAdminSupabase`; check `.schema()` support)
- `src/lib/data.ts` (public business column list ~55; live filters ~414, ~586)
- `src/app/admin/(protected)/businesses/[id]/page.tsx`, `businesses/actions.ts`
  (lead / membership status fields)
- `src/lib/admin/activations.ts`, `src/app/admin/(protected)/activations/*`
- `src/app/admin/(protected)/sales-inquiries/*`, `src/app/(public)/join/sales/actions.ts`
- `src/lib/admin/conversations.ts` (read-only)
- `src/lib/analytics/{taxonomy,qrCampaignDetail,ownerPerformance,serverTrack,session}.ts`,
  `src/app/q/[code]/route.ts`
- `src/lib/commerce/{fees,ledger,settleOrder,referrals}.ts` (patterns only; don't change)
- `src/app/admin/(protected)/opportunities/goals/*`
- Admin nav/layout under `src/app/admin/(protected)/` (where a BD section would mount)

Migrations:
- `20260929000100`–`20260929000500` (Activations + column grants)
- `20260930000100_qr_campaigns_v2_foundation.sql`
- `20260831192751_restrict_internal_commerce_columns.sql` (column-grant pattern)
- `20261009000000_opportunity_commercial_terms_foundation.sql` (locked-down table pattern)

Database objects (read-only):
- `pg_policies` for `public.businesses`, `public.people`, `public.business_people`
- `information_schema.column_privileges` for `businesses.membership_status`
- `information_schema.role_table_grants` for anon/authenticated on public tables
- PostgREST exposed-schema setting (for `bd` feasibility)
- `supabase_migrations.schema_migrations` (read only; do not repair)

---

## 13. Explicitly prohibited (until the user says otherwise)

- Any Supabase write, SQL execution, migration creation/application, migration-history
  repair, or policy/grant change without exact SQL + explicit approval. Production
  schema is frozen.
- Changes to: Admin Opportunity composer, Opportunity response persistence, Phase 3/4
  Opportunity infrastructure, the multi-package gate, the "Test" listing or its
  responses, Event workflows, public site, homepage, discovery, navigation, branding,
  subscription plans.
- Creating prospects as `businesses` rows.
- Building Stripe Connect, automatic payouts, vendor dashboards, client logins, or
  client-facing report access.
- Pushing to `ccr-2421e92c-pk358v`; deploying; committing or pushing without approval.
- `supabase db push`, Supabase CLI against production.

---

## 14. Immediate next task

**Phase 0, read-only preflight** (no writes):
1. Read live `businesses` policies, `membership_status` column grants, and every
   public code path that selects from `businesses` (anon client).
2. Determine `bd` schema feasibility (service-role `.schema('bd')` without exposing it).
3. Present to the user: (a) the `data.ts` change, (b) the exact grant-revoke SQL,
   (c) the exact replacement policy SQL, (d) the feasibility verdict, (e) before/after
   fingerprint plan. Then **stop and wait for approval.**
