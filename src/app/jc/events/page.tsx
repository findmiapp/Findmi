import type { Metadata } from "next";
import { EventRow } from "@/components/jc/Cards";
import { ChipBar, EmptyState, PageTitle, withParams } from "@/components/jc/Layout";
import { EVENT_WINDOWS } from "@/lib/jc/config";
import { getJcEvents, getJcNeighborhoods } from "@/lib/jc/data";
import { longDayLabel } from "@/lib/jc/format";
import type { JcEvent, JcWindow } from "@/lib/jc/types";

export const revalidate = 60;
export const metadata: Metadata = { title: "Events" };

const WINDOWS = new Set<string>(EVENT_WINDOWS.map((w) => w.slug));

export default async function JcEvents({ searchParams }: { searchParams: Promise<{ when?: string; n?: string }> }) {
  const sp = await searchParams;
  const when = (sp.when && WINDOWS.has(sp.when) ? sp.when : "") as JcWindow;
  const neighborhoods = await getJcNeighborhoods();
  const n = neighborhoods.some((h) => h.slug === sp.n) ? sp.n : undefined;
  const events = await getJcEvents({ window: when, neighborhood: n, limit: 80 });

  const days = new Map<string, JcEvent[]>();
  for (const e of events) days.set(e.date, [...(days.get(e.date) ?? []), e]);

  return (
    <div>
      <PageTitle title="Events" sub="What's on across Jersey City" />
      <ChipBar chips={EVENT_WINDOWS.map((w) => ({ label: w.label, href: withParams("/events", { when: w.slug, n }), active: w.slug === when }))} />
      {neighborhoods.length > 0 && (
        <ChipBar
          className="mt-2"
          chips={[{ slug: "", name: "Everywhere" }, ...neighborhoods].map((h) => ({ label: h.name, href: withParams("/events", { when, n: h.slug }), active: (n ?? "") === h.slug }))}
        />
      )}

      {events.length === 0 ? (
        <EmptyState title="Nothing listed yet" body="No upcoming events match right now. Try a wider window." cta={when || n ? { label: "Show all upcoming", href: withParams("/events", {}) } : undefined} />
      ) : (
        <div className="mt-4 px-4 md:grid md:grid-cols-2 md:gap-x-10 md:px-8">
          {Array.from(days.entries()).map(([date, list]) => (
            <section key={date} className="pt-4">
              <h2 className="sticky top-14 z-10 -mx-4 bg-white/90 px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-neutral-500 backdrop-blur md:static md:mx-0 md:px-0">
                {longDayLabel(date, list[0].timezone)}
              </h2>
              {list.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
