// Journal Image Performance V1 — a small, dependency-free concurrency
// limiter. Bounds how many async operations from a set can be "in flight"
// at once (e.g. decoding/resizing images, or network uploads) without
// pulling in a queueing library. Generic — no Journal/image concepts here,
// so it can be reused anywhere a simple bounded-concurrency pool is needed.
export function createConcurrencyLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function withLimit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      const next = waiting.shift();
      if (next) next();
    }
  };
}
