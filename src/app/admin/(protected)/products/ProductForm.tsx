import { CheckboxField, NumberField, SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import type { AdminProduct, SelectOption } from "@/lib/admin/queries";
import { saveProduct, deleteProduct } from "./actions";

export default function ProductForm({
  product,
  businessOptions,
  error,
}: {
  product: AdminProduct | null;
  businessOptions: SelectOption[];
  error?: string;
}) {
  const action = saveProduct.bind(null, product?.id ?? null);

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-5">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <SelectField
          label="Sold By"
          name="business_id"
          defaultValue={product?.business_id}
          options={[
            { value: "", label: "Choose a business…" },
            ...businessOptions.map((o) => ({ value: o.value, label: `${o.label}${o.sublabel ? ` (${o.sublabel})` : ""}` })),
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Product Name" name="name" defaultValue={product?.name} required />
          <TextField
            label="URL Slug"
            name="slug"
            defaultValue={product?.slug}
            required
            hint="Used in the public URL: /product/your-slug — must be unique across all products."
          />
        </div>

        <TextareaField label="Description" name="description" defaultValue={product?.description} rows={4} />
        <ImageField label="Product Image" name="image_url" defaultValue={product?.image_url} />

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Price" name="price" defaultValue={product?.price} step="0.01" />
          <TextField
            label="Price Label"
            name="price_label"
            defaultValue={product?.price_label}
            hint='Overrides the price display, e.g. "From $20" or "Call for pricing".'
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Type"
            name="product_type"
            defaultValue={product?.product_type ?? "product"}
            options={[
              { value: "product", label: "Product" },
              { value: "service", label: "Service" },
            ]}
          />
          <TextField
            label="External Purchase Link"
            name="external_purchase_url"
            type="url"
            defaultValue={product?.external_purchase_url}
            placeholder="https://…"
            hint="If set, the product page shows a Shop Now button linking here."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <CheckboxField
            label="Active"
            name="is_active"
            defaultChecked={product ? product.is_active : true}
            hint="Off hides it from the business profile and product page."
          />
          <CheckboxField label="Featured" name="is_featured" defaultChecked={product?.is_featured} />
        </div>

        <SubmitBar cancelHref="/admin/products" />
      </form>

      {product && (
        <div className="border-t border-black/5 pt-5">
          <DeleteButton
            action={deleteProduct.bind(null, product.id)}
            confirmMessage={`Delete "${product.name}"? This can't be undone.`}
          />
        </div>
      )}
    </div>
  );
}
