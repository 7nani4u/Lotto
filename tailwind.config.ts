import type { Config } from 'tailwindcss';

export default {
  content: [
    './index.html',
    './**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-blue': '#3b82f6',
        'brand-cyan': '#22d3ee',
        'brand-emerald': '#10b981',
        'brand-green': '#4ade80',
        'dark-bg': '#0f172a',
        'dark-card': 'rgba(30, 41, 59, 0.7)',
      },
      animation: {
        'float': 'float 3s ease-in-out infinite',
        'glow-cyan': 'glow-cyan 2s infinite alternate',
        'glow-emerald': 'glow-emerald 2s infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'glow-cyan': {
          'from': { 'box-shadow': '0 0 10px rgba(34, 211, 238, 0.2)' },
          'to': { 'box-shadow': '0 0 25px rgba(34, 211, 238, 0.6)' },
        },
        'glow-emerald': {
          'from': { 'box-shadow': '0 0 10px rgba(16, 185, 129, 0.2)' },
          'to': { 'box-shadow': '0 0 25px rgba(16, 185, 129, 0.6)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
