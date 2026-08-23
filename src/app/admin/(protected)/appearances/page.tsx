import Link from "next/link";
import { getAdminAppearances } from "@/lib/admin/queries";
import { formatDateRange } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminAppearancesPage() {
  const appearances = await getAdminAppearances();

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Appearances
        </h1>
        <Link
          href="/admin/appearances/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Appearance
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {appearances.length === 0 ? (
          <p className="text-sm text-ink/50">No appearances yet.</p>
        ) : (
          appearances.map((a) => (
            <Link
              key={a.id}
              href={`/admin/appearances/${a.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {a.business?.name ?? "—"} → {a.title}
                </p>
                <p className="truncate text-xs text-ink/45">
                  {formatDateRange(a.start_at, a.end_at)}
                  {a.event ? ` · Event: ${a.event.name}` : " · No event (Maps fallback)"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  a.status === "canceled"
                    ? "bg-black/[0.06] text-ink/50"
                    : a.status === "tentative"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-findmi-50 text-findmi-700"
                }`}
              >
                {a.status}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
