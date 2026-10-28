/** Plain-text sanitizer shared by server extraction (brand-website-extract)
 * and client-safe parsing (event-import/schedule). No dependencies, so any
 * module can import it without pulling server-only code into a bundle. */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const INVISIBLE = /[­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

/** Normalizes one untrusted string to plain, single-line display text, or
 * null. Over-long values are cut at a word boundary. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  let s = value
    .slice(0, max * 8)
    .normalize("NFKC")
    .replace(CONTROL, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /[<>]/.test(s)) return null;
  if (s.length > max) {
    const cut = s.slice(0, max + 1);
    const space = cut.lastIndexOf(" ");
    s = (space >= max * 0.6 ? cut.slice(0, space) : s.slice(0, max)).replace(/[\s,;:–—-]+$/, "");
  }
  return s || null;
}
