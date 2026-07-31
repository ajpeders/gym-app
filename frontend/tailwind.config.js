/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#818cf8',
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#818cf8',
          600: '#6366f1',
          700: '#4f46e5',
        },
        mint: {
          DEFAULT: '#2dd4bf',
          500: '#2dd4bf',
          600: '#14b8a6',
        },
        steel: {
          DEFAULT: '#22d3ee',
          500: '#22d3ee',
        },
        iron: {
          50: '#f8fafc',
          100: '#e2e8f0',
          300: '#94a3b8',
          400: '#64748b',
          500: '#475569',
          700: '#243044',
          800: '#172033',
          850: '#121a2a',
          900: '#0d1422',
          950: '#070b12',
        },
      },
    },
  },
  plugins: [],
};
