import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Findmi.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-ink/50">Last updated September 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink/70">
        <section>
          <h2 className="text-base font-semibold text-ink">Using Findmi</h2>
          <p className="mt-2">
            Findmi is a discovery platform that helps consumers find businesses, products, and
            where those businesses will appear next. By using Findmi, you agree to use it
            lawfully and not to misuse the inquiry, follow, or booking tools to send spam,
            harassment, or fraudulent requests.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Findmi Pro and Managed Pro</h2>
          <p className="mt-2">
            Findmi Pro and Findmi Managed Pro are billed through Stripe on a recurring basis, at
            the monthly or annual interval you select at checkout. Your plan renews automatically
            at that interval until you cancel it; current pricing for each plan and interval is
            shown before you check out. Some businesses previously purchased Findmi Pro under an
            earlier one-time, one-year $99 offer; that purchase remains valid for the period it
            was purchased for, is not a recurring subscription, and is not automatically renewed
            or converted to one. Neither plan guarantees sales, bookings, or inclusion in any
            specific event. Findmi Pro provides a Findmi profile, appearance listings, and
            discovery inclusion as described on our Join page; Findmi Managed Pro additionally
            includes Findmi maintaining your profile information within the scope described at
            checkout. We may remove content or suspend a profile that violates these terms.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Inquiries and bookings</h2>
          <p className="mt-2">
            Findmi connects consumers and businesses but is not a party to any booking,
            purchase, or agreement made between them. Businesses are responsible for their own
            products, services, pricing, availability, and fulfillment.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Communications and messages</h2>
          <p className="mt-2">
            Findmi provides messaging and inquiry tools (including direct messages between
            businesses, organizers, and venues, and controlled inquiry forms like Inquire,
            Contact Organizer, Contact Venue, and Talk to Sales) so people can communicate
            through the platform. Messages and inquiries you submit through Findmi are
            transmitted and stored by Findmi in order to deliver them to the intended
            recipient. You may not use these tools for unlawful, abusive, fraudulent,
            harassing, or spam purposes. Authorized Findmi personnel and service providers may
            access, review, or process communications when reasonably necessary to operate the
            service, deliver messages to their intended recipients, provide support,
            investigate abuse, fraud, or spam, protect the security of users and the platform,
            enforce these terms, or comply with legal obligations.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Content accuracy</h2>
          <p className="mt-2">
            Businesses are responsible for the accuracy of their profile, product, and
            appearance information. Findmi does not guarantee that any listed appearance,
            date, or location is current. Always confirm directly with the business for
            time-sensitive plans.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Changes</h2>
          <p className="mt-2">
            We may update these terms as Findmi evolves. Continued use of Findmi after a change
            means you accept the updated terms.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-ink">Contact</h2>
          <p className="mt-2">
            Questions about these terms? Reach us at{" "}
            <a href="mailto:hello@findmi.app" className="font-medium text-ink underline underline-offset-2">
              hello@findmi.app
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
