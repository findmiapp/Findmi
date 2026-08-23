/** @type {import('next').NextConfig} */
const nextConfig = {
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
