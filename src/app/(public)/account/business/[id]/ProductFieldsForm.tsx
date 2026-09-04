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
}: {
  businessId: string;
  action: (formData: FormData) => void | Promise<void>;
  defaultValues: ProductFieldValues;
  categories: Category[];
  submitLabel: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-2">
      <input
        type="text"
        name="name"
        required
        defaultValue={defaultValues.name}
        placeholder="Product name"
        className={inputClass}
      />
      <textarea
        name="description"
        defaultValue={defaultValues.description}
        placeholder="Description (optional)"
        rows={3}
        className={inputClass}
      />
      <MemberImageField
        businessId={businessId}
        label="Product image (optional)"
        name="image_url"
        defaultValue={defaultValues.image_url}
      />
      <select name="category_id" defaultValue={defaultValues.category_id} className={inputClass}>
        <option value="">No category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          step="0.01"
          min="0"
          name="price"
          defaultValue={defaultValues.price}
          placeholder="Price (optional)"
          className={inputClass}
        />
        <select name="product_type" defaultValue={defaultValues.product_type} className={inputClass}>
          <option value="product">Product</option>
          <option value="service">Service</option>
        </select>
      </div>
      <input
        type="text"
        name="price_label"
        defaultValue={defaultValues.price_label}
        placeholder='Price label (optional, e.g. "From $20")'
        className={inputClass}
      />
      <input
        type="url"
        name="external_purchase_url"
        defaultValue={defaultValues.external_purchase_url}
        placeholder="Purchase link (optional)"
        className={inputClass}
      />
      <button
        type="submit"
        className="mt-1 rounded-full bg-findmi px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        {submitLabel}
      </button>
    </form>
  );
}
