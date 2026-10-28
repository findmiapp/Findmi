import Link from "next/link";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getProfileReviewQueue } from "@/lib/admin/profile-reviews";
import { PUBLIC_FIELD_LABELS, VISIBILITY_LABELS, type PublicVisibility } from "@/lib/profile-visibility";
import { decideBusinessField, decidePublicAction } from "./actions";

export const dynamic = "force-dynamic";

const TONE: Record<PublicVisibility, string> = {
  live: "bg-findmi-50 text-findmi-700",
  pending_review: "bg-amber-50 text-amber-800",
  hidden: "bg-black/5 text-ink/50",
};

function Chip({ status }: { status: PublicVisibility }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[status]}`}>{VISIBILITY_LABELS[status]}</span>;
}

function Decide({ approve, hide, status }: { approve: () => Promise<void>; hide: () => Promise<void>; status: PublicVisibility }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      {status !== "live" && (
        <form action={approve}>
          <button type="submit" className="h-8 rounded-full bg-findmi px-3 text-xs font-bold text-white hover:bg-findmi-600">
            {status === "hidden" ? "Show" : "Approve"}
          </button>
        </form>
      )}
      {status !== "hidden" && (
        <form action={hide}>
          <button type="submit" className="h-8 rounded-full border border-black/10 px-3 text-xs font-bold text-ink/70 hover:border-black/20">
            Hide
          </button>
        </form>
      )}
    </div>
  );
}

/** Profile Approvals — links, contact details, announcements and Profile
 * Buttons that Business members added or changed, held until Findmi
 * approves them (lib/profile-visibility.ts). "Hidden" shows what Findmi
 * chose not to show, so it can be shown again. */
export default async function ProfileReviewsPage({ searchParams }: { searchParams: Promise<{ view?: string; result?: string }> }) {
  const { view, result } = await searchParams;
  const includeHidden = view === "all";
  const admin = getAdminSupabase();
  const queue = admin ? await getProfileReviewQueue(admin, { includeHidden }) : { ready: false, businesses: [], buttons: [] };
  const empty = queue.businesses.length === 0 && queue.buttons.length === 0;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Profile Approvals</h1>
      <p className="mt-1 text-sm text-ink/60">New or changed links, contact details, announcements and buttons from Businesses. Nothing shows on a profile until it&rsquo;s approved.</p>
      <div className="mt-3 flex gap-2">
        {[
          { label: "Pending Review", href: "/admin/profile-reviews", active: !includeHidden },
          { label: "Pending + Hidden", href: "/admin/profile-reviews?view=all", active: includeHidden },
        ].map((t) => (
          <Link key={t.label} href={t.href} className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${t.active ? "bg-ink text-white" : "border border-black/10 text-ink/60 hover:border-black/20"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      {result && <p className="mt-3 rounded-lg bg-findmi-50 px-3 py-2 text-xs font-semibold text-findmi-700">{result}</p>}
      {!queue.ready && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Profile Approvals needs the profile visibility migration (20261122000000_profile_public_visibility.sql). Until it&rsquo;s applied everything stays live, as before.</p>}
      {queue.ready && empty && <p className="mt-4 text-sm text-ink/50">Nothing to review.</p>}

      {queue.businesses.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Links, Contact &amp; Announcements</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {queue.businesses.map((b) => (
              <li key={b.id} className="rounded-xl border border-black/5 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/admin/businesses/${b.id}`} className="truncate text-sm font-semibold text-ink hover:underline">
                    {b.name}
                  </Link>
                  {b.slug && (
                    <Link href={`/business/${b.slug}`} target="_blank" className="shrink-0 text-xs font-semibold text-findmi-700 hover:underline">
                      View Profile
                    </Link>
                  )}
                </div>
                <ul className="mt-2 flex flex-col divide-y divide-black/5">
                  {b.fields.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-center gap-2 py-2 sm:flex-nowrap">
                      <span className="w-24 shrink-0 text-xs font-bold text-ink/50">{PUBLIC_FIELD_LABELS[f.key]}</span>
                      <span className="min-w-0 flex-1 break-words text-sm text-ink">{f.value}</span>
                      <Chip status={f.status} />
                      <Decide status={f.status} approve={decideBusinessField.bind(null, b.id, f.key, "live")} hide={decideBusinessField.bind(null, b.id, f.key, "hidden")} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.buttons.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Profile Buttons</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {queue.buttons.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-black/5 bg-white px-4 py-3 sm:flex-nowrap">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{a.label}</span>
                  <Link href={a.entity.adminHref} className="block truncate text-xs text-ink/50 hover:underline">
                    {a.entity.name} · {a.entity.kind[0].toUpperCase() + a.entity.kind.slice(1)}
                  </Link>
                </span>
                <Chip status={a.status} />
                <Decide status={a.status} approve={decidePublicAction.bind(null, a.id, "live")} hide={decidePublicAction.bind(null, a.id, "hidden")} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
