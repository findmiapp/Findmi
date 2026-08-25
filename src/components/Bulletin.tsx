// Final refinement pass, items 4/8 — shared Bulletin/Announcement pattern
// for both Business Profile and Event Detail. Deliberately restrained:
// light aqua tint, thin border, small icon — reads as a real, timely
// notice ("Booking fall events now", "Rain or shine"), never as an
// advertisement or a giant CTA block. Renders nothing when there's no
// real body text — callers should only mount this when
// bulletin_enabled && bulletin_body?.trim() are both true, but the empty
// check lives here too as a backstop against ever rendering an empty box.
export default function Bulletin({
  heading,
  body,
}: {
  heading?: string | null;
  body?: string | null;
}) {
  const text = body?.trim();
  if (!text) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-findmi/25 bg-findmi-50/70 px-3.5 py-3">
      <MegaphoneGlyph className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">Bulletin</p>
        {heading?.trim() && <p className="mt-0.5 text-sm font-bold text-ink">{heading.trim()}</p>}
        <p className="mt-0.5 whitespace-pre-line text-sm text-ink/75">{text}</p>
      </div>
    </div>
  );
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
