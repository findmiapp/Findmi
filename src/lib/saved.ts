// Saved businesses live entirely in the browser (localStorage) — no account
// system in V1, so this is honest about what it is: a per-device list, not
// a synced favorites feature. Safe to call from any client component.

const KEY = "findmi_saved_slugs";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(slugs: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(slugs));
  } catch {
    // Storage unavailable (private browsing, quota) — fail silently, the
    // toggle just won't persist this session.
  }
}

export function getSavedSlugs(): string[] {
  return read();
}

export function isSaved(slug: string): boolean {
  return read().includes(slug);
}

export function toggleSaved(slug: string): boolean {
  const current = read();
  const now = current.includes(slug);
  const next = now ? current.filter((s) => s !== slug) : [...current, slug];
  write(next);
  return !now;
}

// Saved events — a separate key/list from saved businesses (not merged
// into the same array: the two are looked up against different tables,
// and a shared slug namespace would risk a business and an event with the
// same slug shadowing each other).
const EVENT_KEY = "findmi_saved_event_slugs";

function readEvents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EVENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeEvents(slugs: string[]) {
  try {
    window.localStorage.setItem(EVENT_KEY, JSON.stringify(slugs));
  } catch {
    // Storage unavailable — fail silently, same as saved businesses.
  }
}

export function getSavedEventSlugs(): string[] {
  return readEvents();
}

export function isEventSaved(slug: string): boolean {
  return readEvents().includes(slug);
}

export function toggleEventSaved(slug: string): boolean {
  const current = readEvents();
  const now = current.includes(slug);
  const next = now ? current.filter((s) => s !== slug) : [...current, slug];
  writeEvents(next);
  return !now;
}

// Saved products — same per-device pattern as businesses/events above, its
// own key/list for the same reason (Product Detail V2: Save didn't exist
// for products at all until this pass — the existing bookmark
// architecture is extended here, not replaced or duplicated).
const PRODUCT_KEY = "findmi_saved_product_slugs";

function readProducts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRODUCT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeProducts(slugs: string[]) {
  try {
    window.localStorage.setItem(PRODUCT_KEY, JSON.stringify(slugs));
  } catch {
    // Storage unavailable — fail silently, same as saved businesses/events.
  }
}

export function getSavedProductSlugs(): string[] {
  return readProducts();
}

export function isProductSaved(slug: string): boolean {
  return readProducts().includes(slug);
}

export function toggleProductSaved(slug: string): boolean {
  const current = readProducts();
  const now = current.includes(slug);
  const next = now ? current.filter((s) => s !== slug) : [...current, slug];
  writeProducts(next);
  return !now;
}
