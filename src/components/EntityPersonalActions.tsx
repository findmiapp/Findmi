"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import CollectionPicker from "./CollectionPicker";
import { DoneButton, Sheet } from "./BottomSheet";
import { COLLECTION_NAME_MAX, type CollectionEntityType } from "@/lib/collections-domain";
import type { Relationship } from "@/lib/discovery/relationships";
import { PERSONAL_LISTS } from "@/lib/personal-model";
import {
  createGuestCollection,
  dismissGuestReminder,
  guestCollectionsContaining,
  guestRelationsFor,
  readGuestLibrary,
  setGuestCollectionItem,
  setGuestRelation,
  shouldShowGuestReminder,
  subscribeGuestLibrary,
  writeGuestLibrary,
  type GuestEntity,
  type GuestLibrary,
} from "@/lib/guest-library";

/** A detail page's personal actions (lib/personal-model.ts): the entity's
 * own dedicated control (`leading`: Business Follow; Product Want lives in
 * the CTA block), then ONE "Add to Collection" — its sheet holds the
 * type's built-in lists (Want To Go, Must Do, Been Here…, the existing
 * relationships) and the visitor's own Collections. No separate status
 * buttons. Works signed out too: saves stay on this device until an
 * account is created (lib/guest-library.ts). */
export default function EntityPersonalActions({
  entityType,
  entityId,
  entityName,
  leading,
}: {
  entityType: CollectionEntityType;
  entityId: string;
  entityName: string;
  leading?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {leading}
      <AddToCollectionButton entityType={entityType} entityId={entityId} entityName={entityName} />
    </div>
  );
}

type Auth = { signedIn: boolean; relations: Set<Relationship>; inCollection: boolean } | null;

