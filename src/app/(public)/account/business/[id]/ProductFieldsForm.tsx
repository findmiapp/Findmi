"use client";

import MemberImageField from "./MemberImageField";
import type { Category } from "@/lib/types";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface ProductFieldValues {
  name: string;
  description: string;
  image_url: string | null;
  price: string;
  price_label: string;
  product_type: "product" | "service";
  external_purchase_url: string;
  category_id: string;
}

/** Shared fields for both "Add Product" and "Edit" — Pro Products
 * Foundation pass. Same shared-fields-component shape as
 * AppearanceFieldsForm, restricted to the public-catalog subset the
 * matching server action (createMemberProduct/updateMemberProduct,
 * ../actions.ts) actually accepts — no commerce/payout/fee/inventory
 * fields here, those stay admin-only. Server-side validation in
 * ../actions.ts remains the real authority; this component does no
 * client-side validation of its own. */
export default function ProductFieldsForm({
  businessId,
  action,
  defaultValues,
  categories,
  submitLabel,
  showDistributionChoice = false,
  distributionDefault = "catalog_only",
}: {
  businessId: string;
  action: (formData: FormData) => void | Promise<void>;
  defaultValues: ProductFieldValues;
  categories: Category[];
  submitLabel: string;
  /** Product Marketplace Distribution pass — only meaningful at creation:
   * the owner's initial Catalog Only vs Submit To Marketplace choice
   * (read by createMemberProduct, ../actions.ts). Never shown on the Edit
   * form — an existing product's distribution changes through its own
   * dedicated Submit/Return controls in the manager list, not by
   * resubmitting the content-edit form, so a content edit can never
   * silently also change marketplace_status. */
  showDistributionChoice?: boolean;
  /** Event Creation + Pending Review UX pass — lets a rejected "Add
   * Product" submission round-trip which radio the owner had picked,
   * same as every other field on this form; defaults to "catalog_only"
   * (the pre-existing hardcoded default) on a fresh, never-submitted
   * form. */
  distributionDefault?: "catalog_only" | "marketplace";
}) {
  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">Product name</span>
        <input
          type="text"
          name="name"
          required
          defaultValue={defaultValues.name}
          placeholder="e.g. Hand-poured candle"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">
          Description <span className="font-normal text-ink/40">Optional</span>
        </span>
        <textarea name="description" defaultValue={defaultValues.description} rows={3} className={inputClass} />
      </label>
      <MemberImageField
        businessId={businessId}
        label="Photo (optional)"
        name="image_url"
        defaultValue={defaultValues.image_url}
      />
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">Category</span>
        <select name="category_id" defaultValue={defaultValues.category_id} className={inputClass}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">Price</span>
          <input
            type="number"
            step="0.01"
            min="0"
            name="price"
            defaultValue={defaultValues.price}
            placeholder="Optional"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">Type</span>
          <select name="product_type" defaultValue={defaultValues.product_type} className={inputClass}>
            <option value="product">Product</option>
            <option value="service">Service</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">
          Price label <span className="font-normal text-ink/40">Optional</span>
        </span>
        <input
          type="text"
          name="price_label"
          defaultValue={defaultValues.price_label}
          placeholder='e.g. "From $20" — used when there&rsquo;s no exact Price above'
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">
          Purchase link <span className="font-normal text-ink/40">Optional</span>
        </span>
        <input
          type="url"
          name="external_purchase_url"
          defaultValue={defaultValues.external_purchase_url}
          placeholder="Where can customers buy this?"
          className={inputClass}
        />
      </label>
      {showDistributionChoice && (
        <div className="mt-1 flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/35">Where should this appear?</span>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="distribution"
              value="catalog_only"
              defaultChecked={distributionDefault === "catalog_only"}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Business profile only</span>
              <span className="block text-xs text-ink/50">Shown on your Findmi business profile only.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="distribution"
              value="marketplace"
              defaultChecked={distributionDefault === "marketplace"}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Submit to Findmi Marketplace</span>
              <span className="block text-xs text-ink/50">
                Request broader placement across Findmi Marketplace and discovery. Marketplace approval and
                commission terms apply.
              </span>
            </span>
          </label>
        </div>
      )}
      <button
        type="submit"
        className="mt-1 w-fit rounded-full bg-findmi px-5 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        {submitLabel}
      </button>
    </form>
  );
}
