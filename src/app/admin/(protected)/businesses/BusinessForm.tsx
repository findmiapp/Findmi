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
import SubmitBar from "@/components/admin/SubmitBar";
import BusinessPeopleRoster from "@/components/admin/BusinessPeopleRoster";
import type { AdminBusiness } from "@/lib/admin/queries";
import type { BusinessPersonRow } from "@/lib/admin/people-queries";
import type { Category } from "@/lib/types";
import { saveBusiness } from "./actions";

export default function BusinessForm({
  business,
  categories,
  selectedCategoryIds,
  galleryImages,
  people,
  error,
}: {
  business: AdminBusiness | null;
  categories: Category[];
  selectedCategoryIds: string[];
  galleryImages: string[];
  people: BusinessPersonRow[];
  error?: string;
}) {
  const action = saveBusiness.bind(null, business?.id ?? null);

  return (
    <form action={action} className="flex flex-col gap-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Plan Tier moved to the very top — this is the same Free/Pro
          control referenced by the Access & Plan section above the form;
          keeping it first here makes it the first thing the founder edits,
          not buried among unrelated fields further down. */}
      <SelectField
        label="Plan Tier"
        name="plan_tier"
        defaultValue={business?.plan_tier ?? "free"}
        options={[
          { value: "free", label: "Free" },
          { value: "pro", label: "Pro" },
        ]}
      />

      <CheckboxField
        label="Published"
        name="published"
        defaultChecked={business ? !business.is_demo : true}
        hint="On = visible to the public. Off = hidden (demo/test only). A business linked to a Founding Membership record also needs its onboarding approved (see Legacy Membership / Onboarding below) — a pending/rejected/paused membership keeps the profile hidden even when this is on."
      />

      <NameSlugFields
        isNew={!business}
        nameLabel="Business Name"
        defaultName={business?.name}
        defaultSlug={business?.slug}
        slugHint="Used in the public URL: /business/your-slug"
      />

      <TextField
        label="Short Description"
        name="short_description"
        defaultValue={business?.short_description}
        hint="One line — shown on cards and search results."
      />
      <TextareaField
        label="Full Description"
        name="description"
        defaultValue={business?.description}
        rows={5}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <ImageField label="Logo Image" name="logo_url" defaultValue={business?.logo_url} />
        <ImageField
          label="Cover Photo"
          name="cover_image_url"
          defaultValue={business?.cover_image_url}
        />
      </div>

      <div className="rounded-2xl border border-black/10 p-4">
        <GalleryField
          label="Gallery"
          name="gallery_image_url"
          initialUrls={galleryImages}
          hint="Additional photos shown on the public profile, below Shop/Products, in a compact strip that opens a lightbox. The Logo and Cover Photo above stay separate."
        />
      </div>

      <div className="rounded-2xl border border-black/10 p-4">
        <BusinessPeopleRoster initialPeople={people} />
      </div>

      <CheckboxList
        label="Categories"
        name="category_ids"
        defaultSelected={selectedCategoryIds}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="City" name="city" defaultValue={business?.city} />
        <TextField label="State" name="state" defaultValue={business?.state} />
        <TextField label="Country" name="country" defaultValue={business?.country ?? "US"} />
      </div>
      <TextField
        label="Service Radius (miles)"
        name="service_radius_miles"
        defaultValue={business?.service_radius_miles ?? undefined}
        hint="Leave blank if not a mobile/service-area business."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Email" name="email" type="email" defaultValue={business?.email} />
        <TextField label="Phone" name="phone" type="tel" defaultValue={business?.phone} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Website"
          name="website_url"
          type="url"
          defaultValue={business?.website_url}
          placeholder="https://…"
        />
        <TextField
          label="Instagram"
          name="instagram_url"
          type="url"
          defaultValue={business?.instagram_url}
          placeholder="https://instagram.com/…"
        />
        <TextField
          label="Facebook"
          name="facebook_url"
          type="url"
          defaultValue={business?.facebook_url}
          placeholder="https://facebook.com/…"
        />
        <TextField
          label="TikTok"
          name="tiktok_url"
          type="url"
          defaultValue={business?.tiktok_url}
          placeholder="https://tiktok.com/@…"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CheckboxField
          label="Verified"
          name="verified"
          defaultChecked={business?.verified}
          hint="Shows the verified badge on the profile."
        />
        <CheckboxField
          label="Founding Member"
          name="founding_member"
          defaultChecked={business?.founding_member}
          hint="Shows the Founding Member badge instead."
        />
      </div>

      <CheckboxField
        label="Featured Brand"
        name="is_featured"
        defaultChecked={business?.is_featured}
        hint="Shows in the homepage/Businesses 'Featured Brands' rows. Independent of Founding Member."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Membership Status"
          name="membership_status"
          defaultValue={business?.membership_status ?? "lead"}
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
          defaultValue={business?.lead_status ?? "new"}
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
            defaultChecked={business?.commerce_enabled}
            hint="Off = every product keeps its existing inquiry/external-link behavior, regardless of the Purchasable toggle on the product itself."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="FindMi Fee %"
              name="marketplace_fee_percent"
              defaultValue={business?.marketplace_fee_percent ?? 5}
              step="0.01"
              hint="Applies to merchandise value unless a product overrides it."
            />
            <SelectField
              label="Processing Fee Paid By"
              name="processing_fee_payer"
              defaultValue={business?.processing_fee_payer ?? "vendor"}
              options={[
                { value: "vendor", label: "Vendor (default)" },
                { value: "customer", label: "Customer (shown as a checkout fee)" },
              ]}
            />
          </div>
          <SelectField
            label="Payout Method"
            name="payout_method"
            defaultValue={business?.payout_method ?? "manual"}
            options={[
              { value: "manual", label: "Manual (the only operational method today)" },
              { value: "stripe_connect_future", label: "Stripe Connect — not yet connected" },
            ]}
            hint="Payouts are always recorded manually by the founder right now, regardless of this setting — see /admin/settlements."
          />
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 p-4">
        <p className="mb-1 text-sm font-semibold text-ink">Inquire Button</p>
        <p className="mb-3 text-xs text-ink/45">
          Optional — point the profile&rsquo;s primary Inquire button at any external URL with custom
          text, no Tally form required. Leave blank to keep the existing Form Manager/email behavior.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Button Text"
            name="inquiry_cta_label"
            defaultValue={business?.inquiry_cta_label}
            placeholder="Inquire"
            hint="Defaults to “Inquire” when blank."
          />
          <TextField
            label="Destination URL"
            name="inquiry_cta_url"
            type="url"
            defaultValue={business?.inquiry_cta_url}
            placeholder="https://…"
            hint="Overrides Form Manager/email when set."
          />
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 p-4">
        <p className="mb-1 text-sm font-semibold text-ink">Business CTA Buttons</p>
        <p className="mb-3 text-xs text-ink/45">
          Up to three additional buttons shown below the business description. Each is independent —
          off by default even when a label/URL is filled in.
        </p>
        <div className="flex flex-col gap-4">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="flex flex-col gap-2 rounded-xl border border-black/[0.06] p-3">
              <CheckboxField
                label={`CTA ${n} Enabled`}
                name={`cta_${n}_enabled`}
                defaultChecked={business?.[`cta_${n}_enabled` as const]}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Label"
                  name={`cta_${n}_label`}
                  defaultValue={business?.[`cta_${n}_label` as const]}
                  placeholder="Book Us"
                />
                <TextField
                  label="URL"
                  name={`cta_${n}_url`}
                  type="url"
                  defaultValue={business?.[`cta_${n}_url` as const]}
                  placeholder="https://…"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 p-4">
        <p className="mb-1 text-sm font-semibold text-ink">Announcement</p>
        <p className="mb-3 text-xs text-ink/45">
          A small, timely notice shown near the top of your profile — a flash sale, a booking update,
          &ldquo;Sold out this weekend,&rdquo; anything current. Renders nothing publicly unless Show
          announcement is on and Message has real content.
        </p>
        <div className="flex flex-col gap-4">
          <CheckboxField label="Show announcement" name="bulletin_enabled" defaultChecked={business?.bulletin_enabled} />
          <TextField
            label="Label"
            name="bulletin_label"
            defaultValue={business?.bulletin_label}
            placeholder="Announcement"
            hint={'Shown above the heading — e.g. "Flash Sale," "Now Booking," "Update." Defaults to "Announcement" when blank.'}
          />
          <TextField
            label="Heading"
            name="bulletin_heading"
            defaultValue={business?.bulletin_heading}
            placeholder="Sold out this weekend"
          />
          <TextareaField
            label="Message"
            name="bulletin_body"
            defaultValue={business?.bulletin_body}
            rows={3}
            hint="e.g. We'll be back at the market next Saturday."
          />
          <TextField
            label="Link (optional)"
            name="bulletin_url"
            defaultValue={business?.bulletin_url}
            placeholder="https://… or /a-findmi-page"
            hint="Makes the whole announcement clickable. Leave blank for a static notice."
          />
        </div>
      </div>

      <SubmitBar cancelHref="/admin/businesses" />
    </form>
  );
}
