import type { Config } from "tailwindcss";
import { siteConfig } from "./src/lib/site-config";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // FindMi Aqua — the production brand accent (primary actions,
        // HERE NOW / live states, active navigation, selected chips)
        // against a black/warm-white foundation. DEFAULT (#14B0BC) is
        // sampled directly from the real logo asset (public/logo-lockup.png)
        // — it is the authoritative brand color, not an invented one.
        // Used scarcely and intentionally, never as a flood background.
        //
        // Highperlocal Prep, Pass 1 — the actual hex values now live in
        // lib/site-config.ts, keyed by NEXT_PUBLIC_SITE_BRAND, so a second
        // deployment can use its own brand color under this exact same
        // `findmi-*` utility-class name (renaming the token itself would
        // touch every className using it — explicitly out of scope for
        // this pass). Unchanged for `findmi` — same 10 hex values as
        // before, just sourced from one central place instead of typed
        // twice.
        findmi: siteConfig.brandColor,
        ink: "#111111",
        paper: "#F8F8F6",
        mist: "#E5E5E5",
        stone: "#666666",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: [
          "var(--font-display)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
export default config;
