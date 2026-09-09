"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

// Native size is 1189x484 (~2.457:1). Sized here so it reads clearly at
// header height without ever upscaling the source asset. Highperlocal Prep,
// Pass 1 — this ratio assumes the FindMi lockup's own proportions; a real
// Highperlocal logo asset may need its own ratio once supplied (see
// siteConfig.logoSrc's own comment — no such asset exists yet).
const LOCKUP_RATIO = 1189 / 484;

/**
 * Highperlocal Prep, Pass 5 — text-logo fallback. Highperlocal's real logo
 * asset (siteConfig.logoSrc: "/logo-lockup-highperlocal.png") doesn't exist
 * in /public yet (brand assets/final colors deliberately deferred — see this
 * pass's report), so `next/image` would otherwise render a broken image in
 * every header/footer/nav on a Highperlocal deployment. On an `onError`
 * from the real <Image>, this swaps to siteConfig.siteName ("Highperlocal")
 * rendered in the app's existing display typography/brand color — same
 * approach already used for card wordmark fallbacks (see BusinessLogoCard).
 *
 * Scoped to `highperlocal` only — findmi's <Image> and its render path are
 * byte-for-byte unchanged from before this pass; onError is wired but findmi
 * ships a real /logo-lockup.png, so it's never expected to fire there.
 */
export default function Logo({
  className = "",
  heightClassName = "h-8",
}: {
  className?: string;
  heightClassName?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showTextFallback = imageFailed && siteConfig.brand === "highperlocal";

  return (
    <Link href="/" className={`flex shrink-0 items-center ${className}`}>
      {showTextFallback ? (
        <span
          className={`flex items-center font-display text-xl font-bold tracking-tight text-findmi-700 sm:text-2xl ${heightClassName}`}
        >
          {siteConfig.siteName}
        </span>
      ) : (
        <Image
          src={siteConfig.logoSrc}
          alt={siteConfig.logoAlt}
          width={Math.round(484 * LOCKUP_RATIO)}
          height={484}
          priority
          className={`w-auto ${heightClassName}`}
          onError={() => setImageFailed(true)}
        />
      )}
    </Link>
  );
}
