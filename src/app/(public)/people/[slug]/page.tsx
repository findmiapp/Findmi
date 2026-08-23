import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import Link from "next/link";
import CompactCard from "@/components/CompactCard";
import { getBusinessesForPerson, getPersonBySlug } from "@/lib/data";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const person = await getPersonBySlug(slug);
  if (!person) return { title: "Person not found" };
  return {
    title: person.name,
    description: person.short_bio ?? `Meet ${person.name} on FindMi.`,
    openGraph: {
      title: person.name,
      description: person.short_bio ?? undefined,
      images: person.image_url ? [person.image_url] : undefined,
    },
  };
}

export default async function PersonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const person = await getPersonBySlug(slug);
  if (!person) notFound();

  const businesses = await getBusinessesForPerson(person.id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full border-4 border-paper bg-mist shadow-sm sm:h-32 sm:w-32">
          {person.image_url ? (
            <Image src={person.image_url} alt={person.name} fill sizes="128px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-ink/20">
              {person.name.charAt(0)}
            </div>
          )}
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{person.name}</h1>
          {person.location && <p className="mt-1 text-sm text-ink/50">{person.location}</p>}
          <div className="mt-2 flex flex-wrap gap-3">
            {person.instagram_url && (
              <a
                href={person.instagram_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-findmi-700 hover:underline"
              >
                Instagram
              </a>
            )}
            {person.website_url && (
              <a
                href={person.website_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-findmi-700 hover:underline"
              >
                Website
              </a>
            )}
          </div>
        </div>
      </div>

      {person.short_bio && <p className="mt-6 max-w-2xl whitespace-pre-line text-base leading-relaxed text-ink/70">{person.short_bio}</p>}

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">Brands</h2>
        {businesses.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">No public FindMi brands linked yet.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {businesses.map((b) => (
              <CompactCard
                key={b.id}
                href={`/business/${b.slug}`}
                image={b.cover_image_url}
                title={b.name}
                cta="View Profile"
              />
            ))}
          </div>
        )}
      </section>

      <p className="mt-10 text-sm text-ink/40">
        <Link href="/people" className="font-medium text-ink underline underline-offset-2">
          ← All People
        </Link>
      </p>
    </div>
  );
}
