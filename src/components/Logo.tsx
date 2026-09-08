import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

// Native size is 1189x484 (~2.457:1). Sized here so it reads clearly at
// header height without ever upscaling the source asset. Highperlocal Prep,
// Pass 1 — this ratio assumes the FindMi lockup's own proportions; a real
// Highperlocal logo asset may need its own ratio once supplied (see
// siteConfig.logoSrc's own comment — no such asset exists yet).
const LOCKUP_RATIO = 1189 / 484;

export default function Logo({
  className = "",
  heightClassName = "h-8",
}: {
  className?: string;
  heightClassName?: string;
}) {
  return (
    <Link href="/" className={`flex shrink-0 items-center ${className}`}>
      <Image
        src={siteConfig.logoSrc}
        alt={siteConfig.logoAlt}
        width={Math.round(484 * LOCKUP_RATIO)}
        height={484}
        priority
        className={`w-auto ${heightClassName}`}
      />
    </Link>
  );
}
