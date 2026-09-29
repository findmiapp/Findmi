"use client";

import Link from "next/link";
import SupabaseImage from "./SupabaseImage";
import { trackEvent } from "@/lib/analytics/track";
import type { ResolvedHomepageBulletin } from "@/lib/homepage-bulletins";

/** Homepage Bulletin — a thin, editorial NEWS/ANNOUNCEMENT strip, not an
 * Event card and not a marketing banner. Object-agnostic: takes only the
 * already-resolved shape (see lib/homepage-bulletins.ts) and renders it —
 * no illy/Cup of Love assumptions, no Event-specific fields. Reused
 * verbatim by the admin create/edit preview, so there is exactly one
 * styled implementation, not two that can drift apart.
 *
 * Interaction: ONE semantic link wraps the whole strip when there's a
 * real destination (never a button-in-anchor or a competing overlay); a
 * missing destination renders the identical content in a plain, non-
 * interactive wrapper instead of a dead link — no CTA is ever shown
 * without somewhere real to go. */
export default function HomepageBulletin({ bulletin }: { bulletin: ResolvedHomepageBulletin | null }) {
  if (!bulletin) return null;

  const isExternal = bulletin.href ? /^https?:\/\//i.test(bulletin.href) : false;

  const content = (
    <>
      {bulletin.thumbnailUrl && (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-black/5">
          <SupabaseImage src={bulletin.thumbnailUrl} alt="" fill sizes="48px" className="object-cover" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {bulletin.eyebrow && (
          <p className="flex items-center gap-1.5 text-label uppercase text-findmi-700">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-findmi" />
            {bulletin.eyebrow}
          </p>
        )}
        {/* Above-the-Fold Polish pass — line-clamp-2 was truncating real
            destinations ("...coming to Hudson...") before the actual
            place name. line-clamp-3 gives headlines that need it room to
            finish without meaningfully growing the strip's height for the
            common (1-2 line) case. */}
        <p className={`text-card-title font-bold leading-tight text-ink line-clamp-3 ${bulletin.eyebrow ? "mt-0.5" : ""}`}>
          {bulletin.headline}
        </p>
        {bulletin.supportingText && (
          <p className="mt-0.5 text-metadata leading-snug text-ink/60 line-clamp-2">{bulletin.supportingText}</p>
        )}
        {bulletin.metaText && <p className="mt-0.5 text-microcopy text-ink/40">{bulletin.metaText}</p>}
      </div>
      {bulletin.href && bulletin.ctaText && (
        <span className="ml-0.5 max-w-[4.5rem] shrink-0 self-center text-right text-[10px] font-bold uppercase leading-tight text-findmi-700">
          {bulletin.ctaText} ›
        </span>
      )}
    </>
  );

  const className =
    "flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 transition hover:border-black/20";

  const bulletinId = bulletin.id;
  const destinationType = bulletin.destinationType;
  function handleClick() {
    trackEvent({
      event_name: "entity_click",
      placement: "homepage_bulletin",
      metadata: { bulletin_id: bulletinId, destination_type: destinationType, action: "bulletin_destination" },
    });
  }

  if (!bulletin.href) {
    return <div className={className}>{content}</div>;
  }

  if (isExternal) {
    return (
      <a href={bulletin.href} target="_blank" rel="noopener noreferrer" onClick={handleClick} className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={bulletin.href} onClick={handleClick} className={className}>
      {content}
    </Link>
  );
}
