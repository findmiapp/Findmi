"use client";

import { useState } from "react";
import { CheckboxField, TextField } from "@/components/admin/Fields";
import { NAV_ICON_KEYS, type NavDestinationType, type NavItem } from "@/lib/navigation";
import type { PublicRouteOption } from "@/lib/public-routes";

const selectClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none";

const iconButtonClass =
  "flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30";

const ICON_LABELS: Record<string, string> = {
  compass: "Compass",
  pin: "Pin",
  target: "Target",
  bookmark: "Bookmark",
  person: "Person",
  tag: "Tag",
  calendar: "Calendar",
  storefront: "Storefront",
  home: "Home",
  cart: "Cart",
};

/** One Menu Item's founder-facing editor card — same card/form/Move-Up-
 * Down/Delete pattern as HomepageRowCard, so the two admin screens feel
 * like one system. Destination Type is client-side so the right input
 * (route picker vs custom link field) shows immediately. Leaving the
 * destination blank (the "No page selected" option, or an empty custom
 * link) is intentional, not an error — that's how a parent-only header
 * row (Part 6 of the 2026 QA pass) is made; it just expands its children
 * instead of navigating anywhere. */
export default function NavItemCard({
  item,
  routes,
  parentOptions,
  saveAction,
  deleteAction,
  moveUpAction,
  moveDownAction,
  canMoveUp,
  canMoveDown,
}: {
  item: NavItem;
  routes: PublicRouteOption[];
  /** Other top-level items this one could be nested under — already
   * excludes itself and anything that already has a parent (one nesting
   * level only), computed server-side in page.tsx. */
  parentOptions: { id: string; label: string }[];
  saveAction: (formData: FormData) => void;
  deleteAction: () => void;
  moveUpAction: () => void;
  moveDownAction: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [destinationType, setDestinationType] = useState<NavDestinationType>(item.destination_type);

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-sm font-semibold tracking-tight text-ink">{item.label}</p>
        <div className="flex shrink-0 gap-1.5">
          <form action={moveUpAction}>
            <button type="submit" disabled={!canMoveUp} className={iconButtonClass} aria-label="Move up">
              ↑
            </button>
          </form>
          <form action={moveDownAction}>
            <button type="submit" disabled={!canMoveDown} className={iconButtonClass} aria-label="Move down">
              ↓
            </button>
          </form>
        </div>
      </div>

      <form action={saveAction} className="mt-3 flex flex-col gap-3">
        <TextField label="Label" name="label" defaultValue={item.label} required />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Links To</span>
          <select
            name="destination_type"
            value={destinationType}
            onChange={(e) => setDestinationType(e.target.value as NavDestinationType)}
            className={selectClass}
          >
            <option value="route">An existing FindMi page</option>
            <option value="custom">A custom link</option>
          </select>
        </label>

        {destinationType === "route" ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Page</span>
            <select name="route_key" defaultValue={item.route_key ?? ""} className={selectClass}>
              <option value="">No page selected (use as a parent header)</option>
              {routes.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <TextField
            label="Link"
            name="custom_href"
            defaultValue={item.custom_href}
            placeholder="/some-path or https://example.com — leave blank for a parent header"
            hint="Internal path starting with / or a link starting with https://."
          />
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Parent Item</span>
          <select name="parent_id" defaultValue={item.parent_id ?? ""} className={selectClass}>
            <option value="">None (top-level)</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink/45">
            Nests this item under another as an expandable submenu — one level only.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Icon (optional)</span>
          <select name="icon_key" defaultValue={item.icon_key ?? ""} className={selectClass}>
            <option value="">No icon</option>
            {NAV_ICON_KEYS.map((key) => (
              <option key={key} value={key}>
                {ICON_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <CheckboxField label="Visible" name="is_visible" defaultChecked={item.is_visible} />
        <CheckboxField
          label="Highlight"
          name="is_highlight"
          defaultChecked={item.is_highlight}
          hint="Renders as a stronger FindMi teal call-to-action instead of a plain link."
        />

        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>

      <form action={deleteAction} className="mt-2">
        <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
          Delete
        </button>
      </form>
    </div>
  );
}
