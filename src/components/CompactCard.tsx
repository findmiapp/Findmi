import Image from "next/image";
import Link from "next/link";

// Small, normal-flow image+title+meta card — not the tall PostCard-based
// "story" card (BusinessCard/EventCard), which is right for a signature
// moment or a full grid page but consumes too much height in a dense row
// or roster. Shared by the homepage's secondary rows and the event page's
// "Who You'll Find Here" roster.
export default function CompactCard({
  href,
  image,
  title,
  meta,
  cta,
}: {
  href: string;
  image: string | null;
  title: string;
  meta?: string;
  cta?: string;
}) {
  return (
    <Link href={href} className="block">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-mist">
        {image && <Image src={image} alt={title} fill sizes="160px" className="object-cover" />}
      </div>
      <p className="mt-1.5 line-clamp-1 text-sm font-semibold text-ink">{title}</p>
      {meta && <p className="line-clamp-1 text-xs text-ink/50">{meta}</p>}
      {cta && (
        <p className="mt-0.5 text-xs font-bold uppercase tracking-wide text-findmi-700">{cta} →</p>
      )}
    </Link>
  );
}
