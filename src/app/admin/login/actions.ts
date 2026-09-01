"use server";

import { redirect } from "next/navigation";
import { checkPassword, createSession, destroySession } from "@/lib/admin/auth";
import { checkLoginAttempt, clearLoginAttempts, recordFailedAttempt } from "@/lib/admin/loginRateLimit";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Security Pass 3 — brute-force protection. A client already inside its
// temporary block skips the password check entirely (so the check never
// even runs while blocked) and, either way, every non-success path falls
// through to the exact same redirect + generic error message + a delay
// drawn from the same increasing curve (see loginRateLimit.ts) — an
// automated guesser gets no signal distinguishing "wrong password" from
// "temporarily blocked," and the password itself is never logged or
// persisted anywhere.
export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  const { blocked, delayMs } = await checkLoginAttempt();
  const valid = !blocked && checkPassword(password);

  if (!valid) {
    if (!blocked) await recordFailedAttempt();
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
