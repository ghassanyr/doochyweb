// Dark design system ported from the standalone Gauge project (gauge/public/
// styles.css): deep blue-slate surfaces, a teal accent, solid blue hairlines,
// and gauge's rounder control scale. Semantic tokens are backed by CSS variables
// in index.css.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/webapp/index.html", "./src/webapp/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        // Recessed background for inputs/controls - darker than a card, as in
        // gauge (--bg-soft).
        soft: "rgb(var(--canvas-soft) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          hover: "rgb(var(--surface-hover) / <alpha-value>)",
          active: "rgb(var(--surface-active) / <alpha-value>)",
        },
        // Solid, blue-tinted borders (gauge's --border-soft / --border).
        hairline: {
          DEFAULT: "rgb(var(--surface-active) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--text) / 0.92)",
          muted: "rgb(var(--text) / 0.60)",
          faint: "rgb(var(--text) / 0.42)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          soft: "rgb(var(--accent) / 0.14)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          soft: "rgb(var(--success) / 0.16)",
        },
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          soft: "rgb(var(--danger) / 0.16)",
        },
        // Analysis rating scale: strong_sell / sell / neutral / buy / strong_buy
        "strong-sell": "rgb(var(--strong-sell) / <alpha-value>)",
        "strong-buy": "rgb(var(--strong-buy) / <alpha-value>)",
        rating: {
          neutral: "rgb(var(--rating-neutral) / <alpha-value>)",
        },
      },
      // Gauge's radius scale: 5-8px chips, 10px controls, 16px cards, 20px
      // sheets. Overriding the scale keeps every existing rounded-* utility
      // pointed at the new look instead of hunting each call site.
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "10px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "20px",
        "4xl": "24px",
      },
      maxWidth: {
        // gauge: main { max-width: 1600px }
        page: "1600px",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      transitionDuration: { DEFAULT: "150ms", "250": "250ms" },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.4, 0, 0.2, 1)",
        "out-soft": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(0, 0, 0, 0.30)",
        card: "0 10px 30px rgba(0, 0, 0, 0.35)",
        "card-hover": "0 16px 38px rgba(0, 0, 0, 0.45)",
        overlay: "0 30px 80px rgba(0, 0, 0, 0.60)",
      },
    },
  },
  plugins: [],
};