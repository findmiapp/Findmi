import { CheckboxField, CheckboxList, NumberField, SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import { getAllCategories } from "@/lib/admin/queries";
import type {
  AdminActivationInventoryItem,
  AdminActivationOption,
  AdminActivationVenue,
  ActivationInventoryKind,
  ActivationOptionKind,
} from "@/lib/admin/activations";
import {
  createActivationInventoryItem,
  createActivationOption,
  deleteActivationInventoryItem,
  deleteActivationOption,
  moveActivationInventoryItem,
  moveActivationOption,
  saveActivationInventoryItem,
  saveActivationOption,
} from "../actions";

const PRICE_TYPE_OPTIONS = [
  { value: "fixed", label: "Fixed" },
  { value: "starting_at", label: "Starting At" },
  { value: "custom", label: "Custom" },
  { value: "included", label: "Included" },
  { value: "free", label: "Free" },
];

const PRICE_VISIBILITY_OPTIONS = [
  { value: "", label: "Inherit Activation default" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
  { value: "custom_label", label: "Custom Label" },
];

const OPTION_KIND_COPY: Record<ActivationOptionKind, { title: string; hint: string }> = {
  goal: { title: "Goals", hint: "Builder Step 2 — what the brand is trying to accomplish." },
  family: { title: "Activation Families", hint: "Builder Step 3 — the experience concept (Be Discovered, Come to Life, etc.)." },
};

const INVENTORY_KIND_COPY: Record<ActivationInventoryKind, { title: string; hint: string }> = {
  space: { title: "Space", hint: "Builder Step 4 — physical placement/display inventory." },
  timing: { title: "Timing", hint: "Builder Step 5 — a commercial duration offering (e.g. “2-Hour Activation,” “Full Day”). Not an actual calendar booking slot." },
  addon: { title: "Add-ons", hint: "Builder Step 6 — sampling setup, staffing, signage, and similar extras." },
};

/** The operational heart of Pass 1 — every Builder-facing choice (Goals,
 * Activation Families, Space, Timing, Add-ons) is Admin-configurable data,
 * never hard-coded React. Options (goal|family) and Inventory
 * (space|timing|addon) each share one table with a `kind` discriminator
 * (see the frozen architecture audit/amendment) — this renders one
 * section per kind, each a small independently-savable per-row form
 * (same principle as ActivationVenuesTab), rather than one giant
 * bulk-save-everything list, since Inventory rows in particular carry far
 * more fields than a simple category-style row. */
export default async function ActivationBuilderConfigTab({
  activationId,
  venues,
  options,
  inventory,
}: {
  activationId: string;
  venues: AdminActivationVenue[];
  options: AdminActivationOption[];
  inventory: AdminActivationInventoryItem[];
}) {
  const categories = await getAllCategories("business");

  return (
    <div className="flex flex-col gap-8">
      <OptionKindSection activationId={activationId} kind="goal" items={options.filter((o) => o.kind === "goal")} />
      <OptionKindSection activationId={activationId} kind="family" items={options.filter((o) => o.kind === "family")} />
      <InventoryKindSection
        activationId={activationId}
        kind="space"
        items={inventory.filter((i) => i.kind === "space")}
        venues={venues}
        categories={categories}
      />
      <InventoryKindSection
        activationId={activationId}
        kind="timing"
        items={inventory.filter((i) => i.kind === "timing")}
        venues={venues}
        categories={categories}
      />
      <InventoryKindSection
        activationId={activationId}
        kind="addon"
        items={inventory.filter((i) => i.kind === "addon")}
        venues={venues}
        categories={categories}
      />
    </div>
  );
}

function OptionKindSection({
  activationId,
  kind,
  items,
}: {
  activationId: string;
  kind: ActivationOptionKind;
  items: AdminActivationOption[];
}) {
  const copy = OPTION_KIND_COPY[kind];
  const createOption = createActivationOption.bind(null, activationId, kind);

  return (
    <section>
      <p className="text-section-title font-semibold text-primary">{copy.title}</p>
      <p className="mt-0.5 text-metadata text-muted">{copy.hint}</p>

      <form action={createOption} className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border border-dashed border-black/15 bg-white p-3.5">
        <div className="min-w-[200px] flex-1">
          <TextField label={`New ${kind === "goal" ? "Goal" : "Family"} Label`} name="label" placeholder="e.g. Get my products in front of consumers" />
        </div>
        <button type="submit" className="h-11 shrink-0 rounded-2xl bg-findmi px-5 text-button font-bold uppercase text-white transition hover:bg-findmi-600">
          + Add
        </button>
      </form>

      <div className="mt-3 flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 px-4 py-5 text-center text-metadata text-subtle">Nothing added yet.</p>
        ) : (
          items.map((item, i) => {
            const saveOption = saveActivationOption.bind(null, activationId, item.id);
            const deleteOption = deleteActivationOption.bind(null, activationId, item.id);
            const moveUp = moveActivationOption.bind(null, activationId, kind, item.id, "up");
            const moveDown = moveActivationOption.bind(null, activationId, kind, item.id, "down");
            return (
              <form key={item.id} action={saveOption} className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-card-title font-semibold text-primary">{item.label}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="submit"
                      formAction={moveUp}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-black/10 text-metadata text-muted transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="submit"
                      formAction={moveDown}
                      disabled={i === items.length - 1}
                      aria-label="Move down"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-black/10 text-metadata text-muted transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>
                <TextField label="Label" name="label" defaultValue={item.label} required />
                <TextareaField label="Description" name="description" defaultValue={item.description} rows={2} />
                <ImageField label="Icon / Image" name="icon_or_image_url" defaultValue={item.icon_or_image_url} />
                <CheckboxField label="Active" name="is_active" defaultChecked={item.is_active} hint="Inactive options are hidden from the Builder." />
                <div className="flex items-center justify-between gap-3 border-t border-black/5 pt-3">
                  <button type="submit" formAction={deleteOption} className="text-metadata font-semibold text-red-600 hover:underline">
                    Delete
                  </button>
                  <button type="submit" className="rounded-2xl bg-findmi px-5 py-2 text-button font-bold uppercase text-white transition hover:bg-findmi-600">
                    Save
                  </button>
                </div>
              </form>
            );
          })
        )}
      </div>
    </section>
  );
}

