"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics/track";
import type { Relationship, RelationshipEntityType } from "@/lib/discovery/relationships";

/** One explicit Personal statement ("Must Do", "Been", "Want", "Have",
 * "Like") about an entity. Account-only: a signed-out tap goes to sign in
 * and comes back. Optimistic, reverted on failure. */
export default function RelationshipButton({
  entityType,
  entityId,
  relation,
  label,
  activeLabel,
}: {
  entityType: RelationshipEntityType;
  entityId: string;
  relation: Relationship;
  label: string;
  activeLabel?: string;
}) {
  const pathname = usePathname();
  const [on, setOn] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/relationships?type=${entityType}&id=${entityId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { signedIn?: boolean; relations?: string[] }) => {
        if (!alive) return;
        setSignedIn(Boolean(d.signedIn));
        setOn(Boolean(d.relations?.includes(relation)));
      })
      .catch(() => alive && setSignedIn(false));
    return () => {
      alive = false;
    };
  }, [entityType, entityId, relation]);

  async function toggle() {
    if (signedIn === false) {
      window.location.href = `/login?next=${encodeURIComponent(pathname || "/")}`;
      return;
    }
    if (busy || signedIn === null) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch("/api/relationships", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, entityId, relation, on: next }) });
      if (!res.ok) throw new Error();
      trackEvent({
        event_name: next ? "relationship_set" : "relationship_unset",
        subject_type: entityType,
        ...(entityType === "area" ? { market_area_id: entityId } : entityType === "topic" ? { discovery_topic_id: entityId } : { subject_id: entityId }),
        metadata: { relation },
      });
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition active:scale-[0.97] ${on ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink hover:border-findmi"}`}
    >
      {on ? (activeLabel ?? label) : label}
    </button>
  );
}
