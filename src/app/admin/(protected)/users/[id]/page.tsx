import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminUserAccount,
  getUserBusinessAccess,
  getUserEventAccess,
  getUserInheritedProducts,
} from "@/lib/admin/user-queries";
import { formatDateShort } from "@/lib/format";
import { RelationField } from "@/components/admin/RelationPicker";
import SetPasswordForm from "./SetPasswordForm";
import {
  assignUserToBusiness,
  assignUserToEvent,
  removeUserBusinessAccess,
  removeUserEventAccess,
  sendPasswordResetEmail,
  setUserPassword,
} from "./actions";

export const dynamic = "force-dynamic";

const CREATED_LABEL: Record<string, string> = {
  invite: "Account created — a setup email was sent.",
  password: "Account created with a temporary password.",
};

const PASSWORD_ACTION_LABEL: Record<string, string> = {
  reset_sent: "Password reset email sent.",
  set: "New password set.",
};

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; created?: string; password_action?: string; access_updated?: string }>;
}) {
  const { id } = await params;
  const { error, created, password_action } = await searchParams;

  const [account, businesses, events, productGroups] = await Promise.all([
    getAdminUserAccount(id),
    getUserBusinessAccess(id),
    getUserEventAccess(id),
    getUserInheritedProducts(id),
  ]);
  if (!account) notFound();

  const confirmed = Boolean(account.emailConfirmedAt);
  const assignBusiness = assignUserToBusiness.bind(null, id);
  const assignEvent = assignUserToEvent.bind(null, id);
  const sendReset = sendPasswordResetEmail.bind(null, id);
  const setPassword = setUserPassword.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {account.displayName || account.email || "User"}
        </h1>
        <Link href="/admin/users" className="text-xs font-semibold text-ink/50 hover:text-ink">
          ← Back to Users
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {created && CREATED_LABEL[created] && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {CREATED_LABEL[created]}
        </p>
      )}
      {password_action && PASSWORD_ACTION_LABEL[password_action] && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {PASSWORD_ACTION_LABEL[password_action]}
        </p>
      )}

      {/* ACCOUNT */}
      <section className="mt-5 rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Account</p>
        <div className="mt-3 flex flex-col gap-1.5 text-sm text-ink/70">
          <p>
            Display name: <span className="font-medium text-ink">{account.displayName || "—"}</span>
          </p>
          <p>
            Email: <span className="font-medium text-ink">{account.email ?? "—"}</span>
          </p>
          <p>
            Status:{" "}
            <span
              className={`ml-0.5 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                confirmed ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/50"
              }`}
            >
              {confirmed ? "Confirmed" : "Awaiting confirmation / setup"}
            </span>
          </p>
          <p>Created: <span className="font-medium text-ink">{formatDateShort(account.createdAt)}</span></p>
          <p>
            Last sign-in:{" "}
            <span className="font-medium text-ink">
              {account.lastSignInAt ? formatDateShort(account.lastSignInAt) : "Never"}
            </span>
          </p>
          <p className="mt-1 text-xs text-ink/35">{account.id}</p>
        </div>
      </section>

      {/* PASSWORD & ACCOUNT ACCESS */}
      <section className="mt-4 rounded-2xl border border-black/10 bg-mist/40 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Password &amp; Account Access</p>
        <p className="mt-1 text-xs text-ink/45">
          FindMi never stores or displays this user&rsquo;s password. Choose one of the two options below.
        </p>

        <div className="mt-3 flex flex-col gap-4">
          <div>
            <form action={sendReset}>
              <button
                type="submit"
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-black/[0.03]"
              >
                Send Password Reset Email
              </button>
            </form>
            <p className="mt-1.5 text-xs text-ink/45">
              Emails the user a secure link to set their own new password — nothing for you to hand off.
            </p>
          </div>

          <div className="border-t border-black/10 pt-4">
            <SetPasswordForm action={setPassword} />
          </div>
        </div>
      </section>

      {/* ACCESS → Businesses */}
      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Business Access</p>
        <p className="mt-1 text-xs text-ink/45">
          Grants management access to an existing business. Doesn&rsquo;t change ownership — see Claims for that.
        </p>

        {businesses.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {businesses.map((b) => (
              <li
                key={b.memberId}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <Link href={`/admin/businesses/${b.businessId}`} className="truncate text-sm font-medium text-ink hover:underline">
                    {b.name}
                  </Link>
                  <p className="text-xs uppercase tracking-wide text-ink/45">{b.role}</p>
                </div>
                {b.role !== "owner" && (
                  <form action={removeUserBusinessAccess.bind(null, id, b.memberId)}>
                    <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/50">No business access yet.</p>
        )}

        <form action={assignBusiness} className="mt-3 flex flex-col gap-2">
          <RelationField
            label="Add business access"
            name="business_id"
            entity="businesses"
            initial={null}
            clearLabel={null}
            placeholder="Search businesses…"
          />
          <button
            type="submit"
            className="w-fit rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Assign as Manager
          </button>
        </form>
      </section>

      {/* ACCESS → Events */}
      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Event Access</p>
        <p className="mt-1 text-xs text-ink/45">
          Grants management access to an existing event. Doesn&rsquo;t change ownership — see Claims for that.
        </p>

        {events.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {events.map((ev) => (
              <li
                key={ev.memberId}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <Link href={`/admin/events/${ev.eventId}`} className="truncate text-sm font-medium text-ink hover:underline">
                    {ev.name}
                  </Link>
                  <p className="text-xs uppercase tracking-wide text-ink/45">{ev.role}</p>
                </div>
                {ev.role !== "owner" && (
                  <form action={removeUserEventAccess.bind(null, id, ev.memberId)}>
                    <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/50">No event access yet.</p>
        )}

        <form action={assignEvent} className="mt-3 flex flex-col gap-2">
          <RelationField
            label="Add event access"
            name="event_id"
            entity="events"
            initial={null}
            clearLabel={null}
            placeholder="Search events…"
          />
          <button
            type="submit"
            className="w-fit rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Assign as Manager
          </button>
        </form>
      </section>

      {/* ACCESS → Products (read-only, inherited) */}
      <section className="mt-4 rounded-2xl border border-black/10 bg-mist/20 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Product Access (inherited)</p>
        <p className="mt-1 text-xs text-ink/45">
          Read-only — inherited entirely through the businesses above. There&rsquo;s no separate product-level
          access to grant.
        </p>
        {productGroups.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {productGroups.map((g) => (
              <div key={g.businessId}>
                <p className="text-xs font-semibold text-ink/60">{g.businessName}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {g.products.map((p) => (
                    <li key={p.id}>
                      <Link href={`/admin/products/${p.id}`} className="text-sm text-ink hover:underline">
                        {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink/50">No products — no business access, or those businesses have none.</p>
        )}
      </section>
    </div>
  );
}
