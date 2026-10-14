// Event Import — Event description normalization. Descriptions are plain
// text that keeps the source's paragraph and line structure (the public
// Event page renders them with `whitespace-pre-line`, as escaped React
// text). Unlike the generic one-line cleanText, this never collapses line
// breaks and never discards a description because it contains "<" or ">"
// — it is only ever rendered as text (and JSON-LD escapes "<"), so those
// characters are harmless. HTML is converted to text BEFORE this runs
// (htmlToDescriptionText); nothing here persists markup.

/** Stored Event descriptions: generous enough for real long-form event
 * pages (events.description is unbounded text). */
export const EVENT_DESCRIPTION_MAX = 5000;

// Control characters except tab (\u0009), newline (\u000A) and CR (\u000D).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const INLINE_SPACE = /[ \t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;

/** Plain-text Event description: paragraph breaks and single line breaks
 * kept, runs of spaces collapsed, at most one blank line between
 * paragraphs, control/invisible characters removed. Null when empty. */
export function cleanEventDescription(value: unknown, max: number = EVENT_DESCRIPTION_MAX): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .slice(0, max * 8)
    .normalize("NFKC")
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .replace(CONTROL, " ")
    .replace(INVISIBLE, "")
    .split("\n")
    .map((line) => line.replace(INLINE_SPACE, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > max ? truncateDescription(text, max) : text;
}

/** Cuts at the last paragraph break, else sentence end, else line break,
 * else word boundary in the final 40% of the allowance — a hard cut only
 * when none exists. Never ends on dangling punctuation/whitespace. */
export function truncateDescription(text: string, max: number = EVENT_DESCRIPTION_MAX): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const floor = Math.floor(max * 0.6);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= floor) return window.slice(0, paragraph).trimEnd();

  let sentenceEnd = -1;
  for (const m of window.matchAll(/[.!?…]["'”’)\]]*(?=\s)/g)) sentenceEnd = m.index! + m[0].length;
  if (sentenceEnd >= floor) return window.slice(0, sentenceEnd).trimEnd();

  const line = window.lastIndexOf("\n");
  if (line >= floor) return window.slice(0, line).trimEnd();

  const space = window.lastIndexOf(" ");
  const cut = space >= floor ? window.slice(0, space) : window;
  return cut.replace(/[\s,;:–—-]+$/, "");
}

/** Rich-text (HTML) descriptions some platforms publish → plain text with
 * the same paragraph/line structure. Tags are removed, never kept. */
export function htmlToDescriptionText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|blockquote|section|article)\s*>/gi, "\n\n")
    .replace(/<\/\s*li\s*>/gi, "")
    // Inline formatting disappears without leaving a gap ("<b>QSBS</b>.").
    .replace(/<\/?\s*(b|i|u|em|strong|span|a|small|mark|code|sup|sub|abbr)\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}
