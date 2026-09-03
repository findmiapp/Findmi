"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * AdminToolbar's contextual "Edit This Page" link. Business/event/
 * product/location/person pages already each render their own
 * AdminEditButton (see that component) — a real, already-admin-gated
 * `<a aria-label="Edit in Admin" href="/admin/.../<id>">` pointing at
 * that exact record's real admin editor, built server-side from data the
 * page already fetched. Rather than a second, parallel lookup here
 * (re-resolving the current slug back into an id — a duplicate of each
 * page's own data fetch, and a second place a route could drift from the
 * real editor), this simply reads that existing anchor's href off the
 * DOM once it's rendered: the toolbar only ever mirrors a link that's
 * already there and already correct, never invents or guesses one of its
 * own. On any page without that anchor (homepage, search, cart, etc.)
 * this renders nothing, which is the correct "omit it" behavior for
 * every unsupported page type too.
 */
export default function AdminEditThisPageLink() {
  const pathname = usePathname();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const anchor = document.querySelector<HTMLAnchorElement>('a[aria-label="Edit in Admin"]');
    setHref(anchor?.getAttribute("href") ?? null);
  }, [pathname]);

  if (!href) return null;

  return (
    <Link
      href={href}
      className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-white transition hover:text-white/80"
    >
      <span aria-hidden="true">✎</span> Edit This Page
    </Link>
  );
}
