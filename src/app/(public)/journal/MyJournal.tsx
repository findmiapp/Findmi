import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import type { ReactNode } from "react";
import { getJournalArchiveEntries, type JournalArchiveFilter, type JournalIndexEntry } from "@/lib/journal";
import {
  buildMonthGrid,
  buildWeekDays,
  buildYearHistory,
  dayLabel,
  entriesForDay,
  entriesForMonth,
  entriesForWeek,
  filterByObjectType,
  groupNewestFirst,
  monthYearLabel,
  parseAnchorDate,
  shiftAnchor,
  sortNewestFirst,
  toYmd,
  todayYmd,
  weekRangeLabel,
  yearLabel,
  formatEntryTime,
  type JournalArchiveView,
} from "@/lib/journalArchive";
import JournalArchiveCard from "@/components/journal/JournalArchiveCard";
import ChevronIcon from "@/components/ChevronIcon";
import { ADD_MOMENT_HREF } from "@/lib/moment-filters";

const VIEWS: { key: JournalArchiveView; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  // Journal V2 Pass 2 — ALL is not another calendar granularity; it's the
  // chronological archive view of the complete Journal (see the "all"
  // branch below).
  { key: "all", label: "All" },
];

type JournalArchiveSort = "newest" | "oldest";

const FILTERS: { key: JournalArchiveFilter; label: string }[] = [
  { key: "all", label: "All experiences" },
  { key: "places", label: "Places" },
  { key: "brands", label: "Brands" },
  { key: "products", label: "Products" },
  { key: "events", label: "Events" },
];

export type MyJournalParams = { view?: string; date?: string; day?: string; filter?: string; sort?: string };

/** My Journal (/journal) — the signed-in person's personal history of
 * their Moments: the same journal_entries records /moments → My Moments
 * shows as a feed, here organized by time. Time (Day/Week/Month/Year/All)
 * is the primary dimension, object type (All/Places/Brands/Products/Events)
 * a secondary filter. Every view reads NOW → PAST (lib/journalArchive
 * sortNewestFirst / groupNewestFirst / buildYearHistory).
 *
 * One route, one view-mode control, driven by `?view=`, `?date=` (the
 * period anchor), `?day=` (a date selected within Month/Week), `?filter=`
 * and `?sort=` (All only) — plain searchParams, so Back/forward and shared
 * links behave normally with no client state. A Server Component: one
 * batched fetch (getJournalArchiveEntries) feeds every view's slicing.
 * The /journal page signs the visitor in first (canonical /login?next=). */
