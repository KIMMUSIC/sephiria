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
          bg: 'var(--seph-bg)',
          panel: 'var(--seph-panel)',
          grid: 'var(--seph-grid)',
          cell: 'var(--seph-cell)',
          border: 'var(--seph-border)',
          fg: 'var(--seph-fg)',
          muted: 'var(--seph-muted)',
          accent: 'var(--seph-accent)',
          'accent-soft': 'var(--seph-accent-soft)',
          'accent-fg': 'var(--seph-accent-fg)',
          ink: 'var(--seph-ink)',
          gold: 'var(--seph-gold)',
          buff: 'var(--seph-buff)',
          'buff-fg': 'var(--seph-buff-fg)',
          debuff: 'var(--seph-debuff)',
          'debuff-fg': 'var(--seph-debuff-fg)',
          destroy: 'var(--seph-destroy)',
          'destroy-fg': 'var(--seph-destroy-fg)',
          confirm: 'var(--seph-confirm)',
          'confirm-fg': 'var(--seph-confirm-fg)',
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
