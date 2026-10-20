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

export default function JcLayout({ children }: { children: React.ReactNode }) {
  const preview = jcPreviewEnabled();
  return (
    <div className="jc flex min-h-screen flex-1 flex-col bg-white text-neutral-950">
      <JcHeader preview={preview} />
      <main className="mx-auto w-full max-w-6xl flex-1 pb-28 md:pb-16">{children}</main>
      <JcTabBar />
    </div>
  );
}
