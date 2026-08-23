import Image from "next/image";
import Link from "next/link";
import LiveDot from "./LiveDot";

export type PostKind = "event" | "business" | "product" | "location" | "person";

// Each post type gets its own shape — matches how the source mockups treat
// events (tall story-style cards) differently from a product or a place.
const ASPECT_BY_KIND: Record<PostKind, string> = {
  event: "aspect-[3/4]",
  business: "aspect-[4/5]",
  product: "aspect-square",
  location: "aspect-[16/10]",
  person: "aspect-[4/5]",
};

const DEFAULT_ICON_BY_KIND: Record<PostKind, IconName> = {
  event: "calendar",
  business: "storefront",
  product: "tag",
  location: "pin",
  person: "user",
};

export interface PostCardMetaLine {
  icon: "calendar" | "pin" | "tag";
  text: string;
}

export interface PostCardProps {
  href?: string | null;
  external?: boolean;
  image: string | null;
  kind: PostKind;
  badgeLabel: string;
  badgeIcon?: IconName;
  /** "live" gives the badge Findmi's HERE NOW treatment — solid teal with a
   * pulsing dot — for a card whose temporal label came back live. */
  badgeVariant?: "default" | "live";
  title: string;
  metaLines?: PostCardMetaLine[];
  price?: string | null;
  cta?: string | null;
  aspect?: string;
}

export default function PostCard({
  href,
  external,
  image,
  kind,
  badgeLabel,
  badgeIcon,
  badgeVariant = "default",
  title,
  metaLines = [],
  price,
  cta,
  aspect,
}: PostCardProps) {
  const card = (
    <div
      className={`group relative w-full overflow-hidden rounded-2xl transition duration-150 active:scale-[0.98] ${
        image ? "bg-black/5" : "bg-gradient-to-br from-stone to-ink"
      } ${aspect ?? ASPECT_BY_KIND[kind]}`}
    >
      {image ? (
        <Image
          src={image}
          alt={title}
          fill
          sizes="(min-width: 768px) 320px, 70vw"
          className="object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        <Icon
          name={badgeIcon ?? DEFAULT_ICON_BY_KIND[kind]}
          className="absolute -bottom-4 -right-4 h-28 w-28 text-white/10"
        />
      )}
      {/* Legibility gradient for the white overlay text, bottom-anchored */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

      <div className="absolute left-3 top-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
            badgeVariant === "live" ? "bg-findmi text-ink" : "bg-black/45 text-white backdrop-blur-sm"
          }`}
        >
          {badgeVariant === "live" ? (
            <LiveDot className="text-ink" />
          ) : (
            <Icon name={badgeIcon ?? DEFAULT_ICON_BY_KIND[kind]} className="h-3.5 w-3.5" />
          )}
          {badgeLabel}
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3.5">
        {/* Bold here is a legibility need (white text over a variable photo),
            not a heaviness choice — kept bold deliberately, unlike headings
            on plain surfaces elsewhere. */}
        <h3 className="line-clamp-2 font-display text-base font-bold leading-snug text-white sm:text-lg">
          {title}
        </h3>

        {metaLines.map((line, i) => (
          <p key={i} className="flex items-center gap-1.5 text-xs text-white/85 sm:text-sm">
            <Icon name={line.icon} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{line.text}</span>
          </p>
        ))}

        {price && <p className="text-sm font-semibold text-white">{price}</p>}

        {cta && (
          <span className="mt-0.5 block rounded-full bg-findmi py-2 text-center text-xs font-bold uppercase tracking-wide text-ink transition group-hover:bg-findmi-600">
            {cta}
          </span>
        )}
      </div>
    </div>
  );

  if (!href) return card;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {card}
      </a>
    );
  }

  return <Link href={href}>{card}</Link>;
}

type IconName = "calendar" | "pin" | "tag" | "storefront" | "user";

function Icon({ name, className }: { name: IconName; className?: string }) {
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "pin":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "tag":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M11.5 4H5a1 1 0 00-1 1v6.5a1 1 0 00.3.7l9 9a1 1 0 001.4 0l6.5-6.5a1 1 0 000-1.4l-9-9a1 1 0 00-.7-.3z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" />
        </svg>
      );
    case "storefront":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M4 9.5L5 4h14l1 5.5M4 9.5a2.2 2.2 0 004.3.7M4 9.5a2.2 2.2 0 004.3.7m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.3-.7M5 10v9.5a1 1 0 001 1h5v-6h2v6h5a1 1 0 001-1V10"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "user":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4.5 20c1.3-3.5 4.3-5.5 7.5-5.5s6.2 2 7.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
  }
}
