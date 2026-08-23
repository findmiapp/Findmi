import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How FindMi collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-ink/50">Last updated August 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink/70">
        <section>
          <h2 className="text-base font-semibold text-ink">What we collect</h2>
          <p className="mt-2">
            When you follow a business or submit an inquiry, we collect the information you
            provide — such as your name, email, phone number, and details about your request.
            When a business joins FindMi, we collect the business information they submit,
            including contact details, location, and payment information processed securely by
            Stripe.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">How we use it</h2>
          <p className="mt-2">
            We use the information you provide to operate FindMi: to display business profiles
            and appearances, to route inquiries to the businesses you contact, to notify you
            when a business you follow posts a new appearance, and to communicate with
            businesses about their membership.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">How we share it</h2>
          <p className="mt-2">
            Inquiry and follow information you submit is shared with the specific business you
            contacted or followed. We use third-party service providers — including Supabase
            for our database, Stripe for payment processing, Tally for form collection, and
            Vercel for hosting — to operate FindMi. We do not sell your personal information.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Your choices</h2>
          <p className="mt-2">
            You can ask us to remove your follow or inquiry information at any time by
            contacting us at the email below. Businesses can request updates or removal of
            their profile by contacting us directly.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Contact</h2>
          <p className="mt-2">
            Questions about this policy? Reach us at{" "}
            <a href="mailto:privacy@findmi.app" className="font-medium text-ink underline underline-offset-2">
              privacy@findmi.app
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
