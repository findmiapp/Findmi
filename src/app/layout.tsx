import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

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

// Deliberately minimal — html/body/fonts/metadata only. The consumer
// header/nav/footer chrome lives in (public)/layout.tsx, not here, so
// /admin (a sibling top-level segment, not inside the (public) group)
// doesn't inherit it. Keeping this file free of cookies()/headers() calls
// also matters: either would force every route in the app dynamic, since
// this layout wraps literally everything.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
