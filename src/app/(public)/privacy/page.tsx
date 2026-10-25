import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { type LegalBlock, type LegalSection } from "@/components/legal/LegalPage";
import { ANALYTICS_IDENTIFIER_MAX_AGE_DAYS } from "@/lib/analytics/session-constants";
import { FINDMI_PRIVACY_EMAIL, PRIVACY_LAST_UPDATED } from "@/lib/legal/published";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Findmi collects, uses, shares and protects information, and the choices you have.",
};

const link = "font-medium text-ink underline underline-offset-2";
const DAYS = ANALYTICS_IDENTIFIER_MAX_AGE_DAYS;

const INTRO: LegalBlock[] = [
  "This Privacy Policy explains how Findmi collects, uses, shares and protects information when you use Findmi, including findmi.app, JerseyCity.guide and related Findmi services. It also explains the choices you have.",
  {
    list: [
      "Findmi doesn't sell personal information.",
      "Findmi doesn't use personal information for cross-context behavioral advertising, and doesn't use third-party advertising trackers.",
      "Findmi's first-party analytics only run if you allow them.",
    ],
  },
];

const SECTIONS: LegalSection[] = [
  {
    id: "information-you-provide",
    title: "Information You Provide",
    blocks: [
      "Findmi collects the information you choose to give it, such as:",
      {
        list: [
          "Account and profile information: your email address, password (stored securely by Findmi's sign-in provider, never in readable form), display name, username, profile photo, bio, a location label you enter and, if you add one, a cell number.",
          "Business and page information: details about businesses, brands, places, Events, Appearances and products that you create or manage, including contact details, hours, images and descriptions.",
          "Moments and uploads: photos, captions, notes, dates and any place or address you add, plus the businesses, products and Events you connect them to.",
          "Saves, follows and lists: the pages you follow, the items you save and how you organize them.",
          "Inquiries, messages and Opportunities: what you send through Findmi's messaging and inquiry tools, and how you respond to Opportunities.",
          "Claims, reports and requests: information you give when you claim a page (such as your name, email, phone number and a note), suggest a correction, request removal, report something or make a privacy request.",
          "Orders: when you buy through Findmi's marketplace, your name, email, phone number, the items you buy and how they'll be fulfilled. Card details are entered with Findmi's payment processor; Findmi doesn't receive or store your full card number.",
          "Requests and feedback: for example, asking Findmi to launch in your area.",
        ],
      },
    ],
  },
  {
    id: "information-collected-automatically",
    title: "Information Collected Automatically",
    blocks: [
      "Essential technologies. Findmi uses cookies and similar browser storage that it needs to work: to keep you signed in and secure, to remember your Privacy Choices, and to keep your cart and some saved items on your device. These are always on because Findmi can't work without them.",
      `First-party analytics, only with your permission. If you choose Allow Analytics, Findmi sets two first-party cookies: a random Findmi identifier and a record of how you first arrived (for example, a campaign or QR code). They last up to ${DAYS} days. Findmi then records events such as:`,
      {
        list: [
          "Pages viewed (the page's address without its query string)",
          "Taps on things like directions, websites, saves, follows and inquiries",
          "That a search happened and the filters used. Findmi doesn't record the words you type into search.",
          "The site that sent you to Findmi, trimmed to its domain (or, for a Findmi page, its path)",
          "Campaign tags in a link, and QR code scans",
          "Which Findmi area or page the activity relates to",
        ],
      },
      "If you're signed in when you allow analytics, these events are linked to your account. If you choose Essential Only, Findmi doesn't set an analytics identifier or record these events.",
      "QR codes. A Findmi QR code always takes you to its destination. Findmi only counts the scan if you've allowed analytics; if you haven't decided yet, it's counted only after you choose Allow Analytics.",
      "Network information. Like any website, Findmi and its hosting provider receive your IP address and basic browser information when you connect. Findmi uses IP addresses briefly, in memory, to limit abuse (for example, too many sign-in attempts or reports) and doesn't store them with your analytics or account. Findmi doesn't collect your device's precise location.",
    ],
  },
  {
    id: "information-from-other-sources",
    title: "Information From Other Sources",
    blocks: [
      "Findmi also gets information from:",
      {
        list: [
          "Publicly available sources, such as business websites, public event pages and public social profiles, which Findmi uses to compile and update pages",
          "Imports that businesses and Findmi run, for example from an event page or a business's own website",
          "Other people using Findmi, for example when someone connects a Moment to your business or invites your business to an Event",
          "Findmi's payment processor, which tells Findmi whether a payment succeeded",
        ],
      },
    ],
  },
  {
    id: "how-findmi-uses-information",
    title: "How Findmi Uses Information",
    blocks: [
      {
        list: [
          "To run Findmi: showing pages, Events, Appearances, products and Moments, and letting you publish and manage your own",
          "To sign you in and keep accounts and Findmi secure",
          "To help you discover things, and to personalize discovery using your follows, saves and lists when Personalized Discovery is on",
          "To deliver messages, inquiries and Opportunity responses, and to send service notifications",
          "To process orders and payments, and to support sellers' fulfillment",
          "To understand and improve Findmi using analytics, when you've allowed it",
          "To review claims, corrections, removal requests and reports, and to provide support",
          "To prevent and investigate fraud, spam, abuse and security problems",
          "To meet legal obligations and enforce Findmi's Terms",
        ],
      },
    ],
  },
  {
    id: "privacy-choices",
    title: "Analytics And Privacy Choices",
    blocks: [
      {
        node: (
          <p>
            On your first visit, Findmi asks whether to allow analytics: Allow Analytics or Essential Only. You can change your choice at any
            time from{" "}
            <Link href="/privacy-choices" className={link}>
              Privacy Choices
            </Link>
            , linked in the footer of every page.
          </p>
        ),
      },
      {
        list: [
          "Essential: always on. Sign-in, security, your cart, items saved on your device and remembering your choices.",
          `Analytics: off until you allow it. Uses a Findmi identifier kept for up to ${DAYS} days. Findmi doesn't use it for advertising. Turning it off removes the identifier from your browser and stops new analytics.`,
          "Personalized Discovery: for signed-in accounts. Ranks discovery using the pages you follow and save and the items you organize. Turning it off doesn't change your saves, follows or lists. Findmi doesn't personalize discovery for signed-out visitors.",
        ],
      },
      "Your choice is stored on your device, and on your account when you're signed in. If your device and your account disagree, Findmi uses whichever choice is more private.",
    ],
  },
  {
    id: "gpc",
    title: "Global Privacy Control",
    blocks: [
      "If your browser sends a Global Privacy Control (GPC) signal, Findmi treats it as a choice of Essential Only: it doesn't set an analytics identifier or record analytics unless you turn Analytics on yourself in Privacy Choices.",
    ],
  },
  {
    id: "public-information",
    title: "What's Public On Findmi",
    blocks: [
      "Findmi is built for discovery, so a lot of it is public. The following can be seen by anyone, with or without an account, and may be shown by search engines:",
      {
        list: [
          "Business, brand, place and Event pages, and their Appearances and products",
          "Published Moments, including their photos, captions and the businesses, Events and places they're connected to",
          "Your public profile: display name, username, profile photo, bio and your published Moments",
        ],
      },
      "Moments you haven't published, your saves, follows and lists, and your messages aren't public. Businesses see how many people follow them, but not who those people are.",
    ],
  },
  {
    id: "images",
    title: "Photos And Image Data",
    blocks: [
      "Photos can contain hidden data, such as the GPS location where they were taken. When you upload a photo to Findmi, Findmi removes this kind of data (EXIF, XMP and IPTC metadata) before storing images that are shown publicly and before saving Moment photos. Public Moment pages show processed versions of your photos, not your original files.",
      "Some images uploaded before this processing was introduced may still contain metadata in their stored copies. If you're concerned about one, ask Findmi to review or remove it.",
    ],
  },
  {
    id: "automated-tools",
    title: "Automated And AI-Assisted Tools",
    blocks: [
      "Some Findmi tools use automated processing, including AI services, to extract and organize information you provide: for example, when a business imports an Event from a link, text or flyer, or builds a starting profile from its website. Findmi also uses these tools when compiling pages from public sources. The person using the tool reviews the result before it's published.",
      "Findmi doesn't use AI services to process your private Moments or your messages. Not all Findmi content is created with automated tools; most is provided by people and businesses.",
    ],
  },
  {
    id: "page-sources",
    title: "Where Pages Come From",
    blocks: [
      "Pages on Findmi may be created by the business or organization itself, by people using Findmi, by Findmi, through imports, or from publicly available information. Where available, a page's About This Page section explains whether it's managed and where its information came from.",
      "If information about you or your organization is wrong or shouldn't be on Findmi, use Suggest A Correction, Request Removal or Report on the page. These tools are free and separate from claiming a page.",
    ],
  },
  {
    id: "sharing",
    title: "How Information Is Shared",
    blocks: [
      "Findmi shares information only as described here:",
      {
        list: [
          "With the people you contact: messages and inquiries go to their recipients. When a page isn't managed yet, or for commercial requests, they go to Findmi.",
          "With sellers: when you place an order, each seller gets what it needs to fulfill its items, such as your name, contact details and what you bought.",
          "Publicly: content you publish, as described above.",
          "With service providers that help Findmi run, under agreements that limit how they use the information: hosting (Vercel), database, sign-in and file storage (Supabase), payments (Stripe), email delivery (Resend), AI-assisted processing for the import tools described above (Anthropic) and form collection when Findmi uses forms (Tally).",
          "For legal reasons: when Findmi believes in good faith that it's required by law, or needed to protect the rights, safety or property of people or Findmi.",
          "In a business change: if Findmi is involved in a reorganization, merger or sale, information may transfer as part of it, under this policy's protections.",
          "With your direction or consent.",
        ],
      },
      "Findmi doesn't sell personal information, doesn't share it for cross-context behavioral advertising, and doesn't use third-party advertising pixels or session recording.",
    ],
  },
  {
    id: "retention",
    title: "How Long Findmi Keeps Information",
    blocks: [
      "Findmi keeps information for as long as it's needed for the purposes in this policy, for example while your account is open or a page is active, and as needed for legal, accounting, security and dispute purposes.",
      `Analytics identifiers in your browser expire after up to ${DAYS} days. Analytics events Findmi has already recorded are kept in Findmi's database; Findmi doesn't currently delete them on a fixed schedule. When an account is deleted, its analytics events are disconnected from it.`,
      "When Findmi deletes an account, it deletes the profile, saves, follows and Moments and their photo files. Some records, such as orders and payments, may be kept where Findmi needs them. Backups are overwritten over time.",
    ],
  },
  {
    id: "your-rights",
    title: "Your Choices And Rights",
    blocks: [
      {
        node: (
          <p>
            You can:
          </p>
        ),
      },
      {
        list: [
          <>
            Change analytics and personalization at any time in{" "}
            <Link href="/privacy-choices" className={link}>
              Privacy Choices
            </Link>
          </>,
          "Edit your profile in your account settings",
          <>
            Download your data, ask Findmi to delete your account, or ask to access or correct information, from{" "}
            <Link href="/account/privacy" className={link}>
              Account, Privacy &amp; Data
            </Link>
          </>,
          "Unpublish or delete your Moments, and unfollow or unsave pages",
          "Report, correct or ask Findmi to remove information on any page",
          <>
            Email{" "}
            <a href={`mailto:${FINDMI_PRIVACY_EMAIL}`} className={link}>
              {FINDMI_PRIVACY_EMAIL}
            </a>{" "}
            if you don&rsquo;t have an account or need help
          </>,
        ],
      },
      "Depending on where you live, you may have legal rights over your personal information, such as rights to know, access, correct, delete or get a copy of it, to opt out of its sale or use for targeted advertising (Findmi doesn't do either), and to appeal a decision about your request. Findmi will respond to requests as the law where you live requires, may need to verify your identity first, and won't treat you differently for using your rights. You may use an authorized agent where the law allows.",
    ],
  },
  {
    id: "communications",
    title: "Emails From Findmi",
    blocks: [
      "Findmi sends service emails, such as sign-in and password emails, notifications about messages, inquiries and Opportunities, updates about orders, claims and your plan, and, if you ask for one, a note when Findmi launches in your area. Findmi doesn't send marketing emails today. If that changes, Findmi will update this policy and give you a way to opt out.",
    ],
  },
  {
    id: "children",
    title: "Children",
    blocks: [
      {
        node: (
          <p>
            Findmi is a general-audience service and isn&rsquo;t directed to children under 13. You must be at least 13 to create an account (see the{" "}
            <Link href="/terms" className={link}>
              Terms of Service
            </Link>
            ). Findmi doesn&rsquo;t knowingly collect personal information from children under 13. If you believe a child under 13 has given Findmi
            personal information, email {FINDMI_PRIVACY_EMAIL} and Findmi will delete it.
          </p>
        ),
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    blocks: [
      "Findmi uses reasonable safeguards to protect information, including encrypted connections, access controls, private storage for unpublished Moment photos, and limits on who at Findmi can access personal information. No system is perfectly secure, so Findmi can't guarantee the security of information. Please use a strong, unique password.",
    ],
  },
  {
    id: "where-processed",
    title: "Where Information Is Processed",
    blocks: [
      "Findmi is designed for people and businesses in the United States, and Findmi's database is hosted in the United States. If you use Findmi from somewhere else, your information will be transferred to and processed in the United States, where privacy laws may differ from those where you live.",
    ],
  },
  {
    id: "changes",
    title: "Changes To This Policy",
    blocks: [
      "Findmi may update this policy as Findmi changes. Findmi will post the updated policy here with a new \"Last updated\" date and, for material changes, give additional notice where appropriate.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    blocks: [
      {
        node: (
          <p>
            Questions or requests about privacy? Email{" "}
            <a href={`mailto:${FINDMI_PRIVACY_EMAIL}`} className={link}>
              {FINDMI_PRIVACY_EMAIL}
            </a>
            , or use{" "}
            <Link href="/account/privacy" className={link}>
              Account, Privacy &amp; Data
            </Link>{" "}
            if you have an account.
          </p>
        ),
      },
    ],
  },
];

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" lastUpdated={PRIVACY_LAST_UPDATED} intro={INTRO} sections={SECTIONS} />;
}
