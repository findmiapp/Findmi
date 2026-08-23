import {
  CheckboxField,
  CheckboxList,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import SubmitBar from "@/components/admin/SubmitBar";
import type { AdminBusiness } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { saveBusiness } from "./actions";

export default function BusinessForm({
  business,
  categories,
  selectedCategoryIds,
  error,
}: {
  business: AdminBusiness | null;
  categories: Category[];
  selectedCategoryIds: string[];
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

      <CheckboxField
        label="Published"
        name="published"
        defaultChecked={business ? !business.is_demo : true}
        hint="On = visible to the public. Off = hidden (demo/test only). A business linked to a membership also needs its onboarding approved (see the Membership section above) — a pending/rejected/paused membership keeps the profile hidden even when this is on."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Business Name" name="name" defaultValue={business?.name} required />
        <TextField
          label="URL Slug"
          name="slug"
          defaultValue={business?.slug}
          required
          hint="Used in the public URL: /business/your-slug"
        />
      </div>

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

      <SubmitBar cancelHref="/admin/businesses" />
    </form>
  );
}
