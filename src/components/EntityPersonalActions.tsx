"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import RelationshipButton from "./discovery/RelationshipButton";
import CollectionPicker from "./CollectionPicker";
import { DoneButton, Sheet } from "./BottomSheet";
import type { CollectionEntityType } from "@/lib/collections-domain";
import { PERSONAL_RELATION_ACTIONS } from "@/lib/personal-model";

/** A detail page's personal actions (lib/personal-model.ts): the entity's
 * relationship toggles, then "Add to Collection" — the separate, optional
 * organizing layer. Never a generic Save. `leading` is the entity's own
 * dedicated control (Product Want lives in the CTA block; Business Follow
 * is passed in here). Signed out, every control asks to sign in. */
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
      {PERSONAL_RELATION_ACTIONS[entityType].map((a) => (
        <RelationshipButton key={a.relation} entityType={entityType} entityId={entityId} relation={a.relation} label={a.label} activeLabel={a.activeLabel} />
      ))}
      <AddToCollectionButton entityType={entityType} entityId={entityId} entityName={entityName} />
    </div>
  );
}

export function AddToCollectionButton({ entityType, entityId, entityName }: { entityType: CollectionEntityType; entityId: string; entityName: string }) {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/collections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { signedIn?: boolean }) => alive && setSignedIn(Boolean(d.signedIn)))
      .catch(() => alive && setSignedIn(false));
    return () => {
      alive = false;
    };
  }, []);

  function onClick() {
    if (signedIn === false) {
      window.location.href = `/login?next=${encodeURIComponent(pathname || "/")}`;
      return;
    }
    if (signedIn) setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-bold text-ink transition hover:border-findmi active:scale-[0.97]"
      >
        <span aria-hidden="true">+</span> Add to Collection
      </button>
      {open && (
        <Sheet label="Add to Collection" onClose={() => setOpen(false)}>
          <p className="text-base font-bold text-ink">Add to Collection</p>
          <p className="mt-0.5 truncate text-sm text-ink/60">{entityName}</p>
          <p className="mt-1 text-xs text-ink/45">Collections are just for organizing — they don&rsquo;t change anything else.</p>
          <div className="mt-4">
            <CollectionPicker entityType={entityType} entityId={entityId} />
          </div>
          <DoneButton onClose={() => setOpen(false)} />
        </Sheet>
      )}
    </>
  );
}
