import { CheckboxField, NumberField, TextField, TextareaField } from "@/components/admin/Fields";
import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import type { Market } from "@/lib/types";
import { saveMarket } from "./actions";

/** Market Management V1 — founder-facing create/edit form for the
 * existing `markets` table (reused as-is; see the migration). No delete
 * action: a Market referenced by businesses/events/occurrences/locations
 * must never be hard-deleted (per this pass's own instruction) —
 * "Active" is the only archival control, same posture Categories already
 * uses (deactivate, never delete a referenced taxonomy row). */
export default function MarketForm({ market, error }: { market: Market | null; error?: string }) {
  const action = saveMarket.bind(null, market?.id ?? null);

  return (
    <form action={action} className="flex flex-col gap-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <CheckboxField
        label="Active"
        name="active"
        defaultChecked={market ? market.active : true}
        hint="Off = hidden from every active-Market picker (consumer Area selectors, admin Location/Event/Business Market pickers) — existing assignments referencing this Market are never touched or removed."
      />

      {/* Consumer Area Picker + Market Requests V1 — a SEPARATE toggle
          from Active above: a Market can be valid/assignable internally
          (business/event creation, admin pickers) while NOT yet showing
          in the consumer Area picker. Lets supply exist before a public
          Area "launch". */}
      <CheckboxField
        label="Show in consumer Area picker"
        name="consumer_visible"
        defaultChecked={market ? market.consumer_visible !== false : true}
        hint="When off, this Market can still be used internally (business/event/location assignment) but will not appear in consumer Area discovery (homepage, /businesses, /events)."
      />

      <NameSlugFields
        isNew={!market}
        nameLabel="Internal / Admin Name"
        defaultName={market?.name}
        defaultSlug={market?.slug}
        slugHint="Used in ?market= URLs across the site. Changing the slug changes Market-filter URLs — any link or bookmark using the old slug will stop resolving to this Market."
      />

      <TextField
        label="Consumer Display Name"
        name="display_name"
        defaultValue={market?.display_name ?? undefined}
        placeholder={market?.name || "Falls back to the Internal / Admin Name above"}
        hint="Shown to consumers as the Area name (homepage, /businesses, /events selectors). Leave blank to use the Internal / Admin Name as-is."
      />

      <TextareaField
        label="Description (admin-facing)"
        name="description"
        defaultValue={market?.description ?? undefined}
        rows={2}
        hint="Short internal note about what this Market covers. Not shown to consumers."
      />

      <TextareaField
        label="Areas Included"
        name="areas_included"
        defaultValue={market?.areas_included?.join("\n") ?? undefined}
        rows={5}
        hint="One area per line — informational only (e.g. Staten Island, Brooklyn, Manhattan, Queens, Bronx). Never creates business/event assignments, never affects discovery matching or filtering."
      />

      <NumberField
        label="Display Order"
        name="sort_order"
        defaultValue={market?.sort_order ?? 0}
        step="1"
        hint="Lower numbers show first in every consumer Area selector and admin Market list."
      />

      <SubmitBar cancelHref="/admin/markets" showAddAnother={!market} />
    </form>
  );
}
