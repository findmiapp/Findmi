import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Launch V2 Pass 1 — Section 12: legacy Native Inquiries V1 route,
 * retired from owner-facing navigation. The underlying `inquiries`/
 * `inquiry_messages` tables and RLS are untouched (kept temporarily —
 * see this pass's own report); only this and its two sibling routes
 * ([id], new) now redirect rather than render the dead legacy list, so a
 * bookmarked/typed-in link never dead-ends on a confusing, superseded
 * interface. The canonical replacement is the Inbox at /account/messages. */
export default function LegacyAccountInquiriesPage() {
  redirect("/account/messages");
}
