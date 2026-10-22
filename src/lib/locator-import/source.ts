import { parseCsv, type CsvParseResult } from "./csv";

/** Locator Import — source adapters. Every source (a CSV today; a Storepoint,
 * Stockist or Google Sheets feed later) is reduced to the same thing: a header
 * row and data rows of text. Mapping, matching, review and import never see
 * the source, so adding a source is one adapter and no pipeline change. The
 * id is stored on the batch and on each imported entry (`external_source`),
 * which is what makes "import again" update rather than duplicate. */

export interface LocatorSourceRows {
  headers: string[];
  rows: string[][];
}

export interface LocatorSourceAdapter<Input> {
  /** `[a-z0-9_]{2,40}` — written to `external_source`. */
  id: string;
  label: string;
  read(input: Input): { ok: true; source: LocatorSourceRows } | { ok: false; error: string };
}

export const csvSource: LocatorSourceAdapter<string> = {
  id: "csv",
  label: "CSV File",
  read(text) {
    const parsed: CsvParseResult = parseCsv(text);
    return parsed.ok ? { ok: true, source: { headers: parsed.csv.headers, rows: parsed.csv.rows } } : parsed;
  },
};

/** Registered adapters. Only CSV works today — "Sync Existing Locator" is a
 * visible Coming Soon entry point, never a registered adapter. */
export const LOCATOR_SOURCES = { csv: csvSource } as const;
export type LocatorSourceId = keyof typeof LOCATOR_SOURCES;
