import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminUserAccount,
  getUserBusinessAccess,
  getUserEventAccess,
  getUserLocationAccess,
  getUserInheritedProducts,
} from "@/lib/admin/user-queries";
import { getUserDependencySummary } from "@/lib/admin/user-dependencies";
import { formatDateShort } from "@/lib/format";
import { formatUsPhone } from "@/lib/phone";
import { RelationField } from "@/components/admin/RelationPicker";
import SetPasswordForm from "./SetPasswordForm";
import {
  assignUserToBusiness,
  assignUserToEvent,
  assignUserToLocation,
  deleteUserAccount,
  removeUserBusinessAccess,
  removeUserEventAccess,
  removeUserLocationAccess,
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

  const [account, businesses, events, locations, productGroups, deps] = await Promise.all([
    getAdminUserAccount(id),
    getUserBusinessAccess(id),
    getUserEventAccess(id),
    getUserLocationAccess(id),
    getUserInheritedProducts(id),
    getUserDependencySummary(id),
  ]);
  if (!account) notFound();

  const confirmed = Boolean(account.emailConfirmedAt);
  const assignBusiness = assignUserToBusiness.bind(null, id);
  const assignEvent = assignUserToEvent.bind(null, id);
  const assignLocation = assignUserToLocation.bind(null, id);
  const sendReset = sendPasswordResetEmail.bind(null, id);
  const setPassword = setUserPassword.bind(null, id);
  const deleteAccount = deleteUserAccount.bind(null, id);
  const confirmPhrase = account.email ?? "DELETE";

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
            Cell Number: <span className="font-medium text-ink">{formatUsPhone(account.phone) || "—"}</span>
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
          Findmi never stores or displays this user&rsquo;s password. Choose one of the two options below.
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

      {/* ACCESS → Locations — Core Entity Management pass. Same shape as
          Business/Event Access above (location_members already exists,
          checked by requireLocationMember, and was already a fully
          independent membership table — just missing from this admin
          screen). Location has no ownership/Claims concept of its own
          (native self-service create, no claim flow), so this section
          omits the "Doesn't change ownership — see Claims" line the
          Business/Event sections carry, rather than implying a Claims
          surface that doesn't exist for Location. */}
      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Location Access</p>
        <p className="mt-1 text-xs text-ink/45">Grants management access to an existing Findmi location.</p>

        {locations.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {locations.map((l) => (
              <li
                key={l.memberId}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <Link href={`/admin/locations/${l.locationId}`} className="truncate text-sm font-medium text-ink hover:underline">
                    {l.name}
                  </Link>
                  <p className="text-xs uppercase tracking-wide text-ink/45">{l.role}</p>
                </div>
                {l.role !== "owner" && (
                  <form action={removeUserLocationAccess.bind(null, id, l.memberId)}>
                    <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/50">No location access yet.</p>
        )}

        <form action={assignLocation} className="mt-3 flex flex-col gap-2">
          <RelationField
            label="Add location access"
            name="location_id"
            entity="locations"
            initial={null}
            clearLabel={null}
            placeholder="Search locations…"
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
      {deps && (
        <>
          {/* CLAIMS & JOURNAL — Recovery pass: inspect what this account is
              connected to beyond management access. Read-only. */}
          <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Claims</p>
            {deps.claims.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {deps.claims.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink">
                      {c.name} <span className="text-xs uppercase tracking-wide text-ink/40">{c.kind}</span>
                    </span>
                    <span className="shrink-0 text-xs uppercase tracking-wide text-ink/50">
                      {c.status} · {formatDateShort(c.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink/50">No claim requests.</p>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Journal</p>
            {deps.journal.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {deps.journal.map((j) => {
                  const isPublic = j.visibility === "public" && j.status === "published";
                  return (
                    <li key={j.id} className="flex items-center justify-between gap-3 text-sm">
                      {isPublic ? (
                        <Link href={`/journal/${j.id}`} className="min-w-0 truncate text-ink hover:underline">
                          {j.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate text-ink">{j.title}</span>
                      )}
                      <span className="shrink-0 text-xs uppercase tracking-wide text-ink/50">
                        {isPublic ? "Public" : j.status === "published" ? "Private" : "Draft"} · {j.entryDate}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink/50">No Journal entries.</p>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Other Records</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              {(
                [
                  ["Saves & follows", deps.counts.savesAndFollows],
                  ["Entitlements", deps.counts.entitlements],
                  ["Pro invites", deps.counts.proRedemptions],
                  ["Subscriptions paid", deps.counts.subscriptionsPaid],
                  ["Orders", deps.counts.orders],
                  ["Inquiries", deps.counts.inquiries],
                  ["Conversations", deps.counts.conversations],
                  ["Opportunities", deps.counts.opportunities],
                  ["Market requests", deps.counts.marketRequests],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="text-ink/55">{label}</dt>
                  <dd className="font-medium text-ink">{n}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* DELETE USER — safe workflow: dependency summary, explanation,
              typed confirmation; refused outright while any blocker exists
              (re-checked server-side in deleteUserAccount). */}
          <section className="mt-4 rounded-2xl border border-red-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-red-700">Delete User</p>
            {deps.blockers.length > 0 ? (
              <>
                <p className="mt-1 text-sm text-ink/70">This account can&rsquo;t be deleted safely yet:</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                  {deps.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink/45">
                  Findmi never cascades Businesses, Events, Locations, public Journal content or billing records away
                  with an account. Resolve the items above first.
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink/70">Deleting this account permanently:</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-ink/70">
                  {deps.effects.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                <form action={deleteAccount} className="mt-3 flex flex-col gap-2">
                  <label className="text-xs text-ink/60">
                    Type <span className="font-semibold text-ink">{confirmPhrase}</span> to confirm
                    <input
                      name="confirm"
                      autoComplete="off"
                      required
                      className="mt-1 block w-full rounded-xl border border-black/15 px-3 py-2 text-sm text-ink focus:border-red-400 focus:outline-none"
                    />
                  </label>
                  <button
                    type="submit"
                    className="w-fit rounded-full bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-red-700"
                  >
                    Delete User
                  </button>
                </form>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
