import type { PageTrust } from "@/lib/provenance";
import TrustActions from "./TrustActions";

/** About This Page: where a public Business / Event / Location page's
 * information came from (lib/provenance getPageTrust) plus the free
 * Suggest A Correction / Request Removal / Report actions. Subtle by
 * design: one small card near the end of the page, never a warning.
 * Never claims Findmi verified the page's facts. */
export default function AboutThisPage({
  entityType,
  entityId,
  entityName,
  trust,
  className = "",
}: {
  entityType: "business" | "event" | "location";
  entityId: string;
  entityName: string;
  trust: PageTrust | null;
  className?: string;
}) {
  const state = trust?.state ?? "unclaimed";
  const line =
    state === "managed"
      ? `${entityName} manages this page on Findmi.`
      : state === "compiled_by_findmi"
        ? "Information on this page was compiled by Findmi from publicly available information. This page has not yet been claimed by the organization."
        : state === "community_added"
          ? "This page was added to Findmi by a member of the community and reviewed by Findmi before it appeared. It has not yet been claimed by the organization."
          : "This page has not yet been claimed by the organization, so its details haven't been confirmed by them.";

  return (
    <section aria-labelledby={`about-page-${entityId}`} className={className}>
      <div className="rounded-2xl border border-black/5 bg-white px-4 py-3.5">
        <p id={`about-page-${entityId}`} className="text-label font-bold uppercase text-subtle">
          About This Page
        </p>
        <p className="mt-1 text-metadata leading-relaxed text-secondary">{line}</p>
        <TrustActions entityType={entityType} entityId={entityId} entityName={entityName} className="mt-1.5" />
      </div>
    </section>
  );
}
