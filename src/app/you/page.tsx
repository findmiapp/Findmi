import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "You",
  description: "Your FindMi — saved businesses and what you're following.",
};

export default function YouPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">You</h1>
      <p className="mt-3 text-ink/60">
        FindMi doesn&rsquo;t need an account yet. What you save and follow is kept right on
        this device.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/saved"
          className="flex items-center justify-between rounded-2xl border border-black/10 p-4 transition hover:border-black/20"
        >
          <div>
            <p className="text-sm font-semibold text-ink">Saved</p>
            <p className="text-xs text-ink/50">Businesses you&rsquo;ve bookmarked</p>
          </div>
          <span className="text-ink/30">→</span>
        </Link>
        <Link
          href="/businesses"
          className="flex items-center justify-between rounded-2xl border border-black/10 p-4 transition hover:border-black/20"
        >
          <div>
            <p className="text-sm font-semibold text-ink">Following</p>
            <p className="text-xs text-ink/50">
              Businesses you&rsquo;ve followed for updates — check your email
            </p>
          </div>
          <span className="text-ink/30">→</span>
        </Link>
      </div>

      <div className="mt-10 rounded-2xl bg-black/[0.03] p-5">
        <p className="text-sm font-semibold text-ink">Have a business people should find?</p>
        <Link
          href="/join"
          className="mt-3 inline-block rounded-full bg-findmi px-5 py-2.5 text-sm font-bold text-ink transition hover:bg-findmi-600"
        >
          Join FindMi
        </Link>
      </div>
    </div>
  );
}
