import { CheckboxField, NumberField, TextField, TextareaField } from "@/components/admin/Fields";
import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import type { MarketArea } from "@/lib/types";
import { saveMarketArea } from "./actions";

/** Market -> Area Admin Management Completion pass — founder-facing
 * create/edit form for the EXISTING `market_areas` table, mirroring
 * MarketForm's own field shape/conventions exactly (same Active / Show
 * in consumer Area picker split, same NameSlugFields slug-safety
 * discipline, same Display Order convention). market_id is fixed to the
 * Market this form was opened from — never a field the admin fills in.
 * No delete action: see saveMarketArea's own doc comment on why. */
export default function AreaForm({
  marketId,
  marketName,
  area,
  error,
}: {
  marketId: string;
  marketName: string;
  area: MarketArea | null;
  error?: string;
}) {
  const action = saveMarketArea.bind(null, marketId, area?.id ?? null);
  const cancelHref = `/admin/markets/${marketId}`;

  return (
    <form action={action} className="flex flex-col gap-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <p className="text-xs text-ink/45">
        Area of <span className="font-semibold text-ink/70">{marketName}</span>
      </p>

      <CheckboxField
        label="Active"
        name="active"
        defaultChecked={area ? area.active : true}
        hint="Off = this Area is not offered for new business/event assignment. Existing assignments referencing it are never touched or removed."
      />

      <CheckboxField
        label="Show in consumer Area picker"
        name="consumer_visible"
        defaultChecked={area ? area.consumer_visible : true}
        hint="When off, this Area can still be assigned internally but will not appear in consumer Area discovery (homepage, /businesses, /events, /find)."
      />

      <NameSlugFields
        isNew={!area}
        nameLabel="Area Name"
        defaultName={area?.name}
        defaultSlug={area?.slug}
        slugHint="Used in ?area= URLs across the site. Changing the slug changes Area-filter URLs — any link or bookmark using the old slug will stop resolving to this Area."
      />

      <TextField
        label="Consumer Display Name"
        name="display_name"
        defaultValue={area?.display_name ?? undefined}
        placeholder={area?.name || "Falls back to the Area Name above"}
        hint="Shown to consumers as the Area name. Leave blank to use the Area Name as-is."
      />

      <TextareaField
        label="Aliases"
        name="aliases"
        defaultValue={area?.aliases?.join("\n") ?? undefined}
        rows={3}
        hint="One alternate spelling/name per line (e.g. 'Bed-Stuy', 'BedStuy' for Bedford-Stuyvesant) — used only to suggest a match when resolving a Market Request, never shown to consumers."
      />

      <NumberField
        label="Display Order"
        name="sort_order"
        defaultValue={area?.sort_order ?? 0}
        step="1"
        hint="Lower numbers show first in the consumer Area picker and in this Market's Area list below."
      />

      <SubmitBar cancelHref={cancelHref} showAddAnother={!area} />
    </form>
  );
}
