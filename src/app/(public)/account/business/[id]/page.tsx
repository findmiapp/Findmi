import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { getCategories } from "@/lib/data";
import AccountNav from "../../AccountNav";
import { updateMemberBusiness } from "../actions";
import MemberImageField from "./MemberImageField";
import MemberGalleryField from "./MemberGalleryField";

export const metadata: Metadata = {
  title: "Manage Business",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

// Business Category Onboarding Filter pass — Markets & Pop-Ups and
// Packaged Goods stay real rows (existing relationships preserved), just
// no longer offered as a selectable choice here. Slugs only, so this has
// zero effect on the DB, on event/product categories, or on public
// discovery (getCategories() itself is untouched).
const LEGACY_BUSINESS_CATEGORY_SLUGS = new Set(["markets-pop-ups", "packaged-goods"]);

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

/** MY FINDMI — MINIMAL MANAGE BUSINESS PAGE. The smallest functional
 * owner-facing editor for a claimed business, calling the existing
 * updateMemberBusiness Server Action directly (no update logic
 * duplicated here) — this page only reads what it needs to render the
 * form and hands the submit off entirely to that action, which already
 * owns every authorization/validation/allowlist/atomicity concern.
 *
 * Free and Pro currently render the exact same form — updateMemberBusiness
 * itself only allows this same small field set for both tiers right now
 * (see its own doc comment), so there is nothing more to show yet; the
 * plan label is purely informational here. */
export default async function ManageBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Same defense-in-depth re-check every other /account Server
  // Component/Action already does.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/business/${id}`)}`);

  // Real, session-scoped authorization — never trusts anything from the
  // URL beyond the id itself. Same requireBusinessMember() foundation
  // updateMemberBusiness uses; a visitor with no business_members row for
  // this business never sees the form at all, existing account error
  // pattern (an ?error= banner on the account home, same shape every
  // other /account page already uses).
  try {
    await requireBusinessMember(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to that business.";
    redirect(errorRedirectUrl("/account", message));
  }

  // Only reachable AFTER authorization succeeds above — plan_tier isn't in
  // the public column grant (see restrict_internal_commerce_columns), so
  // it's read via service-role here, same authorize-then-elevate shape as
  // updateMemberBusiness itself.
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  const [{ data: business }, categories, { data: businessCategoryRows }, { data: galleryRows }] = await Promise.all([
    admin
      .from("businesses")
      .select(
        "id, name, logo_url, cover_image_url, plan_tier, short_description, description, city, state, country, email, phone, website_url, instagram_url, facebook_url, tiktok_url, bulletin_enabled, bulletin_label, bulletin_heading, bulletin_body, bulletin_url"
      )
      .eq("id", id)
      .maybeSingle(),
    getCategories(),
    // A business may still carry more than one category from before this
    // action's one-category rule existed (admin's own editor allows
    // several) — ordered + limited to 1 so the form simply defaults to
    // one of them rather than erroring; saving collapses it to exactly
    // one via updateMemberBusiness's own atomic set_business_category().
    admin.from("business_categories").select("category_id").eq("business_id", id).order("category_id").limit(1),
    // Existing gallery table (business_images) — same admin query shape
    // (lib/admin/queries.ts's getAdminBusinessById), just read here too so
    // the Pro-only gallery field below has something to preview.
    admin
      .from("business_images")
      .select("url")
      .eq("business_id", id)
      .order("display_order", { ascending: true, nullsFirst: false }),
  ]);
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const pro = isBusinessPro(business);
  const currentCategoryId = businessCategoryRows?.[0]?.category_id ?? "";
  const galleryImages = (galleryRows ?? []).map((r) => r.url);
  const action = updateMemberBusiness.bind(null, id);

  // Legacy categories stay in the DB for existing relationships but are no
  // longer offered as a new choice — except for a business already
  // assigned to one, so editing this page can never silently drop it.
  const selectableCategories = categories.filter(
    (c) => !LEGACY_BUSINESS_CATEGORY_SLUGS.has(c.slug) || c.id === currentCategoryId
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <div className="mx-auto max-w-md">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Manage Business</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{business.name}</h1>
        <span
          className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            pro ? "bg-findmi text-white" : "bg-black/[0.06] text-ink/60"
          }`}
        >
          {pro ? "Pro" : "Free"} Plan
        </span>

        {!pro && (
          <div className="mt-4 rounded-2xl border border-findmi/20 bg-findmi-50 p-4 sm:p-5">
            <p className="text-sm font-bold text-ink">Unlock your full FindMi presence</p>
            <p className="mt-1 text-sm text-ink/60">
              Upgrade to Pro to add your business details, contact links, gallery, products, appearances and more.
            </p>
            <a
              href="https://tally.so/r/0QR7LN"
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Upgrade to Pro
            </a>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
        {saved && !error && (
          <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
            Business updated.
          </p>
        )}

        <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <form action={action} className="flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Business Basics</p>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Business name</span>
              <input type="text" name="name" required defaultValue={business.name} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Category</span>
              <select name="category_id" required defaultValue={currentCategoryId} className={inputClass}>
                <option value="" disabled>
                  Choose a category…
                </option>
                {selectableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Short description</span>
              <textarea
                name="short_description"
                rows={3}
                defaultValue={business.short_description ?? ""}
                className={inputClass}
              />
            </label>
            <MemberImageField businessId={id} label="Logo" name="logo_url" defaultValue={business.logo_url} />
            <MemberImageField
              businessId={id}
              label="Cover image"
              name="cover_image_url"
              defaultValue={business.cover_image_url}
            />

            {/* Pro-only fields — the additional businesses columns
                (existing schema, admin already edits every one of these)
                that PRO_ONLY_COLUMNS in actions.ts allows only when this
                business's server-resolved plan_tier is Pro. Free never
                renders this block, so a Free owner can't even see these
                inputs, let alone submit them — and even if they crafted a
                raw request with these field names, the action's own
                allowlist (resolved server-side, never from the submitted
                form) silently drops them. */}
            {pro && (
              <>
                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Gallery</p>
                <MemberGalleryField businessId={id} name="gallery_image_url" initialUrls={galleryImages} />

                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">About</p>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">About / full description</span>
                  <textarea
                    name="description"
                    rows={5}
                    defaultValue={business.description ?? ""}
                    className={inputClass}
                  />
                </label>

                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Location</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">City</span>
                    <input type="text" name="city" defaultValue={business.city ?? ""} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">State</span>
                    <input type="text" name="state" defaultValue={business.state ?? ""} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Country</span>
                    <input type="text" name="country" defaultValue={business.country ?? ""} className={inputClass} />
                  </label>
                </div>

                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Contact &amp; Links</p>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Website</span>
                  <input
                    type="url"
                    name="website_url"
                    defaultValue={business.website_url ?? ""}
                    placeholder="https://…"
                    className={inputClass}
                  />
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
                    <input type="email" name="email" defaultValue={business.email ?? ""} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Phone</span>
                    <input type="tel" name="phone" defaultValue={business.phone ?? ""} className={inputClass} />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Instagram</span>
                    <input
                      type="url"
                      name="instagram_url"
                      defaultValue={business.instagram_url ?? ""}
                      placeholder="https://instagram.com/…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Facebook</span>
                    <input
                      type="url"
                      name="facebook_url"
                      defaultValue={business.facebook_url ?? ""}
                      placeholder="https://facebook.com/…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">TikTok</span>
                    <input
                      type="url"
                      name="tiktok_url"
                      defaultValue={business.tiktok_url ?? ""}
                      placeholder="https://tiktok.com/@…"
                      className={inputClass}
                    />
                  </label>
                </div>

                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Announcement</p>
                <div className="rounded-2xl border border-black/10 p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input type="checkbox" name="bulletin_enabled" defaultChecked={business.bulletin_enabled} />
                    Show announcement
                  </label>
                  <div className="mt-3 flex flex-col gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement label</span>
                      <input
                        type="text"
                        name="bulletin_label"
                        defaultValue={business.bulletin_label ?? ""}
                        placeholder="Announcement"
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement heading</span>
                      <input
                        type="text"
                        name="bulletin_heading"
                        defaultValue={business.bulletin_heading ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement message</span>
                      <textarea
                        name="bulletin_body"
                        rows={3}
                        defaultValue={business.bulletin_body ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement link (optional)</span>
                      <input
                        type="text"
                        name="bulletin_url"
                        defaultValue={business.bulletin_url ?? ""}
                        placeholder="https://…"
                        className={inputClass}
                      />
                    </label>
                  </div>
                </div>
              </>
            )}

            <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
              Save Changes
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
