import Link from "next/link";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { listRecentBrandImportBatches } from "@/lib/admin/brand-import";
import { createBrandImportBatchAction } from "./actions";
import BuildBrandProfilesButton from "./BuildBrandProfilesButton";

export const dynamic = "force-dynamic";

/** Brand Ingestion P3 — Admin bulk Brand Import, step 1. Creating an
 * import only saves the websites (no fetching, no AI); processing happens
 * on the batch page. Nothing here creates a Business. */
export default async function ImportBrandsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const admin = await requireAdminSupabase();
  const recent = await listRecentBrandImportBatches(admin);

  return (
    <div>
      <Link href="/admin/businesses" className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← Businesses
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">Import Brands</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/55">
        Paste one website per line (up to 20). Findmi checks each against existing Businesses, then builds a brand
        profile candidate from the website for review. Nothing is created on Findmi.
      </p>

      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <form action={createBrandImportBatchAction} className="mt-5 max-w-xl">
        <label htmlFor="websites" className="text-xs font-bold uppercase tracking-wide text-ink/60">
          Websites
        </label>
        <textarea
          id="websites"
          name="websites"
          required
          rows={10}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={"milkmakeup.com\nglossier.com\nrarebeauty.com\ndrinkolipop.com\nliquiddeath.com"}
          className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-3.5 py-3 font-mono text-sm text-ink placeholder:text-ink/30 focus:border-findmi focus:outline-none"
        />
        <div className="mt-3">
          <BuildBrandProfilesButton />
        </div>
      </form>

      {recent.length > 0 && (
        <section className="mt-8 max-w-xl">
          <h2 className="font-display text-lg font-semibold text-ink">Recent Imports</h2>
          <ul className="mt-2 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
            {recent.map((b) => {
              const waiting = (b.counts.queued ?? 0) + (b.counts.processing ?? 0);
              return (
                <li key={b.id}>
                  <Link href={`/admin/businesses/import/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-black/[0.02]">
                    <span className="text-sm font-semibold text-ink">
                      {new Date(b.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="text-xs text-ink/55">
                      {b.submittedCount} {b.submittedCount === 1 ? "website" : "websites"} · {b.counts.ready ?? 0} ready ·{" "}
                      {b.counts.existing_business ?? 0} existing · {b.counts.failed ?? 0} failed
                      {waiting > 0 ? ` · ${waiting} waiting` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
