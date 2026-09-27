"use client";

import DeleteButton from "@/components/admin/DeleteButton";
import { deleteProduct } from "./actions";
import { bulkArchiveProducts, bulkRestoreFromArchive, bulkRestoreFromTrash, bulkTrashProducts } from "./lifecycle-actions";

/** Admin Content Lifecycle + Bulk Management V1 — single-record lifecycle
 * controls on the product edit page, reusing the exact same bulk server
 * actions (bound to this one id) rather than a parallel single-record
 * implementation. Permanent Delete (the pre-existing deleteProduct
 * action) is now gated to Trashed products only — "must NOT be exposed
 * as a casual action in Active lists" — enforced here by only rendering
 * it when trashedAt is set; the list-page bulk bar applies the same rule
 * independently. */
export default function ProductLifecycleButtons({
  productId,
  productName,
  archivedAt,
  trashedAt,
}: {
  productId: string;
  productName: string;
  archivedAt: string | null;
  trashedAt: string | null;
}) {
  const withId = (fn: (fd: FormData) => void | Promise<void>) => async (fd: FormData) => {
    fd.set("ids", productId);
    await fn(fd);
  };

  if (trashedAt) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <form action={withId(bulkRestoreFromTrash)}>
          <button
            type="submit"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600"
          >
            Restore from Trash
          </button>
        </form>
        <DeleteButton
          action={deleteProduct.bind(null, productId)}
          confirmMessage={`Permanently delete "${productName}"?\n\nThis cannot be undone. This is only available because the product is in Trash.`}
          label="Delete Permanently"
        />
      </div>
    );
  }

  if (archivedAt) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <form action={withId(bulkRestoreFromArchive)}>
          <button
            type="submit"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600"
          >
            Restore from Archive
          </button>
        </form>
        <form
          action={withId(bulkTrashProducts)}
          onSubmit={(e) => {
            if (!confirm(`Move "${productName}" to Trash? It'll be hidden everywhere until restored.`)) e.preventDefault();
          }}
        >
          <button
            type="submit"
            className="rounded-full border border-red-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-50"
          >
            Move to Trash
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={withId(bulkArchiveProducts)}>
        <button
          type="submit"
          className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/70 hover:border-black/25"
        >
          Archive
        </button>
      </form>
      <form
        action={withId(bulkTrashProducts)}
        onSubmit={(e) => {
          if (!confirm(`Move "${productName}" to Trash? It'll be hidden everywhere until restored.`)) e.preventDefault();
        }}
      >
        <button
          type="submit"
          className="rounded-full border border-red-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-50"
        >
          Move to Trash
        </button>
      </form>
    </div>
  );
}
