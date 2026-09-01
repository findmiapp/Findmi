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
  // Security Pass 2 — baseline HTTP security headers, applied to every
  // response. Built from an actual inspection of what this app loads, not
  // a generic template — see each directive's comment for the concrete
  // caller that requires it.
  async headers() {
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline' is required here (not optional): Next.js 14 App
      // Router injects inline bootstrap/hydration <script> tags with no
      // src and no nonce (the RSC streaming payload — `self.__next_f.push
      // (...)` — and the hydration data script) on every page; without
      // either a nonce (out of scope for this pass, per instruction) or
      // 'unsafe-inline', the app fails to hydrate. This is a well-known
      // Next.js App Router constraint, not a FindMi-specific relaxation.
      // https://tally.so is Tally's own embed widget script (see
      // OnboardingCta.tsx's TALLY_EMBED_SCRIPT_SRC) — the only real
      // third-party script this app loads.
      // Note: 'unsafe-eval' is deliberately NOT included — production
      // Next.js builds don't need it (eval is a dev-mode-only HMR
      // mechanism), and nothing in this dependency tree (next, react,
      // supabase-js, stripe, zod) requires it client-side.
      "script-src 'self' 'unsafe-inline' https://tally.so",
      // 'unsafe-inline' here is for next/font's inlined @font-face <style>
      // block (next/font/google self-hosts Inter and writes its font-face
      // rule directly into the page rather than loading fonts.googleapis
      // .com at runtime) — not for any FindMi-authored inline style; a
      // repo-wide check found zero `style={{...}}` usage in src/.
      "style-src 'self' 'unsafe-inline'",
      // 'self' covers next/image's own /_next/image proxy (the actual
      // external fetch happens server-side; the browser only ever
      // requests same-origin URLs for next/image-rendered pictures).
      // The three explicit hosts are for the admin-only raw <img> preview
      // tags (ImageField.tsx, GalleryField.tsx, RelationPicker.tsx) that
      // render a stored URL directly, bypassing next/image — the same
      // three hosts already allow-listed in images.remotePatterns above.
      "img-src 'self' data: https://*.supabase.co https://images.unsplash.com https://*.tally.so",
      // next/font self-hosts Inter's woff2 files from this origin — no
      // external font host is ever requested at runtime.
      "font-src 'self'",
      // Every fetch() this app's browser code makes (homepage search,
      // homepage row/event filters, follow/follow-event) hits FindMi's own
      // /api/* routes. Supabase, Stripe, and Open-Meteo (weather) are only
      // ever called server-side (Server Components/Actions/route
      // handlers) — never from the browser — so they need no connect-src
      // entry. Stripe Checkout is a full top-level redirect
      // (`window.location.href = result.url` in cart/page.tsx and
      // membership checkout), not a fetch, so it isn't governed by
      // connect-src either.
      "connect-src 'self'",
      // Tally forms are embedded via <iframe> in two places (FormAction
      // .tsx for business/event/product form assignments, OnboardingCta
      // .tsx for the paid-membership "Build My Profile" step) — the only
      // third-party content this app frames.
      "frame-src https://tally.so",
      // Clickjacking protection — prefer this over X-Frame-Options
      // (included below too, for older-browser fallback per the request).
      "frame-ancestors 'none'",
      // No <object>/<embed>/<applet> anywhere in the app.
      "object-src 'none'",
      // No <base> tag is used; blocks a base-tag injection vector.
      "base-uri 'self'",
      // All FindMi forms post to Server Actions on the same page's own
      // URL (Next.js's Server Action mechanism) — never a raw external
      // form target.
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Kept alongside frame-ancestors for browsers that predate CSP2
          // frame-ancestors support.
          { key: "X-Frame-Options", value: "DENY" },
          // 2 years, includeSubDomains, preload-ready — Vercel serves
          // every route over HTTPS already (auto HTTP→HTTPS redirect), so
          // this only widens the browser's own enforcement window.
          // Actual submission to the HSTS preload list (hstspreload.org)
          // is a separate, one-time manual step this migration does not
          // perform.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: csp },
          // Conservative allow-list of clearly-unused browser features.
          // navigator.clipboard.writeText (ShareButton/EventShareButton)
          // is deliberately left off this list — clipboard-write isn't a
          // feature this policy needs to touch, and disabling it would
          // break the share/copy-link fallback.
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
