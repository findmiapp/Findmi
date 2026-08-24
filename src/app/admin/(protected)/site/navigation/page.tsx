import Link from "next/link";
import NavItemCard from "@/components/admin/NavItemCard";
import { TextField } from "@/components/admin/Fields";
import { getAdminNavItems, type NavItem } from "@/lib/navigation";
import { PUBLIC_ROUTES } from "@/lib/public-routes";
import { createNavItem, deleteNavItem, moveNavItemDown, moveNavItemUp, saveNavItem } from "./actions";

export const dynamic = "force-dynamic";

export default async function NavigationAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const items = await getAdminNavItems();

  const topLevel = items.filter((i) => !i.parent_id);
  const childrenByParent = new Map<string, NavItem[]>();
  for (const item of items) {
    if (!item.parent_id) continue;
    const list = childrenByParent.get(item.parent_id) ?? [];
    list.push(item);
    childrenByParent.set(item.parent_id, list);
  }

  // Any OTHER top-level item can be a parent — a card excludes itself
  // from its own picker. Server-side validation (see actions.ts) is the
  // real enforcement of "one nesting level only"; this just keeps the
  // dropdown from offering an obviously-invalid choice.
  const parentOptionsFor = (itemId: string) =>
    topLevel.filter((t) => t.id !== itemId).map((t) => ({ id: t.id, label: t.label }));

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/site" className="hover:underline">
          Site Editor
        </Link>
        <span>/</span>
        <span>Navigation</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Navigation</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Control the menu behind FindMi&rsquo;s header menu button — add, rename, hide, reorder, or delete
        items without a code change. Nest an item under another (one level) to make an expandable
        submenu. Mark one item Highlight to make it stand out as a call-to-action.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {saved === "created" ? "New item added — edit it below to configure it." : "Saved."}
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Add a menu item</p>
        <form action={createNavItem} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField label="Label" name="label" placeholder="e.g. Discover" />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Add Item
          </button>
        </form>
      </div>

      {topLevel.length === 0 ? (
        <p className="mt-6 text-sm text-ink/45">
          No menu items yet — visitors see a safe default menu (Events, Brands, Marketplace, FindMi for
          Business, About, You) until you add at least one item here.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {topLevel.map((item, i) => {
            const children = childrenByParent.get(item.id) ?? [];
            return (
              <div key={item.id} className="flex flex-col gap-3">
                <NavItemCard
                  item={item}
                  routes={PUBLIC_ROUTES}
                  parentOptions={parentOptionsFor(item.id)}
                  saveAction={saveNavItem.bind(null, item.id)}
                  deleteAction={deleteNavItem.bind(null, item.id)}
                  moveUpAction={moveNavItemUp.bind(null, item.id)}
                  moveDownAction={moveNavItemDown.bind(null, item.id)}
                  canMoveUp={i > 0}
                  canMoveDown={i < topLevel.length - 1}
                />
                {children.length > 0 && (
                  <div className="ml-4 flex flex-col gap-3 border-l-2 border-black/5 pl-4 sm:ml-8">
                    {children.map((child, j) => (
                      <NavItemCard
                        key={child.id}
                        item={child}
                        routes={PUBLIC_ROUTES}
                        parentOptions={parentOptionsFor(child.id)}
                        saveAction={saveNavItem.bind(null, child.id)}
                        deleteAction={deleteNavItem.bind(null, child.id)}
                        moveUpAction={moveNavItemUp.bind(null, child.id)}
                        moveDownAction={moveNavItemDown.bind(null, child.id)}
                        canMoveUp={j > 0}
                        canMoveDown={j < children.length - 1}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
