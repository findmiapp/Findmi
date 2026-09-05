import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import AccountNav from "../../AccountNav";
import { createNativeInquiry } from "../actions";

export const metadata: Metadata = {
  title: "New Inquiry",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/** Native Inquiries V1 — the compose entry point for BOTH a Business-
 * profile inquiry and a Product-page inquiry (distinguished only by
 * whether `product` is present), reached from a "Message on FindMi" link
 * on those public pages. Requires sign-in (redirects through /login with
 * this exact URL — including its query params — as `next`, so the
 * visitor lands right back here with business/product intent preserved
 * after signing in). Never blocks on a missing username/profile — see
 * this pass's own "no signup blocker" requirement — only a gentle,
 * dismissible-by-ignoring note when one isn't set. */
export default async function NewInquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; product?: string; error?: string }>;
}) {
  const { business: businessId, product: productId, error } = await searchParams;
  if (!businessId) notFound();

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const qs = new URLSearchParams({ business: businessId, ...(productId ? { product: productId } : {}) }).toString();
  const selfUrl = `/account/inquiries/new?${qs}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(selfUrl)}`);

  const [{ data: business }, profileRes, productRes] = await Promise.all([
    supabase.from("businesses").select("id, name, slug, logo_url, native_inquiries_enabled").eq("id", businessId).maybeSingle(),
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    productId ? supabase.from("products").select("id, name, business_id").eq("id", productId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!business || !(business as { native_inquiries_enabled: boolean }).native_inquiries_enabled) notFound();
  const product = productRes.data as { id: string; name: string; business_id: string } | null;
  if (productId && (!product || product.business_id !== businessId)) notFound();
  const hasUsername = Boolean((profileRes.data as { username: string | null } | null)?.username);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <Link href={`/business/${(business as { slug: string }).slug}`} className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← {(business as { name: string }).name}
      </Link>

      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
        Message {(business as { name: string }).name}
      </h1>
      {product && <p className="mt-1 text-sm text-ink/50">About: {product.name}</p>}

      {!hasUsername && (
        <p className="mt-4 rounded-xl border border-findmi/20 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Tip: <Link href="/account/profile" className="underline">add a username</Link> so businesses you message can
          recognize you — completely optional, and this inquiry sends either way.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <form action={createNativeInquiry} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="business_id" value={businessId} />
        {productId && <input type="hidden" name="product_id" value={productId} />}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Your message</span>
          <textarea name="message" required rows={5} placeholder="What would you like to ask or share?" className={`${inputClass} resize-y`} />
        </label>

        <div>
          <p className="text-sm font-medium text-ink">Share contact info (optional)</p>
          <p className="mt-1 text-xs text-ink/45">
            Your FindMi account email/phone are never shared automatically. Only fill these in if you want this
            business to be able to reach you directly outside FindMi.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <input type="text" name="customer_name" placeholder="Name (optional)" className={inputClass} />
            <input type="email" name="customer_email" placeholder="Email (optional)" className={inputClass} />
          </div>
          <input type="tel" name="customer_phone" placeholder="Phone (optional)" className={`${inputClass} mt-3`} />
        </div>

        <button
          type="submit"
          className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Send Inquiry
        </button>
      </form>
    </div>
  );
}
