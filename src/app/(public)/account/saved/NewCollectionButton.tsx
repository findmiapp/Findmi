"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COLLECTION_NAME_MAX } from "@/lib/collections-domain";

/** Create an empty Collection from Your Library. Organization only — it
 * never Wants, Saves or classifies anything. */
export default function NewCollectionButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name }) }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? "Couldn't create that Collection.");
      return;
    }
    setOpen(false);
    setName("");
    router.push(`/account/saved?list=${data.id}`);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-black/15 bg-white p-3 text-metadata font-semibold text-ink/65 transition hover:border-findmi hover:text-ink"
      >
        <span aria-hidden="true" className="text-lg leading-none">+</span>
        New Collection
      </button>
    );
  }
  return (
    <form onSubmit={create} className="col-span-2 flex flex-col gap-2 rounded-2xl border border-black/10 bg-white p-3 sm:col-span-3">
      <label htmlFor="new-collection-name" className="text-metadata font-semibold text-ink">
        Name your Collection
      </label>
      <input
        id="new-collection-name"
        autoFocus
        autoCapitalize="words"
        value={name}
        maxLength={COLLECTION_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        placeholder="Holiday gifts, Weekend ideas…"
        className="h-10 w-full rounded-xl border border-black/10 px-3 text-sm outline-none focus:border-findmi"
      />
      {error && <p className="text-metadata text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className="h-9 flex-1 rounded-full bg-findmi text-sm font-semibold text-white disabled:opacity-50">
          Create
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-full border border-black/10 px-4 text-sm font-semibold text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
