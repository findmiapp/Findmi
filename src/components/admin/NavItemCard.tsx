"use client";

import { useState } from "react";
import { CheckboxField, TextField } from "@/components/admin/Fields";
import {
  DESKTOP_NAV_MAX_ITEMS,
  NAV_AUDIENCES,
  NAV_ICON_KEYS,
  NAV_TOP_LABEL_MAX,
  type NavAudience,
  type NavDestinationType,
  type NavItem,
} from "@/lib/navigation";
import type { PublicRouteOption } from "@/lib/public-routes";

const selectClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none";

const iconButtonClass =
  "flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30";

const AUDIENCE_LABELS: Record<NavAudience, string> = {
  everyone: "Everyone",
  logged_out: "Signed out only",
  logged_in: "Signed in only",
};

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
  publicStatus = { reservedBy: null, hiddenGroup: false },
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
  /** How this row behaves in the public menu (lib/navigation
   * navRowPublicStatus). A reserved row is read-only here: its destination
   * belongs to a code-owned control and never renders in the public menu. */
  publicStatus?: { reservedBy: string | null; hiddenGroup: boolean };
}) {
  const reserved = Boolean(publicStatus.reservedBy);
  const [destinationType, setDestinationType] = useState<NavDestinationType>(item.destination_type);

  return (
    <div className={`rounded-2xl border p-4 ${reserved ? "border-amber-200 bg-amber-50/40" : "border-black/10 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-sm font-semibold tracking-tight text-ink">
          {item.label}
          {reserved && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Reserved</span>}
        </p>
        <div className={`flex shrink-0 gap-1.5 ${reserved ? "invisible" : ""}`}>
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

      {reserved && (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Not shown in the public menu — this destination is provided by {publicStatus.reservedBy}, which Findmi controls in code.
          Editing it here has no effect, so it&rsquo;s read-only. You can delete it.
        </p>
      )}
      {!reserved && publicStatus.hiddenGroup && (
        <p className="mt-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-xs text-ink/70">
          Not shown in the public menu — every item in this group is reserved for Findmi&rsquo;s account controls.
        </p>
      )}

      <form action={saveAction} className="mt-3 flex flex-col gap-3">
        <fieldset disabled={reserved} className="contents">
        <TextField
          label="Label"
          name="label"
          defaultValue={item.label}
          required
          hint={item.parent_id ? undefined : `Top-level labels: ${NAV_TOP_LABEL_MAX} characters max, so the desktop bar fits. Up to ${DESKTOP_NAV_MAX_ITEMS} top-level items show in the bar; more move into "More".`}
        />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Links To</span>
          <select
            name="destination_type"
            value={destinationType}
            onChange={(e) => setDestinationType(e.target.value as NavDestinationType)}
            className={selectClass}
          >
            <option value="route">An existing Findmi page</option>
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
            Nests this item under another as an expandable submenu, one level only.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Audience</span>
          <select name="audience" defaultValue={item.audience ?? "everyone"} className={selectClass}>
            {NAV_AUDIENCES.map((value) => (
              <option key={value} value={value}>
                {AUDIENCE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink/45">
            Who sees this item. A parent hidden for a viewer hides its children too, even if a child&rsquo;s own
            audience would otherwise show it to them.
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
          hint="Renders as a stronger Findmi teal call-to-action instead of a plain link."
        />

        </fieldset>
        {!reserved && (
          <button
            type="submit"
            className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Save
          </button>
        )}
      </form>

      <form action={deleteAction} className="mt-2">
        <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
          Delete
        </button>
      </form>
    </div>
  );
}
