import Link from "next/link";
import FormAction from "@/components/FormAction";

export interface OnboardingLink {
  url: string;
  displayMode: "embed" | "external";
}

/** Only ever rendered once billing_status is actually "paid" — see
 * page.tsx and MembershipConfirmation. Same content/markup regardless of
 * whether that was known immediately (webhook already processed) or after
 * a short client-side wait (see MembershipConfirmation). */
export function SuccessPanel({ onboarding }: { onboarding: OnboardingLink | null }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-6 py-20 sm:py-28">
      <span className="inline-flex items-center gap-1 rounded-full bg-findmi px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
        Payment confirmed
      </span>
      <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        Welcome to FindMi.
      </h1>
      <p className="mt-4 max-w-md text-lg text-ink/60">
        Your membership is active. Now let&rsquo;s build your profile.
      </p>

      {onboarding ? (
        <FormAction
          href={onboarding.url}
          displayMode={onboarding.displayMode}
          label="Build My Profile"
          className="mt-8 rounded-full bg-findmi px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        />
      ) : (
        <p className="mt-8 text-sm text-ink/50">
          Onboarding form coming shortly — we&rsquo;ll be in touch by email.
        </p>
      )}

      <p className="mt-10 text-sm text-ink/50">
        Questions in the meantime?{" "}
        <Link href="/about" className="font-medium text-ink underline underline-offset-2">
          Learn more about FindMi
        </Link>
        .
      </p>
    </div>
  );
}

/** No membership_id at all, or one that doesn't match any row — never
 * shows "Payment confirmed" for something we can't actually verify. */
export function UnverifiedPanel() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-6 py-20 sm:py-28">
      <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink/60">
        Couldn&rsquo;t confirm
      </span>
      <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        We couldn&rsquo;t find that membership.
      </h1>
      <p className="mt-4 max-w-md text-lg text-ink/60">
        If you just paid, check your email for a receipt — we&rsquo;ll follow up shortly. If something looks
        wrong, reach out and we&rsquo;ll sort it out.
      </p>
      <Link
        href="/join"
        className="mt-8 rounded-full bg-findmi px-6 py-3.5 text-center text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Back to FindMi
      </Link>
    </div>
  );
}

/** Stripe redirected here before the checkout.session.completed webhook
 * finished — see MembershipConfirmation, which polls past this. */
export function ConfirmingPanel() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-6 py-20 sm:py-28">
      <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink/60">
        Confirming payment
      </span>
      <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        Just a moment.
      </h1>
      <p className="mt-4 max-w-md text-lg text-ink/60">
        We&rsquo;re confirming your payment with Stripe — this usually takes a few seconds.
      </p>
    </div>
  );
}

/** Bounded-wait exhausted (see MembershipConfirmation) — never an infinite
 * spinner, and never a fabricated "active" state either. */
export function StillConfirmingPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-6 py-20 sm:py-28">
      <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink/60">
        Still confirming
      </span>
      <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        Almost there.
      </h1>
      <p className="mt-4 max-w-md text-lg text-ink/60">
        Stripe is taking a little longer than usual to confirm your payment. We&rsquo;ll email you the moment
        it&rsquo;s done — or check again now.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-8 rounded-full bg-findmi px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Check Again
      </button>
    </div>
  );
}
