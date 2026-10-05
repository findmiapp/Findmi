import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JournalCollection from "@/components/journal/JournalCollection";
import ChevronIcon from "@/components/ChevronIcon";
import { getBusinessBySlug, getEventBySlug, getLocationBySlug, getProductBySlug } from "@/lib/data";
import { getPublicJournalCollection, momentsHeading, type JournalSubjectType } from "@/lib/journal-distribution";
import { resolvePublicJournalAuthor } from "@/lib/journal-author";

/** Journal Distribution V1 — the "See all" destination for one public
 * object's Journal collection: /journal?business=<slug> (or event=,
 * location=, product=). Slugs, not ids, matching every other public
 * route. Subjects resolve through the same public loaders their own pages
 * use, so a hidden/unpublished object 404s here too. Keyset-paginated
 * ("Older experiences"); the exact total is computed on the first page
 * only. Deliberately not a global Journal homepage — no subject, no page.
 *
 * Recovery pass — /journal?author=<entryId>: one author's public Journal
 * (the byline link on an entry). Keyed on a PUBLIC entry, never a user id
 * or email; the author resolves server-side and only their public,
 * published entries list, newest first. */

const PAGE_SIZE = 24;
const SUBJECT_TYPES: JournalSubjectType[] = ["business", "event", "location", "product"];

type SearchParams = Partial<Record<JournalSubjectType | "author" | "cursor", string>>;
type Subject = { type: JournalSubjectType | "author"; id: string; name: string; href: string; slug: string; heading: string };

async function resolveSubject(params: SearchParams): Promise<Subject | null> {
  if (params.author) {
    const author = await resolvePublicJournalAuthor(params.author);
    if (!author) return null;
    const name = author.name ?? "Findmi Member";
    return { type: "author", id: author.userId, name, href: `/journal/${params.author}`, slug: params.author, heading: `${name}'s Journal` };
  }
  const subject = await resolveEntitySubject(params);
  return subject ? { ...subject, heading: momentsHeading(subject.type, subject.name) } : null;
}

async function resolveEntitySubject(params: SearchParams) {
  const type = SUBJECT_TYPES.find((t) => typeof params[t] === "string" && params[t]);
  if (!type) return null;
  const slug = params[type] as string;
  if (type === "business") {
    const b = await getBusinessBySlug(slug);
    return b ? { type, id: b.id, name: b.name, href: `/business/${b.slug}`, slug: b.slug } : null;
  }
  if (type === "event") {
    const e = await getEventBySlug(slug);
    return e ? { type, id: e.id, name: e.name, href: `/event/${e.slug}`, slug: e.slug } : null;
  }
  if (type === "location") {
    const l = await getLocationBySlug(slug);
    return l ? { type, id: l.id, name: l.name, href: `/location/${l.slug}`, slug: l.slug } : null;
  }
  const p = await getProductBySlug(slug);
  return p ? { type, id: p.id, name: p.name, href: `/product/${p.slug}`, slug: p.slug } : null;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const subject = await resolveSubject(await searchParams);
  if (!subject) return { title: "Moments" };
  return {
    title: subject.heading,
    description: `${subject.heading} on Findmi.`,
  };
}

export default async function JournalCollectionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const subject = await resolveSubject(params);
  if (!subject) notFound();

  const cursor = params.cursor ?? null;
  const page = await getPublicJournalCollection({
    subjectType: subject.type,
    subjectId: subject.id,
    limit: PAGE_SIZE,
    cursor,
    withCount: !cursor,
  });
  const base = `/journal?${subject.type}=${encodeURIComponent(subject.slug)}`;
  const heading = subject.heading;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <Link href={subject.href} className="inline-flex items-center gap-1 text-xs font-semibold text-findmi-700 hover:underline">
        <ChevronIcon direction="left" className="h-3 w-3" />
        {subject.type === "author" ? "Back To Moment" : subject.name}
      </Link>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{heading}</h1>
      {page.total != null && (
        <p className="mt-1 text-sm text-ink/55">
          {page.total} {page.total === 1 ? "moment" : "moments"}
        </p>
      )}

      <div className="mt-6">
        {page.entries.length > 0 ? (
          <JournalCollection entries={page.entries} layout="grid" />
        ) : (
          <p className="text-sm text-ink/50">No more moments.</p>
        )}
      </div>

      {(page.nextCursor || cursor) && (
        <nav className="mt-8 flex items-center justify-between gap-3 text-sm font-semibold">
          {cursor ? (
            <Link href={base} className="inline-flex items-center gap-1 text-ink/60 hover:text-ink">
              <ChevronIcon direction="left" className="h-3 w-3" />
              Newest
            </Link>
          ) : (
            <span />
          )}
          {page.nextCursor && (
            <Link href={`${base}&cursor=${encodeURIComponent(page.nextCursor)}`} className="inline-flex items-center gap-1 text-findmi-700 hover:underline">
              Older Moments
              <ChevronIcon direction="right" className="h-3 w-3" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
