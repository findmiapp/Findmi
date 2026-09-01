import { CheckboxField, CheckboxList, NumberField, SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import FulfillmentOptionsEditor from "@/components/admin/FulfillmentOptionsEditor";
import ImageField from "@/components/admin/ImageField";
import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import type { AdminProduct, ProductFulfillmentOptionRow, SelectOption } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { saveProduct, deleteProduct } from "./actions";

export default function ProductForm({
  product,
  initialBusiness,
  fulfillmentOptions,
  appearanceOptions,
  categories,
  selectedCategoryIds,
  error,
}: {
  product: AdminProduct | null;
  initialBusiness: SelectOption | null;
  fulfillmentOptions: ProductFulfillmentOptionRow[];
  appearanceOptions: SelectOption[];
  categories: Category[];
  selectedCategoryIds: string[];
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

        <RelationField
          label="Sold By"
          name="business_id"
          entity="businesses"
          initial={initialBusiness}
          clearLabel={null}
          createHref="/admin/businesses/new"
          createLabel="New Business"
        />

        <NameSlugFields
          isNew={!product}
          nameLabel="Product Name"
          defaultName={product?.name}
          defaultSlug={product?.slug}
          slugHint="Used in the public URL: /product/your-slug — must be unique across all products."
        />

        <TextareaField label="Description" name="description" defaultValue={product?.description} rows={4} />
        <ImageField label="Product Image" name="image_url" defaultValue={product?.image_url} />

        <CheckboxList
          label="Categories"
          name="category_ids"
          defaultSelected={selectedCategoryIds}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          emptyText="No product categories yet — add some in /admin/categories/products."
        />

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

        <NumberField
          label="Homepage / Marketplace Order"
          name="home_sort_order"
          defaultValue={product?.home_sort_order ?? undefined}
          hint="Only matters when Featured is on — lower numbers show first. Leave blank to sort last, by name."
        />
        <NumberField
          label="Business Profile Order"
          name="profile_sort_order"
          defaultValue={product?.profile_sort_order ?? undefined}
          hint="Where this shows up in Shop [Business] on its own profile — lower numbers show first, independent of the Homepage/Marketplace order above. Leave blank to sort last, by Featured then name."
        />

        <div className="rounded-2xl border border-black/10 p-4">
          <p className="mb-3 text-sm font-semibold text-ink">Commerce</p>
          <div className="flex flex-col gap-4">
            <CheckboxField
              label="Purchasable"
              name="purchasable"
              defaultChecked={product?.purchasable}
              hint="On shows Add to Cart on the product page (also requires the business's Commerce Enabled setting). Off keeps the existing inquiry/external-link behavior."
            />
            <SelectField
              label="Inventory Status"
              name="inventory_status"
              defaultValue={product?.inventory_status ?? ""}
              options={[
                { value: "", label: "Not tracked" },
                { value: "in_stock", label: "In Stock" },
                { value: "out_of_stock", label: "Out of Stock" },
              ]}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="FindMi Fee % Override"
                name="marketplace_fee_override_percent"
                defaultValue={product?.marketplace_fee_override_percent ?? undefined}
                hint="Leave blank to use the business's fee %."
              />
              <SelectField
                label="Processing Fee Override"
                name="processing_fee_payer_override"
                defaultValue={product?.processing_fee_payer_override ?? ""}
                options={[
                  { value: "", label: "Use business setting" },
                  { value: "vendor", label: "Vendor pays" },
                  { value: "customer", label: "Customer pays" },
                ]}
              />
            </div>
          </div>
        </div>

        {product ? (
          <FulfillmentOptionsEditor initialOptions={fulfillmentOptions} appearanceOptions={appearanceOptions} />
        ) : (
          <p className="text-xs text-ink/45">
            Save the product first, then come back to configure fulfillment methods and pricing.
          </p>
        )}

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
