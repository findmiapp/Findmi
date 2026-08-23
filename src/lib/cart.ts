// The FindMi cart lives entirely in the browser (localStorage) — no prices
// are stored, only what was chosen (product, quantity, fulfillment). Every
// price shown or charged is re-derived server-side from this data (see
// lib/commerce/quote.ts) — never trust what's read back from here for
// money. Mirrors the lib/saved.ts per-device pattern.
import type { CartLine } from "./commerce/types";
import type { FulfillmentMethod } from "./types";

const KEY = "findmi_cart_v1";
const EVENT = "findmi:cart-updated";

function read(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

function write(lines: CartLine[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage unavailable (private browsing, quota) — fail silently.
  }
}

export function getCart(): CartLine[] {
  return read();
}

export function getCartCount(): number {
  return read().reduce((sum, l) => sum + l.quantity, 0);
}

/** Subscribes to cart changes made anywhere in this tab (our own writes)
 * or another tab (the native "storage" event) — used by the header cart
 * badge. Returns an unsubscribe function. */
export function onCartChange(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function addToCart(line: {
  productId: string;
  quantity: number;
  fulfillmentMethod: FulfillmentMethod;
  appearanceId?: string | null;
  sourceChannel?: string | null;
}): void {
  const current = read();
  // Same product + same fulfillment choice (+ same appearance, for event
  // pickup) merges quantity into the existing line rather than creating a
  // duplicate row.
  const existing = current.find(
    (l) =>
      l.productId === line.productId &&
      l.fulfillmentMethod === line.fulfillmentMethod &&
      (l.appearanceId ?? null) === (line.appearanceId ?? null)
  );
  if (existing) {
    existing.quantity += line.quantity;
    write(current);
    return;
  }
  const newLine: CartLine = {
    lineId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    productId: line.productId,
    quantity: line.quantity,
    fulfillmentMethod: line.fulfillmentMethod,
    appearanceId: line.appearanceId ?? null,
    sourceChannel: line.sourceChannel ?? null,
  };
  write([...current, newLine]);
}

export function updateQuantity(lineId: string, quantity: number): void {
  const current = read();
  if (quantity <= 0) {
    write(current.filter((l) => l.lineId !== lineId));
    return;
  }
  write(current.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)));
}

export function updateFulfillment(
  lineId: string,
  fulfillmentMethod: FulfillmentMethod,
  appearanceId?: string | null
): void {
  const current = read();
  write(
    current.map((l) =>
      l.lineId === lineId ? { ...l, fulfillmentMethod, appearanceId: appearanceId ?? null } : l
    )
  );
}

export function removeLine(lineId: string): void {
  write(read().filter((l) => l.lineId !== lineId));
}

export function clearCart(): void {
  write([]);
}
