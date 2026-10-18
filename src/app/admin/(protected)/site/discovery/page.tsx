import Link from "next/link";
import ImageField from "@/components/admin/ImageField";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { searchHref } from "@/lib/discovery/query";
import { saveEventAttributesAction, saveLaneAction, saveTopicAction, setPrimaryLaneAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = { saved?: string; error?: string; event_q?: string; topic?: string };

const input = "w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-ink";
const label = "flex flex-col gap-1 text-xs font-semibold text-ink/60";

/** Discovery — Topics (named, structured queries), homepage Lanes, and the
 * explicit Event attributes Discovery filters on. A lightweight founder
 * tool: every Topic query is validated against the engine's vocabulary
 * before it's saved. */
export default async function DiscoveryAdminPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const admin = await requireAdminSupabase();
  const eventQ = (params.event_q ?? "").trim().slice(0, 80);
  let eventsQuery = admin.from("events").select("id, name, slug, start_date, is_free, family_friendly").eq("is_demo", false).order("start_date", { ascending: false }).limit(15);
  if (eventQ) eventsQuery = eventsQuery.ilike("name", `%${eventQ.replace(/[%_]/g, "")}%`);
  const [{ data: topics, error: topicErr }, { data: lanes }, { data: events }] = await Promise.all([
    admin.from("discovery_topics").select("*").order("sort_order"),
    admin.from("discovery_lanes").select("*").order("sort_order"),
    eventsQuery,
  ]);
  type Topic = { id: string; slug: string; name: string; description: string | null; image_url: string | null; aliases: string[]; query: unknown; is_active: boolean; sort_order: number };
  type Lane = { id: string; title: string; subtitle: string | null; kind: string; topic_ids: string[]; topic_id: string | null; item_limit: number; sort_order: number; is_visible: boolean; placement: "primary" | "explore_more" };
  const topicList = (topics ?? []) as Topic[];
  const laneList = (lanes ?? []) as Lane[];
  const eventList = (events ?? []) as { id: string; name: string; slug: string; start_date: string | null; is_free: boolean | null; family_friendly: boolean | null }[];
  const editing = topicList.find((t) => t.slug === params.topic);
  const tri = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "");

  return (
    <div className="max-w-3xl">
      <Link href="/admin/site" className="text-xs font-semibold text-ink/50">← Site Editor</Link>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Discovery</h1>
      <p className="mt-1 text-sm text-ink/50">Topics are named searches. Lanes place them on the homepage. <Link href="/admin/site/geography" className="font-semibold text-findmi-700">Geography →</Link></p>
      {params.error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{params.error}</p>}
      {params.saved && !params.error && <p className="mt-3 rounded-xl border border-findmi-200 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Saved.</p>}
      {topicErr && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The Discovery Intelligence migration hasn&apos;t been applied to this database yet.</p>}

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Topics</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {topicList.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-black/5 bg-white px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-semibold text-ink">{t.name}</span> <span className="text-xs text-ink/40">{t.slug}{!t.is_active && " · Off"}</span>
              </span>
              <span className="flex shrink-0 gap-3 text-xs font-semibold">
                <Link href={searchHref({ topics: [t.slug] })} className="text-ink/50">View</Link>
                <Link href={`/admin/site/discovery?topic=${t.slug}#topic-form`} className="text-findmi-700">Edit</Link>
              </span>
            </li>
          ))}
        </ul>

        <form id="topic-form" action={saveTopicAction} className="mt-4 flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4">
          <p className="text-sm font-semibold text-ink">{editing ? `Edit ${editing.name}` : "New Topic"}</p>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : (
            <label className={label}>Slug<input name="slug" required autoCapitalize="none" placeholder="vintage-markets" className={input} /></label>
          )}
          <label className={label}>Name<input name="name" required defaultValue={editing?.name} maxLength={60} autoCapitalize="words" className={input} /></label>
          <label className={label}>Description<input name="description" defaultValue={editing?.description ?? ""} autoCapitalize="sentences" className={input} /></label>
          {/* Discovery Tile Visual System pass — same reusable "paste a URL
              or upload a file" ImageField every other admin entity
              (Products, Locations, Businesses, People, …) already uses,
              instead of a plain URL input. Still fills the exact same
              image_url column/string format TopicTile already reads —
              no change to discovery queries, routing, or stored shape. */}
          <ImageField label="Image" name="image_url" defaultValue={editing?.image_url} />
          <label className={label}>Search Aliases (comma separated)<input name="aliases" defaultValue={editing?.aliases.join(", ")} autoCapitalize="none" className={input} /></label>
          <label className={label}>
            Query
            <textarea name="query" rows={4} defaultValue={JSON.stringify(editing?.query ?? { formats: ["pop-up"] }, null, 2)} autoCapitalize="none" spellCheck={false} className={`${input} font-mono text-xs`} />
            <span className="font-normal text-ink/45">Keys: when (now, today, tonight, tomorrow, week, weekend, upcoming), categories, formats, access, free, family, endingSoonHours, justAnnouncedDays, entities, text, market.</span>
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className={label}>Order<input name="sort_order" type="number" defaultValue={editing?.sort_order ?? 100} className={`${input} w-24`} /></label>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="is_active" defaultChecked={editing?.is_active ?? true} /> Active</label>
            <button className="rounded-full bg-findmi px-4 py-2 text-sm font-bold text-white">Save Topic</button>
            {editing && <Link href="/admin/site/discovery#topic-form" className="text-sm font-semibold text-ink/50">New Instead</Link>}
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Homepage Lanes</h2>
        <p className="mt-1 text-xs text-ink/50">Primary Discovery renders near the top, right before What&apos;s Happening. Everything else is Explore More, further down the page, in the order below.</p>
        <div className="mt-2 flex flex-col gap-3">
          {laneList.map((l) => (
            <div key={l.id} className="flex flex-col gap-2 rounded-2xl border border-black/5 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">{l.kind === "topics" ? "Topic Tiles" : l.kind === "topic_results" ? "Topic Results" : "Areas"}</p>
                {l.placement === "primary" ? (
                  <span className="shrink-0 rounded-full bg-findmi-50 px-3 py-1 text-xs font-bold text-findmi-700">Primary Discovery</span>
                ) : (
                  <form action={setPrimaryLaneAction}>
                    <input type="hidden" name="id" value={l.id} />
                    <button className="shrink-0 rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-ink/60">Make Primary</button>
                  </form>
                )}
              </div>
              <form action={saveLaneAction} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={l.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={label}>Title<input name="title" defaultValue={l.title} maxLength={60} autoCapitalize="words" className={input} /></label>
                  <label className={label}>Subtitle<input name="subtitle" defaultValue={l.subtitle ?? ""} autoCapitalize="sentences" className={input} /></label>
                </div>
                {l.kind === "topics" && (
                  <label className={label}>Topic Slugs (in order)<input name="topic_slugs" defaultValue={l.topic_ids.map((id) => topicList.find((t) => t.id === id)?.slug).filter(Boolean).join(", ")} autoCapitalize="none" className={input} /></label>
                )}
                {l.kind === "topic_results" && (
                  <label className={label}>
                    Topic
                    <select name="topic_id" defaultValue={l.topic_id ?? ""} className={input}>
                      {topicList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                )}
                <div className="flex flex-wrap items-end gap-3">
                  <label className={label}>Order<input name="sort_order" type="number" defaultValue={l.sort_order} className={`${input} w-20`} /></label>
                  <label className={label}>Items<input name="item_limit" type="number" min={1} max={24} defaultValue={l.item_limit} className={`${input} w-20`} /></label>
                  <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="is_visible" defaultChecked={l.is_visible} /> Visible</label>
                  <button className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-ink">Save</button>
                </div>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section id="events" className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Event Attributes</h2>
        <p className="mt-1 text-xs text-ink/50">Only set what you know. Unset Events never appear under Free or Family Friendly (Family Friendly also includes the Family + Kids category).</p>
        <form action="/admin/site/discovery#events" className="mt-2 flex gap-2">
          <input name="event_q" defaultValue={eventQ} placeholder="Search Events" autoCapitalize="none" className={input} />
          <button className="shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-ink">Search</button>
        </form>
        <ul className="mt-2 flex flex-col gap-2">
          {eventList.map((e) => (
            <li key={e.id}>
              <form action={saveEventAttributesAction} className="flex flex-wrap items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2">
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="event_q" value={eventQ} />
                <span className="min-w-0 flex-1 basis-full truncate text-sm font-semibold text-ink sm:basis-auto">{e.name} <span className="text-xs font-normal text-ink/40">{e.start_date}</span></span>
                <select name="is_free" defaultValue={tri(e.is_free)} aria-label="Free" className="rounded-lg border border-black/10 px-2 py-1 text-xs">
                  <option value="">Free: Unknown</option>
                  <option value="yes">Free</option>
                  <option value="no">Not Free</option>
                </select>
                <select name="family_friendly" defaultValue={tri(e.family_friendly)} aria-label="Family Friendly" className="rounded-lg border border-black/10 px-2 py-1 text-xs">
                  <option value="">Family: Unknown</option>
                  <option value="yes">Family Friendly</option>
                  <option value="no">Not For Kids</option>
                </select>
                <button className="rounded-full bg-findmi px-3 py-1 text-xs font-bold text-white">Save</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
