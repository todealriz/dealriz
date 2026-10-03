import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // DealRiz brand palette (sampled from logo):
        // vibrant "savings green" (lime → emerald) + deep navy wordmark.
        brand: {
          50: "#f3fae9",
          100: "#e4f4d2",
          200: "#cbeaa6",
          300: "#a9dc72",
          400: "#86cc43",
          500: "#68b32a",
          600: "#4e8d1e", // primary CTA green
          700: "#3d6e1b",
          800: "#34571c",
          900: "#2d4a1c",
        },
        navy: {
          50: "#f2f5fa",
          100: "#e2e9f4",
          200: "#c3d2e8",
          300: "#9ab3d8",
          400: "#6b8cbf",
          500: "#486da6",
          600: "#355487",
          700: "#2b446e",
          800: "#1b2a4a", // wordmark navy
          900: "#131e36",
          950: "#0c1425",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
