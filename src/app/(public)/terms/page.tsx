import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { type LegalBlock, type LegalSection } from "@/components/legal/LegalPage";
import { FINDMI_HELLO_EMAIL, TERMS_LAST_UPDATED } from "@/lib/legal/published";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that apply when you use Findmi.",
};

const link = "font-medium text-ink underline underline-offset-2";

const INTRO: LegalBlock[] = [
  "These Terms of Service (\"Terms\") apply when you use Findmi, including findmi.app, JerseyCity.guide and the other websites, tools and services Findmi provides (together, \"Findmi\"). By using Findmi, you agree to these Terms. If you don't agree, please don't use Findmi.",
  {
    node: (
      <p>
        These Terms work together with the{" "}
        <Link href="/privacy" className={link}>
          Privacy Policy
        </Link>
        , which explains how Findmi handles personal information, and with any additional terms Findmi shows you for a specific feature, plan or
        purchase (for example, at checkout). If additional terms conflict with these Terms, the additional terms apply to that feature.
      </p>
    ),
  },
];

const SECTIONS: LegalSection[] = [
  {
    id: "what-findmi-is",
    title: "What Findmi Is",
    blocks: [
      "Findmi is a technology platform that helps people and organizations discover, publish, organize, connect around and interact with:",
      {
        list: [
          "Businesses and brands",
          "Locations and places",
          "Products",
          "Events",
          "Appearances (where a business will be, and when)",
          "Moments (posts about real-world experiences)",
          "Opportunities and commercial inquiries",
          "Conversations and messages",
          "Other listings, content and features Findmi supports",
        ],
      },
      "Findmi may provide technology, discovery, communication, organization, promotional, referral, transaction, marketplace and related services.",
      "Findmi is not the organizer, venue, seller, employer, agent, representative, sponsor, producer or contracting party for something simply because it appears on Findmi or because Findmi helped people connect. The business, organizer, venue, seller or other party behind a listing is responsible for it.",
      "Sometimes Findmi itself provides or manages a service, for example a Findmi Managed Pro plan, an Opportunity that Findmi has agreed to coordinate, or an activation Findmi produces. When that's the case, Findmi will identify it where you arrange it, and any terms shown at that point also apply.",
    ],
  },
  {
    id: "your-responsibilities",
    title: "Your Responsibilities And Due Diligence",
    blocks: [
      "Everyone who uses Findmi, including people, businesses, organizers and venues, is responsible for their own:",
      {
        list: [
          "Due diligence, decisions and results",
          "Agreements, representations and conduct",
          "Compliance with laws and regulations, including permits and licenses",
          "Insurance, where it applies",
          "Safety and accessibility",
          "Taxes",
          "Fulfillment, performance and payments",
          "Refunds and cancellations, where they apply",
          "Disputes with other parties",
        ],
      },
      "A listing, page, Opportunity, inquiry, conversation, Appearance, Event, recommendation, search result, claim, verification signal or any other presence on Findmi is not an endorsement, guarantee or warranty by Findmi. Please use your own judgment, and confirm anything important directly with the responsible party.",
    ],
  },
  {
    id: "accounts",
    title: "Eligibility And Accounts",
    blocks: [
      "Findmi is a general-audience service. You must be at least 13 years old to create a Findmi account. If you're under the age of legal majority where you live, you may use Findmi only with the involvement and permission of a parent or guardian. To buy, sell, subscribe to a paid plan or otherwise enter into a paid transaction, you must be able to form a binding contract.",
      "When you create an account, give accurate information and keep it up to date. Keep your password and sign-in methods secure, and don't share your account. You're responsible for activity on your account. If you think someone else has accessed it, change your password and let Findmi know.",
      "Findmi may suspend or close an account, or remove access to a feature, if it reasonably believes the account was used to break these Terms or the law, to harm others, or to put Findmi or its users at risk.",
    ],
  },
  {
    id: "pages-and-claims",
    title: "Business Pages, Claims And Authority",
    blocks: [
      "Businesses, organizers and venues can manage pages on Findmi. If you create, claim or manage a page, or act on behalf of an organization, you confirm that you're authorized to do so and that you're bound by these Terms on that organization's behalf.",
      "Claiming a page is free and separate from suggesting a correction or requesting removal. Findmi reviews claims and may ask for information that shows you're connected to the organization. Findmi may approve, decline or reverse a claim, add or remove managers, and keep a page available while a claim is reviewed.",
      "People who manage a page are responsible for the information they publish on it and for how they use Findmi's business tools, including messaging, Opportunities, products and Events.",
    ],
  },
  {
    id: "page-information",
    title: "Listings And Page Information",
    blocks: [
      "Information on Findmi can come from different sources, including:",
      {
        list: [
          "People who use Findmi",
          "Businesses and organizations themselves",
          "Publicly available information, such as websites and event pages",
          "Information imported into Findmi",
          "Information Findmi creates or organizes",
          "Information prepared with the help of automated tools",
        ],
      },
      "Not every page on Findmi is managed by the business, organization or place it describes. Some pages were compiled by Findmi from publicly available information and haven't been claimed. Where available, a page's About This Page section explains whether it's managed and where its information came from.",
      "Information on Findmi may be incomplete, out of date or wrong. Anyone can use Suggest A Correction, Request Removal or Report on a page to tell Findmi about a problem, and an organization can claim its own page. Findmi reviews these requests but doesn't promise a particular result or timeline.",
    ],
  },
  {
    id: "events-appearances-locations",
    title: "Events, Appearances And Locations",
    blocks: [
      "Dates, times, hours, availability, admission, participating businesses, products and other details can change, sometimes at short notice. Findmi doesn't guarantee that an Event will take place, that a business will be at an Appearance, or that a place will be open, just because it's listed.",
      "Findmi shows Here Now only when the current time falls within a listed Appearance's start and end, based on the information Findmi has. Please verify important details with the organizer, venue or business before you make plans or travel.",
    ],
  },
  {
    id: "opportunities-and-inquiries",
    title: "Opportunities, Inquiries And Commercial Connections",
    blocks: [
      "Findmi helps businesses, organizers, venues and other organizations find and contact each other, for example through Opportunities, Targets, commercial inquiries and conversations. Findmi's role is discovery and facilitation.",
      "An Opportunity, Target, inquiry, conversation or other connection doesn't guarantee any acceptance, response, placement, booking, sponsorship, employment, sale, distribution, partnership, payment, performance or other result.",
      "Some inquiries go to Findmi rather than directly to the business or organization, for example when a page isn't managed yet or when you ask about a commercial arrangement. Findmi reviews those requests and may introduce you to the other party, but can't guarantee a response, booking, availability or outcome.",
      "Any agreement you make with another party is between you and that party, and you're responsible for its terms, unless Findmi expressly agrees in writing to be a contracting party.",
    ],
  },
  {
    id: "fees",
    title: "Fees And How Findmi Earns Money",
    blocks: [
      "Findmi may earn money in ways that include subscriptions, platform fees, transaction fees, referral fees, commissions, service fees, advertising and promotional fees, managed-service fees and other compensation that Findmi discloses. Findmi tells you about a fee that applies to you before you agree to it.",
      "Findmi Pro and Findmi Managed Pro are billed through Stripe on a recurring basis, at the monthly or annual interval you select at checkout. Your plan renews automatically at that interval until you cancel it; current pricing for each plan and interval is shown before you check out. Some businesses previously purchased Findmi Pro under an earlier one-time, one-year $99 offer; that purchase remains valid for the period it was purchased for, is not a recurring subscription, and is not automatically renewed or converted to one. Neither plan guarantees sales, bookings, or inclusion in any specific event. Findmi Pro provides a Findmi profile, appearance listings, and discovery inclusion as described on the Join page; Findmi Managed Pro additionally includes Findmi maintaining your profile information within the scope described at checkout.",
      "When a seller sells through Findmi's marketplace, Findmi keeps a marketplace fee from the sale, as disclosed to the seller.",
      "Findmi receiving compensation doesn't, by itself, make Findmi responsible for an agreement between other parties, or for its performance, safety, legality or outcome.",
    ],
  },
  {
    id: "marketplace",
    title: "Marketplace Purchases",
    blocks: [
      "Where checkout is available, you can buy products from businesses on Findmi, including from several sellers in one checkout. Each product is sold by the business that lists it, not by Findmi.",
      {
        list: [
          "Sellers set their own products, descriptions, prices and availability, and are responsible for their accuracy.",
          "Fulfillment options (such as shipping, local delivery, local pickup or pickup at an Event) are set by each seller and can differ for each item in your order. The seller is responsible for fulfilling it.",
          "Findmi processes your payment through its payment processor and holds each seller's share until it is paid out to that seller. Findmi doesn't receive or store your full card number.",
          "Any payment-processing fee charged to you is shown as a separate line before you pay.",
          "Taxes, refunds, returns and cancellations depend on the seller, the product and the law that applies. If something is wrong with an order, contact the seller first. Findmi can help, and where Findmi processed the payment, approved refunds are issued through Findmi's payment processor.",
        ],
      },
      "Findmi may cancel or refuse an order, for example if a product isn't available, the price shown was wrong or the order appears fraudulent. Disputes about a product or its fulfillment are between the buyer and the seller, though Findmi may try to help resolve them.",
    ],
  },
  {
    id: "messages",
    title: "Messages And Communications",
    blocks: [
      "Findmi provides messaging and inquiry tools so people and organizations can communicate through the platform. Messages and inquiries you send through Findmi are transmitted and stored by Findmi in order to deliver them to the intended recipient. Don't use these tools for unlawful, abusive, fraudulent, harassing or spam purposes.",
      "You can report a message or conversation, and you can close a conversation you no longer want to receive messages in. Authorized Findmi personnel and service providers may access, review or process communications when reasonably necessary to operate the service, deliver messages, provide support, investigate abuse, fraud or spam, protect users and the platform, enforce these Terms or comply with legal obligations.",
    ],
  },
  {
    id: "your-content",
    title: "Your Content And Moments",
    blocks: [
      "You own the content you post on Findmi, such as Moments, photos, captions, notes, page information and messages. Findmi doesn't claim ownership of it.",
      "So that Findmi can run the service, you give Findmi a worldwide, non-exclusive, royalty-free license to host, store, copy, adapt and format (for example, resize or crop images), display, distribute and promote your content in connection with operating, improving and promoting Findmi. This license lasts while your content is on Findmi and for a reasonable period afterward, for example to clear backups or where content you published was already shared. It doesn't let Findmi sell your content to others.",
      "Only post content you have the right to post. You're responsible for getting any permission you need, including from people who appear in your photos and from the owners of anything you copy.",
      "Published Moments are public. Anyone can see them on Findmi, including the businesses, Events and places you connect them to, and search engines may show them. You can unpublish or delete a Moment at any time; copies that others already saved or that search engines already indexed may take time to disappear.",
      "Don't post content that's unlawful, infringing, deceptive, harassing, hateful, sexually explicit, violent or otherwise harmful. Findmi may review, limit, remove or decline to publish content that breaks these Terms or that Findmi reasonably believes puts people or Findmi at risk, but Findmi isn't obligated to monitor content.",
    ],
  },
  {
    id: "findmi-ip",
    title: "Findmi's Intellectual Property",
    blocks: [
      "Findmi's software, design, name, logos, branding, and the way Findmi selects, organizes and presents information (including pages it compiles) belong to Findmi or its licensors and are protected by law. These Terms give you a limited, personal, revocable permission to use Findmi as intended. They don't give you any right to Findmi's trademarks or to copy, resell or build a competing service from Findmi's content or platform.",
      "If you send Findmi feedback or ideas, Findmi may use them without any obligation to you.",
    ],
  },
  {
    id: "copyright-trademark",
    title: "Copyright And Trademark Complaints",
    blocks: [
      "If you believe something on Findmi infringes your copyright or trademark, use Report on the page and choose the copyright or trademark option, or email Findmi. Please include:",
      {
        list: [
          "The work or mark you believe is being infringed",
          "Where it appears on Findmi (a link is best)",
          "Your relationship to the work or mark, and how to contact you",
          "A statement that the information you provide is accurate and that you're the owner or authorized to act for the owner",
        ],
      },
      "Findmi reviews each complaint and may remove or restrict content, and may tell the person who posted it. Findmi may close the accounts of people who repeatedly infringe others' rights. Please don't submit a complaint that you know is false.",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    blocks: [
      "When you use Findmi, don't:",
      {
        list: [
          "Break the law or help anyone else do so",
          "Mislead, defraud or scam anyone",
          "Impersonate a person, business or organization, or misrepresent your connection to one",
          "Infringe anyone's intellectual property, privacy or other rights",
          "Harass, threaten, bully or abuse anyone",
          "Upload malware, probe or break Findmi's security, or access accounts or data you aren't authorized to access",
          "Scrape, crawl or collect data from Findmi with automated tools, except as Findmi expressly allows (for example, standard search engine indexing)",
          "Overload, disrupt or interfere with Findmi or other people's use of it",
          "Post harmful content, or use Findmi's tools to send spam or unsolicited commercial messages",
          "Use Findmi for commercial purposes Findmi doesn't allow, such as reselling access or harvesting contact details",
        ],
      },
    ],
  },
  {
    id: "third-parties",
    title: "Third-Party Services",
    blocks: [
      "Findmi links to and works with services it doesn't control, including websites, payment providers, event and ticketing systems, maps, social platforms and other integrations. Your use of those services is governed by their own terms and privacy policies, and Findmi isn't responsible for them.",
    ],
  },
  {
    id: "changes-to-findmi",
    title: "Availability And Changes To Findmi",
    blocks: [
      "Findmi is always changing. Findmi may add, change, suspend or stop features, and doesn't guarantee that Findmi or any feature will always be available or work without interruption.",
    ],
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    blocks: [
      "Findmi is provided \"as is\" and \"as available.\" To the extent permitted by law, Findmi disclaims all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, title and non-infringement.",
      "Findmi doesn't guarantee that information on Findmi is accurate, complete or current, that Findmi will be available or error-free, or that using Findmi will lead to any particular result. Findmi isn't responsible for the products, services, Events, conduct or content of businesses, organizers, venues, sellers, users or other third parties.",
    ],
  },
  {
    id: "liability",
    title: "Limitation Of Liability",
    blocks: [
      "To the extent permitted by law, Findmi won't be liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill, arising from or related to your use of Findmi, even if Findmi was told they were possible.",
      "To the extent permitted by law, Findmi's total liability for any claim arising from or related to Findmi or these Terms is limited to the greater of the amount you paid Findmi in the 12 months before the claim arose or $100.",
      "Some places don't allow some or all of these limits. Nothing in these Terms limits liability that the law doesn't allow to be limited.",
    ],
  },
  {
    id: "indemnity",
    title: "Indemnity",
    blocks: [
      "To the extent permitted by law, you agree to defend and reimburse Findmi for claims, losses and reasonable costs (including reasonable legal fees) brought by third parties that arise from content you post, your breach of these Terms or the law, or your agreements and dealings with other parties through Findmi. Findmi will let you know about such a claim and may choose to take part in its defense.",
    ],
  },
  {
    id: "ending",
    title: "Ending Your Use Of Findmi",
    blocks: [
      {
        node: (
          <p>
            You can stop using Findmi at any time. You can download your data and ask Findmi to delete your account from{" "}
            <Link href="/account/privacy" className={link}>
              Account, Privacy &amp; Data
            </Link>
            . Findmi may suspend or end your access as described in these Terms.
          </p>
        ),
      },
      "Sections that by their nature should continue after your use ends (including content licenses already granted for shared content, intellectual property, disclaimers, limitation of liability, indemnity and disputes) continue to apply.",
    ],
  },
  {
    id: "disputes",
    title: "Disputes",
    blocks: [
      "If you have a concern about Findmi, please contact Findmi first. Most concerns can be resolved quickly and informally, and Findmi would like the chance to try.",
      "Nothing in these Terms takes away rights you have under laws that apply to you and that can't be changed by agreement.",
    ],
  },
  {
    id: "changes-to-terms",
    title: "Changes To These Terms",
    blocks: [
      "Findmi may update these Terms as Findmi changes. When it does, Findmi will post the updated Terms here with a new \"Last updated\" date, and for material changes will give additional notice where appropriate, for example in Findmi or by email. If you keep using Findmi after the updated Terms take effect, they apply to you. If you don't agree, please stop using Findmi.",
    ],
  },
  {
    id: "general",
    title: "General",
    blocks: [
      "These Terms, together with the Privacy Policy and any additional terms for a feature you use, are the whole agreement between you and Findmi about Findmi. If any part of these Terms can't be enforced, the rest stays in effect. If Findmi doesn't enforce a part of these Terms right away, it hasn't given up the right to do so later. You may not transfer your rights under these Terms without Findmi's permission; Findmi may transfer its rights, for example as part of a reorganization or sale of its business.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    blocks: [
      {
        node: (
          <p>
            Questions about these Terms? Email{" "}
            <a href={`mailto:${FINDMI_HELLO_EMAIL}`} className={link}>
              {FINDMI_HELLO_EMAIL}
            </a>
            . To report a problem with a specific page, message or Moment, use Report, Suggest A Correction or Request Removal where it appears.
          </p>
        ),
      },
    ],
  },
];

export default function TermsPage() {
  return <LegalPage title="Terms of Service" lastUpdated={TERMS_LAST_UPDATED} intro={INTRO} sections={SECTIONS} />;
}
