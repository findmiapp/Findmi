"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Delete one of the person's Collections. Deleting a Collection removes
 * only the organization — every Want, relationship and Save stays. */
export default function CollectionActions({ collectionId, name }: { collectionId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Delete the Collection "${name}"? The items themselves, and everything you Want, Follow or have marked, stay in Your Library.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", collectionId }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("Couldn't delete it.");
      return;
    }
    router.push("/account/saved");
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && <span className="text-metadata text-red-700">{error}</span>}
      <button type="button" onClick={remove} disabled={busy} className="text-metadata font-semibold text-muted hover:text-red-700 disabled:opacity-50">
        Delete Collection
      </button>
    </div>
  );
}
