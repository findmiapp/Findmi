"use client";

import Link from "next/link";
import MomentDisplayControl from "./MomentDisplayControl";
import { setEntityMomentDisplayAction } from "@/app/(public)/account/entity-moment-actions";
import type { EntityMoment, EntityMomentKind } from "@/lib/entity-moments";

const dateLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function EntityMomentRow({ kind, entityId, moment, canManage }: { kind: EntityMomentKind; entityId: string; moment: EntityMoment; canManage: boolean }) {
  return (
    <li className="py-3">
      <Link href={`/journal/${moment.id}`} className="block truncate text-sm font-semibold text-ink hover:underline">
        {moment.title}
      </Link>
      <span className="block truncate text-xs text-ink/55">
        {dateLabel(moment.entryDate)}
        {moment.authorLabel ? ` · By ${moment.authorLabel}` : ""}
      </span>
      {canManage ? (
        <MomentDisplayControl initial={moment.display} noun="Page" action={(display) => setEntityMomentDisplayAction(kind, entityId, moment.id, display)} />
      ) : (
        <span className="mt-1 block text-[11px] font-semibold text-ink/45">{moment.display === "hidden" ? "Hidden from this page" : moment.display === "featured" ? "Featured on this page" : "On this page"}</span>
      )}
    </li>
  );
}
