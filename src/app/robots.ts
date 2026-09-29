import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findmi.app";

export default function robots(): MetadataRoute.Robots {
  return {
    // Embeddable Business Widget Phase 1 — /embed fragments are meant to
    // be framed on an external site, never indexed as a standalone search
    // result (see also the route's own robots: noindex metadata).
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/embed"] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
