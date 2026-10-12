import type { Metadata } from "next";
import Link from "next/link";
import { PrivateBadge } from "./BdPills";

export const metadata: Metadata = { title: "Business Development" };

/** BD Checkpoint 3A — a simple entry point into the private Business
 * Development area. Lists only what has shipped; the Overview dashboard
 * arrives in a later checkpoint. */
export default function BdHomePage() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Business Development</h1>
        <PrivateBadge />
      </div>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Findmi&apos;s internal business-development records. Admin-only — never shown on public Findmi.
      </p>

      <div className="mt-5 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
        <Link href="/admin/bd/organizations" className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-3 transition hover:bg-black/[0.02]">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">Organizations</span>
            <span className="block text-xs text-ink/50">Private companies Findmi works with — optionally linked to a public Findmi Business</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-ink/30">›</span>
        </Link>
      </div>
    </div>
  );
}
