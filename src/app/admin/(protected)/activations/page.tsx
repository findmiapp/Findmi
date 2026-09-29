import Link from "next/link";
import { getAdminActivations, type ActivationPhase } from "@/lib/admin/activations";

export const dynamic = "force-dynamic";

// Pass 1 — no archive/trash lifecycle exists on activations yet (unlike
// Businesses/Events/Locations), so this is a plain phase filter, not a
// lifecycle-tab pattern. Order mirrors the phase progression itself.
const PHASE_TABS: { value: ActivationPhase | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "exploring", label: "Exploring" },
  { value: "applications_open", label: "Applications Open" },
  { value: "confirmed", label: "Confirmed" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

const PHASE_LABEL: Record<ActivationPhase, string> = {
  draft: "Draft",
  exploring: "Exploring",
  applications_open: "Applications Open",
  confirmed: "Confirmed",
  live: "Live",
  completed: "Completed",
  archived: "Archived",
};

const PHASE_TONE: Record<ActivationPhase, string> = {
  draft: "bg-black/[0.06] text-subtle",
  exploring: "bg-findmi-50 text-accent",
  applications_open: "bg-findmi-50 text-accent",
  confirmed: "bg-amber-100 text-amber-800",
  live: "bg-findmi text-white",
  completed: "bg-black/[0.06] text-muted",
  archived: "bg-black/[0.06] text-subtle",
};

export default async function AdminActivationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; phase?: string; saved?: string }>;
}) {
  const { q, phase: phaseParam, saved } = await searchParams;
  const phaseTab = PHASE_TABS.find((t) => t.value === phaseParam)?.value ?? "all";

  const activations = await getAdminActivations({
    q,
    phase: phaseTab === "all" ? undefined : phaseTab,
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-page-title font-bold text-primary">Activations</h1>
        <Link
          href="/admin/activations/new"
          className="rounded-full bg-findmi px-4 py-2 text-label font-bold uppercase text-white hover:bg-findmi-600"
        >
          Add Activation
        </Link>
      </div>
      <p className="mt-1.5 text-body text-muted">
        Real-world experiences FindMi produces and curates — starting with FindMi Showroom: SoHo.
      </p>

      {saved && <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">Saved.</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {PHASE_TABS.map((tab) => {
          const active = phaseTab === tab.value;
          const params = new URLSearchParams();
          if (tab.value !== "all") params.set("phase", tab.value);
          if (q) params.set("q", q);
          const href = `/admin/activations${params.toString() ? `?${params.toString()}` : ""}`;
          return (
            <Link
              key={tab.value}
              href={href}
              className={`rounded-full px-3 py-1.5 text-label font-bold uppercase ${
                active ? "bg-ink text-white" : "border border-black/10 text-muted hover:border-black/20"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <form method="get" className="mt-4">
        {phaseTab !== "all" && <input type="hidden" name="phase" value={phaseTab} />}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name, slug, or city…"
          className="w-full max-w-sm rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
        />
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {activations.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-center text-body text-muted">
            No Activations yet.
          </p>
        ) : (
          activations.map((a) => (
            <Link
              key={a.id}
              href={`/admin/activations/${a.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-card-title font-semibold text-primary">{a.public_name || a.internal_name}</p>
                <p className="mt-0.5 truncate text-metadata text-muted">
                  {[a.city, a.region].filter(Boolean).join(", ") || "No city set"}
                  {!a.is_published && " · Unpublished"}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-label font-bold uppercase ${PHASE_TONE[a.phase]}`}>
                {PHASE_LABEL[a.phase]}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
