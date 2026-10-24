import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";

export interface InboxScopeOption {
  key: string;
  label: string;
  /** "Business" / "Personal" / "Everything" — a quiet second line. */
  kind: string;
  href: string;
  unread: number;
}

/** The Inbox scope selector — one compact disclosure ("Showing: The Native
 * Rose ▾") listing All, Personal and each Business the person manages, with
 * unread counts. A plain <details>, so it works without JavaScript and never
 * becomes a wall of Business cards. */
export default function InboxScopeMenu({ current, options }: { current: string; options: InboxScopeOption[] }) {
  const active = options.find((o) => o.key === current) ?? options[0];
  return (
    <details className="group relative w-fit max-w-full">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 text-metadata font-semibold text-primary [&::-webkit-details-marker]:hidden">
        <span className="text-muted">Showing</span>
        <span className="min-w-0 truncate">{active.label}</span>
        <ChevronIcon direction="down" className="h-3 w-3 shrink-0 text-ink/40 transition group-open:rotate-180" />
      </summary>
      <ul className="absolute left-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-black/[0.08] bg-white py-1 shadow-lg">
        {options.map((o) => (
          <li key={o.key}>
            <Link
              href={o.href}
              aria-current={o.key === active.key ? "true" : undefined}
              className={`flex min-h-11 items-center gap-3 px-3.5 py-2 transition hover:bg-black/[0.03] ${o.key === active.key ? "bg-findmi-50/60" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-primary">{o.label}</span>
                <span className="block text-metadata text-subtle">{o.kind}</span>
              </span>
              {o.unread > 0 && <span className="shrink-0 rounded-full bg-findmi px-2 py-0.5 text-microcopy font-bold text-white">{o.unread}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
