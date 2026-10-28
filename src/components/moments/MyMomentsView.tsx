import Link from "next/link";
import JournalArchiveCard from "@/components/journal/JournalArchiveCard";
import type { JournalIndexEntry } from "@/lib/journal";
import { filterByObjectType } from "@/lib/journalArchive";
import { MY_MOMENTS_FILTERS, MY_MOMENTS_LIMIT, momentsModeHref, myMomentsAuthHrefs, type MyMomentsFilter } from "@/lib/moment-filters";
import MomentsModeTabs from "./MomentsModeTabs";

/** /moments → My Moments: the signed-in person's own documented history —
 * the SAME journal_entries records My Moments (/my-world/journal) shows,
 * read owner-scoped and bounded (the page passes at most MY_MOMENTS_LIMIT,
 * newest first). Filters are the archive's existing object-type filters
 * over that page; the full calendar archive stays at /my-world/journal.
 * Signed out: what My Moments is, plus Log In / Create Account returning
 * here — never a fake "you have no Moments". */
export default function MyMomentsView({ entries, filter }: { entries: JournalIndexEntry[] | null; filter: MyMomentsFilter }) {
  return (
    <div>
      <MomentsModeTabs active="my-moments" />

      {entries === null ? (
        <SignedOut />
      ) : (
        <>
          <div role="group" aria-label="Filter My Moments" className="-mx-4 mt-3 flex snap-x scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MY_MOMENTS_FILTERS.map((f) => {
              const active = f.key === filter;
              return (
                <Link
                  key={f.key}
                  href={momentsModeHref("my-moments", f.key)}
                  replace
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-8 shrink-0 snap-start items-center rounded-full px-3.5 text-metadata font-semibold transition-colors ${
                    active ? "bg-findmi-600 text-white" : "border border-black/10 bg-white text-ink/65 hover:border-black/20 hover:text-ink"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
            <span aria-hidden="true" className="w-2 shrink-0" />
          </div>

          <MyMomentsList entries={entries} filter={filter} />

          <p className="mt-6 text-metadata text-muted">
            {entries.length >= MY_MOMENTS_LIMIT ? "Showing your most recent Moments. " : ""}
            Browse your full history by month in{" "}
            <Link href="/my-world/journal" className="font-semibold text-findmi-700 hover:underline">
              My Moments
            </Link>
            , and the places and brands you&rsquo;re keeping track of in{" "}
            <Link href="/account/saved" className="font-semibold text-findmi-700 hover:underline">
              Saved
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

function MyMomentsList({ entries, filter }: { entries: JournalIndexEntry[]; filter: MyMomentsFilter }) {
  if (entries.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-black/15 px-5 py-7 text-center">
        <p className="font-display text-base font-bold text-ink">Your Moments start here.</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-ink/55">Capture a place you visited, something you tried or an event you went to.</p>
        <Link href="/my-world/journal/new" className="mt-3 inline-flex h-10 items-center rounded-full bg-findmi px-4 text-sm font-bold text-white hover:bg-findmi-600">
          Add Your First Moment
        </Link>
      </div>
    );
  }
  const shown = filterByObjectType(entries, filter);
  if (shown.length === 0) return <p className="mt-4 rounded-2xl bg-black/[0.03] px-4 py-6 text-sm text-ink/55">None of your recent Moments match this filter.</p>;
  return (
    <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map((e) => (
        <li key={e.id} className="min-w-0">
          <JournalArchiveCard entry={e} />
        </li>
      ))}
    </ul>
  );
}

function SignedOut() {
  const { login, signup } = myMomentsAuthHrefs();
  return (
    <div className="mt-4 rounded-2xl border border-black/[0.08] bg-white px-5 py-6">
      <p className="font-display text-base font-bold text-ink">Your Own Moments, In One Place</p>
      <p className="mt-1 text-sm text-ink/60">My Moments holds the experiences you document on Findmi — the places, brands and events you&rsquo;ve lived — so you can revisit them anytime.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={login} className="inline-flex h-10 items-center rounded-full bg-findmi px-4 text-sm font-bold text-white hover:bg-findmi-600">
          Log In
        </Link>
        <Link href={signup} className="inline-flex h-10 items-center rounded-full border border-black/10 px-4 text-sm font-bold text-ink hover:border-black/20">
          Create Account
        </Link>
      </div>
    </div>
  );
}
