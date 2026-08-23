/** The pulsing dot Findmi uses to mark a HERE NOW appearance — never shown
 * unless the caller has genuinely confirmed live status via getTemporalLabel. */
export default function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative flex h-2 w-2 shrink-0 ${className}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
