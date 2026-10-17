"use client";

import { useState } from "react";
import Image from "next/image";
import { EntitySearchAdd } from "@/components/admin/RelationPicker";
import type { PostedByOption } from "@/lib/moment-author";
import type { MomentPostedByInitial } from "@/lib/moment-composer";

/** Identity V1 — "Posted By": the Moment's PUBLIC author. Options are built
 * on the server (Personal + Businesses the viewer owns/manages; Admin may
 * search any Business). The server re-checks every choice on save. */
export default function MomentPostedBy({
  postedBy,
  value,
  onChange,
}: {
  postedBy: MomentPostedByInitial;
  value: string | null;
  onChange: (businessId: string | null) => void;
}) {
  const [options, setOptions] = useState<PostedByOption[]>(postedBy.options);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-display text-base font-bold tracking-tight text-ink">Posted By</span>
      <div role="radiogroup" aria-label="Posted By" className="flex flex-col gap-1.5">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value ?? "personal"}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                selected ? "border-findmi/50 bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-ink hover:border-black/20"
              }`}
            >
              {o.imageUrl ? (
                <Image
                  src={o.imageUrl}
                  alt=""
                  width={24}
                  height={24}
                  unoptimized
                  className={`h-6 w-6 shrink-0 ${o.kind === "business" ? "rounded-md border border-black/5 bg-white object-contain" : "rounded-full object-cover"}`}
                />
              ) : (
                <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[11px] font-bold text-ink/50">
                  {o.label.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.kind === "person" && <span className="shrink-0 text-xs font-medium text-ink/45">Personal</span>}
            </button>
          );
        })}
      </div>
      {postedBy.adminSearch && (
        <EntitySearchAdd
          entity="businesses"
          placeholder="Post as another Business…"
          excludeIds={new Set(options.map((o) => o.value).filter((v): v is string => Boolean(v)))}
          onAdd={(r) => {
            setOptions((prev) => [...prev, { value: r.value, label: r.label, imageUrl: r.image_url ?? null, kind: "business" }]);
            onChange(r.value);
          }}
        />
      )}
    </div>
  );
}
