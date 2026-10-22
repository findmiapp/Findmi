"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_SET_NAME_MAX, type ProductSet } from "@/lib/business-product-sets-domain";
import { createProductSetAction, deleteProductSetAction, duplicateProductSetAction, updateProductSetAction } from "../availability-actions";

const chipClass = (on: boolean) => `flex h-9 max-w-full items-center rounded-full px-3 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;
const inputClass = "min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none";

/** Product Sets for scale: create, rename, edit the Products, duplicate, delete —
 * and see at a glance how many Products each holds. A Set is a template only: applying
 * one stores the real Products on each place, so editing or deleting a Set here never
 * rewrites what any place already says. */
export default function ProductSetsPanel({ businessId, products, sets }: { businessId: string; products: { id: string; name: string }[]; sets: ProductSet[] }) {
  const router = useRouter();
  const names = new Map(products.map((p) => [p.id, p.name]));
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (id: string | "new", set?: ProductSet) => {
    setEditing(id);
    setName(set?.name ?? "");
    setPicked(set ? set.productIds.filter((p) => names.has(p)) : []);
    setError(null);
  };
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(result.error ?? "Couldn't do that. Please try again.");
      after?.();
      router.refresh();
    });

  const save = () =>
    act(
      () => (editing === "new" ? createProductSetAction(businessId, { name, productIds: picked }) : updateProductSetAction(businessId, editing as string, { name, productIds: picked })),
      () => setEditing(null)
    );

  return (
    <details className="group rounded-2xl border border-black/[0.06] bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-card-title font-semibold text-primary">
        <span>Product Sets <span className="font-normal text-muted">· {sets.length}</span></span>
        <span aria-hidden="true" className="text-muted transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-black/[0.06] px-4 py-3">
        <p className="text-metadata text-muted">Save a group of products once, then apply it to one place or many. Places keep their own copy, so changing a set later never rewrites them.</p>
        {sets.length > 0 && (
          <ul className="mt-3 flex flex-col divide-y divide-black/[0.06]">
            {sets.map((s) => {
              const live = s.productIds.filter((id) => names.has(id));
              const preview = live.slice(0, 3).map((id) => names.get(id)).join(", ");
              return (
                <li key={s.id} className="py-2.5">
                  {editing === s.id ? (
                    <SetEditor name={name} setName={setName} picked={picked} setPicked={setPicked} products={products} onSave={save} onCancel={() => setEditing(null)} pending={pending} />
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-primary">{s.name} <span className="font-normal text-muted">· {live.length} {live.length === 1 ? "Product" : "Products"}</span></p>
                        <p className="truncate text-metadata text-muted">{preview}{live.length > 3 ? ` +${live.length - 3} more` : ""}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-x-3 text-metadata font-semibold">
                        <button type="button" disabled={pending} onClick={() => open(s.id, s)} className="py-1 text-accent hover:underline disabled:opacity-50">Edit</button>
                        <button type="button" disabled={pending} onClick={() => act(() => duplicateProductSetAction(businessId, s.id))} className="py-1 text-accent hover:underline disabled:opacity-50">Duplicate</button>
                        <button type="button" disabled={pending} onClick={() => act(() => deleteProductSetAction(businessId, s.id))} className="py-1 text-muted hover:text-red-700 disabled:opacity-50">Delete</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {editing === "new" ? (
          <div className="mt-3">
            <SetEditor name={name} setName={setName} picked={picked} setPicked={setPicked} products={products} onSave={save} onCancel={() => setEditing(null)} pending={pending} />
          </div>
        ) : (
          <button type="button" disabled={products.length === 0} onClick={() => open("new")} className="mt-3 flex h-10 items-center rounded-full border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-findmi/40 disabled:opacity-50">
            New Product Set
          </button>
        )}
        {products.length === 0 && <p className="mt-2 text-metadata text-muted">Add products to your catalog to build a set.</p>}
        {error && <p role="alert" className="mt-2 text-metadata font-semibold text-red-700">{error}</p>}
      </div>
    </details>
  );
}

function SetEditor({
  name,
  setName,
  picked,
  setPicked,
  products,
  onSave,
  onCancel,
  pending,
}: {
  name: string;
  setName: (v: string) => void;
  picked: string[];
  setPicked: (fn: (p: string[]) => string[]) => void;
  products: { id: string; name: string }[];
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <input type="text" autoCapitalize="words" maxLength={PRODUCT_SET_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this set, e.g. Core Assortment" aria-label="Product Set name" className={inputClass} />
      <div role="group" aria-label="Products in this set" className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {products.map((p) => (
          <button key={p.id} type="button" aria-pressed={picked.includes(p.id)} onClick={() => setPicked((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))} className={chipClass(picked.includes(p.id))}>
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending || !name.trim() || picked.length === 0} onClick={onSave} className="h-10 rounded-full bg-findmi px-5 text-button font-bold text-white disabled:opacity-50">
          Save · {picked.length}
        </button>
        <button type="button" onClick={onCancel} className="h-10 px-3 text-metadata font-semibold text-muted">Cancel</button>
      </div>
    </div>
  );
}
