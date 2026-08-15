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
          bg: '#1a0f1a',
          panel: '#2f1c2c',
          grid: '#40273b',
          cell: '#352040',
          border: '#5a3d55',
          accent: '#8b5cf6',
          gold: '#f5c842',
          buff: '#3b82f6',
          debuff: '#ef4444',
          destroy: '#dc2626',
        },
        tier: {
          common: '#9ca3af',
          advanced: '#22c55e',
          rare: '#3b82f6',
          legend: '#a855f7',
          solid: '#f5c842',
        },
      },
      fontFamily: {
        game: ['Pretendard', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
