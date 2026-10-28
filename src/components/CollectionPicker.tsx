"use client";

import { useEffect, useState } from "react";
import type { CollectionEntityType, CollectionSummary } from "@/lib/collections-domain";
import { COLLECTION_NAME_MAX } from "@/lib/collections-domain";

/** Personal Library — "Organize it": put one entity into any of the
 * person's Collections, or a new one. Optional and independent: toggling a
 * Collection never Wants, Saves or classifies anything. Reused by the
 * post-Want sheet and the Save sheet (any entity type). Renders nothing
 * when Collections aren't available (signed out, or not set up yet). */
export default function CollectionPicker({ entityType, entityId }: { entityType: CollectionEntityType; entityId: string }) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/collections?entityType=${entityType}&entityId=${entityId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { available?: boolean; collections?: CollectionSummary[] }) => {
        if (!alive) return;
        setAvailable(Boolean(d.available));
        setCollections(d.collections ?? []);
      })
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, [entityType, entityId]);

  if (!available) return null;

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    return { ok: res.ok, data };
  }

  async function toggle(c: CollectionSummary) {
    const next = !c.contains;
    const apply = (contains: boolean) => setCollections((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, contains, itemCount: x.itemCount + (contains ? 1 : -1) } : x)));
    apply(next);
    setError(null);
    const { ok } = await post({ action: next ? "add" : "remove", collectionId: c.id, entityType, entityId });
    if (!ok) {
      apply(!next);
      setError("Couldn't update that Collection. Please try again.");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ action: "create", name, entityType, entityId });
    setBusy(false);
    if (!ok || !data?.id) {
      setError(data?.error ?? "Couldn't create that Collection.");
      return;
    }
    setCollections((prev) => [{ id: data.id!, name: name.replace(/\s+/g, " ").trim(), itemCount: 1, contains: true }, ...(prev ?? [])]);
    setName("");
    setCreating(false);
  }

  return (
    <div>
      <p className="text-label font-semibold uppercase text-subtle">Collections</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Collections">
        {(collections ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.contains}
            onClick={() => toggle(c)}
            className={`h-9 max-w-full truncate rounded-full px-3.5 text-sm font-semibold transition active:scale-[0.97] ${
              c.contains ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink hover:border-findmi"
            }`}
          >
            {c.name}
          </button>
        ))}
        {!creating && collections !== null && (
          <button type="button" onClick={() => setCreating(true)} className="h-9 rounded-full border border-dashed border-findmi/50 px-3.5 text-sm font-semibold text-findmi-700 hover:bg-findmi-50">
            + New Collection
          </button>
        )}
      </div>
      {creating && (
        <form onSubmit={create} className="mt-2 flex gap-2">
          <input
            type="text"
            autoFocus
            autoCapitalize="words"
            maxLength={COLLECTION_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Christmas Gifts"
            aria-label="New Collection name"
            className="h-10 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-base text-ink placeholder:text-ink/35 focus:border-findmi focus:outline-none"
          />
          <button type="submit" disabled={busy || !name.trim()} className="h-10 shrink-0 rounded-xl bg-findmi px-4 text-sm font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-metadata text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
