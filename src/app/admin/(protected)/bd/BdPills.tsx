import { ORGANIZATION_KIND_LABELS, type OrganizationKind } from "@/lib/bd/domain";

const pill = "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide";

export function OrganizationKindPill({ kind }: { kind: OrganizationKind | null }) {
  if (!kind) return null;
  return <span className={`${pill} bg-black/[0.06] text-ink/60`}>{ORGANIZATION_KIND_LABELS[kind]}</span>;
}

export function LinkedBusinessPill() {
  return <span className={`${pill} bg-findmi-50 text-findmi-700`}>Linked Business</span>;
}

export function ArchivedPill() {
  return <span className={`${pill} border border-black/10 bg-white text-ink/50`}>Archived</span>;
}

/** "Private" marker — keeps BD screens visibly distinct from public Findmi. */
export function PrivateBadge() {
  return <span className={`${pill} bg-ink text-white`}>Private</span>;
}
