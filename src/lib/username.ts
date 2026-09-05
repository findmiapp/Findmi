// Username Onboarding — shared normalization/validation used by both the
// profile-edit Server Action (real enforcement) and the profile form (so
// the client-side hint matches exactly what the server will accept). The
// actual uniqueness guarantee is the DB's own case-insensitive unique
// index (profiles_username_unique_idx) — this module only normalizes and
// rejects obviously-bad/reserved values before that write is attempted.

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

// Every top-level public/api/admin route segment, plus a few obvious
// system words — a username here would collide with (or be confusable
// with) a real FindMi route or role. Not exhaustive by design: the DB's
// own unique index is the real backstop for collisions with OTHER
// usernames; this list only protects against a username that would be
// mistaken for a system page.
const RESERVED_USERNAMES = new Set([
  "about", "account", "accounts", "admin", "administrator", "api", "app",
  "business", "businesses", "cart", "checkout", "claim", "discover",
  "event", "events", "find", "findmi", "forgot-password", "help", "join",
  "location", "locations", "login", "logout", "marketplace", "me",
  "null", "orders", "people", "person", "privacy", "product", "products",
  "profile", "redeem", "reset-password", "root", "saved", "settings",
  "signin", "signout", "signup", "static", "support", "system", "terms",
  "undefined", "upgrade", "user", "users", "www", "you",
]);

export interface UsernameValidation {
  ok: boolean;
  /** Normalized (trimmed + lowercased) value — only meaningful when ok. */
  value: string;
  error?: string;
}

/** Lowercases + trims; does NOT strip/alter characters beyond that — an
 * invalid character is reported as an error, never silently dropped, so
 * what a user sees in the field is always exactly what would be saved. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): UsernameValidation {
  const value = normalizeUsername(raw);
  if (!value) return { ok: false, value, error: "Choose a username." };
  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      value,
      error: "Usernames are 3-20 characters: lowercase letters, numbers, and underscores only.",
    };
  }
  if (RESERVED_USERNAMES.has(value)) {
    return { ok: false, value, error: "That username isn't available." };
  }
  return { ok: true, value };
}
