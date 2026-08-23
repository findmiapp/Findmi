import type { Metadata } from "next";
import Link from "next/link";
import { getOnboardingFormUrl } from "@/lib/tally";

export const metadata: Metadata = {
  title: "Welcome to Findmi",
  robots: { index: false },
};

export default function JoinSuccessPage() {
  const onboardingUrl = getOnboardingFormUrl();

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-6 py-20 sm:py-28">
      <span className="inline-flex items-center gap-1 rounded-full bg-findmi-50 px-3 py-1 text-xs font-semibold text-findmi-600">
        Payment confirmed
      </span>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        Welcome to Findmi.
      </h1>
      <p className="mt-4 max-w-md text-lg text-ink/60">
        Your membership is active. Now give us what we need to build your Findmi profile.
      </p>

      {onboardingUrl ? (
        <a
          href={onboardingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-8 rounded-full bg-findmi-500 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-findmi-600"
        >
          Build My Profile
        </a>
      ) : (
        <p className="mt-8 text-sm text-ink/50">
          Onboarding form coming shortly — we&rsquo;ll be in touch by email.
        </p>
      )}

      <p className="mt-10 text-sm text-ink/50">
        Questions in the meantime?{" "}
        <Link href="/about" className="font-medium text-ink underline underline-offset-2">
          Learn more about Findmi
        </Link>
        .
      </p>
    </div>
  );
}
