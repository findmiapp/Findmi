import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAccountDataSummary } from "@/lib/privacy/account-data";
import PrivacyChoicesPanel from "@/components/privacy/PrivacyChoicesPanel";
import PersonalAppShell from "../PersonalAppShell";
import { cancelPrivacyRequest, submitPrivacyRequest } from "./actions";
import { formatDateShort } from "@/lib/format";

export const metadata: Metadata = { title: "Privacy & Data", robots: { index: false } };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  export: "Download My Data",
  delete: "Delete My Account & Data",
  access: "Access Request",
  correct: "Correction Request",
  other: "Privacy Request",
};
const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  in_review: "In Review",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};

const card = "rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6";
const sectionTitle = "font-display text-lg font-bold tracking-tight text-primary";
const input = "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";

export default async function PrivacyAndDataPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; requested?: string; cancelled?: string }>;
}) {
  const { error, notice, requested, cancelled } = await searchParams;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/privacy");

  const admin = getAdminSupabase();
  const [{ data: profile }, summary, requestsResult] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    admin ? getAccountDataSummary(admin, user.id) : Promise.resolve(null),
    admin
      ? admin.from("privacy_requests").select("id, request_type, status, created_at, resolved_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const requests = (requestsResult.data ?? []) as { id: string; request_type: string; status: string; created_at: string; resolved_at: string | null }[];
  const openDelete = requests.find((r) => r.request_type === "delete" && (r.status === "received" || r.status === "in_review"));

  return (
    <PersonalAppShell displayName={(profile as { display_name: string | null } | null)?.display_name ?? null}>
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <div>
          <p className="text-label font-bold uppercase text-accent">Your Findmi account</p>
          <h1 className="mt-1 font-display text-page-title font-bold text-primary">Privacy &amp; Data</h1>
        </div>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>}
        {notice && <p className="rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-body text-secondary">{notice}</p>}
        {requested && !error && (
          <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
            Findmi received your request. You can follow its status below.
          </p>
        )}
        {cancelled && <p className="rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-body text-secondary">Request withdrawn.</p>}

        <section className={card} aria-labelledby="prefs">
          <h2 id="prefs" className={sectionTitle}>
            Privacy Preferences
          </h2>
          <div className="mt-1">
            <PrivacyChoicesPanel />
          </div>
        </section>

        {summary && (
          <section className={card} aria-labelledby="your-data">
            <h2 id="your-data" className={sectionTitle}>
              Your Data On Findmi
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              {[
                ["Pages Followed", summary.pagesFollowed, "/account/following"],
                ["Saved Items", summary.savedItems, "/account/saved"],
                ["Organized Items", summary.organizedItems, "/account/saved"],
                ["Moments", summary.moments, "/my-world/journal"],
              ].map(([label, value, href]) => (
                <Link key={label as string} href={href as string} className="rounded-2xl border border-black/5 px-4 py-3 transition hover:border-black/15">
                  <dt className="text-metadata text-muted">{label}</dt>
                  <dd className="mt-0.5 text-card-title font-bold text-primary">{(value as number).toLocaleString()}</dd>
                </Link>
              ))}
            </dl>
          </section>
        )}

        <section className={card} aria-labelledby="requests">
          <h2 id="requests" className={sectionTitle}>
            Data Requests
          </h2>

          <div className="mt-4">
            <h3 className="text-body font-semibold text-primary">Download My Data</h3>
            <p className="mt-1 text-body text-muted">
              A file with your profile, follows, saves, organized items, Moments (photos listed by file name), messages you sent, orders, claims and
              privacy choices.
            </p>
            <a href="/account/privacy/export" className="mt-3 inline-flex rounded-full bg-findmi px-5 py-2.5 text-sm font-bold text-white transition hover:bg-findmi-600">
              Download My Data
            </a>
          </div>

          <div id="delete" className="mt-6 border-t border-black/5 pt-5">
            <h3 className="text-body font-semibold text-primary">Delete My Account &amp; Data</h3>
            {openDelete ? (
              <p className="mt-1 text-body text-muted">Your deletion request is {STATUS_LABELS[openDelete.status]?.toLowerCase()}. Findmi will update its status here.</p>
            ) : (
              <form action={submitPrivacyRequest} className="mt-2 flex flex-col gap-3">
                <input type="hidden" name="request_type" value="delete" />
                <p className="text-body text-muted">
                  Findmi reviews each deletion request. Your account, profile, saves, follows and private Moments are deleted; some records may be kept
                  where Findmi needs them, such as order and payment records. Pages you own need a new owner first. You&rsquo;ll see the status here.
                </p>
                <label className="block">
                  <span className="mb-1.5 block text-metadata font-medium text-primary">Anything Findmi should know (optional)</span>
                  <textarea autoCapitalize="sentences" name="details" rows={2} className={input} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-metadata font-medium text-primary">Type DELETE to confirm</span>
                  <input autoCapitalize="none" type="text" name="confirm" className={input} autoComplete="off" />
                </label>
                <button type="submit" className="self-start rounded-full border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100">
                  Request Account Deletion
                </button>
              </form>
            )}
          </div>

          <div id="request" className="mt-6 border-t border-black/5 pt-5">
            <h3 className="text-body font-semibold text-primary">Privacy Request</h3>
            <form action={submitPrivacyRequest} className="mt-2 flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-metadata font-medium text-primary">What do you need?</span>
                <select name="request_type" defaultValue="other" className={input}>
                  <option value="access">See what Findmi holds about me</option>
                  <option value="correct">Correct something about me</option>
                  <option value="other">Something else</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-metadata font-medium text-primary">Details</span>
                <textarea autoCapitalize="sentences" name="details" rows={3} className={input} />
              </label>
              <button type="submit" className="self-start rounded-full bg-findmi px-5 py-2.5 text-sm font-bold text-white transition hover:bg-findmi-600">
                Send Privacy Request
              </button>
            </form>
          </div>

          {requests.length > 0 && (
            <div className="mt-6 border-t border-black/5 pt-5">
              <h3 className="text-body font-semibold text-primary">Your Requests</h3>
              <ul className="mt-2 flex flex-col divide-y divide-black/5">
                {requests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-body">
                    <span className="min-w-0">
                      <span className="block font-medium text-primary">{TYPE_LABELS[r.request_type] ?? r.request_type}</span>
                      <span className="text-metadata text-muted">{formatDateShort(r.created_at)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-metadata font-semibold text-secondary">{STATUS_LABELS[r.status] ?? r.status}</span>
                      {r.status === "received" && r.request_type !== "export" && (
                        <form action={cancelPrivacyRequest.bind(null, r.id)}>
                          <button type="submit" className="text-metadata font-semibold text-ink/55 hover:text-ink">
                            Withdraw
                          </button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </PersonalAppShell>
  );
}
