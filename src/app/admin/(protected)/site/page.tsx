import Link from "next/link";

export const dynamic = "force-dynamic";

// Simple launcher — only Homepage is wired this pass. Add a row here as
// each additional public page gets its own Site Editor screen later.
const PAGES = [
  { key: "homepage", label: "Homepage", href: "/admin/site/homepage", available: true },
];

export default function SiteEditorPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Site Editor</h1>
      <p className="mt-1 text-sm text-ink/50">
        Edit headlines, descriptions, CTAs, section visibility, and section order on FindMi&rsquo;s
        public pages — without a code change.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {PAGES.map((p) =>
          p.available ? (
            <Link
              key={p.key}
              href={p.href}
              className="flex items-center justify-between rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <span className="text-sm font-semibold text-ink">{p.label}</span>
              <span className="text-ink/30">→</span>
            </Link>
          ) : (
            <div
              key={p.key}
              className="flex items-center justify-between rounded-xl border border-black/5 bg-black/[0.02] px-4 py-3"
            >
              <span className="text-sm font-semibold text-ink/40">{p.label}</span>
              <span className="text-xs text-ink/35">Coming soon</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
