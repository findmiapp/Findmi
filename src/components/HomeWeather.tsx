import type { WeatherCondition, WeatherContextData } from "@/lib/weather";

/** Compact single-row local context module, above the Hero (Homepage
 * Local Weather Context V1; Above-the-Fold Polish pass inverted it to a
 * dark ink strip). Understated on purpose: no card, no gradient, no
 * illustration — small icon + temperature + city on one side, date +
 * local time on the other, both `whitespace-nowrap` internally but free
 * to wrap onto their own line at narrow widths via the flex container.
 * The dark treatment (ink background, white/soft-white text, aqua icon
 * accent) reads as a deliberate live/context strip distinct from the
 * white page beneath it — same FindMi Aqua/ink pairing used elsewhere,
 * not a new palette. Renders nothing if weather is fully unavailable
 * (see lib/weather.ts's fail-soft contract) or if the founder has turned
 * the module off — never an error, never a blank gap. */
export default function HomeWeather({ context }: { context: WeatherContextData | null }) {
  if (!context) return null;
  const { cityLabel, timeZone, conditions } = context;

  const now = new Date();
  let datePart: string;
  let timePart: string;
  try {
    datePart = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(now);
    timePart = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(now);
  } catch {
    // An unrecognized timezone string would throw at format time — fail
    // soft to nothing rather than crashing the homepage over a clock.
    return null;
  }

  return (
    <section className="bg-ink px-4 py-2 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/65 sm:text-sm">
        {conditions ? (
          <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-white">
            <WeatherGlyph condition={conditions.condition} className="h-4 w-4 shrink-0 text-findmi" />
            {conditions.tempF}°<span className="font-normal text-white/30">·</span>
            {cityLabel}
          </span>
        ) : (
          <span className="whitespace-nowrap font-semibold text-white">{cityLabel}</span>
        )}
        <span className="whitespace-nowrap text-white/65">
          {datePart} <span className="text-white/30">·</span> {timePart}
        </span>
      </div>
    </section>
  );
}

function WeatherGlyph({ condition, className }: { condition: WeatherCondition; className?: string }) {
  switch (condition) {
    case "clear":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3L5.6 5.6"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      );
    case "fog":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M6 9.5a4.5 4.5 0 018.9-1"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <path d="M3.5 13h17M3.5 16.5h17M3.5 20h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M6.5 10.5a4.5 4.5 0 118.6-1.9A4 4 0 0118 16.5H7a3.5 3.5 0 01-.5-6z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M8.5 19l-1 2M12.5 19l-1 2M16.5 19l-1 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "snow":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M6.5 10.5a4.5 4.5 0 118.6-1.9A4 4 0 0118 16.5H7a3.5 3.5 0 01-.5-6z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M9 19.5l-.6 1.5M12 19.5v2M15 19.5l.6 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "storm":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M6.5 10.5a4.5 4.5 0 118.6-1.9A4 4 0 0118 16.5H7a3.5 3.5 0 01-.5-6z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M13 15.5l-2.5 4h2.5l-1.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "cloudy":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M6.5 10.5a4.5 4.5 0 118.6-1.9A4 4 0 0118 16.5H7a3.5 3.5 0 01-.5-6z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}
