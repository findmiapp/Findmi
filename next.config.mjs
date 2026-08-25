/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Appearance Import (admin) posts pasted text plus up to a handful of
    // flyer/screenshot images (each capped at 5MB, see
    // lib/admin/appearance-import.ts) straight to a Server Action for
    // temporary Claude Vision analysis — they're never written to Storage,
    // so nothing else on the site needs a body this large. Next's default
    // Server Action body limit (1MB) would reject that upload outright.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      // Vendor-uploaded logo/cover images from the Tally onboarding intake
      // form (see /api/webhooks/tally) are hosted on Tally's own asset
      // CDN, not re-uploaded into Supabase Storage.
      { protocol: "https", hostname: "**.tally.so" },
    ],
  },
};

export default nextConfig;