function InventoryKindSection({
  activationId,
  kind,
  items,
  venues,
  categories,
}: {
  activationId: string;
  kind: ActivationInventoryKind;
  items: AdminActivationInventoryItem[];
  venues: AdminActivationVenue[];
  categories: { id: string; name: string }[];
}) {
  const copy = INVENTORY_KIND_COPY[kind];
  const createItem = createActivationInventoryItem.bind(null, activationId, kind);
  const venueOptions = [{ value: "", label: "Activation-wide (no specific venue)" }, ...venues.map((v) => ({ value: v.id, label: v.name || "Unnamed venue" }))];
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <section>
      <p className="text-section-title font-semibold text-primary">{copy.title}</p>
      <p className="mt-0.5 text-metadata text-muted">{copy.hint}</p>

      <form action={createItem} className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border border-dashed border-black/15 bg-white p-3.5">
        <div className="min-w-[200px] flex-1">
          <TextField label="New Item Name" name="name" placeholder="e.g. Window Feature" />
        </div>
        <button type="submit" className="h-11 shrink-0 rounded-2xl bg-findmi px-5 text-button font-bold uppercase text-white transition hover:bg-findmi-600">
          + Add
        </button>
      </form>

      <div className="mt-3 flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 px-4 py-5 text-center text-metadata text-subtle">Nothing added yet.</p>
        ) : (
          items.map((item, i) => {
            const saveItem = saveActivationInventoryItem.bind(null, activationId, item.id);
            const deleteItem = deleteActivationInventoryItem.bind(null, activationId, item.id);
            const moveUp = moveActivationInventoryItem.bind(null, activationId, kind, item.id, "up");
            const moveDown = moveActivationInventoryItem.bind(null, activationId, kind, item.id, "down");
            return (
              <form key={item.id} action={saveItem} className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-3.5 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-card-title font-semibold text-primary">{item.name}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="submit"
                      formAction={moveUp}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-black/10 text-metadata text-muted transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="submit"
                      formAction={moveDown}
                      disabled={i === items.length - 1}
                      aria-label="Move down"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-black/10 text-metadata text-muted transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>

                <TextField label="Name" name="name" defaultValue={item.name} required />
                <TextareaField label="Description" name="description" defaultValue={item.description} rows={2} />
                <ImageField label="Image" name="image_url" defaultValue={item.image_url} />
                <SelectField label="Venue Scope" name="venue_id" defaultValue={item.venue_id ?? ""} options={venueOptions} />
                <NumberField label="Capacity" name="capacity" defaultValue={item.capacity} step="1" hint="Leave blank for uncapacitated." />

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="Price Type" name="price_type" defaultValue={item.price_type} options={PRICE_TYPE_OPTIONS} />
                  <NumberField label="Price Amount" name="price_amount" defaultValue={item.price_amount} />
                  <TextField label="Price Label" name="price_label" defaultValue={item.price_label} hint="Custom public copy, e.g. &ldquo;Starting at $650&rdquo;." />
                  <SelectField
                    label="Price Visibility"
                    name="price_visibility"
                    defaultValue={item.price_visibility ?? ""}
                    options={PRICE_VISIBILITY_OPTIONS}
                  />
                </div>
                <NumberField
                  label="Internal Estimated Value"
                  name="internal_estimated_value"
                  defaultValue={item.internal_estimated_value}
                  hint="Admin-only — never shown publicly, regardless of Price Visibility."
                />

                <CheckboxList
                  label="Relevant Categories"
                  name="relevant_category_ids"
                  options={categoryOptions}
                  defaultSelected={item.relevant_category_ids ?? []}
                  emptyText="No business categories exist yet."
                />

                <TextareaField label="Requirements" name="requirements" defaultValue={item.requirements} rows={2} hint="Ops-facing only, e.g. &ldquo;requires power/refrigeration.&rdquo;" />
                <CheckboxField label="Active" name="is_active" defaultChecked={item.is_active} hint="Inactive items are hidden from the Builder." />

                <div className="flex items-center justify-between gap-3 border-t border-black/5 pt-3">
                  <button type="submit" formAction={deleteItem} className="text-metadata font-semibold text-red-600 hover:underline">
                    Delete
                  </button>
                  <button type="submit" className="rounded-2xl bg-findmi px-5 py-2 text-button font-bold uppercase text-white transition hover:bg-findmi-600">
                    Save
                  </button>
                </div>
              </form>
            );
          })
        )}
      </div>
    </section>
  );
}
