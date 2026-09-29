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
          "var(--font-display)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      // Typography Foundation pass (Performance Tab proof) — semantic size
      // tokens, purely ADDITIVE alongside Tailwind's own xs/sm/base/lg/...
      // scale (none of which are touched or redefined here). Every existing
      // page keeps rendering exactly as it does today; only a component that
      // explicitly opts into one of these new `text-*` keys is affected.
      // Font WEIGHT is deliberately NOT baked in here (kept as an ordinary,
      // separate font-medium/semibold/bold utility at each call site,
      // consistent with 100% of the codebase's existing pattern) — only
      // size/line-height/letter-spacing, which is what a "size token" means
      // everywhere else in this file. Mobile-first: the bare key is the
      // mobile/base size; a `-lg` sibling (used with a `sm:` prefix, same
      // convention already used ad hoc across the app, e.g. `text-2xl
      // sm:text-3xl`) is the desktop size, only for roles where the audit
      // recommended a genuinely different desktop size.
      fontSize: {
        // Display — hero/marketing-scale moments. Tight tracking mirrors
        // the existing .font-display.tracking-tight softening in
        // globals.css (-0.006em) at a proportionally slightly tighter value
        // for the larger size, per standard type-scale practice.
        display: ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.01em" }], // 28px
        "display-lg": ["2.375rem", { lineHeight: "1.1", letterSpacing: "-0.01em" }], // 38px

        // Page Title — one per page. Deliberately NOT tiny on mobile (see
        // Performance Tab pass note): 22px mobile is a real step up from an
        // arbitrary text-[19px] some pages used, never shrinking below what
        // reads as a genuine title.
        "page-title": ["1.375rem", { lineHeight: "1.2", letterSpacing: "-0.006em" }], // 22px
        "page-title-lg": ["1.625rem", { lineHeight: "1.2", letterSpacing: "-0.006em" }], // 26px

        "section-title": ["1.0625rem", { lineHeight: "1.3", letterSpacing: "-0.006em" }], // 17px
        "section-title-lg": ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.006em" }], // 18px

        "card-title": ["0.9375rem", { lineHeight: "1.3" }], // 15px
        "card-title-lg": ["1rem", { lineHeight: "1.3" }], // 16px

        "body-lg": ["0.9375rem", { lineHeight: "1.5" }], // 15px
        "body-lg-lg": ["1rem", { lineHeight: "1.5" }], // 16px

        // Body/Metadata/Label/Button/Helper/Microcopy — audit found these
        // roles already identical at every viewport, so one size each, no
        // `-lg` sibling.
        body: ["0.875rem", { lineHeight: "1.45" }], // 14px
        metadata: ["0.75rem", { lineHeight: "1.35" }], // 12px
        // Label/Eyebrow — same uppercase+wide-tracking grammar the app
        // already uses at text-xs/[10-11px] in ~650 places; this just gives
        // that existing, already-good pattern one canonical size/tracking
        // instead of several nearby ones.
        label: ["0.6875rem", { lineHeight: "1.2", letterSpacing: "0.06em" }], // 11px
        button: ["0.8125rem", { lineHeight: "1", letterSpacing: "0.04em" }], // 13px
        helper: ["0.75rem", { lineHeight: "1.4" }], // 12px
        microcopy: ["0.6875rem", { lineHeight: "1.3" }], // 11px

        // Input — mobile-first value is intentionally the LARGER size
        // (16px): iOS Safari auto-zooms on focusing any input rendered
        // below 16px, so this pair is deliberately reversed from every
        // other role above. `input-sm` (desktop-only, via `sm:text-input-sm`)
        // is the tighter 15px size once that zoom risk no longer applies.
        input: ["1rem", { lineHeight: "1.4" }], // 16px, mobile-first default
        "input-sm": ["0.9375rem", { lineHeight: "1.4" }], // 15px, desktop only

        // Numeric/Stat — a real number/percentage a viewer should register
        // first. Tabular figures come from the existing `tabular-nums`
        // Tailwind utility applied alongside at each call site, not from a
        // new token here.
        stat: ["1.375rem", { lineHeight: "1.1", letterSpacing: "-0.01em" }], // 22px
        "stat-lg": ["1.75rem", { lineHeight: "1.1", letterSpacing: "-0.01em" }], // 28px
      },
      // Typography Foundation pass — semantic text-color roles layered on
      // top of the existing `ink`/`findmi` palette (not a replacement for
      // either): every value below is the exact same computed color
      // `text-ink/NN` already produces today, just named by what it MEANS
      // rather than by an opacity percentage. Existing `text-ink/50` etc.
      // call sites are completely unaffected — this only adds new
      // `text-primary`/`text-secondary`/`text-muted`/`text-subtle`/
      // `text-accent` utilities alongside them. Scoped to `textColor` only
      // (not the base `colors` theme), so this deliberately does NOT create
      // matching `bg-primary`/`border-primary` utilities — "primary" etc.
      // are text-hierarchy names here, not general-purpose brand colors.
      textColor: {
        primary: "#111111", // = text-ink
        secondary: "rgb(17 17 17 / 0.7)", // = text-ink/70
        // Account Rollout pass — muted/subtle darkened slightly from their
        // Performance-proof values (ink/50, ink/35) after mobile visual
        // review found some muted/subtle text (click-rate lines, chart
        // dates, helper captions, appearance metadata) reading as too
        // pale on a real phone. This is the one deliberate, smallest-
        // necessary token adjustment: the hierarchy (primary > secondary >
        // muted > subtle) and every existing `text-muted`/`text-subtle`
        // call site (Performance included) are unchanged in intent — only
        // the two lightest steps got a real but modest readability bump.
        muted: "rgb(17 17 17 / 0.58)", // was 0.5 = text-ink/50
        subtle: "rgb(17 17 17 / 0.45)", // was 0.35 = text-ink/35
        accent: "#0C6F77", // = text-findmi-700
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
export default config;
