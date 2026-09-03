import Link from "next/link";
import { listAdminUsers } from "@/lib/admin/user-queries";
import { formatDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const users = await listAdminUsers(q);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Users</h1>
          <p className="mt-1 text-sm text-ink/50">
            Consumer &amp; vendor FindMi accounts. Founder admin sign-in is separate and isn&rsquo;t managed here.
          </p>
        </div>
        <Link
          href="/admin/users/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          + Create User
        </Link>
      </div>

      <form className="mt-4" action="/admin/users">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by email or name…"
          className="w-full max-w-sm rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {users.length === 0 ? (
          <p className="rounded-xl border border-black/10 bg-mist/30 px-4 py-6 text-center text-sm text-ink/45">
            {q ? "No users match that search." : "No accounts yet."}
          </p>
        ) : (
          users.map((u) => {
            const confirmed = Boolean(u.emailConfirmedAt);
            return (
              <Link
                key={u.id}
                href={`/admin/users/${u.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 transition hover:border-findmi/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{u.displayName || "No display name"}</p>
                  <p className="truncate text-sm text-ink/60">{u.email ?? "—"}</p>
                  <p className="mt-0.5 truncate text-[11px] text-ink/35">{u.id}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      confirmed ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/50"
                    }`}
                  >
                    {confirmed ? "Confirmed" : "Awaiting confirmation / setup"}
                  </span>
                  <span className="text-[11px] text-ink/40">Created {formatDateShort(u.createdAt)}</span>
                  <span className="text-[11px] text-ink/40">
                    {u.lastSignInAt ? `Last sign-in ${formatDateShort(u.lastSignInAt)}` : "Never signed in"}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
