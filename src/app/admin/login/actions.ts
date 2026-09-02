"use server";

import { redirect } from "next/navigation";
import { checkPassword, createSession, destroySession } from "@/lib/admin/auth";
import { checkLoginAttempt, clearLoginAttempts, recordFailedAttempt } from "@/lib/admin/loginRateLimit";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Security Pass 3 — brute-force protection. A client already inside its
// temporary block skips the password check entirely (so the check never
// even runs while blocked) and gets the exact same delay curve as a
// fresh wrong-password attempt (see loginRateLimit.ts) — an automated
// guesser gets no signal distinguishing "wrong password" from
// "temporarily blocked" from response TIMING, and the password itself is
// never logged or persisted anywhere.
//
// Admin Login Rate-Limit UX fix (session-persistence trace follow-up):
// the two failure cases now redirect with a DIFFERENT error code
// (error=rate_limited vs error=1) so the login page can show a founder a
// true message — "too many attempts" is not the same claim as "that
// password is wrong," and conflating them is what made the ADMIN_PASSWORD
// incident hard to diagnose. This still reveals nothing about whether a
// password submitted while blocked would otherwise have been correct —
// checkPassword() is still never even called on the blocked path, so
// there is nothing to leak; the block is never bypassed or reset by a
// correct password, and the limiter's thresholds/timing are untouched.
export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  const { blocked, delayMs } = await checkLoginAttempt();

  if (blocked) {
    await delay(delayMs);
    redirect(`/admin/login?error=rate_limited&next=${encodeURIComponent(next)}`);
  }

  const valid = checkPassword(password);
  if (!valid) {
    await recordFailedAttempt();
    await delay(delayMs);
    redirect(`/admin/login?error=1&next=${encodeURIComponent(next)}`);
  }

  await clearLoginAttempts();
  await createSession();
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}
