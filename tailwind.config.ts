import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sephiria: {
          bg: 'rgb(var(--seph-bg-rgb) / <alpha-value>)',
          panel: 'rgb(var(--seph-panel-rgb) / <alpha-value>)',
          grid: 'rgb(var(--seph-grid-rgb) / <alpha-value>)',
          cell: 'rgb(var(--seph-cell-rgb) / <alpha-value>)',
          border: 'rgb(var(--seph-border-rgb) / <alpha-value>)',
          fg: 'rgb(var(--seph-fg-rgb) / <alpha-value>)',
          muted: 'rgb(var(--seph-muted-rgb) / <alpha-value>)',
          accent: 'rgb(var(--seph-accent-rgb) / <alpha-value>)',
          'accent-soft': 'rgb(var(--seph-accent-soft-rgb) / <alpha-value>)',
          'accent-fg': 'rgb(var(--seph-accent-fg-rgb) / <alpha-value>)',
          ink: 'rgb(var(--seph-ink-rgb) / <alpha-value>)',
          gold: 'rgb(var(--seph-gold-rgb) / <alpha-value>)',
          buff: 'rgb(var(--seph-buff-rgb) / <alpha-value>)',
          'buff-fg': 'rgb(var(--seph-buff-fg-rgb) / <alpha-value>)',
          debuff: 'rgb(var(--seph-debuff-rgb) / <alpha-value>)',
          'debuff-fg': 'rgb(var(--seph-debuff-fg-rgb) / <alpha-value>)',
          destroy: 'rgb(var(--seph-destroy-rgb) / <alpha-value>)',
          'destroy-fg': 'rgb(var(--seph-destroy-fg-rgb) / <alpha-value>)',
          confirm: 'rgb(var(--seph-confirm-rgb) / <alpha-value>)',
          'confirm-fg': 'rgb(var(--seph-confirm-fg-rgb) / <alpha-value>)',
        },
        tier: {
          common: '#B8A9A0',
          advanced: '#7FAE8A',
          rare: '#7BA3C4',
          legend: '#B08BB8',
          solid: '#C9A06A',
        },
      },
      fontFamily: {
        game: ['Pretendard Variable', 'Pretendard', 'sans-serif'],
      },
      borderRadius: {
        shell: '12px',
        inner: '8px',
        ctl: '6px',
      },
      boxShadow: {
        seph: '0 1px 2px rgba(58, 50, 46, 0.04), 0 8px 24px rgba(196, 122, 138, 0.06)',
      },
      transitionTimingFunction: {
        seph: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
