"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProductWant } from "@/lib/useProductWant";
import type { WantSource } from "@/lib/product-wants-domain";

/** Product Want — "I want this Product" (product_wants), distinct from the
 * Save bookmark. Signed in: one tap toggles. Signed out: a tiny email
 * sheet ("we'll remember your interest") — no account required, and the
 * email is never shown to the Business.
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
  const [sheetOpen, setSheetOpen] = useState(false);

  function onClick(e: MouseEvent) {
    // Cards: never also follow the card's link.
    e.preventDefault();
    e.stopPropagation();
    if (want.signedIn === null) return;
    if (want.signedIn) want.toggle();
    else if (!want.wanted) setSheetOpen(true);
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
      {sheetOpen && <WantEmailSheet productName={productName} want={want} onClose={() => setSheetOpen(false)} />}
    </>
  );
}

function WantEmailSheet({ productName, want, onClose }: { productName: string; want: ReturnType<typeof useProductWant>; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await want.submitEmail(email, honeypot)) setDone(true);
  }

  return createPortal(
    // Portals bubble React events through the tree — stop them so a card's
    // link never opens from inside the sheet.
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="presentation" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Want this product" className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl sm:rounded-3xl sm:pb-4">
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
        {done ? (
          <>
            <p className="font-display text-section-title font-semibold text-primary">Got It</p>
            <p className="mt-1 text-body text-muted">We&rsquo;ll remember you want {productName}.</p>
            <p className="mt-2 text-metadata text-subtle">
              <Link href="/login" className="font-semibold text-accent hover:underline">
                Sign in
              </Link>{" "}
              to keep a list of Things I Want.
            </p>
            <button type="button" onClick={onClose} className="mt-5 h-11 w-full rounded-full bg-findmi text-sm font-semibold text-white">
              Done
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="font-display text-section-title font-semibold text-primary">Want This?</p>
            <p className="mt-1 text-body text-muted">Enter your email and we&rsquo;ll remember your interest.</p>
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
              I&rsquo;m Interested
            </button>
            <p className="mt-3 text-center text-metadata text-subtle">Your email isn&rsquo;t shared with the business.</p>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

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
