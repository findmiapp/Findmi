import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import AccountNav from "../AccountNav";
import { resolveBusinessScopedHref } from "../businessScope";

export const metadata: Metadata = {
  title: "Business",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Launch V2 Pass 1 — the primary nav's BUSINESS destination (Section 2).
 * Zero/one/many resolution reuses resolveBusinessScopedHref verbatim (the
 * exact same decision BusinessScopedAction already makes for every other
 * business-scoped action on /account) rather than a new routing rule:
 * zero managed businesses → Add Business; exactly one → straight into
 * that Business Manager; several → this page's own compact chooser
 * (there is no ambiguity to resolve automatically, so this is the one
 * case that can't just redirect). No new business-identity system. */
export default async function AccountBusinessPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/business");

  const { data: businessMemberships } = await supabase
    .from("business_members")
    .select("business_id, businesses(name, slug)")
    .eq("user_id", user.id);

  type Row = { business_id: string; businesses: { name: string; slug: string } | { name: string; slug: string }[] | null };
  const businesses = ((businessMemberships ?? []) as Row[])
    .map((m) => {
      const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return b ? { id: m.business_id, name: b.name } : null;
    })
    .filter((b): b is { id: string; name: string } => Boolean(b));

  const directHref = resolveBusinessScopedHref(businesses, "overview");
  if (directHref) redirect(directHref);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Business</h1>
      <p className="mt-1.5 text-sm text-ink/50">Which business do you want to manage?</p>

      <div className="mt-6 flex flex-col gap-2">
        {businesses.map((b) => (
          <Link
            key={b.id}
            href={`/account/business/${b.id}`}
            className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm transition hover:border-black/10"
          >
            <p className="truncate text-sm font-semibold text-ink">{b.name}</p>
            <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-findmi-700">Manage →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
