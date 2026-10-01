import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getJournalIndexForUser } from "@/lib/journal";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "places", label: "Places" },
  { key: "brands", label: "Brands" },
  { key: "events", label: "Events" },
  { key: "products", label: "Products" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/** Journal V1 — the consumer's own Journal Index. "My own entries" only
 * (not a public discovery feed — out of this pass's scope), so this route
 * is gated the same way /account already is (see middleware.ts's own
 * matcher, extended to cover /my-world/journal). Filters are real,
 * efficient WHERE/EXISTS-backed filters over journal_entry_connections
 * (see getJournalIndexForUser) — not fake pills over client-side data. */
export default async function JournalIndexPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent("/my-world/journal"));

  const params = await searchParams;
  const filter = (FILTERS.some((f) => f.key === params.filter) ? params.filter : "all") as FilterKey;
  const entries = await getJournalIndexForUser(user.id, filter);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Journal</h1>
          <p className="mt-1.5 max-w-md text-sm text-ink/60">Document your days, places, brands and experiences.</p>
        </div>
        <Link
          href="/my-world/journal/new"
          className="flex h-10 shrink-0 items-center justify-center rounded-xl bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Add Entry
        </Link>
      </div>

      <div className="mt-5 flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/my-world/journal" : `/my-world/journal?filter=${f.key}`}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
              filter === f.key ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-ink/30"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-black/15 p-8 text-center">
          <p className="text-sm text-ink/50">
            {filter === "all" ? "No Journal Entries yet." : "Nothing here yet for this filter."}
          </p>
          <Link href="/my-world/journal/new" className="mt-3 inline-block text-sm font-semibold text-findmi-700">
            Add Journal Entry
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {entries.map((entry) => (
            <Link
              key={entry.id}
              href={`/journal/${entry.id}`}
              className="block overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98] hover:border-black/10 hover:shadow"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-mist">
                {entry.coverUrl ? (
                  <Image src={entry.coverUrl} alt="" fill unoptimized sizes="(min-width: 640px) 25vw, 50vw" className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-ink">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-white/25">Findmi</span>
                  </div>
                )}
                {entry.visibility === "private" && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                    Private
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">{entry.title}</p>
                {entry.location && <p className="mt-0.5 truncate text-xs text-ink/55">{entry.location.name}</p>}
                <p className="mt-0.5 truncate text-xs text-ink/45">
                  {new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {entry.photoCount > 0 ? ` · ${entry.photoCount} photo${entry.photoCount === 1 ? "" : "s"}` : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
