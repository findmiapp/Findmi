/** Brand Ingestion P3 — the Admin import runner's pure logic (no server
 * imports; used by the client runner and by tests). The runner holds NO
 * state of its own that matters: every candidate's state is persisted in
 * brand_import_candidates, so closing the page just stops issuing
 * requests, and reopening the batch resumes from what is still runnable. */

/** The client runner's concurrency (the server also caps fresh
 * processing globally at 3 — lib/admin/brand-import.ts). */
export const BRAND_IMPORT_RUNNER_CONCURRENCY = 2;

/** Mirrors BRAND_IMPORT_LEASE_MS / BRAND_IMPORT_MAX_ATTEMPTS (server
 * re-checks everything; this only decides what to ask for). */
export const RUNNER_LEASE_MS = 2 * 60 * 1000;
export const RUNNER_MAX_ATTEMPTS = 5;

export interface RunnerCandidate {
  id: string;
  position: number;
  status: string;
  attemptCount: number;
  processingStartedAt: string | null;
}

/** Candidates the runner should process, in batch order: queued ones and
 * abandoned `processing` ones (lease expired) under the attempt limit.
 * Failed candidates are NOT auto-run — they need an explicit Retry. */
export function runnableCandidateIds(candidates: RunnerCandidate[], nowMs: number): string[] {
  return [...candidates]
    .sort((a, b) => a.position - b.position)
    .filter((c) => {
      if (c.attemptCount >= RUNNER_MAX_ATTEMPTS) return false;
      if (c.status === "queued") return true;
      if (c.status !== "processing") return false;
      const started = c.processingStartedAt ? Date.parse(c.processingStartedAt) : NaN;
      return !Number.isFinite(started) || nowMs - started >= RUNNER_LEASE_MS;
    })
    .map((c) => c.id);
}

export type RunnerStepResult = "done" | "retry_later";

/** Processes `ids` with at most `limit` in flight. A `retry_later` result
 * (server busy) puts the id back at the end of the queue after `waitMs`,
 * at most `maxRequeues` times per id. Stops issuing new work as soon as
 * `shouldStop()` is true (in-flight requests finish). */
export async function runWithConcurrency(
  ids: string[],
  limit: number,
  worker: (id: string) => Promise<RunnerStepResult>,
  options: { shouldStop?: () => boolean; wait?: (ms: number) => Promise<void>; waitMs?: number; maxRequeues?: number } = {}
): Promise<void> {
  const queue = [...ids];
  const requeues = new Map<string, number>();
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stop = options.shouldStop ?? (() => false);
  const lane = async () => {
    for (;;) {
      if (stop()) return;
      const id = queue.shift();
      if (id === undefined) return;
      let result: RunnerStepResult;
      try {
        result = await worker(id);
      } catch {
        result = "done"; // a failed request leaves persisted state; never loop on it
      }
      if (result === "retry_later") {
        const n = (requeues.get(id) ?? 0) + 1;
        requeues.set(id, n);
        if (n <= (options.maxRequeues ?? 10)) {
          await wait(options.waitMs ?? 3000);
          queue.push(id);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, ids.length)) }, lane));
}
