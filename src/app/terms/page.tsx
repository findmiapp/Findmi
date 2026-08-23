import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Findmi.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-ink/50">Last updated August 2026</p>

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
          <h2 className="text-base font-semibold text-ink">Business memberships</h2>
          <p className="mt-2">
            Findmi Founding Membership is $99 per year, billed through Stripe. Founding pricing
            is retained for as long as your membership remains continuously active; a lapsed
            membership may be re-enrolled at then-current pricing. Membership does not
            guarantee sales, bookings, or inclusion in any specific event — it provides a
            Findmi profile, appearance listings, and discovery inclusion as described on our
            Join page. We may remove content or suspend a profile that violates these terms.
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
          <h2 className="text-base font-semibold text-ink">Content accuracy</h2>
          <p className="mt-2">
            Businesses are responsible for the accuracy of their profile, product, and
            appearance information. Findmi does not guarantee that any listed appearance,
            date, or location is current — always confirm directly with the business for
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
