// AI processing disclosure (Trust & Privacy Phase 2A). Shown only where
// Findmi actually sends what a person provides (a link, text, a flyer
// image or a website) to an automated extraction tool: the Business event
// importer and the website-based brand builder. Moments and messages are
// not processed this way, so this notice never appears there.
export default function AutomatedToolsNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-metadata leading-relaxed text-muted ${className}`}>
      Findmi may use automated tools to extract and organize information you provide. Review the information before publishing.
    </p>
  );
}
