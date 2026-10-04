import Link from "next/link";
import type { ReactNode } from "react";
import { getAdminSection, type AdminSectionKey } from "../adminNavItems";
import { ChevronRightGlyph } from "./AdminIcons";

/** Admin V2 — a section's index page: every destination in that section
 * as a compact, tappable row (label, one-line hint, optional real count
 * or status badge). Purely an index of existing routes. */
export default function AdminSectionHub({
  section,
  badges = {},
  footer,
}: {
  section: AdminSectionKey;
  /** Keyed by destination href. Only real values — omit when unknown. */
  badges?: Record<string, { text: string; tone?: "attention" | "neutral" }>;
  footer?: ReactNode;
}) {
  const def = getAdminSection(section);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-display text-page-title-lg font-bold text-primary">{def.label}</h1>
        {def.description && <p className="mt-1 text-body text-muted">{def.description}</p>}
      </div>
      {def.groups.map((group, i) => (
        <section key={group.label ?? i} aria-label={group.label ?? def.label}>
          {group.label && <h2 className="mb-2 px-1 text-label font-bold uppercase text-subtle">{group.label}</h2>}
          <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
            {group.items.map((item) => {
              const badge = badges[item.href];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 transition hover:bg-black/[0.02] focus-visible:bg-black/[0.03] focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-card-title font-semibold text-primary">{item.label}</span>
                      {item.hint && <span className="block truncate text-metadata text-muted">{item.hint}</span>}
                    </span>
                    {badge && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-metadata font-bold tabular-nums ${
                          badge.tone === "attention" ? "bg-amber-100 text-amber-800" : "bg-black/[0.04] text-secondary"
                        }`}
                      >
                        {badge.text}
                      </span>
                    )}
                    <ChevronRightGlyph className="h-4 w-4 shrink-0 text-ink/25" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {footer}
    </div>
  );
}