export default async function MyJournal({ userId, params }: { userId: string; params: MyJournalParams }) {
  const view = (VIEWS.some((v) => v.key === params.view) ? params.view : "month") as JournalArchiveView;
  const filterKey = (FILTERS.some((f) => f.key === params.filter) ? params.filter : "all") as JournalArchiveFilter;
  const anchor = parseAnchorDate(params.date);
  const explicitDay = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : null;
  // Journal V2 Pass 2 — sort only has visible effect in the "all" view
  // (the other four views are always chronological within their own
  // period), but it's still parsed/carried here rather than being local
  // client state, so it survives navigation/back-forward like every other
  // control on this page.
  const sortKey = (params.sort === "oldest" ? "oldest" : "newest") as JournalArchiveSort;
  const today = todayYmd();

  const allEntries = await getJournalArchiveEntries(userId);
  const journalIsEmpty = allEntries.length === 0;
  const entries = filterByObjectType(allEntries, filterKey);

  function hrefFor(next: { view?: JournalArchiveView; date?: string; filter?: JournalArchiveFilter; day?: string | null; sort?: JournalArchiveSort }) {
    const qp = new URLSearchParams();
    qp.set("view", next.view ?? view);
    qp.set("filter", next.filter ?? filterKey);
    qp.set("date", next.date ?? toYmd(anchor));
    qp.set("sort", next.sort ?? sortKey);
    const day = next.day === undefined ? explicitDay : next.day;
    if (day) qp.set("day", day);
    return `/journal?${qp.toString()}`;
  }

  const prevHref = hrefFor({ date: toYmd(shiftAnchor(anchor, view, -1)), day: null });
  const nextHref = hrefFor({ date: toYmd(shiftAnchor(anchor, view, 1)), day: null });

  let temporalLabel: string;
  let body: ReactNode;

  if (view === "month") {
    const grid = buildMonthGrid(anchor);
    const monthEntries = sortNewestFirst(entriesForMonth(entries, anchor));
    const byDate = new Map(groupNewestFirst(monthEntries));
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
            <EntryList entries={entriesForDay(monthEntries, selectedDay)} className="mt-3" emptyLabel="No Moments this day." />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {monthEntries.length === 0 ? (
              <EmptyPeriod label="No Moments this month." />
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
    const weekEntries = sortNewestFirst(entriesForWeek(entries, weekDays));
    const days = groupNewestFirst(weekEntries);
    const byDate = new Map(days);
    const weekYmds = weekDays.map(toYmd);
    // No day picked: the whole week's history, newest day first. A picked
    // day (from the strip) narrows to it.
    const selectedDay = explicitDay && weekYmds.includes(explicitDay) ? explicitDay : null;
    temporalLabel = weekRangeLabel(weekDays);
    body = (
      <>
        <WeekStrip days={weekDays} today={today} selectedDay={selectedDay} datesWithEntries={byDate} hrefFor={hrefFor} />
        <div className="mt-6">
          {selectedDay ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <DateHeading ymd={selectedDay} />
                <Link href={hrefFor({ day: null })} className="shrink-0 text-xs font-semibold text-findmi-700 hover:text-findmi-800">
                  Show full week
                </Link>
              </div>
              <EntryList entries={entriesForDay(weekEntries, selectedDay)} className="mt-3" emptyLabel="No Moments this day." />
            </>
          ) : days.length === 0 ? (
            <EmptyPeriod label="No Moments this week." />
          ) : (
            <div className="flex flex-col gap-6">
              {days.map(([ymd, dayEntries]) => (
                <div key={ymd}>
                  <DateHeading ymd={ymd} />
                  <EntryList entries={dayEntries} className="mt-3" />
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  } else if (view === "day") {
    const ymd = toYmd(anchor);
    const dayEntries = sortNewestFirst(entriesForDay(entries, ymd));
    temporalLabel = dayLabel(anchor);
    body = (
      <div className="mt-6">
        {dayEntries.length === 0 ? (
          <EmptyPeriod label="No Moments this day." />
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
  } else if (view === "year") {
    const year = anchor.getFullYear();
    const months = buildYearHistory(entries, year);
    temporalLabel = yearLabel(anchor);
    body =
      months.length === 0 ? (
        <div className="mt-6">
          <EmptyPeriod label={`No Moments in ${year}.`} />
        </div>
      ) : (
        <div className="mt-6 flex flex-col divide-y divide-black/5">
          {months.map((m) => (
            <Link
              key={m.month}
              href={hrefFor({ view: "month", date: toYmd(new Date(year, m.month, 1)), day: null })}
              className="flex items-center justify-between gap-3 py-3.5 transition hover:bg-black/[0.015]"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">{m.label}</p>
                <p className="text-xs text-ink/50">
                  {m.count} {m.count === 1 ? "Moment" : "Moments"}
                </p>
              </div>
              {m.previewCoverUrls.length > 0 && (
                <div className="flex shrink-0 -space-x-2">
                  {m.previewCoverUrls.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- small signed-URL preview thumbnail, not worth next/image's overhead here
                    <img key={i} src={url} alt="" className="h-10 w-10 rounded-lg border-2 border-white object-cover shadow-sm" />
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      );
  } else {
    // Journal V2 Pass 2 — "all": the complete chronological archive, not
    // another time-windowed period. `entries` (already filtered by object
    // type) arrives from getJournalArchiveEntries already ordered
    // entry_date desc, created_at desc — the exact deterministic
    // newest-first order this view wants by default, tie-broken by
    // created_at same as every other view already relies on implicitly.
    // "Oldest first" is a plain reverse of that same stable order, never a
    // second query or a different tie-break rule.
    temporalLabel = "All";
    const newest = sortNewestFirst(entries);
    const allViewEntries = sortKey === "oldest" ? [...newest].reverse() : newest;
    body = (
      <div className="mt-6">
        <EntryList entries={allViewEntries} emptyLabel="No Moments match this filter." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">My Journal</h1>
          <p className="mt-1.5 max-w-md text-sm text-ink/60">Your personal history of the places, brands and experiences you&rsquo;ve lived.</p>
        </div>
        <Link
          href={ADD_MOMENT_HREF}
          className="flex gap-1.5 h-9 shrink-0 items-center justify-center rounded-full bg-findmi px-3.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          <span aria-hidden="true" className="inline-flex"><NavIcon name="moments" className="h-4 w-4 shrink-0" /></span>
          Add Moment
        </Link>
      </div>

      {journalIsEmpty ? (
        <div className="mt-10 rounded-2xl border border-dashed border-black/15 p-8 text-center">
          <p className="font-display text-lg font-bold tracking-tight text-ink">Start building your Journal.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink/55">
            Every Moment you add — a place you visited, something you tried, an event you went to — becomes part of your history here.
          </p>
          <Link
            href={ADD_MOMENT_HREF}
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-findmi px-5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            <span aria-hidden="true" className="inline-flex"><NavIcon name="moments" className="h-4 w-4 shrink-0" /></span>
            Add Your First Moment
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

          {view === "all" ? (
            // Journal V2 Pass 2 — "all" has no period to page through, so
            // the prev/temporalLabel/next row is replaced with a compact
            // Newest/Oldest sort control instead — not a dropdown, just
            // two plain links, consistent with this page's existing
            // "whole state lives in the URL, no client component" design.
            <div className="mt-4 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">All Moments</p>
              <div className="flex items-center gap-1 rounded-full border border-black/10 bg-white p-1">
                <Link
                  href={hrefFor({ sort: "newest" })}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition ${
                    sortKey === "newest" ? "bg-findmi text-white" : "text-ink/50 hover:text-ink"
                  }`}
                >
                  Newest
                </Link>
                <Link
                  href={hrefFor({ sort: "oldest" })}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition ${
                    sortKey === "oldest" ? "bg-findmi text-white" : "text-ink/50 hover:text-ink"
                  }`}
                >
                  Oldest
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center justify-between gap-2">
              <Link
                href={prevHref}
                aria-label="Previous"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:border-ink/30 hover:text-ink"
              >
                <ChevronIcon direction="left" className="h-4 w-4" />
              </Link>
              <p className="text-sm font-bold text-ink">{temporalLabel}</p>
              <Link
                href={nextHref}
                aria-label="Next"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:border-ink/30 hover:text-ink"
              >
                <ChevronIcon direction="right" className="h-4 w-4" />
              </Link>
            </div>
          )}

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
      <Link href={ADD_MOMENT_HREF} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-findmi-700 hover:text-findmi-800">
        <span aria-hidden="true" className="inline-flex"><NavIcon name="moments" className="h-4 w-4 shrink-0" /></span>
        Add Moment
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
