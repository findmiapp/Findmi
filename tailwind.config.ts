import type { Config } from "tailwindcss";

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
        findmi: {
          DEFAULT: "#14B0BC",
          50: "#EDFBFC",
          100: "#D3F5F6",
          200: "#A8ECEE",
          300: "#7FE1E3",
          400: "#3FC7CE",
          500: "#14B0BC",
          600: "#0F8E98",
          700: "#0C6F77",
          800: "#0A575D",
          900: "#08454A",
        },
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
          "var(--font-space-grotesk)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
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
