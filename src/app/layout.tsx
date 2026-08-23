import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// One typeface for the whole app — headings included. Both prior display
// treatments (Space Grotesk, then Plus Jakarta Sans) read as geometric/
// SaaS-y against the original FindMi site's reference screenshots, which
// are much closer to a plain neo-grotesk (Helvetica Neue/Avenir territory)
// than either. Inter is exactly that lineage — a highly-legible UI grotesk
// with open, humanist proportions, not a geometric display face — so
// rather than reach for another trendy geometric Google Font, headings now
// just use Inter too. This is the one central lever (the CSS variable
// already wired through every heading via font-display) rather than
// touching each component's classes; see globals.css for the accompanying
// letter-spacing softening.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const displayFont = Inter({ subsets: ["latin"], variable: "--font-display" });

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
    <html lang="en" className={`${inter.variable} ${displayFont.variable}`}>
      <body className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
