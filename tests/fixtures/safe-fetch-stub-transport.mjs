// Test-only stand-in for src/lib/safe-fetch.ts as seen by the Event Import
// engine: everything is the REAL module (validation, DNS rules, redirects,
// the one 429/503 retry); only the network transport is a stub
// (globalThis.__safeFetchTransport) and the retry wait is instant.
import * as real from "../../src/lib/safe-fetch.ts";

export * from "../../src/lib/safe-fetch.ts";

export function safeFetchEventPage(input, options = {}) {
  return real.safeFetchEventPage(input, { ...options, transport: globalThis.__safeFetchTransport, sleep: async () => {} });
}
