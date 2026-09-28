"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Stale Error Banner Fix — /account previously rendered the `?error=`
 * search param directly (a plain server-rendered <p>), which meant a
 * one-time redirect error kept reappearing on every later refresh/
 * revisit/back-navigation of that exact URL, long after the condition it
 * described had resolved (e.g. Test Biz: a transient requireBusinessMember
 * failure on the /upgrade/pro redirect right after creation, while the
 * underlying business_members row was — and remained — correct). This
 * renders the SAME banner once, then strips ONLY the `error` param from
 * the URL via router.replace (never push, so the error URL never lands in
 * browser history) — every other search param (e.g. `created=1`) is
 * preserved untouched. No redirect/navigation is visible to the user: the
 * message is already on screen from the initial render, and replacing the
 * URL after mount doesn't remount or reload the page. */
export default function AccountErrorBanner({ error }: { error: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("error")) return;
    params.delete("error");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // Intentionally runs once on mount only — this clears whatever error
    // was present in the URL at load time; it must not re-run just
    // because the router/pathname identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
}
