import type { Metadata } from "next";
import { PlaceCard } from "@/components/jc/Cards";
import { ChipBar, EmptyState, PageTitle, withParams } from "@/components/jc/Layout";
import { PLACE_FILTERS } from "@/lib/jc/config";
import { getJcNeighborhoods, getJcPlaces } from "@/lib/jc/data";

export const revalidate = 300;
export const metadata: Metadata = { title: "Places" };

const TYPES = new Set<string>(PLACE_FILTERS.map((f) => f.slug));

export default async function JcPlaces({ searchParams }: { searchParams: Promise<{ type?: string; n?: string }> }) {
  const sp = await searchParams;
  const type = TYPES.has(sp.type ?? "") ? (sp.type ?? "") : "";
  const neighborhoods = await getJcNeighborhoods();
  const n = neighborhoods.some((h) => h.slug === sp.n) ? sp.n : undefined;
  const places = await getJcPlaces({ categorySlugs: type ? [type] : undefined, neighborhood: n, limit: 80 });

  return (
    <div>
      <PageTitle title="Places" sub="Where Jersey City eats, drinks and hangs out" />
      <ChipBar chips={PLACE_FILTERS.map((f) => ({ label: f.label, href: withParams("/places", { type: f.slug, n }), active: f.slug === type }))} />
      {neighborhoods.length > 0 && (
        <ChipBar
          className="mt-2"
          chips={[{ slug: "", name: "Everywhere" }, ...neighborhoods].map((h) => ({ label: h.name, href: withParams("/places", { type, n: h.slug }), active: (n ?? "") === h.slug }))}
        />
      )}
      {places.length === 0 ? (
        <EmptyState title="No places here yet" body="We haven't added places that match yet." cta={type || n ? { label: "Show all places", href: withParams("/places", {}) } : undefined} />
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 px-4 md:grid-cols-4 md:gap-x-5 md:px-8">
          {places.map((p) => (
            <PlaceCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
