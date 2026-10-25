import type { Metadata, Viewport } from "next";
import { JcHeader, JcTabBar } from "@/components/jc/Chrome";
import { JC_SITE_URL, jcPreviewEnabled } from "@/lib/jc/config";
import "./jc.css";

// JerseyCity.guide — its own consumer product layer. Shares Findmi's root
// layout (html/body/font only) and data layer, but none of Findmi's public
// chrome: (public)/layout.tsx never wraps this segment.

export const metadata: Metadata = {
  metadataBase: new URL(JC_SITE_URL),
  title: {
    default: "JerseyCity.guide — What's good in Jersey City right now",
    template: "%s · JerseyCity.guide",
  },
  description: "Events, places and things to do across Jersey City's neighborhoods — today, this weekend and next.",
  openGraph: { siteName: "JerseyCity.guide", type: "website" },
  // V0: never indexed until real content is in and the domain is live.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

// Trust & Privacy Phase 2A: JC sets no analytics or other cookies of its
// own (no consent card needed here), but its pages are powered by Findmi,
// so Findmi's Privacy, Terms and Privacy Choices are always one tap away.
// Absolute links: on the jerseycity.guide host every path is rewritten
// under /jc, so a relative /privacy would not reach Findmi's page.
const FINDMI_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://findmi.app").replace(/\/$/, "");
const JC_FOOTER_LINKS = [
  { href: `${FINDMI_SITE_URL}/privacy`, label: "Privacy" },
  { href: `${FINDMI_SITE_URL}/terms`, label: "Terms" },
  { href: `${FINDMI_SITE_URL}/privacy-choices`, label: "Privacy Choices" },
];

function JcFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 text-[12.5px] text-neutral-500 md:px-8 md:pb-12">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/[0.06] pt-4">
        <span>Powered by Findmi</span>
        {JC_FOOTER_LINKS.map((l) => (
          <a key={l.label} href={l.href} className="font-medium text-neutral-700 hover:text-neutral-950">
            {l.label}
          </a>
        ))}
      </div>
    </footer>
  );
}

export default function JcLayout({ children }: { children: React.ReactNode }) {
  const preview = jcPreviewEnabled();
  return (
    <div className="jc flex min-h-screen flex-1 flex-col bg-white text-neutral-950">
      <JcHeader preview={preview} />
      <main className="mx-auto w-full max-w-6xl flex-1 pb-8">{children}</main>
      <JcFooter />
      <JcTabBar />
    </div>
  );
}
