/** Short, human-readable, effectively-unique order number — not a
 * sequence (no single counter to contend on), collision-checked by the
 * database's unique constraint at insert time with a small retry loop in
 * the caller. */
export function generateOrderNumber(): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `FM-${time}-${rand}`;
}
