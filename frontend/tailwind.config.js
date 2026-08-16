/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#38bdf8',
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#38bdf8',
          600: '#0284c7',
          700: '#0369a1',
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
          700: '#223047',
          800: '#111827',
          850: '#0f172a',
          900: '#0b1220',
          950: '#05080f',
        },
      },
    },
  },
  plugins: [],
};
