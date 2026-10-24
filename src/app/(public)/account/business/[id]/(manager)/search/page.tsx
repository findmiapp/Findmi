import type { Metadata } from "next";
import Link from "next/link";
import { getManagerCore } from "../../managerContext";
import { listConversationsForUser } from "@/lib/opportunities";
import { MANAGER_SEARCH_MIN, MANAGER_SEARCH_TYPE_LABELS, searchManager, searchPattern, type ManagerSearchResult, type ManagerSearchType } from "@/lib/manager-search";
import { managerHref } from "@/lib/manager-links";

export const metadata: Metadata = { title: "Search", robots: { index: false } };
export const dynamic = "force-dynamic";

const ORDER: ManagerSearchType[] = ["product", "place", "event", "appearance", "target", "opportunity", "conversation"];

/** Manager Search — one Business's own Products, Places, Events, Where I'll
 * Be, Targets, Opportunities and Conversations, by name (lib/manager-search).
 * A plain GET form, so a search is a shareable, back-able URL. */
export default async function ManagerSearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { id } = await params;
  const { q: rawQ } = await searchParams;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ ?? "").slice(0, 80);
  const { admin, user, business } = await getManagerCore(id);
  const searching = searchPattern(q) !== null;
  const conversations = searching && user ? await listConversationsForUser(admin, user.id) : [];
  const results = searching ? await searchManager(admin, id, q, conversations) : [];
  const groups = ORDER.map((type) => ({ type, items: results.filter((r) => r.type === type) })).filter((g) => g.items.length);
  const name = business.name as string;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-display text-page-title font-bold text-primary">Search</h1>
        <p className="mt-1 text-metadata text-muted">Find anything in {name}: Products, Places, Events, Where I&rsquo;ll Be, Targets, Opportunities and Conversations.</p>
      </div>
      <form role="search" action={managerHref(id, "search")} method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          autoFocus={!q}
          autoCapitalize="none"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={80}
          aria-label={`Search ${name}`}
          placeholder={`Search ${name}`}
          className="min-h-11 min-w-0 flex-1 rounded-full border border-black/10 bg-white px-4 text-body text-primary placeholder:text-subtle focus:border-findmi focus:outline-none"
        />
        <button type="submit" className="min-h-11 shrink-0 rounded-full bg-findmi px-4 text-metadata font-bold text-white">
          Search
        </button>
      </form>

      {!q.trim() ? (
        <p className="text-body text-muted">Search by name. Results only come from {name}.</p>
      ) : !searching ? (
        <p className="text-body text-muted">Type at least {MANAGER_SEARCH_MIN} characters.</p>
      ) : groups.length === 0 ? (
        <p className="text-body text-muted">Nothing in {name} matches &ldquo;{q.trim()}&rdquo;.</p>
      ) : (
        groups.map((g) => (
          <section key={g.type} aria-labelledby={`search-${g.type}`} className="flex flex-col">
            <h2 id={`search-${g.type}`} className="text-label font-bold uppercase text-muted">
              {plural(g.type)}
            </h2>
            <ul className="flex flex-col divide-y divide-black/[0.06]">
              {g.items.map((r, i) => (
                <ResultRow key={`${r.href}-${i}`} r={r} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function plural(t: ManagerSearchType): string {
  if (t === "appearance") return MANAGER_SEARCH_TYPE_LABELS.appearance;
  if (t === "opportunity") return "Opportunities";
  return `${MANAGER_SEARCH_TYPE_LABELS[t]}s`;
}

function ResultRow({ r }: { r: ManagerSearchResult }) {
  return (
    <li>
      <Link href={r.href} className="flex min-h-[56px] flex-col justify-center py-2.5">
        <span className="truncate text-body font-semibold text-primary">{r.title}</span>
        <span className="truncate text-metadata text-muted">{r.context}</span>
      </Link>
    </li>
  );
}
