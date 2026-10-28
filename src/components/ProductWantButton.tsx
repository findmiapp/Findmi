"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useProductWant } from "@/lib/useProductWant";
import { getAccountSession } from "@/lib/accountSession";
import CollectionPicker from "./CollectionPicker";
import { DoneButton, Sheet } from "./BottomSheet";
import type { WantSource } from "@/lib/product-wants-domain";

/** Product Want — "I want this Product" (product_wants), distinct from the
 * Save bookmark. Signed in: one tap toggles, and a tap that creates the
 * Want offers optional organizing into Collections. Signed out: a tiny
 * email sheet — no account required, the email is never shown to the
 * Business, and the selected state can't be undone anonymously.
 * Vocabulary: WANT THIS → "Want This?" → I WANT THIS → YOU WANT THIS.
 *
 * variant:
 *   primary   full-width Aqua button (catalog Product page — the main action)
 *   secondary full-width outline (Marketplace Product page, beside Add to Cart)
 *   pill      compact pill on a Product card (inside the card's link) */
export default function ProductWantButton({
  productId,
  productName,
  variant,
  source,
  sourceChannel,
}: {
  productId: string;
  productName: string;
  variant: "primary" | "secondary" | "pill";
  source: WantSource;
  sourceChannel?: string;
}) {
  const want = useProductWant(productId, source, sourceChannel);
  // email: signed-out capture · already: signed-out tap on the selected
  // state · organize: signed-in, right after a tap created the Want.
  const [sheet, setSheet] = useState<"email" | "already" | "organize" | null>(null);

  async function onClick(e: MouseEvent) {
    // Cards: never also follow the card's link.
    e.preventDefault();
    e.stopPropagation();
    // A tap before the shared session check resolved still counts.
    const authed = want.signedIn ?? (await getAccountSession());
    if (authed) {
      const wasWanted = want.wanted;
      const now = await want.toggle(true);
      // Offer optional organizing only when THIS tap created the Want —
      // never on page load, never on un-Want.
      if (!wasWanted && now === true) setSheet("organize");
      return;
    }
    // Signed out: a selected state can't be undone anonymously (the server
    // keeps the email Want); say so instead of a dead button.
    setSheet(want.wanted ? "already" : "email");
  }

  const label = want.wanted ? (variant === "pill" ? "Wanted" : "You Want This") : variant === "pill" ? "Want" : "Want This";
  const classes =
    variant === "primary"
      ? want.wanted
        ? "flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-findmi/40 bg-findmi-50 text-sm font-bold uppercase tracking-wide text-findmi-700 transition"
        : "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      : variant === "secondary"
        ? `flex h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition ${want.wanted ? "border-findmi/40 bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-ink hover:border-findmi"}`
        : `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${want.wanted ? "bg-findmi text-white" : "bg-findmi-50 text-findmi-700 hover:bg-findmi-100"}`;

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={want.wanted}
        disabled={want.busy}
        aria-label={variant === "pill" ? `${want.wanted ? "You want" : "Want"} ${productName}` : undefined}
        className={`${classes} disabled:opacity-60`}
      >
        <HeartGlyph filled={want.wanted} className={variant === "pill" ? "h-3 w-3" : "h-4 w-4"} />
        {label}
      </button>
      {want.error && variant !== "pill" && (
        <p role="alert" className="mt-1.5 text-center text-metadata text-red-700">
          {want.error}
        </p>
      )}
      {sheet === "email" && <WantEmailSheet productName={productName} want={want} onClose={() => setSheet(null)} />}
      {sheet === "already" && (
        <Sheet label="You want this" onClose={() => setSheet(null)}>
          <p className="font-display text-section-title font-semibold text-primary">You Want This ✓</p>
          <p className="mt-1 text-body text-muted">You already told us you want this.</p>
          <p className="mt-2 text-metadata text-subtle">
            <Link href="/login" className="font-semibold text-accent hover:underline">
              Sign in
            </Link>{" "}
            to manage your Things I Want.
          </p>
          <DoneButton onClose={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet === "organize" && (
        <Sheet label="Added to Things I Want" onClose={() => setSheet(null)}>
          <p className="font-display text-section-title font-semibold text-primary">Added to Things I Want ✓</p>
          <p className="mt-0.5 text-metadata text-muted">Organize it if you like — optional.</p>
          <div className="mt-4">
            <CollectionPicker entityType="product" entityId={productId} />
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <Link href="/account/saved?collection=want" className="text-metadata font-semibold text-accent hover:underline">
              View Things I Want
            </Link>
            <button type="button" onClick={() => setSheet(null)} className="h-10 rounded-full bg-findmi px-5 text-sm font-semibold text-white">
              Done
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function WantEmailSheet({ productName, want, onClose }: { productName: string; want: ReturnType<typeof useProductWant>; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await want.submitEmail(email, honeypot)) setDone(true);
  }

  return (
    <Sheet label="Want this product" onClose={onClose}>
      {done ? (
        <>
          <p className="font-display text-section-title font-semibold text-primary">You Want This ✓</p>
          <p className="mt-1 text-body text-muted">We&rsquo;ll remember that you want {productName}.</p>
          <p className="mt-2 text-metadata text-subtle">
            <Link href="/login" className="font-semibold text-accent hover:underline">
              Sign in
            </Link>{" "}
            to keep a list of Things I Want.
          </p>
          <DoneButton onClose={onClose} />
        </>
      ) : (
        <form onSubmit={submit}>
          <p className="font-display text-section-title font-semibold text-primary">Want This?</p>
          <p className="mt-1 text-body text-muted">Enter your email and we&rsquo;ll remember that you want this.</p>
          <label className="mt-4 block">
            <span className="sr-only">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-12 w-full rounded-xl border border-black/10 bg-white px-3.5 text-base text-ink placeholder:text-ink/35 focus:border-findmi focus:outline-none"
            />
          </label>
          {/* Honeypot — invisible to people, filled by bots. */}
          <input type="text" tabIndex={-1} autoComplete="off" autoCapitalize="none" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} className="hidden" aria-hidden="true" name="website" />
          {want.error && (
            <p role="alert" className="mt-2 text-metadata text-red-700">
              {want.error}
            </p>
          )}
          <button type="submit" disabled={want.busy} className="mt-4 h-12 w-full rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60">
            I Want This
          </button>
          <p className="mt-3 text-center text-metadata text-subtle">Your email isn&rsquo;t shared with the business.</p>
        </form>
      )}
    </Sheet>
  );
}

/** Bottom sheet (dialog on desktop) shared by every Want sheet. Portaled;
 * React events never bubble to a parent card link. */
function HeartGlyph({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M12 20s-7-4.35-7-10a4 4 0 017-2.65A4 4 0 0119 10c0 5.65-7 10-7 10z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
