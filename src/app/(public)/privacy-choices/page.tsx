import type { Metadata } from "next";
import PrivacyChoicesPanel from "@/components/privacy/PrivacyChoicesPanel";

export const metadata: Metadata = {
  title: "Privacy Choices",
  description: "Choose how Findmi may use analytics and personalization.",
};

/** Privacy Choices, reachable by anyone (no account needed) from every
 * footer. The same panel as the Manage Privacy Choices sheet. */
export default function PrivacyChoicesPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">Privacy Choices</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/60">
        Choose what Findmi may use beyond what it needs to work. Your choices apply on this device right away, and to your account when
        you&rsquo;re signed in.
      </p>
      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <PrivacyChoicesPanel />
      </div>
    </div>
  );
}
