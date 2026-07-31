/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#5eead4',
          50: '#ecfeff',
          100: '#cffafe',
          500: '#5eead4',
          600: '#14b8a6',
          700: '#0f766e',
        },
        mint: {
          DEFAULT: '#86efac',
          500: '#86efac',
          600: '#22c55e',
        },
        steel: {
          DEFAULT: '#38bdf8',
          500: '#38bdf8',
        },
        iron: {
          50: '#f8fafc',
          100: '#e2e8f0',
          300: '#94a3b8',
          400: '#64748b',
          500: '#475569',
          700: '#263241',
          800: '#182231',
          850: '#111927',
          900: '#0b111b',
          950: '#05070a',
        },
      },
    },
  },
  plugins: [],
};