export function AddToCollectionButton({ entityType, entityId, entityName, entityHref }: { entityType: CollectionEntityType; entityId: string; entityName: string; entityHref?: string }) {
  const pathname = usePathname();
  const [auth, setAuth] = useState<Auth>(null);
  const [open, setOpen] = useState(false);
  const [guest, setGuest] = useState<{ lib: GuestLibrary; persistent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lists = PERSONAL_LISTS[entityType];
  const entity: GuestEntity = { type: entityType, id: entityId, name: entityName, href: entityHref ?? pathname ?? null };

  // Who's here: an account (its lists + Collections) or a guest (this device).
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/collections?entityType=${entityType}&entityId=${entityId}`, { cache: "no-store" }).then((r) => r.json()),
      lists.length ? fetch(`/api/relationships?type=${entityType}&id=${entityId}`, { cache: "no-store" }).then((r) => r.json()) : Promise.resolve({ relations: [] }),
    ])
      .then(([c, r]: [{ signedIn?: boolean; collections?: { contains: boolean }[] }, { relations?: string[] }]) => {
        if (!alive) return;
        const relations = new Set(((r.relations ?? []) as Relationship[]).filter((x) => lists.some((l) => l.relation === x)));
        setAuth({ signedIn: Boolean(c.signedIn), relations, inCollection: (c.collections ?? []).some((x) => x.contains) });
      })
      .catch(() => alive && setAuth({ signedIn: false, relations: new Set(), inCollection: false }));
    return () => {
      alive = false;
    };
  }, [entityType, entityId, lists]);

  const signedIn = auth?.signedIn === true;
  const guestMode = auth !== null && !signedIn;
  useEffect(() => {
    if (!guestMode) return;
    const read = () => setGuest(readGuestLibrary());
    read();
    return subscribeGuestLibrary(read);
  }, [guestMode]);

  // Guest edits: validated, stored on this device (or kept in memory when
  // the browser won't store anything) — never a sign-in wall.
  const saveGuest = useCallback((next: GuestLibrary) => {
    const persistent = writeGuestLibrary(next);
    setGuest({ lib: next, persistent });
  }, []);

  const guestRelations = guest ? guestRelationsFor(guest.lib, entity) : new Set<Relationship>();
  const guestIn = guest ? guestCollectionsContaining(guest.lib, entity) : new Set<string>();
  const saved = signedIn ? auth!.relations.size > 0 || auth!.inCollection : guestRelations.size > 0 || guestIn.size > 0;

  async function toggleList(relation: Relationship) {
    setError(null);
    if (!signedIn) {
      if (!guest) return;
      saveGuest(setGuestRelation(guest.lib, entity, relation, !guestRelations.has(relation)));
      return;
    }
    const on = !auth!.relations.has(relation);
    const apply = (value: boolean) =>
      setAuth((prev) => {
        if (!prev) return prev;
        const s = new Set(prev.relations);
        if (value) s.add(relation);
        else s.delete(relation);
        return { ...prev, relations: s };
      });
    apply(on);
    const res = await fetch("/api/relationships", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, entityId, relation, on }) }).catch(() => null);
    if (!res?.ok) {
      apply(!on);
      setError("Couldn't update that. Please try again.");
    }
  }

  const active = (relation: Relationship) => (signedIn ? auth!.relations.has(relation) : guestRelations.has(relation));

  return (
    <>
      <button
        type="button"
        onClick={() => auth && setOpen(true)}
        aria-haspopup="dialog"
        data-add-to-collection
        className={`inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-bold transition active:scale-[0.97] ${saved ? "border-findmi bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-ink hover:border-findmi"}`}
      >
        <span aria-hidden="true">{saved ? "✓" : "+"}</span> {saved ? "In Your Collections" : "Add to Collection"}
      </button>
      {open && (
        <Sheet label="Add to Collection" onClose={() => setOpen(false)}>
          <p className="text-base font-bold text-ink">Add to Collection</p>
          <p className="mt-0.5 truncate text-sm text-ink/60">{entityName}</p>
          {guestMode && guest && !guest.persistent && (
            <p role="status" className="mt-3 rounded-xl bg-black/[0.04] px-3 py-2 text-xs text-ink/70">
              This browser isn&rsquo;t keeping saves (private browsing, or storage is off). They&rsquo;ll last for this visit — create a free account to keep them.
            </p>
          )}
          {lists.length > 0 && (
            <div className="mt-4">
              <p className="text-label font-semibold uppercase text-subtle">Your Lists</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Your Lists">
                {lists.map((l) => (
                  <button
                    key={l.relation}
                    type="button"
                    aria-pressed={active(l.relation)}
                    onClick={() => toggleList(l.relation)}
                    className={`h-9 rounded-full px-3.5 text-sm font-semibold transition active:scale-[0.97] ${active(l.relation) ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink hover:border-findmi"}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4">
            {signedIn ? (
              <CollectionPicker entityType={entityType} entityId={entityId} />
            ) : guest ? (
              <GuestCollectionPicker lib={guest.lib} entity={entity} contains={guestIn} onChange={saveGuest} />
            ) : null}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-metadata text-red-700">
              {error}
            </p>
          )}
          {guestMode && guest && (
            <>
              <p className="mt-3 text-xs text-ink/45">Saved on this device. Collections are just for organizing — they don&rsquo;t change anything else.</p>
              {shouldShowGuestReminder(guest.lib) && (
                <div role="status" data-guest-reminder className="mt-3 rounded-2xl border border-findmi/25 bg-findmi-50 p-3">
                  <p className="text-sm font-semibold text-findmi-700">Keep your collections safe</p>
                  <p className="mt-0.5 text-xs text-ink/65">They&rsquo;re only on this device right now. A free account protects them if you clear your browser or switch phones.</p>
                  <div className="mt-2 flex gap-2">
                    <a href={`/signup?next=${encodeURIComponent(pathname || "/")}`} className="inline-flex min-h-9 items-center rounded-full bg-findmi px-3.5 text-xs font-bold text-white">
                      Create Free Account
                    </a>
                    <button type="button" onClick={() => saveGuest(dismissGuestReminder(guest.lib))} className="inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold text-ink/60 hover:text-ink">
                      Not Now
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <DoneButton onClose={() => setOpen(false)} />
        </Sheet>
      )}
    </>
  );
}

/** Guest Collections on this device: toggle membership or start a new one. */
function GuestCollectionPicker({ lib, entity, contains, onChange }: { lib: GuestLibrary; entity: GuestEntity; contains: Set<string>; onChange: (next: GuestLibrary) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    const r = createGuestCollection(lib, name, entity);
    if (!r.ok) {
      setError(r.error === "duplicate" ? "You already have a Collection with that name." : r.error === "limit" ? "That's the most Collections this device can hold." : "Give your Collection a name (up to 60 characters).");
      return;
    }
    setError(null);
    onChange(r.lib);
    setName("");
    setCreating(false);
  }

  return (
    <div>
      <p className="text-label font-semibold uppercase text-subtle">Collections</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Collections">
        {lib.collections.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={contains.has(c.key)}
            onClick={() => onChange(setGuestCollectionItem(lib, c.key, entity, !contains.has(c.key)))}
            className={`h-9 max-w-full truncate rounded-full px-3.5 text-sm font-semibold transition active:scale-[0.97] ${contains.has(c.key) ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink hover:border-findmi"}`}
          >
            {c.name}
          </button>
        ))}
        {!creating && (
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
          <button type="submit" disabled={!name.trim()} className="h-10 shrink-0 rounded-xl bg-findmi px-4 text-sm font-semibold text-white disabled:opacity-50">
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
