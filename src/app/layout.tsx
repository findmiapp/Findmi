import type { Metadata } from "next";
import "./globals.css";
import NavDesktop from "@/components/NavDesktop";
import NavMobile from "@/components/NavMobile";
import Footer from "@/components/Footer";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://findmi.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Findmi — Find what you're looking for. And where it'll be next.",
    template: "%s · Findmi",
  },
  description:
    "Findmi helps you discover brands, vendors, mobile businesses, and events — and always know where they'll be next.",
  openGraph: {
    title: "Findmi",
    description:
      "Find what you're looking for. And where it'll be next.",
    siteName: "Findmi",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-[#fdfcfb] font-sans text-ink antialiased">
        <NavDesktop />
        <div className="flex-1 pb-16 md:pb-0">{children}</div>
        <Footer />
        <NavMobile />
      </body>
    </html>
  );
}
