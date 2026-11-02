import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        gold: 'rgb(var(--gold) / <alpha-value>)',
        sky: 'rgb(var(--sky) / <alpha-value>)',
        ribbon: 'rgb(var(--ribbon) / <alpha-value>)',
        pink: 'rgb(var(--pink) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
        hand: ['var(--font-hand)', 'cursive'],
        // Latin-only: Cyrillic in a brand span falls back to Manrope glyph by glyph
        brand: ['var(--font-brand)', 'var(--font-sans)', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '18px', '3xl': '24px' },
      boxShadow: {
        card: '0 1px 0 rgb(255 255 255 / 0.03) inset',
        glow: '0 0 0 2px rgb(var(--accent))',
      },
    },
  },
  plugins: [],
} satisfies Config;
