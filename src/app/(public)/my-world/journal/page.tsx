import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getJournalArchiveEntries, type JournalArchiveFilter, type JournalIndexEntry } from "@/lib/journal";
import {
  buildMonthGrid,
  buildWeekDays,
  buildYearMonthSummaries,
  dayLabel,
  entriesForDay,
  entriesForMonth,
  entriesForWeek,
  filterByObjectType,
  groupEntriesByDate,
  monthYearLabel,
  parseAnchorDate,
  shiftAnchor,
  sortByTimeOfDay,
  toYmd,
  todayYmd,
  weekRangeLabel,
  yearLabel,
  formatEntryTime,
  type JournalArchiveView,
} from "@/lib/journalArchive";
import JournalArchiveCard from "@/components/journal/JournalArchiveCard";

export const dynamic = "force-dynamic";

const VIEWS: { key: JournalArchiveView; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

const FILTERS: { key: JournalArchiveFilter; label: string }[] = [
  { key: "all", label: "All experiences" },
  { key: "places", label: "Places" },
  { key: "brands", label: "Brands" },
  { key: "products", label: "Products" },
  { key: "events", label: "Events" },
];

/** Journal V1.1 — the Journal Index rebuilt as a chronological, visual
 * archive: time (Day/Week/Month/Year) is the primary organizing
 * dimension, object type (All/Places/Brands/Products/Events) a secondary
 * filter on top of it — reversed from the old Index, where five type
 * pills were the only navigation and the whole page was one flat grid.
 *
 * One route, one view-mode control — not four separate pages — driven by
 * `?view=`, `?date=` (the period anchor) and `?day=` (an explicit date
 * selected within Month/Week view), all plain searchParams so back/
 * forward and shareable links behave normally with no client state at
 * all. The entire page stays a Server Component: one batched data fetch
 * (getJournalArchiveEntries — same fixed number of queries regardless of
 * which period/filter is showing, see its own comment) feeds every
 * view's slicing, which happens in plain JS (lib/journalArchive.ts). */
export default async function JournalIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; day?: string; filter?: string }>;
}) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent("/my-world/journal"));

  const params = await searchParams;
  const view = (VIEWS.some((v) => v.key === params.view) ? params.view : "month") as JournalArchiveView;
  const filterKey = (FILTERS.some((f) => f.key === params.filter) ? params.filter : "all") as JournalArchiveFilter;
  const anchor = parseAnchorDate(params.date);
  const explicitDay = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : null;
  const today = todayYmd();

  const allEntries = await getJournalArchiveEntries(user.id);
  const journalIsEmpty = allEntries.length === 0;
  const entries = filterByObjectType(allEntries, filterKey);

  function hrefFor(next: { view?: JournalArchiveView; date?: string; filter?: JournalArchiveFilter; day?: string | null }) {
    const qp = new URLSearchParams();
    qp.set("view", next.view ?? view);
    qp.set("filter", next.filter ?? filterKey);
    qp.set("date", next.date ?? toYmd(anchor));
    const day = next.day === undefined ? explicitDay : next.day;
    if (day) qp.set("day", day);
    return `/my-world/journal?${qp.toString()}`;
  }

  const prevHref = hrefFor({ date: toYmd(shiftAnchor(anchor, view, -1)), day: null });
  const nextHref = hrefFor({ date: toYmd(shiftAnchor(anchor, view, 1)), day: null });

  let temporalLabel: string;
  let body: ReactNode;

  if (view === "month") {
    const grid = buildMonthGrid(anchor);
    const monthEntries = entriesForMonth(entries, anchor);
    const byDate = groupEntriesByDate(monthEntries);
    const monthPrefix = toYmd(anchor).slice(0, 7);
    const selectedDay = explicitDay && explicitDay.startsWith(monthPrefix) ? explicitDay : null;
    temporalLabel = monthYearLabel(anchor);
    body = (
      <>
        <MonthCalendar grid={grid} today={today} selectedDay={selectedDay} datesWithEntries={new Set(byDate.keys())} hrefFor={hrefFor} />
        {selectedDay ? (
          <div className="mt-6">
            <div className="flex items-center justify-between gap-2">
              <DateHeading ymd={selectedDay} />
              <Link href={hrefFor({ day: null })} className="shrink-0 text-xs font-semibold text-findmi-700 hover:text-findmi-800">
                Show full month
              </Link>
            </div>
            <EntryList entries={entriesForDay(monthEntries, selectedDay)} className="mt-3" emptyLabel="No entries this day." />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {monthEntries.length === 0 ? (
              <EmptyPeriod label="No entries this month." />
            ) : (
              [...byDate.entries()].map(([ymd, dayEntries]) => (
                <div key={ymd}>
                  <DateHeading ymd={ymd} />
                  <EntryList entries={dayEntries} className="mt-3" />
                </div>
              ))
            )}
          </div>
        )}
      </>
    );
  } else if (view === "week") {
    const weekDays = buildWeekDays(anchor);
    const weekEntries = entriesForWeek(entries, weekDays);
    const byDate = groupEntriesByDate(weekEntries);
    const weekYmds = weekDays.map(toYmd);
    const defaultDay = weekYmds.find((ymd) => byDate.has(ymd)) ?? (weekYmds.includes(today) ? today : null);
    const selectedDay = explicitDay && weekYmds.includes(explicitDay) ? explicitDay : defaultDay;
    temporalLabel = weekRangeLabel(weekDays);
    body = (
      <>
        <WeekStrip days={weekDays} today={today} selectedDay={selectedDay} datesWithEntries={byDate} hrefFor={hrefFor} />
        <div className="mt-6">
          {selectedDay ? (
            <>
              <DateHeading ymd={selectedDay} />
              <EntryList entries={entriesForDay(weekEntries, selectedDay)} className="mt-3" emptyLabel="No entries this day." />
            </>
          ) : (
            <EmptyPeriod label="No entries this week." />
          )}
        </div>
      </>
    );
  } else if (view === "day") {
    const ymd = toYmd(anchor);
    const dayEntries = sortByTimeOfDay(entriesForDay(entries, ymd));
    temporalLabel = dayLabel(anchor);
    body = (
      <div className="mt-6">
        {dayEntries.length === 0 ? (
          <EmptyPeriod label="No entries this day." />
        ) : (
          <div className="flex flex-col gap-4">
            {dayEntries.map((e) => (
              <div key={e.id}>
                {e.entry_time && <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink/40">{formatEntryTime(e.entry_time)}</p>}
                <JournalArchiveCard entry={e} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    const year = anchor.getFullYear();
    const summaries = buildYearMonthSummaries(entries, year);
    temporalLabel = yearLabel(anchor);
    body = (
      <div className="mt-6 flex flex-col divide-y divide-black/5">
        {summaries.map((m) => {
          const monthDate = new Date(year, m.month, 1);
          const content = (
            <div className="flex items-center justify-between gap-3 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">{m.label}</p>
                <p className="text-xs text-ink/50">{m.count > 0 ? `${m.count} ${m.count === 1 ? "entry" : "entries"}` : "No entries"}</p>
              </div>
              {m.previewCoverUrls.length > 0 && (
                <div className="flex shrink-0 -space-x-2">
                  {m.previewCoverUrls.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- small signed-URL preview thumbnail, not worth next/image's overhead here
                    <img key={i} src={url} alt="" className="h-10 w-10 rounded-lg border-2 border-white object-cover shadow-sm" />
                  ))}
                </div>
              )}
            </div>
          );
          return m.count > 0 ? (
            <Link key={m.month} href={hrefFor({ view: "month", date: toYmd(monthDate), day: null })} className="transition hover:bg-black/[0.015]">
              {content}
            </Link>
          ) : (
            <div key={m.month} className="opacity-50">
              {content}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Journal</h1>
          <p className="mt-1.5 max-w-md text-sm text-ink/60">Document your days, places, brands and experiences.</p>
        </div>
        <Link
          href="/my-world/journal/new"
          className="flex h-9 shrink-0 items-center justify-center rounded-full bg-findmi px-3.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          + Add Entry
        </Link>
      </div>

      {journalIsEmpty ? (
        <div className="mt-10 rounded-2xl border border-dashed border-black/15 p-8 text-center">
          <p className="font-display text-lg font-bold tracking-tight text-ink">Your Journal starts with a moment.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink/55">
            Save a place you visited, something you tried, an event you attended or a day you want to remember.
          </p>
          <Link
            href="/my-world/journal/new"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-findmi px-5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Add Your First Entry
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-1 rounded-full border border-black/10 bg-white p-1">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={hrefFor({ view: v.key, date: explicitDay ?? toYmd(anchor), day: null })}
                className={`flex-1 rounded-full py-1.5 text-center text-xs font-bold uppercase tracking-wide transition ${
                  view === v.key ? "bg-findmi text-white" : "text-ink/50 hover:text-ink"
                }`}
              >
                {v.label}
              </Link>
            ))}
          </div>

          <details className="group relative mt-3 w-fit">
            <summary className="flex cursor-pointer select-none items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 [&::-webkit-details-marker]:hidden">
              {FILTERS.find((f) => f.key === filterKey)?.label}
              <span aria-hidden>▾</span>
            </summary>
            <div className="absolute left-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-lg">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={hrefFor({ filter: f.key })}
                  className={`block px-3.5 py-2 text-sm ${filterKey === f.key ? "bg-findmi-50 font-semibold text-findmi-700" : "text-ink/70 hover:bg-black/[0.03]"}`}
                >
                  {f.label}
                </Link>
              ))}
            </div>
          </details>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Link
              href={prevHref}
              aria-label="Previous"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:border-ink/30 hover:text-ink"
            >
              ‹
            </Link>
            <p className="text-sm font-bold text-ink">{temporalLabel}</p>
            <Link
              href={nextHref}
              aria-label="Next"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:border-ink/30 hover:text-ink"
            >
              ›
            </Link>
          </div>

          {body}
        </>
      )}
    </div>
  );
}

function DateHeading({ ymd }: { ymd: string }) {
  const label = new Date(ymd + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
  return <p className="text-xs font-bold uppercase tracking-wide text-ink/50">{label}</p>;
}

function EntryList({ entries, className = "", emptyLabel }: { entries: JournalIndexEntry[]; className?: string; emptyLabel?: string }) {
  if (entries.length === 0) {
    return emptyLabel ? <EmptyPeriod label={emptyLabel} /> : null;
  }
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {entries.map((e) => (
        <JournalArchiveCard key={e.id} entry={e} />
      ))}
    </div>
  );
}

function EmptyPeriod({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/15 px-5 py-7 text-center">
      <p className="text-sm text-ink/50">{label}</p>
      <Link href="/my-world/journal/new" className="mt-2 inline-block text-sm font-semibold text-findmi-700 hover:text-findmi-800">
        + Add Journal Entry
      </Link>
    </div>
  );
}

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function MonthCalendar({
  grid,
  today,
  selectedDay,
  datesWithEntries,
  hrefFor,
}: {
  grid: { date: Date; ymd: string; inMonth: boolean }[][];
  today: string;
  selectedDay: string | null;
  datesWithEntries: Set<string>;
  hrefFor: (next: { day?: string | null }) => string;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-black/5 bg-white p-3">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-ink/35">
        {WEEKDAY_LETTERS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {grid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((cell) => {
              if (!cell.inMonth) {
                return (
                  <span key={cell.ymd} className="flex h-9 items-center justify-center text-xs text-ink/15">
                    {cell.date.getDate()}
                  </span>
                );
              }
              const hasEntries = datesWithEntries.has(cell.ymd);
              const isToday = cell.ymd === today;
              const isSelected = selectedDay === cell.ymd;
              return (
                <Link
                  key={cell.ymd}
                  href={hrefFor({ day: cell.ymd })}
                  className={`relative flex h-9 items-center justify-center rounded-full text-xs font-semibold transition ${
                    isSelected
                      ? "bg-findmi text-white"
                      : isToday
                        ? "border border-findmi/50 text-ink"
                        : "text-ink/70 hover:bg-black/[0.04]"
                  }`}
                >
                  {cell.date.getDate()}
                  {hasEntries && !isSelected && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-findmi" />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekStrip({
  days,
  today,
  selectedDay,
  datesWithEntries,
  hrefFor,
}: {
  days: Date[];
  today: string;
  selectedDay: string | null;
  datesWithEntries: Map<string, JournalIndexEntry[]>;
  hrefFor: (next: { day?: string | null }) => string;
}) {
  return (
    <div className="mt-5 flex gap-1.5">
      {days.map((date) => {
        const ymd = toYmd(date);
        const count = datesWithEntries.get(ymd)?.length ?? 0;
        const isToday = ymd === today;
        const isSelected = selectedDay === ymd;
        return (
          <Link
            key={ymd}
            href={hrefFor({ day: ymd })}
            className={`flex flex-1 flex-col items-center gap-1 rounded-2xl border py-2.5 transition ${
              isSelected ? "border-findmi bg-findmi text-white" : isToday ? "border-findmi/50 bg-white text-ink" : "border-black/10 bg-white text-ink/70 hover:border-ink/20"
            }`}
          >
            <span className={`text-[9px] font-bold uppercase tracking-wide ${isSelected ? "text-white/80" : "text-ink/40"}`}>
              {date.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="text-sm font-bold">{date.getDate()}</span>
            {count > 0 && <span className={`h-1 w-1 rounded-full ${isSelected ? "bg-white" : "bg-findmi"}`} />}
          </Link>
        );
      })}
    </div>
  );
}
