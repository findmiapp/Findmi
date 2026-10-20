import Image from "next/image";
import Link from "next/link";
import { getSite } from "@/lib/site";

// Native size is 1189x484 (~2.457:1). Sized here so it reads clearly at
// header height without ever upscaling the source asset.
const LOCKUP_RATIO = 1189 / 484;

/** Wordmark text size for each header height the app uses. */
const WORDMARK_TEXT: Record<string, string> = { "h-11": "text-[22px]", "h-10": "text-[21px]", "h-8": "text-lg", "h-7": "text-[17px]" };

export default function Logo({
  className = "",
  heightClassName = "h-8",
}: {
  className?: string;
  heightClassName?: string;
}) {
  const { logo } = getSite();
  if (logo.kind === "wordmark") {
    // A site without an image lockup (lib/site.ts): its name set in the
    // app's own display type, sized to the same header slot.
    return (
      <Link href="/" className={`flex shrink-0 items-center ${heightClassName} ${className}`}>
        <span className={`font-display font-bold tracking-tight text-ink ${WORDMARK_TEXT[heightClassName] ?? "text-xl"}`}>
          {logo.primary}
          <span className="text-findmi">{logo.secondary}</span>
        </span>
      </Link>
    );
  }
  return (
    <Link href="/" className={`flex shrink-0 items-center ${className}`}>
      <Image
        src={logo.src}
        alt={logo.alt}
        width={Math.round(484 * LOCKUP_RATIO)}
        height={484}
        priority
        className={`w-auto ${heightClassName}`}
      />
    </Link>
  );
}
