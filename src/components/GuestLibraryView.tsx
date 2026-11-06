"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PERSONAL_LISTS } from "@/lib/personal-model";
import { isGuestLibraryEmpty, readGuestLibrary, subscribeGuestLibrary, type GuestEntity, type GuestLibrary } from "@/lib/guest-library";

const TYPE_LABEL: Record<GuestEntity["type"], string> = { event: "Event", location: "Place", business: "Brand", product: "Product" };

/** Signed-out /saved: the lists and Collections kept on this device
 * (lib/guest-library.ts), each item linking back to its page. */
export default function GuestLibraryView({ onState }: { onState?: (hasItems: boolean) => void }) {
  const [lib, setLib] = useState<GuestLibrary | null>(null);

  useEffect(() => {
    const read = () => setLib(readGuestLibrary().lib);
    read();
    return subscribeGuestLibrary(read);
  }, []);
  useEffect(() => {
    if (lib) onState?.(!isGuestLibraryEmpty(lib));
  }, [lib, onState]);

  if (!lib || isGuestLibraryEmpty(lib)) return null;

  // Built-in lists, labelled per type ("Want To Go", "Been Here"…).
  const lists = new Map<string, GuestEntity[]>();
  for (const r of lib.relations) {
    const label = PERSONAL_LISTS[r.type].find((l) => l.relation === r.relation)?.label;
    if (!label) continue;
    lists.set(label, [...(lists.get(label) ?? []), r]);
  }

  return (
    <section data-guest-library className="mt-8">
      <div className="rounded-2xl border border-findmi/25 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
        Your lists and Collections are saved on this device.{" "}
        <Link href="/signup?next=/account/saved" className="font-semibold underline underline-offset-2">
          Create a free account
        </Link>{" "}
        to keep them safe.
      </div>
      {[...lists].map(([label, items]) => (
        <Group key={label} title={label} items={items} />
      ))}
      {lib.collections.map((c) => (
        <Group key={c.key} title={c.name} items={c.items} empty="Nothing in this Collection yet." />
      ))}
    </section>
  );
}

function Group({ title, items, empty }: { title: string; items: GuestEntity[]; empty?: string }) {
  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink/50">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-black/5 rounded-2xl border border-black/5 bg-white">
          {items.map((i) => (
            <li key={`${i.type}:${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
              {i.href ? (
                <Link href={i.href} className="min-w-0 truncate text-sm font-semibold text-ink hover:text-findmi-700 hover:underline">
                  {i.name || TYPE_LABEL[i.type]}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-sm font-semibold text-ink">{i.name || TYPE_LABEL[i.type]}</span>
              )}
              <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink/40">{TYPE_LABEL[i.type]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
