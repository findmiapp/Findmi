/** Locator Import — CSV reading. Pure and client-safe (no I/O): the browser
 * previews with it and the server re-parses the same text, so both agree on
 * every row. RFC 4180 quoting (embedded commas, quotes and line breaks), a
 * leading BOM, CRLF/LF/CR line ends, and comma / semicolon / tab delimiters. */

export const CSV_MAX_BYTES = 10_000_000;
export const CSV_MAX_ROWS = 10_000;
export const CSV_MAX_COLUMNS = 60;

export interface ParsedCsv {
  headers: string[];
  /** Data rows, each padded/trimmed to `headers.length` cells. */
  rows: string[][];
  delimiter: "," | ";" | "\t";
  /** Rows beyond CSV_MAX_ROWS that were left out. */
  truncated: number;
}

export type CsvParseResult = { ok: true; csv: ParsedCsv } | { ok: false; error: string };

/** The delimiter that splits the header line into the most cells (quotes
 * respected). Ties go to comma. */
export function detectDelimiter(text: string): ParsedCsv["delimiter"] {
  const firstLine = firstRecord(text);
  let best: ParsedCsv["delimiter"] = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"] as const) {
    const n = splitRecord(firstLine, d).length;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

function firstRecord(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === "\n" || c === "\r")) return text.slice(0, i);
  }
  return text;
}

function splitRecord(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"' && cell === "") inQuotes = true;
    else if (c === delimiter) {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out;
}

export function parseCsv(input: string): CsvParseResult {
  if (typeof input !== "string") return { ok: false, error: "That file couldn't be read." };
  if (input.length > CSV_MAX_BYTES) return { ok: false, error: "That file is too large. Keep it under 10 MB." };
  const text = input.replace(/^﻿/, "");
  if (!text.trim()) return { ok: false, error: "That file is empty." };
  const delimiter = detectDelimiter(text);

  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;
  let sawAny = false;
  const endRecord = () => {
    record.push(cell);
    cell = "";
    // A completely blank line is not a row.
    if (!(record.length === 1 && record[0].trim() === "")) records.push(record);
    record = [];
    sawAny = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") {
      inQuotes = true;
      sawAny = true;
    } else if (c === delimiter) {
      record.push(cell);
      cell = "";
      sawAny = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else {
      cell += c;
      sawAny = true;
    }
  }
  if (inQuotes) return { ok: false, error: "A quoted value in that file never closes. Check the quotes and try again." };
  if (sawAny || cell !== "" || record.length > 0) endRecord();

  if (records.length === 0) return { ok: false, error: "That file is empty." };
  const headerRow = records[0].map((h) => h.replace(/\s+/g, " ").trim());
  if (headerRow.length > CSV_MAX_COLUMNS) return { ok: false, error: "That file has too many columns." };
  if (headerRow.every((h) => h === "")) return { ok: false, error: "The first row needs column names." };
  // Unnamed columns are kept (position matters) under a stable placeholder.
  const headers = headerRow.map((h, i) => h || `Column ${i + 1}`);
  const dataRows = records.slice(1);
  if (dataRows.length === 0) return { ok: false, error: "That file has column names but no rows." };
  const kept = dataRows.slice(0, CSV_MAX_ROWS).map((r) => {
    const cells = r.map((v) => v.replace(/ /g, " ").trim());
    while (cells.length < headers.length) cells.push("");
    return cells.slice(0, headers.length);
  });
  return { ok: true, csv: { headers, rows: kept, delimiter, truncated: Math.max(0, dataRows.length - CSV_MAX_ROWS) } };
}
