/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          // font.sans in src/design/tokens.ts: Manrope is bundled.
          "Manrope Variable",
          "Manrope",
          "Segoe UI Variable Text",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
        serif: [
          '"AW Conqueror Didot"',
          '"Didot"',
          '"Bodoni MT"',
          '"Playfair Display"',
          "Georgia",
          "serif",
        ],
      },
      animation: {
        "fade-in": "fadeIn 0.18s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(-2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
