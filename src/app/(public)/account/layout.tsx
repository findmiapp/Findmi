import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX_FOLLOW } from "@/lib/seo/indexing";

/** Account, Business/Event/Location managers and creation flows. Never a search landing page: noindex, follow for
 * every page below (lib/seo/indexing; next.config.mjs also sends the
 * X-Robots-Tag header). The title replaces the root layout's homepage
 * title for any page here that doesn't set its own. */
export const metadata: Metadata = {
  title: "Your Account",
  robots: NOINDEX_FOLLOW,
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
