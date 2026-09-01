/**
 * Security Pass 6 — safe serialization for JSON-LD `<script
 * type="application/ld+json">` content. `JSON.stringify` alone does not
 * escape "<", so a string value anywhere in the structured-data object (a
 * business/product name or description, both founder-editable) containing
 * "</script>" could otherwise close the script element early and let
 * whatever HTML/script follows in the page's raw markup execute.
 *
 * Escaping every "<" as its Unicode escape is the standard fix for this —
 * it's indistinguishable to JSON.parse or any other structured-data
 * consumer (both encodings represent the exact same string), and it
 * changes nothing about the actual business/product text content itself,
 * only how a literal "<" character is written inside this one script tag.
 */
export function toJsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
