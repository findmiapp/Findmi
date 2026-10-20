import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventRow, PlaceCard } from "@/components/jc/Cards";
import { BackButton, ShareButton } from "@/components/jc/Detail";
import JcMedia from "@/components/jc/JcMedia";
import { Module, Rail } from "@/components/jc/Layout";
import { jcHref } from "@/lib/jc/config";
import { getJcPlace, getJcPlaces } from "@/lib/jc/data";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getJcPlace((await params).slug);
  return p ? { title: p.name, alternates: { canonical: `/places/${p.slug}` } } : {};
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default async function JcPlacePage({ params }: Props) {
  const p = await getJcPlace((await params).slug);
  if (!p) notFound();
  const nearby = (await getJcPlaces({ neighborhood: p.neighborhood?.slug, limit: 12 })).filter((x) => x.slug !== p.slug);
  const gallery = p.gallery.filter((g) => g !== p.image);

  return (
    <article className="md:grid md:grid-cols-[1.1fr_1fr] md:gap-10 md:px-8 md:pt-8">
      <div className="relative px-3 pt-2 md:px-0 md:pt-0">
        <JcMedia src={p.image} alt={p.name} sizes="(min-width: 768px) 560px, 100vw" priority className="aspect-[4/3.4] md:aspect-[4/5]" rounded="rounded-[26px]" />
        <BackButton fallback="/places" />
        <ShareButton title={p.name} />
      </div>

      <div className="px-4 pt-5 md:px-0 md:pt-2">
        <p className="text-[13px] font-medium text-neutral-500">{[p.categoryLabel, p.neighborhood?.name].filter(Boolean).join(" · ")}</p>
        <h1 className="mt-1 text-[28px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[36px]">{p.name}</h1>
        {p.address && <p className="mt-2 text-[15px] text-neutral-600">{p.address}</p>}

        <div className="mt-5 flex gap-2">
          {p.address && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(`${p.name} ${p.address}`)}`} target="_blank" rel="noopener noreferrer" className="flex h-11 flex-1 items-center justify-center rounded-full bg-neutral-950 text-[14.5px] font-semibold text-white md:flex-none md:px-7">
              Directions
            </a>
          )}
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer" className="flex h-11 flex-1 items-center justify-center rounded-full bg-neutral-100 text-[14.5px] font-semibold md:flex-none md:px-7">
              {hostOf(p.website)}
            </a>
          )}
        </div>

        {p.description && <p className="mt-6 whitespace-pre-line text-[15.5px] leading-[1.6] text-neutral-800">{p.description}</p>}

        {p.upcoming.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Coming Up Here</h2>
            <div className="mt-1">
              {p.upcoming.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </div>
          </section>
        )}
      </div>

      {gallery.length > 0 && (
        <section className="pt-8 md:col-span-2">
          <Rail size="md">
            {gallery.map((src, i) => (
              <JcMedia key={src} src={src} alt={`${p.name} ${i + 1}`} sizes="62vw" className="aspect-[4/5]" />
            ))}
          </Rail>
        </section>
      )}

      <div className="md:col-span-2">
        <Module title={p.neighborhood ? `More in ${p.neighborhood.name}` : "More Places"} items={nearby} href={jcHref(p.neighborhood ? `/n/${p.neighborhood.slug}` : "/places")} render={(x) => <PlaceCard p={x} />} />
      </div>
    </article>
  );
}
