import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminBusinessById, getAdminProducts, getAllCategories } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/format";
import {
  billingStatusLabel,
  getMembershipForBusiness,
  onboardingStatusLabel,
  publicationStatusLabel,
} from "@/lib/admin/membership-queries";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import AdminTabNav, { type TabNavItem } from "@/components/admin/TabNav";
import SubmitBar from "@/components/admin/SubmitBar";
import {
  CheckboxField,
  CheckboxList,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import GalleryField from "@/components/admin/GalleryField";
import NameSlugFields from "@/components/admin/NameSlugFields";
import BusinessPeopleRoster from "@/components/admin/BusinessPeopleRoster";
import { getCurrentAccessByEntity } from "@/lib/admin/claim-queries";
import {
  assignBusinessMember,
  removeBusinessMember,
  saveBusinessCategories,
  saveBusinessGallery,
  saveBusinessInternal,
  saveBusinessModeration,
  saveBusinessPlan,
  saveBusinessProfile,
} from "../actions";
import { isBusinessPro, isBusinessProSeller } from "@/lib/entitlements";
import type { PublicationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Business Category Onboarding Filter pass — see BusinessForm.tsx's own
// identical note; kept here too since the Categories tab now renders its
// own CheckboxList directly rather than through that shared component.
const LEGACY_BUSINESS_CATEGORY_SLUGS = new Set(["markets-pop-ups", "packaged-goods"]);

// Native Moderation Consolidation pass — see BusinessForm.tsx's own
// identical note.
const LISTING_STATUS_OPTIONS: { value: PublicationStatus; label: string }[] = [
  { value: "pending_review", label: "Pending Review" },
  { value: "live", label: "Published / Live" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
  { value: "rejected", label: "Rejected" },
];

// Tabbed Business Edit pass — this page used to render one giant
// BusinessForm (Status -> Business Basics -> Branding -> Gallery ->
// About -> Location -> Contact & Links -> Announcement -> Other
// Settings) in a single scroll, saved as one all-or-nothing submit.
// BusinessForm/saveBusiness are UNCHANGED and still exactly what
// /admin/businesses/new uses (creating a business is a genuine one-shot
// flow) — this page now builds its own smaller, per-tab forms instead,
// each posting to its own split action (saveBusinessProfile/Gallery/
// Categories/Plan/Moderation/Internal in ../actions.ts) so saving one
// section never resubmits or overwrites another. Every field, admin
// Fields.tsx primitive, and validation rule is reused as-is — nothing
// here duplicates a field across tabs.
const ADMIN_TABS: TabNavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "profile", label: "Profile" },
  { key: "gallery", label: "Gallery" },
  { key: "products", label: "Products" },
  { key: "appearances", label: "Appearances" },
  { key: "categories", label: "Categories" },
  { key: "ownership", label: "Ownership" },
  { key: "plan", label: "Plan" },
  { key: "moderation", label: "Moderation" },
  { key: "internal", label: "Internal" },
];
const ADMIN_TAB_KEYS = new Set(ADMIN_TABS.map((t) => t.key));

export default async function EditBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; error?: string; saved?: string; member_updated?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, error, saved, member_updated } = await searchParams;
  const tab = tabParam && ADMIN_TAB_KEYS.has(tabParam) ? tabParam : "overview";

  const [result, categories, membership, accessByEntity, products] = await Promise.all([
    getAdminBusinessById(id),
    getAllCategories("business"),
    getMembershipForBusiness(id),
    // Owner/manager/staff access — a DIFFERENT thing from the Founding
    // Membership billing block below (same "Membership" word, unrelated
    // systems). Same id -> email lookup pattern the claims page's Current
    // Access section already uses (fetchEmailsByUserId under the hood).
    getCurrentAccessByEntity("business", [id]),
    // Product Management Completion pass — reuses the existing
    // getAdminProducts(businessId) filter as-is (already used by the
    // products list's own Business picker); no new query.
    getAdminProducts({ businessId: id }),
  ]);
  if (!result) notFound();
  const { business } = result;
  const publicHref = !business.is_demo && business.publication_status === "live" ? `/business/${business.slug}` : null;
  const members = accessByEntity.get(id) ?? [];
  const assignMember = assignBusinessMember.bind(null, id);
  const pro = isBusinessPro(business);
  // pro_seller is future-only (Native Business Onboarding, Pass 1 — no
  // seller checkout/commerce built yet) but still gets its own distinct
  // label here rather than reading identically to "Pro", so a founder
  // looking at this summary can actually tell the two apart.
  const proSeller = isBusinessProSeller(business);
  // Derived, not stored — "Claimed" simply means an owner row already
  // exists in business_members for this business. No new claim logic or
  // schema: same source of truth requireBusinessMember()/the claims page
  // already treat as the real ownership signal.
  const claimed = members.some((m) => m.role === "owner");

  const selectableCategories = categories.filter(
    (c) => !LEGACY_BUSINESS_CATEGORY_SLUGS.has(c.slug) || result.categoryIds.includes(c.id)
  );

  const basePath = `/admin/businesses/${id}`;
  const profileAction = saveBusinessProfile.bind(null, id);
  const galleryAction = saveBusinessGallery.bind(null, id);
  const categoriesAction = saveBusinessCategories.bind(null, id);
  const planAction = saveBusinessPlan.bind(null, id);
  const moderationAction = saveBusinessModeration.bind(null, id);
  const internalAction = saveBusinessInternal.bind(null, id);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Business</h1>
        <ViewPublicPageLink href={publicHref} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            pro ? "bg-findmi text-white" : "bg-black/[0.06] text-ink/60"
          }`}
        >
          {proSeller ? "Pro Seller" : pro ? "Pro" : "Free"} Plan
        </span>
        <span
          className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            claimed ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/50"
          }`}
        >
          {claimed ? "Claimed" : "Unclaimed"}
        </span>
      </div>

      <div className="mt-4">
        <AdminTabNav items={ADMIN_TABS} activeKey={tab} basePath={basePath} />
      </div>

      <div className="mt-4">
        {error && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
        {(saved || member_updated) && !error && (
          <p className="mb-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
            Saved.
          </p>
        )}

        {/* ── Overview ─────────────────────────────────────────────── */}
        {tab === "overview" && (
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="text-sm font-semibold text-ink">{business.name}</p>
            <p className="mt-1 text-xs text-ink/45">
              Plan is editable in the Plan tab. Claimed/Unclaimed is derived — it just means an owner already
              exists in Ownership, not a separate stored status.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ADMIN_TABS.filter((t) => t.key !== "overview").map((t) => (
                <Link
                  key={t.key}
                  href={`${basePath}?tab=${t.key}`}
                  className="rounded-xl border border-black/10 px-3.5 py-3 text-sm font-semibold text-ink transition hover:border-black/20"
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Profile ──────────────────────────────────────────────── */}
        {tab === "profile" && (
          <form action={profileAction} className="flex flex-col gap-5">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Business Basics</p>
            <NameSlugFields
              isNew={false}
              nameLabel="Business Name"
              defaultName={business.name}
              defaultSlug={business.slug}
              slugHint="Used in the public URL: /business/your-slug"
            />
            <TextField
              label="Short Description"
              name="short_description"
              defaultValue={business.short_description}
              hint="One line — shown on cards and search results."
            />

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Branding</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField label="Logo Image" name="logo_url" defaultValue={business.logo_url} />
              <ImageField label="Cover Photo" name="cover_image_url" defaultValue={business.cover_image_url} />
            </div>

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">About</p>
            <TextareaField label="Full Description" name="description" defaultValue={business.description} rows={5} />

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Location</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="City" name="city" defaultValue={business.city} />
              <TextField label="State" name="state" defaultValue={business.state} />
              <TextField label="Country" name="country" defaultValue={business.country ?? "US"} />
            </div>
            <TextField
              label="Service Radius (miles)"
              name="service_radius_miles"
              defaultValue={business.service_radius_miles ?? undefined}
              hint="Leave blank if not a mobile/service-area business."
            />

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Contact &amp; Links</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Email" name="email" type="email" defaultValue={business.email} />
              <TextField label="Phone" name="phone" type="tel" defaultValue={business.phone} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Website" name="website_url" type="url" defaultValue={business.website_url} placeholder="https://…" />
              <TextField
                label="Instagram"
                name="instagram_url"
                type="url"
                defaultValue={business.instagram_url}
                placeholder="https://instagram.com/…"
              />
              <TextField
                label="Facebook"
                name="facebook_url"
                type="url"
                defaultValue={business.facebook_url}
                placeholder="https://facebook.com/…"
              />
              <TextField
                label="TikTok"
                name="tiktok_url"
                type="url"
                defaultValue={business.tiktok_url}
                placeholder="https://tiktok.com/@…"
              />
            </div>

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Announcement</p>
            <div className="rounded-2xl border border-black/10 p-4">
              <p className="mb-3 text-xs text-ink/45">
                A small, timely notice shown near the top of your profile — a flash sale, a booking update,
                &ldquo;Sold out this weekend,&rdquo; anything current. Renders nothing publicly unless Show
                announcement is on and Message has real content.
              </p>
              <div className="flex flex-col gap-4">
                <CheckboxField label="Show announcement" name="bulletin_enabled" defaultChecked={business.bulletin_enabled} />
                <TextField
                  label="Label"
                  name="bulletin_label"
                  defaultValue={business.bulletin_label}
                  placeholder="Announcement"
                  hint={'Shown above the heading — e.g. "Flash Sale," "Now Booking," "Update." Defaults to "Announcement" when blank.'}
                />
                <TextField label="Heading" name="bulletin_heading" defaultValue={business.bulletin_heading} placeholder="Sold out this weekend" />
                <TextareaField
                  label="Message"
                  name="bulletin_body"
                  defaultValue={business.bulletin_body}
                  rows={3}
                  hint="e.g. We'll be back at the market next Saturday."
                />
                <TextField
                  label="Link (optional)"
                  name="bulletin_url"
                  defaultValue={business.bulletin_url}
                  placeholder="https://… or /a-findmi-page"
                  hint="Makes the whole announcement clickable. Leave blank for a static notice."
                />
              </div>
            </div>

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Inquire Button</p>
            <div className="rounded-2xl border border-black/10 p-4">
              <p className="mb-3 text-xs text-ink/45">
                Optional — point the profile&rsquo;s primary Inquire button at any external URL with custom text,
                no Tally form required. Leave blank to keep the existing Form Manager/email behavior.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Button Text"
                  name="inquiry_cta_label"
                  defaultValue={business.inquiry_cta_label}
                  placeholder="Inquire"
                  hint="Defaults to “Inquire” when blank."
                />
                <TextField
                  label="Destination URL"
                  name="inquiry_cta_url"
                  type="url"
                  defaultValue={business.inquiry_cta_url}
                  placeholder="https://…"
                  hint="Overrides Form Manager/email when set."
                />
              </div>
            </div>

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Business CTA Buttons</p>
            <div className="rounded-2xl border border-black/10 p-4">
              <p className="mb-3 text-xs text-ink/45">
                Up to three additional buttons shown below the business description. Each is independent — off by
                default even when a label/URL is filled in.
              </p>
              <div className="flex flex-col gap-4">
                {([1, 2, 3] as const).map((n) => (
                  <div key={n} className="flex flex-col gap-2 rounded-xl border border-black/[0.06] p-3">
                    <CheckboxField label={`CTA ${n} Enabled`} name={`cta_${n}_enabled`} defaultChecked={business[`cta_${n}_enabled` as const]} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label="Label" name={`cta_${n}_label`} defaultValue={business[`cta_${n}_label` as const]} placeholder="Book Us" />
                      <TextField label="URL" name={`cta_${n}_url`} type="url" defaultValue={business[`cta_${n}_url` as const]} placeholder="https://…" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Team / People</p>
            <div className="rounded-2xl border border-black/10 p-4">
              <BusinessPeopleRoster initialPeople={result.people} />
            </div>

            <SubmitBar cancelHref="/admin/businesses" saveLabel="Save Profile" />
          </form>
        )}

        {/* ── Gallery ──────────────────────────────────────────────── */}
        {tab === "gallery" && (
          <form action={galleryAction} className="flex flex-col gap-5">
            <div className="rounded-2xl border border-black/10 p-4">
              <GalleryField
                label="Gallery"
                name="gallery_image_url"
                initialUrls={result.galleryImages}
                hint="Additional photos shown on the public profile, below Shop/Products, in a compact strip that opens a lightbox. The Logo and Cover Photo (Profile tab) stay separate."
              />
            </div>
            <SubmitBar cancelHref="/admin/businesses" saveLabel="Save Gallery" />
          </form>
        )}

        {/* ── Products ─────────────────────────────────────────────── */}
        {tab === "products" && (
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Products</p>
              <div className="flex items-center gap-3">
                <Link href={`/admin/products?business=${id}`} className="text-xs font-semibold text-ink/60 hover:text-ink">
                  View All Products
                </Link>
                <Link href={`/admin/products/new?business=${id}`} className="text-xs font-semibold text-findmi-700 hover:underline">
                  Add Product
                </Link>
              </div>
            </div>

            {products.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {products.map((p) => {
                  const moderationStatus = p.moderation_status ?? "live";
                  const marketplaceStatus = p.marketplace_status ?? "catalog_only";
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/admin/products/${p.id}`}
                        className="flex items-center gap-3 rounded-xl border border-black/5 px-3 py-2 transition hover:border-black/10"
                      >
                        {p.image_url ? (
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-black/5">
                            {/* eslint-disable-next-line @next/next/no-img-element -- small preview only */}
                            <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                          </div>
                        ) : (
                          <div className="h-10 w-10 shrink-0 rounded-lg border border-black/10 bg-black/5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                          <p className="truncate text-xs text-ink/45">
                            {p.is_active ? "Active" : "Inactive"}
                            {" · "}
                            {moderationStatus === "pending_review"
                              ? "Pending Review"
                              : moderationStatus === "rejected"
                                ? "Content Rejected"
                                : "Live"}
                            {" · "}
                            {marketplaceStatus === "catalog_only"
                              ? "Catalog Only"
                              : marketplaceStatus === "submitted"
                                ? "Marketplace Pending"
                                : marketplaceStatus === "approved"
                                  ? "Marketplace Approved"
                                  : marketplaceStatus === "paused"
                                    ? "Marketplace Paused"
                                    : "Marketplace Rejected"}
                            {formatPrice(p.price, p.price_label) ? ` · ${formatPrice(p.price, p.price_label)}` : ""}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink/50">No products yet.</p>
            )}
          </div>
        )}

        {/* ── Appearances ──────────────────────────────────────────── */}
        {tab === "appearances" && (
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="text-sm font-semibold text-ink">Appearances</p>
            <p className="mt-1 text-xs text-ink/45">FindMi Here — where this business is scheduled to appear.</p>
            <div className="mt-3 flex flex-col gap-2">
              <Link href={`/admin/appearances?business=${id}`} className="text-sm font-semibold text-findmi-700 hover:underline">
                View Appearances →
              </Link>
              <Link href={`/admin/appearances/import?business=${id}`} className="text-sm font-semibold text-findmi-700 hover:underline">
                Import Appearances →
              </Link>
            </div>
          </div>
        )}

        {/* ── Categories ───────────────────────────────────────────── */}
        {tab === "categories" && (
          <form action={categoriesAction} className="flex flex-col gap-5">
            <CheckboxList
              label="Categories"
              name="category_ids"
              defaultSelected={result.categoryIds}
              options={selectableCategories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <SubmitBar cancelHref="/admin/businesses" saveLabel="Save Categories" />
          </form>
        )}

        {/* ── Ownership ────────────────────────────────────────────── */}
        {tab === "ownership" && (
          <div className="rounded-2xl border border-black/10 bg-mist/40 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Business Access</p>
            <p className="mt-1 text-xs text-ink/45">
              Grants management access to an existing FindMi account (Manage Business, this business&rsquo;s own
              editor). Doesn&rsquo;t create accounts or change ownership.
            </p>

            {members.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{m.email ?? m.displayName ?? "Unknown account"}</p>
                      <p className="text-xs uppercase tracking-wide text-ink/45">{m.role}</p>
                    </div>
                    {m.role !== "owner" && (
                      <form action={removeBusinessMember.bind(null, id, m.id)}>
                        <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
                          Remove
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink/50">No assigned members yet.</p>
            )}

            <form action={assignMember} className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="email"
                name="email"
                required
                placeholder="user@example.com"
                className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                Assign
              </button>
            </form>
          </div>
        )}

        {/* ── Plan ─────────────────────────────────────────────────── */}
        {tab === "plan" && (
          <form action={planAction} className="flex flex-col gap-5">
            <SelectField
              label="Plan Tier"
              name="plan_tier"
              defaultValue={business.plan_tier ?? "free"}
              options={[
                { value: "free", label: "Free" },
                { value: "pro", label: "Pro" },
                // Future-only (Native Business Onboarding, Pass 1) — no seller
                // checkout/commerce exists yet. Selectable now (a Pro Seller
                // inherits full Pro access the moment this is set — see
                // isBusinessPro) so the tier itself doesn't block later work,
                // but labeled dormant so it's not mistaken for a live feature.
                { value: "pro_seller", label: "Pro Seller (future — dormant)" },
              ]}
            />
            <div className="grid gap-4 rounded-2xl border border-black/10 bg-mist/40 p-4 sm:grid-cols-2">
              <SelectField
                label="Plan Source"
                name="plan_source"
                defaultValue={business.plan_source ?? ""}
                options={[
                  { value: "", label: "— Not recorded —" },
                  { value: "paid", label: "Paid" },
                  { value: "complimentary", label: "Complimentary" },
                  { value: "promotional", label: "Promotional" },
                  { value: "admin", label: "Admin-granted" },
                ]}
                hint="Why this business is on its current plan. Optional."
              />
              <TextField
                label="Payment Reference"
                name="plan_payment_reference"
                defaultValue={business.plan_payment_reference}
                placeholder="Stripe/Tally id, or a short note"
                hint="Optional — an external payment/record reference, if any."
              />
              <TextField
                label="Plan Started"
                name="plan_started_at"
                type="date"
                defaultValue={business.plan_started_at ? business.plan_started_at.slice(0, 10) : null}
                hint="Optional."
              />
              <TextField
                label="Plan Expires"
                name="plan_expires_at"
                type="date"
                defaultValue={business.plan_expires_at ? business.plan_expires_at.slice(0, 10) : null}
                hint="Optional — not currently enforced anywhere."
              />
            </div>
            <SubmitBar cancelHref="/admin/businesses" saveLabel="Save Plan" />
          </form>
        )}

        {/* ── Moderation ───────────────────────────────────────────── */}
        {tab === "moderation" && (
          <div className="flex flex-col gap-5">
            <form action={moderationAction} className="flex flex-col gap-5">
              {/* Native Moderation Consolidation pass — THE control that
                  approves a listing. businesses.publication_status is what
                  every public query actually gates on (together with
                  is_demo=false below). */}
              <SelectField
                label="Listing Status"
                name="publication_status"
                defaultValue={business.publication_status ?? "live"}
                options={LISTING_STATUS_OPTIONS}
                hint="Pending Review businesses are excluded from FindMi discovery until you set this to Published / Live. This is what approves the listing — the Real Business toggle below does not."
              />
              <CheckboxField
                label="Real Business (Not Demo/Test)"
                name="published"
                defaultChecked={!business.is_demo}
                hint="On = a real business, eligible to ever appear publicly once Listing Status above is Published / Live. Off = demo/test content, always hidden regardless of Listing Status. This does NOT by itself approve the listing — use Listing Status above for that."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <CheckboxField label="Verified" name="verified" defaultChecked={business.verified} hint="Shows the verified badge on the profile." />
                <CheckboxField
                  label="Founding Member"
                  name="founding_member"
                  defaultChecked={business.founding_member}
                  hint="Shows the Founding Member badge instead."
                />
              </div>
              <CheckboxField
                label="Featured Brand"
                name="is_featured"
                defaultChecked={business.is_featured}
                hint="Shows in the homepage/Businesses 'Featured Brands' rows. Independent of Founding Member."
              />
              <SubmitBar cancelHref="/admin/businesses" saveLabel="Save Moderation" />
            </form>

            {/* Legacy Membership / Onboarding — Founding Membership billing/
                onboarding, kept as its own read-only secondary section: not
                editable from here (still done at /admin/onboarding/[id]),
                but its Publication Status can override Listing Status above
                whenever a business IS linked to one. */}
            <div className="rounded-2xl border border-black/10 bg-mist/20 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Legacy Membership / Onboarding</p>
              <p className="mt-1 text-xs text-ink/45">
                Founding Membership billing/onboarding — a separate legacy system from Plan and Business Access.
                Still relevant if present: its Publication Status can hide this profile publicly even when
                Published is on.
              </p>
              {membership ? (
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-ink/70">
                  <p>
                    Plan: <span className="font-medium text-ink">{membership.plan?.name ?? "—"}</span>
                    {membership.founding_price_locked && (
                      <span className="ml-1.5 text-xs font-semibold text-findmi-700">(founding price locked)</span>
                    )}
                  </p>
                  <p>
                    Markets:{" "}
                    <span className="font-medium text-ink">
                      {membership.markets.length ? membership.markets.map((m) => m.name).join(", ") : "None assigned"}
                    </span>
                  </p>
                  <p>
                    Billing: <span className="font-medium text-ink">{billingStatusLabel(membership.billing_status)}</span>
                    {" · "}Onboarding: <span className="font-medium text-ink">{onboardingStatusLabel(membership.onboarding_status)}</span>
                    {" · "}Publication: <span className="font-medium text-ink">{publicationStatusLabel(membership.publication_status)}</span>
                  </p>
                  {membership.stripe_customer_id && (
                    <p className="text-xs text-ink/45">Stripe customer: {membership.stripe_customer_id}</p>
                  )}
                  <Link href={`/admin/onboarding/${membership.id}`} className="mt-1 inline-block text-xs font-semibold text-findmi-700 hover:underline">
                    Manage membership →
                  </Link>
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-ink/50">
                  No membership record — this business isn&rsquo;t linked to a membership/onboarding entry.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Internal ─────────────────────────────────────────────── */}
        {tab === "internal" && (
          <form action={internalAction} className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Membership Status"
                name="membership_status"
                defaultValue={business.membership_status ?? "lead"}
                options={[
                  { value: "lead", label: "Lead" },
                  { value: "active", label: "Active" },
                  { value: "past_due", label: "Past Due" },
                  { value: "canceled", label: "Canceled" },
                ]}
              />
              <SelectField
                label="Lead Status"
                name="lead_status"
                defaultValue={business.lead_status ?? "new"}
                options={[
                  { value: "new", label: "New" },
                  { value: "contacted", label: "Contacted" },
                  { value: "onboarding", label: "Onboarding" },
                  { value: "qualified", label: "Qualified" },
                  { value: "not_a_fit", label: "Not a Fit" },
                ]}
              />
            </div>

            <div className="rounded-2xl border border-black/10 p-4">
              <p className="mb-3 text-sm font-semibold text-ink">Commerce</p>
              <div className="flex flex-col gap-4">
                <CheckboxField
                  label="Commerce Enabled"
                  name="commerce_enabled"
                  defaultChecked={business.commerce_enabled}
                  hint="Off = every product keeps its existing inquiry/external-link behavior, regardless of the Purchasable toggle on the product itself."
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="FindMi Fee %"
                    name="marketplace_fee_percent"
                    defaultValue={business.marketplace_fee_percent ?? 5}
                    step="0.01"
                    hint="Applies to merchandise value unless a product overrides it."
                  />
                  <SelectField
                    label="Processing Fee Paid By"
                    name="processing_fee_payer"
                    defaultValue={business.processing_fee_payer ?? "vendor"}
                    options={[
                      { value: "vendor", label: "Vendor (default)" },
                      { value: "customer", label: "Customer (shown as a checkout fee)" },
                    ]}
                  />
                </div>
                <SelectField
                  label="Payout Method"
                  name="payout_method"
                  defaultValue={business.payout_method ?? "manual"}
                  options={[
                    { value: "manual", label: "Manual (the only operational method today)" },
                    { value: "stripe_connect_future", label: "Stripe Connect — not yet connected" },
                  ]}
                  hint="Payouts are always recorded manually by the founder right now, regardless of this setting — see /admin/settlements."
                />
              </div>
            </div>

            <SubmitBar cancelHref="/admin/businesses" saveLabel="Save Internal" />
          </form>
        )}
      </div>
    </div>
  );
}
