"use client";

import SupabaseImage from "@/components/SupabaseImage";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  getCart,
  onCartChange,
  removeLine,
  updateFulfillment,
  updateQuantity,
} from "@/lib/cart";
import { formatCurrency } from "@/lib/format";
import { quoteCart, startCheckout } from "./actions";
import type { CartLine, CartLineQuote, CartQuote } from "@/lib/commerce/types";

export default function CartPage() {
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const refresh = () => {
    const current = getCart();
    setLines(current);
    startRefresh(async () => {
      const q = await quoteCart(current);
      setQuote(q);
    });
  };

  useEffect(() => {
    refresh();
    return onCartChange(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    if (!quote) return [];
    const map = new Map<string, { businessName: string; businessSlug: string; lines: CartLineQuote[] }>();
    for (const line of quote.lines) {
      const key = line.businessId || "unavailable";
      if (!map.has(key)) map.set(key, { businessName: line.businessName, businessSlug: line.businessSlug, lines: [] });
      map.get(key)!.lines.push(line);
    }
    return Array.from(map.values());
  }, [quote]);

  const handleCheckout = async () => {
    if (!lines || lines.length === 0) return;
    if (!email.trim()) {
      setCheckoutError("Enter your email to continue.");
      return;
    }
    setCheckingOut(true);
    setCheckoutError(null);
    const result = await startCheckout({
      lines,
      customerEmail: email,
      customerName: name || undefined,
      customerPhone: phone || undefined,
    });
    if ("error" in result) {
      setCheckoutError(result.error);
      setCheckingOut(false);
      return;
    }
    window.location.href = result.url;
  };

  if (lines === null) return null;

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Your cart is empty</h1>
        <p className="mt-2 text-sm text-ink/60">Find something to bring home from a FindMi vendor.</p>
        <Link
          href="/marketplace"
          className="mt-6 inline-block rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600"
        >
          Visit Marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Your Cart</h1>

      {quote?.hasUnavailable && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some items in your cart are no longer available and won&rsquo;t be included at checkout — you can remove them below.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-8">
        {grouped.map((group) => (
          <div key={group.businessSlug || group.businessName}>
            <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">
              {group.businessSlug ? (
                <Link href={`/business/${group.businessSlug}`} className="hover:underline">
                  {group.businessName}
                </Link>
              ) : (
                group.businessName || "Unavailable"
              )}
            </p>
            <div className="mt-3 flex flex-col gap-4">
              {group.lines.map((line) => (
                <CartLineRow key={line.lineId} line={line} onChanged={refresh} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {quote && (
        <div className="mt-10 border-t border-black/10 pt-6">
          <div className="flex flex-col gap-2 text-sm">
            <Row label="Merchandise" value={quote.merchandiseSubtotal} />
            <Row label="Fulfillment" value={quote.fulfillmentTotal} />
            {quote.customerProcessingFeeTotal > 0 && (
              <Row label="Processing fee" value={quote.customerProcessingFeeTotal} />
            )}
            <div className="flex items-center justify-between border-t border-black/10 pt-2 text-base font-semibold text-ink">
              <span>Total</span>
              <span>{formatCurrency(quote.total)}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
              />
              <input
                type="tel"
                placeholder="Phone (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
              />
            </div>
            {checkoutError && <p className="text-sm text-red-600">{checkoutError}</p>}
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkingOut || refreshing || quote.total <= 0}
              className="rounded-full bg-findmi px-5 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-50"
            >
              {checkingOut ? "Redirecting…" : "Proceed to Checkout"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-ink/70">
      <span>{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );
}

function CartLineRow({ line, onChanged }: { line: CartLineQuote; onChanged: () => void }) {
  return (
    <div className={`flex gap-3 rounded-xl border border-black/5 bg-white p-3 ${!line.available ? "opacity-60" : ""}`}>
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-mist">
        {line.imageUrl && <SupabaseImage src={line.imageUrl} alt={line.productName} fill sizes="64px" className="object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{line.productName}</p>
        {!line.available ? (
          <p className="mt-0.5 text-xs text-red-600">{line.unavailableReason}</p>
        ) : (
          <>
            <p className="text-xs text-ink/50">{formatCurrency(line.unitPrice)} each</p>
            {line.availableFulfillmentOptions.length > 1 ? (
              <select
                value={`${line.fulfillmentMethod}:${line.appearanceId ?? ""}`}
                onChange={(e) => {
                  const [method, appearanceId] = e.target.value.split(":");
                  updateFulfillment(line.lineId, method as CartLineQuote["fulfillmentMethod"], appearanceId || null);
                  onChanged();
                }}
                // A native <select> sizes itself to its content (the
                // selected option's text) by default, ignoring the flex
                // parent's min-w-0 — a long fulfillment label (venue +
                // date/time range + price) was pushing this element,
                // and with it the whole cart row/page, wider than the
                // mobile viewport. w-full/max-w-full/min-w-0 constrain
                // the closed control to its card's width; truncate
                // ellipsizes the closed display only — the native
                // dropdown's own options still render full-length.
                className="mt-1 w-full min-w-0 max-w-full truncate rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-ink"
              >
                {line.availableFulfillmentOptions.map((o) => (
                  <option key={`${o.method}:${o.appearanceId ?? ""}`} value={`${o.method}:${o.appearanceId ?? ""}`}>
                    {o.label} {o.price > 0 ? `— ${formatCurrency(o.price)}` : "— Free"}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-xs text-ink/50">{line.fulfillmentLabel}</p>
            )}
          </>
        )}

        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                updateQuantity(line.lineId, line.quantity - 1);
                onChanged();
              }}
              aria-label="Decrease quantity"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink"
            >
              −
            </button>
            <span className="w-5 text-center text-sm text-ink">{line.quantity}</span>
            <button
              type="button"
              onClick={() => {
                updateQuantity(line.lineId, line.quantity + 1);
                onChanged();
              }}
              aria-label="Increase quantity"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              removeLine(line.lineId);
              onChanged();
            }}
            className="text-xs font-semibold text-red-600 hover:underline"
          >
            Remove
          </button>
        </div>
      </div>
      {line.available && (
        <p className="shrink-0 text-sm font-semibold text-ink">
          {formatCurrency(line.lineMerchandiseTotal + line.fulfillmentAmount)}
        </p>
      )}
    </div>
  );
}
