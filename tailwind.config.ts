import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Matches the Findmi mark: a teal squircle (#14B0BC) with a lighter
        // mint leaf (~#7FE1E3).
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
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
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
