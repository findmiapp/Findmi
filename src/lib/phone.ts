// Require Cell Number at Signup pass — a small, dependency-free NANP
// (US/Canada) phone normalizer. Deliberately NOT a general international
// phone library: Findmi has no international phone infrastructure
// anywhere else in the app today (every other phone field — claims,
// orders, inquiries — is a free-text string with no validation at all),
// so this doesn't invent one either. Accepts ordinary US formatting
// ("(917) 555-1234", "917-555-1234", "9175551234", "+1 917 555 1234")
// and stores E.164 ("+19175551234") — the smallest format that's both a
// real standard and trivially round-trippable for display.

/** Strips formatting and validates a plausible NANP (US/Canada) number,
 * returning it E.164-normalized ("+1XXXXXXXXXX") or null if it isn't a
 * plausible 10-digit NANP number once punctuation/whitespace is
 * stripped. An optional leading country code (typed as "+1" or a bare
 * "1") is accepted but never required. */
export function normalizeUsPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length !== 10) return null;
  // NANP: area code and exchange code can't start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(tenDigits)) return null;
  return `+1${tenDigits}`;
}

/** Display formatting for a normalized NANP E.164 number — "+19175551234"
 * -> "(917) 555-1234". Falls back to the raw stored value for anything
 * that doesn't match the expected shape (legacy/unexpected data), never
 * throws. */
export function formatUsPhone(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value);
  if (!match) return value;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}
