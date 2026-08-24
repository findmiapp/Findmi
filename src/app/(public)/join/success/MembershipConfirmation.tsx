"use client";

import { useEffect, useState } from "react";
import { ConfirmingPanel, StillConfirmingPanel, SuccessPanel, UnverifiedPanel, type OnboardingLink } from "./panels";

type PollResult =
  | { status: "paid"; onboarding: OnboardingLink | null }
  | { status: "pending" }
  | { status: "not_found" };

const POLL_INTERVAL_MS = 2500;
const MAX_ATTEMPTS = 10; // ~25s bounded wait — never an infinite spinner

/**
 * Rendered when the page loads before checkout.session.completed has been
 * processed yet (billing_status still isn't "paid" — see page.tsx). Polls
 * our own DB, which only the webhook ever writes to, so this never
 * fabricates a paid state on its own — it just waits for the same source
 * of truth the server-rendered success path already trusts.
 */
export default function MembershipConfirmation({ membershipId }: { membershipId: string }) {
  const [result, setResult] = useState<PollResult>({ status: "pending" });
  const [attempts, setAttempts] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (result.status !== "pending" || gaveUp) return;
    if (attempts >= MAX_ATTEMPTS) {
      setGaveUp(true);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/membership-status?id=${encodeURIComponent(membershipId)}`, {
          cache: "no-store",
        });
        const data: PollResult = await res.json();
        if (!cancelled) setResult(data);
      } catch {
        // Network hiccup — counts as an attempt, tries again on the next tick.
      } finally {
        if (!cancelled) setAttempts((n) => n + 1);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempts, result.status, gaveUp, membershipId]);

  if (result.status === "paid") return <SuccessPanel onboarding={result.onboarding} />;
  if (result.status === "not_found") return <UnverifiedPanel />;
  if (gaveUp) return <StillConfirmingPanel onRetry={() => window.location.reload()} />;
  return <ConfirmingPanel />;
}
