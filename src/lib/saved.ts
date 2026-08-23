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
