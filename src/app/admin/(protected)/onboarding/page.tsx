import Link from "next/link";
import {
  billingStatusLabel,
  getAdminMemberships,
  onboardingStatusLabel,
  publicationStatusLabel,
} from "@/lib/admin/membership-queries";

export const dynamic = "force-dynamic";

const VIEWS = [
  { value: undefined, label: "All" },
  { value: "pending_review", label: "Pending Review" },
  { value: "paid_incomplete", label: "Paid / Incomplete" },
  { value: "comped_pending", label: "Comped / Pending" },
  { value: "approved_live", label: "Approved / Live" },
  { value: "rejected", label: "Rejected" },
] as const;

export default async function AdminOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { q, view } = await searchParams;
  const activeView = VIEWS.find((v) => v.value === view)?.value;
  const memberships = await getAdminMemberships({ q, view: activeView });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Onboarding</h1>
        <div className="flex items-center gap-3">
          <a
            href="/admin/api/onboarding/export"
            className="text-xs font-semibold text-ink/60 hover:text-ink"
          >
            Export CSV
          </a>
          <Link
            href="/admin/onboarding/new"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
          >
            New Invite
          </Link>
        </div>
      </div>

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by business, contact, or email…"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs"
        />
        <input type="hidden" name="view" value={view ?? ""} />
        <button
          type="submit"
          className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]"
        >
          Search
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => {
          const active = v.value === activeView || (v.value === undefined && !activeView);
          const href = `/admin/onboarding${v.value ? `?view=${v.value}` : ""}${q ? `${v.value ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`;
          return (
            <Link
              key={v.label}
              href={href}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                active ? "bg-ink text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.08]"
              }`}
            >
              {v.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {memberships.length === 0 ? (
          <p className="text-sm text-ink/50">No onboarding records found.</p>
        ) : (
          memberships.map((m) => (
            <Link
              key={m.id}
              href={`/admin/onboarding/${m.id}`}
              className="flex flex-col gap-1.5 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-ink">
                  {m.business?.name ?? m.intended_business_name ?? "Untitled business"}
                </p>
                <span className="shrink-0 text-[11px] text-ink/40">
                  {new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <p className="truncate text-xs text-ink/50">
                {[m.contact_name, m.contact_email].filter(Boolean).join(" · ") || "No contact on file"}
                {m.plan ? ` · ${m.plan.name}` : ""}
                {m.markets.length ? ` · ${m.markets.map((mk) => mk.name).join(", ")}` : ""}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{billingStatusLabel(m.billing_status)}</Badge>
                <Badge>{onboardingStatusLabel(m.onboarding_status)}</Badge>
                <Badge tone={m.publication_status === "live" ? "live" : m.publication_status === "rejected" ? "rejected" : "default"}>
                  {publicationStatusLabel(m.publication_status)}
                </Badge>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "live" | "rejected" }) {
  const cls =
    tone === "live"
      ? "bg-findmi-50 text-findmi-700"
      : tone === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-black/[0.06] text-ink/60";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}
