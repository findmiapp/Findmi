import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        findmi: {
          DEFAULT: "#FF5A3C",
          50: "#FFF1ED",
          100: "#FFE1D8",
          200: "#FFC2B1",
          300: "#FFA389",
          400: "#FF7C5C",
          500: "#FF5A3C",
          600: "#E63F20",
          700: "#BC3018",
          800: "#8F2513",
          900: "#671A0D",
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
