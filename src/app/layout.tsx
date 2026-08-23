import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import NavDesktop from "@/components/NavDesktop";
import NavMobile from "@/components/NavMobile";
import MobileHeader from "@/components/MobileHeader";
import Footer from "@/components/Footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });

// `||` (not `??`) so an env var that's *set but blank* — e.g. left empty in
// a hosting dashboard — still falls back instead of producing an invalid URL.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findmi.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "FindMi — Find what you're looking for. And where it'll be next.",
    template: "%s · FindMi",
  },
  description:
    "FindMi helps you discover brands, vendors, mobile businesses, and events — and always know where they'll be next.",
  openGraph: {
    title: "FindMi",
    description:
      "Find what you're looking for. And where it'll be next.",
    siteName: "FindMi",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
        <MobileHeader />
        <NavDesktop />
        {/* No bottom padding here: Footer (always the next element) carries
            its own nav-clearance padding, so double-padding this div only
            produced a dead gap between content and the footer. */}
        <div className="flex-1 pt-14 md:pt-0">{children}</div>
        <Footer />
        <NavMobile />
      </body>
    </html>
  );
}
