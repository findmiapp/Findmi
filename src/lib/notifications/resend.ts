import { Resend } from "resend";

// Admin Action Email Notifications V1 — one lazy, memoized client. Reads
// RESEND_API_KEY exactly once per server instance; absent/empty returns
// null rather than throwing, so every caller can treat "no provider
// configured" as a normal, expected V1 state (local dev, or before the
// key is set in production) instead of a crash.
let client: Resend | null | undefined;

export function getResendClient(): Resend | null {
  if (client !== undefined) return client;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  client = apiKey ? new Resend(apiKey) : null;
  return client;
}
