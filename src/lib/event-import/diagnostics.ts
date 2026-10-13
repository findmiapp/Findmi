// Event Import — source fetch diagnostics. When a source page can't be read
// because of the site's own HTTP response, the importer keeps ONLY the
// public facts needed to tell refusals apart: the failure classification,
// the HTTP status and the final hostname (both already public — what the
// site itself answered). Never IPs, DNS answers, headers, cookies or bodies.
//
// Admin surfaces may show these; consumer-facing results never carry them
// (publicImportAnalysis strips them before anything reaches a browser).
import type { EventImportAnalysis, EventImportFailure } from "./types";

export interface EventImportFetchDiagnostics {
  /** safe-fetch's own classification (e.g. "blocked_by_site", "http_error"). */
  fetchCode: string;
  /** The site's final HTTP status, when a response arrived. */
  status?: number;
  /** The hostname that answered last (after any validated redirects). */
  host?: string;
  /** Requests made (2 when the one 429/503 retry ran). */
  attempts?: number;
}

const HOST = /^[a-z0-9.-]{1,253}$/;

/** Keeps only the safe, public fields (defensive: bounded, validated shapes). */
export function safeFetchDiagnostics(page: { code: string; status?: number; host?: string; attempts?: number }): EventImportFetchDiagnostics {
  const out: EventImportFetchDiagnostics = { fetchCode: page.code };
  if (Number.isInteger(page.status) && page.status! >= 100 && page.status! <= 599) out.status = page.status;
  const host = page.host?.toLowerCase();
  if (host && HOST.test(host)) out.host = host;
  if (page.attempts === 1 || page.attempts === 2) out.attempts = page.attempts;
  return out;
}

/** One concise server log line — hostnames, status and classification only
 * (no path, query, HTML or headers). */
export function fetchFailureLogLine(sourceHost: string, code: EventImportFailure, d: EventImportFetchDiagnostics): string {
  return [
    "[event-import] source fetch failed",
    `source=${sourceHost}`,
    `final=${d.host ?? "-"}`,
    `status=${d.status ?? "-"}`,
    `fetch=${d.fetchCode}`,
    `result=${code}`,
    `attempts=${d.attempts ?? 1}`,
  ].join(" ");
}

/** Admin-only wording, e.g. "Source unavailable — luma.com returned HTTP 403." */
export function describeSourceFailure(code: EventImportFailure, d: EventImportFetchDiagnostics | undefined): string {
  if (d?.status !== undefined) {
    const host = d.host ?? "The source site";
    const transient = d.status === 429 || d.status === 503;
    const retried = d.attempts === 2 ? " (after one retry)" : "";
    return `${transient ? "Source temporarily unavailable" : "Source unavailable"} — ${host} returned HTTP ${d.status}${retried}.`;
  }
  return `Source unavailable — ${d?.fetchCode ?? code}.`;
}

/** What a consumer-facing caller may return: the plain failure code only. */
export function publicImportAnalysis(a: EventImportAnalysis): EventImportAnalysis {
  if (a.ok) return a;
  return { ok: false, code: a.code };
}
