import Link from "next/link";

// Final refinement pass, items 4/8 — shared Bulletin/Announcement pattern
// for both Business Profile and Event Detail. Deliberately restrained:
// light aqua tint, thin border — reads as a real, timely notice ("Booking
// fall events now", "Rain or shine"), never as an advertisement or a
// giant CTA block. Renders nothing when there's no real body text —
// callers should only mount this when bulletin_enabled &&
// bulletin_body?.trim() are both true, but the empty check lives here too
// as a backstop against ever rendering an empty box.
//
// Business Profile polish pass — extended (not replaced/duplicated) with
// two new OPTIONAL props: `label` (founder-editable, e.g. "Flash Sale" —
// still defaults to "Bulletin" when omitted entirely, exactly like
// before, so Event Detail's existing call site is byte-identical in
// behavior) and `url` (an already-validated safe destination — the
// caller is responsible for validation, same convention as this page's
// other pre-filtered props like socialLinks; this component just decides
// how to render a link vs. a static block). Passing a bad/unsafe string
// as `url` is a caller bug, not something this component re-checks.
export default function Bulletin({
  label,
  heading,
  body,
  url,
}: {
  label?: string | null;
  heading?: string | null;
  body?: string | null;
  url?: string | null;
}) {
  const text = body?.trim();
  if (!text) return null;

  const displayLabel = label?.trim() || "Bulletin";
  const external = url ? /^https:\/\//i.test(url) : false;

  const content = (
    <>
      <MegaphoneGlyph className="h-6 w-6 shrink-0 text-findmi-700" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">{displayLabel}</p>
        {heading?.trim() && <p className="mt-0.5 text-sm font-bold text-ink">{heading.trim()}</p>}
        <p className="mt-0.5 whitespace-pre-line text-sm text-ink/75">{text}</p>
      </div>
      {url && <ChevronGlyph className="h-4 w-4 shrink-0 self-center text-findmi-700/60" />}
    </>
  );

  const boxClass = "flex items-center gap-3 rounded-2xl border border-findmi/25 bg-findmi-50/70 px-4 py-3.5";

  if (url) {
    // Item 5 — the whole block is the clickable target (not a small link
    // buried inside it), with the chevron above as the visual affordance
    // that it goes somewhere. Internal path vs. external URL matches
    // every other destination on this page (Link for "/...", a plain
    // anchor for "https://...").
    if (external) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={`${boxClass} transition hover:border-findmi/40 hover:bg-findmi-50`}
        >
          {content}
        </a>
      );
    }
    return (
      <Link href={url} className={`${boxClass} transition hover:border-findmi/40 hover:bg-findmi-50`}>
        {content}
      </Link>
    );
  }

  return <div className={boxClass}>{content}</div>;
}

function MegaphoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 10v4a1 1 0 001 1h2l4.2 3.3a1 1 0 001.6-.8V6.5a1 1 0 00-1.6-.8L6 9H4a1 1 0 00-1 1z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M15.5 9c1 .9 1 4.1 0 5M18 6.5c2 1.8 2 9.2 0 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
