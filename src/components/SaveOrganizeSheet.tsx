"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { SaveOrganizeState } from "@/lib/useAccountSaved";
import { SAVE_CLASSIFICATIONS } from "@/lib/save-organization";
import type { Relationship } from "@/lib/discovery/relationships";
import CollectionPicker from "./CollectionPicker";

/** Save organization sheet — opens after a signed-in Save of a Product,
 * Event or Location (the Save already happened; closing keeps it). Each
 * option is an independent multi-select classification in the existing
 * user_entity_relationships (via /api/relationships), prefilled from what's
 * already set. Same bottom-sheet convention as the account switcher.
 * Rendered in a portal, and clicks never bubble to a parent card link. */
export default function SaveOrganizeSheet({ organize }: { organize: SaveOrganizeState | null }) {
  const open = Boolean(organize?.open);
  const [on, setOn] = useState<Set<Relationship>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = organize?.type;
  const id = organize?.id;
  const close = organize?.close;

  useEffect(() => {
    if (!open || !type || !id) return;
    let alive = true;
    setLoaded(false);
    setError(null);
    fetch(`/api/relationships?type=${type}&id=${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { relations?: string[] }) => {
        if (alive) setOn(new Set((d.relations ?? []) as Relationship[]));
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [open, type, id]);

  useEffect(() => {
    if (!open || !close) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !organize || typeof document === "undefined") return null;
  const options = SAVE_CLASSIFICATIONS[organize.type];

  async function toggle(relation: Relationship) {
    if (!organize) return;
    const next = !on.has(relation);
    const apply = (value: boolean) =>
      setOn((prev) => {
        const s = new Set(prev);
        if (value) s.add(relation);
        else s.delete(relation);
        return s;
      });
    apply(next);
    setError(null);
    try {
      const res = await fetch("/api/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: organize.type, entityId: organize.id, relation, on: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      apply(!next);
      setError("Couldn't update that. Please try again.");
    }
  }

  return createPortal(
    // Stop React's synthetic bubbling (portals bubble through the React
    // tree) so a Save on a card never also opens the card's link.
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="presentation" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={organize.close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Organize this save"
        className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl sm:rounded-3xl sm:pb-4"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
        <p className="font-display text-section-title font-semibold text-primary">Saved ✓</p>
        <p className="mt-0.5 text-metadata text-muted">Organize it if you like — optional.</p>
        {options.length > 0 && (
          <div className="mt-4">
            {/* Relationships — what it means to you. Independent of the Save
                (removing the Save keeps them; Have / Been are history). */}
            <p className="text-label font-semibold uppercase text-subtle">Mark As</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Mark as">
              {options.map((o) => {
                const active = on.has(o.relation);
                return (
                  <button
                    key={o.relation}
                    type="button"
                    aria-pressed={active}
                    disabled={!loaded}
                    onClick={() => toggle(o.relation)}
                    className={`h-10 rounded-full px-4 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-50 ${
                      active ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink hover:border-findmi"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-4">
          <CollectionPicker entityType={organize.type} entityId={organize.id} />
        </div>
        {error && (
          <p role="alert" className="mt-2 text-metadata text-red-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-metadata">
            <button type="button" onClick={organize.unsave} className="font-semibold text-muted hover:text-red-700">
              Remove From Saved
            </button>
            <Link href="/account/saved" className="font-semibold text-accent hover:underline">
              View Saved
            </Link>
          </div>
          <button type="button" onClick={organize.close} className="h-10 rounded-full bg-findmi px-5 text-sm font-semibold text-white">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
