// A compact cue that one Event date has its own details
// (event_occurrences.details). The details themselves are never put on a
// compact card — opening the date shows them (the Event page's selected
// date / its Quick View). Renders nothing without details.
export default function OccurrenceDetailsHint({ details, show, className = "" }: { details?: string | null; show?: boolean; className?: string }) {
  if (!(show ?? Boolean(details?.trim()))) return null;
  return (
    <span data-occurrence-details-hint="" className={`inline-flex w-fit items-center rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700 ${className}`}>
      Details
    </span>
  );
}
